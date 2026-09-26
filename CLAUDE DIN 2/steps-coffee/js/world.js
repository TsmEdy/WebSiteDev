import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep, hash, createNoise } from './util.js';

export const TAU_SCALE = 14;          // sim-seconds across the whole page
export const CUP_Z = -470;
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ============================================================
   Camera poses, one per [data-cam] section
   drop = droplet anchor offset in camera space (x, y)
   ============================================================ */
export const POSES = [
  { pos: [0, 44, 80], look: [0, 20, -30], drop: [1.7, 0.75], bob: 0.0 },         // 0 hero
  { pos: [-5, 12, -40], look: [3, 4, -95], drop: [1.3, -0.2], bob: 0.25 },       // 1 seed
  { pos: [1, 6.8, -160], look: [-1, 6.4, -205], drop: [-1.3, -0.15], bob: 0.2 }, // 2 cherry
  { pos: [0, 2.7, -256], look: [0, 2.0, -300], drop: [1.25, -0.1], bob: 1.0 },   // 3 sun (walking)
  { pos: [0, 4.0, -366], look: [0, 4.0, -410], drop: [-1.25, -0.05], bob: 0.35 },// 4 fire
  { pos: [0, 9.5, -444], look: [0, 5.2, -470], drop: [0, 0.35], bob: 0.0 },      // 5 cup
  { pos: [19, 9, -455], look: [0, 0.5, -470], drop: [0, 0], bob: 0.0 },          // 6 menu
  { pos: [-18, 7.5, -452], look: [0, 0.8, -470], drop: [0, 0], bob: 0.0 },       // 7 beans
  { pos: [0.5, 33, -462], look: [0, 0, -470], drop: [0, 0], bob: 0.0 },          // 8 visit
];

/* ============================================================
   Atmosphere keyed by camera z
   ============================================================ */
const A = (o) => ({
  ...o,
  top: new THREE.Color(o.top), hor: new THREE.Color(o.hor), bot: new THREE.Color(o.bot),
  fog: new THREE.Color(o.fog), sun: new THREE.Color(o.sun), hemiS: new THREE.Color(o.hemiS), hemiG: new THREE.Color(o.hemiG),
  sunDir: V(...o.sunDir).normalize(),
});
const DAWN = { top: '#7fa6d4', hor: '#f6c7a2', bot: '#e8cdb3', fog: '#eed3bf', near: 70, far: 330, sun: '#ffcf9c', sunI: 2.6, sunDir: [-0.35, 0.16, -1], hemiS: '#ffeede', hemiG: '#4f6a3e', hemiI: 1.1, exp: 1.02, env: 0.5 };
const SEED = { top: '#8fb4da', hor: '#f6d6ba', bot: '#e8d3bd', fog: '#eedac8', near: 45, far: 240, sun: '#ffe1bf', sunI: 2.8, sunDir: [-0.25, 0.42, -1], hemiS: '#fff3e6', hemiG: '#4f6a3e', hemiI: 1.2, exp: 1.02, env: 0.55 };
const CHERRY = { top: '#f1d7ca', hor: '#eeb39f', bot: '#e5bfae', fog: '#efc7b7', near: 6, far: 85, sun: '#ffdcc6', sunI: 2.8, sunDir: [0.4, 0.6, -0.6], hemiS: '#fff1ea', hemiG: '#a8625a', hemiI: 1.25, exp: 1.02, env: 0.7 };
const SUN = { top: '#f4e2bb', hor: '#f0b867', bot: '#e0bd87', fog: '#eccd98', near: 14, far: 120, sun: '#ffc77a', sunI: 3.4, sunDir: [0.9, 0.32, -0.45], hemiS: '#fff1d6', hemiG: '#9a784a', hemiI: 1.05, exp: 1.04, env: 0.5 };
const FIRE = { top: '#120a06', hor: '#3a190c', bot: '#0b0604', fog: '#1d0f09', near: 3, far: 55, sun: '#ff8a3d', sunI: 0.5, sunDir: [0, 1, 0], hemiS: '#6a3016', hemiG: '#120806', hemiI: 0.55, exp: 1.12, env: 0.35 };
const CUP = { top: '#fbf7f1', hor: '#f1e8dc', bot: '#eadfd0', fog: '#f2ebe1', near: 40, far: 190, sun: '#fff2e2', sunI: 2.8, sunDir: [0.55, 0.85, 0.45], hemiS: '#ffffff', hemiG: '#d6c4ae', hemiI: 1.3, exp: 1.0, env: 0.9 };
const ATMOS = [
  { z: 90, ...A(DAWN) }, { z: -55, ...A(SEED) },
  { z: -150, ...A(CHERRY) }, { z: -200, ...A(CHERRY) },
  { z: -250, ...A(SUN) }, { z: -318, ...A(SUN) },
  { z: -340, ...A(FIRE) }, { z: -410, ...A(FIRE) },
  { z: -438, ...A(CUP) }, { z: -600, ...A(CUP) },
];

/* ============================================================
   GLSL helpers
   ============================================================ */
const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1,0)), u.x), mix(hash21(i+vec2(0,1)), hash21(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
`;

/* ============================================================
   Geometry helpers
   ============================================================ */
function beanGeometry(seg = 12, rings = 9) {
  const g = new THREE.SphereGeometry(1, seg, rings);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const x = v.x * 0.64;
    const y = v.y;
    let z = v.z * 0.52;
    if (z > 0) z *= 0.5;
    const d = x - 0.08 * Math.sin(y * 2.4);
    z -= Math.exp(-(d * d) / 0.006) * smoothstep(0, 0.3, v.z) * 0.16;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function leafGeometry() {
  const g = new THREE.PlaneGeometry(1, 0.42, 8, 2);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const u = x + 0.5;
    const w = Math.sin(Math.PI * u) * (0.7 + 0.3 * (1 - u));
    p.setY(i, p.getY(i) * w);
    p.setZ(i, Math.sin(Math.PI * u) * 0.12 + Math.abs(p.getY(i)) * 0.25);
  }
  g.computeVertexNormals();
  return g;
}

function canvasTexture(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat[0], repeat[1]);
  }
  t.anisotropy = 8;
  return t;
}

/* ============================================================
   World
   ============================================================ */
export class World {
  constructor(canvas, { mobile = false, reducedMotion = false } = {}) {
    this.mobile = mobile;
    this.reduced = reducedMotion;
    this.q = mobile ? 0.5 : 1;
    this.mouse = new THREE.Vector2();
    this.mouseS = new THREE.Vector2();
    this.frames = [];
    this.intro = 0;
    this.velS = 0;
    this.frameTimes = [];
    this.dprMax = Math.min(window.devicePixelRatio || 1, mobile ? 1.2 : 1.4);
    this.dpr = this.dprMax;

    const r = new THREE.WebGLRenderer({ canvas, antialias: !mobile && (window.devicePixelRatio || 1) <= 1.25, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(this.dpr);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1;
    r.outputColorSpace = THREE.SRGBColorSpace;
    if ('transmissionResolutionScale' in r) r.transmissionResolutionScale = 0.5;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xf0d2ba, 40, 230);
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 900);
    this.scene.add(this.camera);
    this.noise = createNoise(5);
    this.atm = A(DAWN);

    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();

    this.buildLights();
    this.buildSky();
    this.buildHills();
    this.buildCherries();
    this.buildBeds();
    this.buildTunnel();
    this.buildCup();
    this.buildDroplet();
    this.resize();
  }

  /* ---------------- lights & sky ---------------- */
  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1.2);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.fireLights = [new THREE.PointLight(0xff7a2a, 0, 26, 1.6), new THREE.PointLight(0xffa048, 0, 18, 1.6)];
    this.fireLights.forEach((l) => this.scene.add(l));
  }

  buildSky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uBot: { value: new THREE.Color() },
        uSunDir: { value: V(0, 1, 0) }, uSunCol: { value: new THREE.Color() }, uSunI: { value: 1 },
      },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHor, uBot, uSunDir, uSunCol; uniform float uSunI; varying vec3 vDir;
        void main(){
          vec3 d = normalize(vDir); float h = d.y;
          vec3 col = h > 0.0 ? mix(uHor, uTop, pow(smoothstep(0.0, 0.7, h), 0.75)) : mix(uHor, uBot, smoothstep(0.0, -0.25, h));
          float s = max(dot(d, normalize(uSunDir)), 0.0);
          col += uSunCol * (pow(s, 600.0) * 3.0 + pow(s, 24.0) * 0.28 + pow(s, 4.0) * 0.1) * uSunI * 0.4;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(600, 48, 24), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  /* ---------------- chapter 1: terraced highlands ---------------- */
  height(x, z) {
    const n = this.noise;
    let h = n.fbm(x * 0.017, z * 0.017, 4) * 30 + n(x * 0.06, z * 0.06) * 2;
    h += 0.0028 * x * x;
    h -= 13 * Math.exp(-(x * x) / (2 * 15 * 15));
    h -= 7;
    h -= smoothstep(-100, -150, z) * 34;
    const step = 1.7;
    const t = h / step;
    const f = t - Math.floor(t);
    return (Math.floor(t) + smoothstep(0.7, 1.0, f)) * step;
  }

  buildHills() {
    const g = new THREE.Group();
    const seg = this.mobile ? [140, 110] : [230, 170];
    const geo = new THREE.PlaneGeometry(340, 250, seg[0], seg[1]);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, -40);
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const cLow = new THREE.Color('#3f6a35');
    const cHigh = new THREE.Color('#86b35e');
    const cEarth = new THREE.Color('#8a6a45');
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const h = this.height(x, z);
      pos.setY(i, h);
      const hn = this.height(x + 0.6, z);
      const riser = smoothstep(0.25, 0.9, Math.abs(hn - h));
      c.copy(cLow).lerp(cHigh, smoothstep(-24, 16, h) * 0.85 + hash(i) * 0.1).lerp(cEarth, riser * 0.55);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const terrain = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 }));
    g.add(terrain);

    // coffee shrubs on the terraces
    const a = new THREE.IcosahedronGeometry(1, 0);
    a.scale(1.15, 0.95, 1.15);
    a.translate(0, 0.95, 0);
    const b = new THREE.IcosahedronGeometry(0.7, 0);
    b.translate(0.55, 1.55, 0.2);
    const shrubGeo = mergeGeometries([a.index ? a.toNonIndexed() : a, b.index ? b.toNonIndexed() : b]);
    shrubGeo.computeVertexNormals();
    const shrubMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true });
    const max = Math.round(3600 * this.q);
    const shrubs = new THREE.InstancedMesh(shrubGeo, shrubMat, max);
    const greens = ['#2d5e2f', '#3a7236', '#4b8a3f', '#5e9c48', '#2f6533'].map((h) => new THREE.Color(h));
    const m = new THREE.Matrix4();
    const qn = new THREE.Quaternion();
    const s = new THREE.Vector3();
    let n = 0;
    const stepX = this.mobile ? 3.0 : 2.1;
    const stepZ = this.mobile ? 2.8 : 2.0;
    for (let x = -110; x <= 110 && n < max; x += stepX) {
      for (let z = 35; z >= -105 && n < max; z -= stepZ) {
        const k = x * 13.1 + z * 7.7;
        if (hash(k) > 0.72) continue;
        const px = x + (hash(k + 1) - 0.5) * 1.2;
        const pz = z + (hash(k + 2) - 0.5) * 1.2;
        const h = this.height(px, pz);
        const hn = this.height(px + 0.8, pz);
        if (Math.abs(hn - h) > 0.35) continue; // keep shrubs on terrace flats
        if (Math.abs(px) < 4 && pz < 0) continue;
        const sc = 0.7 + hash(k + 3) * 0.6;
        qn.setFromAxisAngle(V(0, 1, 0), hash(k + 4) * Math.PI * 2);
        s.set(sc, sc * (0.8 + hash(k + 5) * 0.4), sc);
        m.compose(V(px, h - 0.1, pz), qn, s);
        shrubs.setMatrixAt(n, m);
        shrubs.setColorAt(n, greens[Math.floor(hash(k + 6) * greens.length)]);
        n++;
      }
    }
    shrubs.count = n;
    g.add(shrubs);

    // tall shade trees scattered over the plantation (gives scale)
    const trunkGeo = new THREE.CylinderGeometry(0.18, 0.3, 7, 6);
    trunkGeo.translate(0, 3.5, 0);
    const crownGeo = new THREE.IcosahedronGeometry(3.2, 1);
    crownGeo.scale(1.2, 0.7, 1.2);
    crownGeo.translate(0, 7.6, 0);
    const treeCount = Math.round(140 * this.q);
    const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x6b4a33, roughness: 0.9 }), treeCount);
    const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), treeCount);
    const treeGreens = ['#35652f', '#487a3a', '#2c5530'].map((h) => new THREE.Color(h));
    let tn = 0;
    for (let i = 0; tn < treeCount && i < treeCount * 6; i++) {
      const px = (hash(i * 7.31) - 0.5) * 200;
      const pz = 30 - hash(i * 3.97) * 140;
      if (Math.abs(px) < 12) continue;
      const h = this.height(px, pz);
      const sc = 0.7 + hash(i * 1.9) * 0.6;
      qn.setFromAxisAngle(V(0, 1, 0), hash(i) * 6.28);
      m.compose(V(px, h - 0.2, pz), qn, s.set(sc, sc, sc));
      trunks.setMatrixAt(tn, m);
      crowns.setMatrixAt(tn, m);
      crowns.setColorAt(tn, treeGreens[i % 3]);
      tn++;
    }
    trunks.count = crowns.count = tn;
    g.add(trunks, crowns);

    // mist banks
    const mistMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uColor: { value: new THREE.Color('#fff6ee') }, uOpacity: { value: 0.55 } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uT, uOpacity; uniform vec3 uColor; varying vec2 vUv;
        ${GLSL_NOISE}
        void main(){
          vec2 p = vUv * vec2(4.0, 1.2);
          float n = fbm(p + vec2(uT * 0.08, 0.0));
          float edge = smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x) * smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.5, vUv.y);
          float a = smoothstep(0.35, 0.8, n) * edge * uOpacity;
          gl_FragColor = vec4(uColor, a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mist = [];
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(70, 16), mistMat.clone());
      const x = (hash(i * 3.3) - 0.5) * 110;
      const z = 20 - hash(i * 5.1) * 130;
      mesh.position.set(x, this.height(x, z) + 5 + hash(i) * 5, z);
      mesh.material.uniforms.uOpacity.value = 0.35 + hash(i * 9) * 0.3;
      mesh.userData.seed = i * 1.7;
      g.add(mesh);
      this.mist.push(mesh);
    }
    this.hills = g;
    g.userData.range = [60, -150];
    this.scene.add(g);
  }

  /* ---------------- chapter 2: cherry cloud ---------------- */
  buildCherries() {
    const g = new THREE.Group();
    const count = Math.round(2200 * this.q);
    const geo = new THREE.SphereGeometry(1, 14, 10);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.12, envMapIntensity: 1.2 });
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    const palette = ['#a8102a', '#c21a33', '#8c0d1f', '#d42a3a', '#b3162c', '#e0622a', '#7e9a3a'].map((h) => new THREE.Color(h));
    const data = [];
    for (let i = 0; i < count; i++) {
      const u = hash(i * 1.31);
      const r = 2.6 + Math.pow(u, 1.4) * 17;
      const th = hash(i * 2.17) * Math.PI * 2;
      const z = -118 - hash(i * 3.71) * 100;
      const pick = hash(i * 4.9);
      const color = pick < 0.07 ? palette[6] : pick < 0.14 ? palette[5] : palette[Math.floor(hash(i * 5.3) * 5)];
      mesh.setColorAt(i, color);
      data.push({ r, th, z, s: 0.32 + hash(i * 6.1) * 0.24, w: (0.55 + hash(i * 7.3) * 0.5) / (1 + r * 0.08), ph: hash(i * 8.9) * 6.28, rx: hash(i * 9.7) * 6.28 });
    }
    g.add(mesh);

    const leafCount = Math.round(420 * this.q);
    const leaves = new THREE.InstancedMesh(leafGeometry(), new THREE.MeshStandardMaterial({ color: 0x3f7a3a, roughness: 0.55, side: THREE.DoubleSide }), leafCount);
    leaves.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    leaves.frustumCulled = false;
    const leafData = [];
    for (let i = 0; i < leafCount; i++) {
      leafData.push({ r: 3 + hash(i * 11.3) * 15, th: hash(i * 12.7) * 6.28, z: -120 - hash(i * 13.1) * 96, s: 0.9 + hash(i * 14.3) * 0.8, w: 0.3 + hash(i * 15.1) * 0.4, ph: hash(i * 16.7) * 6.28 });
    }
    g.add(leaves);
    this.cherries = { group: g, mesh, data, leaves, leafData };
    g.userData.range = [-100, -235];
    this.scene.add(g);
  }

  updateCherries(tau, camPos) {
    const { mesh, data, leaves, leafData } = this.cherries;
    const d = this._d || (this._d = new THREE.Object3D());
    const ax = 0;
    const ay = 6.5;
    for (let i = 0; i < data.length; i++) {
      const c = data[i];
      const th = c.th + tau * c.w;
      let x = ax + Math.cos(th) * c.r;
      let y = ay + Math.sin(th) * c.r * 0.72 + Math.sin(tau * 0.8 + c.ph) * 0.25;
      let z = c.z;
      const dx = x - camPos.x;
      const dy = y - camPos.y;
      const dz = z - camPos.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 3.2) {
        const push = (3.2 - dist) * 0.9;
        x += (dx / dist) * push;
        y += (dy / dist) * push;
        z += (dz / dist) * push;
      }
      d.position.set(x, y, z);
      d.rotation.set(c.rx + tau * 0.5, c.ph + tau * 0.3, 0);
      d.scale.set(c.s, c.s * 0.94, c.s);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < leafData.length; i++) {
      const c = leafData[i];
      const th = c.th + tau * c.w;
      d.position.set(ax + Math.cos(th) * c.r, ay + Math.sin(th) * c.r * 0.72, c.z);
      d.rotation.set(c.ph + tau * 0.9, th + tau * 0.4, c.ph * 0.5 + tau * 0.6);
      d.scale.setScalar(c.s);
      d.updateMatrix();
      leaves.setMatrixAt(i, d.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- chapter 3: drying beds ---------------- */
  buildBeds() {
    const g = new THREE.Group();
    const dirt = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#cfae80';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        const v = Math.random();
        ctx.fillStyle = v < 0.5 ? `rgba(120,85,50,${Math.random() * 0.18})` : `rgba(255,240,210,${Math.random() * 0.2})`;
        const s = Math.random() * 3 + 0.5;
        ctx.fillRect(Math.random() * w, Math.random() * h, s, s);
      }
    }, { repeat: [40, 30] });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(320, 190), new THREE.MeshStandardMaterial({ map: dirt, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -268);
    g.add(ground);

    const net = canvasTexture(128, 128, (ctx, w, h) => {
      ctx.fillStyle = '#6f5a44';
      ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = 'rgba(30,20,12,0.55)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= w; i += 16) {
        ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
      }
    }, { repeat: [2, 60] });
    const beansTex = canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = '#7a5f3e';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 520; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.random() * Math.PI);
        const t = Math.random();
        ctx.fillStyle = t < 0.33 ? '#b8323a' : t < 0.66 ? '#c9a45e' : '#98a070';
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 4.6, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(-6, -0.6, 12, 1.2);
        ctx.restore();
      }
    }, { repeat: [1, 30] });
    const bedX = [-20, -15.8, -11.6, -7.4, -3.2, 3.2, 7.4, 11.6, 15.8, 20];
    const bedNear = new THREE.MeshStandardMaterial({ map: net, roughness: 0.9 });
    const bedFar = new THREE.MeshStandardMaterial({ map: beansTex, roughness: 0.85 });
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x8a6440, roughness: 0.8 });
    const bedGeo = new THREE.BoxGeometry(2.6, 0.12, 100);
    const railGeo = new THREE.BoxGeometry(0.1, 0.22, 100);
    const shadowMat = new THREE.MeshBasicMaterial({ color: 0x5a3b1c, transparent: true, opacity: 0.22, depthWrite: false });
    for (const x of bedX) {
      const near = Math.abs(x) < 8;
      const bed = new THREE.Mesh(bedGeo, near ? bedNear : bedFar);
      bed.position.set(x, 1.05, -270);
      g.add(bed);
      for (const s of [-1.33, 1.33]) {
        const rail = new THREE.Mesh(railGeo, woodMat);
        rail.position.set(x + s, 1.12, -270);
        g.add(rail);
      }
      const sh = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 100), shadowMat);
      sh.rotation.x = -Math.PI / 2;
      sh.position.set(x - 1.4, 0.02, -270);
      g.add(sh);
    }
    // legs
    const legGeo = new THREE.CylinderGeometry(0.06, 0.07, 1.0, 6);
    legGeo.translate(0, 0.5, 0);
    const legs = new THREE.InstancedMesh(legGeo, woodMat, bedX.length * 21 * 2);
    let li = 0;
    const m = new THREE.Matrix4();
    for (const x of bedX) {
      for (let k = 0; k <= 20; k++) {
        for (const s of [-1.2, 1.2]) {
          m.makeTranslation(x + s, 0, -220 - k * 5);
          legs.setMatrixAt(li++, m);
        }
      }
    }
    g.add(legs);

    // real beans on the four nearest beds (GPU wave on fast scroll)
    const across = 5;
    const along = this.mobile ? 90 : 140;
    const nearBeds = bedX.filter((x) => Math.abs(x) < 8);
    const count = nearBeds.length * across * along;
    const beanMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 });
    const waveUniforms = { uWave: { value: 0 }, uTime: { value: 0 } };
    beanMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, waveUniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWave, uTime;')
        .replace('#include <project_vertex>', /* glsl */ `
          vec4 mvPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            mvPosition = instanceMatrix * mvPosition;
            vec3 ip = instanceMatrix[3].xyz;
            float ph = ip.z * 0.42 + ip.x * 0.9 - uTime * 6.0;
            float w = max(0.0, sin(ph));
            float jit = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
            mvPosition.y += uWave * w * w * (0.55 + 0.45 * jit);
          #endif
          mvPosition = modelViewMatrix * mvPosition;
          gl_Position = projectionMatrix * mvPosition;`);
    };
    const beans = new THREE.InstancedMesh(beanGeometry(10, 8), beanMat, count);
    const cRed = new THREE.Color('#a8252f');
    const cYel = new THREE.Color('#c9a15a');
    const cGrn = new THREE.Color('#9aa276');
    const c = new THREE.Color();
    const d = new THREE.Object3D();
    let bi = 0;
    for (const x of nearBeds) {
      for (let a = 0; a < across; a++) {
        for (let k = 0; k < along; k++) {
          const z = -221 - (k / along) * 98 + (hash(bi * 1.7) - 0.5) * 0.3;
          d.position.set(x - 1.0 + (a / (across - 1)) * 2.0 + (hash(bi * 2.3) - 0.5) * 0.25, 1.2, z);
          d.rotation.set(Math.PI / 2 + (hash(bi) - 0.5) * 0.6, hash(bi * 3.1) * 6.28, 0);
          d.scale.setScalar(0.19 + hash(bi * 4.7) * 0.05);
          d.updateMatrix();
          beans.setMatrixAt(bi, d.matrix);
          const t = clamp((-221 - z) / 98, 0, 1);
          if (t < 0.5) c.copy(cRed).lerp(cYel, t * 2);
          else c.copy(cYel).lerp(cGrn, (t - 0.5) * 2);
          c.offsetHSL(0, 0, (hash(bi * 5.9) - 0.5) * 0.08);
          beans.setColorAt(bi, c);
          bi++;
        }
      }
    }
    g.add(beans);
    this.beds = { group: g, waveUniforms };
    g.userData.range = [-195, -335];
    this.scene.add(g);
  }

  /* ---------------- chapter 4: roast tunnel ---------------- */
  buildTunnel() {
    const g = new THREE.Group();
    const ringCount = this.mobile ? 36 : 50;
    const per = this.mobile ? 20 : 28;
    const geo = beanGeometry(14, 10);
    const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.38, clearcoat: 0.6, clearcoatRoughness: 0.35 });
    const mesh = new THREE.InstancedMesh(geo, mat, ringCount * per);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    const stops = ['#7f8f5a', '#b5a060', '#c28a4a', '#9a5a2e', '#5e3218', '#2e170b'].map((h) => new THREE.Color(h));
    const c = new THREE.Color();
    const data = [];
    for (let r = 0; r < ringCount; r++) {
      const t = r / (ringCount - 1);
      const si = Math.min(Math.floor(t * (stops.length - 1)), stops.length - 2);
      const lt = t * (stops.length - 1) - si;
      for (let k = 0; k < per; k++) {
        const i = r * per + k;
        c.copy(stops[si]).lerp(stops[si + 1], lt).offsetHSL(0, 0, (hash(i * 3.3) - 0.5) * 0.06);
        mesh.setColorAt(i, c);
        data.push({
          ring: r,
          a: (k / per) * Math.PI * 2 + hash(i) * 0.2,
          rad: 3.4 + (hash(i * 1.9) - 0.5) * 0.9,
          z: -328 - r * 1.8 + (hash(i * 2.7) - 0.5) * 0.8,
          tilt: hash(i * 4.1) * 6.28,
          s: 0.34 + hash(i * 5.3) * 0.12,
        });
      }
    }
    g.add(mesh);

    // embers
    const n = Math.round(1400 * this.q);
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = hash(i * 1.1) * Math.PI * 2;
      const rr = Math.sqrt(hash(i * 2.2)) * 3.2;
      pos[i * 3] = Math.cos(a) * rr;
      pos[i * 3 + 1] = 4 + Math.sin(a) * rr;
      pos[i * 3 + 2] = -328 - hash(i * 3.3) * 90;
      seed[i] = hash(i * 4.4);
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    eg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const emberMat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uPR: { value: this.dpr } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uT, uPR; varying float vA; varying float vS;
        void main(){
          vec3 p = position;
          float life = fract(aSeed * 7.0 + uT * (0.12 + aSeed * 0.2));
          p.y += life * 5.0 - 2.5;
          float sw = uT * (0.6 + aSeed) + aSeed * 30.0;
          p.x += sin(sw) * 0.5; p.z += cos(sw * 0.7) * 0.5;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (4.0 + aSeed * 10.0) * uPR * (8.0 / -mv.z);
          vA = sin(life * 3.14159) * smoothstep(40.0, 4.0, -mv.z);
          vS = aSeed;
        }`,
      fragmentShader: /* glsl */ `
        varying float vA; varying float vS;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float a = smoothstep(0.5, 0.0, d) * vA;
          vec3 col = mix(vec3(1.0, 0.45, 0.1), vec3(1.0, 0.85, 0.4), vS);
          gl_FragColor = vec4(col * a * 1.6, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const embers = new THREE.Points(eg, emberMat);
    embers.frustumCulled = false;
    g.add(embers);

    // dark drum walls
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(7, 7, 100, 40, 1, true),
      new THREE.MeshStandardMaterial({ color: 0x1a0f0a, roughness: 0.6, metalness: 0.5, side: THREE.BackSide })
    );
    wall.rotation.x = Math.PI / 2;
    wall.position.set(0, 4, -372);
    g.add(wall);

    this.tunnel = { group: g, mesh, data, embers, per };
    g.userData.range = [-300, -430];
    this.scene.add(g);
  }

  updateTunnel(tau) {
    const { mesh, data } = this.tunnel;
    const d = this._d || (this._d = new THREE.Object3D());
    for (let i = 0; i < data.length; i++) {
      const b = data[i];
      const dir = b.ring % 2 ? 1 : -1;
      const a = b.a + tau * 0.55 * dir + b.ring * 0.13;
      d.position.set(Math.cos(a) * b.rad, 4 + Math.sin(a) * b.rad, b.z);
      d.rotation.set(b.tilt + tau * 1.3, a, b.tilt * 0.5 + tau * 0.8);
      d.scale.setScalar(b.s);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.tunnel.embers.material.uniforms.uT.value = tau * 3;
  }

  /* ---------------- chapter 5: the cup ---------------- */
  buildCup() {
    const g = new THREE.Group();
    g.position.set(0, 0, CUP_Z);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(260, 64), new THREE.MeshStandardMaterial({ color: 0xeee4d7, roughness: 0.95 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -13.7;
    g.add(floor);
    const shadowTex = canvasTexture(256, 256, (ctx, w, h) => {
      const gr = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(80,50,25,0.55)');
      gr.addColorStop(0.55, 'rgba(80,50,25,0.22)');
      gr.addColorStop(1, 'rgba(80,50,25,0)');
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, w, h);
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(64, 64), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.set(3, -13.65, 2);
    g.add(shadow);

    const ceramic = new THREE.MeshPhysicalMaterial({ color: 0xf8f3eb, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.1 });
    const cupProfile = [
      [0, -13], [9, -13], [10.3, -12.3], [12.3, -8], [13.8, -2], [14.35, 0.9], [14.05, 1.25], [13.55, 0.95], [13.35, 0], [13.2, -0.6], [0, -0.6],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(cupProfile, 128), ceramic));
    const handle = new THREE.Mesh(new THREE.TorusGeometry(4.3, 1.15, 24, 64, Math.PI * 1.25), ceramic);
    handle.position.set(14.6, -5.6, 0);
    handle.rotation.z = -Math.PI * 0.625;
    g.add(handle);
    const saucerProfile = [[0, -13.75], [20, -13.75], [22.8, -12.7], [22.2, -12.45], [15.5, -12.9], [0, -12.95]].map(([x, y]) => new THREE.Vector2(x, y));
    g.add(new THREE.Mesh(new THREE.LatheGeometry(saucerProfile, 128), ceramic));

    // coffee surface with ripples from the droplet impact
    const surfU = {
      uT: { value: 0 }, uImpact: { value: 999 }, uSunDir: { value: V(0.5, 0.9, 0.4).normalize() },
      uSky: { value: new THREE.Color('#f4ece2') },
    };
    const surface = new THREE.Mesh(
      new THREE.CircleGeometry(13.36, 128),
      new THREE.ShaderMaterial({
        uniforms: surfU,
        vertexShader: /* glsl */ `varying vec3 vW; varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vP = position.xy; gl_Position = projectionMatrix * viewMatrix * w; }`,
        fragmentShader: /* glsl */ `
          uniform float uT, uImpact; uniform vec3 uSunDir, uSky; varying vec3 vW; varying vec2 vP;
          ${GLSL_NOISE}
          float hgt(vec2 p){
            float age = uT - uImpact;
            if (age < 0.0) return 0.0;
            float r = length(p);
            float h = 0.0;
            for (int i = 0; i < 3; i++) {
              float fi = float(i);
              float R = (age - fi * 0.18) * 7.5;
              if (R > 0.0) h += sin((r - R) * 3.2) * exp(-pow((r - R) * 0.55, 2.0)) * exp(-age * 0.55) * (1.0 - fi * 0.25);
            }
            return h;
          }
          void main(){
            vec2 p = vP;
            float r = length(p) / 13.36;
            float n = fbm(p * 0.35 + vec2(uT * 0.05, 0.0));
            vec3 base = mix(vec3(0.028, 0.011, 0.005), vec3(0.1, 0.042, 0.017), smoothstep(0.5, 1.0, r) * 0.9 + (n - 0.5) * 0.3);
            base = mix(base, vec3(0.3, 0.15, 0.065), smoothstep(0.88, 1.0, r) * 0.7);
            float e = 0.08;
            float h0 = hgt(p);
            vec3 N = normalize(vec3(-(hgt(p + vec2(e, 0.0)) - h0) / e * 0.35, 1.0, -(hgt(p + vec2(0.0, e)) - h0) / e * 0.35));
            N = normalize(vec3(N.x, N.y, -N.z));
            vec3 Vd = normalize(cameraPosition - vW);
            float fres = pow(1.0 - max(dot(N, Vd), 0.0), 4.0);
            vec3 H = normalize(normalize(uSunDir) + Vd);
            float spec = pow(max(dot(N, H), 0.0), 180.0) * 1.4;
            vec3 col = base * (0.8 + 0.4 * max(dot(N, normalize(uSunDir)), 0.0)) + uSky * fres * 0.22 + spec;
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      })
    );
    surface.rotation.x = -Math.PI / 2;
    g.add(surface);

    // crown splash: flaring sheet + droplets + central jet
    const coffeeGloss = new THREE.MeshPhysicalMaterial({ color: 0x3b1a0a, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.6 });
    const crownU = { uR: { value: 1 }, uH: { value: 0 } };
    const crownMat = coffeeGloss.clone();
    crownMat.side = THREE.DoubleSide;
    crownMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, crownU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uR, uH;')
        .replace('#include <begin_vertex>', /* glsl */ `
          vec3 transformed = position;
          float v = position.y + 0.5;
          float ang = atan(position.z, position.x);
          float spike = 1.0 + 0.3 * sin(ang * 11.0) * smoothstep(0.55, 1.0, v);
          float rad = uR * (1.0 + 0.38 * v * v) * (1.0 - 0.1 * smoothstep(0.7, 1.0, v));
          transformed.x = cos(ang) * rad;
          transformed.z = sin(ang) * rad;
          transformed.y = uH * v * spike;`);
    };
    const crown = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 14, true), crownMat);
    crown.visible = false;
    g.add(crown);
    const splashDrops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 16, 12), coffeeGloss, 80);
    splashDrops.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    splashDrops.count = 0;
    splashDrops.frustumCulled = false;
    g.add(splashDrops);
    const jet = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1, 8, 20), coffeeGloss);
    jet.visible = false;
    g.add(jet);

    this.cup = { group: g, surfU, crown, crownU, splashDrops, jet };
    g.userData.range = [-400, -700];
    this.scene.add(g);
  }

  updateSplash(age) {
    const { crown, crownU, splashDrops, jet } = this.cup;
    const d = this._d || (this._d = new THREE.Object3D());
    // crown sheet rises then collapses
    const rise = clamp(age / 0.4, 0, 1);
    const fall = smoothstep(0.35, 0.95, age);
    crown.visible = age > 0 && age < 1.0;
    crownU.uR.value = 1.1 + 3.2 * (1 - Math.pow(1 - clamp(age / 0.9, 0, 1), 2));
    crownU.uH.value = 4.2 * Math.sin(rise * Math.PI * 0.5) * (1 - fall);
    let n = 0;
    // droplets flung from crown tips
    const tips = 11;
    for (let i = 0; i < tips * 2; i++) {
      const t0 = 0.22 + (i % 2) * 0.06;
      const a = age - t0;
      if (a <= 0 || a > 1.4) continue;
      const ang = ((i >> 1) / tips) * Math.PI * 2 + (i % 2) * 0.12;
      const vr = 3.4 + hash(i * 3.1) * 2.4;
      const vy = 6.0 + hash(i * 5.7) * 3.0;
      const y = 4.0 + vy * a - 0.5 * 22 * a * a;
      if (y < 0) continue;
      const r = 3.3 + vr * a;
      d.position.set(Math.cos(ang) * r, y, Math.sin(ang) * r);
      const s = 0.28 + hash(i * 7.9) * 0.2;
      d.scale.set(s, s * 1.2, s);
      d.updateMatrix();
      splashDrops.setMatrixAt(n++, d.matrix);
    }
    // Worthington jet + pinched droplet
    const ja = age - 0.55;
    jet.visible = ja > 0 && ja < 1.1;
    if (jet.visible) {
      const h = Math.max(0.01, 6.5 * Math.sin(clamp(ja / 1.1, 0, 1) * Math.PI));
      jet.scale.set(1 - 0.35 * clamp(ja, 0, 1), h, 1 - 0.35 * clamp(ja, 0, 1));
      jet.position.set(0, h * 0.5, 0);
      const pa = ja - 0.35;
      if (pa > 0) {
        const y = 6.2 + 5.2 * pa - 0.5 * 18 * pa * pa;
        if (y > 0) {
          d.position.set(0, y, 0);
          d.scale.set(0.62, 0.7, 0.62);
          d.updateMatrix();
          splashDrops.setMatrixAt(n++, d.matrix);
        }
      }
    }
    splashDrops.count = n;
    splashDrops.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- the hero droplet ---------------- */
  buildDroplet() {
    const u = { uT: { value: 0 }, uAmp: { value: 1 }, uStretch: { value: 1 } };
    const params = this.mobile
      ? { color: 0x3b1a0a, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.2 }
      : { color: 0xffffff, roughness: 0.03, metalness: 0, transmission: 1, thickness: 1.8, ior: 1.34, attenuationColor: new THREE.Color('#6a2c0c'), attenuationDistance: 0.55, clearcoat: 1, clearcoatRoughness: 0.02, specularIntensity: 1, envMapIntensity: 1.6, dispersion: 0.25 };
    const mat = new THREE.MeshPhysicalMaterial(params);
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', /* glsl */ `#include <common>
          uniform float uT, uAmp, uStretch;
          vec3 dropDisp(vec3 p){
            float c = p.y;
            float P2 = 0.5 * (3.0 * c * c - 1.0);
            float P3 = 0.5 * (5.0 * c * c * c - 3.0 * c);
            float n = sin(p.x * 4.0 + uT * 1.3) * sin(p.z * 3.5 - uT * 1.1);
            float r = 1.0 + uAmp * (0.085 * P2 * sin(uT * 5.2) + 0.045 * P3 * sin(uT * 7.9 + 1.0) + 0.018 * n);
            vec3 q = p * r;
            q.y *= uStretch; q.xz /= sqrt(uStretch);
            q.y -= 0.12 * (1.0 - c * c) * (uStretch - 1.0);
            return q;
          }`)
        .replace('#include <beginnormal_vertex>', /* glsl */ `
          vec3 dp = normalize(position);
          vec3 dq0 = dropDisp(dp);
          vec3 dtan = normalize(cross(dp, abs(dp.y) > 0.98 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0)));
          vec3 dbit = normalize(cross(dp, dtan));
          vec3 dq1 = dropDisp(normalize(dp + dtan * 0.02));
          vec3 dq2 = dropDisp(normalize(dp + dbit * 0.02));
          vec3 objectNormal = normalize(cross(dq1 - dq0, dq2 - dq0));
          if (dot(objectNormal, dq0) < 0.0) objectNormal = -objectNormal;
          #ifdef USE_TANGENT
            vec3 objectTangent = vec3(tangent.xyz);
          #endif`)
        .replace('#include <begin_vertex>', 'vec3 transformed = dq0;');
    };
    const drop = new THREE.Mesh(new THREE.SphereGeometry(1, this.mobile ? 64 : 96, this.mobile ? 48 : 72), mat);
    drop.scale.setScalar(0.5);
    drop.renderOrder = 10;
    this.scene.add(drop);

    // micro droplets shed behind
    const micro = new THREE.InstancedMesh(
      new THREE.SphereGeometry(1, 14, 10),
      new THREE.MeshPhysicalMaterial({ color: 0x4a220d, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2 }),
      28
    );
    micro.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    micro.frustumCulled = false;
    this.scene.add(micro);

    // speed streaks (in camera space)
    const streakMat = new THREE.ShaderMaterial({
      uniforms: { uO: { value: 0 }, uCol: { value: new THREE.Color('#ffffff') } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `uniform float uO; uniform vec3 uCol; varying vec2 vUv; void main(){ float a = smoothstep(0.0, 0.5, vUv.y) * smoothstep(1.0, 0.5, vUv.y) * uO; gl_FragColor = vec4(uCol, a); }`,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });
    const streaks = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.008, 1.6), streakMat, 40);
    streaks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    streaks.frustumCulled = false;
    streaks.renderOrder = 20;
    this.camera.add(streaks);
    this.droplet = { mesh: drop, u, micro, streaks, streakMat, anchor: new THREE.Vector3() };
  }

  /* ------------------------------------------------------------ */
  setKeyframes(frames) {
    this.frames = frames;
  }

  setMouse(x, y) {
    this.mouse.set(x, y);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.w = w;
    this.h = h;
    this.portrait = w / h < 0.9;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    const hfov = 88;
    const vfov = (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(hfov) / 2) / this.camera.aspect) * 180) / Math.PI;
    this.camera.fov = clamp(vfov, 48, 74);
    this.camera.updateProjectionMatrix();
  }

  applyAtmos(z) {
    let i = 0;
    while (i < ATMOS.length - 2 && z < ATMOS[i + 1].z) i++;
    const a = ATMOS[i];
    const b = ATMOS[i + 1];
    const t = smoothstep(a.z, b.z, z);
    const at = this.atm;
    at.top.copy(a.top).lerp(b.top, t);
    at.hor.copy(a.hor).lerp(b.hor, t);
    at.bot.copy(a.bot).lerp(b.bot, t);
    at.fog.copy(a.fog).lerp(b.fog, t);
    at.sun.copy(a.sun).lerp(b.sun, t);
    at.hemiS.copy(a.hemiS).lerp(b.hemiS, t);
    at.hemiG.copy(a.hemiG).lerp(b.hemiG, t);
    at.sunDir.copy(a.sunDir).lerp(b.sunDir, t).normalize();
    const f = (k) => lerp(a[k], b[k], t);
    const su = this.sky.material.uniforms;
    su.uTop.value.copy(at.top);
    su.uHor.value.copy(at.hor);
    su.uBot.value.copy(at.bot);
    su.uSunDir.value.copy(at.sunDir);
    su.uSunCol.value.copy(at.sun);
    su.uSunI.value = f('sunI');
    this.scene.fog.color.copy(at.fog);
    this.scene.fog.near = f('near');
    this.scene.fog.far = f('far');
    this.sun.color.copy(at.sun);
    this.sun.intensity = f('sunI');
    this.sun.position.copy(this.camera.position).addScaledVector(at.sunDir, 50);
    this.sun.target.position.copy(this.camera.position);
    this.hemi.color.copy(at.hemiS);
    this.hemi.groundColor.copy(at.hemiG);
    this.hemi.intensity = f('hemiI');
    this.renderer.toneMappingExposure = f('exp');
    this.scene.environmentIntensity = f('env');
    // fire weight for the roast lights
    this.fire = smoothstep(-318, -345, z) * (1 - smoothstep(-405, -432, z));
    for (const m of this.mist) m.material.uniforms.uColor.value.copy(at.fog).lerp(new THREE.Color(1, 1, 1), 0.5);
  }

  /* ---------------- camera rig ---------------- */
  updateCamera(p, time, dt) {
    const kf = this.frames;
    if (kf.length < 2) return;
    let i = 0;
    while (i < kf.length - 2 && p > kf[i + 1].p) i++;
    const a = kf[i];
    const b = kf[i + 1];
    let t = clamp((p - a.p) / Math.max(b.p - a.p, 1e-5), 0, 1);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    t = lerp(t, eased, 0.72);
    const P0 = POSES[kf[Math.max(i - 1, 0)].cam];
    const P1 = POSES[a.cam];
    const P2 = POSES[b.cam];
    const P3 = POSES[kf[Math.min(i + 2, kf.length - 1)].cam];
    const cr = (k, j) => catmull(P0[k][j], P1[k][j], P2[k][j], P3[k][j], t);
    const pos = this._pos || (this._pos = new THREE.Vector3());
    const look = this._look || (this._look = new THREE.Vector3());
    pos.set(cr('pos', 0), cr('pos', 1), cr('pos', 2));
    look.set(cr('look', 0), cr('look', 1), cr('look', 2));
    this.dropOffset = this.dropOffset || new THREE.Vector2();
    this.dropOffset.set(lerp(P1.drop[0], P2.drop[0], t), lerp(P1.drop[1], P2.drop[1], t));
    const bobAmt = lerp(P1.bob, P2.bob, t);

    // intro: rise from above the clouds
    const intro = 1 - this.intro;
    if (intro > 0) {
      pos.y += intro * 30;
      pos.z += intro * 40;
      look.y += intro * 8;
    }

    // walking head-bob: one stride per 40 counted steps, only while moving
    const stride = p * 10000 / 40 * Math.PI;
    const moving = clamp(this.velS / 6, 0, 1);
    const bob = bobAmt * moving * (this.reduced ? 0 : 1);
    pos.y += Math.abs(Math.sin(stride)) * 0.16 * bob;
    pos.x += Math.sin(stride) * 0.07 * bob;

    const cam = this.camera;
    cam.position.copy(pos);
    cam.lookAt(look);
    // mouse look (small yaw/pitch)
    this.mouseS.lerp(this.mouse, 1 - Math.pow(0.02, dt));
    const m = this.reduced ? 0 : 1;
    cam.rotateY(-this.mouseS.x * 0.07 * m);
    cam.rotateX(this.mouseS.y * 0.045 * m);
    cam.rotateZ(Math.sin(stride) * 0.006 * bob);
    cam.updateMatrixWorld();
  }

  updateDroplet(p, tau, dt, velocity) {
    const { mesh, u, micro, streaks, streakMat, anchor } = this.droplet;
    const cam = this.camera;
    const ox = this.portrait ? 0 : this.dropOffset.x;
    const oy = this.portrait ? 1.8 : this.dropOffset.y;
    const dist = this.portrait ? 6.2 : 5.5;
    anchor.set(ox, oy, -dist);
    cam.localToWorld(anchor);

    // final fall into the cup
    const p5 = this.frames.find((f) => f.cam === 5);
    const pImpact = p5 ? p5.p - 0.012 : 0.8;
    const pStart = pImpact - 0.05;
    const impactPt = this._imp || (this._imp = V(0, 0, CUP_Z));
    let visible = true;
    if (p >= pImpact) visible = false;
    else if (p > pStart) {
      const k = (p - pStart) / (pImpact - pStart);
      anchor.lerp(impactPt, k * k);
    }
    mesh.visible = visible;
    mesh.position.copy(anchor);
    this.impactTau = pImpact * TAU_SCALE;

    // wobble lives in scroll-time: frozen when you stop, frantic when you rush
    const speed = clamp(this.velS / 40, 0, 1);
    u.uT.value = tau * 5.5;
    u.uAmp.value = 0.8 + speed * 1.6;
    const targetStretch = 1 + speed * 0.28;
    u.uStretch.value += (targetStretch - u.uStretch.value) * Math.min(dt * 5, 1);
    mesh.rotation.set(0, tau * 0.7, Math.sin(tau * 1.3) * 0.15);

    // shed micro droplets: deterministic in tau (rewinds cleanly)
    const d = this._d2 || (this._d2 = new THREE.Object3D());
    const up = this._up || (this._up = new THREE.Vector3());
    const right = this._right || (this._right = new THREE.Vector3());
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    let n = 0;
    if (visible) {
      const every = 0.16;
      const k1 = Math.floor(tau / every);
      for (let k = k1; k > k1 - 28 && k >= 0; k--) {
        const age = tau - k * every;
        if (age > 3.8) break;
        const hx = (hash(k * 1.37) - 0.5) * 0.55;
        const s = (0.022 + hash(k * 2.91) * 0.05) * (1 - age / 3.8);
        if (s <= 0.003) continue;
        d.position.copy(anchor).addScaledVector(up, 0.35 + age * 0.9).addScaledVector(right, hx * (0.4 + age * 0.35));
        d.scale.setScalar(s);
        d.updateMatrix();
        micro.setMatrixAt(n++, d.matrix);
      }
    }
    micro.count = n;
    micro.instanceMatrix.needsUpdate = true;

    // speed streaks rushing upward past the drop
    streakMat.uniforms.uO.value += ((visible ? clamp((this.velS - 6) / 50, 0, 0.55) : 0) - streakMat.uniforms.uO.value) * Math.min(dt * 6, 1);
    streakMat.uniforms.uCol.value.copy(this.fire > 0.5 ? new THREE.Color('#ffb070') : new THREE.Color('#ffffff'));
    if (streakMat.uniforms.uO.value > 0.01) {
      for (let i = 0; i < 40; i++) {
        const phase = (hash(i * 3.7) + tau * (1.6 + hash(i) * 1.4)) % 1;
        d.position.set(ox + (hash(i * 1.3) - 0.5) * 7, oy - 4 + phase * 8, -dist - 1 - hash(i * 2.1) * 6);
        d.scale.set(1, 0.6 + hash(i * 5.1) * 1.2, 1);
        d.rotation.set(0, 0, 0);
        d.updateMatrix();
        streaks.setMatrixAt(i, d.matrix);
      }
      streaks.instanceMatrix.needsUpdate = true;
      streaks.visible = true;
    } else streaks.visible = false;
  }

  /* ---------------- frame ---------------- */
  update(dt, time, s) {
    const { progress: p, tau, velocity } = s;
    this.velS += (Math.abs(velocity) - this.velS) * Math.min(dt * 4, 1);
    this.updateCamera(p, time, dt);
    const cam = this.camera;
    const cz = cam.position.z;
    this.sky.position.copy(cam.position);
    this.applyAtmos(cz);

    // visibility culling per chapter
    for (const grp of [this.hills, this.cherries.group, this.beds.group, this.tunnel.group, this.cup.group]) {
      const [zStart, zEnd] = grp.userData.range;
      grp.visible = cz < zStart + 170 && cz > zEnd - 10;
    }

    if (this.hills.visible) {
      for (const m of this.mist) {
        m.material.uniforms.uT.value = tau * 4 + m.userData.seed;
        m.rotation.y = Math.atan2(cam.position.x - m.position.x, cam.position.z - m.position.z);
      }
    }
    if (this.cherries.group.visible) this.updateCherries(tau, cam.position);
    if (this.beds.group.visible) {
      const wu = this.beds.waveUniforms;
      wu.uTime.value = tau * 1.5;
      const target = clamp((this.velS - 3) / 30, 0, 1) * 0.9;
      wu.uWave.value += (target - wu.uWave.value) * Math.min(dt * 5, 1);
    }
    if (this.tunnel.group.visible) this.updateTunnel(tau);
    const fl = this.fireLights;
    fl[0].intensity = this.fire * 60;
    fl[1].intensity = this.fire * 30;
    const fwd = this._fwd || (this._fwd = new THREE.Vector3());
    cam.getWorldDirection(fwd);
    fl[0].position.copy(cam.position).addScaledVector(fwd, 7).add(V(1.5, 1.2, 0));
    fl[1].position.copy(cam.position).addScaledVector(fwd, -2).add(V(-1.5, -1, 0));

    this.updateDroplet(p, tau, dt, velocity);
    if (this.cup.group.visible) {
      const age = tau - this.impactTau;
      this.cup.surfU.uT.value = tau;
      this.cup.surfU.uImpact.value = this.impactTau;
      this.cup.surfU.uSky.value.copy(this.atm.hor);
      this.updateSplash(age);
    }

    this.renderer.render(this.scene, cam);
    this.adapt(dt);
  }

  adapt(dt) {
    const ft = this.frameTimes;
    ft.push(dt);
    if (ft.length < 90) return;
    const avg = ft.reduce((x, y) => x + y, 0) / ft.length;
    ft.length = 0;
    if (avg > 1 / 45 && this.dpr > 0.85) {
      this.dpr = Math.max(0.85, this.dpr - 0.2);
      this.renderer.setPixelRatio(this.dpr);
      this.tunnel.embers.material.uniforms.uPR.value = this.dpr;
    } else if (avg < 1 / 58 && this.dpr < this.dprMax) {
      this.dpr = Math.min(this.dprMax, this.dpr + 0.1);
      this.renderer.setPixelRatio(this.dpr);
      this.tunnel.embers.material.uniforms.uPR.value = this.dpr;
    }
  }

  compile() {
    this.updateCamera(0, 0, 0.016);
    this.applyAtmos(this.camera.position.z);
    // make every chapter visible once so all shaders compile up-front
    for (const grp of [this.hills, this.cherries.group, this.beds.group, this.tunnel.group, this.cup.group]) grp.visible = true;
    this.renderer.compile(this.scene, this.camera);
  }
}

function catmull(p0, p1, p2, p3, t) {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}
