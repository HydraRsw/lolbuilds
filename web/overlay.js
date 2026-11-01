'use strict';
/* TFT overlay: compact comps list, pinned comp, components → craftable items, recipe sheet. */

const OV = {
  tab: 'comps', tier: 'ALL', q: '', open: null, stage: {},
  pin: (() => { try { return localStorage.getItem('ov.pin'); } catch { return null; } })(),
  have: (() => { try { return JSON.parse(localStorage.getItem('ov.have') || '{}'); } catch { return {}; } })(),
};
const ovSave = () => { try { localStorage.setItem('ov.pin', OV.pin || ''); localStorage.setItem('ov.have', JSON.stringify(OV.have)); } catch { } };
const TIER_ORDER = { OP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };

/* ---------- data helpers ---------- */
function components() {
  const all = T.st?.items || [];
  const used = new Set(all.flatMap(i => i.composition || []));
  return all.filter(i => used.has(i.apiName) && !(i.composition?.length) && !/tutorial/i.test(i.apiName));
}
function combos() { return (T.st?.items || []).filter(i => i.composition?.length === 2); }
function recipeFor(a, b) { return combos().find(i => (i.composition[0] === a && i.composition[1] === b) || (i.composition[0] === b && i.composition[1] === a)); }
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
  const s = d.stat?.deck || {}, pinned = d.id === OV.pin, open = OV.open === d.id || pinned;
  const units = [...d.units].sort((a, b) => unitInfo(a.key).cost - unitInfo(b.key).cost);
  let body = '';
  if (open) {
    const stages = [];
    if (d.early?.units?.length) stages.push(['early', `Inicio · ${d.early.level}`, d.early.units]);
    if (d.middle?.units?.length) stages.push(['mid', `Medio · ${d.middle.level}`, d.middle.units]);
    stages.push(['final', 'Final', d.units]);
    const cur = OV.stage[d.id] ?? stages.length - 1;
    const st = stages[Math.min(cur, stages.length - 1)];
    const carries = d.units.filter(u => u.isCore).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
    const comp = {};
    for (const n of neededItems(d)) for (const c of itemInfo(n.item).comp) comp[c] = (comp[c] || 0) + 1;
    body = `<div class="oc-b">
      <h5>Tablero</h5>
      <div class="stg">${stages.map((x, i) => `<button data-stage="${i}" class="${i === cur ? 'on' : ''}">${x[1]}</button>`).join('')}</div>
      <div class="mini-board">${board(st[2], { items: st[0] === 'final' })}</div>
      <h5>Objetos de los carries</h5>
      ${carries.map(u => `<div class="ci">${tUnitImg(u.key, 'xs')}<b style="font-size:12px">${esc(unitInfo(u.key).name)}</b><span class="rec">${u.items.map(it => tItemImg(it)).join('')}</span></div>`).join('')}
      ${Object.keys(comp).length ? `<h5>Componentes</h5><div class="comp-needed">${Object.entries(comp).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<span>${tItemImg(c, 'ti sm')}<b>×${n}</b></span>`).join('')}</div>` : ''}
      <div class="oc-actions"><button class="btn sm ${pinned ? 'ghost' : ''}" data-pin="${esc(d.id)}">${pinned ? 'Quitar fijado' : '📌 Fijar esta compo'}</button>
      ${d.teamCode ? `<button class="btn ghost sm" data-code="${esc(d.teamCode)}">Copiar código</button>` : ''}</div>
    </div>`;
  }
  return `<div class="oc ${pinned ? 'pinned' : ''}" data-id="${esc(d.id)}">
    <div class="oc-h"><span class="tier ${TIER_CLS(d.stat?.opTier)}">${esc(d.stat?.opTier || '?')}</span><span class="nm">${pinned ? '📌 ' : ''}${esc(deckName(d))}</span>
      <span class="st"><b>${s.avgPlacement?.toFixed(2) ?? '—'}</b> prom · <b>${pct(s.top4Rate, 0)}</b> top4</span></div>
    <div class="oc-u">${units.map(u => tUnit(u.key, { stars: u.tier, items: u.items, carry: u.isCore, name: false })).join('')}</div>
    ${body}</div>`;
}

function renderOvComps() {
  const decks = T.comps || [];
  const n = norm(OV.q);
  let list = decks.filter(d => d.id !== OV.pin && (OV.tier === 'ALL' || d.stat?.opTier === OV.tier));
  if (n) list = list.filter(d => norm(deckName(d)).includes(n) || d.units.some(u => norm(unitInfo(u.key).name).includes(n)) || (d.traits || []).some(x => x.style > 0 && norm(traitInfo(x.key, x.meta?.name).name).includes(n)));
  list.sort((a, b) => (TIER_ORDER[a.stat?.opTier] ?? 9) - (TIER_ORDER[b.stat?.opTier] ?? 9) || (a.stat?.deck?.avgPlacement || 9) - (b.stat?.deck?.avgPlacement || 9));
  const pin = pinnedDeck();
  view.innerHTML = `
    ${pin ? compCard(pin) : ''}
    <div class="ov-tools"><input id="ovq" placeholder="Buscar campeón o sinergia…" value="${esc(OV.q)}"></div>
    <div class="chips" id="ovTier">${['ALL', 'OP', 'S', 'A', 'B', 'C'].map(t => `<button data-t="${t}" class="${OV.tier === t ? 'on' : ''}">${t === 'ALL' ? 'Todas' : t}</button>`).join('')}</div>
    ${list.map(compCard).join('') || '<p class="empty">Sin resultados.</p>'}`;
  const q = $('#ovq');
  q.oninput = e => { OV.q = e.target.value; const pos = q.selectionStart; renderOvComps(); const nq = $('#ovq'); nq.focus(); nq.setSelectionRange(pos, pos); };
}

function ovOpenComp(id) { OV.open = OV.open === id ? null : id; renderOv(); }

/* ---------- items tab ---------- */
function renderOvItems() {
  const comps = components();
  const have = OV.have;
  const pin = pinnedDeck();
  const need = neededItems(pin);
  const needSet = new Set(need.map(x => x.item));
  // every distinct item buildable from two held components
  const keys = Object.keys(have).filter(k => have[k] > 0);
  const craft = new Map();
  for (let i = 0; i < keys.length; i++) for (let j = i; j < keys.length; j++) {
    if (i === j && have[keys[i]] < 2) continue;
    const it = recipeFor(keys[i], keys[j]);
    if (it && !craft.has(it.apiName)) craft.set(it.apiName, it);
  }
  const list = [...craft.values()].sort((a, b) => (needSet.has(b.apiName) - needSet.has(a.apiName)) || ((avgOf(a.apiName) ?? 9) - (avgOf(b.apiName) ?? 9)));
  const users = k => (T.uip?.itemNames?.[k]?.units || []).slice(0, 4).map(x => x.unit);
  // items of the pinned comp missing exactly one component
  const almost = [];
  for (const n of need) {
    if (craft.has(n.item)) continue;
    const comp = itemInfo(n.item).comp;
    if (comp.length !== 2) continue;
    const h = { ...have }; const missing = [];
    for (const c of comp) { if (h[c] > 0) h[c]--; else missing.push(c); }
    if (missing.length === 1 && !almost.some(a => a.item === n.item)) almost.push({ ...n, missing: missing[0] });
  }
  view.innerHTML = `
    <div class="sec">Mis componentes <a id="ovClear">Limpiar</a></div>
    <div class="comp-pick">${comps.map(c => `<div class="cp ${have[c.apiName] ? 'has' : ''}" data-c="${esc(c.apiName)}" title="Clic: +1 · Clic derecho: −1">${have[c.apiName] ? `<b>${have[c.apiName]}</b>` : ''}<img src="${c.icon}" alt=""><span>${esc(c.name)}</span></div>`).join('')}</div>
    <p class="fine" style="margin:0 0 4px">Clic para sumar, clic derecho para restar.${pin ? ` Resaltados: objetos de tu compo fijada (${esc(deckName(pin))}).` : ' Fija una compo para resaltar sus objetos.'}</p>
    <div class="sec">Puedes armar (${list.length})</div>
    ${list.map(i => `<div class="craft ${needSet.has(i.apiName) ? 'need' : ''}">${tItemImg(i.apiName)}<div class="grow"><b>${esc(i.name)}${needSet.has(i.apiName) ? '<span class="tag">TU COMPO</span>' : ''}</b>
      <small>${i.composition.map(c => esc(itemInfo(c).name)).join(' + ')}${avgOf(i.apiName) ? ` · prom. ${avgOf(i.apiName).toFixed(2)}` : ''}</small></div>
      <div class="users">${users(i.apiName).map(u => tUnitImg(u, 'xs')).join('')}</div></div>`).join('') || '<p class="empty">Marca al menos dos componentes.</p>'}
    ${almost.length ? `<div class="sec">Te falta 1 componente</div>${almost.map(a => `<div class="craft">${tItemImg(a.item)}<div class="grow"><b>${esc(itemInfo(a.item).name)}</b><small>para ${esc(unitInfo(a.unit).name)} · falta</small></div>${tItemImg(a.missing, 'ti sm')}</div>`).join('')}` : ''}`;
  $$('.cp').forEach(el => {
    el.onclick = () => { have[el.dataset.c] = (have[el.dataset.c] || 0) + 1; ovSave(); renderOvItems(); };
    el.oncontextmenu = e => { e.preventDefault(); have[el.dataset.c] = Math.max(0, (have[el.dataset.c] || 0) - 1); ovSave(); renderOvItems(); };
  });
  $('#ovClear').onclick = () => { OV.have = {}; ovSave(); renderOvItems(); };
}

/* ---------- recipes tab ---------- */
function renderOvRecipes() {
  const base = components().slice(0, 10);
  view.innerHTML = `<div class="sec">Tabla de recetas</div><div style="overflow-x:auto"><table class="recipes"><tr><th></th>${base.map(c => `<th>${tItemImg(c.apiName)}</th>`).join('')}</tr>
    ${base.map(r => `<tr><th>${tItemImg(r.apiName)}</th>${base.map(c => { const it = recipeFor(r.apiName, c.apiName); return `<td>${it ? tItemImg(it.apiName) : ''}</td>`; }).join('')}</tr>`).join('')}</table></div>
    <div class="sec">Mejores objetos</div>
    ${combos().filter(i => avgOf(i.apiName)).sort((a, b) => avgOf(a.apiName) - avgOf(b.apiName)).slice(0, 12).map(i => `<div class="craft">${tItemImg(i.apiName)}<div class="grow"><b>${esc(i.name)}</b><small>prom. ${avgOf(i.apiName).toFixed(2)} · Top 4 ${pct(T.stats.items[i.apiName].top4, 0)}</small></div><span class="rec" style="display:flex;gap:2px">${i.composition.map(c => tItemImg(c, 'ti sm')).join('')}</span></div>`).join('')}`;
}

/* ---------- shell ---------- */
function renderOv() {
  if (OV.tab === 'items') return renderOvItems();
  if (OV.tab === 'recipes') return renderOvRecipes();
  return renderOvComps();
}
$('#ovTabs').onclick = e => { const b = e.target.closest('button'); if (!b) return; OV.tab = b.dataset.t; $$('#ovTabs button').forEach(x => x.classList.toggle('on', x === b)); window.scrollTo(0, 0); renderOv(); };
view.addEventListener('click', async e => {
  const st = e.target.closest('[data-stage]');
  if (st) { const id = st.closest('.oc').dataset.id; OV.stage[id] = +st.dataset.stage; renderOv(); return; }
  const pin = e.target.closest('[data-pin]');
  if (pin) { OV.pin = OV.pin === pin.dataset.pin ? null : pin.dataset.pin; OV.open = null; ovSave(); window.scrollTo(0, 0); renderOv(); toast(OV.pin ? 'Compo fijada arriba' : 'Compo quitada'); return; }
  const code = e.target.closest('[data-code]');
  if (code) { try { await navigator.clipboard.writeText(code.dataset.code); toast('Código copiado ✔'); } catch { } return; }
  const t = e.target.closest('#ovTier button');
  if (t) { OV.tier = t.dataset.t; renderOv(); return; }
  const card = e.target.closest('.oc');
  if (card && !e.target.closest('.oc-b')) ovOpenComp(card.dataset.id);
});

(async function bootOverlay() {
  try {
    await Promise.all([tftLoadStatic().catch(() => { }), tftLoadComps()]);
  } catch (e) { view.innerHTML = errorBox(e); return; }
  renderOv();
  tftLoadStats().then(() => { if (OV.tab !== 'comps') renderOv(); }).catch(() => { });
  // pick up new comps (OP.GG refresh) every 30 min without reopening the overlay
  setInterval(async () => { tftCompsP = null; try { await tftLoadComps(); if (OV.tab === 'comps' && !document.activeElement?.matches('input')) renderOv(); } catch { } }, 30 * 60 * 1000);
})();
