import * as THREE from 'three';

/* ---------------------------------------------------------
   Tiny seeded gradient noise (enough for procedural textures)
   --------------------------------------------------------- */
export function createNoise(seed = 7) {
  const perm = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const GX = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071];
  const GY = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const noise = (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const X = xi & 255;
    const Y = yi & 255;
    const xf = x - xi;
    const yf = y - yi;
    const h00 = perm[perm[X] + Y] & 7;
    const h10 = perm[perm[X + 1] + Y] & 7;
    const h01 = perm[perm[X] + Y + 1] & 7;
    const h11 = perm[perm[X + 1] + Y + 1] & 7;
    const n00 = GX[h00] * xf + GY[h00] * yf;
    const n10 = GX[h10] * (xf - 1) + GY[h10] * yf;
    const n01 = GX[h01] * xf + GY[h01] * (yf - 1);
    const n11 = GX[h11] * (xf - 1) + GY[h11] * (yf - 1);
    const u = fade(xf);
    const v = fade(yf);
    return (n00 + (n10 - n00) * u) + ((n01 + (n11 - n01) * u) - (n00 + (n10 - n00) * u)) * v;
  };
  noise.fbm = (x, y, oct = 4) => {
    let a = 0.5;
    let f = 1;
    let sum = 0;
    for (let i = 0; i < oct; i++) {
      sum += a * noise(x * f, y * f);
      f *= 2.02;
      a *= 0.5;
    }
    return sum;
  };
  return noise;
}

const makeCanvas = (w, h) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const toTexture = (canvas, { srgb = true, repeat = false, aniso = 8 } = {}) => {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
};

const mix = (a, b, t) => a + (b - a) * t;

/* ---------------- Walnut wood ---------------- */
export function woodTexture(size = 512) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = createNoise(11);
  const dark = [44, 26, 15];
  const mid = [96, 60, 36];
  const light = [138, 92, 58];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const warp = n.fbm(x * 0.0025, y * 0.008, 4) * 2.4;
      const rings = 0.5 + 0.5 * Math.sin((y * 0.06 + warp) * Math.PI);
      const fine = n(x * 0.02, y * 0.6) * 0.5 + 0.5;
      const t = Math.pow(rings, 2.2) * 0.75 + fine * 0.25;
      const k = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const c0 = t < 0.5 ? dark : mid;
      const c1 = t < 0.5 ? mid : light;
      const i = (y * size + x) * 4;
      img.data[i] = mix(c0[0], c1[0], k);
      img.data[i + 1] = mix(c0[1], c1[1], k);
      img.data[i + 2] = mix(c0[2], c1[2], k);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c);
}

/* ---------------- Black marble counter ---------------- */
export function marbleTexture(size = 1024) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const n = createNoise(23);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const v = y / size;
      const t = n.fbm(u * 3.2, v * 3.2, 5);
      const vein1 = Math.abs(Math.sin((u * 2.2 + v * 1.3 + t * 2.6) * Math.PI * 2));
      const vein2 = Math.abs(Math.sin((u * -1.4 + v * 3.1 + t * 3.4) * Math.PI * 3));
      const a = Math.pow(1 - Math.min(vein1 * 9, 1), 3) * 0.9;
      const b = Math.pow(1 - Math.min(vein2 * 14, 1), 3) * 0.45;
      const cloud = n.fbm(u * 9, v * 9, 3) * 0.5 + 0.5;
      const base = 10 + cloud * 12;
      const i = (y * size + x) * 4;
      // warm grey / faint gold veins on near-black stone
      img.data[i] = base + a * 110 + b * 60;
      img.data[i + 1] = base * 0.95 + a * 92 + b * 52;
      img.data[i + 2] = base * 0.9 + a * 66 + b * 44;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(c, { repeat: true });
}

/* ---------------- Pressure gauge face ---------------- */
export function gaugeTexture({ max = 16, label = 'BAR', zone = [8, 10], title = 'POMPĂ' } = {}) {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const cx = S / 2;
  const cy = S / 2;
  const g = ctx.createRadialGradient(cx, cy * 0.8, 20, cx, cy, S / 2);
  g.addColorStop(0, '#1d1814');
  g.addColorStop(1, '#0b0908');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, S / 2, 0, Math.PI * 2);
  ctx.fill();

  const a0 = Math.PI * 0.75;
  const a1 = Math.PI * 2.25;
  const angle = (v) => a0 + (v / max) * (a1 - a0);

  // coloured zone
  ctx.lineWidth = 16;
  ctx.strokeStyle = '#c9a36a';
  ctx.beginPath();
  ctx.arc(cx, cy, S * 0.41, angle(zone[0]), angle(zone[1]));
  ctx.stroke();

  for (let v = 0; v <= max; v += 0.5) {
    const a = angle(v);
    const major = v % 2 === 0;
    const r1 = S * 0.44;
    const r2 = major ? S * 0.37 : S * 0.405;
    ctx.strokeStyle = major ? '#f3ece1' : 'rgba(243,236,225,0.55)';
    ctx.lineWidth = major ? 5 : 2.5;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    ctx.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    ctx.stroke();
    if (major) {
      ctx.fillStyle = '#f3ece1';
      ctx.font = '500 34px "IBM Plex Mono", monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(v), cx + Math.cos(a) * S * 0.3, cy + Math.sin(a) * S * 0.3);
    }
  }
  ctx.fillStyle = '#c9a36a';
  ctx.font = 'italic 400 40px "Fraunces", serif';
  ctx.textAlign = 'center';
  ctx.fillText('EdSpresso', cx, cy + S * 0.17);
  ctx.fillStyle = 'rgba(243,236,225,0.6)';
  ctx.font = '500 22px "IBM Plex Mono", monospace';
  ctx.fillText(`${label} · ${title}`, cx, cy + S * 0.27);
  return toTexture(c);
}

/* ---------------- Brass name plate ---------------- */
export function plateTexture() {
  const W = 1024;
  const H = 300;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#0b0a09';
  ctx.fillRect(0, 0, W, H);
  // brushed lines
  for (let i = 0; i < 1400; i++) {
    const y = Math.random() * H;
    ctx.strokeStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    ctx.lineWidth = Math.random() * 1.5;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y + (Math.random() - 0.5) * 2);
    ctx.stroke();
  }
  const grad = ctx.createLinearGradient(0, 60, 0, 220);
  grad.addColorStop(0, '#f2d8a6');
  grad.addColorStop(0.5, '#c9a36a');
  grad.addColorStop(1, '#8a6a3c');
  ctx.fillStyle = grad;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '400 150px "Fraunces", serif';
  ctx.fillText('EdSpresso', W / 2, H * 0.46);
  ctx.font = '500 26px "IBM Plex Mono", monospace';
  ctx.fillStyle = 'rgba(230,200,148,0.75)';
  ctx.fillText('EST. 2026  ·  CLUJ-NAPOCA', W / 2, H * 0.84);
  ctx.strokeStyle = 'rgba(201,163,106,0.6)';
  ctx.lineWidth = 3;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  return toTexture(c);
}

/* ---------------- Drip tray grille ---------------- */
export function grilleTexture() {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#b9b6b1';
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = '#0c0b0a';
  const slots = 11;
  const pad = 36;
  const gap = (S - pad * 2) / slots;
  for (let i = 0; i < slots; i++) {
    const x = pad + i * gap + gap * 0.25;
    const w = gap * 0.5;
    const r = w / 2;
    ctx.beginPath();
    ctx.moveTo(x + r, pad);
    ctx.lineTo(x + w - r, pad);
    ctx.arc(x + w - r, pad + r, r, -Math.PI / 2, 0);
    ctx.lineTo(x + w, S - pad - r);
    ctx.arc(x + r, S - pad - r, r, 0, Math.PI);
    ctx.lineTo(x, pad + r);
    ctx.arc(x + r, pad + r, r, Math.PI, Math.PI * 1.5);
    ctx.fill();
  }
  return toTexture(c);
}

/* ---------------- Cocoa stencil logo (white = cocoa) ---------------- */
export function stencilTexture() {
  const S = 512;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = '#fff';
  ctx.fillStyle = '#fff';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.arc(S / 2, S / 2, S * 0.36, 0, Math.PI * 2);
  ctx.stroke();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'italic 300 250px "Fraunces", serif';
  ctx.fillText('E', S / 2 + 6, S / 2 + 6);
  // curved label
  ctx.font = '500 26px "IBM Plex Mono", monospace';
  const text = '·  EDSPRESSO  ·  SLOW COFFEE  ·  CLUJ  ';
  const R = S * 0.43;
  for (let i = 0; i < text.length; i++) {
    const a = -Math.PI / 2 + (i / text.length) * Math.PI * 2;
    ctx.save();
    ctx.translate(S / 2 + Math.cos(a) * R, S / 2 + Math.sin(a) * R);
    ctx.rotate(a + Math.PI / 2);
    ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }
  const t = toTexture(c, { srgb: false });
  return t;
}

/* ---------------- Soft round sprite for particles ---------------- */
export function spriteTexture() {
  const S = 64;
  const c = makeCanvas(S, S);
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return toTexture(c, { srgb: false });
}

/* ---------------- Film grain for the CSS overlay ---------------- */
export function grainDataURL(size = 180) {
  const c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.random() * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
