import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger.js';
import Lenis from 'lenis';
import { World, TAU_SCALE } from './world.js';
import { WalkAudio } from './audio.js';
import * as UI from './ui.js';
import { grainDataURL, clamp } from './util.js';

gsap.registerPlugin(ScrollTrigger);
document.documentElement.classList.add('js');
const $ = (s) => document.querySelector(s);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

$('.grain').style.backgroundImage = `url(${grainDataURL()})`;

/* ---------------- loader ---------------- */
const loadObj = { v: 0 };
const labels = ['Lacing up', 'Stretching', 'Checking the map', 'Filling the flask', 'Ready'];
const labelEl = $('#loaderLabel');
const countEl = $('#loaderCount');
const barEl = $('#loaderBar');
const setLoad = (v, d = 0.8) => gsap.to(loadObj, {
  v, duration: d, ease: 'power2.out', overwrite: true,
  onUpdate: () => {
    countEl.textContent = String(Math.round(loadObj.v * 100)).padStart(5, '0');
    barEl.style.transform = `scaleX(${loadObj.v / 100})`;
    labelEl.textContent = labels[Math.min(Math.floor(loadObj.v / 25), labels.length - 1)];
  },
});
setLoad(30, 1.4);

/* ---------------- scroll ---------------- */
const lenis = new Lenis({ duration: reduced ? 0 : 1.5, smoothWheel: !reduced, wheelMultiplier: 0.85, touchMultiplier: 1.4 });
lenis.stop();
lenis.on('scroll', ScrollTrigger.update);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

/* ---------------- audio ---------------- */
// Sound ON by default; browsers unlock audio on the first click/tap/key.
const audio = new WalkAudio();
const soundBtn = $('#soundToggle');
const soundHint = $('#soundHint');
let wantSound = true;
try { wantSound = localStorage.getItem('steps-sound') !== 'off'; } catch (e) { /* storage blocked */ }
const audible = () => audio.enabled && audio.ctx && audio.ctx.state === 'running';
const reflectSound = () => {
  soundBtn.classList.toggle('is-on', audio.enabled);
  soundBtn.setAttribute('aria-pressed', String(audio.enabled));
  soundBtn.setAttribute('data-cursor', audio.enabled ? 'Mute' : 'Sound');
  soundHint.classList.toggle('is-visible', audio.enabled && !audible());
};
const setSound = (on) => {
  audio.setEnabled(on);
  try { localStorage.setItem('steps-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  reflectSound();
};
const unlockSound = () => {
  if (audio.enabled && audio.ctx && audio.ctx.state !== 'running') audio.ctx.resume().then(reflectSound, () => {});
};
['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, unlockSound, { capture: true, passive: true }));
soundBtn.addEventListener('click', () => {
  if (audio.enabled && !audible()) {
    unlockSound();
    return;
  }
  setSound(!audio.enabled);
});
document.addEventListener('visibilitychange', () => {
  if (!audio.ctx) return;
  audio.master.gain.setTargetAtTime(document.hidden || !audio.enabled ? 0 : 0.8, audio.ctx.currentTime, 0.2);
});

/* ---------------- state ---------------- */
let world = null;
const state = { progress: 0, velocity: 0, tau: 0 };
let stepKnots = [[0, 0], [1, 10000]];
let pImpact = 0.8;

function measure() {
  const vh = innerHeight;
  const max = Math.max(document.documentElement.scrollHeight - vh, 1);
  const frames = [];
  document.querySelectorAll('[data-cam]').forEach((el) => {
    const top = el.getBoundingClientRect().top + scrollY;
    let p = (top + el.offsetHeight / 2 - vh / 2) / max;
    if (el.dataset.cam === '0') p = 0;
    frames.push({ p: clamp(p, 0, 1), cam: Number(el.dataset.cam) });
  });
  frames.push({ p: 1, cam: 8 });
  frames.sort((a, b) => a.p - b.p);
  world && world.setKeyframes(frames);
  const at = (cam) => (frames.find((f) => f.cam === cam) || { p: 1 }).p;
  stepKnots = [[0, 0], [at(1), 1200], [at(2), 3400], [at(3), 5600], [at(4), 7800], [at(5), 10000], [1, 10000]];
  pImpact = at(5) - 0.012;
}
function stepsAt(p) {
  for (let i = 1; i < stepKnots.length; i++) {
    const [p0, s0] = stepKnots[i - 1];
    const [p1, s1] = stepKnots[i];
    if (p <= p1) return s0 + ((p - p0) / Math.max(p1 - p0, 1e-6)) * (s1 - s0);
  }
  return 10000;
}

/* ---------------- HUD ---------------- */
const stepEl = $('#stepCount');
const stepBar = $('#stepBar');
const paceEl = $('#pace');
const paceText = $('#paceText');
let lastPace = '';
let hudAcc = 0;
let lastStride = 0;
let lastStepSound = 0;
let prevP = 0;
function updateHud(dt, steps, rate) {
  stepBar.style.transform = `scaleX(${(steps / 10000).toFixed(4)})`;
  hudAcc += dt;
  if (hudAcc < 0.04) return;
  hudAcc = 0;
  const s = Math.round(steps);
  stepEl.textContent = s.toLocaleString('en-US', { minimumIntegerDigits: 5, useGrouping: true });
  let text;
  const r = Math.abs(rate);
  if (r < 0.02) text = 'Paused · time frozen';
  else if (rate < 0) text = `Walking back · ${r.toFixed(1)}×`;
  else if (r < 0.6) text = `Strolling · ${r.toFixed(1)}×`;
  else if (r < 1.8) text = `Walking · ${r.toFixed(1)}×`;
  else if (r < 4) text = `Jogging · ${r.toFixed(1)}×`;
  else text = `Sprinting · ${r.toFixed(1)}×`;
  if (text !== lastPace) {
    paceText.textContent = text;
    lastPace = text;
  }
  paceEl.classList.toggle('is-moving', r >= 0.02);
}

/* ---------------- boot ---------------- */
async function boot() {
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  setLoad(62, 0.8);
  await new Promise((r) => setTimeout(r, 60));
  try {
    world = new World($('#webgl'), { mobile, reducedMotion: reduced });
    measure();
    world.compile();
  } catch (e) {
    console.error('[10,000 Steps] WebGL failed', e);
    document.body.classList.add('no-webgl');
  }
  setLoad(100, 0.9);
  await new Promise((r) => setTimeout(r, 950));
  labelEl.textContent = "Let's walk";
  gsap.ticker.add(frame);
  const params = new URLSearchParams(location.search);
  if (params.has('debug')) window.__site = { lenis, world, state };
  setTimeout(enter, params.has('autostart') ? 0 : 350);
}

function enter() {
  setSound(wantSound && !new URLSearchParams(location.search).has('autostart'));
  document.body.classList.remove('is-loading');
  const introObj = { v: 0 };
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.to('.loader__count', { yPercent: -30, opacity: 0, duration: 0.6, ease: 'power2.in' })
    .to('#loader', { yPercent: -100, duration: 1.4, ease: 'expo.inOut' }, 0.3)
    .set('#loader', { display: 'none' })
    .to(introObj, { v: 1, duration: 3.4, ease: 'power3.out', onUpdate: () => world && (world.intro = introObj.v) }, 0.3)
    .from('[data-hero-line]', { yPercent: 105, duration: 1.5, stagger: 0.1 }, 0.9)
    .from('[data-hero]', { y: 30, opacity: 0, duration: 1.3, stagger: 0.08 }, 1.2)
    .from('.header > *', { y: -24, opacity: 0, duration: 1.2, stagger: 0.06 }, 1.1)
    .to('.hud', { opacity: 1, duration: 1 }, 1.6)
    .add(() => lenis.start(), 1.0);

  UI.initSplitHeadings();
  UI.initReveals();
  UI.initTilt();
  UI.initMagnetic();
  UI.initHeader(lenis);
  UI.initScrollLinks(lenis);

  // theme + chapter tag
  document.querySelectorAll('[data-theme]').forEach((sec) => {
    if (sec === document.body) return;
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 50%',
      end: 'bottom 50%',
      onToggle: (self) => {
        if (!self.isActive) return;
        document.body.dataset.theme = sec.dataset.theme;
        const ch = sec.dataset.chapter;
        if (ch) {
          const [num, name] = ch.split('|');
          $('#chapterNum').textContent = num;
          $('#chapterName').textContent = name;
          gsap.fromTo('#chapterName', { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, ease: 'expo.out' });
        } else {
          $('#chapterNum').textContent = '00';
          $('#chapterName').textContent = 'Start';
        }
      },
    });
  });

  // bag
  let cart = 0;
  let toastTimer;
  document.querySelectorAll('[data-add]').forEach((b) => b.addEventListener('click', () => {
    cart++;
    $('#cartCount').textContent = cart;
    const toast = $('#toast');
    toast.textContent = `${b.dataset.add} added to your bag ✓`;
    toast.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-on'), 2200);
    gsap.fromTo('#cartBtn', { scale: 0.9 }, { scale: 1, duration: 0.8, ease: 'elastic.out(1, 0.4)' });
    audio.tick();
  }));
  $('#cartBtn').addEventListener('click', () => lenis.scrollTo('#beans', { duration: 2 }));

  ScrollTrigger.addEventListener('refresh', measure);
  ScrollTrigger.refresh();
}

/* ---------------- frame ---------------- */
function frame(time, deltaMs) {
  lenis.raf(time * 1000);
  const dt = Math.min(deltaMs / 1000, 0.1) || 0.016;
  const p = clamp(Number.isFinite(lenis.progress) ? lenis.progress : 0, 0, 1);
  const tau = p * TAU_SCALE;
  const rate = (tau - state.tau) / dt;
  state.progress = p;
  state.velocity = lenis.velocity || 0;
  state.tau = tau;
  if (!world) return;
  world.update(dt, time, state);
  const steps = stepsAt(p);
  updateHud(dt, steps, rate);

  if (audio.enabled) {
    audio.setMood(world.fire || 0);
    const stride = Math.floor(steps / 40);
    const now = performance.now();
    if (stride !== lastStride && Math.abs(state.velocity) > 0.4 && now - lastStepSound > 110 && steps < 9990) {
      const cz = world.camera.position.z;
      audio.footstep(clamp(Math.abs(state.velocity) / 12, 0.35, 1), cz < -215 && cz > -330 ? 1 : 0);
      lastStepSound = now;
    }
    lastStride = stride;
    if (prevP < pImpact && p >= pImpact) audio.plop();
  }
  prevP = p;
}
gsap.ticker.lagSmoothing(0);

window.addEventListener('pointermove', (e) => {
  world && world.setMouse((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
}, { passive: true });
let rt;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    world && world.resize();
    ScrollTrigger.refresh();
  }, 120);
});

UI.initCursor({ onHover: () => audio.tick() });
boot();
