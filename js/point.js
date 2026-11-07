/* Backyard Weather: 7-day forecast at the backyard. All four models come in one Open-Meteo request. */
'use strict';

var PT_MODELS = [
  { id: 'ecmwf', label: 'Euro', name: 'Euro IFS (9 km)', om: 'ecmwf_ifs', alt: 'ecmwf_ifs025' },
  { id: 'gfs', label: 'GFS', name: 'GFS', om: 'gfs_seamless' },
  { id: 'aifs', label: 'AI Euro', name: 'AI Euro (ECMWF AIFS)', om: 'ecmwf_aifs025_single' },
  { id: 'aigfs', label: 'AI GFS', name: 'AI GFS (NOAA AIGFS)', om: 'ncep_aigfs025' }
];
var ptModelId = store.get('wx.ptmodel', 'ecmwf'), pointCache = {}, pointFetchedAt = 0, pointData = null, ptHoverT = null;
if (!PT_MODELS.some(function (m) { return m.id === ptModelId; })) ptModelId = 'ecmwf';
function curPt() { return PT_MODELS.filter(function (m) { return m.id === ptModelId; })[0]; }

async function loadPoint(force) {
  if (demo) { PT_MODELS.forEach(function (m) { pointCache[m.id] = makeDemoPoint(m.id); }); pointData = pointCache[ptModelId]; return; }
  if (!force && pointFetchedAt && Date.now() - pointFetchedAt < 3600000) { pointData = pointCache[ptModelId] || null; return; }
  var L = homeLoc(), oms = PT_MODELS.map(function (m) { return m.om; });
  function url(list) {
    return OM_BASE + 'forecast?latitude=' + L.lat.toFixed(3) + '&longitude=' + L.lon.toFixed(3) + '&hourly=temperature_2m,precipitation,pressure_msl&models=' + list.join(',') +
      '&temperature_unit=fahrenheit&precipitation_unit=inch&timeformat=unixtime&timezone=GMT&forecast_days=8';
  }
  try {
    var j;
    try { j = await omFetch(url(oms)); }
    catch (e) {
      if (e.status !== 400) throw e;
      log('Backyard forecast: ' + friendlyError(e) + '; retrying with the 0.25° Euro');
      oms = PT_MODELS.map(function (m) { return m.alt || m.om; });
      j = await omFetch(url(oms));
    }
    var h = j.hourly, times = h.time, got = [];
    PT_MODELS.forEach(function (m, i) {
      var om = oms[i], t = h['temperature_2m_' + om];
      if (!t || !t.some(function (v) { return v != null; })) return;
      pointCache[m.id] = { pid: m.id, model: om, times: times, t: t, pr: h['precipitation_' + om], p: h['pressure_msl_' + om], fetchedAt: Date.now() };
      got.push(m.label);
    });
    pointFetchedAt = Date.now();
    pointData = pointCache[ptModelId] || null;
    el('point-note').textContent = pointData ? '' : 'The ' + curPt().label + ' backyard forecast is not available right now.';
    log('Backyard forecast OK (' + got.join(', ') + ')');
  } catch (e) {
    log('Backyard forecast failed: ' + friendlyError(e));
    pointData = pointCache[ptModelId] || null;
    el('point-note').textContent = 'Could not load the backyard forecast: ' + friendlyError(e);
  }
}
function buildPtTabs() {
  var box = el('pt-tabs'); box.innerHTML = '';
  PT_MODELS.forEach(function (m) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tab' + (m.id === ptModelId ? ' on' : ''); b.textContent = m.label;
    b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', m.id === ptModelId ? 'true' : 'false');
    b.addEventListener('click', async function () {
      if (m.id === ptModelId) return;
      ptModelId = m.id; store.set('wx.ptmodel', ptModelId); buildPtTabs();
      pointData = pointCache[m.id] || null; el('point-note').textContent = pointData ? '' : 'Loading ' + m.label + '…';
      renderPoint(); updateCompare();
      if (!pointData) { await loadPoint(true); if (m.id !== ptModelId) return; renderPoint(); updateCompare(); }
    });
    box.appendChild(b);
  });
}
// the chosen model's temperature for right now, for the comparison under the station readings
function modelNow() {
  if (!pointData) return null;
  var now = Date.now() / 1000, T = pointData.times;
  for (var i = 0; i < T.length - 1; i++) {
    if (T[i] <= now && now < T[i + 1]) {
      var f = (now - T[i]) / (T[i + 1] - T[i]);
      if (pointData.t[i] == null || pointData.t[i + 1] == null) return null;
      return pointData.t[i] + (pointData.t[i + 1] - pointData.t[i]) * f;
    }
  }
  return null;
}

function localDayStart(t) { var d = new Date(t * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; }
function renderPoint() {
  var cv = el('chart'), wrap = el('chart-wrap'), W = Math.floor(wrap.getBoundingClientRect().width) || 340, H = 200;
  var ctx = sizeCanvas(cv, W, H); ctx.clearRect(0, 0, W, H);
  var css = getComputedStyle(document.documentElement), tc = css.getPropertyValue('--muted').trim() || '#667', line = css.getPropertyValue('--line').trim() || '#ddd';
  var pd = pointData; if (pd && pd.pid && pd.pid !== ptModelId) pd = null; if (!pd) { el('daily').innerHTML = ''; cv._geo = null; return; }
  var now = Date.now() / 1000, t0 = now, t1 = now + 168 * 3600, idx = [];
  for (var i = 0; i < pd.times.length; i++) if (pd.times[i] >= t0 - 3600 && pd.times[i] <= t1) idx.push(i);
  if (idx.length < 2) return;
  var tmin = Infinity, tmax = -Infinity, pmax = 0.05;
  idx.forEach(function (i) { var v = pd.t[i]; if (v != null) { tmin = Math.min(tmin, v); tmax = Math.max(tmax, v); } if (pd.pr[i] != null) pmax = Math.max(pmax, pd.pr[i]); });
  tmin = Math.floor((tmin - 3) / 10) * 10; tmax = Math.ceil((tmax + 3) / 10) * 10;
  var L = 30, R = 8, T = 18, B = 18, pw = W - L - R, ph = H - T - B;
  function X(t) { return L + (t - t0) / (t1 - t0) * pw; }
  function Y(v) { return T + (1 - (v - tmin) / (tmax - tmin)) * ph; }
  ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  for (var g = tmin; g <= tmax; g += 10) { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Y(g)); ctx.lineTo(W - R, Y(g)); ctx.stroke(); ctx.fillStyle = tc; ctx.fillText(g + '°', L - 4, Y(g)); }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  for (var dday = localDayStart(t0) + 86400; dday < t1; dday += 86400) {
    ctx.strokeStyle = line; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(dday), T); ctx.lineTo(X(dday), H - B); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = tc; ctx.fillText(new Date(dday * 1000).toLocaleDateString([], { weekday: 'short' }), X(dday) + 3, 11);
  }
  var barMax = Math.max(0.12, pmax), bh = ph * 0.38;
  ctx.fillStyle = 'rgba(59,130,246,.75)';
  idx.forEach(function (i) { var v = pd.pr[i]; if (v == null || v <= 0) return; var h = v / barMax * bh; ctx.fillRect(X(pd.times[i]) - 1, H - B - h, 2.2, h); });
  ctx.strokeStyle = '#f59e42'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
  var first = true;
  idx.forEach(function (i) { var v = pd.t[i]; if (v == null) return; var x = X(pd.times[i]), y = Y(v); if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); });
  ctx.stroke();
  if (tmin < 32 && tmax > 32) { ctx.strokeStyle = 'rgba(0,200,230,.7)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Y(32)); ctx.lineTo(W - R, Y(32)); ctx.stroke(); ctx.setLineDash([]); }
  ctx.strokeStyle = tc; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(now), T); ctx.lineTo(X(now), H - B); ctx.stroke();
  if (station && station.temp != null) { ctx.fillStyle = '#ffd84d'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(now), Y(station.temp), 4.5, 0, 6.3); ctx.fill(); ctx.stroke(); }
  ctx.fillStyle = tc; ctx.fillText('now', X(now) + 3, H - 5);
  cv._geo = { L: L, R: R, W: W, t0: t0, t1: t1 };
  // tap readout: the hour nearest the finger
  if (ptHoverT !== null) {
    var best = -1, bd = Infinity;
    idx.forEach(function (i) { var dd = Math.abs(pd.times[i] - ptHoverT); if (dd < bd) { bd = dd; best = i; } });
    if (best >= 0) {
      var hx = X(pd.times[best]), tv = pd.t[best], pv = pd.pr[best];
      ctx.strokeStyle = tc; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, T); ctx.lineTo(hx, H - B); ctx.stroke();
      if (tv != null) { ctx.fillStyle = '#f59e42'; ctx.beginPath(); ctx.arc(hx, Y(tv), 3.6, 0, 6.3); ctx.fill(); }
      readoutBox(ctx, W, hx, T + 4, [
        new Date(pd.times[best] * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric' }),
        ['#f59e42', 'Temperature: ' + fmt(tv, 0) + '°F'],
        ['rgba(59,130,246,1)', 'Precip that hour: ' + fmt(pv, 2) + ' in']
      ]);
    }
  }
  // daily table
  var rows = [], day = localDayStart(now);
  for (var n = 0; n < 7; n++) {
    var a = day + n * 86400, b = a + 86400, hi = -Infinity, lo = Infinity, pr = 0, any = false;
    for (var q = 0; q < pd.times.length; q++) {
      var tt = pd.times[q]; if (tt < Math.max(a, now - 3600) || tt >= b) continue;
      if (pd.t[q] != null) { hi = Math.max(hi, pd.t[q]); lo = Math.min(lo, pd.t[q]); any = true; }
      if (pd.pr[q] != null) pr += pd.pr[q];
    }
    if (!any) continue;
    rows.push('<tr><td>' + (n === 0 ? 'Today' : new Date(a * 1000).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })) + '</td><td>' + Math.round(hi) + '°</td><td>' + Math.round(lo) + '°</td><td>' + pr.toFixed(2) + ' in</td></tr>');
  }
  el('daily').innerHTML = '<table><thead><tr><th></th><th>High</th><th>Low</th><th>Precip</th></tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  var P = PT_MODELS.filter(function (m) { return m.id === pd.pid; })[0] || curPt(), Lc = homeLoc();
  el('point-note').textContent = (pd.model === P.alt ? P.name.replace(' (9 km)', '') : P.name) + ' at ' + Lc.lat.toFixed(2) + '°N ' + Math.abs(Lc.lon).toFixed(2) + '°W. Orange = temperature, blue bars = hourly precipitation, yellow dot = your station now. Tap the chart to read it.';
}
// dark rounded box listing a title line then [color, text] lines
function readoutBox(ctx, W, hx, by, lines) {
  ctx.font = '600 12px -apple-system, system-ui, sans-serif';
  var bw = 0; lines.forEach(function (l, i) { bw = Math.max(bw, ctx.measureText(i ? l[1] : l).width + (i ? 16 : 0)); });
  bw += 16; var bh = lines.length * 17 + 8, bx = hx + 10; if (bx + bw > W - 2) bx = hx - 10 - bw; if (bx < 2) bx = 2;
  ctx.fillStyle = 'rgba(28,34,42,.93)'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 7); else ctx.rect(bx, by, bw, bh); ctx.fill();
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  lines.forEach(function (l, i) {
    var yy = by + 4 + i * 17 + 8.5;
    if (!i) { ctx.fillStyle = '#ffffff'; ctx.fillText(l, bx + 8, yy); }
    else { ctx.fillStyle = l[0]; ctx.fillRect(bx + 8, yy - 5, 9, 9); ctx.fillStyle = '#ffffff'; ctx.fillText(l[1], bx + 22, yy); }
  });
  ctx.textBaseline = 'alphabetic';
}
function initPointChart() {
  var cv = el('chart');
  tapReadout(cv, function (e) {
    var g = cv._geo; if (!g) return;
    var x = e.clientX - cv.getBoundingClientRect().left;
    ptHoverT = g.t0 + clamp((x - g.L) / (g.W - g.L - g.R), 0, 1) * (g.t1 - g.t0); renderPoint();
  }, function () { if (ptHoverT !== null) { ptHoverT = null; renderPoint(); } }, function () { return ptHoverT !== null; });
}
