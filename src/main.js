import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import { zipSync } from 'fflate';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';

const $ = (id) => document.getElementById(id);
let mode = 'shrink', items = [], ff = null;
const fmt = (b) => b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const base = (n) => n.replace(/\.[^.]+$/, '');

function setMode(m) {
  mode = m; $('tShrink').classList.toggle('on', m === 'shrink'); $('tBack').classList.toggle('on', m === 'back');
  $('shrinkOpts').classList.toggle('hidden', m !== 'shrink'); $('backOpts').classList.toggle('hidden', m !== 'back');
  $('backNote').classList.toggle('hidden', m !== 'back'); $('go').textContent = m === 'shrink' ? 'Squish it' : 'Convert back';
}
$('tShrink').onclick = () => setMode('shrink'); $('tBack').onclick = () => setMode('back');
$('q').oninput = () => ($('qv').textContent = $('q').value);

$('files').onchange = (e) => {
  items = [...e.target.files].map((f) => ({ f })); render(); $('go').disabled = !items.length; $('zip').classList.add('hidden');
};

function render() {
  $('list').innerHTML = '';
  items.forEach((it, i) => {
    const li = document.createElement('li'); it.li = li;
    li.innerHTML = `<div class="name">${it.f.name.replace(/</g, '&lt;')}</div><div class="bar"><i></i></div><div class="row"><span class="st">${fmt(it.f.size)} · waiting</span><span class="a"></span></div>`;
    $('list').appendChild(li);
  });
}
const prog = (it, p, t) => { it.li.querySelector('i').style.width = Math.round(p * 100) + '%'; if (t) it.li.querySelector('.st').textContent = t; };

let avifOK;
async function canAvif() {
  if (avifOK !== undefined) return avifOK;
  const c = document.createElement('canvas'); c.width = c.height = 2;
  avifOK = await new Promise((r) => c.toBlob((b) => r(!!b && b.type === 'image/avif'), 'image/avif', 0.5));
  return avifOK;
}
const isVideo = (f) => f.type.startsWith('video/') || /\.(mp4|mov|webm|mkv|m4v|3gp|avi)$/i.test(f.name);

async function doImage(it) {
  let bmp;
  try { bmp = await createImageBitmap(it.f, { imageOrientation: 'from-image' }); }
  catch { throw new Error(/hei[cf]$/i.test(it.f.name) ? 'HEIC not supported by this browser' : 'Cannot read this image'); }
  let w = bmp.width, h = bmp.height;
  const max = mode === 'shrink' ? +$('maxd').value : 0;
  if (max && Math.max(w, h) > max) { const s = max / Math.max(w, h); w = Math.round(w * s); h = Math.round(h * s); }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  let type, ext, q;
  if (mode === 'shrink') { const a = await canAvif(); type = a ? 'image/avif' : 'image/webp'; ext = a ? 'avif' : 'webp'; q = $('q').value / 100; }
  else { type = 'image/' + $('bfmt').value; ext = $('bfmt').value === 'png' ? 'png' : 'jpg'; q = 0.92; }
  if (type === 'image/jpeg') { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); }
  ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.();
  prog(it, 0.6, 'encoding…');
  const blob = await new Promise((r) => c.toBlob(r, type, q));
  if (!blob) throw new Error('Encode failed');
  return { blob, name: base(it.f.name) + '.' + ext };
}

async function getFF() {
  if (ff) return ff;
  ff = new FFmpeg(); await ff.load({ coreURL, wasmURL }); return ff;
}
async function doVideo(it) {
  prog(it, 0.02, 'loading video engine…');
  const f = await getFF();
  const inName = 'in_' + Date.now() + (it.f.name.match(/\.[^.]+$/)?.[0] || '.mp4');
  await f.writeFile(inName, await fetchFile(it.f));
  const onP = ({ progress }) => prog(it, Math.max(0, Math.min(1, progress)), 'encoding ' + Math.round(Math.max(0, Math.min(1, progress)) * 100) + '%');
  f.on('progress', onP);
  let codec = mode === 'shrink' ? $('vcodec').value : 'h264';
  const crf = mode === 'shrink' ? $('crf').value : '20';
  const res = mode === 'shrink' ? +$('vres').value : 0;
  const vf = res ? ['-vf', `scale='if(gt(iw,ih),-2,min(${res},iw))':'if(gt(iw,ih),min(${res},ih),-2)'`] : [];
  let args, out;
  if (codec === 'vp9') { out = 'out.webm'; args = ['-c:v', 'libvpx-vp9', '-crf', String(+crf + 8), '-b:v', '0', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-b:a', '96k']; }
  else { out = 'out.mp4'; args = [...(codec === 'h265' ? ['-c:v', 'libx265', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'] : ['-c:v', 'libx264']), '-crf', crf, '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart']; }
  const code = await f.exec(['-i', inName, ...vf, ...args, out]);
  f.off('progress', onP);
  if (code !== 0) { await f.deleteFile(inName).catch(() => {}); throw new Error('Video encode failed'); }
  const data = await f.readFile(out);
  await f.deleteFile(inName).catch(() => {}); await f.deleteFile(out).catch(() => {});
  return { blob: new Blob([data.buffer], { type: out.endsWith('webm') ? 'video/webm' : 'video/mp4' }), name: base(it.f.name) + (out.endsWith('webm') ? '.webm' : '.mp4') };
}

$('go').onclick = async () => {
  $('go').disabled = true; $('files').disabled = true;
  for (const it of items) {
    try {
      prog(it, 0.1, 'working…');
      const r = isVideo(it.f) ? await doVideo(it) : await doImage(it);
      if (mode === 'shrink' && r.blob.size >= it.f.size) {
        it.out = { blob: it.f, name: it.f.name };
        prog(it, 1, `${fmt(it.f.size)} · <span class="flag">already small — kept original</span>`);
        it.li.querySelector('.st').innerHTML = `${fmt(it.f.size)} · <span class="flag">already small — kept original</span>`;
      } else {
        it.out = r;
        const pct = Math.round((1 - r.blob.size / it.f.size) * 100);
        prog(it, 1, `${fmt(it.f.size)} → ${fmt(r.blob.size)} (${pct >= 0 ? pct + '% saved' : Math.abs(pct) + '% bigger'})`);
      }
      const a = document.createElement('a'); a.className = 'dl'; a.textContent = '⬇ Save';
      a.href = URL.createObjectURL(it.out.blob); a.download = it.out.name; it.li.querySelector('.a').appendChild(a);
      it.li.dataset.done = '1';
    } catch (e) { it.li.querySelector('.st').innerHTML = `<span class="err">${e.message}</span>`; it.li.dataset.done = 'err'; }
  }
  $('go').disabled = false; $('files').disabled = false;
  if (items.some((i) => i.out)) $('zip').classList.remove('hidden');
  document.body.dataset.finished = '1';
};

$('zip').onclick = async () => {
  const files = {}, used = new Set();
  for (const it of items.filter((i) => i.out)) {
    let n = it.out.name, k = 1; while (used.has(n)) n = base(it.out.name) + `_${k++}` + (it.out.name.match(/\.[^.]+$/)?.[0] || '');
    used.add(n); files[n] = [new Uint8Array(await it.out.blob.arrayBuffer()), { level: 0 }];
  }
  const z = zipSync(files);
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([z], { type: 'application/zip' }));
  a.download = 'squish.zip'; a.click();
};
setMode('shrink');
