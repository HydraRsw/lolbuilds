'use strict';
/* TFT overlay — recipe bar: one component per cell (horizontal); click one to see
   every item it builds with each other component. */

const RB = { sel: null, item: null };
const wrap = document.getElementById('wrap');
window.onClickThrough = on => document.body.classList.toggle('ct', on);

let pinId = null;
function pinnedComp() { return (T.comps || []).find(d => d.id === pinId); }
function compsUsing(item) {
  return (T.comps || []).filter(d => d.units.some(u => (u.items || []).includes(item)))
    .sort((a, b) => (a.stat?.deck?.avgPlacement || 9) - (b.stat?.deck?.avgPlacement || 9));
}

function infoHTML(key) {
  const it = T.item[key];
  if (!it) return '';
  const st = T.stats?.items?.[key];
  const users = (T.uip?.itemNames?.[key]?.units || []).slice(0, 4).map(x => x.unit);
  const cs = compsUsing(key).slice(0, 2);
  return `<b>${esc(it.name)}</b>
    ${st ? `<span class="k">prom. <b>${st.avg.toFixed(2)}</b> · top 4 ${pct(st.top4, 0)}</span>` : ''}
    ${users.length ? `<span class="k">mejor en</span><span class="us">${users.map(u => tUnitImg(u, 'xs')).join('')}</span>` : ''}
    ${cs.length ? `<span class="cmp">· compos: ${cs.map(d => `<em>${esc(deckName(d))}</em>`).join(', ')}</span>` : ''}`;
}

function render() {
  const comps = components();
  if (!comps.length) { wrap.innerHTML = '<div style="padding:12px 16px" class="muted">Sin datos de objetos.</div>'; return fit(); }
  const pin = pinnedComp();
  const need = new Set(pin ? pin.units.flatMap(u => u.items || []) : []);
  let html = `<div class="rbar"><div class="grip" onmousedown="ovDragStart(event)" title="Arrastra para mover">⠿</div>
    ${comps.map(c => `<div class="cell ${RB.sel === c.apiName ? 'on' : ''}" data-c="${esc(c.apiName)}" title="${esc(c.name)}"><img src="${c.icon}" alt="${esc(c.name)}"></div>`).join('')}</div>`;
  if (RB.sel) {
    const rows = comps.map(k => ({ k, it: recipeFor(RB.sel, k.apiName) })).filter(x => x.it);
    html += `<div class="row"><div class="lead">+</div>
      ${comps.map(k => {
        const it = recipeFor(RB.sel, k.apiName);
        if (!it) return `<div class="res"></div>`;
        return `<div class="res ${RB.item === it.apiName ? 'on' : ''} ${need.has(it.apiName) ? 'need' : ''}" data-i="${esc(it.apiName)}" title="${esc(it.name)}">
          <img src="${it.icon}" alt="${esc(it.name)}"><img class="with" src="${k.icon}" alt=""></div>`;
      }).join('')}</div>`;
    const show = RB.item || rows.find(x => need.has(x.it.apiName))?.it.apiName || rows.map(x => x.it.apiName).sort((a, b) => (T.stats?.items?.[a]?.avg ?? 9) - (T.stats?.items?.[b]?.avg ?? 9))[0];
    html += `<div class="info" id="info">${show ? infoHTML(show) : ''}</div>`;
  }
  wrap.innerHTML = html;
  fit();
}

// Size the native window to the content.
function fit() {
  const r = wrap.getBoundingClientRect();
  document.documentElement.style.setProperty('--w', Math.max(200, r.width - 20) + 'px');
  if (window.ovSize) ovSize(Math.ceil(r.width), Math.ceil(r.height));
}

wrap.addEventListener('click', e => {
  const c = e.target.closest('[data-c]');
  if (c) { RB.sel = RB.sel === c.dataset.c ? null : c.dataset.c; RB.item = null; render(); return; }
  const i = e.target.closest('[data-i]');
  if (i) { RB.item = i.dataset.i; render(); }
});
wrap.addEventListener('mouseover', e => {
  const i = e.target.closest('[data-i]');
  const info = document.getElementById('info');
  if (i && info) info.innerHTML = infoHTML(i.dataset.i);
});
wrap.addEventListener('mouseleave', () => { const info = document.getElementById('info'); if (info && RB.sel) render(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && RB.sel) { RB.sel = null; render(); } });
// the pinned comp is chosen in the comps window: refresh highlights when it changes
setInterval(async () => {
  try {
    const s = await (await fetch('/api/overlay/state')).json();
    if ((s.pin || null) !== pinId) { pinId = s.pin || null; if (RB.sel) render(); }
  } catch { }
}, 1500);

(async function boot() {
  try { await tftLoadStatic(); } catch (e) { wrap.innerHTML = `<div style="padding:12px 16px" class="error-box">${esc(e.message)}</div>`; return fit(); }
  render();
  tftLoadComps().then(() => RB.sel && render()).catch(() => { });
  tftLoadStats().then(() => RB.sel && render()).catch(() => { });
})();
