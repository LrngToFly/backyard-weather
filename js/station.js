/* Backyard Weather: the Weather Underground station. Live readings, today's high and low, rain totals
   (7 days, month, year), station charts by day, week, month and year, and the daily summaries the model scorecard compares against. */
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
      temp: im.temp, heatIndex: im.heatIndex, windChill: im.windChill, dew: im.dewpt, wind: windOk(im.windSpeed), gust: windOk(im.windGust),
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
  var cut = ymd(dayStart(1500)); // about 4 years of daily summaries (a few hundred KB)
  Object.keys(obsDays).forEach(function (k) { if (k < cut) delete obsDays[k]; });
  idb.set('obs-' + settings.stationId, { days: obsDays });
}
// v: 2 = also has dew point, wind, gust and pressure (for the month and year charts)
function obsFromImperial(im) {
  return { v: 2, hi: num(im.tempHigh), lo: num(im.tempLow), rain: num(im.precipTotal), dew: num(im.dewptAvg, im.dewpt), wmax: windOk(num(im.windspeedHigh)),
    gust: windOk(num(im.windgustHigh)), pmax: num(im.pressureMax), pmin: num(im.pressureMin) };
}
function needsObs(o) { return !o || (!o.none && o.v !== 2); }
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
// Fill in past days with Weather Underground's daily history, up to 31 days per request (one calendar month at a time,
// newest first, one request every 2.5 s). Covers this year (rain totals, YTD) and the last 62 days (scorecard);
// older months load when you open them in the Month view.
var backfilling = false, backfillLeft = 0, obsBusy = false;
// fetch daily summaries for every day from `from` to `to` (YYYYMMDD, inclusive) that isn't saved yet, a month per request
async function ensureObsRange(from, to, maxReq) {
  await loadObsStore();
  var today = ymd(dayStart(0)), months = [], made = 0;
  if (to >= today) to = ymd(dayStart(1));
  for (var d = dsDate(to); ymd(d) >= from; d = new Date(d.getFullYear(), d.getMonth(), 0)) { // newest month first
    var m0 = new Date(d.getFullYear(), d.getMonth(), 1), a = ymd(m0) < from ? from : ymd(m0), b = ymd(d);
    var need = false;
    for (var x = dsDate(a); ymd(x) <= b; x.setDate(x.getDate() + 1)) if (needsObs(obsDays[ymd(x)])) { need = true; break; }
    if (need) months.push([a, b]);
  }
  backfillLeft = months.length;
  // at most 60 month requests a day (Weather Underground allows 1,500 requests a day in all)
  var cnt = store.get('wx.histReq', { day: '', n: 0 });
  if (cnt.day !== today) cnt = { day: today, n: 0 };
  for (var k = 0; k < months.length; k++) {
    if (made >= (maxReq || 20) || cnt.n >= 60) break;
    if (made) await sleep(2500);
    var r = await fetch(wuUrl('history/daily', '&startDate=' + months[k][0] + '&endDate=' + months[k][1]), { cache: 'no-store' });
    made++; cnt.n++; store.set('wx.histReq', cnt);
    if (!r.ok && r.status !== 204) { log('Station history fill-in stopped: Weather Underground HTTP ' + r.status); break; }
    var got = {};
    if (r.status !== 204) ((await r.json()).observations || []).forEach(function (o) {
      var ds = String(o.obsTimeLocal || '').slice(0, 10).replace(/-/g, '');
      if (ds.length === 8 && ds < today) { obsDays[ds] = obsFromImperial(o.imperial || {}); got[ds] = 1; }
    });
    for (var y = dsDate(months[k][0]); ymd(y) <= months[k][1]; y.setDate(y.getDate() + 1)) if (!got[ymd(y)] && !obsDays[ymd(y)]) obsDays[ymd(y)] = { none: true };
    backfillLeft--; saveObs();
    log('Station history ' + months[k][0].slice(0, 6) + ': ' + Object.keys(got).length + ' days');
    renderRainTotals(); renderScore();
  }
  return made;
}
async function backfillObs() {
  if (backfilling || demo || !settings.apiKey) return;
  backfilling = true;
  try {
    var jan1 = new Date(new Date().getFullYear(), 0, 1), d62 = dayStart(62);
    await queueObsRange(ymd(d62 < jan1 ? d62 : jan1), ymd(dayStart(1)), 20);
  } catch (e) { log('Station history fill-in error: ' + friendlyError(e)); }
  finally { backfilling = false; renderRainTotals(); renderScore(); refreshDailyCharts(); }
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

// ---------------------------------------------------------------- station charts: Day (5-minute), Week (hourly), Month and YTD (daily)
// Day: one day of 5-minute readings (past days kept for 14 days). Week: the last 7 days of hourly readings, one request.
// Month (last 30 days) and YTD: one point per day from the daily summaries the rain totals and scorecard also use.
var hist = null, histOffset = 0, histFetchedAt = 0, histCache = {}, histMsg = 'Loading…', hoverT = null;
var histRange = store.get('wx.histrange', 'day');
if (['day', 'week', 'month', 'ytd'].indexOf(histRange) < 0) histRange = 'day';
var weekOffset = 0, monthOffset = 0, yearOffset = 0, weekCache = {};   // 0 = this week / month / year; 1 = the one before, and so on
var WEEK_BACK = 156, MONTH_BACK = 36, YEAR_BACK = 3, weekLoads = {};                    // how far back the arrows go (3 years)
function histKey(ds) { return 'hist-' + settings.stationId + '-' + ds; }
var histPruned = false;
async function pruneHist() {
  if (histPruned) return; histPruned = true;
  var cut = ymd(dayStart(HIST_KEEP_DAYS)), keys = await idb.keys();
  keys.forEach(function (k) { var m = /^hist-.*-(\d{8})$/.exec(k); if (m && m[1] < cut) idb.del(k); });
}
// rows from Weather Underground history/all or hourly/7day observations
function parseObsRows(obs) {
  var rows = [];
  (obs || []).forEach(function (o) {
    var im = o.imperial || {}, t = o.epoch || (o.obsTimeUtc ? Date.parse(o.obsTimeUtc) / 1000 : null);
    if (!t) return;
    rows.push({
      t: t, temp: num(im.tempAvg, im.temp, im.tempHigh), dew: num(im.dewptAvg, im.dewpt, im.dewptHigh),
      wind: windOk(num(im.windspeedAvg, im.windSpeed, im.windspeedHigh)), gust: windOk(num(im.windgustHigh, im.windgustAvg, im.windGust)),
      rate: num(im.precipRate), acc: num(im.precipTotal),
      pres: (im.pressureMax != null && im.pressureMin != null && !isNaN(im.pressureMax) && !isNaN(im.pressureMin)) ? (+im.pressureMax + +im.pressureMin) / 2 : num(im.pressureMax, im.pressureMin, im.pressure)
    });
  });
  rows.sort(function (a, b) { return a.t - b.t; });
  return rows;
}
// calendar weeks (Sunday to Saturday) and months, like wunderground.com; the current one runs to today
function weekStart(off) { var d = dayStart(0); d.setDate(d.getDate() - d.getDay() - 7 * off); return d; }
function rangeBounds() {
  var from, to;
  if (histRange === 'week') { from = weekStart(weekOffset); to = weekOffset === 0 ? dayStart(-1) : new Date(from.getFullYear(), from.getMonth(), from.getDate() + 7); }
  else if (histRange === 'month') { var n = new Date(); from = new Date(n.getFullYear(), n.getMonth() - monthOffset, 1); to = monthOffset === 0 ? dayStart(-1) : new Date(from.getFullYear(), from.getMonth() + 1, 1); }
  else { var y = new Date().getFullYear() - yearOffset; from = new Date(y, 0, 1); to = yearOffset === 0 ? dayStart(-1) : new Date(y + 1, 0, 1); }
  return { from: from, to: to, last: new Date(to.getFullYear(), to.getMonth(), to.getDate() - 1) };
}
// "Oct 25 – Oct 31, 2026", or "Dec 28, 2025 – Jan 3, 2026" across a new year
// readings saved before the 60 mph limit existed
function cleanWind(rows) { (rows || []).forEach(function (r) { r.wind = windOk(r.wind); r.gust = windOk(r.gust); }); }
function rangeLabel() {
  var b = rangeBounds(), o = { month: 'short', day: 'numeric' }, y = b.from.getFullYear() !== b.last.getFullYear();
  return b.from.toLocaleDateString([], y ? { month: 'short', day: 'numeric', year: 'numeric' } : o) + ' – ' + b.last.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}
function updateNav() {
  var off = histRange === 'week' ? weekOffset : histRange === 'month' ? monthOffset : histRange === 'ytd' ? yearOffset : histOffset;
  var max = histRange === 'week' ? WEEK_BACK : histRange === 'month' ? MONTH_BACK : histRange === 'ytd' ? YEAR_BACK : HIST_KEEP_DAYS;
  var unit = histRange === 'week' ? 'week' : histRange === 'month' ? 'month' : histRange === 'ytd' ? 'year' : 'day';
  el('day-prev').hidden = el('day-next').hidden = false;
  el('day-prev').disabled = off >= max; el('day-next').disabled = off === 0;
  el('day-prev').setAttribute('aria-label', 'Previous ' + unit); el('day-next').setAttribute('aria-label', 'Next ' + unit);
}
async function loadHistory(force) {
  el('hist-chip').textContent = histRange === 'day' ? '5-min' : histRange === 'week' ? 'hourly' : 'daily';
  updateNav();
  if (histRange !== 'day') {
    el('day-label').textContent = rangeLabel();
    await loadDay(force, true, 0); // today's 5-minute readings: the high/low and the latest point
    if (histRange === 'week') return loadWeek(force);
    return loadDaily();
  }
  return loadDay(force, false, histOffset);
}
async function loadDay(force, quiet, off) {
  var day = dayStart(off), ds = ymd(day), t0 = day.getTime() / 1000, t1 = dayStart(off - 1).getTime() / 1000;
  function away() { return !quiet && (histRange !== 'day' || histOffset !== off); } // switched to another day or view while loading
  if (!quiet) {
    var label = off === 0 ? 'Today' : off === 1 ? 'Yesterday' : day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    el('day-label').textContent = label + (off <= 1 ? ' · ' + day.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');
    histMsg = '';
  }
  function show(h) { if (!quiet) { hist = h; renderHistory(); } }
  if (demo) { var dh = makeDemoHistory(day, t0, t1); dh.kind = '5min'; histCache[ds] = dh; histFetchedAt = Date.now(); show(dh); renderHiLo(); return; }
  if (!settings.apiKey) { if (!quiet) { hist = null; histMsg = 'Add your Weather Underground API key in Settings to see the station charts.'; renderHistory(); } return; }
  var c = histCache[ds];
  if (!c && off > 0) { c = await idb.get(histKey(ds)); if (c) { c.kind = '5min'; cleanWind(c.rows); histCache[ds] = c; } }
  if (away()) return;
  if (c && !force && (off > 0 || Date.now() - c.fetchedAt < 240000)) { if (off === 0) histFetchedAt = c.fetchedAt; show(c); return; }
  try {
    var r = await fetch(wuUrl('history/all', '&date=' + ds), { cache: 'no-store' });
    if (r.status === 204) { show({ kind: '5min', ds: ds, t0: t0, t1: t1, rows: [], fetchedAt: Date.now() }); if (!quiet) { histMsg = 'No readings reported for this day.'; renderHistory(); } return; }
    if (r.status === 401 || r.status === 403) throw new Error('Weather Underground rejected the key (HTTP ' + r.status + ')');
    if (!r.ok) throw new Error('Weather Underground HTTP ' + r.status);
    var j = await r.json(), rows = parseObsRows(j.observations);
    var h = { kind: '5min', ds: ds, t0: t0, t1: t1, rows: rows, fetchedAt: Date.now() };
    histCache[ds] = h; if (off === 0) histFetchedAt = h.fetchedAt;
    if (off > 0 && rows.length) { idb.set(histKey(ds), h); pruneHist(); summarizeDay(ds, rows); }
    log('Station history ' + ds + ': ' + rows.length + ' readings');
    if (!quiet && !rows.length) histMsg = 'No readings reported for this day.';
    if (away()) return;
    show(h);
  } catch (e) {
    log('Station history error: ' + friendlyError(e));
    if (!quiet) { hist = c || null; histMsg = 'Could not load station charts: ' + friendlyError(e); renderHistory(); }
  }
  if (off === 0) renderHiLo();
}
// the last 7 days, hourly, in one request (kept for 10 minutes)
// Weather Underground request that also says whether the key is being throttled (it answers 401 "API key is throttled")
async function wuGet(path, extra) {
  var r = await fetch(wuUrl(path, extra), { cache: 'no-store' }), txt = r.status === 204 ? '' : await r.text(), body = null;
  try { body = txt ? JSON.parse(txt) : null; } catch (e) { /* not JSON */ }
  return { status: r.status, ok: r.ok, body: body, throttled: r.status === 429 || /throttl/i.test(txt) };
}
function wuFail(r) {
  if (r.throttled) return new Error('Weather Underground is temporarily limiting requests for your key; try again in a while');
  if (r.status === 401 || r.status === 403) return new Error('Weather Underground rejected the key (HTTP ' + r.status + ')');
  return new Error('Weather Underground HTTP ' + r.status);
}
// This week: the last-7-days hourly feed. Past weeks: the hourly history for the week (one request); if Weather Underground
// is limiting that service, the week is built from the 5-minute history instead (one request per day, like the Day view).
async function fetchWeekRows(b, key, cur, t0) {
  function obs(r) { return parseObsRows(r.body && r.body.observations); }
  if (cur) {
    var r0 = await wuGet('observations/hourly/7day');
    if (!r0.ok && r0.status !== 204) throw wuFail(r0);
    return obs(r0).filter(function (x) { return x.t >= t0; });
  }
  var r = await wuGet('history/hourly', '&startDate=' + key + '&endDate=' + ymd(b.last));
  if (r.ok || r.status === 204) return obs(r);
  if (!r.throttled && r.status !== 401) throw wuFail(r);
  log('Hourly history is limited right now; building the week of ' + key + ' from 5-minute readings');
  var rows = [];
  for (var d = new Date(b.from); d < b.to; d.setDate(d.getDate() + 1)) {
    var ds = ymd(d), c = histCache[ds] || await idb.get(histKey(ds));
    if (!c) {
      var r2 = await wuGet('history/all', '&date=' + ds);
      if (!r2.ok && r2.status !== 204) throw wuFail(r2);
      c = { kind: '5min', rows: obs(r2) };
      await sleep(1200);
    }
    rows = rows.concat(c.rows.map(function (x) { return Object.assign({}, x); }));
  }
  return rows;
}
// one calendar week of hourly readings (past weeks are saved on the device)
async function loadWeek(force) {
  var b = rangeBounds(), key = ymd(b.from), off = weekOffset, cur = off === 0;
  var t0 = b.from.getTime() / 1000, t1 = cur ? Date.now() / 1000 : b.to.getTime() / 1000;
  function stale() { return histRange !== 'week' || weekOffset !== off; }
  histMsg = '';
  if (demo) { hist = makeDemoWeek(t0, t1); renderHistory(); return; }
  if (!settings.apiKey) { hist = null; histMsg = 'Add your Weather Underground API key in Settings to see the station charts.'; renderHistory(); return; }
  var c = weekCache[key];
  if (!c && !cur) { c = await idb.get('week-' + settings.stationId + '-' + key); if (c) { cleanWind(c.rows); weekCache[key] = c; } }
  if (stale()) return;
  if (c && (!cur || Date.now() - c.fetchedAt < (force ? 60000 : 600000))) { hist = c; renderHistory(); return; }
  hist = null; histMsg = 'Loading…'; renderHistory();
  try {
    // quick taps on the arrows can ask for the same week twice: share one download
    var p = weekLoads[key] || (weekLoads[key] = fetchWeekRows(b, key, cur, t0)
      .finally(function () { setTimeout(function () { delete weekLoads[key]; }, 5000); }));
    var rows = (await p).map(function (x) { return Object.assign({}, x); });
    if (weekCache[key] && weekCache[key].fetchedAt > Date.now() - 5000) { if (stale()) return; hist = weekCache[key]; renderHistory(); return; } // another tap already finished it
    // rain: Weather Underground's total restarts each midnight, so carry it on into a total for the week
    var carried = 0, dayTot = 0, lastDay = '';
    rows.forEach(function (x) {
      var d = ymd(new Date(x.t * 1000));
      if (d !== lastDay) { carried += dayTot; dayTot = 0; lastDay = d; }
      if (x.acc !== null) dayTot = Math.max(dayTot, x.acc);
      x.acc = x.acc === null ? null : carried + x.acc;
    });
    c = { kind: 'hourly', t0: t0, t1: t1, rows: rows, fetchedAt: Date.now() };
    weekCache[key] = c;
    if (!cur && rows.length) idb.set('week-' + settings.stationId + '-' + key, c);
    log('Station week of ' + key + ': ' + rows.length + ' readings');
    if (stale()) return;
    hist = c; histMsg = rows.length ? '' : 'No readings reported this week.';
  } catch (e) {
    log('Station week error: ' + friendlyError(e));
    if (stale()) return;
    hist = c || null; histMsg = 'Could not load this week: ' + friendlyError(e);
  }
  renderHistory();
}
function dayRow(ds, o) {
  var d = dsDate(ds);
  return { t: d.getTime() / 1000 + 43200, ds: ds, hi: o.hi, lo: o.lo, dew: o.dew != null ? o.dew : null, wmax: windOk(o.wmax), gust: windOk(o.gust),
    rain: o.rain, pmax: o.pmax != null ? o.pmax : null, pmin: o.pmin != null ? o.pmin : null };
}
function summarizeRows(rows) {
  var o = { v: 2, hi: -Infinity, lo: Infinity, rain: 0, dew: null, wmax: null, gust: null, pmax: null, pmin: null }, ds = 0, dn = 0;
  rows.forEach(function (r) {
    if (r.temp !== null) { o.hi = Math.max(o.hi, r.temp); o.lo = Math.min(o.lo, r.temp); }
    if (r.acc !== null) o.rain = Math.max(o.rain, r.acc);
    if (r.dew !== null) { ds += r.dew; dn++; }
    if (r.wind !== null) o.wmax = Math.max(o.wmax === null ? 0 : o.wmax, r.wind);
    if (r.gust !== null) o.gust = Math.max(o.gust === null ? 0 : o.gust, r.gust);
    if (r.pres !== null) { o.pmax = o.pmax === null ? r.pres : Math.max(o.pmax, r.pres); o.pmin = o.pmin === null ? r.pres : Math.min(o.pmin, r.pres); }
  });
  if (o.hi === -Infinity) return null;
  o.dew = dn ? ds / dn : null;
  return o;
}
// one point per day: a calendar month, or the year to date. Days not saved yet are loaded first (a month per request).
async function loadDaily() {
  histMsg = '';
  if (!demo && !settings.apiKey) { hist = null; histMsg = 'Add your Weather Underground API key in Settings to see the station charts.'; renderHistory(); return; }
  await loadObsStore();
  var b = rangeBounds(), want = histRange + monthOffset + '/' + yearOffset, today = ymd(dayStart(0));
  function stale() { return (histRange + monthOffset + '/' + yearOffset) !== want; }
  if (stale()) return;
  if (!demo) {
    var from = ymd(b.from), lastPast = ymd(b.last) < today ? ymd(b.last) : ymd(dayStart(1)), gaps = false;
    for (var x = new Date(b.from); ymd(x) <= lastPast; x.setDate(x.getDate() + 1)) if (needsObs(obsDays[ymd(x)])) { gaps = true; break; }
    if (gaps && from <= lastPast) {
      if (!hist || hist.kind !== 'daily') { hist = null; histMsg = 'Loading…'; renderHistory(); }
      await queueObsRange(from, lastPast, histRange === 'ytd' ? 12 : 2);
      if (stale()) return;
    }
  }
  var rows = [], missing = 0, acc = 0;
  for (var d = new Date(b.from); d < b.to; d.setDate(d.getDate() + 1)) {
    var ds = ymd(d), o = ds === today ? (histCache[ds] && summarizeRows(histCache[ds].rows)) : obsDays[ds];
    if (o && ds === today && station && station.rainToday > o.rain) o.rain = station.rainToday; // the live reading is ahead of the 5-minute history
    if (!o) { if (ds < today) missing++; continue; }
    if (o.none) continue;
    var row = dayRow(ds, o);
    if (row.rain != null) acc += row.rain;
    row.acc = acc; rows.push(row);
  }
  hist = { kind: 'daily', t0: b.from.getTime() / 1000, t1: b.to.getTime() / 1000, rows: rows, fetchedAt: Date.now() };
  histMsg = !rows.length ? 'No readings reported for these days.' : missing ? missing + ' day' + (missing === 1 ? '' : 's') + ' could not be loaded yet; they will be tried again on your next visit.' : '';
  renderHistory();
}
// one history download at a time (the background fill-in and the charts share it)
var obsQueue = Promise.resolve();
function queueObsRange(from, to, maxReq) {
  obsQueue = obsQueue.then(function () { return ensureObsRange(from, to, maxReq); }).catch(function (e) { log('Station history error: ' + friendlyError(e)); });
  return obsQueue;
}
function refreshDailyCharts() { if (histRange === 'month' || histRange === 'ytd') loadDaily(); }
function buildRangeSeg() {
  var box = el('hist-range'); box.innerHTML = '';
  [['day', 'Day'], ['week', 'Week'], ['month', 'Month'], ['ytd', 'Year']].forEach(function (o) {
    var b = mkEl('button', 'tab' + (histRange === o[0] ? ' on' : ''), o[1]); b.type = 'button';
    b.addEventListener('click', function () {
      if (histRange === o[0]) return;
      histRange = o[0]; store.set('wx.histrange', histRange); hoverT = null; buildRangeSeg();
      hist = null; histMsg = 'Loading…'; renderHistory();
      loadHistory(false);
    });
    box.appendChild(b);
  });
}
async function summarizeDay(ds, rows) {
  await loadObsStore(); if (!needsObs(obsDays[ds])) return;
  var o = summarizeRows(rows); if (!o) return;
  obsDays[ds] = o; saveObs();
}
function niceTicks(lo, hi, n) {
  var span = Math.max(hi - lo, 1e-6), raw = span / n, mag = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / mag;
  var step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  var a = Math.floor(lo / step) * step, b = Math.ceil(hi / step) * step, out = [];
  for (var v = a; v <= b + step * 0.001; v += step) out.push(+v.toFixed(6));
  return out;
}
function hourLabel(h) { var m = h % 24, ap = (m < 12) ? 'AM' : 'PM'; return (m % 12 === 0 ? 12 : m % 12) + ap; }
// chart definitions: which series sit on which chart. 5-minute and hourly readings share one set; daily summaries have their own.
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
var DCHARTS = [
  { id: 'h-temp', zero: false, freeze: true, dp: 1, series: [
    { band: ['lo', 'hi'], color: '#a84a3e' },
    { key: 'hi', name: 'High', unit: '°F', color: '#a84a3e', type: 'line' }, { key: 'lo', name: 'Low', unit: '°F', color: '#4f7bc4', type: 'line' },
    { key: 'dew', name: 'Dew Point (avg)', unit: '°F', color: '#7f9f5e', type: 'line' }] },
  { id: 'h-wind', zero: true, dp: 1, series: [
    { key: 'wmax', name: 'Highest Wind', unit: ' mph', color: '#4054a8', type: 'line' }, { key: 'gust', name: 'Peak Gust', unit: ' mph', color: '#d19a55', type: 'dots' }] },
  { id: 'h-rain', zero: true, dp: 2, minMax: 0.4, series: [
    { key: 'rain', name: 'Rain That Day', unit: ' in', color: '#7f9f5e', type: 'bars', dp: 2 }, { key: 'acc', name: 'Running Total', unit: ' in', color: '#7ba3d8', type: 'line', dp: 2 }] },
  { id: 'h-pres', zero: false, pad: 0.012, minSpan: 0.08, dp: 2, series: [
    { band: ['pmin', 'pmax'], color: 'text' },
    { key: 'pmax', name: 'Highest', unit: ' in', color: 'text', type: 'line', dp: 2 }, { key: 'pmin', name: 'Lowest', unit: ' in', color: '#8a96a3', type: 'line', dp: 2 }] }
];
function chartSet() { return hist && hist.kind === 'daily' ? DCHARTS : HCHARTS; }
function drawHChart(cfg) {
  var cv = el(cfg.id), W = Math.floor(cv.parentNode.getBoundingClientRect().width) || 320, H = clamp(Math.round(W * 0.46), 160, 230);
  var ctx = sizeCanvas(cv, W, H); ctx.clearRect(0, 0, W, H);
  var css = getComputedStyle(document.documentElement), tc = css.getPropertyValue('--muted').trim() || '#667', line = css.getPropertyValue('--line').trim() || '#ddd', tcol = css.getPropertyValue('--text').trim() || '#111';
  var scol = function (s) { return s.color === 'text' ? tcol : s.color; };
  var d = hist, kind = d ? d.kind || '5min' : (histRange === 'day' ? '5min' : histRange === 'week' ? 'hourly' : 'daily'), rows = d ? d.rows : [];
  var t0 = d ? d.t0 : dayStart(histOffset).getTime() / 1000, t1 = d ? d.t1 : t0 + 86400;
  var gap = kind === '5min' ? 1500 : kind === 'hourly' ? 3 * 3600 + 60 : 1.6 * 86400;
  var lo = Infinity, hi = -Infinity;
  rows.forEach(function (r) {
    cfg.series.forEach(function (s) {
      (s.band || [s.key]).forEach(function (k) { var v = r[k]; if (v !== null && v !== undefined) { if (v < lo) lo = v; if (v > hi) hi = v; } });
    });
  });
  if (lo === Infinity) { lo = cfg.zero ? 0 : 30; hi = cfg.zero ? 1 : 60; }
  if (cfg.zero) lo = 0;
  if (cfg.minMax) hi = Math.max(hi, cfg.minMax);
  if (!cfg.zero) { var pd2 = cfg.pad !== undefined ? cfg.pad : 0.6; lo -= pd2; hi += pd2; }
  if (cfg.minSpan && hi - lo < cfg.minSpan) { var mid = (hi + lo) / 2; lo = mid - cfg.minSpan / 2; hi = mid + cfg.minSpan / 2; }
  var ticks = niceTicks(lo, hi * (cfg.zero ? 1.04 : 1), H < 190 ? 4 : 5); lo = ticks[0]; hi = ticks[ticks.length - 1];
  var L = cfg.id === 'h-pres' ? 44 : 34, R = 10, T = 8, B = 22, pw = W - L - R, ph = H - T - B;
  function X(t) { return L + (t - t0) / (t1 - t0) * pw; }
  function Y(v) { return T + (1 - (v - lo) / (hi - lo)) * ph; }
  // shaded stripes: every other hour (day), day (week), week (month) or month (year)
  ctx.fillStyle = tcol; ctx.globalAlpha = 0.055;
  if (kind === '5min') { for (var hh = 1; hh < 24; hh += 2) ctx.fillRect(X(t0 + hh * 3600), T, pw / 24, ph); }
  else if (kind === 'hourly') { for (var sd = new Date(t0 * 1000), k1 = 0; sd.getTime() / 1000 < t1; sd.setDate(sd.getDate() + 1), k1++) { if (k1 % 2) { var a1 = Math.max(t0, sd.getTime() / 1000); var nd = new Date(sd); nd.setDate(nd.getDate() + 1); ctx.fillRect(X(a1), T, X(Math.min(t1, nd.getTime() / 1000)) - X(a1), ph); } } }
  else if (histRange === 'month') { for (var wk = t0 + 7 * 86400; wk < t1; wk += 14 * 86400) ctx.fillRect(X(wk), T, X(Math.min(t1, wk + 7 * 86400)) - X(wk), ph); }
  else { for (var mo = 1; mo < 12; mo += 2) { var ms = new Date(new Date(t0 * 1000).getFullYear(), mo, 1).getTime() / 1000, me = new Date(new Date(t0 * 1000).getFullYear(), mo + 1, 1).getTime() / 1000; if (ms < t1) ctx.fillRect(X(ms), T, X(Math.min(t1, me)) - X(ms), ph); } }
  ctx.globalAlpha = 1;
  ctx.font = '11px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'middle'; ctx.textAlign = 'right';
  var tdp = cfg.id === 'h-pres' ? 2 : 0;
  ticks.forEach(function (v) { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke(); ctx.fillStyle = tc; ctx.fillText(tdp ? v.toFixed(tdp) : String(v), L - 5, Y(v)); });
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = tc;
  // time labels along the bottom
  function lab(t, text) { ctx.fillText(text, clamp(X(t), L + 14, W - R - 14), H - 6); }
  if (kind === '5min') { var step = W < 480 ? 6 : 3; for (var h2 = 0; h2 <= 24; h2 += step) lab(t0 + h2 * 3600, hourLabel(h2)); }
  else if (kind === 'hourly') { for (var dd = new Date(t0 * 1000); dd.getTime() / 1000 < t1; dd.setDate(dd.getDate() + 1)) { var mid1 = dd.getTime() / 1000 + 43200; if (mid1 < t1) lab(mid1, dd.toLocaleDateString([], { weekday: 'short' })); } }
  else if (histRange === 'month') { var every = W < 480 ? 7 : 5; for (var md = new Date(t0 * 1000), k2 = 0; md.getTime() / 1000 < t1; md.setDate(md.getDate() + 1), k2++) if (k2 % every === 0) lab(md.getTime() / 1000 + 43200, md.toLocaleDateString([], { month: 'short', day: 'numeric' })); }
  else { var y0 = new Date(t0 * 1000).getFullYear(), each = W < 480 ? 2 : 1; for (var m3 = 0; m3 < 12; m3 += each) { var mt = new Date(y0, m3, 1).getTime() / 1000; if (mt < t1) lab(mt + 15 * 86400 > t1 ? mt : mt + 15 * 86400, new Date(y0, m3, 1).toLocaleDateString([], { month: 'short' })); } }
  if (cfg.freeze && lo < 32 && hi > 32) { ctx.strokeStyle = '#1a4fb8'; ctx.lineWidth = 1.2; ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(L, Y(32)); ctx.lineTo(W - R, Y(32)); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = '#1a4fb8'; ctx.textAlign = 'left'; ctx.fillText('32°', L + 3, Y(32) - 3); }
  ctx.save(); ctx.beginPath(); ctx.rect(L, T - 2, pw, ph + 4); ctx.clip();
  var dayW = pw / Math.max(1, (t1 - t0) / 86400);
  cfg.series.forEach(function (s) {
    if (s.band) { // shaded range between two values
      ctx.fillStyle = scol(s); ctx.globalAlpha = 0.14; ctx.beginPath();
      var seg = [];
      function flush() { if (seg.length > 1) { ctx.moveTo(seg[0][0], seg[0][1]); seg.forEach(function (p) { ctx.lineTo(p[0], p[1]); }); for (var q = seg.length - 1; q >= 0; q--) ctx.lineTo(seg[q][0], seg[q][2]); ctx.closePath(); } seg = []; }
      var pt0 = null;
      rows.forEach(function (r) {
        var a = r[s.band[0]], b = r[s.band[1]];
        if (a == null || b == null || (pt0 !== null && r.t - pt0 > gap)) flush();
        if (a != null && b != null) { seg.push([X(r.t), Y(b), Y(a)]); pt0 = r.t; }
      });
      flush(); ctx.fill(); ctx.globalAlpha = 1; return;
    }
    if (s.type === 'dots') {
      ctx.fillStyle = scol(s); rows.forEach(function (r) { var v = r[s.key]; if (v === null || v === undefined) return; ctx.beginPath(); ctx.arc(X(r.t), Y(v), kind === 'daily' ? 2.4 : 1.7, 0, 6.3); ctx.fill(); });
      return;
    }
    if (s.type === 'bars') {
      ctx.fillStyle = scol(s); var bw = Math.max(1.2, dayW * 0.7);
      rows.forEach(function (r) { var v = r[s.key]; if (v === null || v === undefined || v <= 0) return; ctx.fillRect(X(r.t) - bw / 2, Y(v), bw, Y(lo) - Y(v)); });
      return;
    }
    ctx.strokeStyle = scol(s); ctx.lineWidth = kind === 'daily' && rows.length > 120 ? 1.4 : 1.9; ctx.lineJoin = 'round'; ctx.beginPath();
    var prevT = null;
    rows.forEach(function (r) {
      var v = r[s.key]; if (v === null || v === undefined) { prevT = null; return; }
      if (prevT === null || r.t - prevT > gap) ctx.moveTo(X(r.t), Y(v)); else ctx.lineTo(X(r.t), Y(v));
      prevT = r.t;
    });
    ctx.stroke();
  });
  ctx.restore();
  ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, T); ctx.lineTo(L, T + ph); ctx.lineTo(W - R, T + ph); ctx.stroke();
  if (!rows.length) { ctx.fillStyle = tc; ctx.textAlign = 'center'; ctx.fillText(histMsg || 'No data', L + pw / 2, T + ph / 2); }
  // hover / touch readout
  if (hoverT !== null && rows.length) {
    var best = null, bd = Infinity, near = kind === '5min' ? 1800 : kind === 'hourly' ? 5400 : 86400;
    rows.forEach(function (r) { var dd2 = Math.abs(r.t - hoverT); if (dd2 < bd) { bd = dd2; best = r; } });
    if (best && bd < near) {
      var hx = X(best.t), when = new Date(best.t * 1000);
      ctx.strokeStyle = tc; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, T); ctx.lineTo(hx, T + ph); ctx.stroke();
      var lines = [kind === '5min' ? when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : kind === 'hourly' ? when.toLocaleString([], { weekday: 'short', hour: 'numeric' }) : when.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })];
      cfg.series.forEach(function (s) {
        if (s.band) return;
        var v = best[s.key]; if (v === null || v === undefined) return;
        if (s.type !== 'bars') { ctx.fillStyle = scol(s); ctx.beginPath(); ctx.arc(hx, Y(v), 3.4, 0, 6.3); ctx.fill(); }
        lines.push([s.color === 'text' ? '#e8eef4' : scol(s), s.name + ': ' + v.toFixed(s.dp !== undefined ? s.dp : cfg.dp) + s.unit]);
      });
      readoutBox(ctx, W, hx, T + 4, lines);
    }
  }
  cfg._geo = { L: L, R: R, W: W, t0: t0, t1: t1 };
}
function renderHistory() {
  var set = chartSet();
  set.forEach(drawHChart);
  // legends follow the chart set
  set.forEach(function (cfg) {
    var box = el(cfg.id).parentNode.querySelector('.hleg'); if (!box) return;
    box.innerHTML = '';
    cfg.series.forEach(function (s) {
      if (s.band) return;
      var sp = mkEl('span'), sw = mkEl('i'); sw.style.background = s.color === 'text' ? 'var(--text)' : s.color;
      sp.appendChild(sw); sp.appendChild(document.createTextNode(s.name + ' (' + s.unit.trim() + ')')); box.appendChild(sp);
    });
  });
  var msg = el('hist-msg'); msg.hidden = !histMsg || (hist && hist.rows.length > 0 && !/could not|not loaded|still need/i.test(histMsg)); msg.textContent = histMsg;
  var sum = el('hist-sum'), rows = hist ? hist.rows : [];
  if (!rows.length) { sum.textContent = ''; return; }
  var daily = hist.kind === 'daily', hiT = -Infinity, loT = Infinity, hiAt = null, loAt = null, pk = 0, pkAt = null, rain = 0;
  rows.forEach(function (r) {
    var h = daily ? r.hi : r.temp, l = daily ? r.lo : r.temp;
    if (h !== null && h !== undefined && h > hiT) { hiT = h; hiAt = r.t; }
    if (l !== null && l !== undefined && l < loT) { loT = l; loAt = r.t; }
    if (r.gust !== null && r.gust !== undefined && r.gust > pk) { pk = r.gust; pkAt = r.t; }
    if (r.acc !== null && r.acc !== undefined) rain = Math.max(rain, r.acc);
  });
  function on(t) { return hist.kind === '5min' || t === null ? '' : ' (' + new Date(t * 1000).toLocaleDateString([], hist.kind === 'hourly' ? { weekday: 'short' } : { month: 'short', day: 'numeric' }) + ')'; }
  sum.textContent = 'High ' + fmt(hiT, 1) + '°' + on(hiAt) + ' · Low ' + fmt(loT, 1) + '°' + on(loAt) + ' · Peak gust ' + fmt(pk, 1) + ' mph' + on(pkAt) + ' · Rain ' + fmt(rain, 2) + ' in';
}
function initHistoryCharts() {
  buildRangeSeg();
  HCHARTS.forEach(function (base) {
    var cv = el(base.id);
    tapReadout(cv, function (e) {
      var cfg = chartSet().filter(function (c) { return c.id === base.id; })[0], g = cfg && cfg._geo; if (!g) return;
      var x = e.clientX - cv.getBoundingClientRect().left;
      hoverT = g.t0 + clamp((x - g.L) / (g.W - g.L - g.R), 0, 1) * (g.t1 - g.t0); renderHistory();
    }, function () { if (hoverT !== null) { hoverT = null; renderHistory(); } }, function () { return hoverT !== null; });
  });
}
// ‹ (delta +1) goes back one day, week or month; › (delta -1) comes forward
function setHistDay(delta) {
  if (histRange === 'week') weekOffset = clamp(weekOffset + delta, 0, WEEK_BACK);
  else if (histRange === 'month') monthOffset = clamp(monthOffset + delta, 0, MONTH_BACK);
  else if (histRange === 'ytd') yearOffset = clamp(yearOffset + delta, 0, YEAR_BACK);
  else histOffset = clamp(histOffset + delta, 0, HIST_KEEP_DAYS);
  hoverT = null; loadHistory(false);
}
