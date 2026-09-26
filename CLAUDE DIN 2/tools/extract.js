/**
 * Dev tool: turns source clips into web assets.
 *   extract.html?jobs=/_media/jobs-steps.json
 *
 * job types
 *   strip  — contact sheet of N frames over the clip (for choosing in/out points)
 *   seq    — scroll-scrub frame sequence (webp) + manifest.json
 *   still  — single webp/jpg frame
 *   loop   — seamless H.264 loop (cross-faded ends), muxed to mp4
 * Everything is POSTed to /__save/<path> on the dev server.
 * Progress: window.__x = { done, i, n, msg, err }
 */
const log = (m) => {
  document.getElementById('log').textContent += m + '\n';
  window.__x.msg = m;
};
window.__x = { done: false, i: 0, n: 0, msg: '', err: null };

const save = async (path, blob) => {
  const r = await fetch('/__save/' + path, { method: 'POST', body: blob });
  if (r.status !== 201) throw new Error(`save ${path} -> ${r.status}`);
};
const toBlob = (cv, type, q) => new Promise((res) => cv.toBlob(res, type, q));

async function openVideo(src) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.crossOrigin = 'anonymous';
  v.src = src;
  await new Promise((res, rej) => {
    v.onloadeddata = res;
    v.onerror = () => rej(new Error('video error ' + src));
  });
  return v;
}
async function seek(v, t) {
  t = Math.max(0, Math.min(t, v.duration - 0.05));
  if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return;
  await new Promise((res) => {
    const done = () => { v.removeEventListener('seeked', done); res(); };
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
  if (v.requestVideoFrameCallback) {
    await Promise.race([new Promise((r) => v.requestVideoFrameCallback(() => r())), new Promise((r) => setTimeout(r, 120))]);
  }
}

/** draw the video into ctx using a normalized crop rect and optional grade */
function drawFrame(ctx, v, W, H, crop, grade) {
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  const c = crop || {};
  // default: cover-fit the target aspect around focus point
  const targetAR = W / H;
  let sw = vw;
  let sh = vw / targetAR;
  if (sh > vh) { sh = vh; sw = vh * targetAR; }
  sw *= c.zoom ? 1 / c.zoom : 1;
  sh *= c.zoom ? 1 / c.zoom : 1;
  const fx = c.x ?? 0.5;
  const fy = c.y ?? 0.5;
  const sx = Math.max(0, Math.min(vw - sw, fx * vw - sw / 2));
  const sy = Math.max(0, Math.min(vh - sh, fy * vh - sh / 2));
  ctx.filter = grade || 'none';
  ctx.drawImage(v, sx, sy, sw, sh, 0, 0, W, H);
  ctx.filter = 'none';
}

async function jobStrip(j) {
  const v = await openVideo(j.src);
  const n = j.n || 8;
  const cw = 480;
  const ch = Math.round(cw * v.videoHeight / v.videoWidth);
  const cols = 4;
  const rows = Math.ceil(n / cols);
  const cv = document.createElement('canvas');
  cv.width = cw * cols;
  cv.height = (ch + 22) * rows;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.font = 'bold 15px sans-serif';
  for (let i = 0; i < n; i++) {
    const t = (v.duration - 0.1) * (i / (n - 1));
    await seek(v, t);
    const x = (i % cols) * cw;
    const y = Math.floor(i / cols) * (ch + 22);
    ctx.drawImage(v, x, y, cw, ch);
    ctx.fillStyle = '#fff';
    ctx.fillText(`${t.toFixed(1)}s`, x + 6, y + ch + 16);
  }
  ctx.fillStyle = '#ff0';
  ctx.fillText(`${j.name}  ${v.videoWidth}x${v.videoHeight}  ${v.duration.toFixed(1)}s`, 6, 18);
  await save(j.out, await toBlob(cv, 'image/jpeg', 0.8));
}

async function jobSeq(j) {
  const v = await openVideo(j.src);
  const W = j.width || 1600;
  const H = Math.round(W / (j.aspect || 16 / 9));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  const n = j.frames;
  const t0 = j.start ?? 0;
  const t1 = Math.min(j.end ?? v.duration, v.duration - 0.05);
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0 : i / (n - 1);
    const t = j.reverse ? t1 - u * (t1 - t0) : t0 + u * (t1 - t0);
    await seek(v, t);
    drawFrame(ctx, v, W, H, j.crop, j.grade);
    await save(`${j.out}/${String(i).padStart(3, '0')}.webp`, await toBlob(cv, 'image/webp', j.q ?? 0.78));
    if (i === 0) await save(`${j.out}/poster.jpg`, await toBlob(cv, 'image/jpeg', 0.82));
    window.__x.msg = `${j.name} ${i + 1}/${n}`;
  }
  await save(`${j.out}/manifest.json`, new Blob([JSON.stringify({ frames: n, width: W, height: H, ext: 'webp', pad: 3 })]));
}

async function jobStill(j) {
  const v = await openVideo(j.src);
  const W = j.width || 1600;
  const H = Math.round(W / (j.aspect || 16 / 9));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  await seek(v, j.t ?? 0);
  drawFrame(ctx, v, W, H, j.crop, j.grade);
  const type = j.out.endsWith('.jpg') ? 'image/jpeg' : 'image/webp';
  await save(j.out, await toBlob(cv, type, j.q ?? 0.84));
}

let Mux = null;
async function jobLoop(j) {
  if (!Mux) Mux = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.mjs');
  const v = await openVideo(j.src);
  const W = j.width || 1280;
  const H = Math.round(W / (j.aspect || 16 / 9)) & ~1;
  const fps = j.fps || 25;
  const fade = j.fade ?? 1.0;
  const t0 = j.start ?? 0;
  const t1 = Math.min(j.end ?? v.duration, v.duration - 0.05);
  const D = t1 - t0 - fade;
  const N = Math.round(D * fps);
  const muxer = new Mux.Muxer({ target: new Mux.ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
  let err = null;
  const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (err = e) });
  enc.configure({ codec: 'avc1.640028', width: W, height: H, bitrate: j.bitrate || 3_000_000, framerate: fps });
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const tmp = document.createElement('canvas');
  tmp.width = W;
  tmp.height = H;
  const tctx = tmp.getContext('2d');
  for (let i = 0; i < N; i++) {
    if (err) throw err;
    const tau = i / fps;
    await seek(v, t0 + fade + tau);
    drawFrame(ctx, v, W, H, j.crop, j.grade);
    const a = (tau - (D - fade)) / fade;
    if (a > 0) {
      await seek(v, t0 + (tau - (D - fade)));
      drawFrame(tctx, v, W, H, j.crop, j.grade);
      ctx.globalAlpha = Math.min(a, 1);
      ctx.drawImage(tmp, 0, 0);
      ctx.globalAlpha = 1;
    }
    const px = ctx.getImageData(0, 0, W, H);
    const vf = new VideoFrame(px.data, { format: 'RGBA', codedWidth: W, codedHeight: H, timestamp: Math.round(tau * 1e6), duration: Math.round(1e6 / fps) });
    enc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
    vf.close();
    if (enc.encodeQueueSize > 6) await enc.flush();
    window.__x.msg = `${j.name} ${i + 1}/${N}`;
  }
  await enc.flush();
  muxer.finalize();
  await save(j.out, new Blob([muxer.target.buffer], { type: 'video/mp4' }));
  // poster = first frame of the loop
  await seek(v, t0 + fade);
  drawFrame(ctx, v, W, H, j.crop, j.grade);
  await save(j.out.replace(/\.mp4$/, '.jpg'), await toBlob(cv, 'image/jpeg', 0.8));
}

const RUN = { strip: jobStrip, seq: jobSeq, still: jobStill, loop: jobLoop };

(async () => {
  try {
    const url = new URLSearchParams(location.search).get('jobs');
    let jobs = await (await fetch(url, { cache: 'no-store' })).json();
    const only = new URLSearchParams(location.search).get('only');
    if (only) jobs = jobs.filter((j) => only.split(',').includes(j.name));
    window.__x.n = jobs.length;
    for (let i = 0; i < jobs.length; i++) {
      const j = jobs[i];
      window.__x.i = i;
      const t = performance.now();
      await RUN[j.type](j);
      log(`ok ${j.type} ${j.name} ${((performance.now() - t) / 1000).toFixed(1)}s`);
    }
    window.__x.done = true;
    log('DONE');
  } catch (e) {
    window.__x.err = String(e && e.stack || e);
    log('ERR ' + window.__x.err);
  }
})();
