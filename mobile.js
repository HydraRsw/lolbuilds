'use strict';
/* LoL Builds TFT for phones: same TFT screens as the desktop app (tft.js), fed by
   the data files GitHub publishes (platform.js). In the Android app the page also
   controls the floating overlay through the `Android` bridge. */

const IS_APP = typeof window.Android !== 'undefined';
const IS_IOS = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const IS_ANDROID = /Android/i.test(navigator.userAgent);
const STANDALONE = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

window.ovGo = h => { if (location.hash === h) mRoute(); else location.hash = h; };

async function mRoute() {
  const token = ++routeToken;
  const parts = (location.hash.replace(/^#\/?/, '') || '').split('/').filter(Boolean);
  if (parts[0] !== 'tft') { history.replaceState(null, '', '#/tft'); parts.splice(0, parts.length, 'tft'); }
  tip.classList.remove('show');
  window.scrollTo(0, 0);
  try { await renderTFT(token, parts.slice(1)); }
  catch (e) { if (token === routeToken) view.innerHTML = errorBox(e); }
}

// "Abrir / cerrar overlay" in the TFT header (tft.js shows it when this exists)
if (!IS_IOS) {
  window.toggleOverlay = () => {
    if (IS_APP) { Android.toggleOverlay(); return; }
    toast(L('El overlay funciona en la app de Android: descárgala arriba.'));
    window.scrollTo(0, 0);
  };
}

function banner(html, onclick) {
  const b = document.getElementById('mBanner');
  b.innerHTML = html; b.hidden = false; b.onclick = onclick || null;
}

async function checkBanners() {
  let apk = null;
  try { apk = await (await fetch('apk.json', { cache: 'no-store' })).json(); } catch { }
  if (IS_APP) {
    let mine = 0; try { mine = +Android.versionCode(); } catch { }
    if (apk && apk.versionCode > mine) {
      banner(`<i class="upd-ico">⬆</i><b>${L('Nueva versión de la app')}</b><span>${L('Toca para descargarla')}</span>`, () => Android.openUrl(new URL('LoLBuilds.apk', location.href).href));
    }
  } else if (IS_ANDROID && apk) {
    banner(`<i class="upd-ico">⬇</i><b>${L('App de Android con overlay')}</b><span>${L('Descarga el APK para ver compos y recetas encima de TFT')}</span>`, () => { location.href = 'LoLBuilds.apk'; });
  } else if (IS_IOS && !STANDALONE) {
    banner(`<i class="upd-ico">＋</i><b>${L('Instálala en tu iPhone')}</b><span>${L('Compartir → «Agregar a inicio»')}</span>`);
  }
}

document.getElementById('langBtn').textContent = LANG === 'es' ? 'EN' : 'ES';
document.getElementById('langBtn').onclick = () => { LB_PREFS.setLang(LANG === 'es' ? 'en' : 'es'); location.reload(); };

window.addEventListener('hashchange', mRoute);
mRoute();
checkBanners();
// data is refreshed on GitHub every few hours: reload it when coming back to the app
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - (window._lastLoad || 0) > 30 * 60 * 1000) {
    tftCompsP = tftStatsP = null; memo.clear(); window._lastLoad = Date.now(); mRoute();
  }
});
window._lastLoad = Date.now();
