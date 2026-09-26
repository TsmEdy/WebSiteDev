/**
 * Live-synthesised, copyright-free soundtrack for the walk:
 * a soft deep-house groove + footsteps, whooshes and the final "plop".
 */
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class WalkAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.step = 0;
    this.bar = 0;
    this.bpm = 104;
    this.chords = [
      [57, 60, 64, 67, 71], // Am9
      [53, 57, 60, 64, 67], // Fmaj9
      [48, 52, 55, 59, 62], // Cmaj9
      [55, 59, 62, 64, 69], // G6/9
    ];
    this.bassNotes = [45, 41, 48, 43];
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
    comp.threshold.value = -14;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    this.rev = ctx.createConvolver();
    this.rev.buffer = this.impulse(2.6, 2.4);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.22;
    this.revSend.connect(this.rev).connect(this.master);

    // music bus with a "mood" low-pass (muffled inside the roaster)
    this.music = ctx.createGain();
    this.music.gain.value = 0.6;
    this.mood = ctx.createBiquadFilter();
    this.mood.type = 'lowpass';
    this.mood.frequency.value = 16000;
    this.mood.Q.value = 0.6;
    this.music.connect(this.mood).connect(this.master);
    this.mood.connect(this.revSend);

    // side-chain style pump on pads
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.5;
    this.padBus.connect(this.music);

    this.delay = ctx.createDelay(1.5);
    this.delay.delayTime.value = (60 / this.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.38;
    const dl = ctx.createBiquadFilter();
    dl.type = 'lowpass';
    dl.frequency.value = 2800;
    this.delay.connect(dl).connect(fb).connect(this.delay);
    dl.connect(this.music);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.sfx.connect(this.revSend);

    this.noiseBuf = this.makeNoise(2);
    this.startWind();
    this.startSequencer();
  }

  setEnabled(on) {
    if (on) this.init();
    if (!this.ctx) return;
    this.enabled = on;
    const t = this.ctx.currentTime;
    if (on && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.8 : 0, t, on ? 0.5 : 0.2);
    clearTimeout(this._sus);
    if (!on) this._sus = setTimeout(() => this.ctx && !this.enabled && this.ctx.suspend(), 1400);
  }

  /** 0 = open air, 1 = deep inside the roaster */
  setMood(fire, underwater = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 16000 * (1 - fire * 0.93) * (1 - underwater * 0.5);
    this.mood.frequency.setTargetAtTime(Math.max(f, 500), t, 0.3);
    this.fireGain && this.fireGain.gain.setTargetAtTime(fire * 0.12, t, 0.4);
  }

  setSpeed(v) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const s = Math.min(Math.abs(v) / 60, 1);
    this.windGain.gain.setTargetAtTime(s * 0.28, t, 0.12);
    this.windFilter.frequency.setTargetAtTime(400 + s * 2400, t, 0.12);
  }

  footstep(intensity = 1, gravel = 0) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.005;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const lp = ctx.createBiquadFilter();
    lp.type = gravel > 0.5 ? 'bandpass' : 'lowpass';
    lp.frequency.value = gravel > 0.5 ? 2600 + Math.random() * 1200 : 520 + Math.random() * 200;
    lp.Q.value = gravel > 0.5 ? 0.8 : 0.7;
    const g = ctx.createGain();
    const v = 0.1 * intensity;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (gravel > 0.5 ? 0.12 : 0.09));
    n.connect(lp).connect(g).connect(this.sfx);
    n.start(t, Math.random());
    n.stop(t + 0.15);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(95 + Math.random() * 20, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.08);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.2 * intensity, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    o.connect(og).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.12);
  }

  plop() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(1300, t + 0.09);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.25);
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    n.connect(bp).connect(ng).connect(this.sfx);
    n.start(t);
    n.stop(t + 0.7);
  }

  tick() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(1600, t);
    o.frequency.exponentialRampToValueAtTime(2400, t + 0.04);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.04, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.07);
  }

  /* ---------------- internals ---------------- */
  makeNoise(sec) {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  impulse(sec, decay) {
    const len = Math.floor(this.ctx.sampleRate * sec);
    const b = this.ctx.createBuffer(2, len, this.ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  startWind() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 600;
    this.windFilter.Q.value = 0.9;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.sfx);
    src.start();
    // roaster crackle bed
    const len = ctx.sampleRate * 3;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.02;
      if (Math.random() < 40 / ctx.sampleRate) for (let k = 0; k < 80 && i + k < len; k++) d[i + k] += (Math.random() * 2 - 1) * Math.exp(-k / 9) * 0.8;
    }
    const cr = ctx.createBufferSource();
    cr.buffer = b;
    cr.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500;
    this.fireGain = ctx.createGain();
    this.fireGain.gain.value = 0;
    cr.connect(hp).connect(this.fireGain).connect(this.sfx);
    cr.start();
  }

  noise(t, dur, type, freq, gain, dest = this.music, q = 0.8) {
    const ctx = this.ctx;
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(dest);
    n.start(t, Math.random());
    n.stop(t + dur + 0.02);
    return g;
  }

  kick(t, v) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(46, t + 0.11);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.85 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.4);
    // duck the pads
    this.padBus.gain.setValueAtTime(0.18, t);
    this.padBus.gain.setTargetAtTime(0.5, t + 0.02, 0.11);
  }

  pad(t, notes, dur) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(600, t);
    lp.frequency.linearRampToValueAtTime(1700, t + dur * 0.5);
    lp.frequency.linearRampToValueAtTime(800, t + dur);
    lp.Q.value = 2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.05, t + 0.4);
    g.gain.setValueAtTime(0.05, t + dur - 0.3);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.6);
    lp.connect(g).connect(this.padBus);
    for (const m of notes) {
      for (const det of [-7, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(m);
        o.detune.value = det;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.7);
      }
    }
  }

  pluck(t, m, v = 1, dest) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    o.type = 'triangle';
    o.frequency.value = mtof(m);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(4200, t);
    lp.frequency.exponentialRampToValueAtTime(700, t + 0.25);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.08 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(lp).connect(g).connect(dest || this.music);
    g.connect(this.delay);
    o.start(t);
    o.stop(t + 0.4);
  }

  bass(t, m, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    o.type = 'square';
    o.frequency.value = mtof(m);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(g).connect(this.music);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  startSequencer() {
    const sd = 60 / this.bpm / 4;
    this.next = this.ctx.currentTime + 0.1;
    this._seq = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') {
        if (this.ctx) this.next = this.ctx.currentTime + 0.1;
        return;
      }
      while (this.next < this.ctx.currentTime + 0.15) {
        const s = this.step % 16;
        const sw = s % 2 ? sd * 0.08 : 0;
        this.play(s, this.next + sw, sd);
        this.next += sd;
        this.step++;
        if (this.step % 16 === 0) this.bar++;
      }
    }, 25);
  }

  play(s, t, sd) {
    const ci = Math.floor(this.bar / 2) % this.chords.length;
    const chord = this.chords[ci];
    const r = Math.random;
    const drums = this.bar >= 2;
    if (s === 0 && this.bar % 2 === 0) this.pad(t, chord, sd * 32);
    if (drums) {
      if (s % 4 === 0) this.kick(t, s === 0 ? 1 : 0.85);
      if (s === 4 || s === 12) {
        this.noise(t, 0.16, 'bandpass', 1500, 0.28);
        this.noise(t + 0.012, 0.12, 'bandpass', 2100, 0.16);
      }
      this.noise(t, 0.035, 'highpass', 8000, s % 4 === 2 ? 0.1 : 0.045);
      if (s % 4 === 2) this.noise(t, 0.18, 'highpass', 6500, 0.05);
      if (s % 4 === 2 || (s === 15 && r() < 0.4)) this.bass(t, this.bassNotes[ci], sd * 1.8);
    }
    if (this.bar >= 1 && s % 2 === 0 && r() < 0.55) {
      const m = chord[Math.floor(r() * chord.length)] + 12;
      this.pluck(t, m, 0.9);
    }
  }
}
