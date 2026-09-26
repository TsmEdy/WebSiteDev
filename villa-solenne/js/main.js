import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger.js';
import Lenis from 'lenis';
import { VillaWorld, POSES } from './world.js';
import { VillaAudio } from './audio.js';
import { applyLang, t as tr } from './i18n.js';
import * as UI from './ui.js';

gsap.registerPlugin(ScrollTrigger);
document.documentElement.classList.add('js');
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

/* ---------------- language ---------------- */
let lang = 'ro';
try { lang = localStorage.getItem('vs-lang') || 'ro'; } catch (e) { /* storage unavailable */ }
const setLang = (l) => {
  lang = l;
  applyLang(l);
  $$('[data-lang]').forEach((b) => b.classList.toggle('is-active', b.dataset.lang === l));
  try { localStorage.setItem('vs-lang', l); } catch (e) { /* ignore */ }
  const cur = $('#roomName').getAttribute('data-i18n');
  if (cur) applyLang(l);
};
setLang(lang);
$$('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

/* ---------------- season ---------------- */
let winter = false;
let world = null;
const audio = new VillaAudio();
const setSeason = (w) => {
  winter = w;
  document.body.classList.toggle('winter', w);
  $$('.season-opt').forEach((b) => {
    const on = (b.dataset.season === 'winter') === w;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-checked', String(on));
  });
  $('#seasonMini .ico').textContent = w ? '❄' : '☀';
  world && world.setSeason(w);
  audio.setWinter(w ? 1 : 0);
  audio.chime();
};
$$('.season-opt').forEach((b) => b.addEventListener('click', () => setSeason(b.dataset.season === 'winter')));
$('#seasonMini').addEventListener('click', () => setSeason(!winter));

/* ---------------- loader ---------------- */
const pct = { v: 0 };
const setPct = (v, d) => gsap.to(pct, { v, duration: d, ease: 'power2.out', overwrite: true, onUpdate: () => ($('#loaderPct').textContent = Math.round(pct.v)) });
setPct(40, 1.6);

/* ---------------- scroll ---------------- */
const lenis = new Lenis({ duration: reduced ? 0 : 1.8, smoothWheel: !reduced, wheelMultiplier: 0.8, touchMultiplier: 1.3 });
lenis.stop();
lenis.on('scroll', ScrollTrigger.update);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

/* ---------------- sound ---------------- */
// Sound ON by default; browsers unlock audio on the first click/tap/key.
const soundBtn = $('#soundToggle');
const soundHint = $('#soundHint');
let wantSound = true;
try { wantSound = localStorage.getItem('vs-sound') !== 'off'; } catch (e) { /* storage blocked */ }
const audible = () => audio.enabled && audio.ctx && audio.ctx.state === 'running';
const reflectSound = () => {
  soundBtn.classList.toggle('is-on', audio.enabled);
  soundBtn.setAttribute('aria-pressed', String(audio.enabled));
  soundHint.classList.toggle('is-visible', audio.enabled && !audible());
};
const setSound = (on) => {
  audio.setEnabled(on);
  audio.setWinter(winter ? 1 : 0);
  try { localStorage.setItem('vs-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
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
  audio.master.gain.setTargetAtTime(document.hidden || !audio.enabled ? 0 : 0.9, audio.ctx.currentTime, 0.3);
});

/* ---------------- keyframes ---------------- */
const state = { progress: 0 };
function measure() {
  const vh = innerHeight;
  const max = Math.max(document.documentElement.scrollHeight - vh, 1);
  const frames = [];
  $$('[data-cam]').forEach((el) => {
    const top = el.getBoundingClientRect().top + scrollY;
    let p = (top + el.offsetHeight / 2 - vh / 2) / max;
    if (el.dataset.cam === '0') p = 0;
    if (el.tagName === 'FOOTER') p = 1;
    frames.push({ p: clamp(p, 0, 1), cam: Number(el.dataset.cam) });
  });
  frames.sort((a, b) => a.p - b.p);
  world && world.setKeyframes(frames);
}

/* ---------------- boot ---------------- */
async function boot() {
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  setPct(70, 0.6);
  await new Promise((r) => setTimeout(r, 60));
  try {
    world = new VillaWorld($('#webgl'), { mobile, reduced });
    measure();
    world.compile();
  } catch (e) {
    console.error('[Villa Solenne] WebGL failed', e);
  }
  setPct(100, 0.8);
  await new Promise((r) => setTimeout(r, 900));
  gsap.ticker.add(frame);
  const params = new URLSearchParams(location.search);
  if (params.has('winter')) setSeason(true);
  if (params.has('debug')) window.__site = { lenis, world, state };
  setTimeout(enter, params.has('autostart') ? 0 : 300);
}

function enter() {
  setSound(wantSound && !new URLSearchParams(location.search).has('autostart'));
  document.body.classList.remove('is-loading');
  const intro = { v: 0 };
  const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
  tl.to('.loader__center', { opacity: 0, y: -20, duration: 0.6, ease: 'power2.in' })
    .to('#loader', { opacity: 0, duration: 1.4, ease: 'power2.inOut' }, 0.3)
    .set('#loader', { display: 'none' })
    .to(intro, { v: 1, duration: 4, ease: 'power3.out', onUpdate: () => world && (world.intro = intro.v) }, 0.2)
    .from('[data-hero-line]', { yPercent: 110, duration: 1.8, stagger: 0.15 }, 1.0)
    .from('[data-hero]', { opacity: 0, y: 20, duration: 1.6, stagger: 0.1 }, 1.4)
    .from('.header > *', { opacity: 0, y: -20, duration: 1.4, stagger: 0.08 }, 1.4)
    .to('.room-indicator', { opacity: 1, duration: 1.2 }, 1.8)
    .add(() => lenis.start(), 1.2);

  UI.initReveals();
  UI.initMagnetic();
  UI.initHeader(lenis);
  UI.initScrollLinks(lenis, () => toggleNav(false));

  $$('[data-room]').forEach((sec) => {
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => {
        if (!self.isActive) return;
        const [num, key] = sec.dataset.room.split('|');
        setRoom(num, key);
      },
    });
  });
  ScrollTrigger.create({ trigger: '#home', start: 'top top', end: 'bottom 40%', onToggle: (s) => s.isActive && setRoom('00', 'nav.home') });

  $$('.suite').forEach((b) => b.addEventListener('click', () => {
    $$('.suite').forEach((x) => x.classList.toggle('is-active', x === b));
    audio.chime();
  }));

  // booking demo
  const inEl = $('#dateIn');
  const outEl = $('#dateOut');
  const d0 = new Date();
  d0.setDate(d0.getDate() + 14);
  const d1 = new Date(d0);
  d1.setDate(d1.getDate() + 3);
  const iso = (d) => d.toISOString().slice(0, 10);
  inEl.value = iso(d0);
  outEl.value = iso(d1);
  inEl.min = iso(new Date());
  $('#booking').addEventListener('submit', (e) => {
    e.preventDefault();
    const a = new Date(inEl.value);
    const b = new Date(outEl.value);
    const msg = $('#bookingMsg');
    const n = Math.round((b - a) / 86400000);
    if (!inEl.value || !outEl.value || !(n > 0)) msg.textContent = tr(lang, 'book.err');
    else msg.textContent = tr(lang, 'book.ok', { n, g: $('#guests').value });
    gsap.fromTo(msg, { opacity: 0, y: 10 }, { opacity: 1, y: 0, duration: 0.8, ease: 'expo.out' });
    audio.chime();
  });

  ScrollTrigger.addEventListener('refresh', measure);
  ScrollTrigger.refresh();
}

function setRoom(num, key) {
  const nameEl = $('#roomName');
  if (nameEl.getAttribute('data-i18n') === key) return;
  $('#roomNum').textContent = num;
  nameEl.setAttribute('data-i18n', key);
  applyLang(lang);
  gsap.fromTo(nameEl, { opacity: 0, x: 10 }, { opacity: 1, x: 0, duration: 0.8, ease: 'expo.out' });
}

const navBtn = $('#menuBtn');
const nav = $('#overlayNav');
function toggleNav(open) {
  navBtn.setAttribute('aria-expanded', String(open));
  nav.classList.toggle('is-open', open);
  nav.setAttribute('aria-hidden', String(!open));
  if (open) {
    lenis.stop();
    gsap.fromTo('.overlay-nav li', { y: 40, opacity: 0 }, { y: 0, opacity: 1, duration: 1, stagger: 0.06, delay: 0.25, ease: 'expo.out' });
  } else lenis.start();
}
navBtn.addEventListener('click', () => toggleNav(navBtn.getAttribute('aria-expanded') !== 'true'));
document.addEventListener('keydown', (e) => e.key === 'Escape' && toggleNav(false));

/* ---------------- frame ---------------- */
let wasRush = false;
function frame(time, deltaMs) {
  lenis.raf(time * 1000);
  const dt = Math.min(deltaMs / 1000, 0.1) || 0.016;
  state.progress = clamp(Number.isFinite(lenis.progress) ? lenis.progress : 0, 0, 1);
  if (!world) return;
  world.update(dt, time, state);
  const rushing = world.rush > 0.6;
  wasRush = rushing;
  if (audio.enabled) {
    const z = world.camera.position.z;
    const out = z > 1 || z < -138 ? 1 : z < -70 && z > -110 ? 0.6 : 0.15;
    audio.setOutdoors(out);
  }
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

UI.initCursor({});
boot();
