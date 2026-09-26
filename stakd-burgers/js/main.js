import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger.js';
import { SplitText } from 'gsap/SplitText.js';
import Lenis from 'lenis';
import { BurgerScene, RECIPES, LABELS } from './burger.js';
import { GrooveAudio } from './audio.js';
import * as UI from './ui.js';

gsap.registerPlugin(ScrollTrigger, SplitText);
document.documentElement.classList.add('js');
const $ = (s) => document.querySelector(s);
const $$ = (s) => Array.from(document.querySelectorAll(s));
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const params = new URLSearchParams(location.search);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = matchMedia('(pointer: coarse)').matches || innerWidth < 760;

/* ---------------- loader ---------------- */
const loaderTexts = ['Firing the flat-top', 'Ageing the chuck', 'Glazing the brioche', 'Melting the cheddar', 'Setting your table'];
let li = 0;
const loaderText = $('#loaderText');
const loaderMark = $('.loader__mark');
const loaderTimer = setInterval(() => {
  li = (li + 1) % loaderTexts.length;
  gsap.fromTo(loaderText, { yPercent: 40, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.7, ease: 'expo.out' });
  loaderText.textContent = loaderTexts[li];
}, 900);
const load = { v: 0 };
const setLoad = (v, d) => gsap.to(load, {
  v,
  duration: d,
  overwrite: true,
  ease: 'power2.out',
  onUpdate: () => {
    $('#loaderBar').style.transform = `scaleX(${load.v})`;
    $('#loaderPct').textContent = String(Math.round(load.v * 100)).padStart(3, '0');
    loaderMark.style.setProperty('--fill', `${(load.v * 100).toFixed(1)}%`);
  },
});
setLoad(0.35, 1.2);

/* ---------------- scroll ---------------- */
const lenis = new Lenis({ duration: reduced ? 0 : 1.25, smoothWheel: !reduced, wheelMultiplier: 0.9, touchMultiplier: 1.3 });
lenis.stop();
lenis.on('scroll', ScrollTrigger.update);
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
window.scrollTo(0, 0);

/* ---------------- sound: on by default, one click unlocks, header toggle mutes ---------------- */
const audio = new GrooveAudio();
const soundBtn = $('#soundToggle');
const soundHint = $('#soundHint');
let wantSound = true;
try { wantSound = localStorage.getItem('stakd-sound') !== 'off'; } catch (e) { /* private mode */ }
const audible = () => audio.enabled && audio.ctx && audio.ctx.state === 'running';
const reflectSound = () => {
  soundBtn.classList.toggle('is-on', audio.enabled);
  soundBtn.setAttribute('aria-pressed', String(audio.enabled));
  soundBtn.setAttribute('aria-label', audio.enabled ? 'Mute sound' : 'Turn sound on');
  soundBtn.setAttribute('data-cursor', audio.enabled ? 'Mute' : 'Sound');
  soundHint.classList.toggle('is-visible', audio.enabled && !audible());
};
const setSound = (on) => {
  audio.setEnabled(on);
  try { localStorage.setItem('stakd-sound', on ? 'on' : 'off'); } catch (e) { /* ignore */ }
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
  audio.master.gain.setTargetAtTime(document.hidden || !audio.enabled ? 0 : 0.75, audio.ctx.currentTime, 0.15);
});

/* ---------------- burger poses keyed to scroll ---------------- */
// x / y are fractions of the viewport (0 = centre), s = scale
const POSE = {
  hero: { x: 0.12, y: 0.03, s: 1.05, rotY: 0.5, tilt: 0.14, floaters: 1, shadow: 1, explode: 0, spin: 1 },
  anatomy: { x: 0.1, y: -0.02, s: 0.78, rotY: 0.8, tilt: 0.24, floaters: 0.45, shadow: 0.8, explode: 0, spin: 0.6 },
  exploded: { x: 0.08, y: 0.0, s: 0.5, rotY: 0.95, tilt: 0.3, floaters: 0.3, shadow: 0.5, explode: 1, spin: 0.25 },
  statement: { x: -0.42, y: -0.02, s: 0.52, rotY: 1.6, tilt: 0.5, floaters: 0.15, shadow: 0.6, explode: 0.12, spin: 0.8 },
  menu: { x: -0.2, y: -0.03, s: 1.0, rotY: 0.45, tilt: 0.18, floaters: 0.6, shadow: 1, explode: 0, spin: 0.7 },
  gone: { x: -0.12, y: 0.95, s: 0.3, rotY: 2.4, tilt: 0.5, floaters: 0, shadow: 0, explode: 0.5, spin: 0.5 },
  under: { x: 0, y: -0.95, s: 0.3, rotY: -0.6, tilt: 0.3, floaters: 0, shadow: 0, explode: 0.3, spin: 0.5 },
  order: { x: 0, y: -0.27, s: 0.82, rotY: 0.35, tilt: 0.1, floaters: 1, shadow: 1, explode: 0, spin: 0.8 },
};
// phones: labels hang off the right side, the menu card sits under the burger
const POSE_MOBILE = {
  hero: { x: 0, y: 0.17, s: 1.12 },
  anatomy: { x: -0.08, y: 0.0, s: 0.9 },
  exploded: { x: -0.2, y: -0.03, s: 0.66 },
  statement: { x: 0, y: -0.52, s: 0.4 },
  menu: { x: 0, y: 0.2, s: 1.0 },
  order: { y: -0.26, s: 1.0 },
};
const isPhone = () => innerWidth < 700;
for (const k of Object.keys(POSE_MOBILE)) POSE_MOBILE[k] = { ...POSE[k], ...POSE_MOBILE[k] };
const P = (k) => (isPhone() && POSE_MOBILE[k] ? POSE_MOBILE[k] : POSE[k]);
const hidden = (k) => ({ ...P(k), s: 0.0001 });

let keys = [];
const PROPS = ['x', 'y', 's', 'rotY', 'tilt', 'floaters', 'shadow', 'explode', 'spin'];
let menuRange = [0, 1];
let anatomyRange = [0, 1];

function measure() {
  const vh = innerHeight;
  const top = (el) => el.getBoundingClientRect().top + scrollY;
  const an = $('#anatomy');
  const anT = top(an);
  const anLen = an.offsetHeight - vh;
  const st = $('.statement');
  const me = $('#menu');
  const meT = top(me);
  const meLen = me.offsetHeight - vh;
  const cr = $('#craft');
  const sp = $('#spots');
  const rs = $('#reserve');
  const rsT = top(rs);
  const max = document.documentElement.scrollHeight - vh;
  const rsSettle = Math.min(rsT + Math.max(rs.offsetHeight - vh, 0), max);
  keys = [
    [0, P('hero')],
    [anT - vh * 0.15, P('anatomy')],
    [anT + anLen * 0.4, P('exploded')],
    [anT + anLen * 0.8, P('exploded')],
    [anT + anLen, P('anatomy')],
    [top(st) + st.offsetHeight * 0.5 - vh * 0.5, P('statement')],
    [meT, P('menu')],
    [meT + meLen, P('menu')],
    [top(cr) + vh * 0.35, POSE.gone],
    [top(sp), hidden('gone')],
    [rsT - vh * 0.9, hidden('under')],
    [rsT - vh * 0.25, POSE.under],
    [rsSettle, P('order')],
    [max + 1, P('order')],
  ].sort((a, b) => a[0] - b[0]);
  menuRange = [meT, meLen];
  anatomyRange = [anT, anLen];
}

function poseAt(y, out) {
  let i = 0;
  while (i < keys.length - 2 && y > keys[i + 1][0]) i++;
  const [y0, a] = keys[i];
  const [y1, b] = keys[i + 1];
  const t = ease(clamp((y - y0) / Math.max(y1 - y0, 1), 0, 1));
  for (const p of PROPS) out[p] = lerp(a[p] ?? 1, b[p] ?? 1, t);
  return out;
}

/* ---------------- anatomy labels ---------------- */
const labelsRoot = $('#labels');
const labelEls = {};
const stackKeys = RECIPES[0].layers;
stackKeys.forEach((k, i) => {
  const [title, note] = LABELS[k];
  const el = document.createElement('div');
  el.className = `label ${i % 2 === 0 ? '' : 'label--left'}`;
  const num = String(stackKeys.length - i).padStart(2, '0');
  el.innerHTML = `<i class="label__dot"></i><i class="label__line"></i><span class="label__txt"><small>${num}</small><b>${title}</b><i>${note}</i></span>`;
  labelsRoot.appendChild(el);
  labelEls[k] = el;
});
const anchors = [];
const anatomyHead = $('.anatomy__head');

/* ---------------- boot ---------------- */
let scene = null;
async function boot() {
  await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]);
  setLoad(0.7, 0.8);
  await new Promise((r) => setTimeout(r, 50));
  try {
    scene = new BurgerScene($('#webgl'), { mobile, reduced });
    scene.pose.s = 0.0001;
    scene.compile();
  } catch (e) {
    console.error('[STAKD] WebGL failed', e);
  }
  setLoad(1, 0.7);
  await new Promise((r) => setTimeout(r, params.has('autostart') ? 0 : 750));
  clearInterval(loaderTimer);
  gsap.killTweensOf(loaderText);
  gsap.set(loaderText, { opacity: 1, yPercent: 0 });
  loaderText.textContent = 'Your table is ready';
  gsap.ticker.add(frame);
  if (params.has('debug')) window.__site = { lenis, scene, audio };
  setTimeout(enter, params.has('autostart') ? 0 : 450);
}

let introDone = false;
function enter() {
  setSound(wantSound && !params.has('autostart'));
  document.body.classList.remove('is-loading');
  const tl = gsap.timeline();
  tl.to('.loader > *', { y: -24, opacity: 0, duration: 0.6, ease: 'power2.in', stagger: 0.05 })
    .to('#loader', { yPercent: -100, duration: 1.1, ease: 'expo.inOut' }, 0.35)
    .set('#loader', { display: 'none' })
    .from('[data-hero-mark]', { opacity: 0, scale: 1.08, duration: 2.2, ease: 'expo.out' }, 0.9)
    .from('[data-hero-line]', { yPercent: 110, duration: 1.3, ease: 'expo.out', stagger: 0.1 }, 1.0)
    .from('[data-hero]', { y: 22, opacity: 0, duration: 1.2, ease: 'expo.out', stagger: 0.08 }, 1.2)
    .from('.header > *', { y: -20, opacity: 0, duration: 1.1, ease: 'expo.out', stagger: 0.06 }, 1.2)
    .add(() => {
      introDone = true;
      if (scene) {
        scene.pose.s = P('hero').s;
        scene.intro();
      }
    }, 0.8)
    .add(() => {
      lenis.start();
      // ?at=0.35 (fraction of the page) — used for stills and the promo renderer
      const at = parseFloat(params.get('at'));
      if (!Number.isNaN(at)) lenis.scrollTo(at * (document.documentElement.scrollHeight - innerHeight), { immediate: true });
    }, 1.3);

  UI.initSplitHeadings();
  UI.initReveals();
  UI.initScrubWords();
  UI.initCounters();
  UI.initMagnetic();
  UI.initHeader(lenis);
  UI.initScrollLinks(lenis);
  UI.initMarquee($('#marquee'), () => lenis.velocity || 0);

  gsap.to('[data-hero-mark]', { yPercent: 28, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
  gsap.to('.hero__copy', { y: -90, opacity: 0, ease: 'none', scrollTrigger: { trigger: '.hero', start: '20% top', end: '85% top', scrub: true } });
  gsap.fromTo('.hero__specs', { opacity: 1 }, { opacity: 0, ease: 'none', immediateRender: false, scrollTrigger: { trigger: '.hero', start: '10% top', end: '55% top', scrub: true } });
  gsap.fromTo('.reserve__word', { yPercent: 30 }, { yPercent: -20, ease: 'none', scrollTrigger: { trigger: '.reserve', start: 'top bottom', end: 'bottom top', scrub: true } });

  // order & reservations (demo)
  let cart = 0;
  let toastTimer;
  const toast = (msg) => {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 2600);
  };
  $('#menuAdd').addEventListener('click', () => {
    cart++;
    $('#cartCount').textContent = cart;
    toast(`${RECIPES[currentRecipe].name} added · ${cart} in your order`);
    audio.chime();
    if (scene) scene.L.bunTop.vy += 2.2;
  });
  $('#orderBtn').addEventListener('click', (e) => {
    e.preventDefault();
    audio.confirm();
    toast(cart ? `Order placed — ${cart} burger${cart > 1 ? 's' : ''} on the flat-top (demo)` : 'Choose a burger first — the menu is just above');
  });
  $('#reserveBtn').addEventListener('click', (e) => {
    e.preventDefault();
    audio.confirm();
    toast('Tonight, 20:30 · table for two — held for 15 minutes (demo)');
  });
  $$('.spot').forEach((s) => s.addEventListener('click', () => toast(`${s.querySelector('.spot__city').textContent} — directions open in Maps (demo)`)));

  ScrollTrigger.addEventListener('refresh', measure);
  ScrollTrigger.refresh();
}

/* ---------------- menu ---------------- */
let currentRecipe = 0;
const names = $$('.menu__name');
const menuBar = $('#menuBar');
function showRecipe(i) {
  if (i === currentRecipe) return;
  const dir = i > currentRecipe ? 1 : -1;
  const prev = names[currentRecipe];
  const next = names[i];
  gsap.to(prev, { yPercent: -100 * dir, opacity: 0, duration: 0.8, ease: 'expo.out', onComplete: () => prev.classList.remove('is-active') });
  next.classList.add('is-active');
  gsap.fromTo(next, { yPercent: 100 * dir, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 1, ease: 'expo.out' });
  const r = RECIPES[i];
  gsap.fromTo(['#menuDesc', '#menuPrice', '#menuKcal'], { y: 10, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, stagger: 0.05, ease: 'expo.out' });
  $('#menuDesc').textContent = r.desc;
  $('#menuPrice').textContent = r.price;
  $('#menuKcal').textContent = r.kcal;
  $('#menuIndex').textContent = String(i + 1).padStart(2, '0');
  menuBar.style.transform = `translateX(${i * 100}%)`;
  currentRecipe = i;
  if (scene) scene.setRecipe(i);
}

/* ---------------- frame ---------------- */
const tmpPose = {};
function frame(time, deltaMs) {
  lenis.raf(time * 1000);
  const dt = Math.min(deltaMs / 1000, 0.1) || 0.016;
  if (!scene) return;
  const y = lenis.scroll || 0;
  const v = lenis.velocity || 0;
  if (introDone && keys.length) {
    poseAt(y, tmpPose);
    Object.assign(scene.pose, tmpPose);
    scene.explode = tmpPose.explode;
    const [mT, mL] = menuRange;
    if (y >= mT - innerHeight * 0.3 && y <= mT + mL) {
      showRecipe(clamp(Math.floor(((y - mT) / Math.max(mL, 1)) * 4), 0, 3));
    } else if (y < mT - innerHeight * 0.3 && currentRecipe !== 0) {
      showRecipe(0);
    }
  }
  scene.update(dt, time, v);

  // anatomy labels
  const [aT, aL] = anatomyRange;
  const inAnatomy = y > aT - innerHeight * 0.5 && y < aT + aL + innerHeight * 0.2 && currentRecipe === 0;
  const labelVis = inAnatomy ? clamp((scene.explode - 0.5) / 0.4, 0, 1) : 0;
  anatomyHead.style.opacity = inAnatomy ? String(1 - clamp((scene.explode - 0.15) / 0.4, 0, 1) * 0.8) : '1';
  if (labelVis > 0.001) {
    scene.labelAnchors(anchors);
    const phone = isPhone();
    anchors.forEach((a) => {
      const el = labelEls[a.key];
      if (!el) return;
      const side = phone ? 1 : a.side;
      el.classList.toggle('label--left', side < 0);
      const w = el.offsetWidth;
      const ax = side > 0 ? a.xR : a.x;
      const ay = side > 0 ? a.yR : a.y;
      const x = side > 0 ? Math.min(ax + 10, innerWidth - w - 8) : Math.max(ax - w - 10, 8);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${(ay - el.offsetHeight / 2).toFixed(1)}px, 0)`;
      el.style.opacity = String(labelVis * clamp(a.vis, 0, 1));
    });
  } else {
    for (const k in labelEls) labelEls[k].style.opacity = '0';
  }
}
gsap.ticker.lagSmoothing(0);

window.addEventListener('pointermove', (e) => {
  scene && scene.setMouse((e.clientX / innerWidth) * 2 - 1, -((e.clientY / innerHeight) * 2 - 1));
}, { passive: true });
let rt;
window.addEventListener('resize', () => {
  clearTimeout(rt);
  rt = setTimeout(() => {
    scene && scene.resize();
    ScrollTrigger.refresh();
  }, 120);
});

UI.initCursor({ onHover: () => audio.tick() });
boot();
