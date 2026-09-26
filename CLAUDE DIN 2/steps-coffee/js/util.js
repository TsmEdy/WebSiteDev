export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const hash = (n) => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
};

/** Seeded 2D gradient noise + fbm (for terrain & textures). */
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
    const a = n00 + (n10 - n00) * u;
    const b = n01 + (n11 - n01) * u;
    return a + (b - a) * v;
  };
  noise.fbm = (x, y, oct = 4) => {
    let amp = 0.5;
    let f = 1;
    let sum = 0;
    for (let i = 0; i < oct; i++) {
      sum += amp * noise(x * f, y * f);
      f *= 2.03;
      amp *= 0.5;
    }
    return sum;
  };
  return noise;
}

export function grainDataURL(size = 200) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
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
