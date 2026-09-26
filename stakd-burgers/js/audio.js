/**
 * STAKD late-night groove — a live-synthesised, copyright-free
 * neo-soul loop (FM electric piano, sub bass, brushed drums,
 * vinyl dust). No scroll-driven sounds; only a soft UI tick
 * and a chime when something is added to the order.
 */
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class GrooveAudio {
  constructor() {
    this.ctx = null;
    this.enabled = false;
    this.step = 0;
    this.bar = 0;
    this.bpm = 84;
    // Dm9 – G13 – Cmaj9 – A7(b9), rootless voicings
    this.chords = [[53, 57, 60, 64], [53, 59, 64, 69], [52, 55, 59, 62], [55, 58, 61, 64]];
    this.roots = [38, 43, 36, 45];
    // 16th-step bass figure (semitones above the root, null = rest)
    this.bassLine = [0, null, null, 0, null, null, 12, null, null, 7, null, null, 10, null, 7, null];
    this.melody = [69, 72, 74, 76, 77, 79, 81];
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 9000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    this.master.connect(tone).connect(comp).connect(ctx.destination);

    this.music = ctx.createGain();
    this.music.gain.value = 0.62;
    this.music.connect(this.master);

    const len = ctx.sampleRate * 2.6;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.rev = ctx.createConvolver();
    this.rev.buffer = ir;
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.28;
    this.revSend.connect(this.rev).connect(this.master);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.7;
    this.sfx.connect(this.master);
    this.sfx.connect(this.revSend);

    const nl = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, nl, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nl; i++) nd[i] = Math.random() * 2 - 1;

    // slow stereo tremolo shared by the electric piano
    this.epBus = ctx.createGain();
    this.epBus.gain.value = 1;
    const panL = ctx.createStereoPanner();
    const trem = ctx.createOscillator();
    trem.frequency.value = 4.2;
    const tremG = ctx.createGain();
    tremG.gain.value = 0.35;
    trem.connect(tremG).connect(panL.pan);
    trem.start();
    this.epBus.connect(panL).connect(this.music);
    this.epBus.connect(this.revSend);

    this.startDust();
    this.next = ctx.currentTime + 0.12;
    const sd = 60 / this.bpm / 4;
    this._seq = setInterval(() => {
      if (!this.ctx || this.ctx.state !== 'running') {
        if (this.ctx) this.next = this.ctx.currentTime + 0.12;
        return;
      }
      while (this.next < this.ctx.currentTime + 0.2) {
        const s = this.step % 16;
        const swing = s % 2 ? sd * 0.22 : 0;
        this.play(s, this.next + swing, sd);
        this.next += sd;
        this.step++;
        if (this.step % 16 === 0) this.bar++;
      }
    }, 30);
  }

  setEnabled(on) {
    if (on) this.init();
    if (!this.ctx) return;
    this.enabled = on;
    const t = this.ctx.currentTime;
    if (on && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(on ? 0.75 : 0, t, on ? 0.6 : 0.15);
    clearTimeout(this._sus);
    if (!on) this._sus = setTimeout(() => this.ctx && !this.enabled && this.ctx.suspend(), 1200);
  }

  /** soft wooden tick for hovers */
  tick() {
    if (!this.ctx || !this.enabled || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.03);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.06);
  }

  /** two bell-like piano notes — "added to your order" */
  chime() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    this.ep(t, 81, 1.4, 0.07, this.sfx);
    this.ep(t + 0.09, 88, 1.8, 0.06, this.sfx);
  }

  /** a rising arpeggio — confirmation */
  confirm() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    [74, 77, 81, 86].forEach((m, i) => this.ep(t + i * 0.07, m, 1.6, 0.055, this.sfx));
  }

  /* ---------------- instruments ---------------- */
  startDust() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.012;
      if (Math.random() < 6 / ctx.sampleRate) {
        const amp = 0.2 + Math.random() * 0.5;
        for (let k = 0; k < 40 && i + k < len; k++) d[i + k] += (Math.random() * 2 - 1) * amp * Math.exp(-k / 6);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = b;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.22;
    src.connect(bp).connect(g).connect(this.music);
    src.start();
  }

  /** two-operator FM electric piano */
  ep(t, m, dur, v, out = this.epBus) {
    const ctx = this.ctx;
    const f = mtof(m);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    const g = ctx.createGain();
    car.type = 'sine';
    mod.type = 'sine';
    car.frequency.value = f;
    mod.frequency.value = f * 1.0;
    car.detune.value = (Math.random() - 0.5) * 6;
    modG.gain.setValueAtTime(f * 1.6, t);
    modG.gain.exponentialRampToValueAtTime(f * 0.12, t + 0.5);
    mod.connect(modG).connect(car.frequency);
    // tine "ping" an octave+ above
    const tine = ctx.createOscillator();
    const tg = ctx.createGain();
    tine.type = 'sine';
    tine.frequency.value = f * 4.02;
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(v * 0.25, t + 0.002);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    tine.connect(tg).connect(out);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(v * 0.45, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g).connect(out);
    [car, mod, tine].forEach((o) => {
      o.start(t);
      o.stop(t + dur + 0.05);
    });
  }

  bass(t, m, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const g = ctx.createGain();
    o.type = 'sine';
    o2.type = 'triangle';
    o.frequency.value = mtof(m);
    o2.frequency.value = mtof(m);
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(700, t);
    lp.frequency.exponentialRampToValueAtTime(220, t + 0.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const og = ctx.createGain();
    og.gain.value = 0.35;
    o.connect(lp);
    o2.connect(og).connect(lp);
    lp.connect(g).connect(this.music);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.03);
    o2.stop(t + dur + 0.03);
  }

  nz(t, dur, type, freq, gain, q = 0.8, send = 0) {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f).connect(g).connect(this.music);
    if (send) {
      const s = this.ctx.createGain();
      s.gain.value = send;
      g.connect(s).connect(this.revSend);
    }
    n.start(t, Math.random() * 1.5);
    n.stop(t + dur + 0.02);
  }

  kick(t, v) {
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(115, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.12);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.75 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.4);
  }

  play(s, t, sd) {
    const ci = this.bar % 4;
    const r = Math.random;
    const drums = this.bar >= 1;
    const bassOn = this.bar >= 1;

    // electric piano: chord on the one, a softer re-hit before beat 3
    if (s === 0) this.chords[ci].forEach((m, i) => this.ep(t + i * 0.012, m, 3.2, 0.05));
    if (s === 7 && r() < 0.7) this.chords[ci].slice(1).forEach((m, i) => this.ep(t + i * 0.01, m, 1.4, 0.03));
    // a sparse melodic answer every other bar
    if (this.bar % 2 === 1 && (s === 10 || s === 13) && r() < 0.55) {
      this.ep(t, this.melody[Math.floor(r() * this.melody.length)] - (ci === 2 ? 2 : 0), 1.8, 0.035);
    }

    if (bassOn) {
      const iv = this.bassLine[s];
      if (iv !== null) this.bass(t, this.roots[ci] + iv, sd * (s === 0 ? 3.4 : 2.2));
    }

    if (drums) {
      if (s === 0 || s === 10 || (s === 7 && r() < 0.35)) this.kick(t, s === 0 ? 1 : 0.7);
      if (s === 4 || s === 12) this.nz(t, 0.18, 'bandpass', 1900, 0.2, 0.6, 0.6); // brushed snare
      if (s % 2 === 0) this.nz(t, 0.035, 'highpass', 7800, s % 4 === 0 ? 0.045 : 0.03);
      else if (r() < 0.4) this.nz(t, 0.025, 'highpass', 9000, 0.018);
      if (s === 14 && r() < 0.5) this.nz(t, 0.05, 'bandpass', 3200, 0.06, 4, 0.3); // rim
    }
  }
}
