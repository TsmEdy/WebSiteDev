/**
 * Generative, copyright-free soundtrack + interactive SFX (Web Audio API).
 * Nothing is downloaded: every note, drum hit and crackle is synthesised live.
 */

const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export const PRESETS = {
  lofi: {
    bpm: 74,
    swing: 0.18,
    chords: [
      [53, 57, 60, 64, 67], // Fmaj9
      [52, 55, 59, 62, 66], // Em9
      [50, 53, 57, 60, 64], // Dm9
      [48, 52, 55, 59, 62], // Cmaj9
    ],
    bass: [41, 40, 38, 36],
    melody: [62, 64, 65, 67, 69, 72, 74, 76],
    melodyProb: 0.16,
    kick: [0, 7, 10],
    snare: [4, 12],
    hatDensity: 0.9,
    crackle: 0.05,
    keysLP: 3200,
  },
};

export class SoundEngine {
  constructor(preset = PRESETS.lofi) {
    this.preset = preset;
    this.ctx = null;
    this.enabled = false;
    this.step = 0;
    this.bar = 0;
    this.pour = 0;
    this.pump = 0;
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
    comp.threshold.value = -16;
    comp.knee.value = 12;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    this.master.connect(comp).connect(ctx.destination);

    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(3.2, 2.6);
    this.revSend = ctx.createGain();
    this.revSend.gain.value = 0.28;
    this.revSend.connect(this.reverb).connect(this.master);

    this.music = ctx.createGain();
    this.music.gain.value = 0.62;
    this.tape = ctx.createBiquadFilter();
    this.tape.type = 'lowpass';
    this.tape.frequency.value = 7200;
    this.tape.Q.value = 0.3;
    this.music.connect(this.tape);
    this.tape.connect(this.master);
    this.tape.connect(this.revSend);

    // tempo-synced echo for melody
    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = (60 / this.preset.bpm) * 0.75;
    const fb = ctx.createGain();
    fb.gain.value = 0.34;
    const dlp = ctx.createBiquadFilter();
    dlp.type = 'lowpass';
    dlp.frequency.value = 2400;
    this.delay.connect(dlp).connect(fb).connect(this.delay);
    dlp.connect(this.music);

    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.9;
    this.sfx.connect(this.master);
    this.sfx.connect(this.revSend);

    this.noiseBuf = this.makeNoise(2);
    this.startCrackle();
    this.startSequencer();
  }

  /* ---------------- public API ---------------- */
  setEnabled(on) {
    if (on) this.init();
    if (!this.ctx) return;
    this.enabled = on;
    const now = this.ctx.currentTime;
    if (on && this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setTargetAtTime(on ? 0.85 : 0, now, on ? 0.6 : 0.25);
    clearTimeout(this._suspendTimer);
    if (!on) this._suspendTimer = setTimeout(() => this.ctx && !this.enabled && this.ctx.suspend(), 1500);
  }

  tick() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(2200, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.05);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.08);
  }

  /* ---------------- building blocks ---------------- */
  makeNoise(sec) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  impulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }

  noiseSource() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    return s;
  }

  startCrackle() {
    const ctx = this.ctx;
    const len = ctx.sampleRate * 4;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      d[i] = (Math.random() * 2 - 1) * 0.012;
      if (Math.random() < 9 / ctx.sampleRate) {
        const amp = 0.3 + Math.random() * 0.7;
        for (let k = 0; k < 40 && i + k < len; k++) d[i + k] += amp * Math.exp(-k / 6) * (Math.random() * 2 - 1);
      }
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 900;
    const g = ctx.createGain();
    g.gain.value = this.preset.crackle;
    src.connect(hp).connect(g).connect(this.master);
    src.start();
  }

  startPour() {
    const ctx = this.ctx;
    // liquid trickle: noise through two resonant bands with a wandering centre
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const bp1 = ctx.createBiquadFilter();
    bp1.type = 'bandpass';
    bp1.frequency.value = 1100;
    bp1.Q.value = 1.4;
    const bp2 = ctx.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 2600;
    bp2.Q.value = 2.2;
    const mixA = ctx.createGain();
    mixA.gain.value = 0.9;
    const mixB = ctx.createGain();
    mixB.gain.value = 0.35;
    this.pourGain = ctx.createGain();
    this.pourGain.gain.value = 0;
    src.connect(bp1).connect(mixA).connect(this.pourGain);
    src.connect(bp2).connect(mixB).connect(this.pourGain);
    this.pourGain.connect(this.sfx);
    src.start();
    this._bp1 = bp1;
    this._bp2 = bp2;
    const wander = () => {
      if (!this.ctx) return;
      const t = ctx.currentTime;
      bp1.frequency.setTargetAtTime(700 + Math.random() * 900 + this.pour * 500, t, 0.05);
      bp2.frequency.setTargetAtTime(1800 + Math.random() * 1600, t, 0.05);
      if (this.enabled && this.pour > 0.08 && Math.random() < this.pour * 0.6) this.bloop(t + Math.random() * 0.05);
    };
    this._wander = setInterval(wander, 70);

    // pump hum
    const hum = ctx.createOscillator();
    hum.type = 'sawtooth';
    hum.frequency.value = 50;
    const hlp = ctx.createBiquadFilter();
    hlp.type = 'lowpass';
    hlp.frequency.value = 170;
    this.pumpGain = ctx.createGain();
    this.pumpGain.gain.value = 0;
    hum.connect(hlp).connect(this.pumpGain).connect(this.sfx);
    hum.start();
  }

  bloop(t) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = 500 + Math.random() * 900;
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * 1.9, t + 0.05);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.03 * this.pour, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    o.connect(g).connect(this.sfx);
    o.start(t);
    o.stop(t + 0.07);
  }

  /* ---------------- instruments ---------------- */
  kick(t, v = 1) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(130, t);
    o.frequency.exponentialRampToValueAtTime(44, t + 0.13);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.45);
  }

  snare(t, v = 1) {
    const ctx = this.ctx;
    const n = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1900;
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.32 * v, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    n.connect(bp).connect(g).connect(this.music);
    g.connect(this.revSend);
    n.start(t, Math.random());
    n.stop(t + 0.22);
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(200, t);
    o.frequency.exponentialRampToValueAtTime(150, t + 0.08);
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.18 * v, t + 0.004);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(og).connect(this.music);
    o.start(t);
    o.stop(t + 0.13);
  }

  hat(t, v = 1, open = false) {
    const ctx = this.ctx;
    const n = this.noiseSource();
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 7200;
    const g = ctx.createGain();
    const dur = open ? 0.22 : 0.045;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.12 * v, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(hp).connect(g).connect(this.music);
    n.start(t, Math.random());
    n.stop(t + dur + 0.02);
  }

  keys(t, midi, dur, v = 1, dest = this.music) {
    const ctx = this.ctx;
    const f = mtof(midi) * (1 + (Math.random() - 0.5) * 0.002);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modG = ctx.createGain();
    const amp = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f;
    modG.gain.setValueAtTime(f * 2.4, t);
    modG.gain.exponentialRampToValueAtTime(f * 0.25, t + 0.5);
    mod.connect(modG).connect(car.frequency);
    lp.type = 'lowpass';
    lp.frequency.value = this.preset.keysLP;
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.09 * v, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.035 * v, t + 0.4);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + dur + 1.4);
    if (pan.pan) pan.pan.value = (Math.random() - 0.5) * 0.5;
    car.connect(lp).connect(amp).connect(pan).connect(dest);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 1.5);
    mod.stop(t + dur + 1.5);
  }

  bass(t, midi, dur, v = 1) {
    const ctx = this.ctx;
    const f = mtof(midi);
    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    o.type = 'sine';
    o2.type = 'triangle';
    o.frequency.value = f;
    o2.frequency.value = f;
    const g = ctx.createGain();
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.42 * v, t + 0.012);
    g.gain.setTargetAtTime(0.25 * v, t + 0.05, 0.2);
    g.gain.setTargetAtTime(0.0001, t + dur, 0.06);
    o.connect(g);
    o2.connect(g2).connect(g);
    g.connect(lp).connect(this.music);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.4);
    o2.stop(t + dur + 0.4);
  }

  /* ---------------- sequencer ---------------- */
  startSequencer() {
    const p = this.preset;
    const stepDur = 60 / p.bpm / 4;
    this.nextTime = this.ctx.currentTime + 0.15;
    const schedule = () => {
      if (!this.ctx) return;
      if (this.ctx.state !== 'running') {
        this.nextTime = this.ctx.currentTime + 0.1;
        return;
      }
      while (this.nextTime < this.ctx.currentTime + 0.14) {
        const s = this.step % 16;
        const swing = s % 2 === 1 ? stepDur * p.swing : 0;
        this.playStep(s, this.nextTime + swing, stepDur);
        this.nextTime += stepDur;
        this.step++;
        if (this.step % 16 === 0) this.bar++;
      }
    };
    this._seq = setInterval(schedule, 25);
  }

  playStep(s, t, stepDur) {
    const p = this.preset;
    const ci = this.bar % p.chords.length;
    const chord = p.chords[ci];
    const intro = this.bar < 2; // keys only for the first two bars
    const r = Math.random;

    if (!intro) {
      if (p.kick.includes(s)) this.kick(t, s === 0 ? 1 : 0.75);
      else if (s === 14 && r() < 0.2) this.kick(t, 0.5);
      if (p.snare.includes(s)) this.snare(t, 0.9);
      if (s % 2 === 0 && r() < p.hatDensity) this.hat(t, s % 4 === 2 ? 0.9 : 0.55, s === 14 && r() < 0.3);
      if (s === 0) this.bass(t, p.bass[ci], stepDur * 6, 1);
      if (s === 10 && r() < 0.7) this.bass(t, p.bass[ci] + (r() < 0.5 ? 12 : 7), stepDur * 3, 0.7);
    }
    if (s === 0) chord.forEach((m, i) => this.keys(t + i * 0.018, m, stepDur * 12, 0.9));
    if (s === 7 && r() < 0.45) chord.slice(1, 4).forEach((m, i) => this.keys(t + i * 0.012, m + 12, stepDur * 3, 0.45));
    if (!intro && s % 2 === 0 && r() < p.melodyProb) {
      const m = p.melody[Math.floor(r() * p.melody.length)] + 12;
      this.keys(t, m, stepDur * 2, 0.5, this.delay);
      this.keys(t, m, stepDur * 2, 0.35);
    }
  }
}
