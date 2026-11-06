/* Backyard Weather: live station readings + ECMWF (Euro) maps drawn on the phone.
   Station data: Weather Underground PWS API. Model data: Open-Meteo (ECMWF IFS, CC BY 4.0). */
(function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  var HOME = { lat: 42.240, lon: -71.504 };
  // Map area is centred on HOME (about 3 degrees of longitude each side, 2.25 degrees of latitude).
  var DOM = { lat0: 40.0, lat1: 44.5, lon0: -74.5, lon1: -68.5 };
  var DOM_KEY = [DOM.lat0, DOM.lat1, DOM.lon0, DOM.lon1].join(',');
  var OM = 'https://api.open-meteo.com/v1/ecmwf';
  var TT = 'https://www.tropicaltidbits.com/analysis/models/?model=ecmwf&region=neus&pkg=';
  var GRID_TTL = 2 * 3600 * 1000; // reuse saved model data for 2 hours
  var CITIES = [
    ['Boston', 42.36, -71.06], ['Hartford', 41.76, -72.67], ['Providence', 41.82, -71.41],
    ['Albany', 42.65, -73.76], ['Portland', 43.66, -70.26], ['Springfield', 42.10, -72.59],
    ['Concord', 43.21, -71.54], ['New York', 40.71, -74.0], ['Hyannis', 41.65, -70.28]
  ];
  var VIEWS = [
    { id: 'mslp_pcpn', label: 'MSLP & Precip', tt: 'mslp_pcpn', sub: 'Sea-level pressure (hPa) and precipitation rate (in/hr)' },
    { id: 'mslp_pcpn_frzn', label: 'Rain / Frozen', tt: 'mslp_pcpn_frzn', sub: 'Sea-level pressure (hPa), precipitation rate (in/hr) colored by type' },
    { id: 'apcpn', label: 'Total Precip', tt: 'apcpn', sub: 'Precipitation accumulated since the first time shown (inches)' },
    { id: 't2m', label: '2m Temp', tt: 'T2m', sub: '2-metre air temperature (°F); cyan line = freezing' }
  ];

  // ---------------------------------------------------------------- helpers
  function el(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  var settings = Object.assign({ apiKey: '', stationId: 'KMAHOPKI22', detail: 'standard' }, store.get('wx.settings', {}));
  var params = new URLSearchParams(location.search);
  var demo = params.get('demo') === '1' || store.get('wx.demo', false);

  var idb = {
    db: null,
    open: function () {
      return new Promise(function (res) {
        try {
          var r = indexedDB.open('wx', 1);
          r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
          r.onsuccess = function () { res(r.result); };
          r.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    },
    get: async function (k) {
      if (!this.db) this.db = await this.open();
      var db = this.db; if (!db) return null;
      return new Promise(function (res) {
        try { var q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; } catch (e) { res(null); }
      });
    },
    set: async function (k, v) {
      if (!this.db) this.db = await this.open();
      var db = this.db; if (!db) return;
      return new Promise(function (res) {
        try { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); }; } catch (e) { res(); }
      });
    },
    del: async function (k) {
      if (!this.db) this.db = await this.open();
      var db = this.db; if (!db) return;
      return new Promise(function (res) {
        try { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); }; } catch (e) { res(); }
      });
    }
  };

  var logLines = [];
  function log(msg) {
    var d = new Date();
    logLines.push(pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '  ' + msg);
    if (logLines.length > 200) logLines.shift();
    var pre = el('diag-log');
    if (pre) { pre.textContent = logLines.join('\n'); pre.scrollTop = pre.scrollHeight; }
  }
  function friendlyError(e) {
    var m = (e && e.message) || String(e);
    if (e && (e.name === 'TypeError') || /Load failed|Failed to fetch|NetworkError/i.test(m)) {
      return 'Could not connect (' + m + '). Either there is no internet, or the site refuses requests from a web page.';
    }
    return m;
  }
  function fmtDay(t) { return new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric' }); }
  function fmtClock(ms) { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function compass(deg) {
    var d = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
    return d[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
  }
  function fmt(v, dp) { return (v === null || v === undefined || isNaN(v)) ? '–' : Number(v).toFixed(dp); }
  function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }

  // ---------------------------------------------------------------- color tables
  var TSTOPS = [[-30, '#d9c4ff'], [-20, '#a78bfa'], [-10, '#7c4dff'], [0, '#4a3fc0'], [10, '#3a62d6'], [20, '#3b8be3'],
    [28, '#52b3ef'], [32, '#a9e7f7'], [34, '#8fdc9a'], [40, '#5fc46b'], [50, '#d8e65a'], [60, '#f7c548'], [70, '#f58f35'],
    [80, '#e04a2b'], [90, '#b3172f'], [100, '#7b1048'], [110, '#4a0a40']];
  var TLUT = (function () {
    var out = [];
    for (var v = -30; v <= 110; v += 0.5) {
      var k = 0; while (k < TSTOPS.length - 2 && v > TSTOPS[k + 1][0]) k++;
      var a = TSTOPS[k], b = TSTOPS[k + 1];
      var f = clamp((v - a[0]) / (b[0] - a[0]), 0, 1);
      var ca = hex(a[1]), cb = hex(b[1]);
      out.push([ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]);
    }
    return out;
  })();
  var RATE_T = [0.004, 0.01, 0.02, 0.04, 0.07, 0.1, 0.15, 0.25, 0.4, 0.7, 1.0];
  var PAL = {
    rain: ['#2c8a4a', '#3cae4e', '#6fcf4e', '#b9e64a', '#f4e242', '#f7b43a', '#f27a2f', '#e0422b', '#c01f2f', '#a1177e', '#d79bef'],
    snow: ['#a9cff0', '#7fb3ea', '#5593e0', '#3a72d4', '#2f54c0', '#3a3fa8', '#53329e', '#7430ad', '#9a38c4', '#c070de', '#e2b0f1'],
    mix: ['#ffd9a8', '#ffc27a', '#ffa94d', '#ff8a2b', '#f06d1a', '#d95510', '#bf400d', '#a32d0c', '#8a1f0f', '#6e1410', '#52100f'],
    frz: ['#ffc9d6', '#ff9fb8', '#ff7599', '#ff4a7c', '#e62a63', '#c01a50', '#9a1040', '#7a0b34', '#5e0829', '#44061f', '#2e0415']
  };
  var ACC_T = [0.01, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6];
  var ACC_C = ['#cfe8d0', '#9bd5a4', '#64bd77', '#34a05a', '#1f8a5f', '#1d7f8f', '#2663b5', '#3a47b8', '#5a35a8', '#7d2d9c', '#a82a8a', '#d63a6d'];
  var RGB = {};
  Object.keys(PAL).forEach(function (k) { RGB[k] = PAL[k].map(hex); });
  var ACC_RGB = ACC_C.map(hex);

  // ---------------------------------------------------------------- model data
  var gridData = null;   // maps
  var pointData = null;  // backyard series
  var station = null;
  var gridNote = '';
  var view = store.get('wx.view', 'mslp_pcpn');
  if (!VIEWS.some(function (v) { return v.id === view; })) view = 'mslp_pcpn';
  var stepIdx = 0;
  var stepCache = new Map();

  function gridSpec(detail) {
    var step = detail === 'fine' ? 0.25 : 0.5, lats = [], lons = [], i, v;
    for (i = 0; ; i++) { v = DOM.lat0 + i * step; if (v > DOM.lat1 + 1e-6) break; lats.push(+v.toFixed(3)); }
    for (i = 0; ; i++) { v = DOM.lon0 + i * step; if (v > DOM.lon1 + 1e-6) break; lons.push(+v.toFixed(3)); }
    return { step: step, lats: lats, lons: lons, nx: lons.length, ny: lats.length };
  }
  function pick(h, name) {
    if (h[name]) return h[name];
    var k = Object.keys(h).filter(function (x) { return x.indexOf(name) === 0; })[0];
    return k ? h[k] : null;
  }
  async function omFetch(url) {
    var r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) {
      var reason = '';
      try { var j = await r.json(); reason = j.reason || ''; } catch (e) { /* ignore */ }
      var err = new Error('Open-Meteo HTTP ' + r.status + (reason ? ': ' + reason : ''));
      err.status = r.status; err.reason = reason; throw err;
    }
    return r.json();
  }
  async function fetchGrid(spec, useType) {
    var pts = [], j, i;
    for (j = 0; j < spec.ny; j++) for (i = 0; i < spec.nx; i++) pts.push([spec.lats[j], spec.lons[i]]);
    var CH = 100, chunks = [];
    for (var k = 0; k < pts.length; k += CH) chunks.push(pts.slice(k, k + CH));
    var vars = 'pressure_msl,precipitation,temperature_2m' + (useType ? ',precipitation_type' : '');
    var results = new Array(chunks.length), next = 0;
    async function worker() {
      while (next < chunks.length) {
        var c = next++;
        var lat = chunks[c].map(function (p) { return p[0]; }).join(',');
        var lon = chunks[c].map(function (p) { return p[1]; }).join(',');
        var url = OM + '?latitude=' + lat + '&longitude=' + lon + '&hourly=' + vars +
          '&models=ecmwf_ifs025&temperature_unit=fahrenheit&precipitation_unit=inch&timeformat=unixtime&timezone=GMT&forecast_days=8';
        var arr;
        try { arr = await omFetch(url); }
        catch (e) {
          if (e.status !== 429) throw e;
          log('Maps: Open-Meteo asked us to slow down; waiting 20 seconds, then retrying');
          await new Promise(function (r) { setTimeout(r, 20000); });
          arr = await omFetch(url);
        }
        results[c] = Array.isArray(arr) ? arr : [arr];
      }
    }
    await Promise.all([worker(), worker(), worker()]);
    var first = pick(results[0][0].hourly, 'time'), nt = first.length, npts = pts.length;
    var d = {
      detail: settings.detail, dom: DOM_KEY, spec: spec, nt: nt, times: Float64Array.from(first), fetchedAt: Date.now(),
      p: new Float32Array(npts * nt), pr: new Float32Array(npts * nt), t: new Float32Array(npts * nt),
      pt: useType ? new Int8Array(npts * nt) : null, hasType: !!useType, model: 'ecmwf_ifs025'
    };
    var base = 0;
    results.forEach(function (arr, c) {
      arr.forEach(function (loc, q) {
        var h = loc.hourly, idx = (c * CH + q) * nt;
        var P = pick(h, 'pressure_msl'), R = pick(h, 'precipitation'), T = pick(h, 'temperature_2m'), Y = useType ? pick(h, 'precipitation_type') : null;
        for (var x = 0; x < nt; x++) {
          d.p[idx + x] = P && P[x] !== null ? P[x] : NaN;
          d.pr[idx + x] = R && R[x] !== null ? R[x] : NaN;
          d.t[idx + x] = T && T[x] !== null ? T[x] : NaN;
          if (useType) d.pt[idx + x] = Y && Y[x] !== null ? Y[x] : -1;
        }
      });
      base += arr.length;
    });
    return d;
  }
  async function loadGrid(force) {
    var spec = gridSpec(settings.detail);
    gridNote = '';
    if (demo) { gridData = makeDemoGrid(spec); buildSteps(gridData); gridNote = 'DEMO data (not real forecasts)'; return; }
    var cached = await idb.get('grid');
    var fresh = cached && cached.detail === settings.detail && cached.dom === DOM_KEY && cached.model === 'ecmwf_ifs025' && (Date.now() - cached.fetchedAt) < GRID_TTL;
    if (fresh && !force) { gridData = cached; buildSteps(gridData); log('Maps: using saved Euro data from ' + fmtClock(cached.fetchedAt)); return; }
    var useType = store.get('wx.hasType', true);
    try {
      var d;
      try {
        d = await fetchGrid(spec, useType);
      } catch (e) {
        if (useType && /precipitation_type|variable/i.test(e.message || '')) {
          log('Maps: precipitation type not offered; retrying without it (type will be estimated from temperature)');
          useType = false; store.set('wx.hasType', false);
          d = await fetchGrid(spec, false);
        } else { throw e; }
      }
      gridData = d; buildSteps(d); idb.set('grid', d);
      log('Maps: fetched ' + spec.nx * spec.ny + ' points, ' + d.nt + ' hours' + (d.hasType ? ', with precip type' : ', type estimated'));
    } catch (e) {
      log('Maps error: ' + friendlyError(e));
      if (cached && cached.detail === settings.detail && cached.dom === DOM_KEY) {
        gridData = cached; buildSteps(cached);
        gridNote = 'Showing saved run from ' + fmtClock(cached.fetchedAt) + ' (could not refresh: ' + friendlyError(e) + ')';
      } else {
        gridData = null; gridNote = 'Could not load Euro data: ' + friendlyError(e);
      }
    }
  }
  function buildSteps(d) {
    var now = Date.now() / 1000, t0 = Math.floor(now / 10800) * 10800, steps = [];
    for (var h = 0; h < d.nt; h++) {
      var t = d.times[h]; if (t < t0) continue;
      var lead = (t - t0) / 3600; if (lead > 168) break;
      var hr = t / 3600;
      if (hr % 3 !== 0) continue;
      if (lead > 144 && hr % 6 !== 0) continue;
      steps.push({ h: h, t: t, lead: lead });
    }
    d.steps = steps;
    stepCache.clear();
    if (stepIdx >= steps.length) stepIdx = 0;
  }

  async function loadPoint() {
    if (demo) { pointData = makeDemoPoint(); return; }
    var base = OM + '?latitude=' + HOME.lat + '&longitude=' + HOME.lon +
      '&hourly=temperature_2m,precipitation,pressure_msl&temperature_unit=fahrenheit&precipitation_unit=inch&timeformat=unixtime&timezone=GMT&forecast_days=8';
    var models = ['ecmwf_ifs', 'ecmwf_ifs025'], lastErr = null;
    for (var m = 0; m < models.length; m++) {
      try {
        var j = await omFetch(base + '&models=' + models[m]);
        var h = j.hourly;
        pointData = { model: models[m], times: pick(h, 'time'), t: pick(h, 'temperature_2m'), pr: pick(h, 'precipitation'), p: pick(h, 'pressure_msl') };
        log('Backyard forecast OK (' + models[m] + ')');
        return;
      } catch (e) { lastErr = e; log('Backyard forecast (' + models[m] + ') failed: ' + friendlyError(e)); }
    }
    pointData = null;
    el('point-note').textContent = 'Could not load backyard forecast: ' + friendlyError(lastErr);
  }

  // ---------------------------------------------------------------- station
  async function loadStation() {
    if (demo) { station = makeDemoStation(); renderStation(); return; }
    if (!settings.apiKey) { station = null; renderStation('nokey'); return; }
    var url = 'https://api.weather.com/v2/pws/observations/current?stationId=' + encodeURIComponent(settings.stationId) +
      '&format=json&units=e&numericPrecision=decimal&apiKey=' + encodeURIComponent(settings.apiKey);
    try {
      var r = await fetch(url, { cache: 'no-store' });
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
        solar: o.solarRadiation, epoch: o.epoch ? o.epoch * 1000 : (o.obsTimeUtc ? Date.parse(o.obsTimeUtc) : Date.now()), fetchedAt: Date.now()
      };
      log('Station OK (' + settings.stationId + ')');
      renderStation();
    } catch (e) {
      log('Station error: ' + friendlyError(e));
      station = null; renderStation('error', friendlyError(e));
    }
  }
  function renderStation(state, msg) {
    var box = el('station-body');
    if (state === 'nokey') {
      box.innerHTML = '<p class="muted">Add your free Weather Underground API key to see live readings from <b></b>.</p><button class="btn primary" data-action="settings">Add API key</button>';
      box.querySelector('b').textContent = settings.stationId; return;
    }
    if (!state && !station) { box.innerHTML = '<p class="muted">Loading\u2026</p>'; return; }
    if (state === 'error' || !station) {
      box.innerHTML = '<p class="warn"></p><button class="btn" data-action="settings">Open settings</button>';
      box.querySelector('.warn').textContent = msg || 'No station data yet.'; return;
    }
    var s = station, feels = s.temp;
    if (s.temp >= 80 && s.heatIndex != null) feels = s.heatIndex; else if (s.temp <= 50 && s.windChill != null) feels = s.windChill;
    var age = Math.max(0, Math.round((Date.now() - s.epoch) / 60000));
    var ageTxt = age < 1 ? 'just now' : age < 60 ? age + ' min ago' : Math.round(age / 60) + ' h ago';
    var stale = age > 30;
    box.innerHTML =
      '<div class="hero"><div class="big">' + fmt(s.temp, 1) + '<small>°F</small></div><div class="hero-side"><div>Feels like ' + fmt(feels, 0) + '°</div>' +
      '<div class="muted' + (stale ? ' warn' : '') + '">Reported ' + ageTxt + '</div></div></div>' +
      '<div class="tiles">' +
      tile('Humidity', fmt(s.hum, 0), '%') + tile('Dew point', fmt(s.dew, 0), '°') +
      tile('Wind', fmt(s.wind, 1), ' mph ' + (s.dir != null ? compass(s.dir) : '')) + tile('Gusts', fmt(s.gust, 1), ' mph') +
      tile('Pressure', fmt(s.pressure, 2), ' inHg') + tile('Rain today', fmt(s.rainToday, 2), ' in') +
      tile('Rain rate', fmt(s.rate, 2), ' in/hr') + tile('UV / Solar', fmt(s.uv, 0) + ' / ' + fmt(s.solar, 0), ' W/m²') +
      '</div><div class="muted small" id="compare"></div>';
    updateCompare();
  }
  function tile(k, v, u) { return '<div class="tile"><div class="k">' + k + '</div><div class="v">' + v + '<small>' + u + '</small></div></div>'; }
  function euroNow() {
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
  function updateCompare() {
    var c = el('compare'); if (!c || !station) return;
    var e = euroNow(); if (e === null) { c.textContent = ''; return; }
    var d = station.temp - e;
    c.textContent = 'The Euro has ' + e.toFixed(0) + '° for your backyard right now; your station reads ' + Math.abs(d).toFixed(1) + '° ' + (d >= 0 ? 'warmer' : 'colder') + '.';
  }

  // ---------------------------------------------------------------- field math
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
    if (stepCache.has(si)) return stepCache.get(si);
    var st = d.steps[si], h = st.h, s0 = d.steps[0].h, nt = d.nt, spec = d.spec, npts = spec.nx * spec.ny;
    var prevH = si > 0 ? d.steps[si - 1].h : h - 3, dt = Math.max(1, h - prevH);
    var mslp = new Float32Array(npts), t2 = new Float32Array(npts), rate = new Float32Array(npts), acc = new Float32Array(npts);
    var fs = new Float32Array(npts), fm = new Float32Array(npts), ff = new Float32Array(npts);
    for (var p = 0; p < npts; p++) {
      var base = p * nt;
      mslp[p] = d.p[base + h]; t2[p] = d.t[base + h];
      var sum = 0, cnt = 0, k, v;
      for (k = Math.max(0, h - dt + 1); k <= h; k++) { v = d.pr[base + k]; if (v === v) { sum += v; cnt++; } }
      rate[p] = cnt ? sum / cnt : 0;
      var a = 0; for (k = s0 + 1; k <= h; k++) { v = d.pr[base + k]; if (v === v) a += v; }
      acc[p] = a;
      var code = d.hasType ? d.pt[base + h] : -1, T = t2[p];
      if (code > 0) {
        if (code === 5 || code === 6) fs[p] = 1; else if (code === 7) fm[p] = 1; else if (code === 3 || code === 8 || code === 12) ff[p] = 1;
      } else if (T === T) {
        if (T <= 31) fs[p] = 1; else if (T <= 35) fm[p] = 1;
      }
    }
    fillNaN(mslp, 1013); fillNaN(t2, 40);
    var K2 = spec.step <= 0.25 ? 2 : 4;
    var g = {
      K: K2, nxu: (spec.nx - 1) * K2 + 1, nyu: (spec.ny - 1) * K2 + 1, spec: spec, deg: spec.step / K2,
      mslp: upCubic(mslp, spec.nx, spec.ny, K2), t2: upCubic(t2, spec.nx, spec.ny, K2),
      rate: upBilinear(rate, spec.nx, spec.ny, K2), acc: upBilinear(acc, spec.nx, spec.ny, K2),
      fs: upBilinear(fs, spec.nx, spec.ny, K2), fm: upBilinear(fm, spec.nx, spec.ny, K2), ff: upBilinear(ff, spec.nx, spec.ny, K2)
    };
    stepCache.set(si, g);
    if (stepCache.size > 14) stepCache.delete(stepCache.keys().next().value);
    return g;
  }

  // ---------------------------------------------------------------- contours
  function contourChains(a, nx, ny, level) {
    var nH = nx * ny, segs = [], i, j;
    function H(ii, jj) { return jj * nx + ii; }
    function V(ii, jj) { return nH + jj * nx + ii; }
    for (j = 0; j < ny - 1; j++) {
      for (i = 0; i < nx - 1; i++) {
        var tl = a[j * nx + i], tr = a[j * nx + i + 1], br = a[(j + 1) * nx + i + 1], bl = a[(j + 1) * nx + i];
        var c = (tl >= level ? 1 : 0) | (tr >= level ? 2 : 0) | (br >= level ? 4 : 0) | (bl >= level ? 8 : 0);
        if (c === 0 || c === 15) continue;
        var T = H(i, j), B = H(i, j + 1), L = V(i, j), R = V(i + 1, j);
        switch (c) {
          case 1: case 14: segs.push([L, T]); break;
          case 2: case 13: segs.push([T, R]); break;
          case 3: case 12: segs.push([L, R]); break;
          case 4: case 11: segs.push([R, B]); break;
          case 6: case 9: segs.push([T, B]); break;
          case 7: case 8: segs.push([L, B]); break;
          case 5: if ((tl + tr + br + bl) / 4 >= level) { segs.push([T, R]); segs.push([L, B]); } else { segs.push([L, T]); segs.push([R, B]); } break;
          case 10: if ((tl + tr + br + bl) / 4 >= level) { segs.push([L, T]); segs.push([R, B]); } else { segs.push([T, R]); segs.push([L, B]); } break;
        }
      }
    }
    var adj = new Map();
    segs.forEach(function (s, k) { s.forEach(function (e) { var l = adj.get(e); if (!l) { l = []; adj.set(e, l); } l.push(k); }); });
    var used = new Uint8Array(segs.length), out = [];
    function pt(e) {
      if (e < nH) { var ii = e % nx, jj = (e - ii) / nx, v0 = a[e], v1 = a[e + 1]; return [ii + (level - v0) / (v1 - v0), jj]; }
      var q = e - nH, i2 = q % nx, j2 = (q - i2) / nx, w0 = a[q], w1 = a[q + nx]; return [i2, j2 + (level - w0) / (w1 - w0)];
    }
    for (var k = 0; k < segs.length; k++) {
      if (used[k]) continue; used[k] = 1;
      var chain = [segs[k][0], segs[k][1]];
      for (var dir = 0; dir < 2; dir++) {
        for (;;) {
          var end = dir ? chain[0] : chain[chain.length - 1];
          var cand = adj.get(end).filter(function (q) { return !used[q]; })[0];
          if (cand === undefined) break;
          used[cand] = 1;
          var s = segs[cand], nxt = s[0] === end ? s[1] : s[0];
          if (dir) chain.unshift(nxt); else chain.push(nxt);
        }
      }
      out.push(chain.map(pt));
    }
    return out;
  }
  function findExtremes(g) {
    var a = g.mslp, nx = g.nxu, ny = g.nyu, r = Math.round(2.2 / g.deg), out = [];
    for (var j = 2; j < ny - 2; j++) {
      for (var i = 2; i < nx - 2; i++) {
        var v = a[j * nx + i], isMin = v <= 1014, isMax = v >= 1020;
        if (!isMin && !isMax) continue;
        for (var jj = Math.max(0, j - r); jj <= Math.min(ny - 1, j + r) && (isMin || isMax); jj++) {
          for (var ii = Math.max(0, i - r); ii <= Math.min(nx - 1, i + r); ii++) {
            var w = a[jj * nx + ii];
            if (isMin && w < v) isMin = false;
            if (isMax && w > v) isMax = false;
            if (!isMin && !isMax) break;
          }
        }
        if (!isMin && !isMax) continue;
        var dup = out.some(function (o) { return Math.abs(o.i - i) <= r && Math.abs(o.j - j) <= r; });
        if (!dup) out.push({ i: i, j: j, v: v, type: isMin ? 'L' : 'H' });
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- map drawing
  var off = document.createElement('canvas');
  function viewDef(id) { return VIEWS.filter(function (v) { return v.id === id; })[0]; }
  function shade(g, W, H, scale) {
    var w = Math.round(W * scale), h = Math.round(H * scale), img = new ImageData(w, h), data = img.data;
    var nxu = g.nxu, nyu = g.nyu, deg = g.deg;
    var X0 = new Int32Array(w), TX = new Float32Array(w), px, py;
    for (px = 0; px < w; px++) {
      var lon = DOM.lon0 + (px + 0.5) / w * (DOM.lon1 - DOM.lon0), f = clamp((lon - DOM.lon0) / deg, 0, nxu - 1.0001);
      X0[px] = f | 0; TX[px] = f - (f | 0);
    }
    function bil(a, x0, tx, y0, ty) {
      var i = y0 * nxu + x0;
      return (a[i] * (1 - tx) + a[i + 1] * tx) * (1 - ty) + (a[i + nxu] * (1 - tx) + a[i + nxu + 1] * tx) * ty;
    }
    for (py = 0; py < h; py++) {
      var lat = DOM.lat1 - (py + 0.5) / h * (DOM.lat1 - DOM.lat0), fy = clamp((lat - DOM.lat0) / deg, 0, nyu - 1.0001), y0 = fy | 0, ty = fy - y0;
      for (px = 0; px < w; px++) {
        var x0 = X0[px], tx = TX[px], o = (py * w + px) * 4, rgb = null, alpha = 0, k, v;
        if (view === 't2m') {
          v = bil(g.t2, x0, tx, y0, ty);
          rgb = TLUT[clamp(Math.round((v + 30) * 2), 0, TLUT.length - 1)]; alpha = 238;
        } else if (view === 'apcpn') {
          v = bil(g.acc, x0, tx, y0, ty);
          if (v >= ACC_T[0]) { k = 0; while (k < ACC_T.length - 1 && v >= ACC_T[k + 1]) k++; rgb = ACC_RGB[k]; alpha = 228; }
        } else {
          v = bil(g.rate, x0, tx, y0, ty);
          if (v >= RATE_T[0]) {
            k = 0; while (k < RATE_T.length - 1 && v >= RATE_T[k + 1]) k++;
            var pal = 'rain';
            if (view === 'mslp_pcpn_frzn') {
              var fs = bil(g.fs, x0, tx, y0, ty), fm = bil(g.fm, x0, tx, y0, ty), ff = bil(g.ff, x0, tx, y0, ty), best = 1 - (fs + fm + ff);
              if (fs > best) { pal = 'snow'; best = fs; }
              if (fm > best) { pal = 'mix'; best = fm; }
              if (ff > best) { pal = 'frz'; }
            }
            rgb = RGB[pal][k]; alpha = 226;
          }
        }
        if (rgb) { data[o] = rgb[0]; data[o + 1] = rgb[1]; data[o + 2] = rgb[2]; data[o + 3] = alpha; }
      }
    }
    off.width = w; off.height = h; off.getContext('2d').putImageData(img, 0, 0);
  }
  function drawLines(ctx, lines, proj) {
    ctx.beginPath();
    lines.forEach(function (l) {
      for (var i = 0; i < l.length; i += 2) { var p = proj(l[i], l[i + 1]); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
    });
    ctx.stroke();
  }
  function halo(ctx, text, x, y) {
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(8,14,22,.8)'; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
  }
  function renderMap() {
    var cv = el('map'), wrap = el('map-wrap'), d = gridData;
    var W = Math.floor(wrap.getBoundingClientRect().width) || 340;
    var aspect = (DOM.lon1 - DOM.lon0) * Math.cos((DOM.lat0 + DOM.lat1) / 2 * Math.PI / 180) / (DOM.lat1 - DOM.lat0);
    var H = Math.round(W / aspect), dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0e1621'; ctx.fillRect(0, 0, W, H);
    function proj(lon, lat) { return [(lon - DOM.lon0) / (DOM.lon1 - DOM.lon0) * W, (DOM.lat1 - lat) / (DOM.lat1 - DOM.lat0) * H]; }
    if (d && d.steps && d.steps.length) {
      var g = stepGrids(d, stepIdx);
      shade(g, W, H, 2);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, W, H);
      geoLines(ctx, proj);
      if (view === 't2m') {
        ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.6;
        contourChains(g.t2, g.nxu, g.nyu, 32).forEach(function (ch) { pathChain(ctx, ch, g, proj); ctx.stroke(); });
      } else if (view !== 'apcpn') {
        drawPressure(ctx, g, proj);
      }
    } else {
      geoLines(ctx, proj);
      ctx.fillStyle = '#9fb0c0'; ctx.font = '14px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d ? 'No forecast steps available' : 'Loading Euro data…', W / 2, H / 2);
    }
    cities(ctx, proj, W, H);
    drawLegend();
    updateTimeUI();
  }
  function geoLines(ctx, proj) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255,255,255,.38)'; ctx.lineWidth = 0.7; drawLines(ctx, GEO.states, proj);
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; drawLines(ctx, GEO.border, proj);
    ctx.strokeStyle = 'rgba(235,242,250,.92)'; ctx.lineWidth = 1; drawLines(ctx, GEO.coast, proj);
  }
  function pathChain(ctx, ch, g, proj) {
    ctx.beginPath();
    ch.forEach(function (q, i) {
      var p = proj(DOM.lon0 + q[0] * g.deg, DOM.lat0 + q[1] * g.deg);
      if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]);
    });
  }
  function drawPressure(ctx, g, proj) {
    var mn = Infinity, mx = -Infinity, i;
    for (i = 0; i < g.mslp.length; i++) { var v = g.mslp[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
    var labels = [];
    ctx.lineJoin = 'round';
    for (var lev = Math.ceil(mn / 4) * 4; lev <= mx; lev += 4) {
      var chains = contourChains(g.mslp, g.nxu, g.nyu, lev), bold = lev % 20 === 0;
      chains.forEach(function (ch) {
        if (ch.length < 3) return;
        pathChain(ctx, ch, g, proj);
        ctx.strokeStyle = 'rgba(5,10,18,.35)'; ctx.lineWidth = bold ? 3.4 : 2.4; ctx.stroke();
        ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = bold ? 1.7 : 1; ctx.stroke();
        if (lev % 8 === 0) {
          var len = 0, pts = ch.map(function (q) { return proj(DOM.lon0 + q[0] * g.deg, DOM.lat0 + q[1] * g.deg); });
          for (var s = 1; s < pts.length; s++) len += Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]);
          if (len > 150) {
            var m = Math.floor(pts.length / 2), a = pts[Math.max(0, m - 2)], b = pts[Math.min(pts.length - 1, m + 2)];
            var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
            if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
            labels.push({ x: pts[m][0], y: pts[m][1], ang: ang, text: String(lev) });
          }
        }
      });
    }
    ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff';
    labels.forEach(function (L) { ctx.save(); ctx.translate(L.x, L.y); ctx.rotate(L.ang); halo(ctx, L.text, 0, 0); ctx.restore(); });
    findExtremes(g).forEach(function (e) {
      var p = proj(DOM.lon0 + e.i * g.deg, DOM.lat0 + e.j * g.deg);
      ctx.font = '800 22px -apple-system, system-ui, sans-serif'; ctx.fillStyle = e.type === 'L' ? '#ff6b6b' : '#6bb8ff';
      halo(ctx, e.type, p[0], p[1]);
      ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.fillStyle = '#fff'; halo(ctx, String(Math.round(e.v)), p[0], p[1] + 14);
    });
    ctx.textBaseline = 'alphabetic';
  }
  function cities(ctx, proj, W, H) {
    ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    CITIES.forEach(function (c) {
      var p = proj(c[2], c[1]); if (p[0] < 6 || p[0] > W - 40 || p[1] < 6 || p[1] > H - 6) return;
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.beginPath(); ctx.arc(p[0], p[1], 1.8, 0, 6.3); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.85)'; halo(ctx, c[0], p[0] + 4, p[1]);
    });
    var h = proj(HOME.lon, HOME.lat);
    ctx.fillStyle = '#ffd84d'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(h[0], h[1], 5, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.font = '700 11px -apple-system, system-ui, sans-serif'; ctx.fillStyle = '#ffd84d'; ctx.textAlign = 'right'; halo(ctx, 'Home', h[0] - 8, h[1] - 6); ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  function drawLegend() {
    var cv = el('legend'), W = Math.floor(el('map-wrap').getBoundingClientRect().width) || 340, dpr = Math.min(window.devicePixelRatio || 1, 3);
    var rows = view === 'mslp_pcpn_frzn' ? 2 : 1, H = rows === 2 ? 62 : 40;
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var css = getComputedStyle(document.documentElement), txt = css.getPropertyValue('--muted').trim() || '#667';
    ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.fillStyle = txt; ctx.textAlign = 'center';
    var x0 = 4, bw = W - 8, y = 2, i;
    if (view === 't2m') {
      for (i = 0; i < bw; i++) { var v = -20 + (i / bw) * 120, c = TLUT[clamp(Math.round((v + 30) * 2), 0, TLUT.length - 1)]; ctx.fillStyle = 'rgb(' + c.map(Math.round).join(',') + ')'; ctx.fillRect(x0 + i, y, 1.5, 14); }
      ctx.fillStyle = txt; for (var t = -20; t <= 100; t += 20) ctx.fillText(t + '°', clamp(x0 + (t + 20) / 120 * bw, 16, W - 16), 28);
      return;
    }
    function bins(thr, cols, labelFmt, yy) {
      var n = thr.length, cw = bw / n;
      for (var k = 0; k < n; k++) { ctx.fillStyle = cols[k]; ctx.fillRect(x0 + k * cw, yy, cw + 0.5, 14); }
      ctx.fillStyle = txt; for (k = 0; k < n; k += (n > 11 ? 2 : 2)) ctx.fillText(labelFmt(thr[k]), x0 + k * cw + cw / 2, yy + 26);
    }
    if (view === 'apcpn') { bins(ACC_T, ACC_C, function (v) { return String(v); }, y); return; }
    bins(RATE_T, PAL.rain, function (v) { return String(v); }, y);
    if (view === 'mslp_pcpn_frzn') {
      var types = [['Rain', PAL.rain[1]], ['Mix', PAL.mix[3]], ['Snow', PAL.snow[2]], ['Freezing', PAL.frz[3]]], cw2 = bw / 4;
      types.forEach(function (tp, k) {
        ctx.fillStyle = tp[1]; ctx.fillRect(x0 + k * cw2 + 4, 44, 12, 12);
        ctx.fillStyle = txt; ctx.textAlign = 'left'; ctx.fillText(tp[0], x0 + k * cw2 + 20, 54); ctx.textAlign = 'center';
      });
    }
  }

  // ---------------------------------------------------------------- map UI
  function updateTimeUI() {
    var d = gridData, sl = el('slider'), lab = el('time-label'), note = el('map-note'), sub = el('map-sub');
    sub.textContent = viewDef(view).sub;
    var msg = gridNote ? gridNote : '';
    if (d && d.steps && d.steps.length) {
      sl.max = d.steps.length - 1; sl.value = stepIdx; sl.disabled = false;
      var s = d.steps[stepIdx];
      lab.textContent = fmtDay(s.t) + '  ·  +' + Math.round(s.lead) + ' h';
      if (!msg) msg = 'ECMWF IFS via Open-Meteo · ' + d.spec.step + '° map grid · loaded ' + fmtClock(d.fetchedAt) + (d.hasType ? '' : ' · precip type estimated from temperature');
    } else { sl.disabled = true; lab.textContent = '—'; }
    note.textContent = msg; note.className = 'small ' + (gridNote && /Could not|could not/.test(gridNote) ? 'warn' : 'muted');
  }
  var playTimer = null;
  function setStep(i) {
    var d = gridData; if (!d || !d.steps) return;
    stepIdx = clamp(i, 0, d.steps.length - 1); scheduleRender();
  }
  var raf = 0;
  function scheduleRender() { if (raf) return; raf = requestAnimationFrame(function () { raf = 0; renderMap(); }); }
  function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; } el('play').textContent = '▶'; el('play').setAttribute('aria-label', 'Play'); }
  function togglePlay() {
    if (playTimer) { stopPlay(); return; }
    var d = gridData; if (!d || !d.steps) return;
    el('play').textContent = '❚❚'; el('play').setAttribute('aria-label', 'Pause');
    playTimer = setInterval(function () { setStep(stepIdx >= gridData.steps.length - 1 ? 0 : stepIdx + 1); }, 550);
  }
  function buildTabs() {
    var box = el('tabs'); box.innerHTML = '';
    VIEWS.forEach(function (v) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'tab' + (v.id === view ? ' on' : ''); b.textContent = v.label; b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', v.id === view ? 'true' : 'false');
      b.addEventListener('click', function () { view = v.id; store.set('wx.view', view); buildTabs(); scheduleRender(); });
      box.appendChild(b);
    });
  }

  // ---------------------------------------------------------------- backyard chart
  function localDayStart(t) { var d = new Date(t * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; }
  function renderPoint() {
    var cv = el('chart'), wrap = el('chart-wrap'), W = Math.floor(wrap.getBoundingClientRect().width) || 340, H = 200, dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    var css = getComputedStyle(document.documentElement), txt = css.getPropertyValue('--muted').trim() || '#667', line = css.getPropertyValue('--line').trim() || '#ddd';
    var pd = pointData; if (!pd) { el('daily').innerHTML = ''; return; }
    var now = Date.now() / 1000, t0 = now, t1 = now + 120 * 3600, idx = [];
    for (var i = 0; i < pd.times.length; i++) if (pd.times[i] >= t0 - 3600 && pd.times[i] <= t1) idx.push(i);
    if (idx.length < 2) return;
    var tmin = Infinity, tmax = -Infinity, pmax = 0.05;
    idx.forEach(function (i) { var v = pd.t[i]; if (v != null) { tmin = Math.min(tmin, v); tmax = Math.max(tmax, v); } if (pd.pr[i] != null) pmax = Math.max(pmax, pd.pr[i]); });
    tmin = Math.floor((tmin - 3) / 10) * 10; tmax = Math.ceil((tmax + 3) / 10) * 10;
    var L = 30, R = 8, T = 18, B = 18, pw = W - L - R, ph = H - T - B;
    function X(t) { return L + (t - t0) / (t1 - t0) * pw; }
    function Y(v) { return T + (1 - (v - tmin) / (tmax - tmin)) * ph; }
    ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = tmin; g <= tmax; g += 10) { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Y(g)); ctx.lineTo(W - R, Y(g)); ctx.stroke(); ctx.fillStyle = txt; ctx.fillText(g + '°', L - 4, Y(g)); }
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    for (var dday = localDayStart(t0) + 86400; dday < t1; dday += 86400) {
      ctx.strokeStyle = line; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.moveTo(X(dday), T); ctx.lineTo(X(dday), H - B); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = txt; ctx.fillText(new Date(dday * 1000).toLocaleDateString([], { weekday: 'short' }), X(dday) + 3, 11);
    }
    var barMax = Math.max(0.12, pmax), bh = ph * 0.38;
    ctx.fillStyle = 'rgba(59,130,246,.75)';
    idx.forEach(function (i) { var v = pd.pr[i]; if (v == null || v <= 0) return; var h = v / barMax * bh; ctx.fillRect(X(pd.times[i]) - 1, H - B - h, 2.2, h); });
    ctx.strokeStyle = '#f59e42'; ctx.lineWidth = 2; ctx.lineJoin = 'round'; ctx.beginPath();
    var first = true;
    idx.forEach(function (i) { var v = pd.t[i]; if (v == null) return; var x = X(pd.times[i]), y = Y(v); if (first) { ctx.moveTo(x, y); first = false; } else ctx.lineTo(x, y); });
    ctx.stroke();
    if (tmin < 32 && tmax > 32) { ctx.strokeStyle = 'rgba(0,200,230,.7)'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Y(32)); ctx.lineTo(W - R, Y(32)); ctx.stroke(); ctx.setLineDash([]); }
    ctx.strokeStyle = txt; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X(now), T); ctx.lineTo(X(now), H - B); ctx.stroke();
    if (station && station.temp != null) { ctx.fillStyle = '#ffd84d'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(X(now), Y(station.temp), 4.5, 0, 6.3); ctx.fill(); ctx.stroke(); }
    ctx.fillStyle = txt; ctx.fillText('now', X(now) + 3, H - 5);
    // daily table
    var rows = [], day = localDayStart(now);
    for (var n = 0; n < 5; n++) {
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
    el('point-note').textContent = 'Euro ' + (pd.model === 'ecmwf_ifs' ? 'IFS (9 km)' : 'IFS 0.25°') + ' at ' + HOME.lat.toFixed(2) + '°N ' + Math.abs(HOME.lon).toFixed(2) + '°W. Orange = temperature, blue bars = hourly precipitation, yellow dot = your station now.';
  }

  // ---------------------------------------------------------------- demo data
  function makeDemoGrid(spec) {
    var nt = 8 * 24, npts = spec.nx * spec.ny, t0 = Math.floor(Date.now() / 86400000) * 86400;
    var d = { detail: settings.detail, dom: DOM_KEY, spec: spec, nt: nt, times: new Float64Array(nt), fetchedAt: Date.now(), p: new Float32Array(npts * nt), pr: new Float32Array(npts * nt), t: new Float32Array(npts * nt), pt: new Int8Array(npts * nt), hasType: true, model: 'demo' };
    var elapsed = (Date.now() / 1000 - t0) / 3600;
    for (var h = 0; h < nt; h++) {
      d.times[h] = t0 + h * 3600;
      var cx = -77 + 0.12 * (h - elapsed + 6), cy = 38.5 + 0.075 * (h - elapsed + 6);
      for (var j = 0; j < spec.ny; j++) for (var i = 0; i < spec.nx; i++) {
        var lon = spec.lons[i], lat = spec.lats[j], idx = (j * spec.nx + i) * nt + h;
        var dx = (lon - cx) * 0.72, dy = lat - cy, r2 = dx * dx + dy * dy;
        d.p[idx] = 1019 - 24 * Math.exp(-r2 / (2 * 3.2 * 3.2)) + 5 * Math.sin(lon * 0.6 + 1) * Math.cos(lat * 0.4);
        var ex = dx - 1.3, ey = dy - 1.1, band = Math.exp(-(ex * ex + ey * ey) / (2 * 2.2 * 2.2));
        var wob = 0.65 + 0.35 * Math.sin(lon * 1.7 + lat * 1.3 + h * 0.05);
        var rate = Math.max(0, 0.22 * band * wob - 0.015);
        d.pr[idx] = rate;
        var diur = 3 * Math.sin(((t0 + h * 3600) / 3600 % 24 - 9) / 24 * 6.283);
        var T = 41 - 2.6 * (lat - 42) + (lon + 71) * 0.4 + diur - 5 * Math.exp(-r2 / 18);
        d.t[idx] = T;
        d.pt[idx] = rate > 0 ? (T <= 30 ? 5 : T <= 33 ? (lon < -72 ? 3 : 7) : T <= 36 ? 7 : 1) : 0;
      }
    }
    return d;
  }
  function makeDemoPoint() {
    var t0 = Math.floor(Date.now() / 86400000) * 86400, n = 8 * 24, o = { model: 'demo', times: [], t: [], pr: [], p: [] };
    for (var h = 0; h < n; h++) {
      var t = t0 + h * 3600; o.times.push(t);
      o.t.push(42 + 8 * Math.sin(((t / 3600) % 24 - 15) / 24 * 6.283) - h * 0.04 + 3 * Math.sin(h / 17));
      o.pr.push(Math.max(0, 0.08 * Math.sin(h / 9 - 1) * Math.sin(h / 5)));
      o.p.push(1012 + 7 * Math.sin(h / 20));
    }
    return o;
  }
  function makeDemoStation() {
    return { temp: 44.6, heatIndex: 44.6, windChill: 41.2, dew: 38.1, wind: 5.4, gust: 11.8, pressure: 29.78, rate: 0, rainToday: 0.12, hum: 76, dir: 292, uv: 1, solar: 148, epoch: Date.now() - 90000, fetchedAt: Date.now() };
  }

  // ---------------------------------------------------------------- settings + diagnostics
  function openSettings() {
    el('set-key').value = settings.apiKey; el('set-station').value = settings.stationId; el('set-detail').value = settings.detail;
    el('set-demo').checked = !!demo;
    var dlg = el('settings'); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    el('diag-log').textContent = logLines.join('\n');
  }
  function saveSettings() {
    var changedDetail = el('set-detail').value !== settings.detail;
    settings.apiKey = el('set-key').value.trim(); settings.stationId = (el('set-station').value.trim() || 'KMAHOPKI22').toUpperCase(); settings.detail = el('set-detail').value;
    store.set('wx.settings', settings);
    var wantDemo = el('set-demo').checked, demoChanged = wantDemo !== demo;
    demo = wantDemo; store.set('wx.demo', demo);
    el('settings').close();
    updateBanner();
    document.querySelector('.sub').textContent = 'Hopkinton, MA · ' + settings.stationId;
    if (changedDetail || demoChanged) { stepIdx = 0; refreshAll(true); } else { loadStation(); }
  }
  async function runChecks() {
    var out = el('check-out'); out.textContent = 'Checking…'; var lines = [];
    function add(s) { lines.push(s); out.textContent = lines.join('\n'); log(s); }
    if (!settings.apiKey) add('Station: no API key saved yet.');
    else {
      try {
        var r = await fetch('https://api.weather.com/v2/pws/observations/current?stationId=' + encodeURIComponent(el('set-station').value.trim() || settings.stationId) + '&format=json&units=e&apiKey=' + encodeURIComponent(el('set-key').value.trim() || settings.apiKey), { cache: 'no-store' });
        add('Station (Weather Underground): HTTP ' + r.status + (r.ok ? ' ✓' : ' ✗'));
      } catch (e) { add('Station (Weather Underground): FAILED – ' + friendlyError(e)); }
    }
    try {
      var j = await omFetch(OM + '?latitude=' + HOME.lat + '&longitude=' + HOME.lon + '&hourly=temperature_2m&models=ecmwf_ifs025&forecast_days=1&timeformat=unixtime');
      add('Euro data (Open-Meteo): OK ✓ (' + pick(j.hourly, 'temperature_2m').length + ' hours)');
    } catch (e) { add('Euro data (Open-Meteo): FAILED – ' + friendlyError(e)); }
    try {
      var j2 = await omFetch(OM + '?latitude=' + HOME.lat + '&longitude=' + HOME.lon + '&hourly=precipitation_type&models=ecmwf_ifs025&forecast_days=1&timeformat=unixtime');
      add('Precip type available: yes ✓ (' + pick(j2.hourly, 'precipitation_type').length + ' values)');
    } catch (e) { add('Precip type available: no – ' + friendlyError(e) + ' (type will be estimated from temperature)'); }
  }

  // ---------------------------------------------------------------- app flow
  function updateBanner() {
    var b = el('banner');
    if (demo) { b.hidden = false; b.className = 'banner demo'; b.textContent = 'Demo mode: made-up data for testing. Turn it off in Settings.'; return; }
    var standalone = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    if (!standalone && /iPhone|iPad/.test(navigator.userAgent) && !store.get('wx.tipDismissed', false)) {
      b.hidden = false; b.className = 'banner tip';
      b.innerHTML = '<span>Tip: tap <b>Share</b>, then <b>Add to Home Screen</b> to get a full-screen app icon.</span><button type="button" data-action="dismiss-tip" aria-label="Dismiss">✕</button>';
      return;
    }
    b.hidden = true;
  }
  async function refreshAll(force) {
    var btn = el('refresh'); btn.classList.add('spin');
    stopPlay();
    el('map-note').textContent = 'Loading…'; el('map-note').className = 'small muted';
    await Promise.all([loadStation(), loadPoint(), loadGrid(force)]);
    renderPoint(); updateCompare(); scheduleRender();
    btn.classList.remove('spin');
  }
  function init() {
    document.querySelector('.sub').textContent = 'Hopkinton, MA · ' + settings.stationId;
    var links = el('links'); links.innerHTML = '';
    VIEWS.forEach(function (v) {
      var a = document.createElement('a'); a.className = 'link'; a.href = TT + v.tt; a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = '<span></span><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      a.firstChild.textContent = v.label; links.appendChild(a);
    });
    buildTabs(); updateBanner();
    el('slider').addEventListener('input', function (e) { stopPlay(); setStep(+e.target.value); });
    el('prev').addEventListener('click', function () { stopPlay(); setStep(stepIdx - 1); });
    el('next').addEventListener('click', function () { stopPlay(); setStep(stepIdx + 1); });
    el('play').addEventListener('click', togglePlay);
    el('refresh').addEventListener('click', function () { refreshAll(true); });
    el('open-settings').addEventListener('click', openSettings);
    el('set-save').addEventListener('click', function (e) { e.preventDefault(); saveSettings(); });
    el('set-cancel').addEventListener('click', function () { el('settings').close(); });
    el('set-check').addEventListener('click', runChecks);
    el('set-clear').addEventListener('click', async function () { await idb.del('grid'); store.del('wx.hasType'); stepCache.clear(); log('Saved model data cleared'); el('check-out').textContent = 'Saved model data cleared.'; });
    document.body.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-action]'); if (!a) return;
      if (a.dataset.action === 'settings') openSettings();
      if (a.dataset.action === 'dismiss-tip') { store.set('wx.tipDismissed', true); updateBanner(); }
    });
    var rz; window.addEventListener('resize', function () { clearTimeout(rz); rz = setTimeout(function () { scheduleRender(); renderPoint(); }, 150); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (!station || Date.now() - station.fetchedAt > 60000) loadStation();
      if (gridData && Date.now() - gridData.fetchedAt > GRID_TTL && !demo) refreshAll(false);
    });
    setInterval(function () { if (document.visibilityState === 'visible') loadStation(); }, 60000);
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { scheduleRender(); renderPoint(); });
    renderStation(settings.apiKey || demo ? undefined : 'nokey');
    refreshAll(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
