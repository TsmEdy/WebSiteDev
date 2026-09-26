import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger.js';
import Lenis from 'lenis';
import { Experience, POSES } from './scene.js';
import { SoundEngine } from './audio.js';
import * as P from './pour.js';
import * as UI from './ui.js';
import { grainDataURL } from './textures.js';

gsap.registerPlugin(ScrollTrigger);
document.documentElement.classList.add('js');

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const coarse = matchMedia('(pointer: coarse)').matches;
const mobile = coarse || innerWidth < 760;
const $ = (s) => document.querySelector(s);

/* ---------------- film grain ---------------- */
$('.grain').style.backgroundImage = `url(${grainDataURL()})`;

/* ---------------- preloader ---------------- */
const loaderEl = $('#loader');
const statusEl = $('#loaderStatus');
const pctEl = $('#loaderPct');
const barEl = $('#loaderBar');
const statuses = ['Măcinăm boabele', 'Tasăm la 15 kg', 'Preîncălzim grupul', 'Calibrăm presiunea', 'Aproape gata'];
let statusIdx = 0;
const statusTimer = setInterval(() => {
  statusIdx = Math.min(statusIdx + 1, statuses.length - 1);
  gsap.to(statusEl, {
    opacity: 0, y: -8, duration: 0.25, onComplete: () => {
      statusEl.textContent = statuses[statusIdx];
      gsap.fromTo(statusEl, { opacity: 0, y: 8 }, { opacity: 1, y: 0, duration: 0.35 });
    },
  });
}, 700);
const progress = { v: 0 };
const setProgress = (v, d = 0.8) => gsap.to(progress, {
  v, duration: d, ease: 'power2.out', overwrite: true,
  onUpdate: () => {
    pctEl.textContent = Math.round(progress.v);
    barEl.style.transform = `scaleX(${progress.v / 100})`;
  },
});
setProgress(35, 1.2);

/* ---------------- smooth scroll ---------------- */
const lenis = new Lenis({
  duration: reduced ? 0 : 1.35,
  smoothWheel: !reduced,
  wheelMultiplier: 0.9,
  touchMultiplier: 1.3,
});
lenis.stop();
lenis.on('scroll', ScrollTrigger.update);
window.scrollTo(0, 0);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

/* ---------------- sound ---------------- */
// Sound is ON by default. Browsers only let audio start after the first
// click / tap / key press, so we arm it immediately and unlock it on the
// visitor's first gesture. The header button is a plain mute toggle.
const sound = new SoundEngine();
const soundBtn = $('#soundToggle');
const soundHint = $('#soundHint');
let wantSound = true;
try { wantSound = localStorage.getItem('eds-sound') !== 'off'; } catch (e) { /* storage blocked */ }
const audible = () => sound.enabled && sound.ctx && sound.ctx.state === 'running';
const reflectSound = () => {
  soundBtn.classList.toggle('is-on', sound.enabled);
  soundBtn.setAttribute('aria-pressed', String(sound.enabled));
  soundBtn.setAttribute('data-cursor', sound.enabled ? 'Mute' : 'Sunet');
  soundHint.classList.toggle('is-visible', sound.enabled && !audible());
};
const setSound = (on) => {
  sound.setEnabled(on);
  try { localStorage.setItem('eds-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
  reflectSound();
};
const unlockSound = () => {
  if (sound.enabled && sound.ctx && sound.ctx.state !== 'running') sound.ctx.resume().then(reflectSound, () => {});
};
['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, unlockSound, { capture: true, passive: true }));
soundBtn.addEventListener('click', () => {
  // first click while the browser still holds audio back: just unlock, don't mute
  if (sound.enabled && !audible()) {
    unlockSound();
    return;
  }
  setSound(!sound.enabled);
});
document.addEventListener('visibilitychange', () => {
  if (!sound.ctx) return;
  if (document.hidden) sound.master.gain.setTargetAtTime(0, sound.ctx.currentTime, 0.1);
  else if (sound.enabled) sound.master.gain.setTargetAtTime(0.85, sound.ctx.currentTime, 0.4);
});

/* ---------------- scroll → time mapping ---------------- */
const state = { progress: 0, velocity: 0, tau: 0 };
let tauKnots = [[0, 0], [0.14, 6], [1, P.TAU_END]];
function mapTau(p) {
  for (let i = 1; i < tauKnots.length; i++) {
    const [p0, t0] = tauKnots[i - 1];
    const [p1, t1] = tauKnots[i];
    if (p <= p1) return t0 + ((p - p0) / Math.max(p1 - p0, 1e-5)) * (t1 - t0);
  }
  return P.TAU_END;
}

let exp = null;

function measure() {
  const vh = innerHeight;
  const max = Math.max(document.documentElement.scrollHeight - vh, 1);
  const frames = [];
  document.querySelectorAll('[data-cam]').forEach((el) => {
    const top = el.getBoundingClientRect().top + scrollY;
    let p = (top + el.offsetHeight / 2 - vh / 2) / max;
    if (el.id === 'hero') p = 0;
    if (el.tagName === 'FOOTER') p = 1;
    frames.push({ p: Math.min(Math.max(p, 0), 1), pose: POSES[el.dataset.cam], id: el.id || el.tagName });
  });
  frames.sort((a, b) => a.p - b.p);
  exp && exp.setKeyframes(frames);
  const ex = frames.find((f) => f.id === 'extractie');
  const visit = frames.find((f) => f.id === 'vizita');
  tauKnots = [[0, 0], [ex ? ex.p : 0.14, 6.2], [visit ? visit.p : 0.92, 30.2], [1, P.TAU_END]];
}

/* ---------------- HUD ---------------- */
const hud = {
  time: $('#hudTime'),
  bar: $('#hudBar'),
  yield: $('#hudYield'),
  state: $('#hudState'),
  stateText: $('#hudState span'),
  fill: $('#fillMeter'),
};
let hudAcc = 0;
let lastStateText = '';
function updateHud(dt, tau, dTau, info) {
  hudAcc += dt;
  hud.fill.style.transform = `scaleY(${info.frac.toFixed(4)})`;
  if (hudAcc < 0.05) return;
  hudAcc = 0;
  const t = Math.min(tau, P.SHOT_TIME);
  const s = Math.floor(t);
  hud.time.textContent = `00:${String(s).padStart(2, '0')}.${Math.floor((t - s) * 10)}`;
  hud.bar.textContent = `${Math.max(info.pressure, 0).toFixed(1)} bar`;
  hud.yield.textContent = `${(info.frac * 36).toFixed(1)} g`;
  const flowing = Math.abs(dTau) > 0.08;
  let text;
  if (tau < 0.05) text = 'Gata de extracție';
  else if (tau > 30) text = 'Shot complet ✦';
  else if (flowing) text = dTau > 0 ? 'Curge…' : 'Derulezi înapoi în timp';
  else text = 'Timp înghețat';
  if (text !== lastStateText) {
    hud.stateText.textContent = text;
    lastStateText = text;
  }
  hud.state.classList.toggle('is-flowing', flowing);
}

/* ---------------- boot ---------------- */
async function boot() {
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  await Promise.all([
    document.fonts.load('400 64px "Fraunces"'),
    document.fonts.load('italic 300 64px "Fraunces"'),
    document.fonts.load('500 32px "IBM Plex Mono"'),
  ]).catch(() => {});
  setProgress(60, 0.6);
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 40)));

  try {
    exp = new Experience($('#webgl'), { mobile, reducedMotion: reduced });
    measure();
    exp.compile();
  } catch (err) {
    console.error('[EdSpresso] WebGL unavailable', err);
    document.body.classList.add('no-webgl');
  }
  setProgress(100, 0.8);
  await new Promise((r) => setTimeout(r, 850));
  clearInterval(statusTimer);
  gsap.killTweensOf(statusEl);
  gsap.set(statusEl, { opacity: 1, y: 0 });
  statusEl.textContent = 'Espresso-ul te așteaptă';
  document.querySelector('.loader__dots').style.display = 'none';

  // run the render loop behind the loader already, then walk straight in
  gsap.ticker.add(frame);
  const params = new URLSearchParams(location.search);
  if (params.has('debug')) window.__site = { lenis, exp, state };
  setTimeout(enter, params.has('autostart') ? 0 : 450);
}

let introObj = { v: 0 };
function enter() {
  setSound(wantSound && !new URLSearchParams(location.search).has('autostart'));
  document.body.classList.remove('is-loading');
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.to('.loader__inner', { opacity: 0, y: -30, duration: 0.6, ease: 'power2.in' })
    .to(loaderEl, { clipPath: 'inset(0 0 100% 0)', duration: 1.3, ease: 'expo.inOut' }, '-=0.1')
    .set(loaderEl, { display: 'none' })
    .to(introObj, { v: 1, duration: 3.2, ease: 'expo.out', onUpdate: () => exp && (exp.intro = introObj.v) }, 0.5)
    .from('[data-hero-line]', { yPercent: 110, rotate: 3, duration: 1.6, stagger: 0.12 }, 1.0)
    .to('.hero [data-reveal]', { opacity: 1, y: 0, duration: 1.4, stagger: 0.1 }, 1.3)
    .from('#header > *', { y: -30, opacity: 0, duration: 1.4, stagger: 0.08 }, 1.2)
    .to('.hud', { opacity: 1, y: 0, duration: 1.2 }, 1.6)
    .from('.scroll-cue', { opacity: 0, y: 20, duration: 1.2 }, 1.8)
    .add(() => lenis.start(), 1.1);

  UI.initSplitHeadings();
  UI.initReveals();
  UI.initScrubWords();
  UI.initCounters();
  UI.initTilt();
  UI.initMagnetic();
  UI.initTabs({ onChange: () => sound.tick() });
  UI.initMarquee($('#marquee'), () => lenis.velocity || 0);
  UI.initHeader(lenis);
  UI.initNewsletter();
  const closeMenu = UI.initMobileMenu(lenis);
  UI.initScrollLinks(lenis, closeMenu);

  ScrollTrigger.create({
    trigger: '#vizita',
    start: 'top 40%',
    onEnter: () => exp && exp.setLogo(1),
    onLeaveBack: () => exp && exp.setLogo(0),
  });
  ScrollTrigger.create({
    trigger: '.footer',
    start: 'top 85%',
    onToggle: (self) => $('.hud').classList.toggle('is-away', self.isActive),
  });
  ScrollTrigger.addEventListener('refresh', measure);
  ScrollTrigger.refresh();
}

/* ---------------- frame loop ---------------- */
function frame(time, deltaMs) {
  lenis.raf(time * 1000);
  const dt = Math.min(deltaMs / 1000, 0.1) || 0.016;
  const p = Number.isFinite(lenis.progress) ? lenis.progress : 0;
  state.progress = Math.min(Math.max(p, 0), 1);
  state.velocity = lenis.velocity || 0;
  const tau = mapTau(state.progress);
  const dTau = (tau - state.tau) / dt;
  state.tau = tau;
  if (!exp) return;
  const info = exp.update(dt, time, state);
  updateHud(dt, tau, dTau, info);
}
gsap.ticker.lagSmoothing(0);

/* ---------------- input ---------------- */
window.addEventListener('pointermove', (e) => {
  exp && exp.setMouse((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
}, { passive: true });

let resizeTimer;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => {
    exp && exp.resize();
    ScrollTrigger.refresh();
  }, 120);
});

UI.initCursor({ onHover: () => sound.tick() });
boot();
