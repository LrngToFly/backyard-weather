/* Backyard Weather: the Weather Underground station. Live readings, today's high and low, rain totals
   (7 days, month, year), 5-minute day charts, and the daily summaries the model scorecard compares against. */
'use strict';

var station = null;

// ---------------------------------------------------------------- live readings
async function loadStation() {
  if (demo) { station = makeDemoStation(); renderStation(); return; }
  if (!settings.apiKey) { station = null; renderStation('nokey'); return; }
  try {
    var r = await fetch(wuUrl('observations/current'), { cache: 'no-store' });
    if (r.status === 204) throw new Error('No recent report from this station (HTTP 204)');
    if (r.status === 401 || r.status === 403) throw new Error('Weather Underground rejected the key (HTTP ' + r.status + ')');
    if (!r.ok) throw new Error('Weather Underground HTTP ' + r.status);
    var j = await r.json();
    var o = j.observations && j.observations[0];
    if (!o) throw new Error('No observation in the response');
    var im = o.imperial || {};
    station = {
      temp: im.temp, heatIndex: im.heatIndex, windChill: im.windChill, dew: im.dewpt, wind: im.windSpeed, gust: im.windGust,
      pressure: im.pressure, rate: im.precipRate, rainToday: im.precipTotal, hum: o.humidity, dir: o.winddir, uv: o.uv,
      lat: o.lat, lon: o.lon, solar: o.solarRadiation, epoch: o.epoch ? o.epoch * 1000 : (o.obsTimeUtc ? Date.parse(o.obsTimeUtc) : Date.now()), fetchedAt: Date.now()
    };
    if (isFinite(o.lat) && isFinite(o.lon) && o.lat !== null && o.lon !== null && (o.lat !== 0 || o.lon !== 0)) store.set('wx.loc', { lat: +o.lat, lon: +o.lon, id: settings.stationId });
    log('Station OK (' + settings.stationId + ')');
    renderStation(); renderDaylight();
  } catch (e) {
    log('Station error: ' + friendlyError(e));
    station = null; renderStation('error', friendlyError(e));
  }
}
function tile(k, v, u) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '<small>' + u + '</small></div></div>'; }
function renderStation(state, msg) {
  var box = el('station-body');
  if (state === 'nokey') {
    box.innerHTML = '<p class="muted">Add your free Weather Underground API key to see live readings from <b></b>.</p><button class="btn primary" data-action="settings">Add API key</button><div id="aq"></div>';
    box.querySelector('b').textContent = settings.stationId; renderAQ(); return;
  }
  if (!state && !station) { box.innerHTML = '<p class="muted">Loading…</p>'; return; }
  if (state === 'error' || !station) {
    box.innerHTML = '<p class="warn"></p><button class="btn" data-action="settings">Open settings</button><div id="aq"></div>';
    box.querySelector('.warn').textContent = msg || 'No station data yet.'; renderAQ(); return;
  }
  var s = station, feels = s.temp;
  if (s.temp >= 80 && s.heatIndex != null) feels = s.heatIndex; else if (s.temp <= 50 && s.windChill != null) feels = s.windChill;
  var age = Math.max(0, Math.round((Date.now() - s.epoch) / 60000));
  var ageTxt = age < 1 ? 'just now' : age < 60 ? age + ' min ago' : Math.round(age / 60) + ' h ago';
  var stale = age > 30;
  box.innerHTML =
    '<div class="hero"><div class="big">' + fmt(s.temp, 1) + '<small>°F</small></div><div class="hero-side"><div>Feels like ' + fmt(feels, 0) + '°</div>' +
    '<div id="hilo" class="hilo"></div>' +
    '<div class="muted' + (stale ? ' warn' : '') + '">Reported ' + ageTxt + '</div></div></div>' +
    '<div class="tiles">' +
    tile('Humidity', fmt(s.hum, 0), '%') + tile('Dew point', fmt(s.dew, 0), '°') +
    tile('Wind', fmt(s.wind, 1), ' mph ' + (s.dir != null ? compass(s.dir) : '')) + tile('Gusts', fmt(s.gust, 1), ' mph') +
    tile('Pressure', fmt(s.pressure, 2), ' inHg') + tile('Rain today', fmt(s.rainToday, 2), ' in') +
    tile('Rain rate', fmt(s.rate, 2), ' in/hr') + tile('UV / Solar', fmt(s.uv, 0) + ' / ' + fmt(s.solar, 0), ' W/m²') +
    '</div><div id="rain-tot"></div><div id="aq"></div><div class="muted small" id="compare"></div>';
  renderHiLo(); renderRainTotals(); renderAQ(); updateCompare();
}
// today's high and low from the 5-minute history plus the latest reading
function renderHiLo() {
  var box = el('hilo'); if (!box) return;
  var h = histCache[ymd(dayStart(0))], hi = -Infinity, lo = Infinity;
  if (h) h.rows.forEach(function (r) { if (r.temp !== null) { hi = Math.max(hi, r.temp); lo = Math.min(lo, r.temp); } });
  if (station && station.temp != null) { hi = Math.max(hi, station.temp); lo = Math.min(lo, station.temp); }
  box.textContent = hi === -Infinity ? '' : 'High ' + fmt(hi, 1) + '° · Low ' + fmt(lo, 1) + '°';
}
function updateCompare() {
  var c = el('compare'); if (!c || !station) return;
  var e = modelNow(); if (e === null) { c.textContent = ''; return; }
  var d = station.temp - e;
  c.textContent = 'The ' + curPt().label + ' has ' + e.toFixed(0) + '° for your backyard right now; your station reads ' + Math.abs(d).toFixed(1) + '° ' + (d >= 0 ? 'warmer' : 'colder') + '.';
}

// ---------------------------------------------------------------- daily summaries kept on the device
// obsDays['YYYYMMDD'] = { hi, lo, rain } for finished days, or { none: true } when the station reported nothing that day.
var obsDays = null, obsLoaded = '';
async function loadObsStore() {
  if (obsDays && obsLoaded === settings.stationId) return obsDays;
  var o = demo ? null : await idb.get('obs-' + settings.stationId);
  obsDays = demo ? makeDemoObs() : (o && o.days) || {}; obsLoaded = settings.stationId;
  return obsDays;
}
function saveObs() {
  if (demo || !obsDays) return;
  var cut = ymd(dayStart(400));
  Object.keys(obsDays).forEach(function (k) { if (k < cut) delete obsDays[k]; });
  idb.set('obs-' + settings.stationId, { days: obsDays });
}
function obsFromImperial(im) { return { hi: num(im.tempHigh), lo: num(im.tempLow), rain: num(im.precipTotal) }; }
// last 7 days in one request (at most every 3 hours)
async function loadDailySummaries(force) {
  if (demo || !settings.apiKey) return;
  await loadObsStore();
  var last = store.get('wx.sumAt', 0);
  if (!force && Date.now() - last < 3 * 3600000) return;
  try {
    var r = await fetch(wuUrl('dailysummary/7day'), { cache: 'no-store' });
    if (r.status === 204) return;
    if (!r.ok) throw new Error('Weather Underground HTTP ' + r.status);
    var j = await r.json(), today = ymd(dayStart(0)), n = 0;
    (j.summaries || []).forEach(function (s) {
      var ds = String(s.obsTimeLocal || '').slice(0, 10).replace(/-/g, '');
      if (ds.length !== 8 || ds >= today) return;
      obsDays[ds] = obsFromImperial(s.imperial || {}); n++;
    });
    store.set('wx.sumAt', Date.now()); saveObs();
    log('Station daily summaries: ' + n + ' days');
  } catch (e) { log('Station daily summaries error: ' + friendlyError(e)); }
}
// Fill in older days one at a time (newest first), gently: one request every 2.5 s, at most 40 per visit and 150 a day.
// Covers this year (for the rain totals) and at least the last 62 days (for the scorecard).
var backfilling = false, backfillLeft = 0;
async function backfillObs() {
  if (backfilling || demo || !settings.apiKey) return;
  backfilling = true;
  try {
    await loadObsStore();
    var need = [], jan1 = ymd(new Date(new Date().getFullYear(), 0, 1));
    for (var i = 1; i <= 400; i++) { var ds = ymd(dayStart(i)); if (i > 62 && ds < jan1) break; if (!obsDays[ds]) need.push(ds); }
    backfillLeft = need.length;
    var today = ymd(dayStart(0)), cnt = store.get('wx.bfCount', { day: '', n: 0 });
    if (cnt.day !== today) cnt = { day: today, n: 0 };
    var session = 0;
    for (var k = 0; k < need.length; k++) {
      if (session >= 40 || cnt.n >= 150 || document.visibilityState !== 'visible') break;
      var r = await fetch(wuUrl('history/daily', '&date=' + need[k]), { cache: 'no-store' });
      session++; cnt.n++; store.set('wx.bfCount', cnt);
      if (r.status === 204) obsDays[need[k]] = { none: true };
      else if (!r.ok) { log('Station history fill-in stopped: Weather Underground HTTP ' + r.status); break; }
      else {
        var j = await r.json(), o = j.observations && j.observations[0];
        obsDays[need[k]] = o ? obsFromImperial(o.imperial || {}) : { none: true };
      }
      backfillLeft--;
      if (session % 5 === 0) { saveObs(); renderRainTotals(); renderScore(); }
      await sleep(2500);
    }
    if (session) { saveObs(); log('Station history fill-in: ' + session + ' days loaded, ' + backfillLeft + ' still to go'); }
  } catch (e) { log('Station history fill-in error: ' + friendlyError(e)); }
  finally { backfilling = false; renderRainTotals(); renderScore(); }
}
function renderRainTotals() {
  var box = el('rain-tot'); if (!box) return;
  if (!obsDays || !station) { box.innerHTML = ''; return; }
  var now = new Date(), today = ymd(dayStart(0)), jan1 = ymd(new Date(now.getFullYear(), 0, 1)), m1 = ymd(new Date(now.getFullYear(), now.getMonth(), 1)), w1 = ymd(dayStart(6));
  var tot = { w: station.rainToday || 0, m: station.rainToday || 0, y: station.rainToday || 0 }, miss = { w: 0, m: 0, y: 0 };
  for (var i = 1; i <= 366; i++) {
    var ds = ymd(dayStart(i)); if (ds < jan1 && ds < w1) break;
    var o = obsDays[ds], has = o && (o.none || o.rain != null), r = o && o.rain ? o.rain : 0;
    if (ds >= w1) { if (has) tot.w += r; else miss.w++; }
    if (ds >= m1) { if (has) tot.m += r; else miss.m++; }
    if (ds >= jan1) { if (has) tot.y += r; else miss.y++; }
  }
  function t(label, k) { return '<div class="tile"><div class="k">' + label + '</div><div class="v">' + tot[k].toFixed(2) + '<small> in' + (miss[k] ? ' *' : '') + '</small></div></div>'; }
  var anyMiss = miss.w || miss.m || miss.y;
  box.innerHTML = '<div class="tiles rain-tiles">' + t('Rain 7 days', 'w') + t(now.toLocaleDateString([], { month: 'long' }), 'm') + t('Rain ' + now.getFullYear(), 'y') + '</div>' +
    (anyMiss ? '<p class="small muted">* Still loading past days from Weather Underground (' + Math.max(miss.y, miss.w) + ' to go); totals fill in over the next few visits.</p>' : '');
}

// ---------------------------------------------------------------- 5-minute day charts (history kept for 14 days)
var hist = null, histOffset = 0, histFetchedAt = 0, histCache = {}, histMsg = 'Loading…', hoverT = null;
function histKey(ds) { return 'hist-' + settings.stationId + '-' + ds; }
var histPruned = false;
async function pruneHist() {
  if (histPruned) return; histPruned = true;
  var cut = ymd(dayStart(HIST_KEEP_DAYS)), keys = await idb.keys();
  keys.forEach(function (k) { var m = /^hist-.*-(\d{8})$/.exec(k); if (m && m[1] < cut) idb.del(k); });
}
async function loadHistory(force) {
  var day = dayStart(histOffset), ds = ymd(day), t0 = day.getTime() / 1000, t1 = dayStart(histOffset - 1).getTime() / 1000;
  var label = histOffset === 0 ? 'Today' : histOffset === 1 ? 'Yesterday' : day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
  el('day-label').textContent = label + (histOffset <= 1 ? ' · ' + day.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');
  el('day-next').disabled = histOffset === 0; el('day-prev').disabled = histOffset >= HIST_KEEP_DAYS;
  histMsg = '';
  if (demo) { hist = makeDemoHistory(day, t0, t1); histCache[ds] = hist; histFetchedAt = Date.now(); renderHistory(); renderHiLo(); return; }
  if (!settings.apiKey) { hist = null; histMsg = 'Add your Weather Underground API key in Settings to see the station charts.'; renderHistory(); return; }
  var c = histCache[ds];
  if (!c && histOffset > 0) { c = await idb.get(histKey(ds)); if (c) histCache[ds] = c; }
  if (ds !== ymd(dayStart(histOffset))) return; // day changed while loading
  if (c && !force && (histOffset > 0 || Date.now() - c.fetchedAt < 240000)) { hist = c; histFetchedAt = c.fetchedAt; renderHistory(); return; }
  try {
    var r = await fetch(wuUrl('history/all', '&date=' + ds), { cache: 'no-store' });
    if (ds !== ymd(dayStart(histOffset))) return;
    if (r.status === 204) { hist = { ds: ds, t0: t0, t1: t1, rows: [], fetchedAt: Date.now() }; histMsg = 'No readings reported for this day.'; renderHistory(); return; }
    if (r.status === 401 || r.status === 403) throw new Error('Weather Underground rejected the key (HTTP ' + r.status + ')');
    if (!r.ok) throw new Error('Weather Underground HTTP ' + r.status);
    var j = await r.json(), obs = j.observations || [], rows = [];
    obs.forEach(function (o) {
      var im = o.imperial || {}, t = o.epoch || (o.obsTimeUtc ? Date.parse(o.obsTimeUtc) / 1000 : null);
      if (!t) return;
      rows.push({
        t: t, temp: num(im.tempAvg, im.temp, im.tempHigh), dew: num(im.dewptAvg, im.dewpt, im.dewptHigh),
        wind: num(im.windspeedAvg, im.windSpeed, im.windspeedHigh), gust: num(im.windgustHigh, im.windgustAvg, im.windGust),
        rate: num(im.precipRate), acc: num(im.precipTotal),
        pres: (im.pressureMax != null && im.pressureMin != null && !isNaN(im.pressureMax) && !isNaN(im.pressureMin)) ? (+im.pressureMax + +im.pressureMin) / 2 : num(im.pressureMax, im.pressureMin, im.pressure)
      });
    });
    rows.sort(function (a, b) { return a.t - b.t; });
    hist = { ds: ds, t0: t0, t1: t1, rows: rows, fetchedAt: Date.now() };
    histCache[ds] = hist; histFetchedAt = hist.fetchedAt;
    if (histOffset > 0 && rows.length) { idb.set(histKey(ds), hist); pruneHist(); summarizeDay(ds, rows); }
    log('Station history ' + ds + ': ' + rows.length + ' readings');
    if (!rows.length) histMsg = 'No readings reported for this day.';
  } catch (e) {
    log('Station history error: ' + friendlyError(e));
    hist = c || null; histMsg = 'Could not load station charts: ' + friendlyError(e);
  }
  renderHistory();
  if (histOffset === 0) renderHiLo();
}
// a full past day of 5-minute readings also gives that day's high, low and rain for free
async function summarizeDay(ds, rows) {
  await loadObsStore(); if (obsDays[ds]) return;
  var hi = -Infinity, lo = Infinity, rain = 0;
  rows.forEach(function (r) { if (r.temp !== null) { hi = Math.max(hi, r.temp); lo = Math.min(lo, r.temp); } if (r.acc !== null) rain = Math.max(rain, r.acc); });
  if (hi === -Infinity) return;
  obsDays[ds] = { hi: hi, lo: lo, rain: rain }; saveObs();
}
function niceTicks(lo, hi, n) {
  var span = Math.max(hi - lo, 1e-6), raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
  for (var v = a; v <= b + step * 0.001; v += step) out.push(+v.toFixed(6));
  return out;
}
function hourLabel(h) { var m = h % 24, ap = (m < 12) ? 'AM' : 'PM'; return (m % 12 === 0 ? 12 : m % 12) + ap; }
// chart definitions: which series sit on which chart
var HCHARTS = [
  { id: 'h-temp', zero: false, freeze: true, dp: 1, series: [
    { key: 'temp', name: 'Temperature', unit: '°F', color: '#a84a3e', type: 'line' }, { key: 'dew', name: 'Dew Point', unit: '°F', color: '#7f9f5e', type: 'line' }] },
  { id: 'h-wind', zero: true, dp: 1, series: [
    { key: 'wind', name: 'Wind Speed', unit: ' mph', color: '#4054a8', type: 'line' }, { key: 'gust', name: 'Gust', unit: ' mph', color: '#d19a55', type: 'dots' }] },
  { id: 'h-rain', zero: true, dp: 2, minMax: 0.4, series: [
    { key: 'acc', name: 'Precip. Accum. Total', unit: ' in', color: '#7ba3d8', type: 'line', dp: 2 }, { key: 'rate', name: 'Precip. Rate', unit: ' in/hr', color: '#7f9f5e', type: 'line', dp: 2 }] },
  { id: 'h-pres', zero: false, pad: 0.012, minSpan: 0.08, dp: 2, series: [
    { key: 'pres', name: 'Pressure', unit: ' in', color: 'text', type: 'line', dp: 2 }] }
];
function drawHChart(cfg) {
  var cv = el(cfg.id), W = Math.floor(cv.parentNode.getBoundingClientRect().width) || 320, H = clamp(Math.round(W * 0.46), 160, 230);
  var ctx = sizeCanvas(cv, W, H); ctx.clearRect(0, 0, W, H);
  var css = getComputedStyle(document.documentElement), tc = css.getPropertyValue('--muted').trim() || '#667', line = css.getPropertyValue('--line').trim() || '#ddd', tcol = css.getPropertyValue('--text').trim() || '#111';
  var scol = function (s) { return s.color === 'text' ? tcol : s.color; };
  var d = hist, rows = d ? d.rows : [], t0 = d ? d.t0 : dayStart(histOffset).getTime() / 1000, t1 = d ? d.t1 : t0 + 86400;
  var lo = Infinity, hi = -Infinity;
  rows.forEach(function (r) { cfg.series.forEach(function (s) { var v = r[s.key]; if (v !== null && v !== undefined) { if (v < lo) lo = v; if (v > hi) hi = v; } }); });
  if (lo === Infinity) { lo = cfg.zero ? 0 : 30; hi = cfg.zero ? 1 : 60; }
  if (cfg.zero) lo = 0;
  if (cfg.minMax) hi = Math.max(hi, cfg.minMax);
  if (!cfg.zero) { var pd2 = cfg.pad !== undefined ? cfg.pad : 0.6; lo -= pd2; hi += pd2; }
  if (cfg.minSpan && hi - lo < cfg.minSpan) { var mid = (hi + lo) / 2; lo = mid - cfg.minSpan / 2; hi = mid + cfg.minSpan / 2; }
  var ticks = niceTicks(lo, hi * (cfg.zero ? 1.04 : 1), H < 190 ? 4 : 5); lo = ticks[0]; hi = ticks[ticks.length - 1];
  var L = cfg.id === 'h-pres' ? 44 : 34, R = 10, T = 8, B = 22, pw = W - L - R, ph = H - T - B;
  function X(t) { return L + (t - t0) / (t1 - t0) * pw; }
  function Y(v) { return T + (1 - (v - lo) / (hi - lo)) * ph; }
  // shaded hour stripes
  ctx.fillStyle = tcol; ctx.globalAlpha = 0.055;
  for (var hh = 1; hh < 24; hh += 2) ctx.fillRect(X(t0 + hh * 3600), T, pw / 24, ph);
  ctx.globalAlpha = 1;
  ctx.font = '11px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  var tdp = cfg.id === 'h-pres' ? 2 : 0;
  ticks.forEach(function (v) { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke(); ctx.fillStyle = tc; ctx.fillText(tdp ? v.toFixed(tdp) : String(v), L - 5, Y(v)); });
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  var step = W < 480 ? 6 : 3;
  for (var h2 = 0; h2 <= 24; h2 += step) { var tx = clamp(X(t0 + h2 * 3600), L + 12, W - R - 12); ctx.fillStyle = tc; ctx.fillText(hourLabel(h2), tx, H - 6); }
  if (cfg.freeze && lo < 32 && hi > 32) { ctx.strokeStyle = '#1a4fb8'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(L, Y(32)); ctx.lineTo(W - R, Y(32)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#1a4fb8'; ctx.textAlign = 'left'; ctx.fillText('32°', L + 3, Y(32) - 3); }
  ctx.save(); ctx.beginPath(); ctx.rect(L, T - 2, pw, ph + 4); ctx.clip();
  cfg.series.forEach(function (s) {
    if (s.type === 'dots') {
      ctx.fillStyle = scol(s); rows.forEach(function (r) { var v = r[s.key]; if (v === null || v === undefined) return; ctx.beginPath(); ctx.arc(X(r.t), Y(v), 1.7, 0, 6.3); ctx.fill(); });
      return;
    }
    ctx.strokeStyle = scol(s); ctx.lineWidth = 1.9; ctx.lineJoin = 'round'; ctx.beginPath();
    var prevT = null;
    rows.forEach(function (r) {
      var v = r[s.key]; if (v === null || v === undefined) { prevT = null; return; }
      if (prevT === null || r.t - prevT > 1500) ctx.moveTo(X(r.t), Y(v)); else ctx.lineTo(X(r.t), Y(v));
      prevT = r.t;
    });
    ctx.stroke();
  });
  ctx.restore();
  ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, T + ph); ctx.lineTo(W - R, T + ph); ctx.stroke();
  if (!rows.length) { ctx.fillStyle = tc; ctx.textAlign = 'center'; ctx.fillText(histMsg || 'No data', L + pw / 2, T + ph / 2); }
  // hover / touch readout
  if (hoverT !== null && rows.length) {
    var best = null, bd = Infinity;
    rows.forEach(function (r) { var dd = Math.abs(r.t - hoverT); if (dd < bd) { bd = dd; best = r; } });
    if (best && bd < 1800) {
      var hx = X(best.t);
      ctx.strokeStyle = tc; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, T); ctx.lineTo(hx, T + ph); ctx.stroke();
      var lines = [new Date(best.t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })];
      cfg.series.forEach(function (s) { var v = best[s.key]; if (v !== null && v !== undefined) { ctx.fillStyle = scol(s); ctx.beginPath(); ctx.arc(hx, Y(v), 3.4, 0, 6.3); ctx.fill(); lines.push([s.color === 'text' ? '#e8eef4' : scol(s), s.name + ': ' + v.toFixed(s.dp !== undefined ? s.dp : cfg.dp) + s.unit]); } });
      readoutBox(ctx, W, hx, T + 4, lines);
    }
  }
  cfg._geo = { L: L, R: R, W: W, t0: t0, t1: t1 };
}
function renderHistory() {
  HCHARTS.forEach(drawHChart);
  var msg = el('hist-msg'); msg.hidden = !histMsg || (hist && hist.rows.length > 0 && !/Could not/.test(histMsg)); msg.textContent = histMsg;
  var sum = el('hist-sum'), rows = hist ? hist.rows : [];
  if (rows.length) {
    var hiT = -Infinity, loT = Infinity, pk = 0, rain = 0;
    rows.forEach(function (r) { if (r.temp !== null) { hiT = Math.max(hiT, r.temp); loT = Math.min(loT, r.temp); } if (r.gust !== null) pk = Math.max(pk, r.gust); if (r.acc !== null) rain = Math.max(rain, r.acc); });
    sum.textContent = 'High ' + fmt(hiT, 1) + '° · Low ' + fmt(loT, 1) + '° · Peak gust ' + fmt(pk, 1) + ' mph · Rain ' + fmt(rain, 2) + ' in';
  } else sum.textContent = '';
}
function initHistoryCharts() {
  HCHARTS.forEach(function (cfg) {
    var cv = el(cfg.id);
    tapReadout(cv, function (e) {
      var g = cfg._geo; if (!g) return;
      var x = e.clientX - cv.getBoundingClientRect().left;
      hoverT = g.t0 + clamp((x - g.L) / (g.W - g.L - g.R), 0, 1) * (g.t1 - g.t0); renderHistory();
    }, function () { if (hoverT !== null) { hoverT = null; renderHistory(); } }, function () { return hoverT !== null; });
  });
}
function setHistDay(delta) {
  histOffset = clamp(histOffset + delta, 0, HIST_KEEP_DAYS); hoverT = null; loadHistory(false);
}
