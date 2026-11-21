'use strict';
/* Lets the TFT pages run without the desktop app's local server (mobile web and
   the Android app). On the desktop (served from 127.0.0.1) this does nothing.
   Elsewhere, requests to the local API are answered from the static data files
   that GitHub Actions publishes next to the site (data/*.json). */
(function () {
  const local = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
  window.LB_REMOTE = !local;
  if (local) return;
  document.documentElement.classList.add('lb-remote');

  const me = document.currentScript;
  const root = new URL((me && me.dataset.root) || './', location.href);
  const DATA = new URL('data/', root).href;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } },
  };
  // read by i18n.js instead of the desktop's /api/prefs
  window.LB_PREFS = { get lang() { return LS.get('lb.lang', null); }, setLang(l) { LS.set('lb.lang', l); } };

  const MT = {
    'tft-stat-api/units': 'mt-units.json', 'tft-stat-api/items': 'mt-items.json',
    'tft-stat-api/traits': 'mt-traits.json', 'tft-comps-api/unit_items_processed': 'mt-uip.json',
  };
  const ok = o => Promise.resolve(new Response(JSON.stringify(o), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  const lang = () => LS.get('lb.lang', null) || (/^es/i.test(navigator.language || '') ? 'es' : 'en');
  const orig = window.fetch.bind(window);

  window.fetch = function (input, init) {
    let u;
    try { u = new URL(typeof input === 'string' ? input : input.url, location.href); } catch { return orig(input, init); }
    if (u.origin !== location.origin || !(u.pathname === '/p' || u.pathname.startsWith('/api/'))) return orig(input, init);
    const q = u.searchParams;
    const method = ((init && init.method) || 'GET').toUpperCase();

    if (u.pathname === '/p') { // desktop caching proxy: /p?u=<url>
      const target = new URL(q.get('u'));
      if (target.host === 'api-hc.metatft.com') {
        const key = Object.keys(MT).find(k => target.pathname.endsWith('/' + k));
        if (key) return orig(DATA + MT[key]);
      }
      return orig(target.href);
    }
    if (u.pathname === '/api/tft/comps') return orig(DATA + 'tft-comps.json');
    if (u.pathname === '/api/tft/augs') return orig(DATA + 'tft-augs.json');
    if (u.pathname === '/api/tft/static') return orig(DATA + 'tft-static-' + (q.get('lang') === 'en_us' ? 'en_us' : 'es_mx') + '.json');
    if (u.pathname === '/api/prefs') {
      if (method === 'POST' && q.get('lang')) LS.set('lb.lang', q.get('lang'));
      return ok({ lang: lang() });
    }
    if (u.pathname === '/api/overlay/state') { // pinned comp shared between the overlay tabs
      if (method === 'POST' && q.has('pin')) LS.set('ov.pinShared', q.get('pin'));
      return ok({ v: 0, visible: true, pin: LS.get('ov.pinShared', '') });
    }
    if (u.pathname === '/api/update/status') return ok({});
    return Promise.resolve(new Response('{"error":"not available on mobile"}', { status: 404 }));
  };
})();
