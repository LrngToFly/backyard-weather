/* Backyard Weather: forecast map data.
   Downloads a model's grid only when a new model run is out (checked with Open-Meteo's small "latest run" file),
   3-hourly and only the hours the maps show, then works out each time step's fields for drawing. */
'use strict';

var gridData = null;   // the loaded model run (also saved on the device)
var gridNote = '';
var modelId = store.get('wx.model', 'ecmwf');
var ttModelId = store.get('wx.ttmodel', 'ecmwf'); // Tropical Tidbits links have their own model choice
if (!MODELS.some(function (m) { return m.id === modelId; })) modelId = 'ecmwf';
function modelById(id) { return MODELS.filter(function (m) { return m.id === id; })[0]; }
function curModel() { return modelById(modelId); }
function effDetail(M) { return M.fine ? 'fine' : settings.detail; }
var view = store.get('wx.view', 'mslp_pcpn');
if (!VIEWS.some(function (v) { return v.id === view; })) view = 'mslp_pcpn';
var stepIdx = 0;
var stepCache = new Map();   // every time step of the loaded run, by data index (about 120 KB each)
var stepOwner = null;        // the run stepCache belongs to
var DER = new WeakMap();     // running totals worked out from a loaded run (kept in memory, not saved)
var kuchNote = '';

function gridSpec(detail) {
  var step = detail === 'fine' ? 0.25 : 0.5, lats = [], lons = [], i, v;
  for (i = 0; ; i++) { v = DOM.lat0 + i * step; if (v > DOM.lat1 + 1e-6) break; lats.push(+v.toFixed(3)); }
  for (i = 0; ; i++) { v = DOM.lon0 + i * step; if (v > DOM.lon1 + 1e-6) break; lons.push(+v.toFixed(3)); }
  return { step: step, lats: lats, lons: lons, nx: lons.length, ny: lats.length };
}

// ---------------------------------------------------------------- "is there a new model run?"
var metaMemo = {};
async function fetchMeta(M) {
  var m = metaMemo[M.id];
  if (m && Date.now() - m.at < 5 * 60000) return m.v;
  if (demo) return { init: Math.floor(Date.now() / 21600000) * 21600 - 21600, avail: 0 };
  try {
    var r = await fetch(OM_META + M.meta + '/static/meta.json', { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    var j = await r.json();
    var v = { init: j.last_run_initialisation_time, avail: j.last_run_availability_time };
    if (!v.init || !v.avail) throw new Error('no run times in the file');
    metaMemo[M.id] = { at: Date.now(), v: v };
    return v;
  } catch (e) { log(M.short + ': could not check for a new run (' + friendlyError(e) + ')'); return null; }
}
// "18z run (Thu)" in Eastern time terms: the z hour is the model's start time in UTC, as forecasters say it
function runText(init) {
  if (!init) return '';
  var d = new Date(init * 1000);
  return pad2(d.getUTCHours()) + 'z run (' + d.toLocaleDateString([], { weekday: 'short' }) + ')';
}

// ---------------------------------------------------------------- download
function isoHourUTC(sec) {
  var d = new Date(sec * 1000);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + 'T' + pad2(d.getUTCHours()) + ':00';
}
// from one 3-hour block before now (so the first frame has a rate) to 7 days out, on the model's 3-hour marks
function gridWindow() {
  var t0 = Math.floor(Date.now() / 1000 / 10800) * 10800;
  return { start: t0 - 10800, end: t0 + 171 * 3600 }; // one extra step: Open-Meteo leaves the last 3-hour value empty
}
// Open-Meteo allows about 600 location-calls a minute. Map downloads keep a running count and wait for room
// rather than running into the limit (each grid point is one call).
var omSpent = [];
async function omBudget(cost) {
  for (;;) {
    var now = Date.now();
    omSpent = omSpent.filter(function (x) { return now - x[0] < 61000; });
    var used = omSpent.reduce(function (s, x) { return s + x[1]; }, 0);
    if (!omSpent.length || used + cost <= 580) { omSpent.push([now, cost]); return; }
    var left = Math.ceil((61000 - (now - omSpent[0][0])) / 1000);
    el('map-note').textContent = 'Pacing requests for Open-Meteo\'s per-minute limit: ' + left + ' s…'; el('map-note').className = 'small muted';
    await sleep(1000);
  }
}
var rateUntil = 0;
function rateWait(sec) {
  rateUntil = Math.max(rateUntil, Date.now() + sec * 1000);
  return new Promise(function (res) {
    (function tick() {
      var left = Math.ceil((rateUntil - Date.now()) / 1000);
      if (left <= 0) { res(); return; }
      el('map-note').textContent = 'Open-Meteo free limit reached. Retrying in ' + left + ' s…'; el('map-note').className = 'small muted';
      setTimeout(tick, 1000);
    })();
  });
}
// all grid points, in chunks of 100 per request, 3 requests at a time; returns one array of locations per chunk
async function fetchPoints(spec, M, win, vars) {
  var pts = [], j, i;
  for (j = 0; j < spec.ny; j++) for (i = 0; i < spec.nx; i++) pts.push([spec.lats[j], spec.lons[i]]);
  var CH = 100, chunks = [];
  for (var k = 0; k < pts.length; k += CH) chunks.push(pts.slice(k, k + CH));
  var results = new Array(chunks.length), next = 0;
  async function worker() {
    while (next < chunks.length) {
      var c = next++;
      var lat = chunks[c].map(function (p) { return p[0]; }).join(',');
      var lon = chunks[c].map(function (p) { return p[1]; }).join(',');
      var url = OM_BASE + M.ep + '?latitude=' + lat + '&longitude=' + lon + '&hourly=' + vars + '&models=' + M.om +
        '&temperature_unit=fahrenheit&precipitation_unit=inch&wind_speed_unit=kn&timeformat=unixtime&timezone=GMT' +
        '&temporal_resolution=hourly_3&start_hour=' + isoHourUTC(win.start) + '&end_hour=' + isoHourUTC(win.end);
      var arr;
      await omBudget(chunks[c].length * Math.max(1, vars.split(',').length / 10));
      try { arr = await omFetch(url); }
      catch (e) {
        if (e.status !== 429 || /hourly|daily/i.test(e.reason || '')) throw e;
        log('Maps: Open-Meteo per-minute limit reached; waiting 62 seconds, then retrying');
        await rateWait(62);
        arr = await omFetch(url);
      }
      results[c] = Array.isArray(arr) ? arr : [arr];
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  return { results: results, CH: CH, npts: pts.length };
}
function val(a, x) { return a && a[x] != null ? a[x] : NaN; }
async function fetchGrid(spec, useType, M, win) {
  var vars = 'pressure_msl,precipitation,temperature_2m,snowfall,geopotential_height_500hPa,geopotential_height_1000hPa,dew_point_2m,wind_speed_10m,wind_direction_10m' + (useType ? ',precipitation_type' : '');
  var F = await fetchPoints(spec, M, win, vars), results = F.results, npts = F.npts;
  var first = pick(results[0][0].hourly, 'time'), nt = first.length;
  var d = {
    detail: effDetail(M), dom: DOM_KEY, ver: CACHE_VER, modelId: M.id, spec: spec, nt: nt, times: Float64Array.from(first), fetchedAt: Date.now(), win: win,
    p: new Float32Array(npts * nt), pr: new Float32Array(npts * nt), t: new Float32Array(npts * nt), sn: new Float32Array(npts * nt), th: new Float32Array(npts * nt), dw: new Float32Array(npts * nt), ws: new Float32Array(npts * nt), wd: new Float32Array(npts * nt),
    pt: useType ? new Int8Array(npts * nt) : null, hasType: !!useType, model: M.om, hLast: 0
  };
  results.forEach(function (arr, c) {
    arr.forEach(function (loc, q) {
      var h = loc.hourly, idx = (c * F.CH + q) * nt;
      var P = pick(h, 'pressure_msl'), R = pick(h, 'precipitation'), T = pick(h, 'temperature_2m'), S = pick(h, 'snowfall'), Z5 = pick(h, 'geopotential_height_500hPa'), Z1 = pick(h, 'geopotential_height_1000hPa'), Y = useType ? pick(h, 'precipitation_type') : null, DW = pick(h, 'dew_point_2m'), WS = pick(h, 'wind_speed_10m'), WD = pick(h, 'wind_direction_10m');
      for (var x = 0; x < nt; x++) {
        d.p[idx + x] = val(P, x);
        d.pr[idx + x] = val(R, x);   // inches in the 3 hours ending at this time
        d.t[idx + x] = val(T, x);
        // Open-Meteo snowfall is 0.7 cm (0.7 x water depth); x 10/7 gives a 10:1 snow depth like Tropical Tidbits
        d.sn[idx + x] = val(S, x) * 10 / 7;
        // 1000-500 mb thickness in decameters (dam), the rain/snow guide Tropical Tidbits draws as dashed lines
        d.th[idx + x] = (val(Z5, x) - val(Z1, x)) / 10;
        d.dw[idx + x] = val(DW, x);
        d.ws[idx + x] = val(WS, x);
        d.wd[idx + x] = val(WD, x);
        if (P && P[x] != null && x > d.hLast) d.hLast = x;
        if (useType) d.pt[idx + x] = Y && Y[x] != null ? Y[x] : -1;
      }
    });
  });
  return d;
}

// opts.force: download even if the saved run is current. Otherwise the saved run is shown at once and replaced
// only when Open-Meteo says a newer run is available.
var gridCheckedAt = 0;
async function loadGrid(opts) {
  opts = opts || {};
  var M = curModel(), spec = gridSpec(effDetail(M)), key = 'grid-' + M.id;
  gridNote = '';
  if (demo) { gridData = makeDemoGrid(spec, M); prepareGrid(gridData); gridNote = 'DEMO data (not real forecasts)'; gridCheckedAt = Date.now(); return; }
  function usable(c) { return c && c.ver === CACHE_VER && c.detail === effDetail(M) && c.dom === DOM_KEY && c.modelId === M.id; }
  var cached = (gridData && gridData.modelId === M.id && usable(gridData)) ? gridData : await idb.get(key);
  if (M.id !== modelId) return;
  var covers = usable(cached) && cached.times[cached.times.length - 1] > Date.now() / 1000 + 24 * 3600;
  if (covers && gridData !== cached) { gridData = cached; prepareGrid(cached); scheduleRender(); log(M.short + ': showing saved ' + (runText(cached.runInit) || 'data from ' + fmtClock(cached.fetchedAt))); }
  else if (covers) prepareGrid(cached); // time moves on: rebuild the frame list
  var meta = await fetchMeta(M), need = !covers || !!opts.force;
  if (M.id !== modelId) return;
  if (!need) {
    if (meta) need = meta.avail > (cached.metaAvail || cached.fetchedAt / 1000);
    else need = Date.now() - cached.fetchedAt > GRID_TTL;
  }
  gridCheckedAt = Date.now();
  if (!need) { log(M.short + ': saved ' + (runText(cached.runInit) || 'run') + ' is the latest'); return; }
  var useType = !!M.type && store.get('wx.hasType', true), win = gridWindow();
  try {
    var d;
    try {
      d = await fetchGrid(spec, useType, M, win);
    } catch (e) {
      if (useType && /precipitation_type|variable/i.test(e.message || '')) {
        log('Maps: precipitation type not offered; retrying without it (type will be estimated)');
        useType = false; store.set('wx.hasType', false);
        d = await fetchGrid(spec, false, M, win);
      } else { throw e; }
    }
    if (meta) { d.runInit = meta.init; d.metaAvail = meta.avail; }
    idb.set(key, d);
    log(M.short + ': fetched ' + spec.nx * spec.ny + ' points, ' + d.nt + ' times' + (meta ? ', ' + runText(meta.init) : '') + (d.hasType ? ', with precip type' : ', type from snowfall'));
    if (M.id !== modelId) return;
    gridData = d; prepareGrid(d);
  } catch (e) {
    log(M.short + ' error: ' + friendlyError(e));
    if (M.id !== modelId) return;
    if (usable(cached)) {
      if (gridData !== cached) { gridData = cached; prepareGrid(cached); }
      gridNote = 'Showing saved ' + (runText(cached.runInit) || 'run from ' + fmtClock(cached.fetchedAt)) + ' (could not refresh: ' + friendlyError(e) + ')';
    } else {
      gridData = null; gridNote = 'Could not load ' + M.short + ' data: ' + friendlyError(e);
    }
  }
}

// running totals of precipitation and snow per grid point, so any frame's totals are one subtraction
function prepareGrid(d) {
  if (!DER.has(d)) {
    var n = d.spec.nx * d.spec.ny, nt = d.nt, cp = new Float32Array(n * nt), cs = new Float32Array(n * nt);
    for (var p = 0; p < n; p++) {
      var a = 0, b = 0, base = p * nt;
      for (var h = 0; h < nt; h++) {
        var v = d.pr[base + h], s = d.sn[base + h];
        if (v === v) a += v; if (s === s) b += s;
        cp[base + h] = a; cs[base + h] = b;
      }
    }
    DER.set(d, { cp: cp, cs: cs, ck: null });
  }
  buildSteps(d);
  if (view === 'asnow' && settings.snowRatio === 'kuchera') ensureKuchera();
}
function buildSteps(d) {
  var now = Date.now() / 1000, t0 = Math.floor(now / 10800) * 10800, steps = [];
  var oldT = d.steps && d.steps[stepIdx] ? d.steps[stepIdx].t : null, oldS0 = d.steps && d.steps.length ? d.steps[0].h : -1;
  for (var h = 0; h < d.nt; h++) {
    var t = d.times[h]; if (t < t0) continue;
    var lead = (t - t0) / 3600; if (lead > 168 || h > d.hLast) break;
    var hr = t / 3600;
    if (hr % 3 !== 0) continue;
    if (lead > 144 && hr % 6 !== 0) continue;
    steps.push({ h: h, t: t, lead: lead });
  }
  d.steps = steps;
  if (stepOwner !== d || !steps.length || steps[0].h !== oldS0) { stepCache.clear(); clearFrames(); stepOwner = d; }
  var same = oldT === null ? -1 : steps.findIndex(function (s) { return s.t === oldT; });
  if (same >= 0) stepIdx = same; else if (stepIdx >= steps.length) stepIdx = 0;
}

// ---------------------------------------------------------------- one time step's fields, smoothed for drawing
function fillNaN(a, fallback) {
  var sum = 0, n = 0, i;
  for (i = 0; i < a.length; i++) if (a[i] === a[i]) { sum += a[i]; n++; }
  var m = n ? sum / n : fallback;
  for (i = 0; i < a.length; i++) if (a[i] !== a[i]) a[i] = m;
}
function upBilinear(src, nx, ny, K) {
  var nxu = (nx - 1) * K + 1, nyu = (ny - 1) * K + 1, out = new Float32Array(nxu * nyu);
  for (var Y = 0; Y < nyu; Y++) {
    var gy = Y / K, j = Math.min(Math.floor(gy), ny - 2), ty = gy - j;
    for (var X = 0; X < nxu; X++) {
      var gx = X / K, i = Math.min(Math.floor(gx), nx - 2), tx = gx - i, b = j * nx + i;
      out[Y * nxu + X] = (src[b] * (1 - tx) + src[b + 1] * tx) * (1 - ty) + (src[b + nx] * (1 - tx) + src[b + nx + 1] * tx) * ty;
    }
  }
  return out;
}
function cr(t) {
  var t2 = t * t, t3 = t2 * t;
  return [-0.5 * t3 + t2 - 0.5 * t, 1.5 * t3 - 2.5 * t2 + 1, -1.5 * t3 + 2 * t2 + 0.5 * t, 0.5 * t3 - 0.5 * t2];
}
function upCubic(src, nx, ny, K) {
  var nxu = (nx - 1) * K + 1, nyu = (ny - 1) * K + 1, out = new Float32Array(nxu * nyu);
  for (var Y = 0; Y < nyu; Y++) {
    var gy = Y / K, j = Math.min(Math.floor(gy), ny - 2), wy = cr(gy - j);
    for (var X = 0; X < nxu; X++) {
      var gx = X / K, i = Math.min(Math.floor(gx), nx - 2), wx = cr(gx - i), s = 0;
      for (var m = -1; m <= 2; m++) {
        var jj = clamp(j + m, 0, ny - 1), row = 0;
        for (var n = -1; n <= 2; n++) row += wx[n + 1] * src[jj * nx + clamp(i + n, 0, nx - 1)];
        s += wy[m + 1] * row;
      }
      out[Y * nxu + X] = s;
    }
  }
  return out;
}
function stepGrids(d, si) {
  var der = DER.get(d), st = d.steps[si], h = st.h, s0 = d.steps[0].h, nt = d.nt, spec = d.spec, npts = spec.nx * spec.ny;
  var key = h + (der.ck ? 'k' : '');
  if (stepCache.has(key)) return stepCache.get(key);
  // rate = water that fell since the previous frame (3 or 6 hours), per hour
  var hp = si > 0 ? d.steps[si - 1].h : h - 1, hrs = hp >= 0 ? Math.max(1, (d.times[h] - d.times[hp]) / 3600) : 3;
  var mslp = new Float32Array(npts), th = new Float32Array(npts), t2 = new Float32Array(npts), rate = new Float32Array(npts), acc = new Float32Array(npts), snacc = new Float32Array(npts);
  var snk = der.ck ? new Float32Array(npts) : null;
  var fs = new Float32Array(npts), fm = new Float32Array(npts), ff = new Float32Array(npts);
  var dw = new Float32Array(npts), uu = new Float32Array(npts), vv = new Float32Array(npts);
  for (var p = 0; p < npts; p++) {
    var base = p * nt;
    mslp[p] = d.p[base + h]; t2[p] = d.t[base + h]; th[p] = d.th ? d.th[base + h] : NaN;
    dw[p] = d.dw ? d.dw[base + h] : NaN;
    var wsp = d.ws ? d.ws[base + h] : NaN, wdr = d.wd ? d.wd[base + h] : NaN;
    if (wsp === wsp && wdr === wdr) { uu[p] = -wsp * Math.sin(wdr * Math.PI / 180); vv[p] = -wsp * Math.cos(wdr * Math.PI / 180); } else { uu[p] = NaN; vv[p] = NaN; }
    rate[p] = hp >= 0 ? (der.cp[base + h] - der.cp[base + hp]) / hrs : (d.pr[base + h] || 0) / hrs;
    acc[p] = der.cp[base + h] - der.cp[base + s0];
    snacc[p] = der.cs[base + h] - der.cs[base + s0];
    if (snk) snk[p] = der.ck[base + h] - der.ck[base + s0];
    var code = d.hasType ? d.pt[base + h] : -1, T = t2[p];
    if (code > 0) {
      if (code === 5 || code === 6) fs[p] = 1; else if (code === 7) fm[p] = 1; else if (code === 3 || code === 8 || code === 12) ff[p] = 1;
    } else if (!d.hasType) {
      // no type from the model: share of the water that fell as snow (10:1 depth / 10 = snow water), rest by temperature
      var wnow = d.pr[base + h], snw = d.sn[base + h] * 0.1;
      if (wnow === wnow && wnow > 0.0005 && snw === snw) {
        var frac = clamp(snw / wnow, 0, 1);
        fs[p] = frac;
        if (frac < 0.5 && T === T && T <= 35) { if (T <= 31) ff[p] = 1 - frac; else fm[p] = 1 - frac; }
      } else if (T === T) {
        if (T <= 31) fs[p] = 1; else if (T <= 35) fm[p] = 1;
      }
    } else if (T === T) {
      if (T <= 31) fs[p] = 1; else if (T <= 35) fm[p] = 1;
    }
  }
  fillNaN(mslp, 1013); fillNaN(t2, 40);
  var hasTh = false; for (var q0 = 0; q0 < npts; q0++) if (th[q0] === th[q0]) { hasTh = true; break; }
  if (hasTh) fillNaN(th, 552);
  var hasDew = false, hasWind = false; for (var q1 = 0; q1 < npts; q1++) { if (dw[q1] === dw[q1]) hasDew = true; if (uu[q1] === uu[q1]) hasWind = true; }
  if (hasDew) fillNaN(dw, 40);
  if (hasWind) { fillNaN(uu, 0); fillNaN(vv, 0); }
  var K2 = spec.step <= 0.25 ? 2 : 4, nx = spec.nx, ny = spec.ny;
  var g = {
    h: h, K: K2, nxu: (nx - 1) * K2 + 1, nyu: (ny - 1) * K2 + 1, spec: spec, deg: spec.step / K2,
    mslp: upCubic(mslp, nx, ny, K2), th: hasTh ? upCubic(th, nx, ny, K2) : null, t2: upCubic(t2, nx, ny, K2),
    dw: hasDew ? upCubic(dw, nx, ny, K2) : null, u: hasWind ? upBilinear(uu, nx, ny, K2) : null, v: hasWind ? upBilinear(vv, nx, ny, K2) : null,
    rate: upBilinear(rate, nx, ny, K2), acc: upBilinear(acc, nx, ny, K2), snacc: upBilinear(snacc, nx, ny, K2), snaccK: snk ? upBilinear(snk, nx, ny, K2) : null,
    fs: upBilinear(fs, nx, ny, K2), fm: upBilinear(fm, nx, ny, K2), ff: upBilinear(ff, nx, ny, K2)
  };
  stepCache.set(key, g);
  return g;
}

// ---------------------------------------------------------------- Kuchera snow ratio (downloaded only when chosen)
// Ratio from the warmest temperature between the ground and 500 mb: 12 at -2°C, rising as the column gets colder.
function kuchRatio(tmaxF) {
  var k = (tmaxF - 32) * 5 / 9 + 273.15, r = k > 271.16 ? 12 + 2 * (271.16 - k) : 12 + (271.16 - k);
  return r < 0 ? 0 : r;
}
var kuchBusy = false;
async function ensureKuchera() {
  var d = gridData; if (!d || settings.snowRatio !== 'kuchera') return;
  var der = DER.get(d); if (!der || der.ck || kuchBusy) return;
  var M = modelById(d.modelId), key = 'lev-' + M.id, npts = d.spec.nx * d.spec.ny, nt = d.nt;
  kuchBusy = true; kuchNote = 'Loading upper-air temperatures for the Kuchera ratio…'; scheduleRender();
  try {
    var tmax = null;
    if (demo) tmax = makeDemoTmax(d);
    else {
      var c = await idb.get(key);
      if (c && c.ver === CACHE_VER && c.gridFetchedAt === d.fetchedAt && c.detail === d.detail) tmax = c.tmax;
      else {
        // Upper-air temperatures vary smoothly, so they come from the 0.5° grid (about 150 points) and are blended onto the map grid.
        var cs = gridSpec('standard'), ncs = cs.nx * cs.ny;
        var F = await fetchPoints(cs, M, d.win, 'temperature_925hPa,temperature_850hPa,temperature_700hPa,temperature_600hPa,temperature_500hPa');
        var tc = new Float32Array(ncs * nt);
        F.results.forEach(function (arr, ci) {
          arr.forEach(function (loc, q) {
            var hh = loc.hourly, idx = (ci * F.CH + q) * nt;
            var L = ['temperature_925hPa', 'temperature_850hPa', 'temperature_700hPa', 'temperature_600hPa', 'temperature_500hPa'].map(function (n) { return pick(hh, n); });
            for (var x = 0; x < nt; x++) {
              var m = -Infinity;
              L.forEach(function (a) { var v = val(a, x); if (v > m) m = v; });
              tc[idx + x] = m === -Infinity ? NaN : m;
            }
          });
        });
        tmax = new Float32Array(npts * nt);
        var r = cs.step / d.spec.step; // 2 on the fine grid, 1 on the standard grid
        for (var j = 0; j < d.spec.ny; j++) {
          var fy = Math.min(j / r, cs.ny - 1.0001), j0 = fy | 0, ty = fy - j0;
          for (var i = 0; i < d.spec.nx; i++) {
            var fx = Math.min(i / r, cs.nx - 1.0001), i0 = fx | 0, tx = fx - i0;
            var a00 = (j0 * cs.nx + i0) * nt, a01 = a00 + nt, a10 = a00 + cs.nx * nt, a11 = a10 + nt, o = (j * d.spec.nx + i) * nt;
            for (var x2 = 0; x2 < nt; x2++) {
              tmax[o + x2] = (tc[a00 + x2] * (1 - tx) + tc[a01 + x2] * tx) * (1 - ty) + (tc[a10 + x2] * (1 - tx) + tc[a11 + x2] * tx) * ty;
            }
          }
        }
        idb.set(key, { ver: CACHE_VER, gridFetchedAt: d.fetchedAt, detail: d.detail, tmax: tmax });
        log(M.short + ': fetched upper-air temperatures for the Kuchera ratio');
      }
    }
    var ck = new Float32Array(npts * nt);
    for (var p = 0; p < npts; p++) {
      var a = 0, base = p * nt;
      for (var h = 0; h < nt; h++) {
        var s = d.sn[base + h], lv = tmax[base + h], t2 = d.t[base + h], tm = lv === lv ? (t2 === t2 ? Math.max(lv, t2) : lv) : t2;
        if (s === s && s > 0 && tm === tm) a += s / 10 * kuchRatio(tm); // 10:1 depth / 10 = snow water
        ck[base + h] = a;
      }
    }
    if (gridData !== d) return;
    der.ck = ck; kuchNote = '';
  } catch (e) {
    log('Kuchera data error: ' + friendlyError(e));
    kuchNote = 'Could not load the Kuchera data (' + friendlyError(e) + '); showing 10:1.';
  } finally { kuchBusy = false; scheduleRender(); }
}
