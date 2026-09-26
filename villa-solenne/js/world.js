import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/* ============================================================
   Seasons
   ============================================================ */
const S = {
  summer: { skyTop: '#5f8fc6', skyMid: '#efc2a0', skyHor: '#ffd3a0', sun: '#ffbd78', sunI: 4.4, sunDir: [-0.72, 0.36, 0.6], hemiS: '#d6def0', hemiG: '#6e5039', hemiI: 0.55, fog: '#edcdb2', fogNear: 70, fogFar: 280, sea: '#3d8aa2', seaDeep: '#1c5569', lamp: 0.25, exp: 0.86, stars: 0, env: 0.45, plaster: '#f1e6d8', sunSize: 1 },
  winter: { skyTop: '#0d1430', skyMid: '#34386a', skyHor: '#8f7aa8', sun: '#b4c4ff', sunI: 1.0, sunDir: [0.35, 0.55, -0.75], hemiS: '#5a6597', hemiG: '#1a1822', hemiI: 0.75, fog: '#3a3a5e', fogNear: 30, fogFar: 170, sea: '#1a2946', seaDeep: '#0a1327', lamp: 1, exp: 1.2, stars: 1, env: 0.3, plaster: '#dde2ee', sunSize: 0.5 },
};
const toCol = (o) => {
  const r = {};
  for (const k in o) r[k] = typeof o[k] === 'string' ? new THREE.Color(o[k]) : Array.isArray(o[k]) ? V(...o[k]).normalize() : o[k];
  return r;
};
const SUMMER = toCol(S.summer);
const WINTER = toCol(S.winter);

export const POSES = [
  { pos: [0, -1.2, 31], look: [0, 4.2, 0], fov: 52 },       // 0 hero
  { pos: [0, 1.6, 5.2], look: [0, 2.3, -30], fov: 52 },     // 1 threshold
  { pos: [0, 1.65, -11], look: [-2.8, 2.3, -32], fov: 55 }, // 2 lobby
  { pos: [0.6, 1.6, -47], look: [-6, 1.9, -57], fov: 58 },  // 3 suite
  { pos: [0, 1.25, -78], look: [0, 1.0, -108], fov: 56 },   // 4 spa
  { pos: [-1.1, 1.9, -118], look: [2.5, 1.3, -133], fov: 56 }, // 5 dining
  { pos: [0, 3.3, -155], look: [-5, -1.2, -240], fov: 56 }, // 6 terrace
  { pos: [0, 5.2, -158], look: [-6, 0.5, -260], fov: 56 },  // 7 footer
];
const DOORS = [0, -40, -70, -110];

/* ============================================================
   textures
   ============================================================ */
function canvasTex(w, h, draw, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (repeat) t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}
const speckle = (ctx, w, h, n, colors, rmax = 2) => {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    const r = Math.random() * rmax + 0.3;
    ctx.fillRect(Math.random() * w, Math.random() * h, r, r);
  }
};

/* ============================================================
   Architecture helpers
   ============================================================ */
/** wall (width W, height H) with arched notches [{x,w,h}] cut from the bottom */
function archWall(W, H, openings, depth, seg = 20) {
  const s = new THREE.Shape();
  s.moveTo(-W / 2, 0);
  [...openings].sort((a, b) => a.x - b.x).forEach(({ x, w, h }) => {
    s.lineTo(x - w / 2, 0);
    s.lineTo(x - w / 2, h - w / 2);
    s.absarc(x, h - w / 2, w / 2, Math.PI, 0, true);
    s.lineTo(x + w / 2, 0);
  });
  s.lineTo(W / 2, 0);
  s.lineTo(W / 2, H);
  s.lineTo(-W / 2, H);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: seg });
  g.translate(0, 0, -depth / 2);
  // planar UVs in world units for tiling textures
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    if (ay > 0.5) uv.setXY(i, p.getX(i) * 0.25, p.getZ(i) * 0.25);
    else if (ax > 0.5) uv.setXY(i, p.getZ(i) * 0.25, p.getY(i) * 0.25);
    else uv.setXY(i, p.getX(i) * 0.25, p.getY(i) * 0.25);
  }
  return g;
}

function archShapeGeo(w, h, seg = 24) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(-w / 2, h - w / 2);
  s.absarc(0, h - w / 2, w / 2, Math.PI, 0, true);
  s.lineTo(w / 2, 0);
  s.closePath();
  return new THREE.ShapeGeometry(s, seg);
}

/* ============================================================
   World
   ============================================================ */
export class VillaWorld {
  constructor(canvas, { mobile = false, reduced = false } = {}) {
    this.mobile = mobile;
    this.reduced = reduced;
    this.season = 0;
    this.seasonTarget = 0;
    this.frames = [];
    this.intro = 0;
    this.mouse = new THREE.Vector2();
    this.mouseS = new THREE.Vector2();
    this.dprMax = Math.min(window.devicePixelRatio || 1, mobile ? 1.2 : 1.4);
    this.dpr = this.dprMax;
    this.frameTimes = [];
    this.lamps = [];
    this.waters = [];
    this.curtains = [];
    this.col = { ...toCol(S.summer) };
    Object.keys(this.col).forEach((k) => { if (this.col[k] && this.col[k].clone) this.col[k] = this.col[k].clone(); });

    const r = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) <= 1.25, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(this.dpr);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = !mobile;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xf0cfb2, 45, 230);
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.1, 2000);
    const pm = new THREE.PMREMGenerator(r);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();

    this.makeMaterials();
    this.buildSky();
    this.buildSea();
    this.buildLights();
    this.buildExterior();
    this.buildCourtyard();
    this.buildSuite();
    this.buildSpa();
    this.buildDining();
    this.buildTerrace();
    this.buildSnow();
    this.resize();
  }

  /* ---------------- materials ---------------- */
  makeMaterials() {
    const plasterTex = canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 90; i++) {
        const g = ctx.createRadialGradient(Math.random() * w, Math.random() * h, 0, Math.random() * w, Math.random() * h, 60 + Math.random() * 120);
        g.addColorStop(0, `rgba(210,195,175,${Math.random() * 0.12})`);
        g.addColorStop(1, 'rgba(210,195,175,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }
      speckle(ctx, w, h, 9000, ['rgba(160,140,120,0.12)', 'rgba(255,255,255,0.5)'], 1.6);
    });
    const tileTex = canvasTex(512, 512, (ctx, w, h) => {
      const n = 8;
      const s = w / n;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const v = Math.random();
          ctx.fillStyle = `hsl(${16 + v * 8}, ${48 + v * 12}%, ${44 + v * 10}%)`;
          ctx.fillRect(x * s, y * s, s, s);
          speckle(ctx, s, s, 0, []);
        }
      }
      speckle(ctx, w, h, 6000, ['rgba(90,40,20,0.15)', 'rgba(255,220,190,0.12)'], 2);
      ctx.strokeStyle = 'rgba(235,220,200,0.85)';
      ctx.lineWidth = 3;
      for (let i = 0; i <= n; i++) {
        ctx.beginPath(); ctx.moveTo(i * s, 0); ctx.lineTo(i * s, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * s); ctx.lineTo(w, i * s); ctx.stroke();
      }
    }, { repeat: [3, 3] });
    const stoneTex = canvasTex(512, 512, (ctx, w, h) => {
      ctx.fillStyle = '#e6d9c4';
      ctx.fillRect(0, 0, w, h);
      for (let i = 0; i < 70; i++) {
        ctx.strokeStyle = `rgba(${170 + Math.random() * 40},${150 + Math.random() * 30},${120},${0.08 + Math.random() * 0.12})`;
        ctx.lineWidth = 1 + Math.random() * 4;
        ctx.beginPath();
        const y = Math.random() * h;
        ctx.moveTo(0, y);
        for (let x = 0; x <= w; x += 32) ctx.lineTo(x, y + Math.sin(x * 0.02 + i) * 6);
        ctx.stroke();
      }
      speckle(ctx, w, h, 5000, ['rgba(120,100,80,0.18)', 'rgba(255,255,255,0.3)'], 2.2);
      ctx.strokeStyle = 'rgba(160,140,115,0.5)';
      ctx.lineWidth = 2;
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath(); ctx.moveTo(i * w / 4, 0); ctx.lineTo(i * w / 4, h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, i * h / 2); ctx.lineTo(w, i * h / 2); ctx.stroke();
      }
    }, { repeat: [4, 4] });
    const woodTex = canvasTex(512, 512, (ctx, w, h) => {
      const planks = 8;
      for (let i = 0; i < planks; i++) {
        const v = Math.random();
        ctx.fillStyle = `hsl(28, ${35 + v * 10}%, ${50 + v * 12}%)`;
        ctx.fillRect(0, (i * h) / planks, w, h / planks);
        for (let k = 0; k < 40; k++) {
          ctx.strokeStyle = `rgba(90,55,30,${Math.random() * 0.15})`;
          ctx.beginPath();
          const y = (i * h) / planks + Math.random() * (h / planks);
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(w * 0.3, y + 3, w * 0.6, y - 3, w, y + 1);
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(60,35,20,0.45)';
        ctx.fillRect(0, ((i + 1) * h) / planks - 2, w, 2);
      }
    }, { repeat: [2, 6] });
    const leafTex = canvasTex(128, 512, (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      ctx.strokeStyle = '#3d5a2a';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(w / 2, h); ctx.lineTo(w / 2, 0); ctx.stroke();
      for (let y = 10; y < h; y += 9) {
        const len = Math.sin((y / h) * Math.PI) * w * 0.48;
        ctx.strokeStyle = `hsl(${95 + Math.random() * 15}, 38%, ${26 + Math.random() * 10}%)`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(w / 2, y); ctx.lineTo(w / 2 - len, y + 18); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(w / 2, y); ctx.lineTo(w / 2 + len, y + 18); ctx.stroke();
      }
    });
    this.tex = { plasterTex, tileTex, stoneTex, woodTex, leafTex };
    this.M = {
      plaster: new THREE.MeshStandardMaterial({ color: 0xf3eadf, map: plasterTex, roughness: 0.92, metalness: 0 }),
      tile: new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.55, metalness: 0, envMapIntensity: 0.6 }),
      stone: new THREE.MeshStandardMaterial({ map: stoneTex, roughness: 0.7 }),
      wood: new THREE.MeshStandardMaterial({ map: woodTex, roughness: 0.55 }),
      darkWood: new THREE.MeshStandardMaterial({ color: 0x5a3a24, roughness: 0.6 }),
      linen: new THREE.MeshStandardMaterial({ color: 0xf6f1ea, roughness: 0.95 }),
      terra: new THREE.MeshStandardMaterial({ color: 0xb8643f, roughness: 0.8 }),
      green: new THREE.MeshStandardMaterial({ color: 0x3e5a33, roughness: 0.9, flatShading: true }),
      cypress: new THREE.MeshStandardMaterial({ color: 0x2d4a2e, roughness: 0.95, flatShading: true }),
      brass: new THREE.MeshStandardMaterial({ color: 0xc9a060, metalness: 1, roughness: 0.3 }),
      leaf: new THREE.MeshStandardMaterial({ map: leafTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 }),
      trunk: new THREE.MeshStandardMaterial({ color: 0x8a7258, roughness: 1 }),
      window: new THREE.MeshStandardMaterial({ color: 0x2a2a30, emissive: 0xffa54a, emissiveIntensity: 0, roughness: 0.3 }),
    };
    this.M.plaster.userData.base = new THREE.Color(0xf3eadf);
  }

  add(geo, mat, x, y, z, { rx = 0, ry = 0, rz = 0, cast = true, receive = true, parent = this.scene } = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    m.castShadow = cast;
    m.receiveShadow = receive;
    parent.add(m);
    return m;
  }

  /* ---------------- sky, sea, lights ---------------- */
  buildSky() {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTop: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHor: { value: new THREE.Color() },
        uSunDir: { value: V(0, 1, 0) }, uSun: { value: new THREE.Color() }, uStars: { value: 0 }, uSunSize: { value: 1 }, uTime: { value: 0 },
      },
      vertexShader: /* glsl */ `varying vec3 vDir; void main(){ vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uMid, uHor, uSunDir, uSun; uniform float uStars, uSunSize, uTime; varying vec3 vDir;
        float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
        void main(){
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(uHor, uMid, smoothstep(-0.02, 0.18, h));
          col = mix(col, uTop, smoothstep(0.12, 0.75, h));
          if (h < 0.0) col = mix(uHor, uHor * 0.8, smoothstep(0.0, -0.2, h));
          vec3 sd = normalize(uSunDir);
          float s = max(dot(d, sd), 0.0);
          float disc = smoothstep(0.9994 + (1.0 - uSunSize) * 0.0004, 0.9997 + (1.0 - uSunSize) * 0.0002, s);
          col += uSun * (disc * 3.0 + pow(s, 60.0) * 0.5 + pow(s, 8.0) * 0.18);
          // stars
          vec2 sp = vec2(atan(d.z, d.x) * 120.0, d.y * 240.0);
          vec2 cell = floor(sp);
          float st = step(0.985, h21(cell)) * smoothstep(0.05, 0.3, h);
          float tw = 0.6 + 0.4 * sin(uTime * 2.0 + h21(cell + 7.0) * 30.0);
          col += vec3(0.9, 0.95, 1.0) * st * tw * uStars * smoothstep(0.35, 0.0, length(fract(sp) - 0.5));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);
  }

  buildSea() {
    const u = { uT: { value: 0 }, uSea: { value: new THREE.Color() }, uDeep: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uSunDir: { value: V(0, 1, 0) }, uSun: { value: new THREE.Color() }, uFog: { value: new THREE.Color() }, uFogFar: { value: 1500 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */ `varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uT, uFogFar; uniform vec3 uSea, uDeep, uSky, uSunDir, uSun, uFog; varying vec3 vW;
        float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
        float waves(vec2 p){ return vn(p*0.35 + uT*0.12) * 0.5 + vn(p*0.9 - uT*0.2) * 0.3 + vn(p*2.3 + vec2(uT*0.3, -uT*0.2)) * 0.2; }
        void main(){
          vec2 p = vW.xz;
          float e = 0.15;
          float h0 = waves(p);
          vec3 N = normalize(vec3(-(waves(p + vec2(e,0.0)) - h0) / e * 0.35, 1.0, -(waves(p + vec2(0.0,e)) - h0) / e * 0.35));
          vec3 Vd = normalize(cameraPosition - vW);
          float fres = 0.04 + 0.96 * pow(1.0 - max(dot(N, Vd), 0.0), 5.0);
          vec3 col = mix(uDeep, uSea, 0.4 + 0.3 * h0);
          col = mix(col, uSky, fres * 0.85);
          vec3 R = reflect(-Vd, N);
          float sp = pow(max(dot(R, normalize(uSunDir)), 0.0), 220.0);
          col += uSun * sp * 3.5;
          float dist = length(vW.xz - cameraPosition.xz);
          col = mix(col, uFog, smoothstep(uFogFar * 0.25, uFogFar, dist));
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      fog: false,
    });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000, 1, 1), mat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -12, -200);
    this.scene.add(sea);
    this.sea = { mesh: sea, u };
    // the promontory the villa stands on
    const rockMat = new THREE.MeshStandardMaterial({ color: 0xc8b59a, roughness: 1, flatShading: true });
    const rock = new THREE.Mesh(new THREE.CylinderGeometry(60, 90, 12, 18, 3), rockMat);
    const rp = rock.geometry.attributes.position;
    for (let i = 0; i < rp.count; i++) {
      const y = rp.getY(i);
      if (y < 5.9) {
        const k = 1 + (hash(i * 3.1) - 0.5) * 0.12;
        rp.setX(i, rp.getX(i) * k);
        rp.setZ(i, rp.getZ(i) * k);
      }
    }
    rock.geometry.computeVertexNormals();
    rock.scale.set(0.45, 1, 1.35);
    rock.position.set(0, -9.05, -70);
    rock.receiveShadow = true;
    this.scene.add(rock);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = !this.mobile;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -34; sc.right = 34; sc.top = 34; sc.bottom = -34; sc.near = 1; sc.far = 160;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.hemi, this.sun, this.sun.target);
  }

  lamp(x, y, z, { light = false, intensity = 6, dist = 14, color = 0xffb766 } = {}) {
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0x3a2a18, emissive: color, emissiveIntensity: 1.5 });
    const g = new THREE.Group();
    g.position.set(x, y, z);
    const glass = new THREE.Mesh(new THREE.SphereGeometry(0.18, 16, 12), bulbMat);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.16, 0.12, 12), this.M.brass);
    cap.position.y = 0.2;
    g.add(glass, cap);
    this.scene.add(g);
    let pl = null;
    if (light) {
      pl = new THREE.PointLight(color, intensity, dist, 1.8);
      pl.position.set(x, y - 0.1, z);
      this.scene.add(pl);
    }
    this.lamps.push({ mat: bulbMat, pl, base: intensity });
    return g;
  }

  cypress(x, y, z, s = 1) {
    const pts = [];
    for (let i = 0; i <= 12; i++) {
      const t = i / 12;
      pts.push(new THREE.Vector2(Math.sin(Math.pow(t, 0.8) * Math.PI) * 0.9 * (1 - t * 0.35) + 0.02, t * 7));
    }
    const m = this.add(new THREE.LatheGeometry(pts, 9), this.M.cypress, x, y, z);
    m.scale.setScalar(s);
    return m;
  }

  palm(x, y, z, s = 1, lean = 0.2) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    g.scale.setScalar(s);
    g.rotation.y = hash(x + z) * 6.28;
    const curve = new THREE.CatmullRomCurve3([V(0, 0, 0), V(lean * 0.5, 3, 0), V(lean * 1.4, 6, 0), V(lean * 2.6, 8.6, 0)]);
    const trunk = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.22, 8), this.M.trunk);
    trunk.castShadow = true;
    g.add(trunk);
    const top = curve.getPoint(1);
    for (let i = 0; i < 11; i++) {
      const fg = new THREE.PlaneGeometry(0.9, 4.2, 1, 10);
      fg.translate(0, 2.1, 0);
      const p = fg.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const yy = p.getY(k);
        p.setZ(k, -Math.pow(yy / 4.2, 2) * 1.6);
      }
      fg.computeVertexNormals();
      const f = new THREE.Mesh(fg, this.M.leaf);
      f.position.copy(top);
      f.rotation.set(-1.0 - hash(i * 3) * 0.5, (i / 11) * Math.PI * 2, 0, 'YXZ');
      f.castShadow = true;
      g.add(f);
    }
    this.scene.add(g);
    return g;
  }

  /* ---------------- 0: exterior ---------------- */
  buildExterior() {
    const M = this.M;
    // ground on the promontory
    const ground = this.add(new THREE.PlaneGeometry(90, 60), M.stone, 0, -3, 28, { rx: -Math.PI / 2, cast: false });
    ground.material = M.stone.clone();
    ground.material.map = this.tex.stoneTex.clone();
    ground.material.map.repeat.set(14, 10);
    ground.material.map.needsUpdate = true;
    // facade with main door arch
    const facade = this.add(archWall(44, 16, [{ x: 0, w: 4.4, h: 10.2 }], 1.2), M.plaster, 0, -3, 0);
    facade.userData.wall = true;
    // cornice + parapet
    this.add(new THREE.BoxGeometry(45, 0.5, 1.8), M.plaster, 0, 12.8, 0.1);
    this.add(new THREE.BoxGeometry(44, 1.2, 0.8), M.plaster, 0, 13.6, -0.1);
    // arched windows on the facade (glow in winter)
    for (const x of [-15, -9, 9, 15]) {
      for (const y of [1.3, 6.8]) {
        const w = this.add(archShapeGeo(1.9, 3.4), M.window, x, y, 0.62, { cast: false });
        w.userData.window = true;
        this.add(new THREE.BoxGeometry(2.5, 0.16, 0.5), M.plaster, x, y - 0.08, 0.8);
      }
    }
    // podium + stairs
    this.add(new THREE.BoxGeometry(18, 3, 6.2), M.stone, 0, -1.5, 3.1);
    for (let i = 0; i < 6; i++) {
      const h = (i + 1) * 0.5;
      this.add(new THREE.BoxGeometry(8.4, h, 1.0), M.stone, 0, -3 + h / 2, 11.5 - i * 1.0);
    }
    // plinth the whole villa stands on
    this.add(new THREE.BoxGeometry(30, 3, 78), M.stone, 0, -1.5, -33, { cast: false });
    this.add(new THREE.BoxGeometry(30, 3, 59), M.stone, 0, -1.5, -137.5, { cast: false });
    for (const s of [-1, 1]) this.add(new THREE.BoxGeometry(11, 2.7, 36), M.stone, s * 9.5, -1.65, -90, { cast: false });
    // side balustrade walls of the stairs
    for (const s of [-1, 1]) {
      const wall = this.add(new THREE.BoxGeometry(0.6, 1.2, 6.8), M.plaster, s * 4.5, -1.8, 9.0);
      wall.rotation.x = -0.46;
      this.add(new THREE.BoxGeometry(0.9, 1.4, 0.9), M.plaster, s * 4.5, -2.3, 12.2);
      // urns
      const urn = this.add(new THREE.LatheGeometry([[0, 0], [0.35, 0.05], [0.45, 0.4], [0.3, 0.8], [0.42, 0.95], [0, 0.95]].map(([a, b]) => new THREE.Vector2(a, b)), 18), M.terra, s * 4.5, -1.6, 12.2);
      urn.scale.setScalar(1.1);
    }
    this.lamp(-3.2, 5.6, 0.9, { light: true, intensity: 10, dist: 12 });
    this.lamp(3.2, 5.6, 0.9, { light: false });
    // cypresses & palms
    for (const [x, z, s] of [[-7, 6, 1.1], [7, 6, 1.1], [-12, 5, 1.3], [12, 5, 1.3], [-18, 8, 1.2], [18, 8, 1.2]]) this.cypress(x, z > 5.5 && Math.abs(x) < 9 ? 0 : -3, z, s);
    this.palm(-24, -3, 14, 1.2, 0.35);
    this.palm(23, -3, 16, 1.1, -0.3);
    this.palm(-30, -3, 4, 1.35, 0.2);
    this.palm(29, -3, 3, 1.25, -0.25);
  }

  /* ---------------- 1: courtyard with reflecting pool ---------------- */
  buildCourtyard() {
    const M = this.M;
    const floor = this.add(new THREE.PlaneGeometry(20, 40), M.tile, 0, 0, -20, { rx: -Math.PI / 2, cast: false });
    floor.material = M.tile.clone();
    floor.material.map = this.tex.tileTex.clone();
    floor.material.map.repeat.set(5, 10);
    floor.material.map.needsUpdate = true;
    // colonnades (arched walls) on both sides + outer walls & walkway roofs
    const openings = [];
    for (let i = 0; i < 6; i++) openings.push({ x: -15 + i * 6, w: 3.4, h: 5.2 });
    for (const s of [-1, 1]) {
      this.add(archWall(40, 7.2, openings, 0.8), M.plaster, s * 10, 0, -20, { ry: Math.PI / 2 });
      this.add(new THREE.BoxGeometry(0.8, 9.5, 40), M.plaster, s * 14.5, 0 + 4.75, -20);
      this.add(new THREE.BoxGeometry(5, 0.4, 40), M.plaster, s * 12.2, 7.4, -20);
      this.add(new THREE.PlaneGeometry(4.5, 40), M.tile, s * 12.2, 0.01, -20, { rx: -Math.PI / 2, cast: false });
    }
    // end wall with door
    this.add(archWall(29.8, 9.5, [{ x: 0, w: 3.6, h: 5.4 }], 0.8), M.plaster, 0, 0, -40);
    this.add(new THREE.BoxGeometry(30, 0.5, 1.4), M.plaster, 0, 9.4, -40);
    // reflecting pool along the axis
    const coping = new THREE.MeshStandardMaterial({ color: 0xe9dcc6, roughness: 0.6 });
    for (const s of [-1, 1]) {
      this.add(new THREE.BoxGeometry(0.3, 0.3, 31), coping, s * 1.75, 0.15, -21.5);
      this.add(new THREE.BoxGeometry(3.8, 0.3, 0.3), coping, 0, 0.15, -21.5 + s * 15.35);
    }
    const water = this.water(3.2, 30.4, 0x2d6f7e, 0x7fb6bf);
    water.position.set(0, 0.2, -21.5);
    // myrtle hedges
    for (const s of [-1, 1]) {
      const hedge = this.add(new RoundedBoxGeometry(1.2, 1.1, 30, 3, 0.3), M.green, s * 3.4, 0.55, -21.5);
      hedge.material = M.green;
    }
    // lemon trees in terracotta pots at the corners
    for (const [x, z] of [[-6.5, -6], [6.5, -6], [-6.5, -36], [6.5, -36]]) {
      this.add(new THREE.CylinderGeometry(0.75, 0.55, 1.1, 20), M.terra, x, 0.55, z);
      const c = this.add(new THREE.IcosahedronGeometry(1.25, 1), M.green, x, 2.6, z);
      c.scale.set(1, 0.9, 1);
      this.add(new THREE.CylinderGeometry(0.08, 0.1, 1.2, 6), M.trunk, x, 1.6, z);
      for (let i = 0; i < 9; i++) {
        const a = hash(x * 3 + i) * 6.28;
        const yy = 2.1 + hash(z + i) * 1.1;
        this.add(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshStandardMaterial({ color: 0xf2c62c, roughness: 0.5 }), x + Math.cos(a) * 1.15, yy, z + Math.sin(a) * 1.15, { cast: false });
      }
    }
    // hanging lanterns in the colonnades
    for (let i = 0; i < 6; i++) {
      for (const s of [-1, 1]) this.lamp(s * 12.2, 5.8, -5 - i * 6, { light: i === 2 && s === -1, intensity: 9, dist: 16 });
    }
  }

  water(w, d, deep, shallow) {
    const u = { uT: { value: 0 }, uDeep: { value: new THREE.Color(deep) }, uShallow: { value: new THREE.Color(shallow) }, uSky: { value: new THREE.Color() }, uSunDir: { value: V(0, 1, 0) }, uSun: { value: new THREE.Color() } };
    const mat = new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */ `varying vec3 vW; varying vec2 vUv; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
      fragmentShader: /* glsl */ `
        uniform float uT; uniform vec3 uDeep, uShallow, uSky, uSunDir, uSun; varying vec3 vW; varying vec2 vUv;
        float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
        float wv(vec2 p){ return vn(p*1.3 + uT*0.25)*0.6 + vn(p*3.1 - uT*0.35)*0.4; }
        void main(){
          vec2 p = vW.xz;
          float e = 0.05;
          float h0 = wv(p);
          vec3 N = normalize(vec3(-(wv(p+vec2(e,0.0))-h0)/e*0.06, 1.0, -(wv(p+vec2(0.0,e))-h0)/e*0.06));
          vec3 Vd = normalize(cameraPosition - vW);
          float fres = 0.05 + 0.95 * pow(1.0 - max(dot(N, Vd), 0.0), 4.0);
          float caust = pow(vn(p*2.2 + uT*0.4) * vn(p*2.7 - uT*0.3), 1.5) * 1.4;
          vec3 col = mix(uDeep, uShallow, 0.35 + caust * 0.5);
          col = mix(col, uSky, fres * 0.9);
          vec3 R = reflect(-Vd, N);
          col += uSun * pow(max(dot(R, normalize(uSunDir)), 0.0), 300.0) * 3.0;
          float edge = smoothstep(0.0, 0.03, vUv.x) * smoothstep(1.0, 0.97, vUv.x) * smoothstep(0.0, 0.01, vUv.y) * smoothstep(1.0, 0.99, vUv.y);
          col *= 0.7 + 0.3 * edge;
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d, 1, 1), mat);
    m.rotation.x = -Math.PI / 2;
    m.receiveShadow = false;
    this.scene.add(m);
    this.waters.push(u);
    return m;
  }

  /* ---------------- 2: suite ---------------- */
  buildSuite() {
    const M = this.M;
    const floor = this.add(new THREE.PlaneGeometry(16, 30), M.wood, 0, 0.001, -55, { rx: -Math.PI / 2, cast: false });
    floor.material = M.wood;
    // left wall with a floor-to-arch window to the balcony
    this.add(archWall(30, 5.6, [{ x: 0, w: 5.2, h: 5.0 }], 0.6), M.plaster, -8, 0, -55, { ry: Math.PI / 2 });
    this.add(new THREE.BoxGeometry(0.6, 5.6, 30), M.plaster, 8, 2.8, -55);
    this.add(new THREE.BoxGeometry(16.6, 0.4, 30), M.plaster, 0, 5.8, -55, { receive: true });
    this.add(archWall(16.6, 6, [{ x: 0, w: 3.6, h: 5.0 }], 0.6), M.plaster, 0, 0, -70);
    // balcony outside the window
    this.add(new THREE.BoxGeometry(4, 0.3, 7), M.stone, -10.2, -0.15, -55);
    for (let i = 0; i < 12; i++) this.add(new THREE.CylinderGeometry(0.07, 0.09, 1, 8), M.plaster, -12.0, 0.5, -58.2 + i * 0.58);
    this.add(new THREE.BoxGeometry(0.3, 0.12, 7), M.plaster, -12.0, 1.05, -55);
    // bed
    this.add(new THREE.BoxGeometry(3.8, 0.45, 3.2), M.darkWood, 5.6, 0.225, -55);
    this.add(new RoundedBoxGeometry(3.7, 0.5, 3.1, 4, 0.18), M.linen, 5.6, 0.7, -55);
    this.add(new RoundedBoxGeometry(1.5, 0.12, 3.14, 3, 0.05), new THREE.MeshStandardMaterial({ color: 0xb8643f, roughness: 0.9 }), 4.3, 0.98, -55);
    for (const z of [-55.8, -54.2]) this.add(new RoundedBoxGeometry(0.5, 0.35, 1.3, 4, 0.16), M.linen, 7.1, 1.1, z, { rz: 0.35 });
    this.add(new RoundedBoxGeometry(0.2, 1.8, 3.6, 3, 0.08), M.darkWood, 7.7, 1.2, -55);
    // nightstands + lamps
    for (const z of [-57.4, -52.6]) {
      this.add(new THREE.BoxGeometry(0.8, 0.6, 0.7), M.darkWood, 7.3, 0.3, z);
      this.lamp(7.3, 1.25, z, { light: z < -55, intensity: 7, dist: 10, color: 0xffb060 });
    }
    // rug, armchair, art
    this.add(new THREE.PlaneGeometry(4.6, 3.6), new THREE.MeshStandardMaterial({ color: 0xd9c7ae, roughness: 1 }), 2.6, 0.01, -55, { rx: -Math.PI / 2, cast: false });
    this.add(new RoundedBoxGeometry(1.2, 0.9, 1.2, 4, 0.2), new THREE.MeshStandardMaterial({ color: 0x8a9a7b, roughness: 0.9 }), -4.5, 0.45, -63);
    const art = this.add(new THREE.PlaneGeometry(2.4, 1.6), new THREE.MeshStandardMaterial({ map: canvasTex(256, 170, (ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#f2c9a0');
      g.addColorStop(0.55, '#e7a57e');
      g.addColorStop(0.56, '#3d7c93');
      g.addColorStop(1, '#23566b');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#fff3dc';
      ctx.beginPath();
      ctx.arc(w * 0.62, h * 0.5, 16, Math.PI, 0);
      ctx.fill();
    }), roughness: 0.6 }), 7.68, 2.9, -55, { ry: -Math.PI / 2, cast: false });
    this.add(new THREE.BoxGeometry(0.06, 1.72, 2.52), M.brass, 7.72, 2.9, -55);
    // curtains that breathe in the sea breeze
    const cu = { uT: { value: 0 } };
    const curtainMat = new THREE.MeshStandardMaterial({ color: 0xfbf7f0, roughness: 1, transparent: true, opacity: 0.78, side: THREE.DoubleSide });
    curtainMat.onBeforeCompile = (sh) => {
      sh.uniforms.uT = cu.uT;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uT;')
        .replace('#include <begin_vertex>', `vec3 transformed = position;
          float hang = (2.6 - position.y) / 5.2;
          transformed.z += sin(position.x * 5.0 + uT * 1.6) * 0.06 + sin(position.x * 2.0 - uT * 0.9 + position.y) * 0.18 * hang * hang;
          transformed.x += sin(uT * 0.7 + position.y * 0.8) * 0.12 * hang * hang;`);
    };
    for (const s of [-1, 1]) {
      const c = this.add(new THREE.PlaneGeometry(1.4, 5.2, 24, 24), curtainMat, -7.55, 2.6, -55 + s * 2.9, { ry: Math.PI / 2, cast: false });
      c.renderOrder = 3;
    }
    this.curtains.push(cu);
  }

  /* ---------------- 3: spa ---------------- */
  buildSpa() {
    const M = this.M;
    // travertine deck with pool cut-out (4 slabs)
    const deck = M.stone;
    this.add(new THREE.BoxGeometry(18, 0.3, 4), deck, 0, -0.15, -72);
    this.add(new THREE.BoxGeometry(18, 0.3, 4), deck, 0, -0.15, -108);
    this.add(new THREE.BoxGeometry(5, 0.3, 32), deck, -6.5, -0.15, -90);
    this.add(new THREE.BoxGeometry(5, 0.3, 32), deck, 6.5, -0.15, -90);
    // pool basin
    const basin = new THREE.MeshStandardMaterial({ color: 0x8fc9cf, roughness: 0.4 });
    this.add(new THREE.BoxGeometry(8, 0.2, 32), basin, 0, -1.6, -90, { cast: false });
    const w = this.water(8, 32, 0x1f7f93, 0x7fd0d6);
    w.position.set(0, -0.18, -90);
    // open arcades both sides (sea beyond)
    const openings = [];
    for (let i = 0; i < 6; i++) openings.push({ x: -15 + i * 6, w: 4.2, h: 6.2 });
    for (const s of [-1, 1]) {
      this.add(archWall(40, 8, openings, 0.8), M.plaster, s * 9.4, -0.3, -90, { ry: Math.PI / 2 });
      // loungers
      for (let i = 0; i < 3; i++) {
        const z = -80 - i * 9;
        this.add(new RoundedBoxGeometry(0.9, 0.2, 2.2, 3, 0.06), M.linen, s * 6.4, 0.45, z);
        this.add(new RoundedBoxGeometry(0.9, 0.2, 0.9, 3, 0.06), M.linen, s * 6.4, 0.75, z + 1.2, { rx: 0.6 });
        this.add(new THREE.BoxGeometry(0.8, 0.35, 2.0), M.darkWood, s * 6.4, 0.18, z);
        // parasol
        this.add(new THREE.CylinderGeometry(0.04, 0.04, 2.6, 6), M.darkWood, s * 7.6, 1.3, z - 1);
        this.add(new THREE.ConeGeometry(1.4, 0.45, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xf2e6d4, roughness: 0.9, side: THREE.DoubleSide }), s * 7.6, 2.55, z - 1);
      }
    }
    this.add(archWall(18.8, 8, [{ x: 0, w: 3.6, h: 5.2 }], 0.8), M.plaster, 0, -0.3, -110);
    this.lamp(-2.6, 4.2, -109.2, { light: true, intensity: 8, dist: 12 });
    this.lamp(2.6, 4.2, -109.2);
  }

  /* ---------------- 4: dining pergola ---------------- */
  buildDining() {
    const M = this.M;
    const floor = this.add(new THREE.PlaneGeometry(16, 30), M.tile, 0, 0.001, -125, { rx: -Math.PI / 2, cast: false });
    floor.material = M.tile.clone();
    floor.material.map = this.tex.tileTex.clone();
    floor.material.map.repeat.set(4, 7);
    floor.material.map.needsUpdate = true;
    for (let i = 0; i < 6; i++) {
      for (const s of [-1, 1]) this.add(new THREE.BoxGeometry(0.35, 4.2, 0.35), M.plaster, s * 6, 2.1, -113 - i * 5);
      this.add(new THREE.BoxGeometry(12.8, 0.25, 0.3), M.darkWood, 0, 4.3, -113 - i * 5);
    }
    for (const s of [-1, 1]) this.add(new THREE.BoxGeometry(0.3, 0.3, 27), M.darkWood, s * 6, 4.1, -125.5);
    // vine leaves on top
    const vine = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.34, 1), new THREE.MeshStandardMaterial({ color: 0x4a6a35, roughness: 0.85, flatShading: true }), 460);
    const d = new THREE.Object3D();
    for (let i = 0; i < 460; i++) {
      const edge = hash(i * 7) < 0.25;
      d.position.set((hash(i) - 0.5) * 12.6, edge ? 3.2 + hash(i * 2) * 1.2 : 4.45 + hash(i * 2) * 0.35, -112 - hash(i * 3) * 27);
      if (edge) d.position.x = Math.sign(d.position.x || 1) * (5.9 + hash(i * 8) * 0.4);
      d.scale.set(0.5 + hash(i * 4) * 0.8, 0.35 + hash(i * 9) * 0.4, 0.5 + hash(i * 4) * 0.8);
      d.rotation.set(hash(i * 5) * 3, hash(i * 6) * 3, 0);
      d.updateMatrix();
      vine.setMatrixAt(i, d.matrix);
    }
    vine.castShadow = true;
    this.scene.add(vine);
    // string lights (catenaries)
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3a2a18, emissive: 0xffc27a, emissiveIntensity: 2 }), 6 * 22);
    let bi = 0;
    for (let r = 0; r < 6; r++) {
      const z = -114.5 - r * 4.6;
      for (let k = 0; k < 22; k++) {
        const t = k / 21;
        const x = lerp(-5.8, 5.8, t);
        const y = 4.05 - Math.sin(t * Math.PI) * 0.7;
        d.position.set(x, y, z);
        d.scale.setScalar(1);
        d.rotation.set(0, 0, 0);
        d.updateMatrix();
        bulbs.setMatrixAt(bi++, d.matrix);
      }
    }
    this.scene.add(bulbs);
    this.stringLights = bulbs.material;
    const pl1 = new THREE.PointLight(0xffb870, 8, 16, 1.6);
    pl1.position.set(0, 3.3, -118);
    const pl2 = new THREE.PointLight(0xffb870, 8, 16, 1.6);
    pl2.position.set(0, 3.3, -131);
    this.scene.add(pl1, pl2);
    this.lamps.push({ mat: null, pl: pl1, base: 8 }, { mat: null, pl: pl2, base: 8 });
    // long table + chairs + candles
    this.add(new THREE.BoxGeometry(1.6, 0.08, 14), M.linen, 0, 1.0, -125);
    this.add(new THREE.BoxGeometry(1.2, 0.95, 13.4), M.darkWood, 0, 0.5, -125).scale.set(0.9, 1, 1);
    const chairGeo = new THREE.BoxGeometry(0.6, 0.08, 0.6);
    const chairBack = new THREE.BoxGeometry(0.6, 0.8, 0.08);
    for (let i = 0; i < 7; i++) {
      for (const s of [-1, 1]) {
        const z = -119 - i * 1.9;
        this.add(chairGeo, M.darkWood, s * 1.3, 0.55, z);
        this.add(chairBack, M.darkWood, s * 1.62, 0.95, z, { ry: Math.PI / 2 });
      }
      const candleZ = -119 - i * 1.9 + 0.95;
      this.add(new THREE.CylinderGeometry(0.05, 0.05, 0.28, 10), M.linen, 0, 1.18, candleZ, { cast: false });
      this.add(new THREE.SphereGeometry(0.035, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffd08a }), 0, 1.36, candleZ, { cast: false });
    }
  }

  /* ---------------- 5: terrace over the sea ---------------- */
  buildTerrace() {
    const M = this.M;
    this.add(new THREE.BoxGeometry(22, 0.4, 30), M.stone, 0, -0.2, -152);
    const baluster = new THREE.LatheGeometry([[0, 0], [0.12, 0], [0.12, 0.1], [0.07, 0.25], [0.12, 0.55], [0.06, 0.8], [0.1, 0.9], [0, 0.9]].map(([a, b]) => new THREE.Vector2(a, b)), 12);
    const inst = new THREE.InstancedMesh(baluster, M.plaster, 120);
    const d = new THREE.Object3D();
    let n = 0;
    for (let i = 0; i < 44; i++) {
      d.position.set(-10.5 + i * 0.5, 0, -166.5);
      d.updateMatrix();
      inst.setMatrixAt(n++, d.matrix);
    }
    for (const s of [-1, 1]) {
      for (let i = 0; i < 38; i++) {
        d.position.set(s * 10.8, 0, -148 - i * 0.5);
        d.updateMatrix();
        inst.setMatrixAt(n++, d.matrix);
      }
    }
    inst.count = n;
    inst.castShadow = true;
    this.scene.add(inst);
    this.add(new THREE.BoxGeometry(22, 0.16, 0.36), M.plaster, 0, 0.98, -166.5);
    for (const s of [-1, 1]) this.add(new THREE.BoxGeometry(0.36, 0.16, 19), M.plaster, s * 10.8, 0.98, -157.5);
    // plants & furniture
    this.cypress(-9.4, 0, -164.5, 0.9);
    this.cypress(9.4, 0, -164.5, 0.9);
    for (const [x, z] of [[-6, -163], [6, -163]]) {
      this.add(new THREE.CylinderGeometry(0.6, 0.45, 0.8, 18), M.terra, x, 0.4, z);
      this.add(new THREE.IcosahedronGeometry(0.8, 1), M.green, x, 1.3, z);
    }
    for (const x of [-2.2, 2.2]) {
      this.add(new RoundedBoxGeometry(1.6, 0.4, 0.8, 3, 0.12), M.linen, x, 0.45, -160);
      this.add(new RoundedBoxGeometry(1.6, 0.7, 0.2, 3, 0.08), M.linen, x, 0.8, -159.6);
    }
    this.add(new THREE.CylinderGeometry(0.5, 0.5, 0.06, 24), M.brass, 0, 0.6, -160.8);
    this.add(new THREE.CylinderGeometry(0.06, 0.1, 0.6, 12), M.brass, 0, 0.3, -160.8);
    this.lamp(-10.8, 1.35, -166.5, { light: true, intensity: 6, dist: 10 });
    this.lamp(10.8, 1.35, -166.5);
  }

  /* ---------------- winter snow ---------------- */
  buildSnow() {
    const n = this.mobile ? 1200 : 2600;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (hash(i) - 0.5) * 40;
      pos[i * 3 + 1] = hash(i * 2.3) * 20;
      pos[i * 3 + 2] = (hash(i * 3.7) - 0.5) * 40;
      seed[i] = hash(i * 5.1);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uT: { value: 0 }, uCam: { value: new THREE.Vector3() }, uA: { value: 0 }, uPR: { value: this.dpr } },
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uT, uPR; uniform vec3 uCam; varying float vA;
        void main(){
          vec3 p = position;
          p.y = mod(p.y - uT * (0.8 + aSeed * 0.9), 20.0) - 6.0;
          p.x += sin(uT * 0.6 + aSeed * 30.0) * 0.8;
          p.z += cos(uT * 0.5 + aSeed * 20.0) * 0.8;
          p.xz = uCam.xz + mod(p.xz - uCam.xz + 20.0, 40.0) - 20.0;
          p.y += uCam.y;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = min((2.0 + aSeed * 3.5) * uPR * (10.0 / -mv.z), 14.0 * uPR);
          vA = smoothstep(30.0, 3.0, -mv.z) * smoothstep(0.8, 2.5, -mv.z);
        }`,
      fragmentShader: /* glsl */ `uniform float uA; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.1, d) * vA * uA; gl_FragColor = vec4(vec3(1.0), a); }`,
      transparent: true,
      depthWrite: false,
    });
    this.snow = new THREE.Points(g, mat);
    this.snow.frustumCulled = false;
    this.scene.add(this.snow);
  }

  /* ------------------------------------------------------------ */
  setKeyframes(f) { this.frames = f; }
  setMouse(x, y) { this.mouse.set(x, y); }
  setSeason(winter) { this.seasonTarget = winter ? 1 : 0; }

  resize() {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.portrait = this.w / this.h < 0.9;
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
  }

  applySeason(t) {
    const c = this.col;
    for (const k in SUMMER) {
      const a = SUMMER[k];
      const b = WINTER[k];
      if (a && a.isColor) c[k].copy(a).lerp(b, t);
      else if (a && a.isVector3) c[k].copy(a).lerp(b, t).normalize();
      else c[k] = lerp(a, b, t);
    }
    const su = this.sky.material.uniforms;
    su.uTop.value.copy(c.skyTop);
    su.uMid.value.copy(c.skyMid);
    su.uHor.value.copy(c.skyHor);
    su.uSunDir.value.copy(c.sunDir);
    su.uSun.value.copy(c.sun);
    su.uStars.value = c.stars;
    su.uSunSize.value = c.sunSize;
    this.scene.fog.color.copy(c.fog);
    this.scene.fog.near = c.fogNear;
    this.scene.fog.far = c.fogFar;
    this.sun.color.copy(c.sun);
    this.sun.intensity = c.sunI;
    this.hemi.color.copy(c.hemiS);
    this.hemi.groundColor.copy(c.hemiG);
    this.hemi.intensity = c.hemiI;
    this.renderer.toneMappingExposure = c.exp;
    this.scene.environmentIntensity = c.env;
    this.M.plaster.color.copy(c.plaster);
    const lampK = lerp(0.35, 1.6, c.lamp);
    for (const l of this.lamps) {
      if (l.mat) l.mat.emissiveIntensity = lerp(1.2, 3.2, c.lamp);
      if (l.pl) l.pl.intensity = l.base * lampK;
    }
    this.stringLights.emissiveIntensity = lerp(1.6, 3.4, c.lamp);
    this.M.window.emissiveIntensity = lerp(0.0, 1.4, c.lamp);
    const sea = this.sea.u;
    sea.uSea.value.copy(c.sea);
    sea.uDeep.value.copy(c.seaDeep);
    sea.uSky.value.copy(c.skyHor).lerp(c.skyMid, 0.4);
    sea.uSunDir.value.copy(c.sunDir);
    sea.uSun.value.copy(c.sun);
    sea.uFog.value.copy(c.skyHor);
    for (const w of this.waters) {
      w.uSky.value.copy(c.skyMid).lerp(c.skyTop, 0.3);
      w.uSunDir.value.copy(c.sunDir);
      w.uSun.value.copy(c.sun);
    }
    this.snow.material.uniforms.uA.value = smoothstep(0.4, 1, t) * 0.9;
  }

  updateCamera(p, dt, time) {
    const kf = this.frames;
    if (kf.length < 2) return;
    let i = 0;
    while (i < kf.length - 2 && p > kf[i + 1].p) i++;
    const a = kf[i];
    const b = kf[i + 1];
    let t = clamp((p - a.p) / Math.max(b.p - a.p, 1e-5), 0, 1);
    t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const P0 = POSES[kf[Math.max(i - 1, 0)].cam];
    const P1 = POSES[a.cam];
    const P2 = POSES[b.cam];
    const P3 = POSES[kf[Math.min(i + 2, kf.length - 1)].cam];
    const cr = (k, j) => catmull(P0[k][j], P1[k][j], P2[k][j], P3[k][j], t);
    const pos = this._p || (this._p = new THREE.Vector3());
    const look = this._l || (this._l = new THREE.Vector3());
    pos.set(cr('pos', 0), cr('pos', 1), cr('pos', 2));
    look.set(cr('look', 0), cr('look', 1), cr('look', 2));
    let fov = lerp(P1.fov, P2.fov, t);
    // "rush through the doorway": FOV swells when crossing an arch
    let rush = 0;
    for (const dz of DOORS) rush = Math.max(rush, Math.exp(-Math.pow(pos.z - dz, 2) / 5));
    fov += rush * 11;
    if (this.portrait) fov = Math.min(fov * 1.35, 82);
    const intro = 1 - this.intro;
    if (intro > 0) {
      pos.y += intro * 6;
      pos.z += intro * 22;
      look.y += intro * 4;
    }
    this.mouseS.lerp(this.mouse, 1 - Math.pow(0.03, dt));
    const cam = this.camera;
    cam.position.copy(pos);
    cam.lookAt(look);
    const m = this.reduced ? 0 : 1;
    cam.rotateY(-this.mouseS.x * 0.09 * m);
    cam.rotateX(this.mouseS.y * 0.05 * m);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
    this.rush = rush;
  }

  update(dt, time, s) {
    this.season += (this.seasonTarget - this.season) * Math.min(dt * 1.6, 1);
    if (Math.abs(this.season - this.seasonTarget) < 0.001) this.season = this.seasonTarget;
    if (this._lastSeason !== this.season) {
      this.applySeason(this.season);
      this._lastSeason = this.season;
    }
    this.updateCamera(s.progress, dt, time);
    const cam = this.camera;
    this.sky.position.copy(cam.position);
    // shadows follow the camera
    const fwd = this._f || (this._f = new THREE.Vector3());
    cam.getWorldDirection(fwd);
    const target = this._tg || (this._tg = new THREE.Vector3());
    target.copy(cam.position).addScaledVector(fwd, 14);
    target.y = 0;
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.col.sunDir, 70);
    this.sea.u.uT.value = time;
    for (const w of this.waters) w.uT.value = time;
    for (const c of this.curtains) c.uT.value = time;
    this.sky.material.uniforms.uTime.value = time;
    const su = this.snow.material.uniforms;
    su.uT.value = time;
    su.uCam.value.copy(cam.position);
    this.snow.visible = su.uA.value > 0.01;
    this.renderer.render(this.scene, cam);
    this.adapt(dt);
  }

  adapt(dt) {
    const ft = this.frameTimes;
    ft.push(dt);
    if (ft.length < 90) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    ft.length = 0;
    if (avg > 1 / 45 && this.dpr > 0.9) {
      this.dpr = Math.max(0.9, this.dpr - 0.2);
      this.renderer.setPixelRatio(this.dpr);
    } else if (avg < 1 / 58 && this.dpr < this.dprMax) {
      this.dpr = Math.min(this.dprMax, this.dpr + 0.1);
      this.renderer.setPixelRatio(this.dpr);
    }
  }

  compile() {
    this.applySeason(0);
    this.updateCamera(0, 0.016, 0);
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
