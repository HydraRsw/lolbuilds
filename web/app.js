'use strict';
/* LoL Builds — UI. Data: OP.GG stats API, Riot Data Dragon, CommunityDragon.
   All network JSON goes through the local Go proxy (/p?u=...) which caches it. */

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const stripTags = s => String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/\n{2,}/g, '\n').trim();
const pct = (x, d = 1) => (x == null || isNaN(x)) ? '—' : (x * 100).toFixed(d) + '%';
const fmt = n => n == null ? '—' : Number(n).toLocaleString('es');
const wrClass = wr => wr >= 0.515 ? 'wr-good' : wr < 0.485 ? 'wr-bad' : '';

/* ---------------- settings ---------------- */
const REGIONS = [['global', 'Global (todas)'], ['kr', 'Corea'], ['euw', 'EU Oeste'], ['na', 'Norteamérica'], ['lan', 'LAN'], ['las', 'LAS'], ['br', 'Brasil'], ['eune', 'EU Nórdica/Este'], ['jp', 'Japón'], ['oce', 'Oceanía'], ['tr', 'Turquía'], ['vn', 'Vietnam']];
const TIERS = [['all', 'Todos'], ['gold_plus', 'Oro+'], ['platinum_plus', 'Platino+'], ['emerald_plus', 'Esmeralda+'], ['diamond_plus', 'Diamante+'], ['master_plus', 'Maestro+'], ['challenger', 'Retador']];
const settings = Object.assign({ region: 'global', tier: 'emerald_plus', autoOpen: true, autoRunes: false, autoItems: true, autoSpells: false },
  (() => { try { return JSON.parse(localStorage.getItem('lb.settings') || '{}'); } catch { return {}; } })());
const saveSettings = () => { try { localStorage.setItem('lb.settings', JSON.stringify(settings)); } catch { } };

/* ---------------- data access ---------------- */
const S = { freshUntil: 0, v: null, champs: {}, byKey: {}, items: {}, cdItems: null, runes: [], perkById: {}, styleById: {}, perksCD: {}, spells: {}, aug: null, lists: {}, details: {}, meta: {} };
const memo = new Map();

async function api(url, opts = {}) {
  if (Date.now() < S.freshUntil) opts = { ...opts, fresh: true };
  if (!opts.fresh && memo.has(url)) return memo.get(url);
  const p = fetch('/p?u=' + encodeURIComponent(url) + (opts.fresh ? '&fresh=1' : '')).then(async r => {
    const txt = await r.text();
    let j; try { j = JSON.parse(txt); } catch { throw new Error('Respuesta inválida'); }
    if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
    return j;
  });
  memo.set(url, p);
  p.catch(() => memo.delete(url));
  return p;
}
const OPGG = 'https://lol-api-champion.op.gg/api/';
const DD = () => `https://ddragon.leagueoflegends.com/cdn/${S.v}`;
const CD = 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/';
const cdAsset = p => p ? CD + 'default/' + p.replace(/^\/lol-game-data\/assets\//i, '').toLowerCase() : '';

const img = {
  champ: c => `${DD()}/img/champion/${c.image.full}`,
  splash: c => `https://ddragon.leagueoflegends.com/cdn/img/champion/splash/${c.id}_0.jpg`,
  item: id => S.items[id] ? `${DD()}/img/item/${id}.png` : (S.cdItems?.[id] ? cdAsset(S.cdItems[id].iconPath) : `${DD()}/img/item/${id}.png`),
  rune: icon => `https://ddragon.leagueoflegends.com/cdn/img/${icon}`,
  spell: s => `${DD()}/img/spell/${s.image.full}`,
  passive: p => `${DD()}/img/passive/${p.image.full}`,
  role: r => `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-${r}.png`,
};

const ROLES = [
  { op: 'TOP', name: 'Superior', ic: 'top', lcu: 'top' },
  { op: 'JUNGLE', name: 'Jungla', ic: 'jungle', lcu: 'jungle' },
  { op: 'MID', name: 'Central', ic: 'middle', lcu: 'middle' },
  { op: 'ADC', name: 'Tirador', ic: 'bottom', lcu: 'bottom' },
  { op: 'SUPPORT', name: 'Soporte', ic: 'utility', lcu: 'utility' },
];
const roleOf = op => ROLES.find(r => r.op === op) || ROLES[0];
const TIER_LBL = { 0: 'OP', 1: 'S', 2: 'A', 3: 'B', 4: 'C', 5: 'D' };
const tierBadge = t => t == null ? '' : `<span class="tier t-${TIER_LBL[t] ?? 'C'}">${TIER_LBL[t] ?? t}</span>`;
const MODES = { ranked: 'Clasificatoria', aram: 'ARAM Mayhem', arena: 'Arena' };

const SHARD_FALLBACK = { 5008: 'Fuerza adaptable', 5005: 'Velocidad de ataque', 5007: 'Aceleración de habilidades', 5010: 'Velocidad de movimiento', 5001: 'Vida escalable', 5011: 'Vida', 5013: 'Tenacidad y resist. a ralentización', 5002: 'Armadura', 5003: 'Resistencia mágica' };

async function loadStatic(fresh = false) {
  const versions = await api('https://ddragon.leagueoflegends.com/api/versions.json', { fresh });
  S.v = versions[0];
  const [champ, items, runes, spells] = await Promise.all([
    api(`${DD()}/data/es_MX/champion.json`),
    api(`${DD()}/data/es_MX/item.json`),
    api(`${DD()}/data/es_MX/runesReforged.json`),
    api(`${DD()}/data/es_MX/summoner.json`),
  ]);
  for (const c of Object.values(champ.data)) { S.champs[c.id] = c; S.byKey[+c.key] = c; }
  S.items = items.data;
  S.runes = runes;
  for (const st of runes) { S.styleById[st.id] = st; for (const sl of st.slots) for (const r of sl.runes) S.perkById[r.id] = r; }
  for (const s of Object.values(spells.data)) S.spells[+s.key] = s;
  $('#patchLabel').textContent = 'Parche ' + S.v.split('.').slice(0, 2).join('.');
  let last = null; try { last = localStorage.getItem('lb.patch'); localStorage.setItem('lb.patch', S.v); } catch { }
  if (last && last !== S.v) {
    S.freshUntil = Date.now() + 20000; // new patch: skip cached stats from the previous one
    setTimeout(() => toast(`¡Nuevo parche ${S.v.split('.').slice(0, 2).join('.')}! Builds, runas y tier list actualizadas.`), 1200);
  }
  // non-critical extras
  api(CD + 'es_mx/v1/perks.json').then(list => { for (const p of list) S.perksCD[p.id] = p; }).catch(() => { });
  api(CD + 'es_mx/v1/items.json').then(list => { S.cdItems = {}; for (const i of list) S.cdItems[i.id] = i; }).catch(() => { });
}

async function loadAugments() {
  if (S.aug) return S.aug;
  S.aug = {};
  try {
    const list = await api(CD + 'es_mx/v1/cherry-augments.json');
    for (const a of list) S.aug[a.id] = a;
  } catch { }
  return S.aug;
}

async function opggWithFallback(pathFor) {
  const tried = [...new Set([settings.region, 'global', 'kr'])];
  let err;
  for (const reg of tried) {
    try { return await api(OPGG + pathFor(reg)); } catch (e) { err = e; }
  }
  throw err;
}

async function getList(mode) {
  const k = mode + '|' + settings.region + '|' + settings.tier;
  if (S.lists[k]) return S.lists[k];
  const q = mode === 'ranked' ? `?tier=${settings.tier}` : '';
  const j = await opggWithFallback(r => `${r}/champions/${mode}${q}`);
  S.meta[mode] = j.meta || {};
  return (S.lists[k] = j.data || []);
}

async function getDetail(id, mode, pos) {
  if (mode === 'ranked') return opggWithFallback(r => `${r}/champions/ranked/${id}/${pos}?tier=${settings.tier}`);
  if (mode === 'aram') return opggWithFallback(r => `${r}/champions/aram/${id}/none`);
  try { return await opggWithFallback(r => `${r}/champions/arena/${id}/none`); }
  catch { return opggWithFallback(r => `${r}/champions/arena/${id}`); }
}

async function getChampFull(c) {
  try { const j = await api(`${DD()}/data/es_MX/champion/${c.id}.json`); return j.data[c.id]; } catch { return null; }
}

/* ---------------- small UI helpers ---------------- */
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

function itemImg(id, cls = 'ic') {
  const it = S.items[id] || S.cdItems?.[id];
  const name = it?.name || ('Objeto ' + id);
  return `<img class="${cls}" src="${img.item(id)}" alt="${esc(name)}" loading="lazy" data-tip="item:${id}">`;
}
function champImg(c, cls = 'ic') {
  if (!c) return `<img class="${cls}" src="${ph('?')}" alt="?">`;
  return `<img class="${cls}" src="${img.champ(c)}" alt="${esc(c.name)}" loading="lazy">`;
}

let toastT;
function toast(msg, err = false) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastT); toastT = setTimeout(() => t.className = 'toast' + (err ? ' err' : ''), 3200);
}

/* tooltip */
const tip = $('#tooltip');
function tipHTML(key) {
  const [kind, id] = key.split(':');
  if (kind === 'item') {
    const it = S.items[id];
    if (it) return `<b>${esc(it.name)}</b><span class="g">${it.gold?.total ? it.gold.total + ' de oro' : ''}</span><p>${esc(stripTags(it.description)).slice(0, 520).replace(/\n/g, '<br>')}</p>`;
    const c = S.cdItems?.[id];
    return c ? `<b>${esc(c.name)}</b><p>${esc(stripTags(c.description)).slice(0, 400)}</p>` : `<b>Objeto ${esc(id)}</b>`;
  }
  if (kind === 'rune') {
    const r = S.perkById[id];
    if (r) return `<b>${esc(r.name)}</b><p>${esc(stripTags(r.shortDesc || r.longDesc)).replace(/\n/g, '<br>')}</p>`;
    const c = S.perksCD[id];
    return `<b>${esc(c?.name || SHARD_FALLBACK[id] || 'Runa')}</b>${c ? `<p>${esc(stripTags(c.shortDesc))}</p>` : ''}`;
  }
  if (kind === 'spell') {
    const s = S.spells[id];
    return s ? `<b>${esc(s.name)}</b><p>${esc(stripTags(s.description))}</p>` : '';
  }
  if (kind === 'abil') {
    const a = tipStore[id];
    return a ? `<b>${esc(a.name)}</b><p>${esc(stripTags(a.description)).slice(0, 520)}</p>` : '';
  }
  if (kind === 'text') return esc(decodeURIComponent(id));
  if (kind.startsWith('tft-') && typeof tftTip === 'function') return tftTip(kind.slice(4), decodeURIComponent(id));
  return '';
}
const tipStore = {};
document.addEventListener('mouseover', e => {
  const t = e.target.closest('[data-tip]');
  if (!t) { tip.classList.remove('show'); return; }
  const h = tipHTML(t.dataset.tip);
  if (!h) return;
  tip.innerHTML = h; tip.classList.add('show');
});
document.addEventListener('mousemove', e => {
  if (!tip.classList.contains('show')) return;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + 16, y = e.clientY + 16;
  if (x + w > innerWidth - 8) x = e.clientX - w - 12;
  if (y + h > innerHeight - 8) y = e.clientY - h - 12;
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});

/* ---------------- search ---------------- */
const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function searchChamps(q) {
  const n = norm(q);
  if (!n) return [];
  const list = Object.values(S.champs);
  return list.filter(c => norm(c.name).includes(n) || norm(c.id).includes(n))
    .sort((a, b) => (norm(b.name).startsWith(n) - norm(a.name).startsWith(n)) || a.name.localeCompare(b.name)).slice(0, 8);
}
function attachSearch(input, box) {
  let sel = 0, res = [];
  const draw = () => {
    res = searchChamps(input.value);
    box.innerHTML = res.map((c, i) => `<a class="${i === sel ? 'sel' : ''}" data-id="${c.key}">${champImg(c)}<span>${esc(c.name)}</span><small>${esc(c.title)}</small></a>`).join('');
    box.classList.toggle('open', res.length > 0);
  };
  input.addEventListener('input', () => { sel = 0; draw(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, res.length - 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && res[sel]) { go(`#/champ/${res[sel].key}`); input.value = ''; draw(); input.blur(); }
    else if (e.key === 'Escape') { input.value = ''; draw(); input.blur(); }
  });
  box.addEventListener('mousedown', e => {
    const a = e.target.closest('a[data-id]'); if (!a) return;
    e.preventDefault(); go(`#/champ/${a.dataset.id}`); input.value = ''; draw(); input.blur();
  });
  input.addEventListener('blur', () => setTimeout(() => box.classList.remove('open'), 120));
  input.addEventListener('focus', draw);
}
document.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('#searchInput').focus(); }
});

/* ---------------- router ---------------- */
const view = $('#view');
const go = h => { if (location.hash === h) route(); else location.hash = h; };
let routeToken = 0;
async function route() {
  if (upd.reloadOnNav && !['ChampSelect', 'InProgress'].includes(lcuState.phase)) { location.reload(); return; }
  const token = ++routeToken;
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  const [p0, p1, p2, p3] = parts;
  $$('#mainNav a').forEach(a => a.classList.remove('active'));
  const nav = !p0 ? 'home' : p0 === 'tier' ? 'tier-' + (p1 || 'ranked') : p0;
  $(`#mainNav a[data-nav="${nav}"]`)?.classList.add('active');
  tip.classList.remove('show');
  window.scrollTo(0, 0);
  try {
    if (!p0) await renderHome(token);
    else if (p0 === 'champions') await renderChampions(token);
    else if (p0 === 'tier') await renderTier(token, p1 || 'ranked');
    else if (p0 === 'champ') await renderChamp(token, +p1, p2 || null, p3 || null);
    else if (p0 === 'tft') await renderTFT(token, parts.slice(1));
    else await renderHome(token);
  } catch (e) {
    if (token !== routeToken) return;
    console.error(e);
    view.innerHTML = errorBox(e);
  }
}
const stale = t => t !== routeToken;
const loadingHTML = (msg = 'Cargando…') => `<div class="inline-load"><div class="spinner"></div>${esc(msg)}</div>`;
const errorBox = e => `<div class="error-box"><b>No se pudieron cargar los datos.</b><br>${esc(e?.message || e)}<br><span class="muted">Revisa tu conexión a internet o cambia la región en Ajustes.</span><br><button class="btn sm" onclick="route()">Reintentar</button></div>`;

/* ---------------- home ---------------- */
function bestByRole(list) {
  const out = {};
  for (const r of ROLES) out[r.op] = [];
  for (const c of list) for (const p of c.positions || []) {
    if (!out[p.name] || !p.stats) continue;
    out[p.name].push({ id: c.id, tier: p.stats.tier_data?.tier, rank: p.stats.tier_data?.rank ?? 999, wr: p.stats.win_rate, pr: p.stats.pick_rate });
  }
  for (const k in out) out[k].sort((a, b) => ((a.tier ?? 9) - (b.tier ?? 9)) || (a.rank - b.rank));
  return out;
}

async function renderHome(t) {
  const bg = S.champs.Ahri || Object.values(S.champs)[0];
  view.innerHTML = `
    <section class="hero">
      <div class="hero-bg" style="background-image:url('${img.splash(bg)}')"></div>
      <h1><img src="icon.png" alt="">LEAGUE OF LEGENDS</h1>
      <p>Builds, runas, orden de habilidades, aumentos y tier list del parche actual</p>
      <div class="search"><svg viewBox="0 0 24 24" class="ico"><path d="M10.5 3a7.5 7.5 0 0 1 5.9 12.1l4.2 4.2-1.4 1.4-4.2-4.2A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z"/></svg><input id="heroSearch" placeholder="Busca un campeón (Ahri, Jinx, Lee Sin…)" autocomplete="off"><div class="suggest" id="heroSuggest"></div></div>
    </section>
    <div class="row-head"><h2>Mejores por rol</h2><span>Clasificatoria · ${esc(TIERS.find(x => x[0] === settings.tier)?.[1])}</span><a class="more" href="#/tier/ranked">Ver tier list completa →</a></div>
    <div id="homeRoles">${loadingHTML('Cargando tier list…')}</div>
    <div class="row-head"><h2>ARAM Mayhem</h2><span>Campeones más fuertes ahora</span><a class="more" href="#/tier/aram">Ver todo →</a></div>
    <div id="homeAram">${loadingHTML()}</div>`;
  attachSearch($('#heroSearch'), $('#heroSuggest'));
  $('#heroSearch').focus();

  getList('ranked').then(list => {
    if (stale(t)) return;
    const by = bestByRole(list);
    $('#homeRoles').innerHTML = `<div class="role-cols">${ROLES.map(r => `
      <div class="role-col"><h4><img src="${img.role(r.ic)}" alt="">${r.name}</h4>
      ${by[r.op].slice(0, 6).map(x => { const c = S.byKey[x.id]; return c ? `
        <a class="mini-champ" href="#/champ/${x.id}/ranked/${r.op}">${champImg(c, 'ic sm')}<span class="nm">${esc(c.name)}</span>${tierBadge(x.tier)}<span class="wr ${wrClass(x.wr)}">${pct(x.wr)}</span></a>` : ''; }).join('')}
      </div>`).join('')}</div>`;
  }).catch(e => { if (!stale(t)) $('#homeRoles').innerHTML = errorBox(e); });

  getList('aram').then(list => {
    if (stale(t)) return;
    const top = list.filter(c => c.average_stats).sort((a, b) => (a.average_stats.tier_data?.rank ?? a.average_stats.rank ?? 999) - (b.average_stats.tier_data?.rank ?? b.average_stats.rank ?? 999)).slice(0, 16);
    $('#homeAram').innerHTML = `<div class="champ-grid">${top.map(x => { const c = S.byKey[x.id]; return c ? `
      <a class="champ-tile" href="#/champ/${x.id}/aram">${tierBadge(x.average_stats.tier)}<img src="${img.champ(c)}" alt="${esc(c.name)}" loading="lazy"><span>${esc(c.name)} · <b class="${wrClass(x.average_stats.win_rate)}">${pct(x.average_stats.win_rate)}</b></span></a>` : ''; }).join('')}</div>`;
  }).catch(e => { if (!stale(t)) $('#homeAram').innerHTML = errorBox(e); });
}

/* ---------------- champions grid ---------------- */
async function renderChampions(t) {
  let role = 'ALL', q = '';
  view.innerHTML = `<div class="tl-head"><h1>Campeones</h1><div class="sp"></div></div>
    <div class="grid-tools"><input id="gq" placeholder="Filtrar por nombre…">
      <div class="seg" id="groles"><button class="on" data-r="ALL">Todos</button>${ROLES.map(r => `<button data-r="${r.op}"><img src="${img.role(r.ic)}" alt="">${r.name}</button>`).join('')}</div></div>
    <div id="cgrid"></div>`;
  let tiers = {}, roles = {};
  const draw = () => {
    const n = norm(q);
    const list = Object.values(S.champs).filter(c => (!n || norm(c.name).includes(n)) && (role === 'ALL' || roles[c.key]?.has(role)))
      .sort((a, b) => a.name.localeCompare(b.name));
    $('#cgrid').innerHTML = `<div class="champ-grid">${list.map(c => `<a class="champ-tile" href="#/champ/${c.key}${role !== 'ALL' ? '/ranked/' + role : ''}">${tierBadge(tiers[c.key + '|' + role])}<img src="${img.champ(c)}" alt="${esc(c.name)}" loading="lazy"><span>${esc(c.name)}</span></a>`).join('')}</div>`;
  };
  $('#gq').addEventListener('input', e => { q = e.target.value; draw(); });
  $('#groles').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#groles button').forEach(x => x.classList.toggle('on', x === b)); role = b.dataset.r; draw();
  });
  draw();
  try {
    const list = await getList('ranked');
    if (stale(t)) return;
    for (const c of list) {
      roles[c.id] = new Set();
      tiers[c.id + '|ALL'] = c.average_stats?.tier;
      for (const p of c.positions || []) {
        if ((p.stats?.role_rate ?? 1) >= 0.08) roles[c.id].add(p.name);
        tiers[c.id + '|' + p.name] = p.stats?.tier_data?.tier;
      }
    }
    draw();
  } catch { }
}

/* ---------------- tier list ---------------- */
async function renderTier(t, mode) {
  if (!MODES[mode]) mode = 'ranked';
  let role = 'ALL', sortKey = 'tier', sortDir = 1;
  view.innerHTML = `<div class="tl-head"><h1>Tier List · ${MODES[mode]}</h1><div class="sp"></div>
    <div class="seg" id="tlMode">${Object.entries(MODES).map(([k, v]) => `<button data-m="${k}" class="${k === mode ? 'on' : ''}">${v}</button>`).join('')}</div></div>
    ${mode === 'ranked' ? `<div class="grid-tools"><div class="seg" id="tlRoles"><button class="on" data-r="ALL">Todos</button>${ROLES.map(r => `<button data-r="${r.op}"><img src="${img.role(r.ic)}" alt="">${r.name}</button>`).join('')}</div>
      <span class="muted">${esc(TIERS.find(x => x[0] === settings.tier)?.[1])} · ${esc(REGIONS.find(x => x[0] === settings.region)?.[1])}</span></div>` : ''}
    <div id="tl">${loadingHTML('Cargando tier list…')}</div>`;
  $('#tlMode').addEventListener('click', e => { const b = e.target.closest('button'); if (b) go('#/tier/' + b.dataset.m); });

  const list = await getList(mode);
  if (stale(t)) return;
  let rows = [];
  if (mode === 'ranked') {
    for (const c of list) for (const p of c.positions || []) {
      const s = p.stats; if (!s) continue;
      if ((s.role_rate ?? 1) < 0.05) continue;
      const ctr = (p.counters || []).filter(x => x.play >= 10).map(x => ({ ...x, wr: x.win / x.play })).sort((a, b) => a.wr - b.wr).slice(0, 3);
      rows.push({ id: c.id, pos: p.name, tier: s.tier_data?.tier ?? 9, rank: s.tier_data?.rank ?? 999, prev: s.tier_data?.rank_prev, wr: s.win_rate, pr: s.pick_rate, br: s.ban_rate, kda: s.kda, play: s.play, ctr });
    }
  } else {
    for (const c of list) {
      const s = c.average_stats; if (!s) continue;
      rows.push({ id: c.id, tier: s.tier ?? s.tier_data?.tier ?? 9, rank: s.tier_data?.rank ?? s.rank ?? 999, prev: s.tier_data?.rank_prev, wr: s.win_rate, pr: s.pick_rate, br: s.ban_rate, kda: s.kda, play: s.play, place: s.play ? (s.total_place ?? null) / s.play : null, first: s.first_place && s.play ? s.first_place / s.play : null });
    }
  }
  const cols = [
    { k: 'rank', l: '#', num: false },
    { k: 'name', l: 'Campeón' },
    ...(mode === 'ranked' ? [{ k: 'pos', l: 'Rol' }] : []),
    { k: 'tier', l: 'Tier' },
    { k: 'wr', l: mode === 'arena' ? 'Top 4' : 'Win rate', num: true },
    ...(mode === 'arena' ? [{ k: 'first', l: '1.er lugar', num: true }] : []),
    { k: 'pr', l: 'Pick rate', num: true },
    ...(rows.some(r => r.br != null) ? [{ k: 'br', l: 'Ban rate', num: true }] : []),
    { k: 'play', l: 'Partidas', num: true },
    ...(mode === 'ranked' ? [{ k: 'ctr', l: 'Counters' }] : []),
  ];
  const draw = () => {
    let r = rows.filter(x => role === 'ALL' || x.pos === role);
    const val = (x, k) => k === 'name' ? (S.byKey[x.id]?.name || '') : k === 'tier' ? x.tier * 1000 + x.rank : x[k];
    r.sort((a, b) => {
      const A = val(a, sortKey), B = val(b, sortKey);
      if (typeof A === 'string') return A.localeCompare(B) * sortDir;
      return ((A ?? -1) - (B ?? -1)) * sortDir;
    });
    $('#tl').innerHTML = `<table class="tl"><thead><tr>${cols.map(c => `<th data-k="${c.k}" class="${c.num ? 'num' : ''} ${sortKey === c.k ? 'sorted' : ''}">${c.l}${sortKey === c.k ? (sortDir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
      <tbody>${r.map((x, i) => {
      const c = S.byKey[x.id]; if (!c) return '';
      const trend = x.prev && x.rank !== 999 ? (x.prev > x.rank ? `<span class="trend-up">▲${x.prev - x.rank}</span>` : x.prev < x.rank ? `<span class="trend-down">▼${x.rank - x.prev}</span>` : '') : '';
      const href = mode === 'ranked' ? `#/champ/${x.id}/ranked/${x.pos}` : `#/champ/${x.id}/${mode}`;
      return `<tr data-h="${href}">
          <td class="rank">${i + 1}${trend}</td>
          <td><div class="champ-cell">${champImg(c, 'ic sm')}${esc(c.name)}</div></td>
          ${mode === 'ranked' ? `<td><img class="role-ic" src="${img.role(roleOf(x.pos).ic)}" alt="${roleOf(x.pos).name}" data-tip="text:${encodeURIComponent(roleOf(x.pos).name)}"></td>` : ''}
          <td>${tierBadge(x.tier === 9 ? null : x.tier)}</td>
          <td class="num ${wrClass(x.wr)}"><b>${pct(x.wr, 2)}</b></td>
          ${mode === 'arena' ? `<td class="num">${pct(x.first)}</td>` : ''}
          <td class="num">${pct(x.pr)}</td>
          ${cols.some(c => c.k === 'br') ? `<td class="num">${pct(x.br)}</td>` : ''}
          <td class="num muted">${fmt(x.play)}</td>
          ${mode === 'ranked' ? `<td><div class="counters">${x.ctr.map(k => { const cc = S.byKey[k.champion_id]; return cc ? `<img src="${img.champ(cc)}" alt="${esc(cc.name)}" loading="lazy" data-tip="text:${encodeURIComponent(cc.name + ' — ' + c.name + ' gana ' + pct(k.wr))}">` : ''; }).join('')}</div></td>` : ''}
        </tr>`;
    }).join('')}</tbody></table>`;
  };
  $('#tl').addEventListener('click', e => {
    const th = e.target.closest('th[data-k]');
    if (th) {
      const k = th.dataset.k;
      if (k === 'ctr' || k === 'pos') return;
      if (sortKey === k) sortDir *= -1; else { sortKey = k; sortDir = ['wr', 'pr', 'br', 'play', 'first'].includes(k) ? -1 : 1; }
      draw(); return;
    }
    const tr = e.target.closest('tr[data-h]'); if (tr) go(tr.dataset.h);
  });
  $('#tlRoles')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    $$('#tlRoles button').forEach(x => x.classList.toggle('on', x === b)); role = b.dataset.r; draw();
  });
  draw();
}

/* ---------------- champion page ---------------- */
const champState = { buildSort: 'best', buildIdx: 0, runeIdx: 0, augView: false };

function fillSkillOrder(order) {
  // OP.GG gives the first ~15 levels; complete to 18 following the max-order.
  const o = [...(order || [])];
  const cnt = { Q: 0, W: 0, E: 0, R: 0 };
  o.forEach(k => cnt[k] = (cnt[k] || 0) + 1);
  const prio = ['Q', 'W', 'E'].sort((a, b) => o.lastIndexOf(b) - o.lastIndexOf(a));
  while (o.length < 18) {
    const lvl = o.length + 1;
    if ([6, 11, 16].includes(lvl) && cnt.R < 3) { o.push('R'); cnt.R++; continue; }
    const k = prio.find(k => cnt[k] < 5) || 'R';
    o.push(k); cnt[k]++;
  }
  return o.slice(0, 18);
}

function scoreBuilds(arr, mode) {
  const list = (arr || []).filter(b => b.play > 0).map(b => ({ ...b, wr: b.win / b.play }));
  if (!list.length) return [];
  const top = Math.max(...list.map(b => b.play));
  const m = Math.max(30, top * 0.08);
  const avg = list.reduce((s, b) => s + b.win, 0) / list.reduce((s, b) => s + b.play, 0);
  for (const b of list) b.adj = (b.win + m * avg) / (b.play + m);
  const minPlay = top * 0.03;
  if (mode === 'wr') return list.filter(b => b.play >= minPlay).sort((a, b) => b.wr - a.wr);
  if (mode === 'common') return list.sort((a, b) => b.play - a.play);
  return list.filter(b => b.play >= minPlay).sort((a, b) => b.adj - a.adj);
}

function runeTree(style, selected, isPrimary) {
  if (!style) return '';
  const slots = isPrimary ? style.slots : style.slots.slice(1);
  return `<div class="rtree"><h5><img src="${img.rune(style.icon)}" alt="">${esc(style.name)}</h5>
    ${slots.map((sl, i) => `<div class="rrow ${isPrimary && i === 0 ? 'key' : ''}">${sl.runes.map(r => `<img src="${img.rune(r.icon)}" alt="${esc(r.name)}" class="${selected.includes(r.id) ? 'sel' : ''}" data-tip="rune:${r.id}">`).join('')}</div>`).join('')}</div>`;
}
function shardsHTML(ids) {
  return `<div class="shards"><h5 class="dim" style="margin:0 0 4px;font-size:12px">Fragmentos</h5>${(ids || []).map(id => {
    const cd = S.perksCD[id];
    const src = cd ? cdAsset(cd.iconPath) : '';
    return `<div class="sh"><img src="${src || ph('+')}" alt="" data-tip="rune:${id}">${esc(cd?.name || SHARD_FALLBACK[id] || id)}</div>`;
  }).join('')}</div>`;
}

function rarityKey(r) {
  if (r === 8 || r === 'kPrismatic' || r === 2) return 'prism';
  if (r === 4 || r === 'kGold' || r === 1) return 'gold';
  return 'silver';
}
const RAR_LBL = { prism: 'Aumentos prismáticos', gold: 'Aumentos de oro', silver: 'Aumentos de plata' };

function gradeList(list, key, qualify) {
  // percentile grade within each rarity, among statistically relevant rows
  const q = list.filter(qualify).map(x => x[key]).sort((a, b) => b - a);
  const cut = p => q[Math.min(q.length - 1, Math.floor(q.length * p))] ?? -Infinity;
  const [cS, cA, cB] = [cut(0.15), cut(0.40), cut(0.70)];
  for (const x of list) x.grade = !qualify(x) ? null : x[key] >= cS ? 'S' : x[key] >= cA ? 'A' : x[key] >= cB ? 'B' : 'C';
}

function augIcon(a) {
  const small = cdAsset(a?.augmentSmallIconPath);
  const large = small.replace('_small.png', '_large.png');
  return { large, small };
}

function augmentsPanel(data, mode, champName) {
  // returns HTML; data = normalized list [{id, name, rarity, perf, pop, wr, pick, place}]
  if (!data.length) return '';
  const groups = { prism: [], gold: [], silver: [] };
  for (const a of data) groups[a.rarity].push(a);
  const metric = mode === 'arena' ? 'wr' : 'perf';
  for (const k in groups) {
    const g = groups[k];
    const totalPop = g.reduce((s, x) => s + (x.pop ?? x.pick ?? 0), 0) || 1;
    const minShare = mode === 'arena' ? 0.004 : 0.012;
    gradeList(g, metric, x => ((x.pop ?? x.pick ?? 0) / totalPop) >= minShare);
    g.sort((a, b) => (b.grade ? 1 : 0) - (a.grade ? 1 : 0) || b[metric] - a[metric]);
  }
  const card = a => {
    const ic = augIcon(S.aug[a.id]);
    const sub = mode === 'arena'
      ? `${pct(a.wr, 0)} top 4 · ${pct(a.pick, 1)} uso`
      : `Rend. ${Math.round(a.perf)} · Pop. ${a.pop?.toFixed(1)}%`;
    return `<div class="aug" data-tip="text:${encodeURIComponent(a.name)}"><div class="ai"><img src="${ic.large || ph(a.name)}" data-fb="${ic.small}" alt="${esc(a.name)}" loading="lazy">${a.grade ? `<span class="tier t-${a.grade}">${a.grade}</span>` : ''}</div><div class="an"><b>${esc(a.name)}</b><small>${sub}</small></div></div>`;
  };
  const summary = Object.entries(groups).filter(([, g]) => g.length).map(([k, g]) => `
    <div class="aug-sec"><h4 class="${k}">${RAR_LBL[k]}</h4><div class="aug-grid">${g.slice(0, 6).map(card).join('')}</div></div>`).join('');
  const all = Object.entries(groups).filter(([, g]) => g.length).map(([k, g]) => `
    <div class="aug-sec"><h4 class="${k}">${RAR_LBL[k]} <span class="dim" style="font-weight:400">(${g.length})</span></h4><div class="aug-grid">${g.map(card).join('')}</div></div>`).join('');
  return `<div class="card" id="augCard">
    <div class="aug-banner"><img src="icon.png" alt="" style="width:46px;height:46px;border-radius:10px"><div><h3>${mode === 'arena' ? 'Mejores aumentos de Arena' : 'Tier list de aumentos ARAM Mayhem'} · ${esc(champName)}</h3>
    <p>${mode === 'arena' ? 'Calificados por porcentaje de Top 4 (con suficiente muestra).' : 'Calificados por el índice de rendimiento de OP.GG; «Pop.» es la popularidad entre jugadores de este campeón.'}</p></div></div>
    <div id="augSummary" ${champState.augView ? 'hidden' : ''}>${summary}</div>
    <div id="augAll" ${champState.augView ? '' : 'hidden'}>${all}</div>
    <button class="btn ghost aug-all" id="augToggle">${champState.augView ? 'Mostrar solo los mejores' : 'Mostrar todos los aumentos'}</button>
  </div>`;
}

async function normalizedAugments(id, mode, detail) {
  await loadAugments();
  if (mode === 'aram') {
    let rows = [];
    try { rows = (await api(OPGG + `contents/stats/champions/${id}/aram-augments`)).data || []; } catch { }
    return rows.map(r => {
      const a = S.aug[r.id];
      return { id: r.id, name: a?.nameTRA || ('Aumento ' + r.id), rarity: rarityKey(a?.rarity), perf: r.performance, pop: r.popular };
    });
  }
  if (mode === 'arena') {
    const out = [];
    for (const g of detail?.augment_group || []) for (const r of g.augments || []) {
      const a = S.aug[r.id];
      out.push({ id: r.id, name: a?.nameTRA || ('Aumento ' + r.id), rarity: rarityKey(a?.rarity ?? r.rarity ?? g.rarity), wr: r.win_rate ?? (r.play ? r.win / r.play : 0), pick: r.pick_rate, place: r.play ? r.total_place / r.play : null });
    }
    return out;
  }
  return [];
}

async function renderChamp(t, id, mode, pos) {
  const c = S.byKey[id];
  if (!c) { view.innerHTML = errorBox('Campeón no encontrado'); return; }
  mode = MODES[mode] ? mode : 'ranked';
  champState.buildIdx = 0; champState.runeIdx = 0; champState.augView = false;

  // pick a default position from the tier list
  let list = null;
  let positions = [];
  if (mode === 'ranked') {
    try { list = await getList('ranked'); } catch { }
    const entry = list?.find(x => x.id === id);
    positions = (entry?.positions || []).filter(p => (p.stats?.role_rate ?? 1) >= 0.03).sort((a, b) => (b.stats?.role_rate || 0) - (a.stats?.role_rate || 0));
    if (!pos || !ROLES.some(r => r.op === pos)) pos = positions[0]?.name || 'MID';
  }
  if (stale(t)) return;

  const full = await getChampFull(c);
  if (stale(t)) return;
  const keys = ['Q', 'W', 'E', 'R'];
  const abil = {};
  if (full) {
    tipStore[c.id + 'P'] = full.passive;
    full.spells.forEach((s, i) => { abil[keys[i]] = s; tipStore[c.id + keys[i]] = s; });
  }
  const abilIcon = (k, cls = 'ic') => abil[k] ? `<img class="${cls}" src="${img.spell(abil[k])}" alt="${k}" data-tip="abil:${c.id}${k}">` : `<span class="${cls} ph">${k}</span>`;

  view.innerHTML = `
    <section class="champ-head">
      <div class="splash" style="background-image:url('${img.splash(c)}')"></div>
      <img class="portrait" src="${img.champ(c)}" alt="${esc(c.name)}">
      <div>
        <h1>${esc(c.name)} <span id="headTier"></span></h1>
        <div class="title">${esc(c.title)}</div>
        <div class="abil">${full ? `<span class="k"><img class="ic sm" src="${img.passive(full.passive)}" alt="P" data-tip="abil:${c.id}P"><b>P</b></span>` : ''}${keys.map(k => `<span class="k">${abilIcon(k, 'ic sm')}<b>${k}</b></span>`).join('')}</div>
      </div>
      <div class="head-stats" id="headStats"></div>
    </section>
    <div class="mode-tabs" id="modeTabs">${Object.entries(MODES).map(([k, v]) => `<button data-m="${k}" class="${k === mode ? 'on' : ''}">${v === 'Clasificatoria' ? 'Build' : v}</button>`).join('')}
      <div class="right"><button class="btn ghost sm" id="openOpgg">Ver en OP.GG ↗</button></div></div>
    ${mode === 'ranked' ? `<div class="pos-bar"><div class="seg" id="posSeg">${ROLES.map(r => {
    const p = positions.find(x => x.name === r.op);
    return `<button data-p="${r.op}" class="${r.op === pos ? 'on' : ''}" ${p ? '' : 'style="opacity:.45"'}><img src="${img.role(r.ic)}" alt="">${r.name}${p ? ` <small class="dim">${pct(p.stats?.role_rate, 0)}</small>` : ''}</button>`;
  }).join('')}</div><span class="meta" id="metaInfo"></span></div>` : `<div class="pos-bar"><span class="meta" id="metaInfo" style="margin-left:0"></span></div>`}
    <div id="champBody">${loadingHTML('Cargando build…')}</div>`;

  $('#modeTabs').addEventListener('click', e => {
    const b = e.target.closest('button[data-m]'); if (b) go(`#/champ/${id}/${b.dataset.m}${b.dataset.m === 'ranked' ? '/' + pos : ''}`);
  });
  $('#posSeg')?.addEventListener('click', e => { const b = e.target.closest('button[data-p]'); if (b) go(`#/champ/${id}/ranked/${b.dataset.p}`); });
  $('#openOpgg').addEventListener('click', () => {
    const slug = c.id.toLowerCase();
    const u = mode === 'ranked' ? `https://op.gg/lol/champions/${slug}/build/${pos.toLowerCase()}` : mode === 'aram' ? `https://op.gg/lol/modes/aram-mayhem/${slug}/build` : `https://op.gg/lol/modes/arena/${slug}/build`;
    fetch('/api/open?u=' + encodeURIComponent(u));
  });

  let j;
  try { j = await getDetail(id, mode, pos); }
  catch (e) { if (!stale(t)) $('#champBody').innerHTML = errorBox(e); return; }
  if (stale(t)) return;
  const d = j.data || {};
  const meta = j.meta || {};
  const augs = (mode !== 'ranked') ? await normalizedAugments(id, mode, d) : [];
  if (stale(t)) return;

  // header stats
  const avg = mode === 'ranked' ? (d.summary?.positions?.find(p => p.name === pos)?.stats || d.summary?.average_stats) : d.summary?.average_stats;
  if (avg) {
    $('#headTier').innerHTML = tierBadge(avg.tier_data?.tier ?? avg.tier);
    $('#headStats').innerHTML = [
      [mode === 'arena' ? 'Top 4' : 'Win rate', `<span class="${wrClass(avg.win_rate)}">${pct(avg.win_rate, 2)}</span>`],
      ['Pick rate', pct(avg.pick_rate)],
      ...(avg.ban_rate != null ? [['Ban rate', pct(avg.ban_rate)]] : []),
      ['Partidas', fmt(avg.play)],
    ].map(([l, v]) => `<div class="stat"><b>${v}</b><span class="lab">${l}</span></div>`).join('');
  }
  $('#metaInfo').textContent = [meta.version ? 'Parche ' + meta.version : '', mode === 'ranked' ? TIERS.find(x => x[0] === settings.tier)?.[1] : MODES[mode], REGIONS.find(x => x[0] === settings.region)?.[1]].filter(Boolean).join(' · ');

  const body = $('#champBody');
  const ctx = { c, id, mode, pos, d, abil, abilIcon, augs };
  const draw = () => { body.innerHTML = champBodyHTML(ctx); };
  draw();

  body.addEventListener('click', async e => {
    const bs = e.target.closest('[data-bsort]');
    if (bs) { champState.buildSort = bs.dataset.bsort; champState.buildIdx = 0; draw(); return; }
    const bi = e.target.closest('[data-bidx]');
    if (bi) { champState.buildIdx = +bi.dataset.bidx; draw(); return; }
    const ri = e.target.closest('[data-ridx]');
    if (ri) { champState.runeIdx = +ri.dataset.ridx; draw(); return; }
    if (e.target.closest('#augToggle')) { champState.augView = !champState.augView; draw(); return; }
    const imp = e.target.closest('[data-import]');
    if (imp) { await doImport(imp.dataset.import, ctx, imp); return; }
    const ch = e.target.closest('[data-champ]');
    if (ch) go(`#/champ/${ch.dataset.champ}/${mode}${mode === 'ranked' ? '/' + pos : ''}`);
  });

}

function currentRunes(d) {
  const all = (d.runes || []).filter(r => r.primary_rune_ids?.length);
  // keep the best page per keystone so the alternatives are truly different
  const seen = new Set(), out = [];
  for (const r of all) { const k = r.primary_rune_ids[0] + '|' + r.secondary_page_id; if (seen.has(k)) continue; seen.add(k); out.push(r); }
  return out.slice(0, 4);
}

function selectedBuild(d) {
  const builds = scoreBuilds(d.core_items, champState.buildSort);
  return { builds, b: builds[champState.buildIdx] || builds[0] };
}

function champBodyHTML(ctx) {
  const { c, mode, d, abil, abilIcon, augs } = ctx;
  const { builds, b } = selectedBuild(d);
  const runes = currentRunes(d);
  const rp = runes[champState.runeIdx] || runes[0];
  const spells = (d.summoner_spells || []).slice(0, 2);
  const starters = (d.starter_items || []).slice(0, 2);
  const boots = (d.boots || []).filter(x => x.ids?.length).slice(0, 3);
  const situ = scoreBuilds(d.last_items, 'best').filter(x => !b?.ids?.includes(x.ids[0])).slice(0, 10);
  const skillM = (d.skill_masteries || [])[0];
  const skills = (d.skills || [])[0];
  const order = skills ? fillSkillOrder(skills.order) : null;
  const hasClient = lcuState.connected;

  const buildList = builds.length ? `<div class="card blist">
      <div class="tabs2">${[['best', 'Mejor'], ['wr', 'Win Rate'], ['common', 'Común']].map(([k, l]) => `<button data-bsort="${k}" class="${champState.buildSort === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <h5>Builds principales</h5>
      ${builds.slice(0, 8).map((x, i) => `<div class="bitem ${x === b ? 'on' : ''}" data-bidx="${i}">
        <div class="t"><b>Build ${i + 1}</b><small>${fmt(x.play)} partidas</small></div>
        <div class="its">${x.ids.slice(0, 3).map(id => `<img src="${img.item(id)}" alt="" loading="lazy">`).join('')}</div>
        <span class="wrbox ${wrClass(x.wr)}">${pct(x.wr, 0)}</span></div>`).join('')}
    </div>` : '';

  const optRow = (x, label) => `<div class="opt">${x.ids.map(id => itemImg(id, 'ic sm')).join('')}<span class="grow muted" style="font-size:12px">${label || ''}</span><span class="num"><b class="${wrClass(x.win / x.play)}">${pct(x.win / x.play)}</b>${fmt(x.play)}</span></div>`;

  const itemsCard = b || starters.length ? `<div class="card">
      <h3>Build de objetos <small>${b ? `${pct(b.wr)} win rate · ${fmt(b.play)} partidas` : ''}</small>
        <span style="margin-left:auto" class="import-row">${hasClient ? `<button class="btn ghost sm" data-import="items">Importar build</button>` : ''}</span></h3>
      <div class="item-blocks">
        ${starters.length ? `<div class="iblock"><h4>Objetos iniciales</h4><div class="opt-list">${starters.map(x => optRow(x)).join('')}</div></div>` : ''}
        ${boots.length ? `<div class="iblock"><h4>Botas</h4><div class="opt-list">${boots.map(x => optRow(x)).join('')}</div></div>` : ''}
        ${b ? `<div class="iblock" style="grid-column:1/-1"><h4>Orden de construcción (núcleo)</h4><div class="items-row">${b.ids.map(id => itemImg(id, 'ic lg')).join('<span class="arrow">›</span>')}</div></div>` : ''}
        ${situ.length ? `<div class="iblock" style="grid-column:1/-1"><h4>Objetos situacionales (4.º–6.º)</h4><div class="situ">${situ.map(x => `<div class="s">${itemImg(x.ids[0])}<span class="${wrClass(x.wr)}">${pct(x.wr, 0)}</span></div>`).join('')}</div></div>` : ''}
      </div></div>` : '';

  const spellsCard = spells.length ? `<div class="card"><h3>Hechizos de invocador ${hasClient ? `<button class="btn ghost sm" style="margin-left:auto" data-import="spells">Aplicar</button>` : ''}</h3>
      <div class="spells">${spells.map(x => `<div class="opt">${x.ids.map(id => S.spells[id] ? `<img class="ic sm" src="${img.spell(S.spells[id])}" alt="" data-tip="spell:${id}">` : '').join('')}<span class="grow"></span><span class="num"><b class="${wrClass(x.win / x.play)}">${pct(x.win / x.play)}</b>${pct(x.pick_rate, 0)} uso</span></div>`).join('')}</div></div>` : '';

  const runesCard = rp ? `<div class="card"><h3>Runas <small>${pct(rp.win / rp.play)} win rate · ${pct(rp.pick_rate)} uso</small>
      <button class="btn sm" style="margin-left:auto" data-import="runes" ${hasClient ? '' : 'disabled title="Abre el cliente de LoL para importar"'}>
      <svg viewBox="0 0 24 24"><path d="M11 3h2v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V3ZM5 19h14v2H5z"/></svg>Importar runas</button></h3>
      ${runes.length > 1 ? `<div class="rune-alts">${runes.map((r, i) => { const k = S.perkById[r.primary_rune_ids[0]]; const sec = S.styleById[r.secondary_page_id]; return `<div class="rune-alt ${r === rp ? 'on' : ''}" data-ridx="${i}"><img src="${k ? img.rune(k.icon) : ph('R')}" alt="">${sec ? `<img src="${img.rune(sec.icon)}" alt="" style="width:18px;height:18px">` : ''}<div><b style="font-size:12.5px">${esc(k?.name || '')}</b><small>${pct(r.win / r.play)} · ${fmt(r.play)}</small></div></div>`; }).join('')}</div>` : ''}
      <div class="runes-wrap">
        ${runeTree(S.styleById[rp.primary_page_id], rp.primary_rune_ids, true)}
        ${runeTree(S.styleById[rp.secondary_page_id], rp.secondary_rune_ids, false)}
        ${shardsHTML(rp.stat_mod_ids)}
      </div></div>` : '';

  const skillsCard = order ? `<div class="card"><h3>Orden de habilidades <small>${pct(skills.win / skills.play)} win rate · ${fmt(skills.play)} partidas</small></h3>
      ${skillM ? `<div class="skill-prio"><span class="muted" style="font-size:12.5px;margin-right:6px">Prioridad:</span>${skillM.ids.map(k => `<span class="k">${abilIcon(k)}<b>${k}</b></span>`).join('<span class="gt">›</span>')}</div>` : ''}
      <div class="skill-grid"><div></div>${order.map((_, i) => `<div class="lvl">${i + 1}</div>`).join('')}
      ${['Q', 'W', 'E', 'R'].map(k => `<div class="lbl">${abilIcon(k, 'ic sm')}<span>${esc(abil[k]?.name || k)}</span></div>${order.map(o => `<div class="cell ${o === k ? 'on ' + k : ''}">${o === k ? k : ''}</div>`).join('')}`).join('')}
      </div></div>` : '';

  let countersCard = '';
  const ctr = (d.counters?.length ? d.counters : d.summary?.positions?.find(p => p.name === ctx.pos)?.counters) || [];
  if (mode === 'ranked' && ctr.length) {
    const top = Math.max(...ctr.map(x => x.play));
    const rows = ctr.filter(x => x.champion_id !== ctx.id && x.play >= Math.max(15, top * 0.06)).map(x => ({ ...x, wr: x.win / x.play }));
    const hard = [...rows].sort((a, b) => a.wr - b.wr).slice(0, 6);
    const easy = [...rows].sort((a, b) => b.wr - a.wr).slice(0, 6);
    const li = arr => arr.map(x => { const cc = S.byKey[x.champion_id]; return cc ? `<div class="ctr" data-champ="${x.champion_id}">${champImg(cc, 'ic sm')}<span class="nm">${esc(cc.name)}</span><span class="num ${wrClass(x.wr)}">${pct(x.wr)}<small>${fmt(x.play)} part.</small></span></div>` : ''; }).join('');
    countersCard = `<div class="two"><div class="card"><h3>Difícil contra <small>tu win rate</small></h3><div class="ctr-list">${li(hard)}</div></div>
      <div class="card"><h3>Fácil contra <small>tu win rate</small></h3><div class="ctr-list">${li(easy)}</div></div></div>`;
  }

  const augHTML = augmentsPanel(augs, mode, c.name);
  if (!buildList && !itemsCard && !runesCard && !augHTML) return `<div class="error-box">OP.GG no tiene suficientes datos de ${esc(c.name)} en este modo/rol todavía.</div>`;

  const importBar = hasClient && (rp || b) ? `<div class="import-bar"><div><b>Cliente de LoL conectado</b><span class="muted"> · importa la build de ${esc(c.name)} con un clic</span></div>
      <button class="btn" data-import="all"><svg viewBox="0 0 24 24"><path d="M11 3h2v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6V3ZM5 19h14v2H5z"/></svg>Importar todo</button></div>` : '';
  return `${importBar}${augHTML ? `<div style="margin-bottom:14px">${augHTML}</div>` : ''}
    <div class="layout">
      <div class="stack">${buildList}${spellsCard}</div>
      <div class="stack">${itemsCard}${runesCard}${skillsCard}${countersCard}</div>
    </div>`;
}

function itemSetFor(ctx, buildIdx) {
  const { c, d, mode, pos } = ctx;
  const ranked = scoreBuilds(d.core_items, 'best');
  const main = ranked[buildIdx] || ranked[0];
  const blk = (type, ids) => ({ type: type.slice(0, 60), items: ids.map(id => ({ id: String(id), count: 1 })) });
  const blocks = [];
  const skillM = (d.skill_masteries || [])[0];
  const skillTxt = skillM ? ` · Habilidades: ${skillM.ids.join(' › ')}` : '';
  const starters = (d.starter_items || []).filter(x => x.ids?.length);
  if (starters[0]) blocks.push(blk('Iniciales' + skillTxt, starters[0].ids));
  if (starters[1]) blocks.push(blk('Iniciales (alternativa)', starters[1].ids));
  const boots = (d.boots || []).filter(x => x.ids?.length).slice(0, 2).map(x => x.ids[0]);
  if (boots.length) blocks.push(blk('Botas', boots));
  if (main) blocks.push(blk(`Build principal (${pct(main.wr)} WR)`, main.ids));
  ranked.filter(x => x !== main).slice(0, 2).forEach((x, i) => blocks.push(blk(`Build alternativa ${i + 2} (${pct(x.wr)} WR)`, x.ids)));
  const used = new Set(blocks.flatMap(b => b.items.map(i => i.id)));
  const situ = scoreBuilds(d.last_items, 'best').map(x => x.ids[0]).filter(id => !used.has(String(id))).slice(0, 8);
  if (situ.length) blocks.push(blk('Situacionales (4.º–6.º)', situ));
  if (!blocks.length) return null;
  return {
    title: `LB ${c.name} ${mode === 'ranked' ? roleOf(pos).name : MODES[mode]}`.slice(0, 40),
    type: 'custom', map: 'any', mode: 'any', startedFrom: 'blank', sortrank: 0, preferredItemSlots: [],
    associatedChampions: [+c.key], associatedMaps: mode === 'aram' ? [12] : mode === 'arena' ? [30] : [11], blocks,
    uid: `lolbuilds-${c.key}-${mode}`,
  };
}

const lcuPost = (path, body) => fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Error'); return j; });

// Imports one thing into the client. idx lets auto-import use the best options
// regardless of what is selected on screen. Returns a short label on success.
async function importOne(kind, ctx, idx = {}) {
  const { c, d, mode, pos } = ctx;
  if (kind === 'runes') {
    const list = currentRunes(d);
    const rp = list[idx.rune ?? champState.runeIdx] || list[0];
    if (!rp) throw new Error('No hay runas para este modo');
    await lcuPost('/api/lcu/runes', {
      name: `LB ${c.name} ${mode === 'ranked' ? roleOf(pos).name : MODES[mode]}`,
      primaryStyleId: rp.primary_page_id, subStyleId: rp.secondary_page_id,
      selectedPerkIds: [...rp.primary_rune_ids, ...rp.secondary_rune_ids, ...(rp.stat_mod_ids || [])],
    });
    return 'runas';
  }
  if (kind === 'spells') {
    const s = (d.summoner_spells || []).find(x => x.ids?.length === 2);
    if (!s) throw new Error('No hay hechizos para este modo');
    await lcuPost('/api/lcu/spells', { spell1Id: s.ids[0], spell2Id: s.ids[1] });
    return 'hechizos';
  }
  if (kind === 'items') {
    const set = itemSetFor(ctx, idx.build ?? (champState.buildSort === 'best' ? champState.buildIdx : 0));
    if (!set) throw new Error('No hay build de objetos para este modo');
    await lcuPost('/api/lcu/itemset', set);
    return 'build de objetos';
  }
  throw new Error('Tipo desconocido');
}

async function doImport(kind, ctx, btn) {
  if (btn) btn.disabled = true;
  try {
    if (kind === 'all') {
      const done = [], failed = [];
      for (const k of ['runes', 'items', 'spells']) {
        try { done.push(await importOne(k, ctx)); } catch (e) { failed.push(e.message); }
      }
      if (done.length) toast(`${ctx.c.name}: ${done.join(', ')} importados ✔` + (failed.length ? ` (${failed[0]})` : ''));
      else toast(failed[0] || 'No se pudo importar', true);
    } else {
      const what = await importOne(kind, ctx);
      toast(kind === 'items' ? `Build de ${ctx.c.name} importada: la verás en la tienda del juego ✔` : `${what[0].toUpperCase() + what.slice(1)} de ${ctx.c.name} importados ✔`);
    }
  } catch (e) { toast(e.message, true); }
  finally { if (btn) btn.disabled = false; }
}

// Called from the client poll when you lock in a champion.
async function autoImport(champId, mode, pos) {
  const kinds = [settings.autoRunes && 'runes', settings.autoItems && 'items', settings.autoSpells && 'spells'].filter(Boolean);
  const c = S.byKey[champId];
  if (!kinds.length || !c) return;
  if (mode === 'ranked' && !pos) {
    try {
      const entry = (await getList('ranked')).find(x => x.id === champId);
      pos = [...(entry?.positions || [])].sort((a, b) => (b.stats?.role_rate || 0) - (a.stats?.role_rate || 0))[0]?.name;
    } catch { }
    pos = pos || 'MID';
  }
  let d;
  try { d = (await getDetail(champId, mode, pos)).data || {}; }
  catch (e) { toast('No se pudo descargar la build de ' + c.name, true); return; }
  const ctx = { c, id: champId, mode, pos, d };
  const done = [];
  for (const k of kinds) { try { done.push(await importOne(k, ctx, { rune: 0, build: 0 })); } catch { } }
  if (done.length) toast(`Auto: ${done.join(', ')} de ${c.name} importados ✔`);
}

/* ---------------- League client (LCU) ---------------- */
let lcuState = { connected: false };
let lastAutoOpen = null, lastAutoImport = null;
const QUEUE_MODE = q => [450, 2400, 2401, 2402].includes(q) ? 'aram' : [1700, 1710, 1720].includes(q) ? 'arena' : 'ranked';
const LCU_POS = { top: 'TOP', jungle: 'JUNGLE', middle: 'MID', bottom: 'ADC', utility: 'SUPPORT' };
const PHASES = { None: 'En el cliente', Lobby: 'En sala', Matchmaking: 'Buscando partida', ReadyCheck: 'Partida encontrada', ChampSelect: 'Selección de campeón', InProgress: 'En partida', WaitingForStats: 'Fin de partida', EndOfGame: 'Fin de partida', PreEndOfGame: 'Fin de partida' };

async function pollLCU() {
  try {
    const s = await (await fetch('/api/lcu/state')).json();
    const was = lcuState.connected;
    lcuState = s;
    const pill = $('#lcuPill');
    pill.className = 'lcu' + (s.connected ? (s.phase === 'ChampSelect' ? ' select' : ' on') : '');
    let txt = s.connected ? (PHASES[s.phase] || 'Cliente conectado') : 'Cliente no detectado';
    if (s.phase === 'ChampSelect' && s.championId && S.byKey[s.championId]) txt += ' · ' + S.byKey[s.championId].name;
    pill.querySelector('span').textContent = txt;
    if (was !== s.connected && location.hash.startsWith('#/champ/')) route(); // show/hide import buttons

    if (s.phase === 'ChampSelect' && s.championId && settings.autoOpen) {
      const mode = QUEUE_MODE(s.queueId);
      const pos = LCU_POS[s.position] || '';
      const key = `${s.championId}|${mode}|${pos}|${s.locked}`;
      if (key !== lastAutoOpen && S.byKey[s.championId]) {
        lastAutoOpen = key;
        go(`#/champ/${s.championId}/${mode}${mode === 'ranked' && pos ? '/' + pos : ''}`);
      }
    }
    if (s.phase === 'ChampSelect' && s.locked && s.championId) {
      const mode = QUEUE_MODE(s.queueId);
      const key = `${s.championId}|${mode}|${s.position}`;
      if (key !== lastAutoImport) { lastAutoImport = key; autoImport(s.championId, mode, LCU_POS[s.position] || ''); }
    }
    if (s.phase !== 'ChampSelect') { lastAutoOpen = null; lastAutoImport = null; }
  } catch { }
  setTimeout(pollLCU, lcuState.phase === 'ChampSelect' ? 1500 : 3000);
}

/* ---------------- settings modal ---------------- */
function initSettings() {
  $('#setRegion').innerHTML = REGIONS.map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#setTier').innerHTML = TIERS.map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  const m = $('#settingsModal');
  $('#settingsBtn').onclick = () => {
    $('#setRegion').value = settings.region; $('#setTier').value = settings.tier;
    $('#setAutoOpen').checked = settings.autoOpen; $('#setAutoRunes').checked = settings.autoRunes; $('#setAutoItems').checked = settings.autoItems; $('#setAutoSpells').checked = settings.autoSpells;
    m.hidden = false;
    drawVersion();
  };
  $('#checkUpdate').onclick = async () => {
    $('#verLabel').textContent = 'Buscando actualizaciones…';
    await fetch('/api/update/check', { method: 'POST' }).catch(() => { });
    setTimeout(pollUpdate, 4000);
  };
  const close = () => {
    const changed = settings.region !== $('#setRegion').value || settings.tier !== $('#setTier').value;
    settings.region = $('#setRegion').value; settings.tier = $('#setTier').value;
    settings.autoOpen = $('#setAutoOpen').checked; settings.autoRunes = $('#setAutoRunes').checked; settings.autoItems = $('#setAutoItems').checked; settings.autoSpells = $('#setAutoSpells').checked;
    saveSettings(); m.hidden = true;
    if (changed) route();
  };
  $('#closeSettings').onclick = close;
  m.addEventListener('click', e => { if (e.target === m) close(); });
  $('#refreshData').onclick = async () => {
    memo.clear(); S.lists = {}; S.aug = null;
    tftStaticP = tftCompsP = tftStatsP = null;
    S.freshUntil = Date.now() + 15000; // bypass the local cache for the next requests
    m.hidden = true;
    try { await loadStatic(true); toast('Datos actualizados'); } catch (e) { toast(e.message, true); }
    route();
  };
}

/* ---------------- boot ---------------- */
(async function boot() {
  initSettings();
  attachSearch($('#searchInput'), $('#suggest'));
  try { await loadStatic(); }
  catch (e) { view.innerHTML = errorBox(e); return; }
  window.addEventListener('hashchange', route);
  route();
  pollLCU();
  try { UI_VERSION = (await (await fetch('version.json')).json()).version; } catch { }
  setTimeout(pollUpdate, 3000);
  setInterval(checkPatch, 60 * 60 * 1000);
})();

/* ---------------- updates & new patches ---------------- */
let UI_VERSION = null;
const upd = { reloadOnNav: false, status: null };
function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number), pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d > 0 ? 1 : -1; }
  return 0;
}
function banner(html) {
  const b = $('#updBanner');
  if (!html) { b.hidden = true; return; }
  b.innerHTML = html; b.hidden = false;
}
async function pollUpdate() {
  try {
    const s = await (await fetch('/api/update/status')).json();
    upd.status = s;
    if (s.exeReady) {
      banner(`<b>Actualización ${esc(s.latest)} instalada.</b> <span>${esc(s.notes || '')}</span><button class="btn sm" onclick="fetch('/api/update/restart',{method:'POST'})">Reiniciar ahora</button>`);
    } else if (UI_VERSION && s.ui && cmpVer(s.ui, UI_VERSION) > 0) {
      upd.reloadOnNav = true;
      banner(`<b>Nueva versión ${esc(s.ui)} lista.</b> <span>${esc(s.notes || '')}</span><button class="btn sm" onclick="location.reload()">Aplicar ahora</button>`);
    }
    drawVersion();
  } catch { }
  setTimeout(pollUpdate, upd.status?.checking ? 3000 : 60000);
}
function drawVersion() {
  const s = upd.status, el = $('#verLabel');
  if (!el) return;
  if (!s) { el.textContent = 'Versión ' + (UI_VERSION || ''); return; }
  el.textContent = `Versión ${s.ui}` + (s.app !== s.ui ? ` (motor ${s.app})` : '') + (s.checking ? ' · buscando…' : s.error ? ' · ' + s.error : s.latest && cmpVer(s.latest, s.ui) <= 0 ? ' · al día' : '');
}
// Long sessions: re-check the patch every hour so new builds appear without restarting.
async function checkPatch() {
  try {
    const prev = S.v;
    memo.delete('https://ddragon.leagueoflegends.com/api/versions.json');
    const v = (await api('https://ddragon.leagueoflegends.com/api/versions.json'))[0];
    memo.clear(); S.lists = {}; tftCompsP = tftStatsP = null;
    if (v !== prev) { await loadStatic(); if (!location.hash.startsWith('#/champ/')) route(); }
  } catch { }
}
