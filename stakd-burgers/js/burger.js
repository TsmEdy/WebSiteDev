import * as THREE from 'three';

/* ==========================================================
   STAKD — premium procedural burger
   Food-photography look: dark studio, warm key, ember rim,
   textured crust / glazed brioche / melted cheddar, embers
   and smoke. Every layer rides a near-critically damped
   spring so it moves with weight instead of bounce.
   ========================================================== */

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

/* ---------------- seeded gradient noise ---------------- */
function makeNoise(seed = 3) {
  const perm = new Uint8Array(512);
  const p = Array.from({ length: 256 }, (_, i) => i);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const GX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071];
  const GY = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const n = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const X = xi & 255;
    const Y = yi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const g = (h, dx, dy) => GX[h & 7] * dx + GY[h & 7] * dy;
    const a = g(perm[perm[X] + Y], xf, yf);
    const b = g(perm[perm[X + 1] + Y], xf - 1, yf);
    const c = g(perm[perm[X] + Y + 1], xf, yf - 1);
    const d = g(perm[perm[X + 1] + Y + 1], xf - 1, yf - 1);
    const u = fade(xf);
    const v = fade(yf);
    return (a + (b - a) * u) + ((c + (d - c) * u) - (a + (b - a) * u)) * v;
  };
  n.fbm = (x, y, o = 4) => {
    let amp = 0.5;
    let f = 1;
    let sum = 0;
    for (let i = 0; i < o; i++) {
      sum += amp * n(x * f, y * f);
      f *= 2.03;
      amp *= 0.5;
    }
    return sum;
  };
  return n;
}
const N = makeNoise(11);

/* ---------------- canvas texture helpers ---------------- */
function pixelTex(w, h, fn, { srgb = true, repeat = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const out = [0, 0, 0, 255];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      fn(x / w, y / h, out);
      const i = (y * w + x) * 4;
      img.data[i] = out[0];
      img.data[i + 1] = out[1];
      img.data[i + 2] = out[2];
      img.data[i + 3] = out[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function drawTex(size, draw, srgb = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}
/** tangent-space normal map from a height function h(u, v) in 0..1 space */
function normalTex(w, h, height, strength = 2) {
  const H = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) H[y * w + x] = height(x / w, y / h);
  return pixelTex(w, h, (u, v, o) => {
    const x = Math.round(u * w);
    const y = Math.round(v * h);
    const at = (xx, yy) => H[((yy + h) % h) * w + ((xx + w) % w)];
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
    const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const len = Math.hypot(dx, dy, 1);
    o[0] = ((-dx / len) * 0.5 + 0.5) * 255;
    o[1] = ((dy / len) * 0.5 + 0.5) * 255;
    o[2] = ((1 / len) * 0.5 + 0.5) * 255;
    o[3] = 255;
  }, { srgb: false });
}
const hex = (h) => {
  const c = new THREE.Color(h);
  return [c.r, c.g, c.b].map((v) => Math.pow(v, 1 / 2.2) * 255); // back to sRGB bytes
};
const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
function ramp(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) return mixc(stops[i - 1][1], stops[i][1], (t - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
  }
  return stops[stops.length - 1][1];
}

/* ---------------- radial surfaces (leaf, sauce) ---------------- */
function radialSurface(rings, segs, a0, a1, fn, colorFn) {
  const pos = [];
  const col = [];
  const uv = [];
  const idx = [];
  const c = new THREE.Color();
  for (let i = 0; i <= rings; i++) {
    const r01 = i / rings;
    for (let j = 0; j <= segs; j++) {
      const th = lerp(a0, a1, j / segs);
      const { r, y } = fn(r01, th, j / segs);
      pos.push(Math.cos(th) * r, y, Math.sin(th) * r);
      colorFn(r01, th, c, j / segs);
      col.push(c.r, c.g, c.b);
      uv.push(Math.cos(th) * r * 0.25 + 0.5, Math.sin(th) * r * 0.25 + 0.5);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segs; j++) {
      const a = i * (segs + 1) + j;
      const b = a + segs + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------------- recipes & labels ---------------- */
export const RECIPES = [
  { name: 'The Classic', layers: ['bunBottom', 'sauce', 'patty', 'cheese', 'onion', 'pickles', 'tomato', 'lettuce', 'bunTop'], price: '€9.50', kcal: '640 kcal', desc: 'One smashed patty, aged cheddar, house pickles, red onion, heirloom tomato, iceberg, STAKD sauce.' },
  { name: 'Double Trouble', layers: ['bunBottom', 'sauce', 'patty', 'cheese', 'patty2', 'cheese2', 'bacon', 'onion', 'bunTop'], price: '€12.90', kcal: '980 kcal', desc: 'Two smashed patties, double cheddar, beech-smoked streaky bacon, pickled onion.' },
  { name: 'Hot Honey Chicken', layers: ['bunBottom', 'sauce', 'lettuce', 'chicken', 'honey', 'jalapenos', 'pickles', 'bunTop'], price: '€11.50', kcal: '720 kcal', desc: 'Buttermilk-brined thigh, chili honey, fresh jalapeños, house pickles, cold iceberg.' },
  { name: 'The Green', layers: ['bunBottom', 'sauce', 'veggie', 'cheese', 'tomato', 'lettuce', 'onion', 'bunTop'], price: '€10.90', kcal: '560 kcal', desc: 'Smashed black-bean and charred-corn patty, cheddar, tomato, iceberg, red onion.' },
];

export const LABELS = {
  bunTop: ['Brioche', 'baked at 5 am, butter-glazed'],
  lettuce: ['Iceberg', 'ice-cold, torn by hand'],
  tomato: ['Heirloom tomato', 'salted at the last second'],
  pickles: ['House pickles', '72-hour brine'],
  onion: ['Red onion', 'quick-pickled, sharp'],
  cheese: ['Aged cheddar', 'melted under a cloche'],
  patty: ['Dry-aged chuck', '90 g, smashed at 260 °C'],
  sauce: ['STAKD sauce', 'the recipe stays in the kitchen'],
  bunBottom: ['Heel', 'toasted in beef fat'],
};

/* ==========================================================
   Scene
   ========================================================== */
export class BurgerScene {
  constructor(canvas, { mobile = false, reduced = false } = {}) {
    this.mobile = mobile;
    this.reduced = reduced;
    this.pose = { x: 0.1, y: -0.02, s: 1, rotY: 0.4, tilt: 0.12, floaters: 1, shadow: 1, explode: 0, spin: 1 };
    this.explode = 0;
    this.recipe = 0;
    this.mouse = new THREE.Vector2();
    this.mouseS = new THREE.Vector2();
    this.velS = 0;
    this.spinAcc = 0;
    const dpr = window.devicePixelRatio || 1;
    this.dprMax = Math.min(dpr, mobile ? 1.25 : 1.5);
    this.dpr = this.dprMax;
    this.frameTimes = [];

    const r = new THREE.WebGLRenderer({ canvas, antialias: dpr <= 1.25, alpha: true, powerPreference: 'high-performance', stencil: false });
    r.setPixelRatio(this.dpr);
    r.setClearColor(0x000000, 0);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.12;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
    this.camera.position.set(0, 1.1, 12.5);
    this.camera.lookAt(0, 0.15, 0);
    this.scene.environment = this.studioEnv();
    this.scene.environmentIntensity = 0.85;

    this.root = new THREE.Group();
    this.burger = new THREE.Group();
    this.root.add(this.burger);
    this.scene.add(this.root);

    this.buildLights();
    this.buildLayers();
    this.buildGround();
    this.buildAmbience();
    this.resize();
    this.setRecipe(0, true);
  }

  /* dark studio with warm softboxes — gives the glaze and cheese their highlights */
  studioEnv() {
    const env = new THREE.Scene();
    env.background = new THREE.Color(0x040302);
    const geo = new THREE.PlaneGeometry(1, 1);
    const box = (color, power, w, h, pos) => {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power), side: THREE.DoubleSide }));
      m.scale.set(w, h, 1);
      m.position.set(...pos);
      m.lookAt(0, 0, 0);
      env.add(m);
    };
    box(0xfff1dd, 4.5, 6, 3, [-2, 6, 4]);   // key softbox
    box(0xff9a4a, 3.5, 1.4, 6, [6, 1, -3]);  // ember rim strip
    box(0xb8c8ff, 1.2, 1.2, 6, [-6, 1, -2]); // cool edge
    box(0xffd7a8, 1.4, 8, 1, [0, -3, 5]);    // floor bounce
    const pm = new THREE.PMREMGenerator(this.renderer);
    const tex = pm.fromScene(env, 0.03).texture;
    pm.dispose();
    return tex;
  }

  buildLights() {
    const key = new THREE.DirectionalLight(0xffe3c4, 3.4);
    key.position.set(-4, 7, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(this.mobile ? 1024 : 2048, this.mobile ? 1024 : 2048);
    const sc = key.shadow.camera;
    sc.left = -3.5; sc.right = 3.5; sc.top = 4; sc.bottom = -4; sc.near = 1; sc.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.radius = 4;
    const rimWarm = new THREE.DirectionalLight(0xff7a33, 4.2);
    rimWarm.position.set(6, 3, -6);
    const rimCool = new THREE.DirectionalLight(0xa9bcff, 1.1);
    rimCool.position.set(-7, 2, -4);
    const fill = new THREE.DirectionalLight(0xffd2a0, 0.35);
    fill.position.set(3, -3, 8);
    const hemi = new THREE.HemisphereLight(0x3a2a20, 0x0a0605, 0.35);
    this.key = key;
    this.scene.add(key, key.target, rimWarm, rimCool, fill, hemi);
  }

  /* ---------------- ingredients ---------------- */
  buildLayers() {
    const L = {};
    const add = (key, obj, thickness, k = 120) => {
      const g = new THREE.Group();
      g.add(obj);
      g.visible = false;
      g.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
        }
      });
      this.burger.add(g);
      L[key] = {
        key, g, thickness, k, c: 2 * Math.sqrt(k) * 0.86,
        y: 6, vy: 0, x: 0, vx: 0, z: 0, vz: 0, rx: 0, vrx: 0, ry: 0, vry: 0, rz: 0, vrz: 0, s: 0, vs: 0,
        t: { y: 0, x: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 0 },
        seed: Object.keys(L).length + 1,
      };
    };

    /* ---- brioche: glazed dome with uneven browning ---- */
    const domeMap = pixelTex(1024, 512, (u, v, o) => {
      const a = u * Math.PI * 2;
      const nx = Math.cos(a) * 1.8 + v * 2.2;
      const ny = Math.sin(a) * 1.8 - v * 1.6;
      const mott = N.fbm(nx * 1.6, ny * 1.6, 5);
      const fine = N(nx * 14, ny * 14);
      const t = clamp(1 - v + mott * 0.28, 0, 1); // v: 0 at top (canvas row 0), 1 at rim
      const base = ramp([
        [0.0, hex('#5a2208')], [0.25, hex('#7a3310')], [0.5, hex('#9a4b1a')],
        [0.72, hex('#bf7430')], [0.88, hex('#d99a52')], [1.0, hex('#e8b877')],
      ], 1 - t);
      const k = 1 + fine * 0.05 + (mott > 0.18 ? -0.08 : 0);
      o[0] = clamp(base[0] * k, 0, 255);
      o[1] = clamp(base[1] * k, 0, 255);
      o[2] = clamp(base[2] * k, 0, 255);
    });
    const domeRough = pixelTex(512, 256, (u, v, o) => {
      const a = u * Math.PI * 2;
      const g = N.fbm(Math.cos(a) * 3 + v * 4, Math.sin(a) * 3, 4);
      const val = clamp(0.3 + g * 0.35 + smoothstep(0.75, 1, v) * 0.35, 0.15, 0.9) * 255;
      o[0] = o[1] = o[2] = val;
    }, { srgb: false });
    const domeNormal = normalTex(512, 256, (u, v) => {
      const a = u * Math.PI * 2;
      return N.fbm(Math.cos(a) * 6 + v * 5, Math.sin(a) * 6, 4) * 0.6 + N(Math.cos(a) * 40, Math.sin(a) * 40 + v * 30) * 0.12;
    }, 3);
    const bunMat = new THREE.MeshPhysicalMaterial({
      map: domeMap, roughnessMap: domeRough, roughness: 1, normalMap: domeNormal, normalScale: new THREE.Vector2(0.45, 0.45),
      clearcoat: 0.55, clearcoatRoughness: 0.28, sheen: 0.25, sheenColor: new THREE.Color('#ffb46b'), sheenRoughness: 0.5,
    });
    const crumb = (toast) => drawTex(512, (ctx, s) => {
      const c = s / 2;
      const g = ctx.createRadialGradient(c, c, 0, c, c, c);
      if (toast) {
        g.addColorStop(0, '#b76f30');
        g.addColorStop(0.55, '#c98945');
        g.addColorStop(0.86, '#9c5422');
        g.addColorStop(0.95, '#6d3212');
      } else {
        g.addColorStop(0, '#f1d6a6');
        g.addColorStop(0.8, '#e7c38a');
        g.addColorStop(0.93, '#c98a45');
        g.addColorStop(1, '#8a4418');
      }
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 2200; i++) {
        const a = Math.random() * Math.PI * 2;
        const rr = Math.sqrt(Math.random()) * c * 0.9;
        ctx.fillStyle = toast ? `rgba(60,25,8,${Math.random() * 0.35})` : `rgba(150,105,55,${Math.random() * 0.3})`;
        ctx.beginPath();
        ctx.ellipse(c + Math.cos(a) * rr, c + Math.sin(a) * rr, Math.random() * 3.2 + 0.6, Math.random() * 2 + 0.5, Math.random() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      if (toast) {
        for (let i = 0; i < 70; i++) {
          ctx.fillStyle = `rgba(70,28,8,${Math.random() * 0.25})`;
          ctx.beginPath();
          ctx.arc(Math.random() * s, Math.random() * s, 10 + Math.random() * 40, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });
    const crumbMat = new THREE.MeshStandardMaterial({ map: crumb(false), roughness: 0.9 });
    const toastMat = new THREE.MeshStandardMaterial({ map: crumb(true), roughness: 0.7 });

    // top bun: dome from the rim up (lathe UV v runs rim → crown) + cut face disc
    const topPts = [[1.46, 0.02], [1.53, 0.06], [1.58, 0.17], [1.56, 0.34], [1.45, 0.56], [1.22, 0.79], [0.88, 0.96], [0.46, 1.05], [0.0, 1.08]].map(([x, y]) => new THREE.Vector2(x, y));
    const domeGeo = new THREE.LatheGeometry(topPts, 96);
    const dp = domeGeo.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      const x = dp.getX(i);
      const z = dp.getZ(i);
      const a = Math.atan2(z, x);
      const lump = 1 + N(Math.cos(a) * 2.2, Math.sin(a) * 2.2) * 0.035;
      dp.setX(i, x * lump);
      dp.setZ(i, z * lump);
      dp.setY(i, dp.getY(i) * (1 + N(Math.cos(a) * 1.3 + 7, Math.sin(a) * 1.3) * 0.04));
    }
    domeGeo.computeVertexNormals();
    const top = new THREE.Group();
    top.add(new THREE.Mesh(domeGeo, bunMat));
    const face = new THREE.Mesh(new THREE.CircleGeometry(1.47, 96), crumbMat);
    face.rotation.x = Math.PI / 2;
    face.position.y = 0.02;
    top.add(face);
    // sesame
    const seedGeo = new THREE.SphereGeometry(1, 12, 8);
    seedGeo.scale(0.052, 0.02, 0.03);
    const seeds = new THREE.InstancedMesh(seedGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }), 190);
    const d = new THREE.Object3D();
    const domeY = (rr) => {
      for (let i = 1; i < topPts.length; i++) {
        const a = topPts[i - 1];
        const b = topPts[i];
        if (rr <= a.x && rr >= b.x) return lerp(a.y, b.y, (rr - a.x) / (b.x - a.x || 1));
      }
      return 1.08;
    };
    let si = 0;
    const seedCols = ['#f3e4c4', '#ecd6ab', '#e2c48e', '#f7ecd6', '#d7ae70'].map((c) => new THREE.Color(c));
    for (let i = 0; i < 600 && si < 190; i++) {
      const rr = Math.sqrt(hash(i * 1.7)) * 1.3;
      const th = hash(i * 3.3) * Math.PI * 2;
      const nrm = new THREE.Vector3(Math.cos(th) * rr * 0.8, 1.1, Math.sin(th) * rr * 0.8).normalize();
      d.position.set(Math.cos(th) * rr, domeY(Math.max(rr, 1e-4)) * 1.0 + 0.004, Math.sin(th) * rr);
      d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
      d.rotateY(hash(i * 5.1) * 6.28);
      d.scale.setScalar(0.8 + hash(i) * 0.45);
      d.updateMatrix();
      seeds.setMatrixAt(si, d.matrix);
      seeds.setColorAt(si, seedCols[Math.floor(hash(i * 9.1) * seedCols.length)]);
      si++;
    }
    seeds.count = si;
    top.add(seeds);
    add('bunTop', top, 1.08, 110);

    // bottom bun: golden side band + toasted top face
    const sidePts = [[1.34, 0.0], [1.47, 0.06], [1.53, 0.2], [1.52, 0.36], [1.47, 0.47], [1.42, 0.5]].map(([x, y]) => new THREE.Vector2(x, y));
    const sideMap = pixelTex(512, 128, (u, v, o) => {
      const a = u * Math.PI * 2;
      const m = N.fbm(Math.cos(a) * 3, Math.sin(a) * 3 + v * 2, 4);
      const c = ramp([[0, hex('#b8692a')], [0.5, hex('#dca25a')], [1, hex('#c07a36')]], clamp(v + m * 0.3, 0, 1));
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    const bottom = new THREE.Group();
    bottom.add(new THREE.Mesh(new THREE.LatheGeometry(sidePts, 96), new THREE.MeshPhysicalMaterial({ map: sideMap, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4, normalMap: domeNormal, normalScale: new THREE.Vector2(0.3, 0.3) })));
    const tFace = new THREE.Mesh(new THREE.CircleGeometry(1.42, 96), toastMat);
    tFace.rotation.x = -Math.PI / 2;
    tFace.position.y = 0.5;
    bottom.add(tFace);
    const bFace = new THREE.Mesh(new THREE.CircleGeometry(1.34, 64), new THREE.MeshStandardMaterial({ color: 0xa25a22, roughness: 0.8 }));
    bFace.rotation.x = Math.PI / 2;
    bottom.add(bFace);
    add('bunBottom', bottom, 0.5, 150);

    /* ---- patty: crust colour, char, grease sheen + normal map ---- */
    const pattyH = (u, v) => {
      const x = u * 8;
      const y = v * 8;
      return N.fbm(x, y, 5) * 0.7 + Math.abs(N(x * 3.1, y * 3.1)) * 0.35 + N(x * 11, y * 11) * 0.1;
    };
    const pattyMap = pixelTex(1024, 1024, (u, v, o) => {
      const h = pattyH(u, v);
      const char = smoothstep(0.1, 0.45, N.fbm(u * 5 + 3, v * 5 - 2, 4));
      let c = ramp([[0, hex('#2a130a')], [0.45, hex('#4a2412')], [0.7, hex('#6e3a1b')], [1, hex('#8c5129')]], clamp(h * 0.9 + 0.5, 0, 1));
      c = mixc(c, hex('#140905'), char * 0.75);
      const grease = N(u * 70, v * 70) > 0.42 ? 0.25 : 0;
      o[0] = clamp(c[0] + grease * 90, 0, 255);
      o[1] = clamp(c[1] + grease * 60, 0, 255);
      o[2] = clamp(c[2] + grease * 30, 0, 255);
    });
    const pattyRough = pixelTex(512, 512, (u, v, o) => {
      const g = N(u * 35, v * 35);
      o[0] = o[1] = o[2] = clamp(0.62 - (g > 0.3 ? 0.4 : 0) + N.fbm(u * 6, v * 6) * 0.2, 0.12, 0.9) * 255;
    }, { srgb: false });
    const pattyNormal = normalTex(512, 512, pattyH, 5);
    const pattyMat = new THREE.MeshPhysicalMaterial({ map: pattyMap, roughnessMap: pattyRough, roughness: 1, normalMap: pattyNormal, normalScale: new THREE.Vector2(1.2, 1.2), clearcoat: 0.35, clearcoatRoughness: 0.35 });
    const makePatty = (seed, radius = 1.62, h = 0.34, mat = pattyMat) => {
      const pts = [[0, 0], [radius * 0.9, 0.015], [radius, 0.08], [radius * 1.01, h * 0.55], [radius * 0.95, h * 0.9], [radius * 0.5, h], [0, h * 1.02]].map(([x, y]) => new THREE.Vector2(x, y));
      const g = new THREE.LatheGeometry(pts, 160);
      const p = g.attributes.position;
      const uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        const y = p.getY(i);
        const rr = Math.hypot(x, z);
        const a = Math.atan2(z, x);
        const edge = smoothstep(radius * 0.7, radius, rr);
        const lace = 1 + edge * (0.05 * N(Math.cos(a) * 3 + seed, Math.sin(a) * 3) + 0.035 * N(Math.cos(a) * 11, Math.sin(a) * 11 + seed) + 0.02 * N(Math.cos(a) * 29 + seed, Math.sin(a) * 29));
        const bump = N(x * 2.4 + seed, z * 2.4) * 0.03 * (1 - edge * 0.6);
        p.setXYZ(i, x * lace, y + (y > h * 0.4 ? bump : -bump * 0.4) - edge * edge * 0.05 * (y > h * 0.5 ? 1 : 0), z * lace);
        uv.setXY(i, x / (radius * 2.2) + 0.5, z / (radius * 2.2) + 0.5);
      }
      g.computeVertexNormals();
      return new THREE.Mesh(g, mat);
    };
    add('patty', makePatty(1), 0.34, 140);
    add('patty2', makePatty(7), 0.34, 140);
    const veggieMap = pixelTex(512, 512, (u, v, o) => {
      const h = N.fbm(u * 9, v * 9, 4);
      let c = ramp([[0, hex('#2f2a12')], [0.5, hex('#5b5222')], [1, hex('#7d6d2e')]], clamp(h + 0.5, 0, 1));
      if (N(u * 60, v * 60) > 0.45) c = hex('#e3b43c');
      else if (N(u * 45 + 9, v * 45) > 0.47) c = hex('#1c150c');
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    add('veggie', makePatty(3, 1.52, 0.38, new THREE.MeshPhysicalMaterial({ map: veggieMap, roughness: 0.7, normalMap: pattyNormal, normalScale: new THREE.Vector2(1, 1), clearcoat: 0.2 })), 0.38, 140);

    /* ---- cheddar: glossy molten drape ---- */
    const cheeseMat = new THREE.MeshPhysicalMaterial({ color: 0xffa51a, roughness: 0.32, clearcoat: 0.9, clearcoatRoughness: 0.18, sheen: 0.7, sheenColor: new THREE.Color('#ffd98a'), sheenRoughness: 0.4, emissive: 0x6a2c00, emissiveIntensity: 0.22, side: THREE.DoubleSide });
    const makeCheese = (seed) => {
      const g = new THREE.PlaneGeometry(2.8, 2.8, 72, 72);
      g.rotateX(-Math.PI / 2);
      g.rotateY(Math.PI / 4 + seed * 0.35);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i);
        const z = p.getZ(i);
        const r = Math.hypot(x, z);
        const th = Math.atan2(z, x);
        let y = N(x * 2 + seed, z * 2) * 0.012;
        if (r > 1.42) {
          const o = r - 1.42;
          y -= Math.pow(o, 1.15) * 0.95;
          y -= Math.pow(Math.max(0, Math.sin(th * 4 + seed * 2)), 12) * o * 0.9;
          const pull = 1.42 / r + (1 - 1.42 / r) * (1 - Math.min(o * 0.7, 0.55));
          p.setX(i, x * pull);
          p.setZ(i, z * pull);
        }
        p.setY(i, y);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, cheeseMat);
      m.position.y = 0.025;
      return m;
    };
    add('cheese', makeCheese(0), 0.05, 100);
    add('cheese2', makeCheese(1), 0.05, 100);

    /* ---- iceberg: three crinkled leaves ---- */
    const leafMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3, side: THREE.DoubleSide });
    const cPale = new THREE.Color('#e3efb4');
    const cMid = new THREE.Color('#9fcf5a');
    const cEdge = new THREE.Color('#4f9a2c');
    const lettuce = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const a0 = (k / 3) * Math.PI * 2 + hash(k) * 0.4;
      const span = 2.7;
      const g = radialSurface(16, 110, a0, a0 + span, (r01, th, s01) => {
        const edgeR = 1.72 + 0.14 * N(th * 2.5 + k, 3) + 0.05 * Math.sin(th * 23 + k);
        const taper = Math.sin(s01 * Math.PI);
        const R = edgeR * (0.35 + 0.65 * Math.pow(taper, 0.35));
        const frill = Math.sin(th * 34 + k * 2) * 0.07 * Math.pow(r01, 3);
        const crumple = N(Math.cos(th) * r01 * 5 + k * 3, Math.sin(th) * r01 * 5) * 0.09 * r01;
        return { r: R * r01, y: 0.04 + frill + crumple - Math.pow(r01, 3) * 0.16 + k * 0.012 };
      }, (r01, th, c) => {
        c.copy(cPale).lerp(cMid, smoothstep(0.15, 0.7, r01)).lerp(cEdge, smoothstep(0.75, 1, r01) * 0.8);
        const vein = Math.pow(Math.abs(Math.sin(th * 9 + k)), 60) * (1 - r01) * 0.35;
        c.r += vein; c.g += vein; c.b += vein * 0.6;
      });
      lettuce.add(new THREE.Mesh(g, leafMat));
    }
    add('lettuce', lettuce, 0.11, 90);

    /* ---- heirloom tomato ---- */
    const tomatoFace = drawTex(512, (ctx, s) => {
      const c = s / 2;
      ctx.fillStyle = '#b3130f';
      ctx.fillRect(0, 0, s, s);
      const g = ctx.createRadialGradient(c, c, s * 0.05, c, c, s * 0.47);
      g.addColorStop(0, '#f05a3a');
      g.addColorStop(0.7, '#d9301f');
      g.addColorStop(1, '#a8150e');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, s * 0.47, 0, Math.PI * 2);
      ctx.fill();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        ctx.save();
        ctx.translate(c + Math.cos(a) * s * 0.24, c + Math.sin(a) * s * 0.24);
        ctx.rotate(a);
        const gg = ctx.createRadialGradient(0, 0, 2, 0, 0, s * 0.12);
        gg.addColorStop(0, '#ffb07a');
        gg.addColorStop(1, '#e8583c');
        ctx.fillStyle = gg;
        ctx.beginPath();
        ctx.ellipse(0, 0, s * 0.12, s * 0.075, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#f6d98e';
        for (let q = 0; q < 7; q++) {
          ctx.beginPath();
          ctx.ellipse((q - 3) * 9, (q % 2 ? 1 : -1) * 7, 5, 3, 0.3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
      ctx.fillStyle = '#c42818';
      ctx.beginPath();
      ctx.arc(c, c, s * 0.06, 0, Math.PI * 2);
      ctx.fill();
    });
    const tomatoSkin = new THREE.MeshPhysicalMaterial({ color: 0xb8170f, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 });
    const tomatoCut = new THREE.MeshPhysicalMaterial({ map: tomatoFace, roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08, sheen: 0.5, sheenColor: new THREE.Color('#ff9a7a') });
    const tomato = new THREE.Group();
    [[-0.56, 0.12, 0.3], [0.6, -0.14, -0.4]].forEach(([x, z, rot], i) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.82, 0.8, 0.12, 64), [tomatoSkin, tomatoCut, tomatoCut]);
      m.position.set(x, 0.06 + i * 0.01, z);
      m.rotation.set((hash(i) - 0.5) * 0.06, rot, (hash(i + 3) - 0.5) * 0.06);
      tomato.add(m);
    });
    add('tomato', tomato, 0.13, 120);

    /* ---- red onion: thin translucent rings ---- */
    const onionMat = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, transparent: true, opacity: 0.93 });
    const onion = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const R = 0.3 + hash(i * 2) * 0.22;
      const g = new THREE.TorusGeometry(R, 0.042, 10, 72);
      g.scale(1, 1, 0.45);
      const p = g.attributes.position;
      const cols = [];
      const cw = new THREE.Color('#f4e6f0');
      const cp = new THREE.Color('#7e1f5c');
      const c = new THREE.Color();
      for (let k = 0; k < p.count; k++) {
        const rr = Math.hypot(p.getX(k), p.getY(k));
        c.copy(cw).lerp(cp, smoothstep(R - 0.01, R + 0.04, rr));
        cols.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      const m = new THREE.Mesh(g, onionMat);
      const a = (i / 5) * Math.PI * 2 + 0.5;
      m.position.set(Math.cos(a) * 0.78, 0.03, Math.sin(a) * 0.78);
      m.rotation.x = Math.PI / 2 + (hash(i * 3) - 0.5) * 0.12;
      onion.add(m);
    }
    add('onion', onion, 0.06, 95);

    /* ---- house pickles: ridged coins ---- */
    const pickleFace = drawTex(256, (ctx, s) => {
      const c = s / 2;
      ctx.fillStyle = '#3f5f18';
      ctx.fillRect(0, 0, s, s);
      const g = ctx.createRadialGradient(c, c, 0, c, c, s * 0.44);
      g.addColorStop(0, '#d5d98a');
      g.addColorStop(0.55, '#a9b75a');
      g.addColorStop(0.85, '#7a9133');
      g.addColorStop(1, '#4b6a1d');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(c, c, s * 0.44, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(245,240,200,0.9)';
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(c + Math.cos(a) * s * 0.17, c + Math.sin(a) * s * 0.17, 9, 5, a, 0, Math.PI * 2);
        ctx.fill();
      }
    });
    const pickleSide = new THREE.MeshPhysicalMaterial({ color: 0x31501a, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
    const pickleTop = new THREE.MeshPhysicalMaterial({ map: pickleFace, roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.1 });
    const pickles = new THREE.Group();
    for (let i = 0; i < 5; i++) {
      const g = new THREE.CylinderGeometry(0.33, 0.33, 0.05, 48);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k);
        const z = p.getZ(k);
        const rr = Math.hypot(x, z);
        if (rr > 0.2) {
          const a = Math.atan2(z, x);
          const f = 1 + 0.045 * Math.sin(a * 22);
          p.setX(k, x * f);
          p.setZ(k, z * f);
        }
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, [pickleSide, pickleTop, pickleTop]);
      const a = (i / 5) * Math.PI * 2 + 1.1;
      m.position.set(Math.cos(a) * 0.74, 0.03 + (i % 2) * 0.02, Math.sin(a) * 0.74);
      m.rotation.set((hash(i * 7) - 0.5) * 0.2, 0, (hash(i * 9) - 0.5) * 0.2);
      pickles.add(m);
    }
    add('pickles', pickles, 0.07, 100);

    /* ---- STAKD sauce: glossy, dripping over the heel ---- */
    const sauce = new THREE.Mesh(radialSurface(10, 160, 0, Math.PI * 2, (r01, th) => {
      const drip = Math.pow(Math.max(0, Math.sin(th * 5 + 0.7)), 14);
      const R = 1.48 + 0.05 * N(Math.cos(th) * 3, Math.sin(th) * 3) + drip * 0.06;
      const y = 0.025 * (1 - r01 * r01) - smoothstep(0.92, 1, r01) * drip * 0.28;
      return { r: R * r01, y };
    }, (r01, th, c) => c.set('#d8622a').lerp(new THREE.Color('#f09a52'), 0.25 + 0.2 * Math.sin(th * 7))), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.08, clearcoat: 1, clearcoatRoughness: 0.04, side: THREE.DoubleSide }));
    sauce.position.y = 0.012;
    add('sauce', sauce, 0.04, 120);

    /* ---- bacon ---- */
    const baconTex = drawTex(512, (ctx, s) => {
      const grad = ctx.createLinearGradient(0, 0, 0, s);
      [[0, '#5e1509'], [0.18, '#9c3218'], [0.34, '#e9c29b'], [0.46, '#8e2a14'], [0.66, '#5c1508'], [0.8, '#e2b893'], [1, '#6e1d0c']].forEach(([o, c]) => grad.addColorStop(o, c));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 1600; i++) {
        ctx.fillStyle = `rgba(30,6,2,${Math.random() * 0.25})`;
        ctx.fillRect(Math.random() * s, Math.random() * s, Math.random() * 10, 1.4);
      }
    });
    const baconMat = new THREE.MeshPhysicalMaterial({ map: baconTex, roughness: 0.45, clearcoat: 0.7, clearcoatRoughness: 0.25, side: THREE.DoubleSide });
    const bacon = new THREE.Group();
    [-0.35, 0.4].forEach((o, i) => {
      const g = new THREE.PlaneGeometry(3.0, 0.44, 90, 4);
      g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const x = p.getX(k);
        p.setY(k, Math.sin(x * 3.4 + i) * 0.07 + Math.sin(x * 9 + i * 2) * 0.015 - Math.max(0, Math.abs(x) - 1.3) * 0.45);
      }
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, baconMat);
      m.position.set(0, 0.05 + i * 0.03, o);
      m.rotation.y = (i ? -1 : 1) * 0.35;
      bacon.add(m);
    });
    add('bacon', bacon, 0.1, 110);

    /* ---- buttermilk fried chicken ---- */
    const friedH = (u, v) => N.fbm(u * 14, v * 14, 4) * 0.8 + Math.abs(N(u * 40, v * 40)) * 0.3;
    const friedMap = pixelTex(512, 512, (u, v, o) => {
      const h = friedH(u, v);
      const c = ramp([[0, hex('#7a3b10')], [0.4, hex('#b8641f')], [0.7, hex('#d99038')], [1, hex('#f0bd6a')]], clamp(h + 0.5, 0, 1));
      o[0] = c[0]; o[1] = c[1]; o[2] = c[2];
    });
    const chickenGeo = new THREE.SphereGeometry(1, 96, 40);
    const cp = chickenGeo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i);
      const y = cp.getY(i);
      const z = cp.getZ(i);
      const n = 1 + N(x * 4 + 1, z * 4 + y * 3) * 0.06 + N(x * 13, z * 13 + y * 7) * 0.03;
      const lobe = 1 + 0.08 * Math.sin(Math.atan2(z, x) * 3);
      cp.setXYZ(i, x * 1.72 * n * lobe, y * 0.3 * n, z * 1.32 * n * lobe);
    }
    chickenGeo.computeVertexNormals();
    const chicken = new THREE.Mesh(chickenGeo, new THREE.MeshPhysicalMaterial({ map: friedMap, roughness: 0.7, normalMap: normalTex(256, 256, friedH, 6), normalScale: new THREE.Vector2(1.4, 1.4), clearcoat: 0.25 }));
    chicken.position.y = 0.26;
    add('chicken', chicken, 0.5, 140);

    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      pts.push(new THREE.Vector3(lerp(-1.3, 1.3, t), 0.02, Math.sin(t * Math.PI * 5) * 0.9 * (1 - Math.abs(t - 0.5))));
    }
    const honey = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 220, 0.038, 10), new THREE.MeshPhysicalMaterial({ color: 0xe8940e, roughness: 0.04, clearcoat: 1, transmission: 0, emissive: 0x6a2e00, emissiveIntensity: 0.4 }));
    add('honey', honey, 0.03, 90);

    const jalMat = new THREE.MeshPhysicalMaterial({ color: 0x2c7a24, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.1 });
    const jal = new THREE.Group();
    for (let i = 0; i < 7; i++) {
      const g = new THREE.TorusGeometry(0.16, 0.05, 10, 32);
      g.scale(1, 1, 0.5);
      const m = new THREE.Mesh(g, jalMat);
      const a = (i / 7) * Math.PI * 2;
      m.position.set(Math.cos(a) * (0.5 + hash(i) * 0.6), 0.04, Math.sin(a) * (0.5 + hash(i) * 0.6));
      m.rotation.x = Math.PI / 2;
      jal.add(m);
    }
    add('jalapenos', jal, 0.06, 90);

    this.L = L;
  }

  /* warm light pool + soft contact shadow on the "counter" */
  buildGround() {
    const pool = drawTex(256, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(255,150,70,0.55)');
      g.addColorStop(0.4, 'rgba(255,120,50,0.18)');
      g.addColorStop(1, 'rgba(255,120,50,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }, false);
    const shadow = drawTex(256, (ctx, s) => {
      const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
      g.addColorStop(0, 'rgba(0,0,0,0.85)');
      g.addColorStop(0.45, 'rgba(0,0,0,0.4)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }, false);
    this.pool = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), new THREE.MeshBasicMaterial({ map: pool, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.pool.rotation.x = -Math.PI / 2;
    this.shadow = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 4.6), new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.root.add(this.pool, this.shadow);
  }

  /* embers, smoke and a few drifting sesame seeds */
  buildAmbience() {
    const group = new THREE.Group();
    this.ambience = group;
    this.scene.add(group);

    const n = this.mobile ? 160 : 320;
    const pos = new Float32Array(n * 3);
    const seed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (hash(i * 1.3) - 0.5) * 11;
      pos[i * 3 + 1] = -3.5;
      pos[i * 3 + 2] = -4 + hash(i * 2.9) * 5.5;
      seed[i] = hash(i * 4.7);
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    eg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.emberU = { uT: { value: 0 }, uPR: { value: this.dpr }, uA: { value: 1 }, uBoost: { value: 0 } };
    const embers = new THREE.Points(eg, new THREE.ShaderMaterial({
      uniforms: this.emberU,
      vertexShader: /* glsl */ `
        attribute float aSeed; uniform float uT, uPR, uBoost; varying float vA; varying float vS;
        void main(){
          vec3 p = position;
          float life = fract(aSeed * 13.7 + uT * (0.05 + aSeed * 0.07) * (1.0 + uBoost));
          p.y += life * 8.0;
          float sw = uT * (0.4 + aSeed * 0.8) + aSeed * 40.0;
          p.x += sin(sw) * 0.35 + sin(sw * 2.3) * 0.12;
          p.z += cos(sw * 0.8) * 0.25;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = (2.0 + aSeed * 5.0) * uPR * (12.0 / -mv.z);
          float flick = 0.6 + 0.4 * sin(uT * (6.0 + aSeed * 9.0) + aSeed * 50.0);
          vA = smoothstep(0.0, 0.12, life) * (1.0 - smoothstep(0.55, 1.0, life)) * flick;
          vS = aSeed;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uA; varying float vA; varying float vS;
        void main(){
          float d = length(gl_PointCoord - 0.5);
          float core = smoothstep(0.5, 0.0, d);
          float a = core * core * vA * uA;
          vec3 col = mix(vec3(1.0, 0.36, 0.08), vec3(1.0, 0.78, 0.4), vS);
          gl_FragColor = vec4(col * a * 1.8, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    embers.frustumCulled = false;
    group.add(embers);

    this.smokeU = { uT: { value: 0 }, uA: { value: 1 } };
    const smokeMat = new THREE.ShaderMaterial({
      uniforms: this.smokeU,
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uT, uA; varying vec2 vUv;
        float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
        float vn(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
        float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+17.1; a*=0.5; } return s; }
        void main(){
          vec2 p = vUv * vec2(2.0, 3.0);
          float n = fbm(p + vec2(fbm(p + uT * 0.05) * 1.5, -uT * 0.12));
          float mask = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.55, vUv.y) * smoothstep(0.0, 0.3, vUv.x) * smoothstep(1.0, 0.7, vUv.x);
          float a = smoothstep(0.45, 0.85, n) * mask * 0.12 * uA;
          gl_FragColor = vec4(vec3(0.85, 0.72, 0.62), a);
        }`,
      transparent: true,
      depthWrite: false,
    });
    const smoke = new THREE.Mesh(new THREE.PlaneGeometry(9, 9), smokeMat);
    smoke.position.set(0.5, 1.8, -2.5);
    group.add(smoke);

    // a handful of sesame seeds drifting in the light (macro "flying ingredient" feel)
    const sg = new THREE.SphereGeometry(1, 10, 6);
    sg.scale(0.08, 0.032, 0.045);
    const seeds = new THREE.InstancedMesh(sg, new THREE.MeshStandardMaterial({ color: 0xefdcb4, roughness: 0.45 }), this.mobile ? 12 : 22);
    seeds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    seeds.frustumCulled = false;
    const items = [];
    for (let i = 0; i < seeds.count; i++) {
      let x;
      let y;
      let t = 0;
      do {
        x = (hash(i * 3.1 + t) - 0.5) * 10;
        y = (hash(i * 5.7 + t) - 0.5) * 6;
        t++;
      } while (Math.abs(x - 1) < 2.4 && Math.abs(y) < 2.2 && t < 30);
      items.push({ bx: x, by: y, bz: (hash(i * 7.3) - 0.5) * 3, x, y, vx: 0, vy: 0, r: hash(i) * 6, sp: 0.2 + hash(i * 9) * 0.4, ph: hash(i * 11) * 6.28, sc: 0.8 + hash(i * 13) * 0.8 });
    }
    group.add(seeds);
    this.seeds = { mesh: seeds, items };
  }

  /* ---------------- API ---------------- */
  setMouse(x, y) {
    this.mouse.set(x, y);
  }

  setRecipe(i, instant = false) {
    this.recipe = i;
    const active = new Set(RECIPES[i].layers);
    Object.values(this.L).forEach((l) => {
      const on = active.has(l.key);
      if (on && !l.g.visible) {
        l.g.visible = true;
        // arrive gently from above, already the right size
        l.y = instant ? 0 : 4.5 + hash(l.seed) * 1.5;
        l.x = 0;
        l.s = instant ? 1 : 0.85;
        l.vy = 0;
        l.vrx = 0;
        l.vrz = 0;
        l.ry = instant ? 0 : (hash(l.seed * 2) - 0.5) * 1.2;
      }
      l.active = on;
    });
    if (!instant) {
      Object.values(this.L).forEach((l) => {
        if (l.active) l.vy += 1.2 + hash(l.seed * 9 + i) * 1.2;
      });
    }
  }

  /** intro: layers are lowered onto the heel one after another */
  intro() {
    const list = RECIPES[this.recipe].layers;
    list.forEach((k, i) => {
      const l = this.L[k];
      l.y = 2.6 + i * 0.32;
      l.vy = -0.6;
      l.x = 0;
      l.vx = 0;
      l.s = 1;
      l.vs = 0;
      l.ry = (hash(l.seed * 5) - 0.5) * 0.9;
      l.rx = 0;
      l.rz = 0;
      l.hold = 0.05 + i * 0.09;
    });
  }

  labelAnchors(out = []) {
    out.length = 0;
    const v = new THREE.Vector3();
    const cam = this.camera;
    RECIPES[0].layers.forEach((k, i) => {
      const l = this.L[k];
      if (!l || !l.g.visible) return;
      const side = i % 2 === 0 ? 1 : -1;
      v.set(1.6, l.thickness * 0.5, 0);
      l.g.localToWorld(v);
      v.project(cam);
      const xR = (v.x * 0.5 + 0.5) * this.w;
      const yR = (-v.y * 0.5 + 0.5) * this.h;
      v.set(-1.6, l.thickness * 0.5, 0);
      l.g.localToWorld(v);
      v.project(cam);
      const xL = (v.x * 0.5 + 0.5) * this.w;
      const yL = (-v.y * 0.5 + 0.5) * this.h;
      out.push({ key: k, idx: i, side, x: side > 0 ? xR : xL, y: side > 0 ? yR : yL, xR, yR, vis: l.s });
    });
    return out;
  }

  resize() {
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.renderer.setSize(this.w, this.h, false);
    this.camera.aspect = this.w / this.h;
    this.camera.updateProjectionMatrix();
    this.halfH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 12.5;
    this.halfW = this.halfH * this.camera.aspect;
    this.mobileScale = this.w < 700 ? 0.6 : this.w < 1000 ? 0.8 : 1;
  }

  /* ---------------- frame ---------------- */
  update(dt, time, velocity) {
    dt = Math.min(dt, 1 / 30);
    const P = this.pose;
    this.velS += (velocity - this.velS) * Math.min(dt * 6, 1);
    this.mouseS.lerp(this.mouse, 1 - Math.pow(0.02, dt));
    const m = this.reduced ? 0 : 1;

    const sc = P.s * this.mobileScale;
    this.root.position.set(P.x * this.halfW * 2, P.y * this.halfH * 2, 0);
    this.root.scale.setScalar(sc);
    this.spinAcc += dt * 0.16 * (P.spin ?? 1) * m;
    this.burger.rotation.y = P.rotY + this.spinAcc + this.mouseS.x * 0.45 * m;
    this.burger.rotation.x = P.tilt - this.mouseS.y * 0.14 * m + clamp(this.velS * 0.0025, -0.18, 0.18);

    // stack targets
    const list = RECIPES[this.recipe].layers;
    let acc = 0;
    const stackY = {};
    list.forEach((k) => {
      stackY[k] = acc;
      acc += this.L[k].thickness;
    });
    const total = acc;
    const mid = (list.length - 1) / 2;
    const ex = this.explode;
    const vImpulse = clamp(Math.abs(this.velS) * 0.008, 0, 1.1);
    const spread = ex * 0.92 + vImpulse * (0.28 + ex * 0.3);
    Object.values(this.L).forEach((l) => {
      if (l.hold > 0) {
        l.hold -= dt;
        l.g.visible = false;
        return;
      }
      if (l.active) l.g.visible = true;
      const t = l.t;
      if (l.active) {
        const i = list.indexOf(l.key);
        const rel = i - mid;
        t.y = stackY[l.key] - total / 2 + rel * spread;
        t.x = ex * 0.12 * Math.sin(i * 1.7);
        t.z = 0;
        t.rx = ex * 0.1 * Math.sin(i * 2.1);
        t.rz = ex * 0.06 * Math.cos(i * 1.3);
        t.ry = ex * rel * 0.08;
        t.s = 1;
      } else {
        t.y = 5.5;
        t.x = 0;
        t.z = -1;
        t.rx = 0;
        t.rz = 0;
        t.ry = 0;
        t.s = 0;
      }
      const k = l.k;
      const c = l.c;
      const step = (p, v, target) => {
        const a = k * (l.t[target] - l[p]) - c * l[v];
        l[v] += a * dt;
        l[p] += l[v] * dt;
      };
      step('y', 'vy', 'y');
      step('x', 'vx', 'x');
      step('z', 'vz', 'z');
      step('rx', 'vrx', 'rx');
      step('ry', 'vry', 'ry');
      step('rz', 'vrz', 'rz');
      step('s', 'vs', 's');
      if (!l.active && l.s < 0.02) l.g.visible = false;
      l.g.position.set(l.x, l.y, l.z);
      l.g.rotation.set(l.rx, l.ry, l.rz);
      l.g.scale.setScalar(Math.max(l.s, 0.0001));
    });

    // ground under the lowest layer
    const bottom = this.L[list[0]];
    const gy = bottom.y - 0.04;
    this.shadow.position.y = gy;
    this.pool.position.y = gy - 0.01;
    this.shadow.material.opacity = P.shadow * clamp(1 - ex * 0.75, 0.15, 1);
    this.pool.material.opacity = P.shadow * 0.9;
    this.shadow.scale.setScalar(1 + ex * 0.2);

    // key light + shadow frustum follow the burger
    this.key.target.position.copy(this.root.position);
    this.key.position.copy(this.root.position).add(new THREE.Vector3(-4, 7, 6));
    const s = Math.max(sc, 0.35) * (1 + ex * 1.2);
    const cam = this.key.shadow.camera;
    cam.left = -3.5 * s; cam.right = 3.5 * s; cam.top = 4 * s; cam.bottom = -4 * s;
    cam.updateProjectionMatrix();

    this.updateAmbience(dt, time);
    this.renderer.render(this.scene, this.camera);
    this.adapt(dt);
  }

  updateAmbience(dt, time) {
    const a = this.pose.floaters;
    this.ambience.visible = a > 0.01;
    if (!this.ambience.visible) return;
    this.emberU.uT.value = time;
    this.emberU.uA.value = a;
    this.emberU.uBoost.value += (clamp(Math.abs(this.velS) / 40, 0, 2) - this.emberU.uBoost.value) * Math.min(dt * 3, 1);
    this.smokeU.uT.value = time;
    this.smokeU.uA.value = a;
    const { mesh, items } = this.seeds;
    const d = this._d || (this._d = new THREE.Object3D());
    const mx = this.mouseS.x * this.halfW;
    const my = this.mouseS.y * this.halfH;
    items.forEach((it, i) => {
      const dx = it.x - mx;
      const dy = it.y - my;
      const dist = Math.hypot(dx, dy) + 0.001;
      let fx = 0;
      let fy = 0;
      if (dist < 1.8) {
        fx = (dx / dist) * (1.8 - dist) * 6;
        fy = (dy / dist) * (1.8 - dist) * 6;
      }
      const tx = it.bx + Math.sin(time * it.sp + it.ph) * 0.35;
      const ty = it.by + Math.cos(time * it.sp * 0.7 + it.ph) * 0.45;
      it.vx += ((tx - it.x) * 4 + fx - it.vx * 3.2) * dt;
      it.vy += ((ty - it.y) * 4 + fy - it.vy * 3.2) * dt;
      it.x += it.vx * dt;
      it.y += it.vy * dt;
      d.position.set(it.x, it.y, it.bz);
      d.rotation.set(it.r + time * it.sp, it.r * 0.5 + time * it.sp * 0.6, 0);
      d.scale.setScalar(it.sc * a);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }

  adapt(dt) {
    const ft = this.frameTimes;
    ft.push(dt);
    if (ft.length < 90) return;
    const avg = ft.reduce((x, y) => x + y, 0) / ft.length;
    ft.length = 0;
    if (avg > 1 / 50 && this.dpr > 0.85) {
      this.dpr = Math.max(0.85, this.dpr - 0.2);
      this.renderer.setPixelRatio(this.dpr);
      this.emberU.uPR.value = this.dpr;
    } else if (avg < 1 / 58 && this.dpr < this.dprMax) {
      this.dpr = Math.min(this.dprMax, this.dpr + 0.1);
      this.renderer.setPixelRatio(this.dpr);
      this.emberU.uPR.value = this.dpr;
    }
  }

  compile() {
    Object.values(this.L).forEach((l) => (l.g.visible = true));
    this.renderer.compile(this.scene, this.camera);
    Object.values(this.L).forEach((l) => (l.g.visible = !!l.active));
  }
}
