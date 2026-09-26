import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as P from './pour.js';
import * as TX from './textures.js';

const { clamp, lerp, smoothstep, hash } = P;
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

/* ============================================================
   Shared GLSL snippets
   ============================================================ */
const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash21(i), hash21(i+vec2(1.0,0.0)), u.x), mix(hash21(i+vec2(0.0,1.0)), hash21(i+vec2(1.0,1.0)), u.x), u.y);
}
float fbm(vec2 p){ float s = 0.0, a = 0.5; for(int i=0;i<4;i++){ s += a*vnoise(p); p = p*2.03 + 17.1; a *= 0.5; } return s; }
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c,-s,s,c); }
`;

/* ============================================================
   Studio environment (softboxes on black) for premium reflections
   ============================================================ */
function studioEnvironment(renderer) {
  const env = new THREE.Scene();
  env.background = new THREE.Color(0x030202);
  const geo = new THREE.PlaneGeometry(1, 1);
  const box = (hex, power, w, h, pos, look = V3(0, 1.5, 0)) => {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(power), side: THREE.DoubleSide }));
    m.scale.set(w, h, 1);
    m.position.copy(pos);
    m.lookAt(look);
    env.add(m);
  };
  box(0xffffff, 5.0, 7, 2.4, V3(0, 7, 1.5));            // top softbox
  box(0xffe2c0, 3.6, 1.2, 7, V3(-6, 2.5, 1.5));         // left warm strip
  box(0xd9e3ff, 2.4, 1.2, 7, V3(6, 2.5, -0.5));         // right cool strip
  box(0xffb160, 2.2, 8, 0.8, V3(0, 1.2, -6));           // back warm band
  box(0xfff4e6, 1.8, 3.5, 3.5, V3(2.5, 3, 6));          // front key
  box(0xffffff, 1.2, 10, 0.25, V3(0, 0.2, 6));          // low horizon line
  const pmrem = new THREE.PMREMGenerator(renderer);
  const tex = pmrem.fromScene(env, 0.035).texture;
  pmrem.dispose();
  geo.dispose();
  return tex;
}

/* ============================================================
   Materials
   ============================================================ */
function createMaterials(tex) {
  const chrome = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.07 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xcfcac4, metalness: 1, roughness: 0.24 });
  const body = new THREE.MeshStandardMaterial({ color: 0x0c0b0a, metalness: 0.55, roughness: 0.36 });
  const panel = new THREE.MeshStandardMaterial({ color: 0x050505, metalness: 0.3, roughness: 0.12 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xd2ab70, metalness: 1, roughness: 0.2 });
  const wood = new THREE.MeshStandardMaterial({ map: tex.wood, roughness: 0.42, metalness: 0 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x0f0f0f, roughness: 0.55, metalness: 0.1 });
  const ceramic = new THREE.MeshStandardMaterial({ color: 0xf1ebe2, roughness: 0.2 });
  return { chrome, steel, body, panel, brass, wood, rubber, ceramic };
}

function glowFresnel(material, color, strength, power = 2.4) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGlow = { value: new THREE.Color(color) };
    shader.uniforms.uGlowStrength = { value: strength };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uGlow;\nuniform float uGlowStrength;')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float glowFr = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), ${power.toFixed(2)});
         totalEmissiveRadiance += uGlow * glowFr * uGlowStrength;`
      );
  };
  return material;
}

/* ============================================================
   Espresso machine (procedural)
   ============================================================ */
function buildMachine(M, tex) {
  const g = new THREE.Group();
  const add = (geo, mat, x, y, z, opts = {}) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    if (opts.rx) m.rotation.x = opts.rx;
    if (opts.ry) m.rotation.y = opts.ry;
    if (opts.rz) m.rotation.z = opts.rz;
    m.castShadow = opts.cast !== false;
    m.receiveShadow = opts.receive !== false;
    (opts.parent || g).add(m);
    return m;
  };
  const FZ = -0.45; // front face
  const cz = P.CUP_Z;

  // body + walnut side panels
  add(new RoundedBoxGeometry(2.7, 4.0, 2.3, 5, 0.1), M.body, 0, 1.88, FZ - 1.15);
  add(new RoundedBoxGeometry(0.05, 3.3, 1.85, 2, 0.02), M.wood, -1.375, 1.95, FZ - 1.15);
  add(new RoundedBoxGeometry(0.05, 3.3, 1.85, 2, 0.02), M.wood, 1.375, 1.95, FZ - 1.15);

  // black glass front panel with brass frame
  add(new RoundedBoxGeometry(2.3, 1.05, 0.04, 2, 0.015), M.panel, 0, 3.12, FZ + 0.01);
  const frame = [
    [2.3, 0.014, 0, 3.645], [2.3, 0.014, 0, 2.595],
  ];
  for (const [w, h, x, y] of frame) add(new THREE.BoxGeometry(w, h, 0.02), M.brass, x, y, FZ + 0.03);
  add(new THREE.BoxGeometry(0.014, 1.05, 0.02), M.brass, -1.15, 3.12, FZ + 0.03);
  add(new THREE.BoxGeometry(0.014, 1.05, 0.02), M.brass, 1.15, 3.12, FZ + 0.03);

  // gauges
  const gauges = [];
  const mkGauge = (x, y, map) => {
    const grp = new THREE.Group();
    grp.position.set(x, y, FZ + 0.04);
    g.add(grp);
    add(new THREE.TorusGeometry(0.205, 0.024, 16, 72), M.brass, 0, 0, 0.012, { parent: grp });
    add(new THREE.CircleGeometry(0.2, 64), new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0 }), 0, 0, 0.004, { parent: grp, cast: false });
    const pivot = new THREE.Group();
    pivot.position.z = 0.012;
    grp.add(pivot);
    const needleGeo = new THREE.BoxGeometry(0.009, 0.165, 0.004);
    needleGeo.translate(0, 0.055, 0);
    add(needleGeo, new THREE.MeshStandardMaterial({ color: 0xe0612a, emissive: 0x6a1d05, roughness: 0.4 }), 0, 0, 0, { parent: pivot, cast: false });
    add(new THREE.CylinderGeometry(0.02, 0.02, 0.012, 24), M.brass, 0, 0, 0.004, { parent: pivot, rx: Math.PI / 2, cast: false });
    const glass = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 48, 12, 0, Math.PI * 2, 0, 0.42),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.02, metalness: 0, transparent: true, opacity: 0.12, envMapIntensity: 2.2 })
    );
    glass.rotation.x = Math.PI / 2;
    glass.position.z = -0.16;
    grp.add(glass);
    gauges.push(pivot);
    return pivot;
  };
  const boilerNeedle = mkGauge(-0.66, 3.14, tex.gaugeBoiler);
  const pumpNeedle = mkGauge(0.66, 3.14, tex.gaugePump);

  // name plate + status lamp
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.66, 0.194), new THREE.MeshStandardMaterial({ map: tex.plate, roughness: 0.35, metalness: 0.35 }));
  plate.position.set(0, 3.14, FZ + 0.035);
  g.add(plate);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x1a0d04, emissive: 0xffa040, emissiveIntensity: 2.2 });
  add(new THREE.SphereGeometry(0.022, 16, 12), lampMat, 0, 2.86, FZ + 0.04, { cast: false });

  // --- E61-style group head ---
  add(new THREE.CylinderGeometry(0.16, 0.19, 0.6, 32), M.chrome, 0, 2.2, FZ + 0.25, { rx: Math.PI / 2 });
  add(new THREE.CylinderGeometry(0.3, 0.3, 0.2, 64), M.chrome, 0, 1.975, cz);
  add(new THREE.TorusGeometry(0.3, 0.018, 12, 64), M.chrome, 0, 1.878, cz, { rx: Math.PI / 2 });
  add(new THREE.SphereGeometry(0.25, 48, 16, 0, Math.PI * 2, 0, Math.PI / 2), M.chrome, 0, 2.07, cz);
  add(new THREE.CylinderGeometry(0.085, 0.11, 0.16, 32), M.chrome, 0, 2.36, cz);
  add(new THREE.SphereGeometry(0.09, 32, 16), M.chrome, 0, 2.45, cz);
  // brewing lever
  const lever = new THREE.Group();
  lever.position.set(0, 2.45, cz);
  g.add(lever);
  const armGeo = new THREE.CylinderGeometry(0.017, 0.022, 0.46, 16);
  armGeo.translate(0, 0.23, 0);
  add(armGeo, M.chrome, 0, 0, 0, { parent: lever });
  add(new THREE.SphereGeometry(0.052, 24, 16), M.rubber, 0, 0.47, 0, { parent: lever });

  // --- portafilter ---
  const basketProfile = [
    V3(0, 0), V3(0.19, 0), V3(0.235, 0.025), V3(0.262, 0.1), V3(0.278, 0.19), V3(0.3, 0.198), V3(0.3, 0.215), V3(0, 0.215),
  ].map((v) => new THREE.Vector2(v.x, v.y));
  add(new THREE.LatheGeometry(basketProfile, 64), M.chrome, 0, 1.62, cz);
  add(new RoundedBoxGeometry(0.1, 0.03, 0.07, 2, 0.01), M.chrome, -0.32, 1.815, cz);
  add(new RoundedBoxGeometry(0.1, 0.03, 0.07, 2, 0.01), M.chrome, 0.32, 1.815, cz);
  const handle = new THREE.Group();
  handle.position.set(0, 1.735, cz);
  handle.rotation.y = 0.78;
  handle.rotation.x = -0.12;
  g.add(handle);
  add(new THREE.CylinderGeometry(0.036, 0.042, 0.22, 24), M.chrome, 0, 0, 0.37, { parent: handle, rx: Math.PI / 2 });
  add(new THREE.CylinderGeometry(0.052, 0.058, 0.56, 32), M.wood, 0, 0, 0.75, { parent: handle, rx: Math.PI / 2 });
  const cap = add(new THREE.SphereGeometry(0.059, 24, 16), M.chrome, 0, 0, 1.03, { parent: handle });
  cap.scale.z = 0.55;
  add(new THREE.TorusGeometry(0.05, 0.008, 8, 32), M.brass, 0, 0, 0.475, { parent: handle });

  // spout block + two nozzles (tips at SPOUT_Y)
  add(new RoundedBoxGeometry(0.17, 0.06, 0.1, 2, 0.02), M.chrome, 0, 1.595, cz);
  for (const sx of [-P.SPOUT_X, P.SPOUT_X]) {
    const n = add(new THREE.CylinderGeometry(0.022, 0.016, 0.11, 20), M.chrome, sx, P.SPOUT_Y + 0.055, cz);
    n.rotation.z = sx > 0 ? 0.08 : -0.08;
  }

  // --- steam wand (left) & hot water (right) ---
  const wandCurve = new THREE.CatmullRomCurve3([V3(0.95, 2.45, FZ + 0.02), V3(0.95, 2.45, FZ + 0.28), V3(0.98, 2.28, 0.0), V3(1.02, 1.7, 0.08), V3(1.05, 1.05, 0.1)]);
  add(new THREE.TubeGeometry(wandCurve, 80, 0.022, 14), M.chrome, 0, 0, 0);
  add(new THREE.CylinderGeometry(0.03, 0.026, 0.08, 16), M.chrome, 1.05, 1.02, 0.1);
  const waterCurve = new THREE.CatmullRomCurve3([V3(-0.95, 2.45, FZ + 0.02), V3(-0.95, 2.42, FZ + 0.25), V3(-0.96, 2.2, -0.02), V3(-0.97, 1.9, 0.02)]);
  add(new THREE.TubeGeometry(waterCurve, 60, 0.02, 12), M.chrome, 0, 0, 0);
  for (const sx of [-0.95, 0.95]) {
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 32), M.brass, sx, 2.7, FZ + 0.04, { rx: Math.PI / 2 });
    add(new THREE.CylinderGeometry(0.09, 0.08, 0.14, 32), M.rubber, sx, 2.7, FZ + 0.13, { rx: Math.PI / 2 });
  }

  // --- drip tray with grille ---
  add(new RoundedBoxGeometry(1.75, 0.13, 1.25, 2, 0.035), M.steel, 0, -0.065, cz + 0.02);
  const grille = new THREE.Mesh(
    new THREE.PlaneGeometry(1.62, 1.12),
    new THREE.MeshStandardMaterial({ map: tex.grille, metalness: 0.95, roughness: 0.22 })
  );
  grille.rotation.x = -Math.PI / 2;
  grille.position.set(0, 0.002, cz + 0.02);
  grille.receiveShadow = true;
  g.add(grille);

  // --- cups warming on top ---
  const cupProfile = [V3(0, 0.0), V3(0.13, 0.0), V3(0.15, 0.02), V3(0.19, 0.2), V3(0.2, 0.24), V3(0.18, 0.24), V3(0.17, 0.2), V3(0.13, 0.03), V3(0, 0.03)].map((v) => new THREE.Vector2(v.x, v.y));
  const cupGeo = new THREE.LatheGeometry(cupProfile, 40);
  [-0.75, -0.25, 0.3, 0.8].forEach((x, i) => {
    const c = add(cupGeo, M.ceramic, x, 3.88 + 0.24, FZ - 0.7 - (i % 2) * 0.35);
    c.rotation.x = Math.PI;
  });

  // feet
  for (const [x, z] of [[-1.2, FZ - 0.2], [1.2, FZ - 0.2], [-1.2, FZ - 2.1], [1.2, FZ - 2.1]]) {
    add(new THREE.CylinderGeometry(0.07, 0.09, 0.05, 20), M.chrome, x, -0.105, z);
  }

  return { group: g, lever, boilerNeedle, pumpNeedle, lampMat };
}

/* ============================================================
   Glass cup + liquid
   ============================================================ */
function buildCup(tex) {
  const group = new THREE.Group();
  group.position.set(P.CUP_X, 0, P.CUP_Z);

  const profile = [
    [0, 0], [0.19, 0], [0.225, 0.012], [0.25, 0.05], [0.285, 0.18], [0.318, 0.33], [0.34, 0.45], [0.35, 0.505],
    [0.346, 0.516], [0.336, 0.519], [0.329, 0.51],
    [0.327, 0.5], [0.312, 0.42], [0.297, 0.34], [0.268, 0.22], [0.222, 0.1], [0.2, 0.078], [0.1, 0.075], [0, 0.075],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.035,
    transmission: 1,
    thickness: 0.06,
    ior: 1.47,
    specularIntensity: 1,
    envMapIntensity: 1.35,
    attenuationColor: new THREE.Color(0xfff6ea),
    attenuationDistance: 2.5,
  });
  glowFresnel(glassMat, 0xfff1dc, 0.16, 5.0);
  const glass = new THREE.Mesh(new THREE.LatheGeometry(profile, 96), glassMat);
  glass.renderOrder = 2;
  group.add(glass);

  // liquid body (clipped at the fill line)
  const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), P.CUP.innerBottom);
  const inset = 0.006;
  const lp = [new THREE.Vector2(0, P.CUP.innerBottom + 0.003)];
  for (let i = 0; i <= 24; i++) {
    const y = lerp(P.CUP.innerBottom + 0.003, P.CUP.maxFill + 0.02, i / 24);
    lp.push(new THREE.Vector2(P.innerRadiusAt(y) - inset, y));
  }
  const liquidMat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.28,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    clippingPlanes: [clip],
    side: THREE.DoubleSide,
  });
  const liquidUniforms = {
    uFillY: { value: P.CUP.innerBottom },
    uCrema: { value: 0.01 },
    uBottom: { value: P.CUP.innerBottom },
    uBlond: { value: 0 },
  };
  liquidMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, liquidUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vWY;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWY = (modelMatrix * vec4(transformed, 1.0)).y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWY;\nuniform float uFillY, uCrema, uBottom, uBlond;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float cremaBand = smoothstep(uFillY - uCrema - 0.006, uFillY - uCrema + 0.004, vWY);
         vec3 bodyCol = mix(vec3(0.018, 0.005, 0.002), vec3(0.075, 0.022, 0.007), smoothstep(uBottom, uFillY, vWY));
         vec3 cremaCol = mix(vec3(0.36, 0.15, 0.05), vec3(0.52, 0.29, 0.12), uBlond);
         diffuseColor.rgb = mix(bodyCol, cremaCol, cremaBand);`
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         float lfr = pow(1.0 - saturate(abs(dot(normal, normalize(vViewPosition)))), 2.0);
         totalEmissiveRadiance += vec3(0.55, 0.18, 0.04) * lfr * 0.45 * (1.0 - cremaBand);`
      );
  };
  const liquid = new THREE.Mesh(new THREE.LatheGeometry(lp, 72), liquidMat);
  liquid.renderOrder = 1;
  group.add(liquid);

  // crema surface
  const cremaUniforms = {
    uTau: { value: 0 },
    uRadius: { value: 0.2 },
    uFlow: { value: 0 },
    uLogo: { value: 0 },
    uFillFrac: { value: 0 },
    uBlond: { value: 0 },
    uImp0: { value: new THREE.Vector2() },
    uImp1: { value: new THREE.Vector2() },
    uDrops: { value: Array.from({ length: 6 }, () => new THREE.Vector4(0, 0, -99, 0)) },
    uStencil: { value: tex.stencil },
    uLightDir: { value: V3(0.5, 1.0, 0.6).normalize() },
    uCenter: { value: new THREE.Vector2(P.CUP_X, P.CUP_Z) },
  };
  const cremaMat = new THREE.ShaderMaterial({
    uniforms: cremaUniforms,
    vertexShader: /* glsl */ `
      varying vec3 vWPos;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTau, uRadius, uFlow, uLogo, uFillFrac, uBlond;
      uniform vec2 uImp0, uImp1, uCenter;
      uniform vec4 uDrops[6];
      uniform sampler2D uStencil;
      uniform vec3 uLightDir;
      varying vec3 vWPos;
      ${GLSL_NOISE}
      float heightAt(vec2 p){
        float d0 = length(p - uImp0);
        float d1 = length(p - uImp1);
        float h = (sin(d0*150.0 - uTau*36.0) * exp(-d0*20.0) + sin(d1*150.0 - uTau*36.0 + 1.3) * exp(-d1*20.0)) * uFlow;
        for (int i = 0; i < 6; i++) {
          vec4 d = uDrops[i];
          float age = uTau - d.z;
          if (age > 0.0 && age < 1.4) {
            float dist = length(p - d.xy);
            float R = age * 0.3;
            h += exp(-pow((dist - R) * 60.0, 2.0)) * (1.0 - age / 1.4) * d.w * 1.4;
          }
        }
        return h;
      }
      void main(){
        vec2 p = vWPos.xz - uCenter;
        float r = length(p) / uRadius;
        vec2 q = rot2(uTau * 0.035 + (1.0 - r) * 0.9 * sin(uTau * 0.07)) * p;
        float big = fbm(q * 7.0);
        float mid = fbm(q * 26.0 + 3.0);
        float fleck = fbm(q * 95.0 + 11.0);
        vec3 cDark = mix(vec3(0.2, 0.075, 0.025), vec3(0.3, 0.13, 0.05), uBlond);
        vec3 cLight = mix(vec3(0.44, 0.2, 0.075), vec3(0.58, 0.31, 0.13), uBlond);
        vec3 col = mix(cDark, cLight, 0.35 + 0.55 * smoothstep(0.25, 0.75, big));
        col *= 0.82 + 0.3 * mid;
        col *= 1.0 - 0.38 * smoothstep(0.6, 0.8, fleck);
        col *= 1.0 + 0.18 * (1.0 - r);
        col = mix(col, col * 0.5, smoothstep(0.72, 1.0, r));
        float n2 = fleck;
        float hole = (exp(-length(p - uImp0) * 36.0) + exp(-length(p - uImp1) * 36.0)) * uFlow;
        col = mix(col, vec3(0.03, 0.01, 0.004), clamp(hole, 0.0, 1.0) * 0.85);
        col = mix(vec3(0.05, 0.016, 0.006), col, smoothstep(0.0, 0.14, uFillFrac));

        vec2 suv = vec2(p.x, -p.y) / (uRadius * 1.72) + 0.5;
        float st = texture2D(uStencil, suv).r;
        float grain = 0.65 + 0.35 * vnoise(p * 700.0);
        col = mix(col, vec3(0.09, 0.035, 0.012), st * uLogo * grain * 0.9);

        float e = 0.003;
        float h0 = heightAt(p);
        float hx = heightAt(p + vec2(e, 0.0));
        float hz = heightAt(p + vec2(0.0, e));
        vec3 N = normalize(vec3(-(hx - h0) / e * 0.0035, 1.0, -(hz - h0) / e * 0.0035));
        vec3 V = normalize(cameraPosition - vWPos);
        vec3 L = normalize(uLightDir);
        float diff = 0.6 + 0.55 * max(dot(N, L), 0.0);
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 110.0) * 0.9;
        float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);
        vec3 outc = col * diff * 1.25 + spec * vec3(1.0, 0.9, 0.78) + fres * vec3(0.22, 0.15, 0.1);
        gl_FragColor = vec4(outc, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const crema = new THREE.Mesh(new THREE.CircleGeometry(1, 72), cremaMat);
  crema.rotation.x = -Math.PI / 2;
  crema.visible = false;
  crema.renderOrder = 1;
  // parent to scene space (not the group) so world XZ math is trivial
  return { group, glass, liquid, liquidUniforms, clip, crema, cremaUniforms };
}

/* ============================================================
   Stream: a tube whose every ring is computed from the pour model
   ============================================================ */
const C_DARK = new THREE.Color('#3a170a');
const C_MID = new THREE.Color('#5e2a0f');
const C_TIGER = new THREE.Color('#b8672a');
const C_BLOND = new THREE.Color('#d39a55');

class Stream {
  constructor(side, material) {
    this.side = side;
    this.x0 = side === 0 ? -P.SPOUT_X : P.SPOUT_X;
    this.R = 120;
    this.S = 14;
    const count = this.R * this.S;
    this.pos = new Float32Array(count * 3);
    this.nor = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    const idx = [];
    for (let i = 0; i < this.R - 1; i++) {
      for (let j = 0; j < this.S; j++) {
        const a = i * this.S + j;
        const b = i * this.S + ((j + 1) % this.S);
        const c = (i + 1) * this.S + j;
        const d = (i + 1) * this.S + ((j + 1) % this.S);
        idx.push(a, c, b, b, c, d);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(this.nor, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setIndex(idx);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.cos = new Float32Array(this.S);
    this.sin = new Float32Array(this.S);
    for (let j = 0; j < this.S; j++) {
      this.cos[j] = Math.cos((j / this.S) * Math.PI * 2);
      this.sin[j] = Math.sin((j / this.S) * Math.PI * 2);
    }
    this.impact = new THREE.Vector2();
    this.tmp = new THREE.Color();
  }

  update(tau, surfaceY) {
    const { R, S, pos, nor, col, side } = this;
    const aMax = P.fallTime(P.SPOUT_Y - surfaceY) + 0.012;
    let any = false;
    const c = this.tmp;
    for (let i = 0; i < R; i++) {
      const u = i / (R - 1);
      const a = aMax * u;
      let y = P.SPOUT_Y - P.V0 * a - 0.5 * P.G * a * a;
      const b = tau - a;
      const q = P.flow(b);
      const v = P.V0 + P.G * a;
      let r = 0;
      if (q > 0.004) {
        r = P.R0 * Math.sqrt((q * P.V0) / v);
        const grow = smoothstep(0.2, 0.95, u);
        r *= 1 + 0.2 * grow * Math.sin(b * 44 + side * 2.1) + 0.07 * Math.sin(b * 101 + side * 4.0);
        // thin "thread" when the flow is just starting / ending
        r *= smoothstep(0.004, 0.08, q) * 0.7 + 0.3;
        any = true;
      }
      const conv = 0.5 * smoothstep(0, 1, a / 0.85);
      const x = this.x0 * (1 - conv) + a * (0.02 * Math.sin(b * 2.3 + side * 1.7) + 0.009 * Math.sin(b * 7.1 + side));
      const z = P.CUP_Z + a * (0.014 * Math.cos(b * 1.7 + side * 2.9) + 0.006 * Math.sin(b * 5.3 + side));
      if (i === R - 1) {
        y = surfaceY - 0.012;
        this.impact.set(x - P.CUP_X, z - P.CUP_Z);
      }
      // colour: dark reddish start, tiger stripes, blonde finish
      const blond = P.blonding(b);
      for (let j = 0; j < S; j++) {
        const k = (i * S + j) * 3;
        pos[k] = x + r * this.cos[j];
        pos[k + 1] = y;
        pos[k + 2] = z + r * this.sin[j];
        nor[k] = this.cos[j];
        nor[k + 1] = 0;
        nor[k + 2] = this.sin[j];
        const stripe = smoothstep(0.55, 0.95, 0.5 + 0.5 * Math.sin(b * 23 + j * 0.9 + Math.sin(b * 7) * 2));
        c.copy(C_DARK).lerp(C_MID, 0.5 + 0.5 * Math.sin(b * 3.1 + side)).lerp(C_TIGER, stripe * 0.55).lerp(C_BLOND, blond * 0.85);
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    }
    this.mesh.visible = any;
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.normal.needsUpdate = true;
      this.geo.attributes.color.needsUpdate = true;
    }
    return aMax;
  }
}

/* ============================================================
   Coffee beans (instanced)
   ============================================================ */
function beanGeometry() {
  const g = new THREE.SphereGeometry(1, 30, 22);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const x = v.x * 0.64;
    const y = v.y;
    let z = v.z * 0.52;
    if (z > 0) z *= 0.5;
    const cx = 0.08 * Math.sin(y * 2.4);
    const d = x - cx;
    const crease = Math.exp(-(d * d) / 0.0035) * smoothstep(0.0, 0.3, v.z);
    z -= crease * 0.17;
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  g.scale(0.06, 0.06, 0.06);
  return g;
}

/* ============================================================
   Experience
   ============================================================ */
export class Experience {
  constructor(canvas, { mobile = false, reducedMotion = false } = {}) {
    this.canvas = canvas;
    this.mobile = mobile;
    this.reducedMotion = reducedMotion;
    this.mouse = new THREE.Vector2();
    this.mouseS = new THREE.Vector2();
    this.keyframes = [];
    this.intro = 0;
    this.lastTau = -1;
    this.logo = 0;
    this.frameTimes = [];
    this.dprMax = Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.5);
    this.dpr = this.dprMax;

    const r = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) <= 1.25, powerPreference: 'high-performance', stencil: false });
    if ('transmissionResolutionScale' in r) r.transmissionResolutionScale = 0.5;
    r.setPixelRatio(this.dpr);
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.08;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.shadowMap.autoUpdate = false;
    r.localClippingEnabled = true;
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0a0807);
    this.scene.fog = new THREE.Fog(0x0a0807, 7, 17);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
    this.camTarget = new THREE.Vector3();

    this.build();
    this.resize();
  }

  build() {
    const { scene, renderer } = this;
    scene.environment = studioEnvironment(renderer);
    scene.environmentIntensity = 0.95;

    const tex = {
      wood: TX.woodTexture(512),
      marble: TX.marbleTexture(this.mobile ? 512 : 1024),
      gaugePump: TX.gaugeTexture({ max: 16, label: 'BAR', zone: [8, 10], title: 'POMPĂ' }),
      gaugeBoiler: TX.gaugeTexture({ max: 3, label: 'BAR', zone: [1, 1.5], title: 'BOILER' }),
      plate: TX.plateTexture(),
      grille: TX.grilleTexture(),
      stencil: TX.stencilTexture(),
      sprite: TX.spriteTexture(),
    };
    tex.marble.repeat.set(3, 3);
    this.tex = tex;
    const M = createMaterials(tex);
    this.M = M;

    // lights
    const key = new THREE.SpotLight(0xffe2c4, 150, 0, 0.52, 0.85, 2);
    key.position.set(3.2, 5.8, 4.2);
    key.target.position.set(0, 1.0, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(this.mobile ? 512 : 1024, this.mobile ? 512 : 1024);
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.02;
    key.shadow.camera.near = 3;
    key.shadow.camera.far = 14;
    scene.add(key, key.target);
    const rimL = new THREE.DirectionalLight(0xffc28a, 2.2);
    rimL.position.set(-4, 3.5, -3.5);
    const rimR = new THREE.DirectionalLight(0xbfd2ff, 1.3);
    rimR.position.set(4.5, 2.5, -3);
    const hemi = new THREE.HemisphereLight(0x3b2d23, 0x050403, 0.8);
    this.brewLight = new THREE.PointLight(0xffa252, 0.9, 1.3, 1.2);
    this.brewLight.position.set(0.1, 0.95, 0.85);
    scene.add(rimL, rimR, hemi, this.brewLight);

    // counter
    const counter = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ map: tex.marble, roughness: 0.3, metalness: 0.0, envMapIntensity: 0.55 })
    );
    counter.rotation.x = -Math.PI / 2;
    counter.position.y = -0.13;
    counter.receiveShadow = true;
    scene.add(counter);

    // machine
    this.machine = buildMachine(M, tex);
    scene.add(this.machine.group);

    // cup + liquid
    this.cup = buildCup(tex);
    scene.add(this.cup.group, this.cup.crema);

    // coffee streams
    const streamMat = glowFresnel(
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.14, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.8 }),
      0xff9440,
      1.1
    );
    this.streams = [new Stream(0, streamMat), new Stream(1, streamMat)];
    this.streams.forEach((s) => scene.add(s.mesh));

    // drips + splashes
    const dropMat = glowFresnel(
      new THREE.MeshPhysicalMaterial({ color: 0x3a1809, roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.8 }),
      0xff8a3a,
      0.7
    );
    this.drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 20, 14), dropMat, 24);
    this.splash = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), dropMat, 180);
    for (const m of [this.drops, this.splash]) {
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      scene.add(m);
    }
    this.dummy = new THREE.Object3D();

    this.buildBeans();
    this.buildDust();
    this.buildSteam();

    this.renderer.shadowMap.needsUpdate = true;
  }

  buildBeans() {
    const count = this.mobile ? 36 : 70;
    const mat = new THREE.MeshStandardMaterial({ color: 0x4a2612, roughness: 0.3, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(beanGeometry(), mat, count);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.castShadow = false;
    mesh.frustumCulled = false;
    const data = [];
    for (let i = 0; i < count; i++) {
      let x;
      let z;
      let tries = 0;
      do {
        x = (hash(i * 1.7 + 3 + tries * 17.3) - 0.5) * 9;
        z = -3.8 + hash(i * 2.3 + 9 + tries * 29.1) * 5.2;
        tries++;
      } while (Math.abs(x) < 1.25 && z > -2.4 && tries < 40);
      data.push({
        x,
        z,
        y0: hash(i * 3.1 + 1) * 9,
        speed: 0.6 + hash(i * 5.7) * 0.9,
        rx: hash(i * 7.3) * 6.28,
        ry: hash(i * 8.9) * 6.28,
        spin: (hash(i * 4.4) - 0.5) * 0.8,
        s: 0.75 + hash(i * 9.9) * 0.6,
      });
    }
    this.beans = { mesh, data, spinAcc: 0 };
    this.scene.add(mesh);
  }

  buildDust() {
    const count = this.mobile ? 180 : 320;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (hash(i * 1.3) - 0.5) * 6.5;
      pos[i * 3 + 1] = -0.2 + hash(i * 2.9) * 0.3;
      pos[i * 3 + 2] = -2.5 + hash(i * 4.1) * 5;
      seed[i] = hash(i * 6.7);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uPR: { value: this.dpr },
        uSize: { value: 26 },
        uMap: { value: this.tex.sprite },
        uColor: { value: new THREE.Color(0xffd7a8) },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        uniform float uTime, uPR, uSize;
        varying float vA;
        void main(){
          vec3 p = position;
          float rise = mod(uTime * 0.035 * (0.4 + aSeed) + aSeed * 4.5, 4.5);
          p.y += rise;
          p.x += sin(uTime * 0.08 + aSeed * 6.28) * 0.3;
          p.z += cos(uTime * 0.06 + aSeed * 12.0) * 0.3;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_PointSize = uSize * uPR * (0.35 + aSeed * 0.9) / -mv.z;
          float tw = 0.45 + 0.55 * sin(uTime * (0.5 + aSeed * 1.4) + aSeed * 40.0);
          vA = tw * smoothstep(14.0, 2.5, -mv.z) * smoothstep(0.25, 0.9, -mv.z) * smoothstep(0.0, 0.5, rise) * (1.0 - smoothstep(4.0, 4.5, rise));
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uColor;
        varying float vA;
        void main(){
          float a = texture2D(uMap, gl_PointCoord).r * vA * 0.55;
          gl_FragColor = vec4(uColor * a, a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);
  }

  buildSteam() {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uStrength: { value: 0 }, uSeed: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uStrength, uSeed;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main(){
          vec2 uv = vUv;
          float width = mix(0.1, 0.42, uv.y);
          float wob = (fbm(vec2(uv.y * 2.2 - uTime * 0.22, uTime * 0.08 + uSeed)) - 0.5) * 0.5 * uv.y;
          float d = abs(uv.x - 0.5 - wob) / width;
          float body = 1.0 - smoothstep(0.0, 1.0, d);
          float n = fbm(vec2(uv.x * 3.0 + uSeed, uv.y * 2.6 - uTime * 0.32));
          float a = body * smoothstep(0.38, 0.8, n) * smoothstep(0.0, 0.18, uv.y) * (1.0 - smoothstep(0.5, 1.0, uv.y));
          gl_FragColor = vec4(vec3(1.0, 0.95, 0.9), a * uStrength);
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.steam = [0, 1].map((i) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 1.0), mat.clone());
      m.material.uniforms.uSeed.value = i * 3.7;
      m.position.set(P.CUP_X + (i ? 0.06 : -0.05), 0.52 + 0.5, P.CUP_Z + (i ? -0.03 : 0.03));
      m.renderOrder = 5;
      this.scene.add(m);
      return m;
    });
  }

  /* ------------------------------------------------------------ */
  setKeyframes(frames) {
    this.keyframes = frames;
  }

  setMouse(x, y) {
    this.mouse.set(x, y);
  }

  setLogo(v) {
    this.logo = v;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.portrait = w / h < 0.95;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- camera rig ---------------- */
  updateCamera(p, time) {
    const kf = this.keyframes;
    if (!kf.length) return;
    let i = 0;
    while (i < kf.length - 2 && p > kf[i + 1].p) i++;
    const a = kf[i];
    const b = kf[Math.min(i + 1, kf.length - 1)];
    const span = Math.max(b.p - a.p, 1e-5);
    let t = clamp((p - a.p) / span, 0, 1);
    t = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const pa = kf[Math.max(i - 1, 0)].pose;
    const pb = a.pose;
    const pc = b.pose;
    const pd = kf[Math.min(i + 2, kf.length - 1)].pose;
    const cr = (k, j) => catmull(pa[k][j], pb[k][j], pc[k][j], pd[k][j], t);

    const pos = this._pos || (this._pos = new THREE.Vector3());
    const tgt = this._tgt || (this._tgt = new THREE.Vector3());
    pos.set(cr('pos', 0), cr('pos', 1), cr('pos', 2));
    tgt.set(cr('tgt', 0), cr('tgt', 1), cr('tgt', 2));
    let shiftX = lerp(pb.shift || 0, pc.shift || 0, t);
    let shiftY = lerp(pb.shiftY || 0, pc.shiftY || 0, t);
    const fov = lerp(pb.fov || 30, pc.fov || 30, t);

    if (this.portrait) {
      const aspect = this.w / this.h;
      const k = clamp(1.05 / aspect, 1, 2.1);
      pos.sub(tgt).multiplyScalar(k).add(tgt);
      shiftX = 0;
      shiftY = 0.16;
    }
    // cinematic push-in after the preloader
    const intro = 1 - this.intro;
    if (intro > 0) {
      pos.sub(tgt).multiplyScalar(1 + intro * 1.1).add(tgt);
      pos.y += intro * 0.9;
    }

    // mouse parallax + idle breathing
    this.mouseS.lerp(this.mouse, 0.06);
    const cam = this.camera;
    cam.position.copy(pos);
    cam.lookAt(tgt);
    const right = this._right || (this._right = new THREE.Vector3());
    const up = this._up || (this._up = new THREE.Vector3());
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    const m = this.reducedMotion ? 0 : 1;
    const dist = pos.distanceTo(tgt);
    cam.position
      .addScaledVector(right, (this.mouseS.x * 0.035 * dist + Math.sin(time * 0.35) * 0.012) * m)
      .addScaledVector(up, (this.mouseS.y * 0.022 * dist + Math.sin(time * 0.27) * 0.01) * m);
    cam.lookAt(tgt);
    if (cam.fov !== fov) {
      cam.fov = fov;
    }
    cam.setViewOffset(this.w, this.h, -shiftX * this.w, shiftY * this.h, this.w, this.h);
    cam.updateProjectionMatrix();
  }

  /* ---------------- pour ---------------- */
  updatePour(tau) {
    const frac = P.fillFraction(tau);
    const surfaceY = frac > 0.0015 ? P.fillHeight(frac) : P.CUP.innerBottom;
    this.fillFrac = frac;

    let aFall = 0;
    for (const s of this.streams) aFall = s.update(tau, surfaceY);

    // liquid body + crema surface
    const { cup } = this;
    cup.clip.constant = surfaceY;
    cup.liquid.visible = frac > 0.0015;
    cup.liquidUniforms.uFillY.value = surfaceY;
    cup.liquidUniforms.uCrema.value = 0.006 + 0.03 * smoothstep(0.02, 0.6, frac);
    cup.liquidUniforms.uBlond.value = P.blonding(tau - aFall);
    const rad = P.innerRadiusAt(surfaceY) - 0.006;
    cup.crema.visible = frac > 0.0015;
    cup.crema.position.set(P.CUP_X, surfaceY, P.CUP_Z);
    cup.crema.scale.setScalar(rad);
    const cu = cup.cremaUniforms;
    cu.uTau.value = tau;
    cu.uRadius.value = rad;
    cu.uFillFrac.value = frac;
    cu.uBlond.value = P.blonding(tau - aFall);
    const arriving = P.flow(tau - aFall);
    cu.uFlow.value = clamp(arriving, 0, 1);
    cu.uImp0.value.copy(this.streams[0].impact);
    cu.uImp1.value.copy(this.streams[1].impact);

    // drips + splashes
    const d = this.dummy;
    let nd = 0;
    let ns = 0;
    const dropSlots = cu.uDrops.value;
    let slot = 0;
    const ys = P.SPOUT_Y - 0.012;
    const vd = 0.04;
    for (const dr of P.DRIPS) {
      const a = tau - dr.b;
      if (a < -0.4) continue;
      const x = dr.s === 0 ? -P.SPOUT_X : P.SPOUT_X;
      const size = P.R0 * 1.25 * dr.size;
      const aImp = (-vd + Math.sqrt(vd * vd + 2 * P.G * (ys - surfaceY))) / P.G;
      if (a < 0) {
        // drop forming at the nozzle
        const k = Math.cbrt((a + 0.4) / 0.4);
        const s = size * k;
        d.position.set(x, P.SPOUT_Y - s * 0.9, P.CUP_Z);
        d.scale.set(s, s * 1.15, s);
        d.updateMatrix();
        if (nd < 24) this.drops.setMatrixAt(nd++, d.matrix);
      } else if (a < aImp) {
        const y = ys - vd * a - 0.5 * P.G * a * a;
        const stretch = 1 + 0.9 * Math.exp(-a * 9);
        d.position.set(x * (1 - 0.3 * smoothstep(0, 0.8, a)), y, P.CUP_Z);
        d.scale.set(size / Math.sqrt(stretch), size * stretch, size / Math.sqrt(stretch));
        d.updateMatrix();
        if (nd < 24) this.drops.setMatrixAt(nd++, d.matrix);
      } else {
        const age = a - aImp;
        const ix = x * 0.7;
        if (age < 1.4 && slot < 6) {
          dropSlots[slot++].set(ix - P.CUP_X, 0, tau - age, dr.size);
        }
        if (age < 0.55) {
          // crown
          for (let c = 0; c < 8; c++) {
            const phi = (c / 8) * Math.PI * 2 + hash(dr.b * 13 + c) * 0.6;
            const hs = 0.16 + 0.1 * hash(dr.b * 7 + c);
            const vy = 0.45 + 0.25 * hash(dr.b * 3 + c);
            const y = surfaceY + vy * age - 0.5 * P.G * age * age;
            if (y < surfaceY - 0.005) continue;
            const s = 0.006 * dr.size * (1 - age / 0.55);
            d.position.set(ix + Math.cos(phi) * hs * age, y, P.CUP_Z + Math.sin(phi) * hs * age);
            d.scale.setScalar(s);
            d.updateMatrix();
            if (ns < 180) this.splash.setMatrixAt(ns++, d.matrix);
          }
          // Worthington jet
          const ja = age - 0.07;
          if (ja > 0) {
            const y = surfaceY + 0.7 * ja - 0.5 * P.G * ja * ja;
            if (y > surfaceY) {
              const s = 0.011 * dr.size;
              d.position.set(ix, y, P.CUP_Z);
              d.scale.set(s, s * 1.4, s);
              d.updateMatrix();
              if (ns < 180) this.splash.setMatrixAt(ns++, d.matrix);
            }
          }
        }
      }
    }
    for (; slot < 6; slot++) dropSlots[slot].set(0, 0, -99, 0);

    // continuous-stream splatter (deterministic bins)
    const w = 0.03;
    const k0 = Math.floor((tau - 0.5) / w);
    const k1 = Math.floor(tau / w);
    for (let k = Math.max(k0, 0); k <= k1; k++) {
      const tk = k * w;
      const q = P.flow(tk - aFall);
      if (q < 0.2) continue;
      for (let s = 0; s < 2; s++) {
        const h1 = hash(k * 3.17 + s * 11.3);
        if (h1 > 0.5 * q) continue;
        const imp = this.streams[s].impact;
        const phi = hash(k * 5.1 + s) * Math.PI * 2;
        const hs = 0.08 + 0.22 * hash(k * 7.9 + s * 3);
        const vy = 0.3 + 0.5 * hash(k * 2.3 + s * 5) * q;
        const age = tau - tk;
        const y = surfaceY + vy * age - 0.5 * P.G * age * age;
        if (y < surfaceY) continue;
        const px = imp.x + Math.cos(phi) * hs * age;
        const pz = imp.y + Math.sin(phi) * hs * age;
        if (px * px + pz * pz > Math.pow(P.innerRadiusAt(y) - 0.01, 2)) continue;
        const sz = 0.0035 + 0.005 * hash(k * 9.7 + s);
        d.position.set(px + P.CUP_X, y, pz + P.CUP_Z);
        d.scale.setScalar(sz);
        d.updateMatrix();
        if (ns < 180) this.splash.setMatrixAt(ns++, d.matrix);
      }
    }
    this.drops.count = nd;
    this.splash.count = ns;
    this.drops.instanceMatrix.needsUpdate = true;
    this.splash.instanceMatrix.needsUpdate = true;

    // machine feedback: pump gauge, lever, brew light
    const pres = P.pressure(tau);
    const gaugeAngle = (v, max) => -((Math.PI * 0.75 + (v / max) * Math.PI * 1.5) + Math.PI / 2);
    this.machine.pumpNeedle.rotation.z = gaugeAngle(pres, 16);
    this.machine.boilerNeedle.rotation.z = gaugeAngle(1.2 + 0.03 * Math.sin(tau * 2.1), 3);
    const brewing = smoothstep(0.0, 0.5, tau) * (1 - smoothstep(28.5, 30, tau));
    const leverAngle = lerp(1.25, 0.12, brewing);
    if (Math.abs(this.machine.lever.rotation.x - leverAngle) > 0.001) {
      this.machine.lever.rotation.x = leverAngle;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.brewLight.intensity = 0.6 + 1.2 * brewing;
    return { frac, pressure: pres, surfaceY, arriving };
  }

  updateBeans(time, progress, velocity) {
    const { mesh, data } = this.beans;
    const d = this.dummy;
    this.beans.spinAcc += Math.min(Math.abs(velocity), 80) * 0.0009;
    const L = 9;
    const y0 = -2.2;
    for (let i = 0; i < data.length; i++) {
      const b = data[i];
      let y = (b.y0 + progress * 7.5 * b.speed) % L;
      y = y0 + y;
      const edge = smoothstep(y0, y0 + 1.0, y) * (1 - smoothstep(y0 + L - 1.0, y0 + L, y));
      d.position.set(b.x + Math.sin(time * 0.2 + i) * 0.05, y + Math.sin(time * 0.5 + i * 1.7) * 0.04, b.z);
      const spin = time * 0.15 * b.spin + this.beans.spinAcc * b.spin;
      d.rotation.set(b.rx + spin, b.ry + spin * 0.7, spin * 0.4);
      d.scale.setScalar(b.s * edge);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }

  /* ---------------- frame ---------------- */
  update(dt, time, scroll) {
    const tau = scroll.tau;
    let info = this.lastInfo;
    if (Math.abs(tau - this.lastTau) > 1e-5 || !info) {
      info = this.updatePour(tau);
      this.lastTau = tau;
      this.lastInfo = info;
    }
    this.cup.cremaUniforms.uLogo.value += (this.logo - this.cup.cremaUniforms.uLogo.value) * Math.min(dt * 2.2, 1);

    this.updateBeans(time, scroll.progress, scroll.velocity);
    this.dust.material.uniforms.uTime.value = time;

    const steamStrength = smoothstep(0.03, 0.35, this.fillFrac || 0) * 0.32;
    for (const s of this.steam) {
      s.material.uniforms.uTime.value = time;
      s.material.uniforms.uStrength.value = steamStrength;
      s.rotation.y = Math.atan2(this.camera.position.x - s.position.x, this.camera.position.z - s.position.z);
      s.position.y = (this.lastInfo ? this.lastInfo.surfaceY : 0.1) + 0.55;
      s.visible = steamStrength > 0.005;
    }

    this.updateCamera(scroll.progress, time);
    this.renderer.render(this.scene, this.camera);
    this.adaptQuality(dt);
    return info;
  }

  adaptQuality(dt) {
    const ft = this.frameTimes;
    ft.push(dt);
    if (ft.length < 90) return;
    const avg = ft.reduce((a, b) => a + b, 0) / ft.length;
    ft.length = 0;
    if (avg > 1 / 50 && this.dpr > 0.8) {
      this.dpr = Math.max(0.8, this.dpr - 0.2);
      this.renderer.setPixelRatio(this.dpr);
      this.dust.material.uniforms.uPR.value = this.dpr;
    } else if (avg < 1 / 58 && this.dpr < this.dprMax) {
      this.dpr = Math.min(this.dprMax, this.dpr + 0.125);
      this.renderer.setPixelRatio(this.dpr);
      this.dust.material.uniforms.uPR.value = this.dpr;
    }
  }

  compile() {
    this.updatePour(0);
    this.updateCamera(0, 0);
    this.renderer.compile(this.scene, this.camera);
    this.renderer.render(this.scene, this.camera);
  }
}

function catmull(p0, p1, p2, p3, t) {
  const v0 = (p2 - p0) * 0.5;
  const v1 = (p3 - p1) * 0.5;
  const t2 = t * t;
  const t3 = t2 * t;
  return (2 * p1 - 2 * p2 + v0 + v1) * t3 + (-3 * p1 + 3 * p2 - 2 * v0 - v1) * t2 + v0 * t + p1;
}

export const POSES = {
  hero: { pos: [1.3, 1.98, 2.4], tgt: [0, 1.6, 0.08], shift: 0.2, fov: 30 },
  stream: { pos: [-1.1, 1.12, 2.5], tgt: [0, 0.92, 0.08], shift: -0.2, fov: 30 },
  wide: { pos: [3.3, 2.7, 7.2], tgt: [0, 1.6, -0.35], shift: 0.2, fov: 30 },
  beans: { pos: [-1.95, 0.82, 2.6], tgt: [0, 0.55, 0.08], shift: -0.2, fov: 30 },
  cup: { pos: [1.75, 0.78, 2.25], tgt: [0, 0.34, 0.08], shift: 0.24, fov: 30 },
  top: { pos: [-0.16, 1.78, 1.32], tgt: [0, 0.26, 0.08], shift: 0, shiftY: 0.14, fov: 32 },
};
