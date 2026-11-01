'use strict';
/* Minimal shim of the helpers tft.js expects from app.js */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = (x, d = 1) => (x == null || isNaN(x)) ? '—' : (x * 100).toFixed(d) + '%';
const fmt = n => n == null ? '—' : Number(n).toLocaleString('es');
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const S = { freshUntil: 0 };
const memo = new Map();
function api(url) {
  if (memo.has(url)) return memo.get(url);
  const p = fetch('/p?u=' + encodeURIComponent(url)).then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; });
  memo.set(url, p); p.catch(() => memo.delete(url)); return p;
}
function ph(alt) {
  const t = (alt || '?').slice(0, 2).toUpperCase();
  return 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#1e222c"/><text x="32" y="40" font-family="Segoe UI,sans-serif" font-size="22" font-weight="700" fill="#636a7b" text-anchor="middle">${t}</text></svg>`);
}
document.addEventListener('error', e => {
  const el = e.target;
  if (el.tagName !== 'IMG' || el.dataset.failed) return;
  if (el.dataset.fb) { const fb = el.dataset.fb; delete el.dataset.fb; el.src = fb; return; }
  el.dataset.failed = 1; el.src = ph(el.alt);
}, true);
const view = document.getElementById('ov');
const ovDragStart = e => { if (e.button === 0 && !e.target.closest('button,input,a') && window.ovDrag) ovDrag(); };
let routeToken = 0;
const stale = () => false;
const loadingHTML = (m = 'Cargando…') => `<div class="inline-load"><div class="spinner"></div>${esc(m)}</div>`;
const errorBox = e => `<div class="error-box">${esc(e?.message || e)}</div>`;
const go = h => { if (window.ovGo) ovGo(h); };
let toastT;
function toast(msg, err) { const t = $('#toast'); if (!t) return; t.textContent = msg; t.className = 'toast show' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast', 2500); }
const tip = $('#tooltip');
if (tip) document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.classList.remove('show'); return; }
  const [kind, id] = [t.dataset.tip.slice(0, t.dataset.tip.indexOf(':')), t.dataset.tip.slice(t.dataset.tip.indexOf(':') + 1)];
  const h = kind.startsWith('tft-') ? tftTip(kind.slice(4), decodeURIComponent(id)) : kind === 'text' ? esc(decodeURIComponent(id)) : '';
  if (!h) return; tip.innerHTML = h; tip.classList.add('show');
});
if (tip) document.addEventListener('mousemove', e => {
  if (!tip.classList.contains('show')) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + w > innerWidth - 6) x = Math.max(6, e.clientX - w - 10);
  if (y + h > innerHeight - 6) y = Math.max(6, e.clientY - h - 10);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});
// In the overlay, links should not navigate away.
document.addEventListener('click', e => { const a = e.target.closest('a[href^="#/"]'); if (a) e.preventDefault(); }, true);
window.onClickThrough = on => document.body.classList.toggle('clickthru', on);

/* item helpers shared by both overlay windows (T comes from tft.js) */
function components() {
  const all = T.st?.items || [];
  const used = new Set(all.flatMap(i => i.composition || []));
  return all.filter(i => used.has(i.apiName) && !(i.composition?.length) && !/tutorial/i.test(i.apiName));
}
function combos() { return (T.st?.items || []).filter(i => i.composition?.length === 2); }
function recipeFor(a, b) { return combos().find(i => (i.composition[0] === a && i.composition[1] === b) || (i.composition[0] === b && i.composition[1] === a)); }
