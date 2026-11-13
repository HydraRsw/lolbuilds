'use strict';
/* LoL Builds — TFT section.
   Comps: OP.GG meta decks (final/early/mid boards). Stats: MetaTFT. Names/icons: CommunityDragon (es_MX). */

const MT = 'https://api-hc.metatft.com/';
const MT_Q = 'queue=1100&patch=current&days=3&permit_filter_adjustment=true';
const T = { st: null, comps: null, champ: {}, champByName: {}, trait: {}, traitByName: {}, item: {}, aug: {}, augs: null, metaUnit: {}, stats: null, uip: null };

/* ---------- loading ---------- */
async function tftJSON(path, fresh) {
  const r = await fetch(path + (fresh ? (path.includes('?') ? '&' : '?') + 'fresh=1' : ''));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
  return j;
}
// In the desktop app (and its overlay) icons go through the local disk cache.
const LOCAL_IMG = /^(127\.0\.0\.1|localhost)$/.test(location.hostname) && !window.LB_MOBILE_APP;
const IMG = u => (LOCAL_IMG && typeof u === 'string' && u.startsWith('https://')) ? '/img?u=' + encodeURIComponent(u) : u;
let tftStaticP = null, tftCompsP = null, tftStatsP = null, tftAugsP = null;
function tftLoadStatic() {
  return tftStaticP ??= tftJSON('/api/tft/static?lang=' + DATA_LOC.cd, Date.now() < S.freshUntil).then(st => {
    T.st = st;
    for (const x of [...st.champions, ...st.traits, ...st.items, ...(st.augments || [])]) if (x.icon) x.icon = IMG(x.icon);
    for (const c of st.champions) { T.champ[c.apiName] = c; T.champByName[c.name] = c; }
    for (const t of st.traits) { T.trait[t.apiName] = t; T.traitByName[t.name] = t; }
    for (const i of st.items) T.item[i.apiName] = i;
    for (const a of st.augments || []) T.aug[a.apiName] = a;
    return st;
  }).catch(e => { tftStaticP = null; throw e; });
}
function tftLoadComps() {
  return tftCompsP ??= tftJSON('/api/tft/comps', Date.now() < S.freshUntil).then(j => {
    T.comps = j.decks || [];
    for (const d of T.comps) for (const u of d.units || []) if (u.meta) { u.meta.imageUrl = IMG(u.meta.imageUrl); T.metaUnit[u.key] = u.meta; }
    for (const d of T.comps) fillMissingBoards(d, T.comps);
    return T.comps;
  }).catch(e => { tftCompsP = null; throw e; });
}
// Some OP.GG comps come without positions or early/mid boards. Fill them from the most
// similar comp that has them; whatever is still missing gets an automatic placement.
const TANK_ITEM = /Warmog|Gargoyle|SpiritVisage|DragonsClaw|Bramble|Sunfire|Redemption|ProtectorsVow|AdaptiveHelm|Crownguard|Evenshroud|SteadfastHeart|Titans|Thiefs/i;
function fillMissingBoards(d, all) {
  const noCells = d.units.some(u => !u.cell);
  const noEarly = !d.early?.units?.length, noMid = !d.middle?.units?.length;
  if (!noCells && !noEarly && !noMid) return;
  const keys = new Set(d.units.map(u => u.key));
  let donor = null, best = 0;
  for (const o of all) {
    if (o === d || !o.early?.units?.length || o.units.some(u => !u.cell)) continue;
    const shared = o.units.filter(u => keys.has(u.key)).length;
    if (shared > best) { best = shared; donor = o; }
  }
  const similar = donor && best >= Math.min(5, d.units.length - 2);
  if (similar) {
    if (noEarly) d.early = donor.early;
    if (noMid) d.middle = donor.middle;
    if (noEarly || noMid) d._boardsFrom = deckName(donor);
  }
  if (!noCells) return;
  const taken = new Set(d.units.filter(u => u.cell).map(u => u.cell.x + ',' + u.cell.y));
  if (similar) for (const u of d.units) {
    if (u.cell) continue;
    const c = donor.units.find(x => x.key === u.key)?.cell;
    if (c && !taken.has(c.x + ',' + c.y)) { u.cell = { ...c }; taken.add(c.x + ',' + c.y); }
  }
  // automatic placement: carries without tank items in the back row, the rest in front
  const back = [[1, 1], [7, 1], [2, 1], [6, 1], [3, 1], [5, 1], [4, 1], [1, 2], [7, 2]];
  const front = [[4, 4], [3, 4], [5, 4], [2, 4], [6, 4], [1, 4], [7, 4], [4, 3], [3, 3], [5, 3], [2, 3], [6, 3]];
  const place = (u, spots) => { const s = spots.find(([x, y]) => !taken.has(x + ',' + y)); if (s) { u.cell = { x: s[0], y: s[1] }; taken.add(s.join(',')); } };
  const isBack = u => u.isCore && !(u.items || []).some(i => TANK_ITEM.test(i));
  for (const u of d.units.filter(u => !u.cell)) { place(u, isBack(u) ? back : front); d._autoPos = true; }
}

/* ---------- augments per comp (MetaTFT expert tiers per comp cluster) ---------- */
function tftLoadAugs() {
  return tftAugsP ??= tftJSON('/api/tft/augs').then(j => (T.augs = j)).catch(e => { tftAugsP = null; throw e; });
}
function augInfo(id) {
  const a = T.aug[id];
  const who = id.match(/_([A-Z][a-zA-Z]+)$/)?.[1], champ = who && Object.values(T.champ).find(c => c.name === who || shortKey(c.apiName).replace(/\d+|_.*$/g, '') === who);
  if (a?.name && champ && !a.name.includes(champ.name)) return { id, name: `${a.name} (${champ.name})`, icon: a.icon || '', desc: a.desc || '', effects: a.effects, traits: a.traits || [] };
  return { id, name: a?.name || id.replace(/^[A-Z]+_(\d+_)?/, '').replace(/PlusPlus$/, '++').replace(/Plus$/, '+').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2'), icon: a?.icon || '', desc: a?.desc || '', effects: a?.effects, traits: a?.traits || [] };
}
// MetaTFT cluster for an OP.GG comp: most similar units (Jaccard), with a bonus when
// the cluster is named after one of the comp's carries ("AZIR > Blackthorn > ...").
function compCluster(d) {
  if (d._cl !== undefined) return d._cl;
  const cls = T.augs?.clusters; if (!cls) return null;
  const keys = new Set(d.units.map(u => u.key));
  const carries = d.units.filter(u => u.isCore).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9)).slice(0, 2)
    .map(u => shortKey(u.key).replace(/\d+/g, '').toUpperCase()).filter(Boolean);
  let best = null, score = 0, bestJ = 0, bestBonus = false;
  for (const c of Object.values(cls)) {
    const inter = c.units.filter(k => keys.has(k)).length;
    const j = inter / (keys.size + c.units.length - inter);
    const head = (c.title || '').split('>')[0].toUpperCase();
    const tokens = head.split(/[^A-Z']+/).filter(Boolean), flat = head.replace(/[^A-Z]/g, '');
    const bonus = carries.some(n => n.length >= 4 ? flat.includes(n.replace(/[^A-Z]/g, '')) : tokens.includes(n));
    const sc = j + (bonus ? 0.25 : 0);
    if (sc > score) { score = sc; best = c; bestJ = j; bestBonus = bonus; }
  }
  return (d._cl = (bestBonus && bestJ >= 0.25) || bestJ >= 0.5 ? best : null);
}
const AUG_TR = { S: 0, A: 1, B: 2, C: 3, D: 4 };
const shortKey = k => k.replace(/^[A-Z]+_(\d+_)?|\d+$|_A[DP]$/g, '');
// { perfect: [...], options: [...] } — S tier first; augments tied to the comp's
// traits or units ahead of generic ones; ties broken by the global expert tier list.
function compAugs(d) {
  const cl = compCluster(d); if (!cl) return null;
  const units = d.units.map(u => shortKey(u.key)).filter(n => n.length > 2);
  const traits = new Set((d.traits || []).filter(t => t.style > 0).map(t => t.key));
  const g = T.augs.global || {};
  const list = cl.augs.map(([id, t]) => {
    const a = augInfo(id);
    const spec = a.traits.some(x => traits.has(x)) || units.some(n => id.includes('_' + n));
    const gr = g[id] ? AUG_TR[g[id][0]] * 1000 + g[id][1] : 9e9;
    return { id, t, spec, gt: g[id]?.[0] || '', gr };
  });
  list.sort((a, b) => (AUG_TR[a.t] ?? 9) - (AUG_TR[b.t] ?? 9) || b.spec - a.spec || a.gr - b.gr);
  // one chip per augment family (X, X+, X++): the best ranked one, listing the other versions
  const fams = new Map();
  for (const x of list) {
    const k = x.id.replace(/(Plus)+(?=_|$)/g, '').replace(/_?(I{1,3})$/, '');
    if (fams.has(k)) fams.get(k).vars.push(x.id); else fams.set(k, { ...x, vars: [] });
  }
  const fl = [...fams.values()];
  const perfect = fl.filter(x => x.t === 'S').slice(0, 6);
  const options = fl.filter(x => !perfect.includes(x) && x.t !== 'B').slice(0, 10);
  return { perfect, options, title: cl.title };
}
function augChip(x, deck = '', compact = false) {
  const a = augInfo(x.id);
  const img = a.icon ? `<img src="${esc(a.icon)}" alt="" loading="lazy">` : `<span class="aug-ph">${esc(a.name.slice(0, 2))}</span>`;
  const tip = `data-tip="tft-aug:${encodeURIComponent(x.id + '|' + x.t + '|' + (x.gt || '') + '|' + (x.spec ? 1 : 0))}"`;
  if (compact) return `<span class="augc t${x.t}" ${tip}>${img}</span>`;
  return `<span class="augc t${x.t} ${x.spec ? 'spec' : ''}" ${tip}>${img}<span class="an">${esc(a.name)}</span><b class="at">${x.t}</b></span>`;
}
function augSection(d) {
  if (!T.augs) return `<div class="inline-load"><div class="spinner"></div></div>`;
  const r = compAugs(d);
  if (!r) return `<p class="muted">${L('No hay datos de aumentos para esta compo.')}</p>`;
  return `<h4 class="sub">${L('Perfectos')}</h4><div class="aug-list">${r.perfect.map(x => augChip(x, d.id)).join('')}</div>
    ${r.options.length ? `<h4 class="sub">${L('Otras opciones')}</h4><div class="aug-list">${r.options.map(x => augChip(x, d.id)).join('')}</div>` : ''}
    <p class="fine">${L('Tier de cada aumento para esta compo según jugadores expertos (MetaTFT). Con borde: específicos de esta compo (sus sinergias o campeones).')}</p>`;
}

function placesStats(places) {
  const games = places.reduce((a, b) => a + b, 0) || 1;
  return { games, avg: places.reduce((s, p, i) => s + p * (i + 1), 0) / games, top4: places.slice(0, 4).reduce((a, b) => a + b, 0) / games, win: places[0] / games };
}
function tftLoadStats() {
  return tftStatsP ??= (async () => {
    const get = u => api(MT + u).catch(() => null);
    const [units, items, traits, uip] = await Promise.all([
      get('tft-stat-api/units?' + MT_Q), get('tft-stat-api/items?' + MT_Q), get('tft-stat-api/traits?' + MT_Q), get('tft-comps-api/unit_items_processed')]);
    const map = (arr, key) => { const o = {}; for (const r of arr?.results || []) if (r.places) o[r[key]] = placesStats(r.places); return o; };
    T.stats = { units: map(units, 'unit'), items: map(items, 'itemName'), traits: map(traits, 'trait') };
    T.uip = uip;
    return T.stats;
  })();
}

/* ---------- lookups & small renderers ---------- */
const COST_CLS = c => 'c' + Math.min(Math.max(c || 1, 1), 5);
function unitInfo(key) {
  const c = T.champ[key], m = T.metaUnit[key];
  return { key, name: c?.name || m?.name || key.replace(/^[A-Z]+_(\d+_)?|\d+$|_A[DP]$/g, ''), cost: c?.cost || m?.cost || 1, icon: c?.icon || m?.imageUrl || '', fb: m?.imageUrl || '', traits: c?.traits || [] };
}
function itemInfo(key) {
  const i = T.item[key];
  return { key, name: i?.name || key.replace(/^[A-Z]+_(\d+_)?/, '').replace(/([a-z])([A-Z])/g, '$1 $2'), icon: i?.icon || IMG(`https://c-tft-api.op.gg/img/set/${T.st?.set || 18}/tft-item/${key}.png`), fb: IMG(`https://c-tft-api.op.gg/img/set/${T.st?.set || 18}/tft-item/${key}.png`), comp: i?.composition || [] };
}
function traitInfo(key, metaName) {
  const t = T.trait[key];
  return { key, name: t?.name || metaName || key.replace(/^[A-Z]+_(\d+_)?|\d+$/g, ''), icon: t?.icon || '', effects: t?.effects || [] };
}
const unitTip = (key, deck) => 'tft-unit:' + encodeURIComponent(key + (deck ? '@' + deck : ''));
const tUnitImg = (key, cls = '', deck = '') => { const u = unitInfo(key); return `<img class="tu-img ${COST_CLS(u.cost)} ${cls}" src="${u.icon || ph(u.name)}" data-fb="${u.fb}" alt="${esc(u.name)}" loading="lazy" data-tip="${unitTip(key, deck)}">`; };
const tItemImg = (key, cls = 'ti') => { const i = itemInfo(key); return `<img class="${cls}" src="${i.icon}" data-fb="${i.fb}" alt="${esc(i.name)}" loading="lazy" data-tip="tft-item:${key}">`; };
function tUnit(key, { stars = 0, items = [], carry = false, name = true, deck = '' } = {}) {
  const u = unitInfo(key);
  return `<a class="tu ${carry ? 'carry' : ''}" href="#/tft/champ/${encodeURIComponent(key)}">
    ${stars > 1 ? `<span class="stars s${stars}">${'★'.repeat(stars)}</span>` : ''}
    ${tUnitImg(key, '', deck)}
    ${items.length ? `<span class="tu-items">${items.map(i => tItemImg(i, 'ti xs')).join('')}</span>` : ''}
    ${name ? `<span class="tu-name">${esc(u.name)}</span>` : ''}</a>`;
}
const STYLE_CLS = ['off', 'bronze', 'silver', 'gold', 'prism', 'prism'];
function traitChip(t) {
  const info = traitInfo(t.key, t.meta?.name);
  return `<span class="tchip ${STYLE_CLS[t.style] || 'off'}" data-tip="tft-trait:${t.key}"><img src="${info.icon || t.meta?.imageUrl || ''}" data-fb="${t.meta?.imageUrl || ''}" alt="">${t.numUnits > 0 ? `<b>${t.numUnits}</b>` : ''}<span>${esc(info.name)}</span></span>`;
}
const deckName = d => (LANG === 'en' ? d.name?.en_US : (d.name?.es_MX || d.name?.es_ES)) || d.name?.en_US || (typeof d.name === 'string' ? d.name : L('Composición'));
const badgeVal = (d, k) => (d.badge || []).find(b => b.key === k)?.value;
// Comps that are only good with a specific augment or emblem (OP.GG "requirementBadges").
const reqName = r => (LANG === 'en' ? r.name?.en_US : (r.name?.es_MX || r.name?.es_ES)) || r.name?.en_US || r.name?.es_MX || itemInfo(r.key || '').name;
const reqIsAug = r => /augment/i.test(r.type || '') || /augment/i.test(r.key || '');
const reqLabel = r => L(reqIsAug(r) ? 'Solo con {name}' : 'Requiere {name}', { name: reqName(r) });
function reqBadges(d) {
  return (d.requirements || []).map(r => {
    const icon = IMG(r.imageUrl) || itemInfo(r.key || '').icon;
    const tip = (r.description || '').replace(/<[^>]+>/g, ' ').trim();
    const why = L(reqIsAug(r) ? 'Esta compo solo rinde si consigues este aumento.' : 'Esta compo necesita este emblema para ser buena.');
    return `<span class="req ${reqIsAug(r) ? 'r-aug' : 'r-emb'}" data-tip="text:${encodeURIComponent(reqLabel(r) + ' — ' + (LANG === 'en' && tip.length > 12 ? tip : why))}">${icon ? `<img src="${esc(icon)}" data-fb="${esc(itemInfo(r.key || '').fb)}" alt="">` : ''}${esc(reqLabel(r))}</span>`;
  }).join('');
}
const DIFF = { 1: [L('Fácil'), 'easy'], 2: [L('Media'), 'mid'], 3: [L('Difícil'), 'hard'] };
const TIER_CLS = t => ({ OP: 't-OP', S: 't-S', A: 't-A', B: 't-B', C: 't-C', D: 't-D' }[t] || 't-C');

/* desc cleanup: CommunityDragon text has @Var@ placeholders and %i:icon% tokens */
// stat icons inside game descriptions (%i:scaleAD%) shown as short words
const STAT_ICON = { scalead: 'daño de ataque', scaleap: 'poder de habilidad', scalehealth: 'Vida', scaleas: 'velocidad de ataque', scalearmor: 'Armadura', scalemr: 'Resistencia mágica', scalemana: 'Maná', scalecrit: 'prob. de crítico', scalecritmult: 'daño crítico', scaledr: 'reducción de daño', scaleomnivamp: 'omnivampirismo', scalesv: 'omnivampirismo', scaledamageamp: 'amplificación de daño', scalerange: 'alcance', scaleshield: 'escudo', scalehealing: 'curación', scalemanaregen: 'regeneración de maná', scalegold: 'oro' };
function tftDesc(desc, vars = {}, rowsMin = []) {
  if (!desc) return '';
  let row = 0;
  const lower = {};
  for (const [k, v] of Object.entries(vars || {})) lower[k.toLowerCase()] = v;
  let s = String(desc).replace(/%i:([A-Za-z]+)%/g, (_, k) => STAT_ICON[k.toLowerCase()] ? ' ' + L(STAT_ICON[k.toLowerCase()]) : '').replace(/\\n|\r/g, '');
  s = s.replace(/@([^@]+)@/g, (_, expr) => {
    const [name, mul] = expr.split('*');
    if (/^minunits$/i.test(name)) return rowsMin[row++] ?? '';
    let v = lower[name.toLowerCase()];
    const f = mul ? parseFloat(mul) || 1 : 1;
    const num = x => { const n = x * f; return Math.abs(n) >= 10 ? Math.round(n) : Math.round(n * 100) / 100; };
    if (Array.isArray(v)) return v.map(num).join('/');
    if (typeof v === 'number') return num(v);
    return '—';
  });
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/row>/gi, '\n').replace(/<[^>]+>/g, '');
  return esc(s.replace(/\n{2,}/g, '\n').trim()).replace(/\n/g, '<br>');
}

// Trait text is split in <row> blocks, one per breakpoint, each with its own variables.
function traitDesc(t) {
  if (!t?.desc) return '';
  const parts = String(t.desc).split(/<row>/i);
  return parts.map((p, i) => i === 0 ? tftDesc(p, t.effects?.[0]?.variables || {}) : tftDesc(p, t.effects?.[i - 1]?.variables || {}, [t.effects?.[i - 1]?.minUnits ?? ''])).filter(Boolean).join('<br>');
}

/* tooltips (called from app.js tipHTML) */
function tftTip(kind, key) {
  if (kind === 'unit') {
    const [ukey, deckId] = key.split('@');
    const u = unitInfo(ukey), c = T.champ[ukey], st = T.stats?.units?.[ukey];
    const deck = deckId && (T.comps || []).find(d => d.id === deckId);
    const inComp = (deck?.units.find(x => x.key === ukey)?.items || []).filter(Boolean);
    const bis = (T.uip?.units?.[ukey]?.items || []).map(x => x.itemName);
    // items players actually slam on this unit across the meta comps
    const metaCount = {};
    for (const d of T.comps || []) for (const x of d.units) if (x.key === ukey) for (const it of x.items || []) metaCount[it] = (metaCount[it] || 0) + 1;
    const metaItems = Object.entries(metaCount).sort((a, b) => b[1] - a[1]).map(([k]) => k);
    const best = (bis.length ? bis : metaItems).slice(0, 3);
    const alts = [...new Set([...bis.slice(3), ...metaItems])].filter(k => !best.includes(k) && !inComp.includes(k)).slice(0, 5);
    const row = list => `<div class="tt-items">${list.map(k => `<span><img src="${itemInfo(k).icon}" data-fb="${itemInfo(k).fb}" alt=""><small>${esc(itemInfo(k).name)}</small></span>`).join('')}</div>`;
    const compact = document.body.classList.contains('ovl');
    return `<b>${esc(u.name)}</b><span class="g">${L('Costo {n}', { n: u.cost })}${u.traits.length ? ' · ' + esc(u.traits.join(', ')) : ''}${compact && st ? ` · ${L('prom.')} ${st.avg.toFixed(2)}` : ''}</span>
      ${inComp.length ? `<div class="tt-h">${L('En esta compo')}</div>${row(inComp)}` : ''}
      ${best.length ? `<div class="tt-h">${L('Objetos ideales (BIS)')}</div>${row(best)}` : `<p>${L('Sin datos de objetos para esta unidad.')}</p>`}
      ${alts.length ? `<div class="tt-h">${L('Alternativas')}</div><div class="tt-alts">${alts.map(k => `<img src="${itemInfo(k).icon}" data-fb="${itemInfo(k).fb}" alt="" title="${esc(itemInfo(k).name)}">`).join('')}</div>` : ''}
      ${st && !compact ? `<p>${L('Prom.')} ${st.avg.toFixed(2)} · Top 4 ${pct(st.top4)}</p>` : ''}
      ${c?.ability && !compact ? `<p class="tt-abil"><i>${esc(c.ability.name)}</i>: ${tftDesc(c.ability.desc, c.ability.vars).slice(0, 260)}</p>` : ''}`;
  }
  if (kind === 'item') {
    const i = itemInfo(key), raw = T.item[key], st = T.stats?.items?.[key];
    const recipe = i.comp.length ? `<p>${L('Receta: {r}', { r: i.comp.map(c => esc(itemInfo(c).name)).join(' + ') })}</p>` : '';
    return `<b>${esc(i.name)}</b>${recipe}${raw?.desc ? `<p>${tftDesc(raw.desc, raw.effects)}</p>` : ''}${st ? `<p>${L('Prom.')} ${st.avg.toFixed(2)} · Top 4 ${pct(st.top4)}</p>` : ''}`;
  }
  if (kind === 'aug') {
    const [id, tier, gt, spec] = key.split('|'), a = augInfo(id);
    return `<b>${esc(a.name)}</b><span class="g">${L('Tier en esta compo')}: ${tier}${gt ? ` · ${L('General')}: ${gt}` : ''}</span>${spec === '1' ? `<p>${L('Específico de esta compo.')}</p>` : ''}${a.desc ? `<p>${tftDesc(a.desc, a.effects || {})}</p>` : ''}`;
  }
  if (kind === 'trait') {
    const t = T.trait[key], info = traitInfo(key);
    const mins = (t?.effects || []).map(e => e.minUnits);
    return `<b>${esc(info.name)}</b>${mins.length ? `<span class="g">${mins.join(' / ')}</span>` : ''}${t?.desc ? `<p>${traitDesc(t)}</p>` : ''}`;
  }
  return '';
}

/* ---------- page shell ---------- */
function tftShell(active, inner) {
  const tabs = [['comps', L('Composiciones'), '#/tft'], ['tools', L('Asistente'), '#/tft/tools'], ['champs', L('Campeones'), '#/tft/champs'], ['items', L('Objetos'), '#/tft/items'], ['traits', L('Sinergias'), '#/tft/traits']];
  if (typeof toggleOverlay === 'function' && !window.LB_MOBILE_APP) tabs.push(['history', L('Historial'), '#/tft/history']);
  return `<div class="tft-top"><h1>TFT${T.st ? ` <span class="dim">· Set ${T.st.set}</span>` : ''}</h1>
    <div class="seg">${tabs.map(([k, l, h]) => `<button class="${k === active ? 'on' : ''}" onclick="go('${h}')">${l}</button>`).join('')}</div>
    ${typeof toggleOverlay === 'function' ? `<button class="btn" style="margin-left:auto" onclick="toggleOverlay()" title="${L('Ventana siempre visible encima del juego (TFT en modo sin bordes)')}">${L('Abrir / cerrar overlay')}</button>` : ''}</div>${inner}`;
}

async function renderTFT(t, parts) {
  const [sub, arg] = parts;
  view.innerHTML = tftShell(sub || 'comps', loadingHTML('Cargando datos de TFT…'));
  try { await tftLoadStatic(); } catch (e) { console.warn('static', e); }
  if (stale(t)) return;
  tftLoadStats().then(() => { if (!stale(t) && (sub === 'champs' || sub === 'items' || sub === 'traits' || sub === 'champ')) { /* re-render with stats */ } });
  if (!sub) return renderComps(t);
  if (sub === 'comp') return renderComp(t, arg);
  if (sub === 'champs') return renderTChamps(t);
  if (sub === 'champ') return renderTChamp(t, decodeURIComponent(arg || ''));
  if (sub === 'items') return renderTItems(t);
  if (sub === 'traits') return renderTTraits(t);
  if (sub === 'tools') return renderTTools(t);
  if (sub === 'history') return renderTHistory(t);
  return renderComps(t);
}

/* ---------- comps list ---------- */
const compState = { tier: 'ALL', q: '', sort: 'tier' };
async function renderComps(t) {
  const decks = await tftLoadComps();
  if (stale(t)) return;
  const tiers = ['ALL', 'OP', 'S', 'A', 'B', 'C', 'D'];
  view.innerHTML = tftShell('comps', `
    <div class="grid-tools">
      <div class="seg" id="ctier">${tiers.map(x => `<button data-t="${x}" class="${compState.tier === x ? 'on' : ''}">${x === 'ALL' ? L('Todas') : x}</button>`).join('')}</div>
      <input id="cq" placeholder="${L('Filtrar por campeón o sinergia…')}" value="${esc(compState.q)}">
      <select id="csort" class="sel"><option value="tier">${L('Orden: Tier')}</option><option value="top4">Top 4 %</option><option value="avg">${L('Posición promedio')}</option><option value="pick">${L('Popularidad')}</option></select>
      <span class="muted" style="margin-left:auto;font-size:12.5px">${L('{n} composiciones · OP.GG', { n: decks.length })}</span>
    </div>
    <div id="clist"></div>`);
  $('#csort').value = compState.sort;
  const draw = () => {
    const n = norm(compState.q);
    let list = decks.filter(d => compState.tier === 'ALL' || d.stat?.opTier === compState.tier || (compState.tier === 'C' && d.stat?.opTier === 'C'));
    if (n) list = list.filter(d => norm(deckName(d)).includes(n) || d.units.some(u => norm(unitInfo(u.key).name).includes(n)) || (d.traits || []).some(x => x.style > 0 && norm(traitInfo(x.key, x.meta?.name).name).includes(n)));
    const order = { OP: 0, S: 1, A: 2, B: 3, C: 4, D: 5 };
    const sd = d => d.stat?.deck || {};
    if (compState.sort === 'tier') list.sort((a, b) => (order[a.stat?.opTier] ?? 9) - (order[b.stat?.opTier] ?? 9) || (b.stat?.opScore || 0) - (a.stat?.opScore || 0));
    if (compState.sort === 'top4') list.sort((a, b) => (sd(b).top4Rate || 0) - (sd(a).top4Rate || 0));
    if (compState.sort === 'avg') list.sort((a, b) => (sd(a).avgPlacement || 9) - (sd(b).avgPlacement || 9));
    if (compState.sort === 'pick') list.sort((a, b) => (sd(b).pickRate || 0) - (sd(a).pickRate || 0));
    $('#clist').innerHTML = list.map(d => {
      const s = sd(d), diff = DIFF[badgeVal(d, 'difficulty')];
      const units = [...d.units].sort((a, b) => unitInfo(a.key).cost - unitInfo(b.key).cost);
      return `<div class="comp-row" data-id="${esc(d.id)}">
        <div class="ctier"><span class="tier big ${TIER_CLS(d.stat?.opTier)}">${esc(d.stat?.opTier || '?')}</span></div>
        <div class="cmain">
          <div class="cname">${esc(deckName(d))}${diff ? `<span class="diff ${diff[1]}">${diff[0]}</span>` : ''}${playStyle(d) ? `<span class="pill">${esc(playStyle(d))}</span>` : ''}${reqBadges(d)}</div>
          <div class="ctraits">${(d.traits || []).filter(x => x.style > 0).sort((a, b) => b.style - a.style).map(traitChip).join('')}</div>
          <div class="cunits">${units.map(u => tUnit(u.key, { stars: u.tier, items: u.items, carry: u.isCore, deck: d.id })).join('')}</div>
        </div>
        <div class="cstats">
          <div><b>${s.avgPlacement?.toFixed(2) ?? '—'}</b><span>${L('Prom.')}</span></div>
          <div><b class="${s.top4Rate >= .6 ? 'wr-good' : ''}">${pct(s.top4Rate)}</b><span>Top 4</span></div>
          <div><b>${pct(s.winRate)}</b><span>${L('Victoria')}</span></div>
          <div><b>${pct(s.pickRate, 2)}</b><span>${L('Uso')}</span></div>
        </div></div>`;
    }).join('') || `<div class="card muted">${L('No hay composiciones con ese filtro.')}</div>`;
  };
  $('#ctier').onclick = e => { const b = e.target.closest('button'); if (!b) return; compState.tier = b.dataset.t; $$('#ctier button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  $('#cq').oninput = e => { compState.q = e.target.value; draw(); };
  $('#csort').onchange = e => { compState.sort = e.target.value; draw(); };
  $('#clist').onclick = e => { if (e.target.closest('a')) return; const r = e.target.closest('.comp-row'); if (r) go('#/tft/comp/' + r.dataset.id); };
  draw();
}

function playStyle(d) {
  const r = badgeVal(d, 'reroll');
  const threes = d.units.filter(u => u.tier >= 3);
  if (threes.length && r && r <= 7) return L('Reroll nivel {n}', { n: r });
  if (r) return L('Rolear en nivel {n}', { n: r });
  return '';
}

/* ---------- hex board ---------- */
function board(units, { items = true, deck = '' } = {}) {
  // OP.GG cells: x 1..7, y 1..4 (y=4 is the front row). Front row is drawn on top.
  const W = 66, H = 58;
  const cells = [];
  for (let y = 4; y >= 1; y--) for (let x = 1; x <= 7; x++) cells.push({ x, y });
  const at = {};
  for (const u of units) if (u.cell) at[u.cell.x + ',' + u.cell.y] = u;
  const pos = ({ x, y }) => { const row = 4 - y; return { left: (x - 1) * W + (row % 2 ? W / 2 : 0), top: row * H }; };
  return `<div class="board" style="width:${7 * W + W / 2}px;height:${3 * H + W + 14}px">${cells.map(c => {
    const p = pos(c), u = at[c.x + ',' + c.y];
    if (!u) return `<div class="hex empty" style="left:${p.left}px;top:${p.top}px"></div>`;
    const key = u.key || u.characterId, info = unitInfo(key), its = (u.items || []).filter(Boolean);
    return `<a class="hex ${COST_CLS(info.cost)} ${u.isCore ? 'carry' : ''}" style="left:${p.left}px;top:${p.top}px" href="#/tft/champ/${encodeURIComponent(key)}" data-tip="${unitTip(key, deck)}">
      <span class="hexin"><img style="background:#1e222c url('${ph(info.name)}') center/cover" src="${info.icon || ph(info.name)}" data-fb="${info.fb}" alt="${esc(info.name)}"></span>
      ${u.tier > 1 ? `<span class="stars s${u.tier}">${'★'.repeat(u.tier)}</span>` : ''}
      ${items && its.length ? `<span class="hex-items">${its.map(i => tItemImg(i, 'ti xs')).join('')}</span>` : ''}</a>`;
  }).join('')}</div>`;
}

/* ---------- comp detail ---------- */
async function renderComp(t, id) {
  const decks = await tftLoadComps();
  if (stale(t)) return;
  const d = decks.find(x => x.id === id);
  if (!d) { view.innerHTML = tftShell('comps', errorBox('Composición no encontrada (puede que el meta haya cambiado).')); return; }
  const s = d.stat?.deck || {}, diff = DIFF[badgeVal(d, 'difficulty')];
  const stages = [];
  if (d.early?.units?.length) stages.push({ k: 'early', l: LANG === 'en' ? 'Early' : 'Inicio', lvl: d.early.level, units: d.early.units, traits: d.early.traits, st: d.early });
  if (d.middle?.units?.length) stages.push({ k: 'mid', l: L('Medio'), lvl: d.middle.level, units: d.middle.units, traits: d.middle.traits, st: d.middle });
  stages.push({ k: 'final', l: L('Final'), lvl: Math.max(d.units.length, 8), units: d.units, traits: d.traits, st: null });
  let cur = stages.length - 1;
  const keyOf = u => u.key || u.characterId;

  const carries = d.units.filter(u => u.isCore).sort((a, b) => (a.priority ?? 9) - (b.priority ?? 9));
  const holders = d.units.filter(u => !u.isCore && u.items?.length);
  const comps = {};
  for (const u of [...carries, ...holders]) for (const it of u.items) for (const c of itemInfo(it).comp) comps[c] = (comps[c] || 0) + 1;
  const compList = Object.entries(comps).sort((a, b) => b[1] - a[1]);

  const draw = () => {
    const sg = stages[cur], prev = stages[cur - 1];
    const keys = new Set(sg.units.map(keyOf)), pkeys = new Set((prev?.units || []).map(keyOf));
    const added = prev ? [...keys].filter(k => !pkeys.has(k)) : [];
    const removed = prev ? [...pkeys].filter(k => !keys.has(k)) : [];
    const roundWr = sg.st && (sg.st.win + sg.st.lose) ? sg.st.win / (sg.st.win + sg.st.lose) : null;
    $('#stageBody').innerHTML = `
      <div class="stage-grid">
        <div>${board(sg.units, { items: sg.k === 'final', deck: d.id })}
          ${roundWr != null ? `<p class="muted" style="font-size:12.5px;margin:10px 0 0">${L('Este tablero gana el <b class="{cls}">{wr}</b> de las rondas ({n} partidas).', { cls: roundWr >= .5 ? 'wr-good' : '', wr: pct(roundWr), n: fmt(sg.st.play) })}</p>` : ''}
        </div>
        <div class="stage-side">
          <h4>${L('Sinergias activas')}</h4>
          <div class="ctraits">${(sg.traits || []).filter(x => x.style > 0).sort((a, b) => b.style - a.style).map(traitChip).join('') || '<span class="muted">—</span>'}</div>
          ${prev ? `<h4>${L('Qué cambiar desde «{s}»', { s: prev.l })}</h4>
            ${added.length ? `<div class="chg add"><span>${L('Agregar')}</span><div>${added.map(k => tUnit(k, { name: true, deck: d.id })).join('')}</div></div>` : ''}
            ${removed.length ? `<div class="chg rem"><span>${L('Quitar')}</span><div>${removed.map(k => tUnit(k, { name: true })).join('')}</div></div>` : ''}
            ${!added.length && !removed.length ? `<p class="muted">${L('Mismas unidades; mejora estrellas y posiciones.')}</p>` : ''}` : `<h4>${L('Unidades')}</h4><div class="cunits">${sg.units.map(u => tUnit(keyOf(u))).join('')}</div>`}
        </div>
      </div>`;
    $$('#stageTabs button').forEach((b, i) => b.classList.toggle('on', i === cur));
  };

  view.innerHTML = tftShell('comps', `
    <div class="comp-head card">
      <span class="tier big ${TIER_CLS(d.stat?.opTier)}">${esc(d.stat?.opTier || '?')}</span>
      <div style="flex:1;min-width:0">
        <h2>${esc(deckName(d))}</h2>
        <div class="row-chips">${diff ? `<span class="diff ${diff[1]}">${L('Dificultad: {d}', { d: diff[0] })}</span>` : ''}${playStyle(d) ? `<span class="pill">${esc(playStyle(d))}</span>` : ''}${d.cost ? `<span class="pill">${L('Costo total {n} de oro', { n: d.cost })}</span>` : ''}${reqBadges(d)}</div>
      </div>
      <div class="cstats">
        <div><b>${s.avgPlacement?.toFixed(2) ?? '—'}</b><span>${L('Prom.')}</span></div>
        <div><b>${pct(s.top4Rate)}</b><span>Top 4</span></div>
        <div><b>${pct(s.winRate)}</b><span>${L('Victoria')}</span></div>
        <div><b>${fmt(s.compsCount)}</b><span>${L('Partidas')}</span></div>
      </div>
      ${d.teamCode ? `<button class="btn" id="copyCode" title="${L('Pégalo en el Planificador de equipo dentro de TFT')}">${L('Copiar código de equipo')}</button>` : ''}
    </div>
    <div class="card" style="margin-bottom:14px">
      <h3>${L('Tableros por etapa')} <small>${L('posicionamiento recomendado')}</small></h3>
      ${d._boardsFrom || d._autoPos ? `<p class="fine" style="margin:-4px 0 12px">${L('OP.GG no publica tableros para esta compo: ')}${d._boardsFrom ? L('inicio y medio tomados de la compo similar «{name}»', { name: esc(d._boardsFrom) }) : ''}${d._boardsFrom && d._autoPos ? '; ' : ''}${d._autoPos ? L('la posición final es aproximada (tanques adelante, carries atrás)') : ''}.</p>` : ''}
      <div class="seg" id="stageTabs" style="margin-bottom:14px">${stages.map((g, i) => `<button data-i="${i}">${g.l} · ${L('Nivel')} ${g.lvl}</button>`).join('')}</div>
      <div id="stageBody"></div>
    </div>
    <div class="card" style="margin-bottom:14px"><h3>${L('Aumentos recomendados')}</h3><div id="augBox">${augSection(d)}</div></div>
    <div class="two">
      <div class="card"><h3>${L('Carries y objetos')}</h3>
        ${carries.map((u, i) => `<div class="carry-row"><span class="prio">${i + 1}</span>${tUnit(u.key, { stars: u.tier, name: true, deck: d.id })}<div class="its">${u.items.map(it => `${tItemImg(it, 'ti')}`).join('')}</div>
          <div class="alt">${bisFor(u.key, u.items).map(it => tItemImg(it, 'ti sm')).join('')}</div></div>`).join('')}
        ${holders.map(u => `<div class="carry-row tank"><span class="prio">·</span>${tUnit(u.key, { stars: u.tier, name: true, deck: d.id })}<div class="its">${u.items.map(it => tItemImg(it, 'ti')).join('')}</div><div class="alt"></div></div>`).join('')}
        ${compList.length ? `<h4 class="sub">${L('Componentes a priorizar')}</h4><div class="comp-needed">${compList.map(([c, n]) => `<span>${tItemImg(c, 'ti sm')}<b>×${n}</b></span>`).join('')}</div>` : ''}
        <p class="fine">${L('A la derecha: alternativas con mejores resultados según MetaTFT.')}</p>
      </div>
      <div class="card"><h3>${L('Cómo jugarla')}</h3>${gamePlan(d, stages, carries, compList)}</div>
    </div>`);
  $('#stageTabs').onclick = e => { const b = e.target.closest('button'); if (b) { cur = +b.dataset.i; draw(); } };
  $('#copyCode')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(d.teamCode); toast('Código copiado: pégalo en el Planificador de equipo de TFT ✔'); }
    catch { prompt(L('Copia este código:'), d.teamCode); }
  });
  draw();
  tftLoadAugs().then(() => { if (!stale(t) && $('#augBox')) $('#augBox').innerHTML = augSection(d); }).catch(() => { if (!stale(t) && $('#augBox')) $('#augBox').innerHTML = `<p class="muted">${L('No se pudieron cargar los aumentos.')}</p>`; });
  tftLoadStats().then(() => { if (stale(t)) return; $$('.carry-row .alt').forEach((el, i) => { const u = carries[i]; if (u) el.innerHTML = bisFor(u.key, u.items).map(it => tItemImg(it, 'ti sm')).join(''); }); });
}

function bisFor(key, exclude = []) {
  const list = T.uip?.units?.[key]?.items?.map(x => x.itemName) || [];
  return list.filter(x => !exclude.includes(x)).slice(0, 3);
}

function gamePlan(d, stages, carries, compList) {
  const name = k => esc(unitInfo(k).name);
  const keyOf = u => u.key || u.characterId;
  const early = stages.find(s => s.k === 'early'), mid = stages.find(s => s.k === 'mid'), fin = stages.at(-1);
  const r = badgeVal(d, 'reroll');
  const threes = d.units.filter(u => u.tier >= 3).map(u => u.key);
  const bigCarries = carries.filter(u => unitInfo(u.key).cost >= 4).map(u => u.key);
  const active = trs => (trs || []).filter(x => x.style > 0).sort((a, b) => b.style - a.style).slice(0, 3).map(x => `${esc(traitInfo(x.key, x.meta?.name).name)} ${x.numUnits}`).join(', ');
  const steps = [];
  const lst = arr => arr.join(', ');
  for (const q of d.requirements || []) steps.push([L('Requisito'), reqIsAug(q)
    ? L('Esta compo solo es buena si te sale el aumento <b>{name}</b>. Juégala cuando te lo ofrezcan; si no aparece, elige otra compo.', { name: esc(reqName(q)) })
    : L('Necesita <b>{name}</b> para ser buena. Búscalo en el carrusel, en los aumentos o en los monstruos; sin él, cambia a otra compo.', { name: esc(reqName(q)) })]);
  if (early) steps.push([L('Etapa 2 · Inicio'), L('Juega <b>{units}</b> (nivel {lvl}){traits}. {comps}Si te llegan los objetos del carry, póntelos a la unidad más fuerte del tablero y pásalos luego.', {
    units: lst(early.units.map(u => name(keyOf(u)))), lvl: early.lvl,
    traits: active(early.traits) ? L(', activando {t}', { t: active(early.traits) }) : '',
    comps: compList.length ? L('Busca en el carrusel y en los monstruos estos componentes: <b>{c}</b>. ', { c: lst(compList.slice(0, 4).map(([c]) => esc(itemInfo(c).name))) }) : '',
  })]);
  if (mid) {
    const pk = new Set((early?.units || []).map(keyOf));
    const add = mid.units.map(keyOf).filter(k => !pk.has(k));
    steps.push([L('Etapa 3 · Medio'), L('Sube a nivel {lvl} y transiciona{add}{goal}. Mantén la economía por encima de 30–50 de oro si tu vida lo permite.', {
      lvl: mid.lvl, add: add.length ? L(' agregando <b>{u}</b>', { u: lst(add.map(name)) }) : '',
      goal: active(mid.traits) ? L('. Objetivo: {t}', { t: active(mid.traits) }) : '',
    })]);
  }
  if (threes.length && r && r <= 7) steps.push([L('Etapa 3–4 · Reroll'), L('Quédate en nivel {r} y rolea poco a poco (por encima de 50 de oro) hasta conseguir <b>{u}</b> a 3★. Después sube de nivel para completar el tablero.', { r, u: lst(threes.map(name)) })]);
  else if (r) steps.push([L('Etapa 4 · Roll down'), L('Sube a nivel {r} en 4-1 o 4-2 y rolea para encontrar {who} a 2★.{keep}', {
    r, who: bigCarries.length ? `<b>${lst(bigCarries.map(name))}</b>` : L('tus carries principales'),
    keep: threes.length ? L(' Mantén las copias para tener <b>{u}</b> a 3★.', { u: lst(threes.map(name)) }) : '',
  })]);
  steps.push([L('Final'), L('Tablero completo ({n} unidades): <b>{t}</b>. {carries}Revisa la pestaña «Final» para el posicionamiento exacto: tanques al frente, carries atrás.', {
    n: fin.units.length, t: active(fin.traits) || '—',
    carries: carries.length ? L('Carries en orden de prioridad: {c}. ', { c: carries.map(u => name(u.key)).join(' › ') }) : '',
  })]);
  const diff = badgeVal(d, 'difficulty');
  if (diff === 3) steps.push([L('Consejo'), L('Composición difícil: necesita conseguir unidades caras o mucha precisión con objetos. Si en la etapa 3 no tienes los componentes, cambia a una alternativa.')]);
  if (diff === 1) steps.push([L('Consejo'), L('Composición fácil de ejecutar: buena para subir de forma estable.')]);
  return `<ol class="plan">${steps.map(([h, p]) => `<li><b>${h}</b><p>${p}</p></li>`).join('')}</ol>`;
}

/* ---------- champions ---------- */
let tChampSort = 'cost';
async function renderTChamps(t) {
  await tftLoadStats().catch(() => { });
  if (stale(t)) return;
  const champs = T.st?.champions || [];
  if (!champs.length) { view.innerHTML = tftShell('champs', errorBox('No se pudieron cargar los campeones de TFT.')); return; }
  view.innerHTML = tftShell('champs', `<div class="grid-tools"><input id="tcq" placeholder="${L('Buscar campeón…')}">
    <div class="seg" id="tcs"><button data-s="cost" class="${tChampSort === 'cost' ? 'on' : ''}">${L('Por costo')}</button><button data-s="avg" class="${tChampSort === 'avg' ? 'on' : ''}">${L('Mejores (prom.)')}</button></div></div><div id="tcgrid"></div>`);
  let q = '';
  const draw = () => {
    const n = norm(q);
    const list = champs.filter(c => !n || norm(c.name).includes(n) || c.traits.some(x => norm(x).includes(n)));
    const st = k => T.stats?.units?.[k];
    if (tChampSort === 'avg') {
      const sorted = [...list].filter(c => st(c.apiName)).sort((a, b) => st(a.apiName).avg - st(b.apiName).avg);
      $('#tcgrid').innerHTML = `<div class="tc-grid">${sorted.map(c => champCard(c)).join('')}</div>`;
    } else {
      $('#tcgrid').innerHTML = [1, 2, 3, 4, 5, 6, 7].map(cost => { const g = list.filter(c => c.cost === cost); return g.length ? `<h3 class="cost-h ${COST_CLS(cost)}">${L('Costo {n}', { n: cost })}</h3><div class="tc-grid">${g.map(c => champCard(c)).join('')}</div>` : ''; }).join('');
    }
  };
  $('#tcq').oninput = e => { q = e.target.value; draw(); };
  $('#tcs').onclick = e => { const b = e.target.closest('button'); if (!b) return; tChampSort = b.dataset.s; $$('#tcs button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  draw();
}
function champCard(c) {
  const st = T.stats?.units?.[c.apiName];
  const bis = (T.uip?.units?.[c.apiName]?.items || []).slice(0, 3).map(x => x.itemName);
  return `<a class="tc-card" href="#/tft/champ/${encodeURIComponent(c.apiName)}">${tUnitImg(c.apiName)}<div class="tc-t"><b>${esc(c.name)}</b><small>${esc(c.traits.join(' · '))}</small>
    ${st ? `<small>${L('Prom.')} <b class="${st.avg < 4.3 ? 'wr-good' : st.avg > 4.6 ? 'wr-bad' : ''}">${st.avg.toFixed(2)}</b> · Top 4 ${pct(st.top4, 0)}</small>` : ''}</div>
    <div class="tc-bis">${bis.map(i => tItemImg(i, 'ti xs')).join('')}</div></a>`;
}

async function renderTChamp(t, key) {
  await Promise.all([tftLoadStats().catch(() => { }), tftLoadComps().catch(() => { })]);
  if (stale(t)) return;
  const c = T.champ[key], u = unitInfo(key), st = T.stats?.units?.[key];
  const bisAll = (T.uip?.units?.[key]?.items || []).map(x => x.itemName);
  const decks = (T.comps || []).filter(d => d.units.some(x => x.key === key)).sort((a, b) => {
    const ca = a.units.find(x => x.key === key)?.isCore ? 0 : 1, cb = b.units.find(x => x.key === key)?.isCore ? 0 : 1;
    return ca - cb || (a.stat?.deck?.avgPlacement || 9) - (b.stat?.deck?.avgPlacement || 9);
  });
  // items players actually put on this unit in meta comps
  const counts = {};
  for (const d of decks) for (const x of d.units) if (x.key === key) for (const it of x.items) counts[it] = (counts[it] || 0) + 1;
  const deckItems = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const traitKeys = (c?.traits || []).map(n => T.traitByName[n]?.apiName).filter(Boolean);
  view.innerHTML = tftShell('champs', `
    <div class="comp-head card">
      <img class="tu-img big ${COST_CLS(u.cost)}" src="${u.icon || ph(u.name)}" data-fb="${u.fb}" alt="">
      <div style="flex:1"><h2>${esc(u.name)} <span class="pill">${L('Costo {n}', { n: u.cost })}</span></h2>
        <div class="ctraits">${traitKeys.map(k => traitChip({ key: k, style: 1, numUnits: 0 })).join('')}</div></div>
      ${st ? `<div class="cstats"><div><b>${st.avg.toFixed(2)}</b><span>${L('Prom.')}</span></div><div><b>${pct(st.top4)}</b><span>Top 4</span></div><div><b>${pct(st.win)}</b><span>${L('Victoria')}</span></div><div><b>${fmt(st.games)}</b><span>${L('Partidas')}</span></div></div>` : ''}
    </div>
    <div class="two">
      <div class="stack">
        <div class="card"><h3>${L('Objetos ideales (BIS)')}</h3>
          ${bisAll.length ? `<div class="bis-main">${bisAll.slice(0, 3).map(i => `<div>${tItemImg(i, 'ti lg')}<span>${esc(itemInfo(i).name)}</span></div>`).join('')}</div>
          <h4 class="sub">${L('Alternativas')}</h4><div class="situ">${bisAll.slice(3, 10).map(i => tItemImg(i, 'ti')).join('')}</div>` : deckItems.length ? `<div class="bis-main">${deckItems.slice(0, 3).map(i => `<div>${tItemImg(i, 'ti lg')}<span>${esc(itemInfo(i).name)}</span></div>`).join('')}</div>` : '<p class="muted">Sin datos de objetos para esta unidad.</p>'}
          ${deckItems.length && bisAll.length ? `<h4 class="sub">${L('Usados en composiciones meta')}</h4><div class="situ">${deckItems.slice(0, 8).map(i => tItemImg(i, 'ti')).join('')}</div>` : ''}
        </div>
        ${c?.ability ? `<div class="card"><h3>${esc(c.ability.name)} <small>${L('habilidad')}</small></h3><p class="abil-desc">${tftDesc(c.ability.desc, c.ability.vars)}</p></div>` : ''}
      </div>
      <div class="card"><h3>${L('Composiciones con {name}', { name: esc(u.name) })}</h3>
        ${decks.slice(0, 8).map(d => `<a class="mini-comp" href="#/tft/comp/${esc(d.id)}"><span class="tier ${TIER_CLS(d.stat?.opTier)}">${esc(d.stat?.opTier)}</span><span class="nm">${esc(deckName(d))}${d.units.find(x => x.key === key)?.isCore ? ' <span class="pill">Carry</span>' : ''}</span><span class="muted">${d.stat?.deck?.avgPlacement?.toFixed(2) ?? ''}</span></a>`).join('') || `<p class="muted">${L('No aparece en las composiciones meta actuales.')}</p>`}
      </div>
    </div>`);
}

/* ---------- items ---------- */
let tItemTab = 'combined', tItemSort = 'avg';
async function renderTItems(t) {
  await tftLoadStats().catch(() => { });
  if (stale(t)) return;
  const all = T.st?.items || [];
  const isComponent = i => /component/i.test(i.apiName) || (i.tags || []).includes('component');
  const comps = all.filter(i => isComponent(i) && !/tutorial/i.test(i.apiName));
  const groups = {
    combined: all.filter(i => i.composition?.length === 2 && !/emblem/i.test(i.apiName)),
    emblems: all.filter(i => /emblem/i.test(i.apiName)),
    other: all.filter(i => !isComponent(i) && !(i.composition?.length) && !/emblem/i.test(i.apiName) && T.stats?.items?.[i.apiName]),
  };
  const users = k => (T.uip?.itemNames?.[k]?.units || []).slice(0, 4).map(x => x.unit);
  view.innerHTML = tftShell('items', `
    <div class="grid-tools"><div class="seg" id="titab">${[['combined', L('Combinados')], ['emblems', L('Emblemas')], ['other', L('Artefactos y otros')], ['recipes', L('Recetas')]].map(([k, l]) => `<button data-k="${k}" class="${tItemTab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <span class="muted" style="font-size:12.5px">${L('Posición promedio y Top 4 de los últimos 3 días (MetaTFT)')}</span></div><div id="tibody"></div>`);
  const draw = () => {
    if (tItemTab === 'recipes') {
      const base = comps.filter(c => all.some(i => i.composition?.includes(c.apiName))).slice(0, 10);
      const find = (a, b) => all.find(i => i.composition?.length === 2 && ((i.composition[0] === a && i.composition[1] === b) || (i.composition[0] === b && i.composition[1] === a)));
      $('#tibody').innerHTML = `<div class="card" style="overflow:auto"><table class="recipes"><tr><th></th>${base.map(c => `<th>${tItemImg(c.apiName, 'ti sm')}</th>`).join('')}</tr>
        ${base.map(r => `<tr><th>${tItemImg(r.apiName, 'ti sm')}</th>${base.map(c => { const it = find(r.apiName, c.apiName); return `<td>${it ? tItemImg(it.apiName, 'ti sm') : ''}</td>`; }).join('')}</tr>`).join('')}</table></div>`;
      return;
    }
    const st = k => T.stats?.items?.[k];
    let list = [...groups[tItemTab]];
    if (tItemSort === 'avg') list.sort((a, b) => (st(a.apiName)?.avg ?? 9) - (st(b.apiName)?.avg ?? 9));
    if (tItemSort === 'top4') list.sort((a, b) => (st(b.apiName)?.top4 ?? 0) - (st(a.apiName)?.top4 ?? 0));
    if (tItemSort === 'games') list.sort((a, b) => (st(b.apiName)?.games ?? 0) - (st(a.apiName)?.games ?? 0));
    const grade = (s, i, n) => !s ? '' : i < n * 0.15 ? 'S' : i < n * 0.4 ? 'A' : i < n * 0.7 ? 'B' : 'C';
    const ranked = [...list].filter(i => st(i.apiName)).sort((a, b) => st(a.apiName).avg - st(b.apiName).avg);
    const rankOf = k => ranked.findIndex(i => i.apiName === k);
    $('#tibody').innerHTML = `<table class="tl"><thead><tr><th>${L('Objeto')}</th><th>Tier</th>${tItemTab === 'combined' ? `<th>${L('Receta')}</th>` : ''}
      <th class="num" data-s="avg">${L('Prom.')} ${tItemSort === 'avg' ? '▲' : ''}</th><th class="num" data-s="top4">Top 4 ${tItemSort === 'top4' ? '▼' : ''}</th><th class="num" data-s="games">${L('Partidas')} ${tItemSort === 'games' ? '▼' : ''}</th><th>${L('Mejor en')}</th></tr></thead>
      <tbody>${list.map(i => { const s = st(i.apiName), g = grade(s, rankOf(i.apiName), ranked.length); return `<tr class="norow">
        <td><div class="champ-cell">${tItemImg(i.apiName, 'ti')}${esc(i.name)}</div></td>
        <td>${g ? `<span class="tier t-${g}">${g}</span>` : ''}</td>
        ${tItemTab === 'combined' ? `<td><div class="counters">${i.composition.map(c => tItemImg(c, 'ti xs')).join('<span class="dim">+</span>')}</div></td>` : ''}
        <td class="num"><b>${s ? s.avg.toFixed(2) : '—'}</b></td><td class="num">${s ? pct(s.top4) : '—'}</td><td class="num muted">${s ? fmt(s.games) : '—'}</td>
        <td><div class="counters">${users(i.apiName).map(k => tUnitImg(k, 'xs')).join('')}</div></td></tr>`; }).join('')}</tbody></table>`;
  };
  $('#titab').onclick = e => { const b = e.target.closest('button'); if (!b) return; tItemTab = b.dataset.k; $$('#titab button').forEach(x => x.classList.toggle('on', x === b)); draw(); };
  $('#tibody').onclick = e => { const th = e.target.closest('th[data-s]'); if (th) { tItemSort = th.dataset.s; draw(); } };
  draw();
}

/* ---------- traits ---------- */
async function renderTTraits(t) {
  await tftLoadStats().catch(() => { });
  if (stale(t)) return;
  const traits = (T.st?.traits || []).filter(x => x.effects?.length);
  const champsOf = tr => (T.st?.champions || []).filter(c => c.traits.includes(tr.name));
  const best = tr => Math.min(...tr.effects.map((_, i) => T.stats?.traits?.[`${tr.apiName}_${i + 1}`]?.avg ?? 9));
  const list = [...traits].sort((a, b) => best(a) - best(b));
  view.innerHTML = tftShell('traits', `<div class="trait-list">${list.map(tr => {
    const ch = champsOf(tr);
    return `<div class="card trait-card"><div class="tr-head"><img src="${tr.icon}" alt=""><div><b>${esc(tr.name)}</b><div class="bps">${tr.effects.map((e, i) => { const s = T.stats?.traits?.[`${tr.apiName}_${i + 1}`]; return `<span class="bp ${STYLE_CLS[Math.min(e.style, 5)] || 'bronze'}" data-tip="text:${encodeURIComponent(s ? `${L('{n} unidades', { n: e.minUnits })}: ${L('prom.')} ${s.avg.toFixed(2)} · Top 4 ${pct(s.top4)}` : L('{n} unidades', { n: e.minUnits }))}">${e.minUnits}${s ? `<small>${s.avg.toFixed(2)}</small>` : ''}</span>`; }).join('')}</div></div></div>
      <p class="tr-desc">${traitDesc(tr)}</p>
      <div class="cunits">${ch.map(c => tUnit(c.apiName)).join('')}</div></div>`;
  }).join('')}</div>`);
}
