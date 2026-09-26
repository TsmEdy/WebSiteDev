/**
 * Villa Solenne ambience — sea waves, a generative piano and, in winter,
 * wind plus a crackling fireplace. Everything is synthesised live.
 */
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class VillaAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.winter = 0;
    this.scale = [60, 62, 64, 67, 69, 72, 74, 76, 79]; // C major pentatonic, airy
    this.chords = [[48, 55, 64], [45, 52, 60], [41, 48, 57], [43, 50, 59]];
    this.ci = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 2.5;
    this.master.connect(comp).connect(ctx.destination);
    // long hall reverb
    const len = ctx.sampleRate * 5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    }
    this.rev = ctx.createConvolver();
    this.rev.buffer = ir;
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.55;
    this.rev.connect(this.revGain).connect(this.master);
    this.piano = ctx.createGain();
    this.piano.gain.value = 0.5;
    this.piano.connect(this.master);
    this.piano.connect(this.rev);
    const nlen = ctx.sampleRate * 4;
    this.noise = ctx.createBuffer(1, nlen, ctx.sampleRate);
    const nd = this.noise.getChannelData(0);
    let b = 0;
    for (let i = 0; i < nlen; i++) {
      // brown-ish noise for waves
      b = (b + (Math.random() * 2 - 1) * 0.02) / 1.02;
      nd[i] = b * 3.5;
    }
    this.startWaves();
    this.startWinterBed();
    this.schedule();
  }

  setEnabled(on) {
    if (on) this.init();
    if (!this.ctx) return;
    this.enabled = on;
    const t = this.ctx.currentTime;
    if (on && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.9 : 0, t, on ? 1.2 : 0.3);
    clearTimeout(this._sus);
    if (!on) this._sus = setTimeout(() => this.ctx && !this.enabled && this.ctx.suspend(), 1800);
  }

  setWinter(w) {
    this.winter = w;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(w * 0.18, t, 1.2);
    this.fireGain.gain.setTargetAtTime(w * 0.1, t, 1.2);
    this.waveGain.gain.setTargetAtTime(0.55 - w * 0.25, t, 1.2);
  }

  /** 0..1 how "outside" we are (exterior/terrace louder sea) */
  setOutdoors(o) {
    if (!this.ctx) return;
    this.waveLP.frequency.setTargetAtTime(500 + o * 1400, this.ctx.currentTime, 0.6);
  }

  whoosh() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const n = this.ctx.createBufferSource();
    n.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 0.8;
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(1600, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    n.connect(f).connect(g).connect(this.master);
    g.connect(this.rev);
    n.start(t, Math.random() * 2);
    n.stop(t + 1.2);
  }

  chime() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    [84, 88, 91].forEach((m, i) => this.note(t + i * 0.08, m, 1.5, 0.05));
  }

  /* ---------------- internals ---------------- */
  startWaves() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.waveLP = ctx.createBiquadFilter();
    this.waveLP.type = 'lowpass';
    this.waveLP.frequency.value = 900;
    const swell = ctx.createGain();
    swell.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.45;
    lfo.connect(lfoG).connect(swell.gain);
    lfo.start();
    this.waveGain = ctx.createGain();
    this.waveGain.gain.value = 0.55;
    src.connect(this.waveLP).connect(swell).connect(this.waveGain).connect(this.master);
    src.start();
  }

  startWinterBed() {
    const ctx = this.ctx;
    const w = ctx.createBufferSource();
    w.buffer = this.noise;
    w.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = ctx.createGain();
    lg.gain.value = 380;
    lfo.connect(lg).connect(bp.frequency);
    lfo.start();
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    w.connect(bp).connect(this.windGain).connect(this.master);
    w.start();
    const len = ctx.sampleRate * 3;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.01;
      if (Math.random() < 14 / ctx.sampleRate) for (let k = 0; k < 120 && i + k < len; k++) d[i + k] += (Math.random() * 2 - 1) * Math.exp(-k / 14);
    }
    const fire = ctx.createBufferSource();
    fire.buffer = b;
    fire.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    fire.connect(hp).connect(this.fireGain).connect(this.master);
    fire.start();
  }

  note(t, m, dur, v) {
    const ctx = this.ctx;
    const f = mtof(m);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.01);
    g.gain.exponentialRampToValueAtTime(v * 0.3, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(3200, t);
    lp.frequency.exponentialRampToValueAtTime(900, t + dur);
    [1, 2, 3].forEach((h, i) => {
      const o = ctx.createOscillator();
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = f * h * (1 + (i ? 0.0015 * i : 0));
      const og = ctx.createGain();
      og.gain.value = [1, 0.25, 0.08][i];
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.05);
    });
    lp.connect(g).connect(this.piano);
  }

  schedule() {
    let next = this.ctx.currentTime + 0.5;
    const beat = 60 / 64;
    let step = 0;
    this._int = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') {
        if (this.ctx) next = this.ctx.currentTime + 0.3;
        return;
      }
      while (next < this.ctx.currentTime + 0.3) {
        const r = Math.random;
        if (step % 8 === 0) {
          const ch = this.chords[this.ci % this.chords.length];
          ch.forEach((m, i) => this.note(next + i * 0.06, m + (this.winter > 0.5 ? -2 : 0), 5.5, 0.06));
          this.ci++;
        }
        if (r() < 0.42) {
          const m = this.scale[Math.floor(r() * this.scale.length)] + (this.winter > 0.5 ? -2 : 0);
          this.note(next + r() * 0.1, m, 2.6, 0.045 + r() * 0.03);
        }
        next += beat;
        step++;
      }
    }, 60);
  }
}
