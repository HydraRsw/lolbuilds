'use strict';
/* TFT assistant tools, shared by the app, the overlay and the mobile site:
   - comps that fit the components you have
   - pick the best of the augments you are offered
   - leveling / economy plan and shop odds (with a roll calculator)
   - match history from the client (desktop app only) */

/* ---------- Set 18 constants (OP odds, pool sizes, XP) ---------- */
const TFT_ODDS = { // level -> % per shop slot for 1..5 cost
  1: [100, 0, 0, 0, 0], 2: [100, 0, 0, 0, 0], 3: [75, 25, 0, 0, 0], 4: [55, 30, 15, 0, 0], 5: [45, 33, 20, 2, 0],
  6: [30, 40, 25, 5, 0], 7: [16, 30, 43, 10, 1], 8: [15, 20, 32, 30, 3], 9: [10, 17, 25, 33, 15], 10: [5, 10, 20, 40, 25],
};
const TFT_POOL = [[30, 14], [25, 13], [18, 14], [10, 14], [9, 10]]; // copies per champion, champions per cost
const TFT_XP = { 3: 2, 4: 6, 5: 10, 6: 20, 7: 36, 8: 60, 9: 68, 10: 68 }; // XP to reach that level from the previous one

/* ---------- persisted tool state (per window) ---------- */
const TT = (() => {
  let s = {};
  try { s = JSON.parse(localStorage.getItem('tft.tools') || '{}'); } catch { }
  return Object.assign({ have: {}, augs: [], deck: '', lvl: 7, cost: 3, out: 3, sameCost: 12 }, s);
})();
const ttSave = () => { try { localStorage.setItem('tft.tools', JSON.stringify(TT)); } catch { } };

/* ---------- helpers ---------- */
function tftComponents() {
  const all = T.st?.items || [];
  const used = new Set(all.flatMap(i => i.composition || []));
  return all.filter(i => used.has(i.apiName) && !(i.composition?.length) && !/tutorial/i.test(i.apiName));
}
// Items wanted by a comp, carries first (by priority), then the other holders.
function compWants(d) {
  const carries = d.units.filter(u => u.isCore).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const others = d.units.filter(u => !u.isCore && u.items?.length);
  const out = [];
  carries.forEach((u, i) => (u.items || []).forEach(it => out.push({ item: it, unit: u.key, w: i === 0 ? 1.3 : 1 })));
  others.forEach(u => (u.items || []).forEach(it => out.push({ item: it, unit: u.key, w: 0.6 })));
  return out.filter(x => itemInfo(x.item).comp.length === 2);
}
const deckById = id => (T.comps || []).find(d => d.id === id);
const TIER_RANK = { OP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
function deckStyle(d) {
  const lvl = +badgeVal(d, 'reroll') || 0;
  const reroll = badgeVal(d, 'isReroll') ?? (lvl && lvl <= 7 && d.units.some(u => u.tier >= 3));
  return { reroll: !!reroll && lvl > 0, lvl: lvl || 8 };
}
function deckSelect(id, cur) {
  const list = [...(T.comps || [])].sort((a, b) => (TIER_RANK[a.stat?.opTier] ?? 9) - (TIER_RANK[b.stat?.opTier] ?? 9) || (a.stat?.deck?.avgPlacement || 9) - (b.stat?.deck?.avgPlacement || 9));
  return `<select id="${id}" class="tt-sel"><option value="">${L('Sin compo (general)')}</option>${list.map(d => `<option value="${esc(d.id)}" ${d.id === cur ? 'selected' : ''}>${esc((d.stat?.opTier || '') + ' · ' + deckName(d))}</option>`).join('')}</select>`;
}

/* ================= 1. comps for my components ================= */
// Score = weighted number of the comp's needed components you already have
// (each of your components counts once, for the most important item first).
function compsForComponents(have) {
  const total = Object.values(have).reduce((a, b) => a + b, 0);
  if (!total) return [];
  return (T.comps || []).map(d => {
    const wants = compWants(d);
    const left = { ...have };
    let score = 0, used = 0;
    const need = [];
    for (const w of wants) for (const c of itemInfo(w.item).comp) need.push({ c, w: w.w });
    need.sort((a, b) => b.w - a.w);
    for (const n of need) if (left[n.c] > 0) { left[n.c]--; score += n.w; used++; }
    // completed items you can build right now (priority order)
    const pool = { ...have }, build = [];
    for (const w of wants) {
      const [a, b] = itemInfo(w.item).comp;
      if (a === b ? pool[a] >= 2 : pool[a] > 0 && pool[b] > 0) { pool[a]--; pool[b]--; build.push(w); }
    }
    return { d, score, used, total, build };
  }).filter(x => x.used > 0)
    .sort((a, b) => b.score - a.score || (TIER_RANK[a.d.stat?.opTier] ?? 9) - (TIER_RANK[b.d.stat?.opTier] ?? 9) || (a.d.stat?.deck?.avgPlacement || 9) - (b.d.stat?.deck?.avgPlacement || 9));
}

function itemsToolHTML(compact) {
  const comps = tftComponents();
  if (!comps.length) return `<p class="muted">${L('Sin datos de objetos.')}</p>`;
  const have = TT.have, n = Object.values(have).reduce((a, b) => a + b, 0);
  const res = compsForComponents(have).slice(0, compact ? 4 : 8);
  return `<p class="fine tt-help">${L('Toca los componentes que tienes (clic derecho o mantener para quitar uno).')}</p>
    <div class="tt-comps">${comps.map(c => `<button class="tt-c ${have[c.apiName] ? 'has' : ''}" data-comp="${esc(c.apiName)}" title="${esc(c.name)}"><img src="${c.icon}" alt="${esc(c.name)}">${have[c.apiName] ? `<b>${have[c.apiName]}</b>` : ''}</button>`).join('')}
    ${n ? `<button class="tt-clear" data-clear="1">${L('Limpiar')}</button>` : ''}</div>
    ${n ? (res.length ? `<div class="tt-res">${res.map((r, i) => `
      <div class="tt-row ${i === 0 ? 'best' : ''}" data-open="${esc(r.d.id)}">
        <span class="tier ${TIER_CLS(r.d.stat?.opTier)}">${esc(r.d.stat?.opTier || '?')}</span>
        <div class="grow"><b>${esc(deckName(r.d))}</b>
          <small>${L('Usa {a} de tus {b} componentes', { a: r.used, b: r.total })}${r.build.length ? ' · ' + L('arma ya:') : ''}</small>
          ${r.build.length ? `<span class="tt-build">${r.build.slice(0, 4).map(w => `${tItemImg(w.item, 'ti sm')}`).join('')}</span>` : ''}</div>
        <span class="tt-carry">${r.d.units.filter(u => u.isCore).slice(0, 2).map(u => tUnitImg(u.key, 'xs', r.d.id)).join('')}</span>
      </div>`).join('')}</div>` : `<p class="muted">${L('Ninguna compo usa esos componentes.')}</p>`) : ''}`;
}
function itemsToolClick(e, rerender) {
  const c = e.target.closest('[data-comp]');
  if (c) {
    const k = c.dataset.comp;
    TT.have[k] = Math.min(9, (TT.have[k] || 0) + 1);
    ttSave(); rerender(); return true;
  }
  if (e.target.closest('[data-clear]')) { TT.have = {}; ttSave(); rerender(); return true; }
  return false;
}
function itemsToolRemove(e, rerender) {
  const c = e.target.closest('[data-comp]');
  if (!c) return false;
  e.preventDefault();
  const k = c.dataset.comp;
  if (TT.have[k] > 1) TT.have[k]--; else delete TT.have[k];
  ttSave(); rerender(); return true;
}

/* ================= 2. augment picker ================= */
function augPool() {
  // augments in the current pool (in a tier list) first; any augment of the set as fallback
  const known = new Set([...Object.keys(T.augs?.global || {}), ...Object.values(T.augs?.clusters || {}).flatMap(c => c.augs.map(a => a[0]))]);
  const ids = Object.keys(T.aug || {});
  return known.size ? ids.filter(id => known.has(id)) : ids;
}
const augFamily = id => id.replace(/(Plus)+(?=_|$)/g, '').replace(/_?(I{1,3})$/, '');
// tier of an augment for a comp (exact id, else another version of it)
function augTierFor(d, id) {
  const cl = d && compCluster(d);
  if (!cl) return '';
  const ex = cl.augs.find(a => a[0] === id);
  if (ex) return ex[1];
  const f = augFamily(id), fam = cl.augs.filter(a => augFamily(a[0]) === f).sort((a, b) => AUG_TR[a[1]] - AUG_TR[b[1]]);
  return fam[0]?.[1] || '';
}
function evalAug(id, d) {
  const g = T.augs?.global?.[id];
  const ct = d ? augTierFor(d, id) : '';
  const gr = g ? AUG_TR[g[0]] * 1000 + g[1] : 9e6;
  const score = d ? (ct ? AUG_TR[ct] : 3.5) * 1e7 + gr : gr;
  // comps where it is S tier
  const best = (T.comps || []).filter(x => augTierFor(x, id) === 'S')
    .sort((a, b) => (TIER_RANK[a.stat?.opTier] ?? 9) - (TIER_RANK[b.stat?.opTier] ?? 9)).slice(0, 3);
  return { id, gt: g?.[0] || '', ct, score, best };
}
function augsToolHTML(deckId, compact) {
  if (!T.augs) return loadingHTML();
  const d = deckById(deckId);
  const picked = TT.augs.filter(id => T.aug[id] || T.augs.global?.[id]);
  const ranked = picked.map(id => evalAug(id, d)).sort((a, b) => a.score - b.score);
  const gl = x => x.gt ? `<span class="tt-g">${L('General')}: <b>${x.gt}</b></span>` : '';
  return `<p class="fine tt-help">${L('Escribe los aumentos que te ofrecen (hasta 3) y te digo cuál conviene{c}.', { c: d ? L(' para tu compo') : '' })}</p>
    ${compact ? '' : `<div class="tt-line">${L('Compo')}: ${deckSelect('ttDeck', deckId)}</div>`}
    <div class="tt-aug-in"><input id="ttAugQ" placeholder="${L('Buscar aumento…')}" autocomplete="off" spellcheck="false" ${picked.length >= 3 ? 'disabled' : ''}><div id="ttAugSug" class="tt-sug"></div></div>
    ${ranked.length ? `<div class="tt-res">${ranked.map((x, i) => {
      const a = augInfo(x.id);
      const verdict = i === 0 && ranked.length > 1 ? `<span class="tt-best">${L('Elige este')}</span>` : '';
      return `<div class="tt-row ${i === 0 ? 'best' : ''}">
        ${a.icon ? `<img class="tt-aimg" src="${esc(a.icon)}" alt="">` : ''}
        <div class="grow"><b data-tip="tft-aug:${encodeURIComponent(x.id + '|' + (x.ct || '—') + '|' + x.gt + '|0')}">${esc(a.name)}</b>
          <small>${d ? (x.ct ? `${L('En tu compo')}: <b class="tt-t t${x.ct}">${x.ct}</b>` : L('No está en la lista de tu compo')) : ''} ${gl(x)}</small>
          ${!d && x.best.length ? `<small>${L('Ideal para')}: ${x.best.map(b => esc(deckName(b))).join(', ')}</small>` : ''}</div>
        ${verdict}<button class="tt-x" data-unaug="${esc(x.id)}" title="${L('Quitar')}">✕</button></div>`;
    }).join('')}</div>` : ''}`;
}
function augSuggest(q) {
  const n = norm(q);
  if (!n) return '';
  const list = augPool().map(id => ({ id, a: augInfo(id) })).filter(x => norm(x.a.name).includes(n) && !TT.augs.includes(x.id))
    .sort((a, b) => norm(a.a.name).indexOf(n) - norm(b.a.name).indexOf(n) || a.a.name.length - b.a.name.length).slice(0, 7);
  return list.map(x => `<div class="tt-s" data-addaug="${esc(x.id)}">${x.a.icon ? `<img src="${esc(x.a.icon)}" alt="">` : ''}${esc(x.a.name)}</div>`).join('') || `<div class="tt-s muted">${L('Sin resultados.')}</div>`;
}
function augsToolWire(root, rerender) {
  const q = root.querySelector('#ttAugQ'), sug = root.querySelector('#ttAugSug');
  if (q) {
    q.oninput = () => { sug.innerHTML = augSuggest(q.value); };
    q.onkeydown = e => { if (e.key === 'Enter') { const f = sug.querySelector('[data-addaug]'); if (f) f.click(); } };
  }
  const sel = root.querySelector('#ttDeck');
  if (sel) sel.onchange = () => { TT.deck = sel.value; ttSave(); rerender(); };
}
function augsToolClick(e, rerender) {
  const add = e.target.closest('[data-addaug]');
  if (add) {
    if (TT.augs.length < 3) TT.augs.push(add.dataset.addaug);
    ttSave(); rerender(); setTimeout(() => document.getElementById('ttAugQ')?.focus(), 0); return true;
  }
  const rm = e.target.closest('[data-unaug]');
  if (rm) { TT.augs = TT.augs.filter(x => x !== rm.dataset.unaug); ttSave(); rerender(); return true; }
  if (e.target.closest('[data-augclear]')) { TT.augs = []; ttSave(); rerender(); return true; }
  return false;
}

/* ================= 3. leveling plan, economy and shop odds ================= */
function levelPlan(d) {
  const s = d ? deckStyle(d) : null;
  const std = [['2-1', L('Nivel 4')], ['2-5', L('Nivel 5')], ['3-2', L('Nivel 6')]];
  if (s?.reroll) {
    const n = s.lvl;
    const rows = n <= 5
      ? [['2-1', L('Nivel 4; guarda oro')], ['2-5 / 3-1', L('Nivel 5 y rolea lento con el oro sobre 50')], ['3-x', L('Sigue en nivel 5 hasta tener tus carries a 3★')], ['4-1', L('Sube a 7–8 para completar el tablero')]]
      : n === 6
        ? [...std.slice(0, 2), ['3-2', L('Nivel 6 y rolea lento con el oro sobre 50')], ['3-5 / 4-1', L('Sigue en 6 hasta tener tus carries a 3★')], ['4-2+', L('Sube a 8 para completar el tablero')]]
        : [...std, ['3-5 / 4-1', L('Nivel 7 y rolea lento con el oro sobre 50')], ['4-x', L('Sigue en 7 hasta tus carries a 3★, luego sube a 8')]];
    return { title: L('Reroll en nivel {n}', { n }), rows, tip: L('Rolea solo el oro por encima de 50 para no perder interés. En nivel {n} los campeones de {c} de coste salen un {p}% por casilla.', { c: Math.max(1, Math.min(n - 4, 3)), n, p: TFT_ODDS[n][Math.max(0, Math.min(n - 5, 2))] }) };
  }
  const n = s?.lvl || 8;
  const rows = n <= 7
    ? [...std, ['3-5 / 4-1', L('Nivel 7 y rolea para estabilizar ({p}% de 3 de coste)', { p: TFT_ODDS[7][2] })], ['4-2+', L('Sube a 8 para completar el tablero')]]
    : [...std, ['3-5', L('Nivel 7 si tienes buena racha (o 50+ de oro)')], ['4-1 / 4-2', L('Nivel 8 y rolea fuerte para estabilizar ({p}% de 4 de coste)', { p: TFT_ODDS[8][3] })]];
  if (n >= 9) rows.push(['5-1 / 5-2', L('Nivel 9 y busca los de 5 de coste ({p}%)', { p: TFT_ODDS[9][4] })]);
  return { title: d ? L('Subida rápida a nivel {n}', { n }) : L('Plan estándar'), rows, tip: L('Guarda 50 de oro para el interés máximo (+5 por ronda) y rolea cuando subas de nivel.') };
}
// probability of seeing at least one copy of a unit per shop and gold to find one
function rollOdds(lvl, cost, out, sameOut) {
  const [copies, n] = TFT_POOL[cost - 1];
  const odds = TFT_ODDS[lvl][cost - 1] / 100;
  const left = Math.max(0, copies - out);
  const poolLeft = Math.max(1, copies * n - out - sameOut);
  const pSlot = odds * left / poolLeft;
  const pShop = 1 - Math.pow(1 - pSlot, 5);
  return { pSlot, pShop, gold: pShop > 0 ? 2 / pShop : Infinity, left };
}
function levelToolHTML(deckId, compact) {
  const d = deckById(deckId), plan = levelPlan(d);
  const lvl = TT.lvl, cost = TT.cost;
  const r = rollOdds(lvl, cost, TT.out, TT.sameCost);
  const opt = (id, val, arr) => `<select id="${id}" class="tt-sel sm">${arr.map(([v, l]) => `<option value="${v}" ${+v === +val ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
  const nums = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => [a + i, a + i]);
  const xp = TFT_XP[lvl + 1] || 0;
  return `${compact ? '' : `<div class="tt-line">${L('Compo')}: ${deckSelect('ttDeckL', deckId)}</div>`}
    <h5 class="tt-h">${esc(plan.title)}</h5>
    <div class="tt-plan">${plan.rows.map(([s, t]) => `<div><b>${s}</b><span>${t}</span></div>`).join('')}</div>
    <p class="fine">${plan.tip}</p>
    <h5 class="tt-h">${L('Probabilidades de la tienda')}</h5>
    <table class="tt-odds"><thead><tr><th>${L('Nivel')}</th>${[1, 2, 3, 4, 5].map(c => `<th><span class="cost c${c}">${c}</span></th>`).join('')}</tr></thead>
      <tbody>${Object.entries(TFT_ODDS).filter(([l]) => !compact || l >= 3).map(([l, o]) => `<tr class="${+l === lvl ? 'on' : ''}" data-lvl="${l}"><td>${l}</td>${o.map(x => `<td>${x ? x + '%' : '–'}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <h5 class="tt-h">${L('Calculadora de roleo')}</h5>
    <div class="tt-calc">
      <label>${L('Nivel')} ${opt('ttLvl', lvl, nums(3, 10))}</label>
      <label>${L('Coste')} ${opt('ttCost', cost, nums(1, 5))}</label>
      <label>${L('Copias fuera')} ${opt('ttOut', TT.out, nums(0, TFT_POOL[cost - 1][0]))}</label>
      <label>${L('Otras del mismo coste fuera')} ${opt('ttSame', TT.sameCost, nums(0, 40))}</label>
    </div>
    <div class="tt-calc-res">${r.left ? `${L('Por tienda')}: <b>${pct(r.pShop, 1)}</b> · ${L('oro esperado para ver una copia')}: <b>~${Math.round(r.gold)}</b>` : L('No quedan copias de ese campeón.')}</div>
    <p class="fine">${L('Quedan {l} de {c} copias. Subir de nivel {a}→{b}: {x} de XP ({g} de oro). Ganas 2 de XP por ronda; cada compra da 4 por 4 de oro.', { l: r.left, c: TFT_POOL[cost - 1][0], a: lvl, b: Math.min(lvl + 1, 10), x: xp || '—', g: xp ? Math.ceil(xp / 4) * 4 : '—' })}</p>
    <p class="fine">${L('Interés: +1 de oro por cada 10 que tengas al final de la ronda (máx. +5 con 50).')}</p>`;
}
function levelToolWire(root, rerender) {
  const bind = (id, k) => { const el = root.querySelector('#' + id); if (el) el.onchange = () => { TT[k] = +el.value; if (k === 'cost') TT.out = Math.min(TT.out, TFT_POOL[TT.cost - 1][0]); ttSave(); rerender(); }; };
  bind('ttLvl', 'lvl'); bind('ttCost', 'cost'); bind('ttOut', 'out'); bind('ttSame', 'sameCost');
  const sel = root.querySelector('#ttDeckL');
  if (sel) sel.onchange = () => { TT.deck = sel.value; ttSave(); rerender(); };
  root.querySelectorAll('.tt-odds tr[data-lvl]').forEach(tr => tr.onclick = () => { TT.lvl = +tr.dataset.lvl; ttSave(); rerender(); });
}

/* ================= app page: #/tft/tools and #/tft/history ================= */
async function renderTTools(t) {
  view.innerHTML = tftShell('tools', loadingHTML());
  try { await tftLoadComps(); } catch (e) { view.innerHTML = tftShell('tools', errorBox(e)); return; }
  tftLoadAugs().then(() => draw()).catch(() => { });
  if (stale(t)) return;
  const draw = () => {
    if (stale(t)) return;
    const box = $('#ttBody');
    if (!box) return;
    const q = $('#ttAugQ')?.value || '';
    box.innerHTML = `<div class="two">
      <div class="card"><h3>${L('¿Qué compo juego con mis objetos?')}</h3><div id="ttItems">${itemsToolHTML(false)}</div></div>
      <div class="card"><h3>${L('¿Qué aumento elijo?')}</h3><div id="ttAugs">${augsToolHTML(TT.deck, false)}</div></div>
    </div>
    <div class="card" style="margin-top:14px"><h3>${L('Niveles, economía y probabilidades')}</h3><div id="ttLevel">${levelToolHTML(TT.deck, false)}</div></div>`;
    augsToolWire(box, draw); levelToolWire(box, draw);
    if (q && $('#ttAugQ') && !$('#ttAugQ').disabled) { $('#ttAugQ').value = q; $('#ttAugSug').innerHTML = augSuggest(q); }
  };
  view.innerHTML = tftShell('tools', `<div id="ttBody"></div>`);
  const box = $('#ttBody');
  box.addEventListener('click', e => {
    if (itemsToolClick(e, draw) || augsToolClick(e, draw)) return;
    const o = e.target.closest('[data-open]');
    if (o && !e.target.closest('[data-tip]')) go('#/tft/comp/' + o.dataset.open);
  });
  box.addEventListener('contextmenu', e => itemsToolRemove(e, draw));
  draw();
}

const HIST_QUEUES = { 1090: L('Normal'), 1100: L('Clasificatoria'), 1130: L('Hiper Roll'), 1160: L('Doble Pareja'), 1110: L('Tutorial') };
async function renderTHistory(t) {
  view.innerHTML = tftShell('history', loadingHTML('Leyendo tus partidas del cliente…'));
  let h;
  try {
    const r = await fetch('/api/lcu/tft-history');
    h = await r.json();
    if (!r.ok) throw new Error(h.error || 'HTTP ' + r.status);
  } catch (e) {
    if (stale(t)) return;
    view.innerHTML = tftShell('history', `<div class="card"><p>${L('No se pudo leer el historial del cliente.')}</p><p class="fine">${esc(L(e.message))}</p><p class="fine">${L('Abre el cliente de LoL o de TFT e inicia sesión. Si no lo detecta, mira Ajustes → Diagnóstico.')}</p></div>`);
    return;
  }
  if (stale(t)) return;
  const games = h.games || [];
  if (!games.length) { view.innerHTML = tftShell('history', `<div class="card"><p class="muted">${L('No hay partidas de TFT recientes.')}</p></div>`); return; }
  const avg = games.reduce((s, g) => s + g.placement, 0) / games.length;
  const top4 = games.filter(g => g.placement <= 4).length / games.length;
  const wins = games.filter(g => g.placement === 1).length;
  const traitCount = {};
  games.forEach(g => (g.traits || []).filter(x => x.style >= 2).forEach(x => traitCount[x.name] = (traitCount[x.name] || 0) + 1));
  const favTraits = Object.entries(traitCount).sort((a, b) => b[1] - a[1]).slice(0, 4);
  view.innerHTML = tftShell('history', `
    <div class="card hist-sum">
      <div><b>${games.length}</b><span>${L('partidas')}</span></div>
      <div><b>${avg.toFixed(2)}</b><span>${L('posición media')}</span></div>
      <div><b>${pct(top4, 0)}</b><span>top 4</span></div>
      <div><b>${wins}</b><span>${L('victorias')}</span></div>
      ${favTraits.length ? `<div class="grow"><span>${L('Sinergias que más juegas')}</span><p>${favTraits.map(([k, n]) => `${esc(traitInfo(k).name)} ×${n}`).join(' · ')}</p></div>` : ''}
    </div>
    <div class="hist-list">${games.map(g => {
      const tr = (g.traits || []).filter(x => x.style >= 1).sort((a, b) => b.style - a.style || b.units - a.units).slice(0, 5);
      const units = [...(g.units || [])].sort((a, b) => (b.items?.length || 0) - (a.items?.length || 0) || b.tier - a.tier);
      return `<div class="hist-row p${g.placement <= 4 ? (g.placement === 1 ? '1' : 't') : 'b'}">
        <div class="hp"><b>#${g.placement}</b><small>${esc(HIST_QUEUES[g.queue] || g.queue || '')}</small><small>${new Date(g.date).toLocaleDateString(DATA_LOC.num, { day: 'numeric', month: 'short' })} · ${L('Nv.')} ${g.level}</small></div>
        <div class="ht">${tr.map(x => `<span class="hist-tr s${x.style}">${x.units} ${esc(traitInfo(x.name).name)}</span>`).join('')}
          ${(g.augments || []).length ? `<div class="hist-aug">${g.augments.map(a => { const i = augInfo(a); return i.icon ? `<img src="${esc(i.icon)}" alt="" data-tip="text:${encodeURIComponent(i.name)}">` : `<span>${esc(i.name)}</span>`; }).join('')}</div>` : ''}</div>
        <div class="hu">${units.map(u => `<div class="hist-u">${tUnit(u.id, { stars: u.tier, items: u.items, name: false })}</div>`).join('')}</div>
      </div>`;
    }).join('')}</div>`);
}

/* ================= overlay panel (comps window tabs) ================= */
function ovToolHTML(tab, deckId) {
  if (tab === 'items') return `<div class="tt-ov">${itemsToolHTML(true)}</div>`;
  if (tab === 'augs') return `<div class="tt-ov">${deckId ? `<p class="fine">📌 ${esc(deckName(deckById(deckId) || {}))}</p>` : ''}${augsToolHTML(deckId, true)}${TT.augs.length ? `<button class="btn ghost sm" data-augclear="1">${L('Nueva elección')}</button>` : ''}</div>`;
  if (tab === 'level') return `<div class="tt-ov">${deckId ? `<p class="fine">📌 ${esc(deckName(deckById(deckId) || {}))}</p>` : ''}${levelToolHTML(deckId, true)}</div>`;
  return '';
}
