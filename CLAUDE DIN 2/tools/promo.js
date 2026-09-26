/**
 * Offline promo-video renderer (dev tool).
 *
 * Loads inside a demo page opened with ?autostart&debug, drives the live 3D scene
 * frame-by-frame along a scripted "scroll" path, composites title cards on a 2D
 * canvas, renders the site's generative soundtrack in an OfflineAudioContext and
 * muxes H.264 + AAC into an MP4 that is POSTed back to the dev server.
 *
 *   const m = await import('/tools/promo.js'); m.start('edspresso');
 *   // poll: window.__promo
 */
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const yieldMC = () => new Promise((r) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = () => r();
  ch.port2.postMessage(0);
});

/** piecewise path [[t, value], ...] with eased segments */
function path(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      const [t0, v0] = keys[i - 1];
      const [t1, v1] = keys[i];
      if (t <= t1) return lerp(v0, v1, ease((t - t0) / Math.max(t1 - t0, 1e-6)));
    }
    return keys[keys.length - 1][1];
  };
}

/** fade envelope for a card shown between a and b */
const env = (t, a, b, fi = 0.5, fo = 0.5) => smooth(a, a + fi, t) * (1 - smooth(b - fo, b, t));

function text(c, str, { x, y, font, color = '#fff', align = 'center', alpha = 1, shadow = null, spacing = 0, rise = 0 }) {
  if (alpha <= 0.001) return;
  c.save();
  c.globalAlpha = alpha;
  c.font = font;
  c.fillStyle = color;
  c.textAlign = align;
  c.textBaseline = 'middle';
  if ('letterSpacing' in c) c.letterSpacing = `${spacing}px`;
  if (shadow) {
    c.shadowColor = shadow;
    c.shadowBlur = 40;
  }
  c.fillText(str, x, y + (1 - alpha) * rise);
  c.restore();
}

function gradientBar(c, W, H, top, bottom) {
  const g = c.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, top);
  g.addColorStop(0.28, 'rgba(0,0,0,0)');
  g.addColorStop(0.62, 'rgba(0,0,0,0)');
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(0, 0, W, H);
}

/* ------------------------------------------------------------------
   override window size so each site's resize() builds a portrait view
   ------------------------------------------------------------------ */
function fakeViewport(W, H) {
  const dW = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const dH = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  Object.defineProperty(window, 'innerWidth', { value: W, configurable: true, writable: true });
  Object.defineProperty(window, 'innerHeight', { value: H, configurable: true, writable: true });
  return () => {
    if (dW) Object.defineProperty(window, 'innerWidth', dW); else delete window.innerWidth;
    if (dH) Object.defineProperty(window, 'innerHeight', dH); else delete window.innerHeight;
  };
}

/** run an audio engine class inside an OfflineAudioContext */
function offlineEngine(EngineClass, duration, preset) {
  const off = new OfflineAudioContext(2, Math.ceil(48000 * duration), 48000);
  const OldAC = window.AudioContext;
  const OldW = window.webkitAudioContext;
  window.AudioContext = function () { return off; };
  window.webkitAudioContext = undefined;
  const eng = preset ? new EngineClass(preset) : new EngineClass();
  try { eng.init(); } finally {
    window.AudioContext = OldAC;
    window.webkitAudioContext = OldW;
  }
  for (const k of ['_seq', '_wander', '_int']) if (eng[k]) clearInterval(eng[k]);
  eng.enabled = true;
  eng.master.gain.cancelScheduledValues(0);
  eng.master.gain.setValueAtTime(0.0001, 0);
  eng.master.gain.exponentialRampToValueAtTime(0.85, 1.2);
  eng.master.gain.setValueAtTime(0.85, duration - 2.2);
  eng.master.gain.linearRampToValueAtTime(0.0001, duration - 0.05);
  return { off, eng };
}

/* ------------------------------------------------------------------
   core renderer
   ------------------------------------------------------------------ */
async function render(cfg) {
  const { name, duration, fps = 30, W = 1080, H = 1920 } = cfg;
  const status = (window.__promo = { name, progress: 0, stage: 'setup', done: false, error: null });
  const { Muxer, ArrayBufferTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.mjs');
  await document.fonts.ready;
  if (cfg.fonts) await Promise.all(cfg.fonts.map((f) => document.fonts.load(f).catch(() => {})));

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: W, height: H, frameRate: fps },
    audio: { codec: 'aac', sampleRate: 48000, numberOfChannels: 2 },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encErr = null;
  const venc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (encErr = e) });
  venc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: 14_000_000, framerate: fps, latencyMode: 'realtime' });

  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  // CPU-backed canvas: the encoder then reads plain memory instead of doing a
  // slow GPU readback per frame (which crawls when the tab is in the background)
  const c = cv.getContext('2d', { willReadFrequently: true });

  const restoreVP = fakeViewport(W, H);
  const scene = await cfg.setup({ W, H });
  const N = Math.round(duration * fps);
  const events = [];
  status.stage = 'video';
  const tm = (status.timing = { frame: 0, draw: 0, wait: 0, yield: 0 });
  const now = () => performance.now();
  try {
    for (let i = 0; i < N; i++) {
      if (encErr) throw encErr;
      const t = i / fps;
      let t0 = now();
      const ev = scene.frame(t, 1 / fps, i);
      if (ev) events.push({ t, ...ev });
      tm.frame += now() - t0;
      t0 = now();
      c.save();
      if (cfg.background) cfg.background(c, t, W, H);
      if (cfg.under) cfg.under(c, t, W, H);
      c.drawImage(scene.canvas, 0, 0, W, H);
      c.restore();
      cfg.overlay(c, t, W, H, scene);
      const px = c.getImageData(0, 0, W, H);
      const vf = new VideoFrame(px.data, { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      tm.draw += now() - t0;
      t0 = now();
      // flush() resolves via promise (not timers), so it is not throttled in background tabs
      if (venc.encodeQueueSize > 8) await venc.flush();
      tm.wait += now() - t0;
      t0 = now();
      if (i % 4 === 0) await yieldMC();
      tm.yield += now() - t0;
      status.progress = (i + 1) / N;
    }
    await venc.flush();
  } finally {
    scene.restore && scene.restore();
    restoreVP();
    scene.afterRestore && scene.afterRestore();
  }

  status.stage = 'audio';
  const buffer = await cfg.audio(duration, events);
  const aenc = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: (e) => (encErr = e) });
  aenc.configure({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 });
  const L = buffer.getChannelData(0);
  const R = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : L;
  const CH = 1024;
  for (let off = 0; off < buffer.length; off += CH) {
    const n = Math.min(CH, buffer.length - off);
    const data = new Float32Array(n * 2);
    data.set(L.subarray(off, off + n), 0);
    data.set(R.subarray(off, off + n), n);
    const ad = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((off / 48000) * 1e6), data });
    aenc.encode(ad);
    ad.close();
    if (off % (CH * 64) === 0) await yieldMC();
  }
  await aenc.flush();
  if (encErr) throw encErr;

  status.stage = 'upload';
  muxer.finalize();
  const buf = muxer.target.buffer;
  const res = await fetch(`/__snap/${name}.mp4`, { method: 'POST', body: buf });
  status.size = buf.byteLength;
  status.http = res.status;
  status.stage = 'done';
  status.done = true;
  return status;
}

/* ==================================================================
   EdSpresso — 1080x1920, 24 s
   ================================================================== */
const EDSPRESSO = {
  name: 'edspresso-promo',
  duration: 24,
  fonts: ['italic 300 120px "Fraunces"', '400 120px "Fraunces"', '500 40px "IBM Plex Mono"', '500 40px "Manrope"'],
  async setup({ W, H }) {
    const s = window.__site;
    const exp = s.exp;
    const r = exp.renderer;
    const oldDpr = r.getPixelRatio();
    r.setPixelRatio(1);
    exp.resize();
    exp.intro = 1;
    const P = await import('/cafe-scroll/js/pour.js');
    const kf = exp.keyframes;
    const pOf = (id) => (kf.find((f) => f.id === id) || { p: 0.5 }).p;
    const knots = [[0, 0], [pOf('extractie'), 6.2], [pOf('vizita'), 30.2], [1, P.TAU_END]];
    const mapTau = (p) => {
      for (let i = 1; i < knots.length; i++) if (p <= knots[i][0]) return lerp(knots[i - 1][1], knots[i][1], (p - knots[i - 1][0]) / Math.max(knots[i][0] - knots[i - 1][0], 1e-6));
      return P.TAU_END;
    };
    const docH = document.documentElement.scrollHeight;
    const prog = path([[0, 0], [2.6, 0], [9, 0.3], [11.4, 0.3], [13.4, 0.235], [20, 1], [24, 1]]);
    let prevP = 0;
    let prevTau = 0;
    this.exp = exp;
    return {
      canvas: r.domElement,
      frame(t, dt) {
        const p = prog(t);
        const tau = mapTau(p);
        const vel = ((p - prevP) / dt) * docH / 60;
        exp.setMouse(Math.sin(t * 0.5) * 0.35, Math.sin(t * 0.37) * 0.2);
        exp.setLogo(t > 19.5 ? 1 : 0);
        const info = exp.update(dt, t, { progress: p, velocity: vel, tau });
        const dTau = (tau - prevTau) / dt;
        prevP = p;
        prevTau = tau;
        this.info = info;
        this.tau = tau;
        return { pour: info ? info.arriving * clamp(Math.abs(dTau) / 2.2, 0, 1.2) : 0, pump: info ? (info.pressure / 9) * clamp(Math.abs(dTau) / 1.5, 0, 1) : 0 };
      },
      restore() {
        r.setPixelRatio(oldDpr);
      },
      afterRestore() {
        exp.resize();
      },
    };
  },
  overlay(c, t, W, H, scene) {
    gradientBar(c, W, H, 'rgba(10,8,7,0.55)', 'rgba(10,8,7,0.75)');
    const gold = '#e6c894';
    const cream = '#f3ece1';
    // title
    let a = env(t, 0.2, 3.4, 0.8, 0.7);
    text(c, 'EdSpresso', { x: W / 2, y: H * 0.16, font: 'italic 300 150px "Fraunces"', color: cream, alpha: a, rise: 30 });
    text(c, 'Timpul curge doar când derulezi.', { x: W / 2, y: H * 0.16 + 120, font: '400 46px "Fraunces"', color: gold, alpha: a, rise: 20 });
    const card = (s1, s2, t0, t1) => {
      const al = env(t, t0, t1, 0.45, 0.45);
      text(c, s1, { x: W / 2, y: H * 0.82, font: 'italic 300 76px "Fraunces"', color: cream, alpha: al, rise: 24 });
      if (s2) text(c, s2, { x: W / 2, y: H * 0.82 + 84, font: '500 30px "IBM Plex Mono"', color: gold, alpha: al, spacing: 6, rise: 16 });
    };
    card('Derulezi — cafeaua curge.', 'FIZICĂ LEGATĂ DE SCROLL', 3.8, 8.8);
    card('Te oprești — timpul îngheață.', 'FREEZE FRAME', 9.1, 11.5);
    card('Înapoi — cafeaua urcă.', 'REWIND', 11.6, 13.6);
    card('Ceașca se umple', 'PÂNĂ LA FINALUL PAGINII', 14.2, 19.2);
    // HUD
    if (scene.info && t > 3 && t < 19.6) {
      const tt = Math.min(scene.tau, 28);
      const sec = Math.floor(tt);
      text(c, `00:${String(sec).padStart(2, '0')}.${Math.floor((tt - sec) * 10)}   ·   ${(scene.info.frac * 36).toFixed(1)} g`, { x: W / 2, y: H * 0.93, font: '500 32px "IBM Plex Mono"', color: cream, alpha: 0.85 * env(t, 3, 19.6), spacing: 4 });
    }
    // end card
    a = env(t, 20.2, 24.5, 0.7, 0.2);
    text(c, 'Site 3D pentru cafenele', { x: W / 2, y: H * 0.8, font: 'italic 300 78px "Fraunces"', color: cream, alpha: a, rise: 20 });
    text(c, 'EDY STUDIO · DEMO LIVE', { x: W / 2, y: H * 0.8 + 90, font: '500 32px "IBM Plex Mono"', color: gold, alpha: a, spacing: 8 });
  },
  async audio(duration, events) {
    const { SoundEngine } = await import('/cafe-scroll/js/audio.js');
    const { off, eng } = offlineEngine(SoundEngine, duration);
    const sd = 60 / eng.preset.bpm / 4;
    let step = 0;
    eng.bar = 0;
    for (let tt = 0.15; tt < duration; tt += sd) {
      const s = step % 16;
      eng.playStep(s, tt + (s % 2 ? sd * eng.preset.swing : 0), sd);
      step++;
      if (step % 16 === 0) eng.bar++;
    }
    // music only — the pour/whoosh effect was removed from the site on request
    void events;
    return off.startRendering();
  },
};

/* ==================================================================
   10,000 Steps — 1080x1920, 26 s
   ================================================================== */
const STEPS = {
  name: 'steps-promo',
  duration: 26,
  fonts: ['800 120px "Syne"', 'italic 400 80px "Instrument Serif"', '500 36px "JetBrains Mono"'],
  async setup() {
    const s = window.__site;
    const world = s.world;
    const r = world.renderer;
    const oldDpr = r.getPixelRatio();
    r.setPixelRatio(1);
    world.resize();
    world.intro = 1;
    const f = world.frames;
    const at = (cam) => (f.find((x) => x.cam === cam) || { p: 1 }).p;
    this.knots = [[0, 0], [at(1), 1200], [at(2), 3400], [at(3), 5600], [at(4), 7800], [at(5), 10000], [1, 10000]];
    const docH = document.documentElement.scrollHeight;
    const prog = path([
      [0, 0], [2.4, 0], [6, at(1)], [9.4, at(2)], [11.2, at(2) + 0.004],
      [13.4, at(3)], [16.6, at(4)], [20, at(5) - 0.02], [21.2, at(5) - 0.0115], [26, at(5) + 0.012],
    ]);
    this.impact = at(5) - 0.012;
    let prevP = 0;
    const self = this;
    return {
      canvas: r.domElement,
      frame(t, dt) {
        const p = prog(t);
        const vel = ((p - prevP) / dt) * docH / 60;
        world.setMouse(Math.sin(t * 0.4) * 0.3, Math.sin(t * 0.33) * 0.15);
        world.update(dt, t, { progress: p, velocity: vel, tau: p * 14 });
        const ev = { v: vel, steps: self.stepsAt(p), impact: prevP < self.impact && p >= self.impact, fire: world.fire || 0, cz: world.camera.position.z };
        prevP = p;
        self.p = p;
        return ev;
      },
      restore() { r.setPixelRatio(oldDpr); },
      afterRestore() { world.resize(); },
    };
  },
  stepsAt(p) {
    const k = this.knots;
    for (let i = 1; i < k.length; i++) if (p <= k[i][0]) return lerp(k[i - 1][1], k[i][1], (p - k[i - 1][0]) / Math.max(k[i][0] - k[i - 1][0], 1e-6));
    return 10000;
  },
  overlay(c, t, W, H) {
    const ink = '#1d130e';
    const terra = '#c65d3b';
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(239,230,218,0.75)');
    g.addColorStop(0.22, 'rgba(239,230,218,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    let a = env(t, 0.2, 3.2, 0.7, 0.6);
    text(c, '10,000', { x: W / 2, y: H * 0.12, font: '800 190px "Syne"', color: ink, alpha: a, spacing: -8, rise: 30 });
    text(c, 'Steps', { x: W / 2, y: H * 0.12 + 150, font: '800 130px "Syne"', color: ink, alpha: a, spacing: -5, rise: 30 });
    text(c, 'from seed to sip', { x: W / 2, y: H * 0.12 + 250, font: 'italic 400 70px "Instrument Serif"', color: terra, alpha: a });
    const chap = (name, sub, t0, t1, dark = false) => {
      const al = env(t, t0, t1, 0.4, 0.4);
      text(c, name, { x: W / 2, y: H * 0.1, font: '800 150px "Syne"', color: dark ? '#f5e9da' : ink, alpha: al, spacing: -6, rise: 26 });
      text(c, sub, { x: W / 2, y: H * 0.1 + 110, font: 'italic 400 58px "Instrument Serif"', color: dark ? '#ffb070' : terra, alpha: al });
    };
    chap('Seed.', '1,200 steps · 1,800 m up', 4, 7.2);
    chap('Cherry.', '3,400 steps · picked ripe', 7.6, 9.6);
    chap('Stop.', 'time freezes mid-drop', 9.7, 11.3);
    chap('Sun.', '5,600 steps · scroll fast, beans jump', 11.6, 14.6);
    chap('Fire.', '7,800 steps · 212°C', 14.8, 17.6, true);
    chap('10,000', 'one drop. worth every step.', 18.6, 22.4);
    const steps = Math.round(this.stepsAt(this.p || 0));
    const hudA = env(t, 3.2, 22.6);
    if (hudA > 0) {
      c.save();
      c.globalAlpha = hudA * 0.92;
      c.fillStyle = 'rgba(246,240,231,0.8)';
      const bw = 560;
      c.beginPath();
      c.roundRect(W / 2 - bw / 2, H * 0.9 - 44, bw, 88, 44);
      c.fill();
      c.restore();
      text(c, `${steps.toLocaleString('en-US', { minimumIntegerDigits: 5 })} / 10,000 steps`, { x: W / 2, y: H * 0.9, font: '500 34px "JetBrains Mono"', color: ink, alpha: hudA });
    }
    a = env(t, 22.8, 26.5, 0.6, 0.2);
    text(c, 'Walk the site', { x: W / 2, y: H * 0.1, font: '800 120px "Syne"', color: ink, alpha: a, spacing: -5 });
    text(c, 'Edy Studio · live demo', { x: W / 2, y: H * 0.1 + 110, font: 'italic 400 60px "Instrument Serif"', color: terra, alpha: a });
  },
  async audio(duration, events) {
    const { WalkAudio } = await import('/steps-coffee/js/audio.js');
    const { off, eng } = offlineEngine(WalkAudio, duration);
    const sd = 60 / eng.bpm / 4;
    let step = 0;
    for (let tt = 0.1; tt < duration; tt += sd) {
      const s = step % 16;
      eng.play(s, tt + (s % 2 ? sd * 0.08 : 0), sd);
      step++;
      if (step % 16 === 0) eng.bar++;
    }
    let lastStride = 0;
    let lastT = -1;
    for (const e of events) {
      const sp = clamp(Math.abs(e.v) / 60, 0, 1);
      eng.windGain.gain.setTargetAtTime(sp * 0.28, e.t, 0.12);
      eng.windFilter.frequency.setTargetAtTime(400 + sp * 2400, e.t, 0.12);
      eng.fireGain.gain.setTargetAtTime(e.fire * 0.12, e.t, 0.3);
      eng.mood.frequency.setTargetAtTime(Math.max(16000 * (1 - e.fire * 0.93), 500), e.t, 0.3);
      const stride = Math.floor(e.steps / 40);
      if (stride !== lastStride && Math.abs(e.v) > 0.4 && e.t - lastT > 0.11 && e.steps < 9990) {
        const ctxT = e.t;
        const saved = off.currentTime;
        // footstep() schedules at ctx.currentTime; emulate by shifting via a tiny wrapper
        this.footAt(eng, ctxT, clamp(Math.abs(e.v) / 12, 0.35, 1), e.cz < -215 && e.cz > -330 ? 1 : 0);
        lastT = e.t;
        void saved;
      }
      lastStride = stride;
      if (e.impact) this.plopAt(eng, e.t);
    }
    return off.startRendering();
  },
  footAt(eng, t, intensity, gravel) {
    const ctx = eng.ctx;
    const n = ctx.createBufferSource();
    n.buffer = eng.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = gravel ? 'bandpass' : 'lowpass';
    lp.frequency.value = gravel ? 2800 : 600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * intensity, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    n.connect(lp).connect(g).connect(eng.sfx);
    n.start(t, Math.random());
    n.stop(t + 0.14);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(100, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.2 * intensity, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(eng.sfx);
    o.start(t);
    o.stop(t + 0.12);
  },
  plopAt(eng, t) {
    const ctx = eng.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(1300, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
    o.connect(g).connect(eng.sfx);
    o.start(t);
    o.stop(t + 0.26);
  },
};

/* ==================================================================
   STAKD — 1080x1920, 20 s  (driven directly, not by scroll)
   ================================================================== */
const STAKD = {
  name: 'stakd-promo',
  duration: 20,
  fonts: ['400 200px "Anton"', '400 90px "Bowlby One"', '400 60px "Caveat Brush"'],
  async setup() {
    const s = window.__site;
    const scene = s.scene;
    const r = scene.renderer;
    const { RECIPES } = await import('/stakd-burgers/js/burger.js');
    this.RECIPES = RECIPES;
    const oldDpr = r.getPixelRatio();
    r.setPixelRatio(1);
    scene.resize();
    const P = scene.pose;
    const expl = path([[0, 0], [5, 0], [7.4, 1], [9.6, 1], [10.8, 0], [20, 0]]);
    const px = path([[0, 0], [5, 0], [7.4, -0.12], [10.8, 0], [20, 0]]);
    const ps = path([[0, 0.95], [5, 0.95], [7.4, 0.42], [10.8, 0.95], [17, 0.95], [18, 0.78], [20, 0.78]]);
    const py = path([[0, 0.02], [5, 0.02], [7.4, -0.04], [10.8, 0.04], [17, 0.04], [18, 0.02], [20, 0.02]]);
    let recipe = 0;
    scene.setRecipe(0, true);
    // start with the layers stacked high so they drop in one by one
    const list = RECIPES[0].layers;
    list.forEach((k, i) => { const l = scene.L[k]; l.y = 7 + i * 1.7; l.vy = 0; l.s = 1; });
    const self = this;
    return {
      canvas: r.domElement,
      frame(t, dt) {
        const ev = {};
        P.x = px(t);
        P.y = py(t);
        P.s = ps(t);
        P.rotY = 0.35 + t * 0.12;
        P.tilt = 0.18;
        P.floaters = t < 5 || t > 17 ? 1 : 0;
        P.shadow = 1;
        scene.explode = expl(t);
        scene.setMouse(Math.sin(t * 1.1) * 0.6, Math.sin(t * 0.8) * 0.35);
        // velocity bursts while exploded
        let vel = 0;
        if (t > 8 && t < 9.6) vel = Math.sin((t - 8) * 9) * 70;
        const want = t < 11 ? 0 : t < 13 ? 1 : t < 15 ? 2 : t < 17 ? 3 : 0;
        if (want !== recipe) {
          scene.setRecipe(want);
          recipe = want;
          ev.recipe = want;
        }
        scene.update(dt, t, vel);
        self.t = t;
        self.recipe = recipe;
        ev.explode = scene.explode;
        ev.v = vel;
        return ev;
      },
      restore() { r.setPixelRatio(oldDpr); },
      afterRestore() { scene.resize(); },
    };
  },
  background(c, t, W, H) {
    const red = '#e8261c';
    const cream = '#f6e7d0';
    const bg = t < 5 ? cream : t < 11 ? red : t < 17 ? '#fff4e3' : red;
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);
  },
  under(c, t, W, H) {
    // giant word BEHIND the burger (drawn before the transparent WebGL frame)
    const a1 = env(t, 0.1, 5.2, 0.4, 0.4);
    text(c, 'SMASHED', { x: W / 2, y: H * 0.46, font: '400 300px "Anton"', color: '#e8261c', alpha: a1, rise: 60 });
    const a2 = env(t, 17.2, 21, 0.4, 0.1);
    text(c, 'FEEL THE', { x: W / 2, y: H * 0.3, font: '400 250px "Anton"', color: '#f6e7d0', alpha: a2, rise: 40 });
    text(c, 'CRUNCH', { x: W / 2, y: H * 0.62, font: '400 270px "Anton"', color: '#f6e7d0', alpha: a2, rise: 40 });
  },
  overlay(c, t, W, H) {
    const a0 = env(t, 0.3, 5, 0.5, 0.4);
    text(c, 'STAKD', { x: W / 2, y: H * 0.09, font: '400 110px "Bowlby One"', color: '#e8261c', alpha: a0 });
    text(c, 'Scroll to take one apart.', { x: W / 2, y: H * 0.86, font: '400 64px "Caveat Brush"', color: '#e8261c', alpha: a0 });
    const a1 = env(t, 5.4, 10.8, 0.4, 0.4);
    text(c, 'EVERY LAYER', { x: W / 2, y: H * 0.1, font: '400 120px "Anton"', color: '#f6e7d0', alpha: a1 });
    text(c, 'EARNS ITS SPOT.', { x: W / 2, y: H * 0.1 + 120, font: '400 120px "Anton"', color: '#f6e7d0', alpha: a1 });
    text(c, 'scroll faster — it explodes harder', { x: W / 2, y: H * 0.9, font: '400 58px "Caveat Brush"', color: '#ffc93c', alpha: env(t, 7.6, 10.4) });
    const rec = this.RECIPES ? this.RECIPES[this.recipe || 0] : null;
    const a2 = env(t, 11.2, 16.9, 0.3, 0.3);
    if (rec && a2 > 0) {
      text(c, rec.name.toUpperCase(), { x: W / 2, y: H * 0.8, font: '400 118px "Anton"', color: '#e8261c', alpha: a2 });
      text(c, `${rec.price}  ·  ${rec.kcal}`, { x: W / 2, y: H * 0.8 + 100, font: '400 62px "Caveat Brush"', color: '#1f0d07', alpha: a2 });
    }
    const a3 = env(t, 17.8, 21, 0.4, 0.1);
    text(c, 'ORDER NOW — 25 MIN', { x: W / 2, y: H * 0.86, font: '400 72px "Anton"', color: '#ffc93c', alpha: a3 });
    text(c, 'Edy Studio · live demo', { x: W / 2, y: H * 0.86 + 90, font: '400 52px "Caveat Brush"', color: '#f6e7d0', alpha: a3 });
  },
  async audio(duration, events) {
    const { FunkAudio } = await import('/stakd-burgers/js/audio.js');
    const { off, eng } = offlineEngine(FunkAudio, duration);
    const sd = 60 / eng.bpm / 4;
    let step = 0;
    for (let tt = 0.1; tt < duration; tt += sd) {
      const s = step % 16;
      eng.play(s, tt + (s % 2 ? sd * 0.14 : 0), sd);
      step++;
      if (step % 16 === 0) eng.bar++;
    }
    const popAt = (t, pitch) => {
      const o = off.createOscillator();
      const g = off.createGain();
      const f = 380 * Math.pow(1.12, pitch);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 2.4, t + 0.06);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.2, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(eng.sfx);
      o.start(t);
      o.stop(t + 0.14);
    };
    for (let i = 0; i < 9; i++) popAt(0.45 + i * 0.12, i);
    for (const e of events) {
      eng.sizzleGain.gain.setTargetAtTime(clamp(e.explode * 0.5 + Math.abs(e.v) / 100, 0, 1) * 0.2, e.t, 0.08);
      if (e.recipe != null) for (let k = 0; k < 8; k++) popAt(e.t + 0.12 + k * 0.07, k);
    }
    // chomp
    for (let i = 0; i < 3; i++) {
      const tt = 17.4 + i * 0.05;
      const n = off.createBufferSource();
      n.buffer = eng.noiseBuf;
      const f = off.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1200 + i * 700;
      const g = off.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.5, tt + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.07);
      n.connect(f).connect(g).connect(eng.sfx);
      n.start(tt);
      n.stop(tt + 0.09);
    }
    return off.startRendering();
  },
};

/* ==================================================================
   Villa Solenne — 1080x1920, 28 s, summer → winter
   ================================================================== */
const VILLA = {
  name: 'villa-promo',
  duration: 28,
  fonts: ['300 110px "Cormorant Garamond"', 'italic 300 70px "Cormorant Garamond"', '400 160px "Pinyon Script"', '400 34px "Jost"'],
  async setup() {
    const s = window.__site;
    const world = s.world;
    const r = world.renderer;
    const oldDpr = r.getPixelRatio();
    r.setPixelRatio(1);
    world.resize();
    world.intro = 1;
    world.setSeason(false);
    world.season = 0;
    world.applySeason(0);
    const f = world.frames;
    const at = (cam) => (f.find((x) => x.cam === cam) || { p: 1 }).p;
    const prog = path([
      [0, 0], [2.6, 0], [5.4, at(1)], [6.6, at(1)], [9.6, at(2)], [12.8, at(3)],
      [16, at(4)], [17.6, at(4)], [20.6, at(5)], [24, at(6)], [28, at(6) + 0.01],
    ]);
    let wasRush = false;
    const self = this;
    return {
      canvas: r.domElement,
      frame(t, dt) {
        const p = prog(t);
        if (t > 16.6 && world.seasonTarget === 0) world.setSeason(true);
        world.setMouse(Math.sin(t * 0.35) * 0.25, Math.sin(t * 0.27) * 0.12);
        world.update(dt, t, { progress: p });
        const rush = world.rush > 0.6;
        const ev = { rushStart: rush && !wasRush, winter: world.season, z: world.camera.position.z };
        wasRush = rush;
        self.t = t;
        return ev;
      },
      restore() {
        r.setPixelRatio(oldDpr);
        world.setSeason(document.body.classList.contains('winter'));
      },
      afterRestore() { world.resize(); },
    };
  },
  overlay(c, t, W, H) {
    const wint = smooth(16.6, 18.6, t);
    const ink = wint > 0.5 ? '#fffaf3' : '#2a2320';
    const accent = wint > 0.5 ? '#f3d7ad' : '#b8643f';
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, wint > 0.5 ? 'rgba(10,12,30,0.55)' : 'rgba(250,245,238,0.6)');
    g.addColorStop(0.25, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    let a = env(t, 0.2, 3.6, 0.9, 0.7);
    text(c, 'VILLA', { x: W / 2, y: H * 0.11, font: '300 150px "Cormorant Garamond"', color: ink, alpha: a, spacing: 18 });
    text(c, 'Solenne', { x: W / 2, y: H * 0.11 + 150, font: '400 170px "Pinyon Script"', color: accent, alpha: a });
    text(c, 'BOUTIQUE HOTEL · VAMA VECHE', { x: W / 2, y: H * 0.11 + 290, font: '400 30px "Jost"', color: ink, alpha: a, spacing: 10 });
    const room = (n, name, t0, t1) => {
      const al = env(t, t0, t1, 0.5, 0.5);
      text(c, n, { x: W / 2, y: H * 0.1, font: '400 30px "Jost"', color: accent, alpha: al, spacing: 10 });
      text(c, name, { x: W / 2, y: H * 0.1 + 80, font: '300 104px "Cormorant Garamond"', color: ink, alpha: al, rise: 20 });
    };
    room('— PĂȘEȘTE ÎNĂUNTRU —', 'Benvenuti', 4, 6.8);
    room('01', 'Curtea interioară', 7.4, 10.2);
    room('02', 'Apartamente', 10.6, 13.4);
    room('03', 'Spa & piscină', 13.8, 16.2);
    room('VARĂ  →  IARNĂ', 'Un click. Alt anotimp.', 16.6, 19.6);
    room('04', 'Restaurant «Lumini»', 19.8, 22.2);
    a = env(t, 22.8, 28.6, 0.8, 0.2);
    text(c, 'La dolce vita', { x: W / 2, y: H * 0.14, font: '400 150px "Pinyon Script"', color: accent, alpha: a });
    text(c, 'Site 3D pentru hoteluri · Edy Studio', { x: W / 2, y: H * 0.14 + 120, font: 'italic 300 56px "Cormorant Garamond"', color: ink, alpha: a });
  },
  async audio(duration, events) {
    const { VillaAudio } = await import('/villa-solenne/js/audio.js');
    const { off, eng } = offlineEngine(VillaAudio, duration);
    // schedule the generative piano for the whole clip
    const beat = 60 / 64;
    let step = 0;
    for (let tt = 0.5; tt < duration; tt += beat) {
      const winter = tt > 17.5;
      const shift = winter ? -2 : 0;
      if (step % 8 === 0) {
        const ch = eng.chords[eng.ci % eng.chords.length];
        ch.forEach((m, i) => eng.note(tt + i * 0.06, m + shift, 5.5, 0.06));
        eng.ci++;
      }
      if (Math.random() < 0.42) eng.note(tt + Math.random() * 0.1, eng.scale[Math.floor(Math.random() * eng.scale.length)] + shift, 2.6, 0.05);
      step++;
    }
    for (const e of events) {
      eng.windGain.gain.setTargetAtTime(e.winter * 0.18, e.t, 0.6);
      eng.fireGain.gain.setTargetAtTime(e.winter * 0.1, e.t, 0.6);
      const outdoor = e.z > 1 || e.z < -138 ? 1 : e.z < -70 && e.z > -110 ? 0.6 : 0.15;
      eng.waveLP.frequency.setTargetAtTime(500 + outdoor * 1400, e.t, 0.5);
      if (e.rushStart) {
        const n = off.createBufferSource();
        n.buffer = eng.noise;
        const f = off.createBiquadFilter();
        f.type = 'bandpass';
        f.Q.value = 0.8;
        f.frequency.setValueAtTime(300, e.t);
        f.frequency.exponentialRampToValueAtTime(1600, e.t + 0.6);
        const g = off.createGain();
        g.gain.setValueAtTime(0.0001, e.t);
        g.gain.exponentialRampToValueAtTime(0.35, e.t + 0.25);
        g.gain.exponentialRampToValueAtTime(0.0001, e.t + 1.1);
        n.connect(f).connect(g).connect(eng.master);
        g.connect(eng.rev);
        n.start(e.t, Math.random() * 2);
        n.stop(e.t + 1.2);
      }
    }
    return off.startRendering();
  },
};

const CONFIGS = { edspresso: EDSPRESSO, steps: STEPS, stakd: STAKD, villa: VILLA };

export function start(key) {
  const cfg = CONFIGS[key];
  window.__promo = { name: cfg.name, progress: 0, stage: 'queued', done: false, error: null };
  render(cfg).catch((e) => {
    console.error(e);
    window.__promo.error = String(e && e.stack ? e.stack : e);
  });
  return 'started ' + cfg.name;
}
