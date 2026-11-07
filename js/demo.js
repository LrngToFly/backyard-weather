/* Backyard Weather: made-up data for demo mode (?demo=1, or the checkbox in Settings). Nothing here is a real forecast. */
'use strict';

// 3-hourly, like the real map data: rate and snow values are amounts in the 3 hours ending at each time
function makeDemoGrid(spec, M) {
  var win = gridWindow(), nt = Math.floor((win.end - win.start) / 10800) + 1, npts = spec.nx * spec.ny, hasT = !!M.type;
  var d = { detail: effDetail(M), dom: DOM_KEY, ver: CACHE_VER, modelId: M.id, spec: spec, nt: nt, times: new Float64Array(nt), fetchedAt: Date.now(), win: win, runInit: Math.floor(Date.now() / 21600000) * 21600 - 21600, p: new Float32Array(npts * nt), pr: new Float32Array(npts * nt), t: new Float32Array(npts * nt), sn: new Float32Array(npts * nt), th: new Float32Array(npts * nt), dw: new Float32Array(npts * nt), ws: new Float32Array(npts * nt), wd: new Float32Array(npts * nt), pt: hasT ? new Int8Array(npts * nt) : null, hasType: hasT, model: 'demo', hLast: M.id === 'rrfs' ? 32 : nt - 2 };
  var shift = { ecmwf: 0, gfs: 0.25, aifs: -0.2, aigfs: 0.4, rrfs: 0.1 }[M.id] || 0;
  for (var x = 0; x < nt; x++) {
    var tt = win.start + x * 10800, h = (tt - win.start) / 3600 - 6;
    d.times[x] = tt;
    var cx = -77 + 0.12 * (h + 6), cy = 38.5 + 0.075 * (h + 6);
    for (var j = 0; j < spec.ny; j++) for (var i = 0; i < spec.nx; i++) {
      var lon = spec.lons[i], lat = spec.lats[j], idx = (j * spec.nx + i) * nt + x;
      var dx = (lon - cx) * 0.72, dy = lat - cy, r2 = dx * dx + dy * dy;
      d.p[idx] = 1019 - 24 * Math.exp(-r2 / (2 * 3.2 * 3.2)) + 5 * Math.sin(lon * 0.6 + 1) * Math.cos(lat * 0.4);
      var ex = dx - 1.3, ey = dy - 1.1, band = Math.exp(-(ex * ex + ey * ey) / (2 * 2.2 * 2.2));
      var wob = 0.65 + 0.35 * Math.sin(lon * 1.7 + lat * 1.3 + h * 0.05);
      var rate = Math.max(0, 0.22 * band * wob - 0.015 + shift * 0.01);
      d.pr[idx] = rate * 3;
      var diur = 3 * Math.sin((tt / 3600 % 24 - 9) / 24 * 6.283);
      var T = 41 - 2.6 * (lat - 42) + (lon + 71) * 0.4 + diur - 5 * Math.exp(-r2 / 18);
      d.t[idx] = T;
      d.dw[idx] = M.id === 'aigfs' ? NaN : T - 12 - 8 * Math.exp(-r2 / 30) + 14 * band;
      var gx = -dy, gy = dx, gr = Math.sqrt(r2) + 0.6, wv = 10 + 34 * Math.exp(-r2 / (2 * 3 * 3)) * (gr / (gr + 1.2));
      var uw = 8 + wv * (gx / gr) * 0.9 - wv * (dx / gr) * 0.25, vw = 2 + wv * (gy / gr) * 0.9 - wv * (dy / gr) * 0.25;
      d.ws[idx] = Math.hypot(uw, vw); d.wd[idx] = (Math.atan2(-uw, -vw) * 180 / Math.PI + 360) % 360;
      d.th[idx] = 540 + (T - 33) * 0.9 + 0.4 * (d.p[idx] - 1010);
      if (hasT) d.pt[idx] = rate > 0 ? (T <= 30 ? 5 : T <= 33 ? (lon < -72 ? 3 : 7) : T <= 36 ? 7 : 1) : 0;
      // demo snowfall (10:1 inches): all-snow when cold, half when near freezing
      d.sn[idx] = rate > 0 ? rate * 3 * 10 * (T <= 31 ? 1 : T <= 34 ? 0.5 : 0) : 0;
    }
  }
  return d;
}
// warmest temperature between the ground and 500 mb: colder to the north-west
function makeDemoTmax(d) {
  var spec = d.spec, nt = d.nt, out = new Float32Array(spec.nx * spec.ny * nt);
  for (var j = 0; j < spec.ny; j++) for (var i = 0; i < spec.nx; i++) for (var x = 0; x < nt; x++) {
    var idx = (j * spec.nx + i) * nt + x;
    out[idx] = d.t[idx] - 4 - 2.5 * (spec.lats[j] - 41) - 0.8 * (-70 - spec.lons[i]);
  }
  return out;
}
function makeDemoPoint(id) {
  var off = { ecmwf: 0, gfs: 1.2, aifs: -0.9, aigfs: 2 }[id] || 0, t0 = Math.floor(Date.now() / 86400000) * 86400, n = 8 * 24, o = { pid: id, model: 'demo', times: [], t: [], pr: [], p: [] };
  for (var h = 0; h < n; h++) {
    var t = t0 + h * 3600; o.times.push(t);
    o.t.push(42 + off + 8 * Math.sin(((t / 3600) % 24 - 15) / 24 * 6.283) - h * 0.04 + 3 * Math.sin(h / 17 + off * 0.3));
    o.pr.push(Math.max(0, 0.08 * Math.sin(h / 9 - 1) * Math.sin(h / 5)));
    o.p.push(1012 + 7 * Math.sin(h / 20));
  }
  return o;
}
function makeDemoStation() {
  return { temp: 44.6, heatIndex: 44.6, windChill: 41.2, dew: 38.1, wind: 5.4, gust: 11.8, pressure: 29.78, rate: 0, rainToday: 0.12, hum: 76, dir: 292, uv: 1, solar: 148, epoch: Date.now() - 90000, fetchedAt: Date.now() };
}
function makeDemoHistory(day, t0, t1) {
  var rows = [], now = Date.now() / 1000, end = Math.min(t1, histOffset === 0 ? now : t1), acc = 0, seed = histOffset * 7.3;
  for (var t = t0; t < end; t += 300) {
    var hr = (t - t0) / 3600, tc = 52 + 9 * Math.sin((hr - 9) / 24 * 6.283) + 2 * Math.sin(hr * 1.3 + seed);
    var ev = Math.max(0, Math.sin((hr - 14 + seed) / 3.2)) * Math.max(0, Math.sin(hr * 0.9 + seed)), rate = ev > 0.55 ? (ev - 0.55) * 0.9 : 0;
    acc += rate / 12;
    var ws = Math.max(0, 3 + 2.6 * Math.sin(hr * 1.1 + seed) + 1.5 * Math.sin(hr * 7.1));
    rows.push({ t: t, temp: +(tc - (rate > 0 ? 3 : 0)).toFixed(1), dew: +(tc - 7 + (rate > 0 ? 6 : 0) + Math.sin(hr)).toFixed(1), wind: +ws.toFixed(1), gust: ws > 1 ? +(ws + 1.5 + Math.abs(Math.sin(hr * 5)) * 2.5).toFixed(1) : null, rate: +rate.toFixed(2), acc: +acc.toFixed(2), pres: +(29.85 - 0.18 * Math.sin(hr / 7 + seed) - acc * 0.05).toFixed(2) });
  }
  return { ds: ymd(day), t0: t0, t1: t1, rows: rows, fetchedAt: Date.now() };
}
function makeDemoObs() {
  var o = {}, jan1 = ymd(new Date(new Date().getFullYear(), 0, 1));
  for (var i = 1; i <= 366; i++) {
    var ds = ymd(dayStart(i)); if (ds < jan1 && i > 62) break;
    var hi = 55 + 10 * Math.sin(i / 9) - i * 0.05, lo = 38 + 8 * Math.sin(i / 9 + 0.4) - i * 0.05, w = 8 + 6 * Math.abs(Math.sin(i * 1.7)), p = 30.0 + 0.3 * Math.sin(i / 3.1);
    o[ds] = { v: 2, hi: hi, lo: lo, rain: i % 4 === 0 ? +(0.1 + 0.3 * Math.abs(Math.sin(i))).toFixed(2) : 0, dew: lo - 2 + 4 * Math.sin(i / 5), wmax: w, gust: w + 6 + 4 * Math.abs(Math.sin(i)), pmax: p + 0.12, pmin: p - 0.12 };
  }
  return o;
}
function makeDemoAlerts() {
  var now = Date.now();
  return [{ event: 'Winter Weather Advisory', severity: 'Moderate', ends: new Date(now + 18 * 3600000).toISOString(),
    headline: 'Winter Weather Advisory issued by NWS Boston/Norton MA (DEMO, not real)',
    description: '* WHAT...Snow expected. Total snow accumulations of 2 to 4 inches.\n\n* WHERE...Central Massachusetts.\n\n* WHEN...Until 1 PM tomorrow.',
    instruction: 'Slow down and use caution while traveling.', senderName: 'NWS Boston/Norton MA', areaDesc: 'Northern Worcester; Southern Worcester' }];
}
function makeDemoAQ() { return { src: 'AirNow', area: 'Worcester (demo)', aqi: 38, main: 'PM2.5', tomorrow: { n: 2, name: 'Moderate', aqi: 55 } }; }
function makeDemoScore() {
  var errs = { ecmwf: [1.3, 2.0, 2.9], gfs: [1.9, 2.6, 3.5], aifs: [1.2, 1.9, 2.7], aigfs: [1.6, 2.4, 3.4] };
  return { n: 30, rainN: 30, obsRain: 2.4, wetDays: 7, first: ymd(dayStart(30)), last: ymd(dayStart(1)), models: PT_MODELS.map(function (m) {
    var lead = {};
    var rainPct = { ecmwf: [87, 80, 73], gfs: [80, 73, 67], aifs: [90, 83, 77], aigfs: [83, 77, 70] }[m.id], rainTot = { ecmwf: 3.1, gfs: 4.5, aifs: 2.6, aigfs: 2.0 }[m.id];
    SCORE_LEADS.forEach(function (n, k) { var e = errs[m.id][k]; lead[n] = { hi: e + 0.2, lo: e - 0.2, both: e, biasHi: m.id === 'gfs' ? -1.4 : 0.6, biasLo: m.id === 'ecmwf' ? 0.9 : -0.3, n: 30, rain: rainPct[k], rainTotal: rainTot, rainN: 30 }; });
    return { id: m.id, label: m.label, lead: lead };
  }) };
}
// hourly readings for the last 7 days (Week view)
function makeDemoWeek(t0, t1) {
  var rows = [], carried = 0, day = '', acc = 0;
  for (var t = Math.ceil(t0 / 3600) * 3600; t <= t1; t += 3600) {
    var hr = t / 3600, d = ymd(new Date(t * 1000));
    if (d !== day) { carried += acc; acc = 0; day = d; }
    var rate = Math.max(0, Math.sin(hr / 9) * Math.sin(hr / 4) - 0.6) * 0.4; acc += rate;
    var tc = 50 + 9 * Math.sin((hr % 24 - 9) / 24 * 6.283) + 4 * Math.sin(hr / 40), ws = Math.max(0, 5 + 4 * Math.sin(hr / 7));
    rows.push({ t: t, temp: +tc.toFixed(1), dew: +(tc - 8 + 3 * Math.sin(hr / 11)).toFixed(1), wind: +ws.toFixed(1), gust: +(ws + 4 + 3 * Math.abs(Math.sin(hr))).toFixed(1), rate: +rate.toFixed(2), acc: +(carried + acc).toFixed(2), pres: +(29.9 + 0.2 * Math.sin(hr / 30)).toFixed(2) });
  }
  return { kind: 'hourly', t0: t0, t1: t1, rows: rows, fetchedAt: Date.now() };
}
