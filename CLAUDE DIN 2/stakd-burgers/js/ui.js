import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger.js';
import { SplitText } from 'gsap/SplitText.js';

gsap.registerPlugin(ScrollTrigger, SplitText);

const fine = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/* ---------------- custom cursor ---------------- */
export function initCursor({ onHover } = {}) {
  const root = document.querySelector('.cursor');
  if (!root || !fine()) return;
  const ring = root.querySelector('.cursor__ring') || root.querySelector('.cursor__blob');
  const dot = root.querySelector('.cursor__dot') || document.createElement('i');
  const label = root.querySelector('.cursor__label');
  const pos = { x: innerWidth / 2, y: innerHeight / 2 };
  const ringPos = { x: pos.x, y: pos.y };
  const setDot = { x: gsap.quickSetter(dot, 'x', 'px'), y: gsap.quickSetter(dot, 'y', 'px') };
  const setRing = { x: gsap.quickSetter(ring, 'x', 'px'), y: gsap.quickSetter(ring, 'y', 'px') };

  window.addEventListener('pointermove', (e) => {
    pos.x = e.clientX;
    pos.y = e.clientY;
    root.classList.remove('is-hidden');
  }, { passive: true });
  document.addEventListener('pointerleave', () => root.classList.add('is-hidden'));

  gsap.ticker.add((_, dtMs) => {
    const k = 1 - Math.pow(0.001, Math.min(dtMs, 50) / 1000 * 2.2);
    ringPos.x += (pos.x - ringPos.x) * k;
    ringPos.y += (pos.y - ringPos.y) * k;
    setDot.x(pos.x);
    setDot.y(pos.y);
    setRing.x(ringPos.x);
    setRing.y(ringPos.y);
  });

  let current = null;
  document.addEventListener('pointerover', (e) => {
    const t = e.target.closest('a, button, input, [data-cursor]');
    if (t === current) return;
    current = t;
    root.classList.remove('is-hover', 'is-label');
    if (!t) return;
    const text = t.getAttribute('data-cursor');
    if (text) {
      label.textContent = text;
      root.classList.add('is-label');
    } else {
      root.classList.add('is-hover');
    }
    onHover && onHover();
  });
}

/* ---------------- magnetic buttons ---------------- */
export function initMagnetic() {
  if (!fine()) return;
  document.querySelectorAll('[data-magnetic]').forEach((el) => {
    const xTo = gsap.quickTo(el, 'x', { duration: 0.7, ease: 'power3' });
    const yTo = gsap.quickTo(el, 'y', { duration: 0.7, ease: 'power3' });
    const inner = el.querySelector('span');
    const ixTo = inner ? gsap.quickTo(inner, 'x', { duration: 0.7, ease: 'power3' }) : null;
    const iyTo = inner ? gsap.quickTo(inner, 'y', { duration: 0.7, ease: 'power3' }) : null;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      xTo(dx * 0.28);
      yTo(dy * 0.38);
      ixTo && ixTo(dx * 0.12);
      iyTo && iyTo(dy * 0.16);
    });
    el.addEventListener('pointerleave', () => {
      xTo(0);
      yTo(0);
      ixTo && ixTo(0);
      iyTo && iyTo(0);
    });
  });
}

/* ---------------- reveals ---------------- */
export function initReveals() {
  const items = gsap.utils.toArray('[data-reveal]').filter((el) => !el.closest('.hero'));
  ScrollTrigger.batch(items, {
    start: 'top 90%',
    once: true,
    onEnter: (batch) => gsap.to(batch, { opacity: 1, y: 0, duration: 1.2, ease: 'expo.out', stagger: 0.09, overwrite: true }),
  });
}

export function initSplitHeadings() {
  document.querySelectorAll('[data-split]').forEach((el) => {
    SplitText.create(el, {
      type: 'lines',
      mask: 'lines',
      autoSplit: true,
      onSplit(self) {
        return gsap.from(self.lines, {
          yPercent: 115,
          rotate: 2.5,
          transformOrigin: '0% 100%',
          duration: 1.3,
          ease: 'expo.out',
          stagger: 0.1,
          scrollTrigger: { trigger: el, start: 'top 86%', once: true },
        });
      },
    });
  });
}

export function initScrubWords() {
  document.querySelectorAll('[data-scrub-words]').forEach((el) => {
    const split = SplitText.create(el, { type: 'words', wordsClass: 'w' });
    gsap.to(split.words, {
      opacity: 1,
      ease: 'none',
      stagger: 0.1,
      scrollTrigger: { trigger: el, start: 'top 78%', end: 'bottom 42%', scrub: 0.6 },
    });
  });
}

export function initCounters() {
  document.querySelectorAll('[data-count]').forEach((el) => {
    const target = parseFloat(el.getAttribute('data-count'));
    const obj = { v: 0 };
    ScrollTrigger.create({
      trigger: el,
      start: 'top 90%',
      once: true,
      onEnter: () => gsap.to(obj, {
        v: target,
        duration: 2,
        ease: 'expo.out',
        onUpdate: () => { el.textContent = Math.round(obj.v); },
      }),
    });
  });
}

/* ---------------- velocity marquee ---------------- */
export function initMarquee(track, getVelocity) {
  if (!track) return;
  let x = 0;
  let dir = -1;
  const skewTo = gsap.quickTo(track, 'skewX', { duration: 0.6, ease: 'power3' });
  const setX = gsap.quickSetter(track, 'x', 'px');
  gsap.ticker.add((_, dtMs) => {
    const v = getVelocity();
    if (Math.abs(v) > 0.3) dir = v > 0 ? -1 : 1;
    const speed = 60 + Math.min(Math.abs(v) * 28, 1400);
    x += dir * speed * (Math.min(dtMs, 50) / 1000);
    const half = track.scrollWidth / 2;
    if (half > 0) {
      if (x < -half) x += half;
      if (x > 0) x -= half;
    }
    setX(x);
    skewTo(Math.max(-12, Math.min(12, -v * 0.35)));
  });
}

/* ---------------- menu tabs ---------------- */
export function initTabs({ onChange } = {}) {
  const tabs = gsap.utils.toArray('.menu__tabs [data-tab]');
  const panels = gsap.utils.toArray('.menu__list[data-panel]');
  const activate = (tab) => {
    const id = tab.dataset.tab;
    tabs.forEach((t) => {
      const on = t === tab;
      t.classList.toggle('is-active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
    });
    panels.forEach((p) => {
      const on = p.dataset.panel === id;
      p.classList.toggle('is-active', on);
      if (on) gsap.fromTo(p.children, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'expo.out', stagger: 0.05 });
    });
    onChange && onChange(id);
  };
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => activate(t));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const n = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
      n.focus();
      activate(n);
    });
  });
}

/* ---------------- 3D tilt cards ---------------- */
export function initTilt() {
  if (!fine()) return;
  document.querySelectorAll('[data-tilt]').forEach((el) => {
    const rx = gsap.quickTo(el, 'rotationX', { duration: 0.8, ease: 'power3' });
    const ry = gsap.quickTo(el, 'rotationY', { duration: 0.8, ease: 'power3' });
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width - 0.5;
      const py = (e.clientY - r.top) / r.height - 0.5;
      ry(px * 9);
      rx(-py * 9);
    });
    el.addEventListener('pointerleave', () => {
      rx(0);
      ry(0);
    });
  });
}

/* ---------------- header + nav ---------------- */
export function initHeader(lenis) {
  const header = document.getElementById('header');
  let last = 0;
  lenis.on('scroll', ({ scroll }) => {
    header.classList.toggle('is-solid', scroll > 40);
    if (scroll > 260 && scroll > last + 4) header.classList.add('is-hidden');
    else if (scroll < last - 4 || scroll < 260) header.classList.remove('is-hidden');
    last = scroll;
  });
  const links = gsap.utils.toArray('.nav a');
  links.forEach((a) => {
    const sec = document.querySelector(a.getAttribute('href'));
    if (!sec) return;
    ScrollTrigger.create({
      trigger: sec,
      start: 'top 55%',
      end: 'bottom 55%',
      onToggle: (self) => a.classList.toggle('is-active', self.isActive),
    });
  });
}

export function initScrollLinks(lenis, closeMenu) {
  document.querySelectorAll('[data-scroll-to]').forEach((a) => {
    a.addEventListener('click', (e) => {
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('#')) return;
      const target = document.querySelector(href);
      if (!target) return;
      e.preventDefault();
      closeMenu && closeMenu();
      lenis.scrollTo(target, { duration: 2.2, easing: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) });
    });
  });
}

export function initMobileMenu(lenis) {
  const burger = document.getElementById('burger');
  const menu = document.getElementById('mobileMenu');
  if (!burger || !menu) return () => {};
  const set = (open) => {
    burger.setAttribute('aria-expanded', String(open));
    menu.classList.toggle('is-open', open);
    menu.setAttribute('aria-hidden', String(!open));
    if (open) {
      lenis.stop();
      gsap.fromTo(menu.querySelectorAll('a'), { yPercent: 60, opacity: 0 }, { yPercent: 0, opacity: 1, stagger: 0.06, duration: 0.9, delay: 0.2, ease: 'expo.out' });
    } else {
      lenis.start();
    }
  };
  burger.addEventListener('click', () => set(burger.getAttribute('aria-expanded') !== 'true'));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && set(false));
  return () => set(false);
}

export function initNewsletter() {
  const form = document.getElementById('newsletter');
  if (!form) return;
  const input = form.querySelector('input');
  const msg = document.getElementById('nlMsg');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const ok = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.value.trim());
    msg.textContent = ok ? 'Mulțumim! Prima cafea a lunii ajunge curând în inbox.' : 'Hmm, adresa nu pare corectă. Mai încearcă o dată.';
    msg.style.color = ok ? '' : '#e39a7a';
    if (ok) {
      input.value = '';
      gsap.fromTo(msg, { y: 8, opacity: 0 }, { y: 0, opacity: 1, duration: 0.6, ease: 'expo.out' });
    }
  });
}
