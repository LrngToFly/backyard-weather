/* Backyard Weather: NWS watches and warnings, air quality (AirNow, or Open-Meteo without a key),
   and the model scorecard (how each model's past forecasts did against your station). */
'use strict';

// ---------------------------------------------------------------- NWS alerts for the station's location
var alertList = null, alertsAt = 0;
async function loadAlerts(force) {
  if (!force && Date.now() - alertsAt < 4 * 60000) return;
  if (demo) { alertList = makeDemoAlerts(); alertsAt = Date.now(); renderAlerts(); return; }
  var L = homeLoc();
  try {
    var r = await fetch(NWS_BASE + 'alerts/active?point=' + L.lat.toFixed(4) + ',' + L.lon.toFixed(4), { headers: { Accept: 'application/geo+json' }, cache: 'no-store' });
    if (!r.ok) throw new Error('NWS HTTP ' + r.status);
    var j = await r.json();
    var rank = { Extreme: 0, Severe: 1, Moderate: 2, Minor: 3 };
    alertList = (j.features || []).map(function (f) { return f.properties || {}; })
      .filter(function (p) { return p.status === 'Actual' && p.messageType !== 'Cancel'; })
      .sort(function (a, b) { return (rank[a.severity] !== undefined ? rank[a.severity] : 4) - (rank[b.severity] !== undefined ? rank[b.severity] : 4); });
    alertsAt = Date.now(); renderAlerts();
    log('NWS alerts: ' + alertList.length + ' active');
  } catch (e) { log('NWS alerts error: ' + friendlyError(e)); }
}
function renderAlerts() {
  var box = el('alerts'); box.innerHTML = '';
  if (!alertList || !alertList.length) { box.hidden = true; return; }
  box.hidden = false;
  alertList.forEach(function (p) {
    var sev = p.severity === 'Extreme' || p.severity === 'Severe' ? 'sev-high' : p.severity === 'Moderate' ? 'sev-mid' : 'sev-low';
    var det = mkEl('details', 'alert ' + sev), sum = mkEl('summary');
    var until = p.ends || p.expires;
    sum.appendChild(mkEl('b', '', p.event || 'Alert'));
    if (until) sum.appendChild(mkEl('span', 'until', 'until ' + new Date(until).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })));
    det.appendChild(sum);
    if (p.headline) det.appendChild(mkEl('p', 'small', p.headline));
    if (p.description) det.appendChild(mkEl('p', 'alert-text', p.description));
    if (p.instruction) det.appendChild(mkEl('p', 'alert-text', p.instruction));
    det.appendChild(mkEl('p', 'small muted', (p.senderName || 'National Weather Service') + (p.areaDesc ? ' · ' + p.areaDesc : '')));
    box.appendChild(det);
  });
}

// ---------------------------------------------------------------- air quality
var aqData = null, aqAt = 0, aqErr = '';
var AQI_CAT = [[50, 'Good', '#00e400'], [100, 'Moderate', '#ffff00'], [150, 'Unhealthy for sensitive groups', '#ff7e00'], [200, 'Unhealthy', '#ff0000'], [300, 'Very unhealthy', '#8f3f97'], [1e9, 'Hazardous', '#7e0023']];
function aqiCat(a) { for (var i = 0; i < AQI_CAT.length; i++) if (a <= AQI_CAT[i][0]) return AQI_CAT[i]; return AQI_CAT[5]; }
// AirNow answers are read field by field, accepting the older and newer field names
function anList(j) { return Array.isArray(j) ? j : (j && (j.data || j.Data || j.observations || j.results)) || []; }
function anRow(o) {
  function f() { for (var i = 0; i < arguments.length; i++) if (o[arguments[i]] !== undefined && o[arguments[i]] !== null) return o[arguments[i]]; return undefined; }
  var c = f('Category', 'category') || {};
  return {
    aqi: num(f('AQI', 'aqi', 'Aqi')) !== null ? num(f('AQI', 'aqi', 'Aqi')) : -1,
    param: f('ParameterName', 'parameterName', 'Parameter', 'parameter') || '',
    area: f('ReportingArea', 'reportingArea', 'ReportingAreaName') || '',
    date: String(f('DateForecast', 'dateForecast', 'ForecastDate', 'DateValid') || '').trim().slice(0, 10),
    cat: num(typeof c === 'object' ? (c.Number || c.number) : f('CategoryNumber', 'categoryNumber')),
    catName: typeof c === 'object' ? (c.Name || c.name) : f('CategoryName', 'categoryName')
  };
}
function fetchTimeout(url, ms) {
  var ac = new AbortController(), t = setTimeout(function () { ac.abort(); }, ms);
  return fetch(url, { cache: 'no-store', signal: ac.signal }).finally(function () { clearTimeout(t); });
}
function niceParam(p) { return p === 'O3' ? 'ozone' : p === 'PM2.5' ? 'fine particles (PM2.5)' : p === 'PM10' ? 'PM10' : p; }
async function loadAQ(force) {
  if (!force && aqData && Date.now() - aqAt < 30 * 60000) { renderAQ(); return; }
  if (demo) { aqData = makeDemoAQ(); aqAt = Date.now(); renderAQ(); return; }
  var L = homeLoc(), ll = '&latitude=' + L.lat.toFixed(3) + '&longitude=' + L.lon.toFixed(3) + '&distance=25';
  aqErr = '';
  if (settings.airnowKey) {
    try {
      // AirNow's newer services (the latLong ones were retired on Sept 30, 2026)
      var key = '&API_KEY=' + encodeURIComponent(settings.airnowKey);
      var r = await fetchTimeout(AIRNOW_BASE + 'observation/current/ziplatlong/?format=application/json' + ll + key, 15000);
      if (r.status === 401 || r.status === 403) throw new Error('AirNow rejected the key (HTTP ' + r.status + ')');
      if (!r.ok) throw new Error('AirNow is not answering right now (HTTP ' + r.status + ')');
      var arr = anList(await r.json()).map(anRow).filter(function (x) { return x.aqi >= 0; });
      if (arr.length) {
        var top = arr.reduce(function (a, b) { return b.aqi > a.aqi ? b : a; });
        aqData = { src: 'AirNow', area: top.area, aqi: top.aqi, main: top.param, tomorrow: null };
        try {
          var rf = await fetchTimeout(AIRNOW_BASE + 'forecast/current/?format=application/json' + ll + key, 15000);
          if (rf.ok) {
            var tm = new Date(Date.now() + 86400000), tds = tm.getFullYear() + '-' + pad2(tm.getMonth() + 1) + '-' + pad2(tm.getDate());
            anList(await rf.json()).map(anRow).filter(function (f) { return f.date === tds; }).forEach(function (f) {
              if (f.cat && (!aqData.tomorrow || f.cat > aqData.tomorrow.n)) aqData.tomorrow = { n: f.cat, name: f.catName || aqiCat(f.aqi)[1], aqi: f.aqi > 0 ? f.aqi : null };
            });
          }
        } catch (e2) { /* the forecast is optional */ }
        aqAt = Date.now(); renderAQ(); log('Air quality (AirNow ' + (top.area || '') + '): AQI ' + top.aqi); return;
      }
      throw new Error('AirNow has no monitor reporting near you right now');
    } catch (e) { aqErr = e.name === 'AbortError' ? 'AirNow did not answer in time' : friendlyError(e); log('AirNow error: ' + aqErr + '; using the Open-Meteo estimate'); }
  }
  try {
    var j = await omFetch(OM_AQ + '?latitude=' + L.lat.toFixed(3) + '&longitude=' + L.lon.toFixed(3) + '&current=us_aqi,us_aqi_pm2_5,us_aqi_ozone&timezone=GMT');
    var c = j.current || {};
    aqData = { src: 'Open-Meteo estimate', aqi: c.us_aqi, main: (c.us_aqi_pm2_5 || 0) >= (c.us_aqi_ozone || 0) ? 'PM2.5' : 'O3', tomorrow: null };
    aqAt = Date.now(); renderAQ(); log('Air quality (Open-Meteo): AQI ' + c.us_aqi);
  } catch (e) { log('Air quality error: ' + friendlyError(e)); }
}
function renderAQ() {
  var box = el('aq'); if (!box) return;
  if (!aqData || aqData.aqi == null) { box.innerHTML = ''; return; }
  var c = aqiCat(aqData.aqi), tm = aqData.tomorrow;
  box.innerHTML = '<div class="aq"><span class="aq-dot"></span><div><div class="aq-main"><b></b> <span class="aq-cat"></span></div><div class="small muted aq-sub"></div></div></div>';
  box.querySelector('.aq-dot').style.background = c[2];
  box.querySelector('b').textContent = 'Air quality ' + Math.round(aqData.aqi);
  box.querySelector('.aq-cat').textContent = c[1] + ' · ' + niceParam(aqData.main);
  box.querySelector('.aq-sub').textContent = aqData.src + (aqData.area ? ' (' + aqData.area + ')' : '') +
    (tm ? ' · Tomorrow: ' + tm.name + (tm.aqi ? ' (' + tm.aqi + ')' : '') : '') + (aqErr && aqData.src !== 'AirNow' ? (/rejected the key/.test(aqErr) ? ' · AirNow rejected the key' : ' · AirNow unavailable right now') : '');
}

// ---------------------------------------------------------------- model scorecard
// Open-Meteo keeps every model's past forecasts. For each recent day we take the high and low each model predicted
// 1, 3 and 5 days ahead and compare them with what your station recorded.
var SCORE_LEADS = [1, 3, 5], SCORE_DAYS = 30;
var scoreMode = store.get('wx.scoremode', 'both'), scoreRes = null, scoreBusy = false;
async function loadScore(force) {
  if (demo) { scoreRes = makeDemoScore(); renderScore(); return; }
  if (!settings.apiKey) { scoreRes = null; renderScore(); return; }
  if (scoreBusy) return; scoreBusy = true;
  try {
    await loadObsStore();
    var today = ymd(dayStart(0)), fc = await idb.get('score-fc');
    if (force || !fc || fc.day !== today || fc.station !== settings.stationId) {
      var L = homeLoc(), vars = SCORE_LEADS.map(function (n) { return 'temperature_2m_previous_day' + n; }).join(',');
      var oms = PT_MODELS.map(function (m) { return m.om; });
      var j = await omFetch(OM_PREV + '?latitude=' + L.lat.toFixed(3) + '&longitude=' + L.lon.toFixed(3) + '&hourly=' + vars + '&models=' + oms.join(',') +
        '&past_days=62&forecast_days=0&temperature_unit=fahrenheit&timeformat=unixtime&timezone=GMT');
      fc = { day: today, station: settings.stationId, times: j.hourly.time, v: {} };
      PT_MODELS.forEach(function (m) {
        fc.v[m.id] = {};
        SCORE_LEADS.forEach(function (n) { fc.v[m.id][n] = j.hourly['temperature_2m_previous_day' + n + '_' + m.om] || []; });
      });
      idb.set('score-fc', fc);
      log('Scorecard: past forecasts loaded (' + fc.times.length + ' hours)');
    }
    scoreRes = computeScore(fc);
  } catch (e) {
    log('Scorecard error: ' + friendlyError(e));
    scoreRes = { error: friendlyError(e) };
  } finally { scoreBusy = false; }
  renderScore();
}
function computeScore(fc) {
  // daily high/low per model and lead, for local calendar days with all 24 hours
  var byDay = {};
  fc.times.forEach(function (t, i) { var ds = ymd(new Date(t * 1000)); (byDay[ds] = byDay[ds] || []).push(i); });
  var today = ymd(dayStart(0)), first = ymd(dayStart(SCORE_DAYS)), days = [];
  Object.keys(byDay).sort().forEach(function (ds) {
    var o = obsDays && obsDays[ds];
    if (ds >= today || ds < first || byDay[ds].length < 23 || !o || o.none || o.hi == null || o.lo == null) return;
    days.push(ds);
  });
  var res = { n: days.length, first: days[0], last: days[days.length - 1], models: [] };
  PT_MODELS.forEach(function (m) {
    var row = { id: m.id, label: m.label, lead: {} };
    SCORE_LEADS.forEach(function (n) {
      var a = fc.v[m.id] && fc.v[m.id][n], eh = [], el2 = [];
      if (a) days.forEach(function (ds) {
        var hi = -Infinity, lo = Infinity;
        byDay[ds].forEach(function (i) { var v = a[i]; if (v != null) { hi = Math.max(hi, v); lo = Math.min(lo, v); } });
        if (hi === -Infinity) return;
        eh.push(hi - obsDays[ds].hi); el2.push(lo - obsDays[ds].lo);
      });
      function mae(x) { return x.length ? x.reduce(function (s, v) { return s + Math.abs(v); }, 0) / x.length : null; }
      function mean(x) { return x.length ? x.reduce(function (s, v) { return s + v; }, 0) / x.length : null; }
      row.lead[n] = { hi: mae(eh), lo: mae(el2), both: eh.length ? (mae(eh) + mae(el2)) / 2 : null, biasHi: mean(eh), biasLo: mean(el2), n: eh.length };
    });
    res.models.push(row);
  });
  return res;
}
function renderScore() {
  var box = el('score-body'); if (!box) return;
  if (!demo && !settings.apiKey) { box.innerHTML = '<p class="muted">Add your Weather Underground API key in Settings: the scorecard compares each model with your station.</p>'; return; }
  if (scoreRes && scoreRes.error) { box.innerHTML = '<p class="warn"></p>'; box.querySelector('.warn').textContent = 'Could not load past forecasts: ' + scoreRes.error; return; }
  if (!scoreRes) { box.innerHTML = '<p class="muted">Loading…</p>'; return; }
  // if more station days have arrived since, recompute from the saved forecasts
  if (!demo && !scoreBusy && obsDays) { idb.get('score-fc').then(function (fc) { if (fc && fc.station === settings.stationId) { var r = computeScore(fc); if (r.n !== scoreRes.n) { scoreRes = r; drawScore(); } } }); }
  drawScore();
}
function drawScore() {
  var box = el('score-body'), R = scoreRes; box.innerHTML = '';
  var seg = mkEl('div', 'seg seg3');
  [['both', 'Highs & lows'], ['hi', 'Highs'], ['lo', 'Lows']].forEach(function (o) {
    var b = mkEl('button', 'tab' + (scoreMode === o[0] ? ' on' : ''), o[1]); b.type = 'button';
    b.addEventListener('click', function () { scoreMode = o[0]; store.set('wx.scoremode', scoreMode); drawScore(); });
    seg.appendChild(b);
  });
  box.appendChild(seg);
  if (R.n < 3) {
    box.appendChild(mkEl('p', 'muted', R.n ? 'Only ' + R.n + ' day' + (R.n === 1 ? '' : 's') + ' of station history so far.' : 'Waiting for station history.'));
    box.appendChild(mkEl('p', 'small muted', 'Past days are loaded from Weather Underground a few at a time' + (backfillLeft ? ' (' + backfillLeft + ' to go)' : '') + '. The scorecard fills in over the next few visits.'));
    return;
  }
  var tbl = mkEl('table', 'score'), thead = mkEl('tr');
  thead.appendChild(mkEl('th', '', 'Model'));
  SCORE_LEADS.forEach(function (n) { thead.appendChild(mkEl('th', '', n + (n === 1 ? ' day' : ' days') + ' ahead')); });
  var th = mkEl('thead'); th.appendChild(thead); tbl.appendChild(th);
  var best = {};
  SCORE_LEADS.forEach(function (n) {
    var b = Infinity; R.models.forEach(function (m) { var v = m.lead[n][scoreMode]; if (v != null && v < b) b = v; }); best[n] = b;
  });
  var tb = mkEl('tbody');
  R.models.forEach(function (m) {
    var tr = mkEl('tr'); tr.appendChild(mkEl('td', '', m.label));
    SCORE_LEADS.forEach(function (n) {
      var v = m.lead[n][scoreMode];
      tr.appendChild(mkEl('td', v != null && Math.abs(v - best[n]) < 0.05 ? 'best' : '', v == null ? '–' : v.toFixed(1) + '°'));
    });
    tb.appendChild(tr);
  });
  tbl.appendChild(tb); box.appendChild(tbl);
  // which way each model leans, 1 day ahead
  var bias = mkEl('ul', 'bias small');
  R.models.forEach(function (m) {
    var l = m.lead[1]; if (l.biasHi == null) return;
    function lean(v, what) { return Math.abs(v) < 0.5 ? what + ' about right' : what + ' ' + Math.abs(v).toFixed(1) + '° too ' + (v > 0 ? 'warm' : 'cold'); }
    bias.appendChild(mkEl('li', '', m.label + ': ' + lean(l.biasHi, 'highs') + ', ' + lean(l.biasLo, 'lows')));
  });
  box.appendChild(mkEl('p', 'small score-h', 'Leaning warm or cold (1 day ahead)'));
  box.appendChild(bias);
  var f = dsDate(R.first), t = dsDate(R.last), o = { month: 'short', day: 'numeric' }, missing = 0;
  for (var i = 1; i <= SCORE_DAYS; i++) if (!demo && obsDays && !obsDays[ymd(dayStart(i))]) missing++;
  box.appendChild(mkEl('p', 'small muted', 'Average miss, in °F, of the daily ' + (scoreMode === 'both' ? 'high and low' : scoreMode === 'hi' ? 'high' : 'low') +
    ' at your station over ' + R.n + ' days (' + f.toLocaleDateString([], o) + ' – ' + t.toLocaleDateString([], o) + '). Lower is better; the best in each column is highlighted.' +
    (missing ? ' ' + missing + ' more recent day' + (missing === 1 ? ' is' : 's are') + ' still loading.' : '')));
}
