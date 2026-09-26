/**
 * Deterministic espresso-pour model.
 *
 * Everything is a pure function of the simulation time `tau`, and tau is a
 * pure function of scroll position. That gives us:
 *   - scroll fast  -> time runs fast (stream rushes)
 *   - stop         -> time freezes (stream hangs mid-air)
 *   - scroll back  -> time rewinds (coffee flows back up)
 * with zero accumulated state, so it can never drift or glitch.
 */

export const TAU_END = 31;          // sim-seconds mapped to the whole page
export const SHOT_TIME = 28;        // what the HUD calls a "full shot"
export const SPOUT_Y = 1.45;        // nozzle tip height
export const SPOUT_X = 0.052;       // half distance between the two nozzles
export const CUP_X = 0;
export const CUP_Z = 0.08;
export const G = 3.2;               // sim gravity (units / s^2)
export const V0 = 0.3;              // exit speed of the stream
export const R0 = 0.021;            // stream radius at the nozzle for flow = 1

// glass cup inner cavity (lathe profile, radius by height)
export const CUP = {
  innerBottom: 0.075,
  maxFill: 0.425,
  rim: 0.515,
  profile: [ // [y, innerRadius]
    [0.075, 0.2],
    [0.1, 0.222],
    [0.22, 0.268],
    [0.34, 0.297],
    [0.42, 0.312],
    [0.5, 0.327],
  ],
};

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

export function innerRadiusAt(y) {
  const p = CUP.profile;
  if (y <= p[0][0]) return p[0][1];
  for (let i = 1; i < p.length; i++) {
    if (y <= p[i][0]) {
      const t = (y - p[i - 1][0]) / (p[i][0] - p[i - 1][0]);
      return lerp(p[i - 1][1], p[i][1], t);
    }
  }
  return p[p.length - 1][1];
}

/** Continuous stream flow (0..~1.1) for fluid that left the nozzle at time b. */
export function flow(b) {
  if (b <= 0) return 0;
  const ramp = smoothstep(2.5, 4.8, b);
  const tail = 1 - smoothstep(22.8, 26.4, b);
  if (ramp * tail <= 0) return 0;
  const pulse = 1 + 0.07 * Math.sin(b * 1.9) + 0.045 * Math.sin(b * 4.7 + 1.3) + 0.03 * Math.sin(b * 9.1 + 0.4);
  return ramp * tail * pulse;
}

/** Colour phase of the extraction: 0 = dark/red start, 1 = blonde finish. */
export function blonding(b) {
  return smoothstep(17, 26, b);
}

/** Pressure (bar) shown by the pump gauge. */
export function pressure(tau) {
  const up = smoothstep(0.0, 3.2, tau);
  const down = 1 - smoothstep(27.4, 29.6, tau);
  return 9 * up * down + 0.12 * Math.sin(tau * 7.3) * up * down;
}

export function fallTime(dy) {
  return (-V0 + Math.sqrt(V0 * V0 + 2 * G * Math.max(dy, 0))) / G;
}

/** Discrete drips: pre-infusion at the start and the tail at the end. */
export const DRIPS = (() => {
  const list = [];
  let t = 0.3;
  let i = 0;
  while (t < 2.9) {
    list.push({ b: t, s: i % 2, size: 0.85 + 0.35 * hash(i * 3.1 + 1) });
    t += 0.62 - 0.28 * (t / 3) + 0.12 * hash(i * 7.7);
    i++;
  }
  t = 26.0;
  while (t < 30.4) {
    list.push({ b: t, s: i % 2, size: 0.7 + 0.45 * hash(i * 5.3 + 2) });
    t += 0.24 + 0.16 * (t - 26) + 0.12 * hash(i * 1.9);
    i++;
  }
  return list;
})();

/* -----------------------------------------------------------
   Fill table: cumulative arrived volume -> liquid height
   ----------------------------------------------------------- */
const DT = 0.01;
const N = Math.ceil((TAU_END + 2) / DT);
const cumulative = new Float32Array(N + 1);
const A_REF = fallTime(SPOUT_Y - (CUP.innerBottom + CUP.maxFill) * 0.5);

(() => {
  // continuous stream (two nozzles) + drips as small impulses
  const dripVol = new Float32Array(N + 1);
  for (const d of DRIPS) {
    const k = Math.round((d.b + A_REF) / DT);
    if (k >= 0 && k <= N) dripVol[k] += 0.02 * d.size;
  }
  let acc = 0;
  for (let k = 0; k <= N; k++) {
    const tArr = k * DT;
    acc += 2 * flow(tArr - A_REF) * DT + dripVol[k];
    cumulative[k] = acc;
  }
})();
const TOTAL = cumulative[N];

// volume(height) table for the tapered cavity, used to invert fraction -> y
const H_STEPS = 200;
const volAt = new Float32Array(H_STEPS + 1);
(() => {
  let v = 0;
  const h = (CUP.maxFill - CUP.innerBottom) / H_STEPS;
  volAt[0] = 0;
  for (let i = 1; i <= H_STEPS; i++) {
    const y = CUP.innerBottom + (i - 0.5) * h;
    const r = innerRadiusAt(y);
    v += Math.PI * r * r * h;
    volAt[i] = v;
  }
})();
const VOL_MAX = volAt[H_STEPS];

/** Fraction of the cup that is filled at time tau (0..1). */
export function fillFraction(tau) {
  const k = clamp(tau / DT, 0, N);
  const i = Math.floor(k);
  const f = k - i;
  const c = i < N ? lerp(cumulative[i], cumulative[i + 1], f) : cumulative[N];
  return clamp(c / TOTAL, 0, 1);
}

/** Liquid surface height for a fill fraction. */
export function fillHeight(frac) {
  const target = frac * VOL_MAX;
  let lo = 0;
  let hi = H_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (volAt[mid] < target) lo = mid;
    else hi = mid;
  }
  const span = volAt[hi] - volAt[lo] || 1;
  const t = clamp((target - volAt[lo]) / span, 0, 1);
  const h = (CUP.maxFill - CUP.innerBottom) / H_STEPS;
  return CUP.innerBottom + (lo + t) * h;
}
