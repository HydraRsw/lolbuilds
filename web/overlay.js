'use strict';
/* TFT overlay — comps window: compact comps list with boards per stage and a pinned comp. */

const OV = {
  tab: 'comps', tier: 'ALL', q: '', open: null, stage: {},
  pin: (() => { try { return localStorage.getItem('ov.pin'); } catch { return null; } })(),
};
const ovSave = () => {
  try { localStorage.setItem('ov.pin', OV.pin || ''); } catch { }
  fetch('/api/overlay/state?pin=' + encodeURIComponent(OV.pin || ''), { method: 'POST' }).catch(() => { });
};
const TIER_ORDER = { OP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };

/* ---------- data helpers ---------- */
function pinnedDeck() { return (T.comps || []).find(d => d.id === OV.pin); }
function neededItems(d) {
  if (!d) return [];
  const carries = d.units.filter(u => u.isCore).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const others = d.units.filter(u => !u.isCore && u.items?.length);
  return [...carries, ...others].flatMap(u => u.items.map(it => ({ item: it, unit: u.key })));
}
const avgOf = k => T.stats?.items?.[k]?.avg;

/* ---------- comps tab ---------- */
function compCard(d) {
  const s = d.stat?.deck || {}, pinned = d.id === OV.pin, open = OV.open === d.id;
  const units = [...d.units].sort((a, b) => unitInfo(a.key).cost - unitInfo(b.key).cost);
  let body = '';
  if (open) {
    const stages = [];
    if (d.early?.units?.length) stages.push(['early', `${LANG === 'en' ? 'Early' : 'Inicio'} · ${d.early.level}`, d.early.units]);
    if (d.middle?.units?.length) stages.push(['mid', `${L('Medio')} · ${d.middle.level}`, d.middle.units]);
    stages.push(['final', L('Final'), d.units]);
    const cur = OV.stage[d.id] ?? stages.length - 1;
    const st = stages[Math.min(cur, stages.length - 1)];
    const carries = d.units.filter(u => u.isCore).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
    const comp = {};
    for (const n of neededItems(d)) for (const c of itemInfo(n.item).comp) comp[c] = (comp[c] || 0) + 1;
    body = `<div class="oc-b">
      <h5>${L('Tablero')}</h5>
      <div class="stg">${stages.map((x, i) => `<button data-stage="${i}" class="${i === cur ? 'on' : ''}">${x[1]}</button>`).join('')}</div>
      <div class="mini-board">${board(st[2], { items: st[0] === 'final', deck: d.id })}</div>
      <h5>${L('Objetos de los carries')}</h5>
      ${carries.map(u => `<div class="ci">${tUnitImg(u.key, 'xs', d.id)}<b style="font-size:12px">${esc(unitInfo(u.key).name)}</b><span class="rec">${u.items.map(it => tItemImg(it)).join('')}</span></div>`).join('')}
      ${Object.keys(comp).length ? `<h5>${L('Componentes')}</h5><div class="comp-needed">${Object.entries(comp).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<span>${tItemImg(c, 'ti sm')}<b>×${n}</b></span>`).join('')}</div>` : ''}
      <div class="oc-actions"><button class="btn sm ${pinned ? 'ghost' : ''}" data-pin="${esc(d.id)}">${L(pinned ? 'Quitar fijado' : '📌 Fijar esta compo')}</button>
      ${d.teamCode ? `<button class="btn ghost sm" data-code="${esc(d.teamCode)}">${L('Copiar código')}</button>` : ''}</div>
    </div>`;
  }
  return `<div class="oc ${pinned ? 'pinned' : ''}" data-id="${esc(d.id)}">
    <div class="oc-h"><span class="tier ${TIER_CLS(d.stat?.opTier)}">${esc(d.stat?.opTier || '?')}</span><span class="nm">${pinned ? '📌 ' : ''}${esc(deckName(d))}</span>
      <span class="st"><b>${s.avgPlacement?.toFixed(2) ?? '—'}</b> ${L('prom')} · <b>${pct(s.top4Rate, 0)}</b> top4</span></div>
    ${d.requirements?.length ? `<div class="oc-req">${reqBadges(d)}</div>` : ''}
    <div class="oc-u">${units.map(u => tUnit(u.key, { stars: u.tier, items: u.items, carry: u.isCore, name: false, deck: d.id })).join('')}</div>
    ${body}</div>`;
}

// Tier chips live in the header row (rendered once).
function renderOvTools() {
  const t = $('#ovTools');
  if (!t || t.dataset.ready) return;
  t.dataset.ready = 1;
  // only the tier filters (no search box) to keep the overlay small
  t.innerHTML = `<div class="chips" id="ovTier">${['ALL', 'OP', 'S', 'A', 'B', 'C'].map(x => `<button data-t="${x}" class="${OV.tier === x ? 'on' : ''}">${x === 'ALL' ? L('Todas') : x}</button>`).join('')}</div>`;
  $('#ovTier').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    OV.tier = b.dataset.t; $$('#ovTier button').forEach(x => x.classList.toggle('on', x === b));
    view.scrollTop = 0; renderOvComps();
  };
}

function renderOvComps() {
  renderOvTools();
  const decks = T.comps || [];
  const n = norm(OV.q);
  let list = decks.filter(d => d.id !== OV.pin && (OV.tier === 'ALL' || d.stat?.opTier === OV.tier));
  if (n) list = list.filter(d => norm(deckName(d)).includes(n) || d.units.some(u => norm(unitInfo(u.key).name).includes(n)) || (d.traits || []).some(x => x.style > 0 && norm(traitInfo(x.key, x.meta?.name).name).includes(n)));
  list.sort((a, b) => (TIER_ORDER[a.stat?.opTier] ?? 9) - (TIER_ORDER[b.stat?.opTier] ?? 9) || (a.stat?.deck?.avgPlacement || 9) - (b.stat?.deck?.avgPlacement || 9));
  const pin = pinnedDeck();
  view.innerHTML = `${pin ? compCard(pin) : ''}${list.map(compCard).join('') || `<p class="empty">${L('Sin resultados.')}</p>`}`;
  requestAnimationFrame(ovFit);
}

// Window height: header + exactly 1 comp (the rest scrolls). An opened comp
// gets enough room to show its board, up to a cap, and shrinks back when closed.
const OV_MAX_OPEN = 560;
function ovFit() {
  const top = $('.ov-top').offsetHeight;
  const cards = $$('#ov .oc');
  const opened = cards.find(c => c.querySelector('.oc-b'));
  let listH;
  if (opened) listH = Math.min(opened.offsetHeight + 20, OV_MAX_OPEN);
  else listH = cards.slice(0, 1).reduce((s, c) => s + c.offsetHeight + 8, 0) + 12 || 120;
  const h = top + listH;
  document.documentElement.style.setProperty('--list-h', listH + 'px');
  if (window.ovSize) ovSize(window.innerWidth, h);
  if (opened) opened.scrollIntoView({ block: 'nearest' });
}

function ovOpenComp(id) { OV.open = OV.open === id ? null : id; renderOv(); }

/* ---------- shell ---------- */
function renderOv() { renderOvComps(); }
window.ovGo = h => { if (h.startsWith('#/tft/comp/')) ovOpenComp(h.split('/').pop()); };
view.addEventListener('click', async e => {
  const st = e.target.closest('[data-stage]');
  if (st) { const id = st.closest('.oc').dataset.id; OV.stage[id] = +st.dataset.stage; renderOv(); return; }
  const pin = e.target.closest('[data-pin]');
  if (pin) { OV.pin = OV.pin === pin.dataset.pin ? null : pin.dataset.pin; OV.open = null; ovSave(); view.scrollTop = 0; renderOv(); toast(OV.pin ? 'Compo fijada arriba' : 'Compo quitada'); return; }
  const code = e.target.closest('[data-code]');
  if (code) { try { await navigator.clipboard.writeText(code.dataset.code); toast('Código copiado ✔'); } catch { } return; }
  const card = e.target.closest('.oc');
  if (card && !e.target.closest('.oc-b')) ovOpenComp(card.dataset.id);
});

document.body.classList.add('ovl');
(async function bootOverlay() {
  try {
    await Promise.all([tftLoadStatic().catch(() => { }), tftLoadComps()]);
  } catch (e) { view.innerHTML = errorBox(e); return; }
  renderOv();
  ovSave(); // share the pinned comp with the recipe bar
  tftLoadStats().catch(() => { }); // BIS items and averages for the champion tooltips
  // pick up new comps (OP.GG refresh) every 30 min without reopening the overlay
  setInterval(async () => { tftCompsP = null; try { await tftLoadComps(); if (OV.tab === 'comps' && !document.activeElement?.matches('input')) renderOv(); } catch { } }, 30 * 60 * 1000);
})();
