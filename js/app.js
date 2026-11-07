/* Backyard Weather: screen layout, settings, refreshing, pull-to-refresh, update notice and start-up. Loaded last. */
'use strict';

// ---------------------------------------------------------------- screen layout (phone / iPad portrait / iPad landscape)
// two columns on a landscape iPad: map, backyard forecast and scorecard on the left; station, daylight, charts and links on the right
var placedBig = null;
function placeCards(big) {
  if (placedBig === big) return; placedBig = big;
  var main = document.querySelector('main'), foot = document.querySelector('footer'), L = el('colL'), R = el('colR');
  if (big) { ['maps', 'point', 'score'].forEach(function (id) { L.appendChild(el(id)); }); ['station', 'daylight', 'today', 'tt'].forEach(function (id) { R.appendChild(el(id)); }); }
  else ['station', 'daylight', 'maps', 'point', 'score', 'today', 'tt'].forEach(function (id) { main.insertBefore(el(id), foot); });
}
function applyLayout() {
  var w = document.documentElement.clientWidth, mode = settings.layout || 'auto', cl = document.documentElement.classList, med, big;
  if (mode === 'phone') { med = false; big = false; }
  else if (mode === 'tablet') { med = true; big = w >= 900; }
  else { med = w >= 700; big = w >= 1000; }
  var changed = cl.contains('w-med') !== med || cl.contains('w-big') !== big;
  cl.toggle('w-med', med); cl.toggle('w-big', big);
  placeCards(big);
  return changed;
}
function renderAll() { scheduleRender(); renderPoint(); renderHistory(); }

// ---------------------------------------------------------------- settings + diagnostics
function openSettings() {
  el('set-key').value = settings.apiKey; el('set-airnow').value = settings.airnowKey || ''; el('set-station').value = settings.stationId; el('set-detail').value = settings.detail;
  el('set-demo').checked = !!demo; el('set-layout').value = settings.layout || 'auto';
  el('set-speed').value = clamp(+settings.playMs || 700, 250, 1500); showSpeed();
  var dlg = el('settings'); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
  el('diag-log').textContent = logLines.join('\n');
}
function showSpeed() { el('speed-val').textContent = (el('set-speed').value / 1000).toFixed(2).replace(/0$/, '') + ' s per frame'; }
function saveSettings() {
  var changedDetail = el('set-detail').value !== settings.detail, oldStation = settings.stationId, oldAir = settings.airnowKey;
  settings.apiKey = el('set-key').value.trim(); settings.airnowKey = el('set-airnow').value.trim();
  settings.stationId = (el('set-station').value.trim() || 'KMAHOPKI22').toUpperCase(); settings.detail = el('set-detail').value;
  settings.playMs = +el('set-speed').value || 700; settings.layout = el('set-layout').value;
  store.set('wx.settings', settings);
  if (playTimer) { stopPlay(); togglePlay(); }
  var wantDemo = el('set-demo').checked, demoChanged = wantDemo !== demo;
  demo = wantDemo; store.set('wx.demo', demo);
  el('settings').close();
  updateBanner(); setSubtitle();
  applyLayout(); renderAll();
  histCache = {};
  if (oldStation !== settings.stationId || demoChanged) { obsDays = null; scoreRes = null; store.del('wx.sumAt'); }
  if (changedDetail || demoChanged) { stepIdx = 0; refreshAll({ force: true }); }
  else { loadStation(); loadHistory(true); if (oldAir !== settings.airnowKey) loadAQ(true); afterStation(); }
}
async function runChecks() {
  var out = el('check-out'); out.textContent = 'Checking…'; var lines = [];
  function add(s) { lines.push(s); out.textContent = lines.join('\n'); log(s); }
  var keyNow = el('set-key').value.trim() || settings.apiKey, idNow = el('set-station').value.trim() || settings.stationId;
  function wu(path, extra) { return WU_BASE + path + '?stationId=' + encodeURIComponent(idNow) + '&format=json&units=e' + (extra || '') + '&apiKey=' + encodeURIComponent(keyNow); }
  async function http(label, url, opts) {
    try { var r = await fetch(url, Object.assign({ cache: 'no-store' }, opts || {})); add(label + ': HTTP ' + r.status + (r.ok ? ' ✓' : ' ✗')); return r; }
    catch (e) { add(label + ': FAILED – ' + friendlyError(e)); return null; }
  }
  if (!keyNow) add('Station: no Weather Underground key saved yet.');
  else {
    await http('Station now (Weather Underground)', wu('observations/current'));
    await http('Station 7-day summary', wu('dailysummary/7day'));
    await http('Station past-day summary', wu('history/daily', '&date=' + ymd(dayStart(2))));
  }
  var M = curModel(), L = homeLoc();
  var meta = await fetchMeta(M);
  add(M.short + ' latest run: ' + (meta ? runText(meta.init) + ' ✓' : 'could not check ✗'));
  try {
    var j3 = await omFetch(OM_BASE + M.ep + '?latitude=' + L.lat + '&longitude=' + L.lon + '&hourly=pressure_msl,precipitation,temperature_2m,snowfall&models=' + M.om + '&forecast_days=2&timeformat=unixtime&temporal_resolution=hourly_3');
    add(M.short + ' maps data: OK ✓ (' + (pick(j3.hourly, 'snowfall') || []).length + ' 3-hour values)');
  } catch (e) { add(M.short + ' maps data: FAILED – ' + friendlyError(e)); }
  try {
    var j2 = await omFetch(OM_BASE + 'ecmwf?latitude=' + L.lat + '&longitude=' + L.lon + '&hourly=precipitation_type&models=ecmwf_ifs025&forecast_days=1&timeformat=unixtime');
    add('Precip type available: yes ✓ (' + pick(j2.hourly, 'precipitation_type').length + ' values)');
  } catch (e) { add('Precip type available: no – ' + friendlyError(e) + ' (type will be estimated from temperature)'); }
  await http('Past forecasts (scorecard)', OM_PREV + '?latitude=' + L.lat + '&longitude=' + L.lon + '&hourly=temperature_2m_previous_day1&models=gfs_seamless&past_days=2&forecast_days=0');
  await http('NWS alerts', NWS_BASE + 'alerts/active?point=' + L.lat.toFixed(4) + ',' + L.lon.toFixed(4), { headers: { Accept: 'application/geo+json' } });
  var airNow = el('set-airnow').value.trim() || settings.airnowKey;
  if (airNow) await http('AirNow air quality', AIRNOW_BASE + 'observation/current/ziplatlong/?format=application/json&latitude=' + L.lat.toFixed(3) + '&longitude=' + L.lon.toFixed(3) + '&distance=25&API_KEY=' + encodeURIComponent(airNow));
  else add('AirNow: no key saved (the Open-Meteo estimate is used)');
}
async function clearSaved() {
  var keys = await idb.keys();
  await Promise.all(keys.filter(function (k) { return /^(grid|lev|hist|obs|score)/.test(k); }).map(function (k) { return idb.del(k); }));
  store.del('wx.hasType'); store.del('wx.sumAt'); stepCache.clear(); clearFrames(); obsDays = null; histCache = {};
  log('Saved data cleared'); el('check-out').textContent = 'Saved maps and station history cleared. They load again as needed.';
}

// ---------------------------------------------------------------- banners
function updateBanner() {
  var b = el('banner');
  if (demo) { b.hidden = false; b.className = 'banner demo'; b.textContent = 'Demo mode: made-up data for testing. Turn it off in Settings.'; return; }
  if (!isStandalone() && /iPhone|iPad/.test(navigator.userAgent) && !store.get('wx.tipDismissed', false)) {
    b.hidden = false; b.className = 'banner tip';
    b.innerHTML = '<span>Tip: tap <b>Share</b>, then <b>Add to Home Screen</b> to get a full-screen app icon.</span><button type="button" data-action="dismiss-tip" aria-label="Dismiss">✕</button>';
    return;
  }
  b.hidden = true;
}
function isStandalone() { return window.navigator.standalone === true || !!(window.matchMedia && matchMedia('(display-mode: standalone)').matches); }
function setSubtitle() { document.querySelector('.sub').textContent = HOME_NAME + ' · ' + settings.stationId; }

// ---------------------------------------------------------------- refreshing
// opts.force: download the maps even if the saved run is current (after changing map detail or demo mode).
// The refresh button and pull-to-refresh always reload the station; maps only when a newer model run is out.
var refreshing = false;
async function refreshAll(opts) {
  opts = opts || {};
  if (refreshing && !opts.force) return;
  refreshing = true;
  var btn = el('refresh'); btn.classList.add('spin');
  try {
    await Promise.all([loadStation(), loadPoint(!!opts.force), loadGrid({ force: !!opts.force }), loadHistory(histOffset === 0),loadAlerts(true), loadAQ(!!opts.force)]);
    renderPoint(); updateCompare(); scheduleRender();
    afterStation();
  } finally { refreshing = false; btn.classList.remove('spin'); }
}
// things that need the station's history: rain totals and the scorecard (they fill in quietly in the background)
async function afterStation() {
  await loadObsStore(); renderRainTotals();
  await loadDailySummaries(false); renderRainTotals();
  await loadScore(false);
  backfillObs();
}

// ---------------------------------------------------------------- pull to refresh (Home Screen app only; Safari has its own)
function initPullToRefresh() {
  if (!isStandalone() && params.get('ptr') !== '1') return;
  var ind = el('ptr'), y0 = null, pull = 0, NEED = 70;
  function setPull(p) {
    pull = p; ind.style.transform = 'translate(-50%,' + (Math.min(p, NEED + 20) - 44) + 'px) rotate(' + Math.min(p / NEED, 1) * 270 + 'deg)';
    ind.style.opacity = String(Math.min(p / NEED, 1)); ind.classList.toggle('ready', p >= NEED);
  }
  document.addEventListener('touchstart', function (e) {
    if (window.scrollY > 0 || e.touches.length !== 1 || refreshing) { y0 = null; return; }
    if (e.target.closest && e.target.closest('input, select, dialog, canvas.readout, #map')) { y0 = null; return; }
    y0 = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchmove', function (e) {
    if (y0 === null) return;
    var dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { setPull(0); return; }
    setPull(dy * 0.55);
  }, { passive: true });
  document.addEventListener('touchend', function () {
    if (y0 === null) return;
    y0 = null;
    if (pull >= NEED) {
      ind.classList.add('busy'); setPull(NEED);
      refreshAll({}).then(function () { ind.classList.remove('busy'); setPull(0); });
    } else setPull(0);
  }, { passive: true });
}

// ---------------------------------------------------------------- offline copy + automatic updates (service worker)
function initServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').catch(function (e) { log('Offline copy not available: ' + friendlyError(e)); });
  navigator.serviceWorker.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'updated') return;
    log('A new version of the app was downloaded');
    var u = el('update'); u.hidden = false;
  });
}

// ---------------------------------------------------------------- start-up
function init() {
  setSubtitle();
  applyLayout(); renderDaylight();
  buildModelPicker(); buildLinks(); buildPtTabs(); buildTabs(); buildSnowSeg(); updateBanner();
  initHistoryCharts(); initPointChart(); initPullToRefresh(); initServiceWorker();
  el('day-prev').addEventListener('click', function () { setHistDay(1); });
  el('day-next').addEventListener('click', function () { setHistDay(-1); });
  el('model').addEventListener('change', function (e) { switchModel(e.target.value); });
  el('tt-model').addEventListener('change', function (e) { ttModelId = e.target.value; store.set('wx.ttmodel', ttModelId); buildLinks(); });
  el('slider').addEventListener('input', function (e) { stopPlay(); setStep(+e.target.value); });
  el('prev').addEventListener('click', function () { stopPlay(); setStep(stepIdx - 1); });
  el('next').addEventListener('click', function () { stopPlay(); setStep(stepIdx + 1); });
  el('play').addEventListener('click', togglePlay);
  el('refresh').addEventListener('click', function () { refreshAll({}); });
  el('open-settings').addEventListener('click', openSettings);
  el('set-save').addEventListener('click', function (e) { e.preventDefault(); saveSettings(); });
  el('set-cancel').addEventListener('click', function () { el('settings').close(); });
  el('set-check').addEventListener('click', runChecks);
  el('set-speed').addEventListener('input', showSpeed);
  el('set-clear').addEventListener('click', clearSaved);
  el('update-reload').addEventListener('click', function () { location.reload(); });
  document.body.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('[data-action]'); if (!a) return;
    if (a.dataset.action === 'settings') openSettings();
    if (a.dataset.action === 'dismiss-tip') { store.set('wx.tipDismissed', true); updateBanner(); }
  });
  var rz; window.addEventListener('resize', function () { applyLayout(); clearTimeout(rz); rz = setTimeout(function () { applyLayout(); renderAll(); }, 120); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState !== 'visible') return;
    renderDaylight();
    if (!station || Date.now() - station.fetchedAt > 60000) loadStation();
    if (histOffset === 0 && Date.now() - histFetchedAt > 240000) loadHistory(true);
    loadAlerts(false); loadAQ(false);
    if (!demo && Date.now() - gridCheckedAt > 10 * 60000) loadGrid({}).then(scheduleRender);
    if (!demo && Date.now() - pointFetchedAt > 3600000) loadPoint(false).then(function () { renderPoint(); updateCompare(); });
    afterStation();
  });
  setInterval(function () {
    if (document.visibilityState !== 'visible') return;
    renderDaylight(); loadStation(); loadAlerts(false);
    if (histOffset === 0 && Date.now() - histFetchedAt > 290000) loadHistory(true);
    if (!demo && Date.now() - gridCheckedAt > 15 * 60000) loadGrid({}).then(scheduleRender);
  }, 60000);
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', renderAll);
  renderStation(settings.apiKey || demo ? undefined : 'nokey');
  renderScore();
  refreshAll({});
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
