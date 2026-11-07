/* Backyard Weather: live station readings + ECMWF (Euro) maps drawn on the phone.
   Station data: Weather Underground PWS API. Model data: Open-Meteo (ECMWF IFS, CC BY 4.0). */
(function () {
  'use strict';

  // ---------------------------------------------------------------- constants
  var HOME = { lat: 42.240, lon: -71.504 };
  // Map area: home is near the middle; extra room to the west so upstate NY is in view (weather arrives from there).
  // 7 x 4.5 degrees = about 550 points on the fine (0.25 degree) grid, under Open-Meteo's 600 per minute limit.
  var DOM = { lat0: 40.0, lat1: 44.5, lon0: -75.5, lon1: -68.5 };
  var DOM_KEY = [DOM.lat0, DOM.lat1, DOM.lon0, DOM.lon1].join(',');
  var OM = 'https://api.open-meteo.com/v1/ecmwf';
  var OM_BASE = 'https://api.open-meteo.com/v1/';
  var TT_BASE = 'https://www.tropicaltidbits.com/analysis/models/?region=neus';
  var CACHE_VER = 4; // bump when the saved-map format changes
  var GRID_TTL = 2 * 3600 * 1000; // reuse saved model data for 2 hours
  var CITIES = [
    ['Boston', 42.36, -71.06], ['Hartford', 41.76, -72.67], ['Providence', 41.82, -71.41],
    ['Albany', 42.65, -73.76], ['Portland', 43.66, -70.26], ['Springfield', 42.10, -72.59],
    ['Concord', 43.21, -71.54], ['New York', 40.71, -74.0], ['Hyannis', 41.65, -70.28], ['Utica', 43.10, -75.23]
  ];
  var VIEWS = [
    { id: 'mslp_pcpn', label: 'MSLP & Precip', tt: 'mslp_pcpn', sub: 'Sea-level pressure (hPa) and precipitation rate (in/hr)' },
    { id: 'mslp_pcpn_frzn', label: 'Rain / Frozen', tt: 'mslp_pcpn_frzn', sub: 'Sea-level pressure (hPa), precipitation rate (in/hr) colored by type' },
    { id: 'apcpn', label: 'Total Precip', tt: 'apcpn', sub: 'Precipitation accumulated since the first time shown (inches)' },
    { id: 'asnow', label: 'Total Snow', tt: 'asnow', sub: 'Snowfall accumulated since the first time shown (inches, 10:1 snow-to-water ratio)' },
    { id: 't2m', label: '2m Temp', tt: 'T2m', sub: '2-metre air temperature (°F); dark blue line = 32°F' }
  ];
  // Forecast models. ep/om = Open-Meteo endpoint and model name; tt = Tropical Tidbits model code.
  // type: Open-Meteo reports rain/snow type directly (otherwise it is worked out from the snowfall amount).
  var MODELS = [
    { id: 'ecmwf', label: 'Euro (ECMWF IFS)', short: 'Euro', ep: 'ecmwf', om: 'ecmwf_ifs025', tt: 'ecmwf', days: 8, type: true },
    { id: 'gfs', label: 'GFS', short: 'GFS', ep: 'gfs', om: 'gfs_seamless', tt: 'gfs', days: 8 },
    { id: 'aifs', label: 'EC-AIFS (AI)', short: 'EC-AIFS', ep: 'ecmwf', om: 'ecmwf_aifs025_single', tt: 'ec-aifs', days: 8 },
    { id: 'aigfs', label: 'AIGFS (AI)', short: 'AIGFS', ep: 'gfs', om: 'ncep_aigfs025', tt: 'aigfs', days: 8 },
    { id: 'rrfs', label: 'RRFS (3 km, 4 days)', short: 'RRFS', ep: 'gfs', om: 'ncep_rrfs_conus', tt: 'rrfs', days: 5, fine: true, noFrzn: true }
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
  var settings = Object.assign({ apiKey: '', stationId: 'KMAHOPKI22', detail: 'fine', playMs: 700, layout: 'auto' }, store.get('wx.settings', {}));
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
    if (e && e.status === 429) return 'Open-Meteo\'s free limit was reached (' + (e.reason || 'too many requests') + '). Wait a minute, then tap refresh.';
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
  // Colors and break points copied from Tropical Tidbits' own legends (precip rates in mm/hr, totals in inches).
  var RATE_T = [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30, 36, 42];
  var RATE_C = [
    '#99f26c', '#8bdc62', '#7cc558', '#6dae4d', '#5f9842', '#4f8038', '#406a2d', '#325424',
    '#fafe74', '#ecd565', '#e1ac58', '#d8854b', '#d05138', '#b5413a', '#98343d', '#7d2a42',
    '#a53ba0', '#bc45ba', '#d44fd4'
  ];
  var RAIN_T = [0.1, 0.25, 0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24, 30];
  var RAIN_C = [
    '#99f26c', '#8bdc62', '#7cc558', '#6dae4d', '#5f9842', '#4f8038', '#406a2d', '#325424',
    '#fafe74', '#ecd565', '#e1ac58', '#d8854c', '#d05035', '#b5423b', '#96363c', '#7e2c3f',
    '#9d3b97', '#d44fd4'
  ];
  var FRZ_T = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12, 14];
  var FRZR_C = [
    '#e2a7be', '#d491af', '#cd89a5', '#c06f96', '#b9648b', '#ae537d', '#a2446f', '#993b63',
    '#8c314d', '#923442', '#983738', '#a03f2c', '#ab4627', '#b24b26', '#be5424', '#c85b26',
    '#d2632a'
  ];
  var SLEET_C = [
    '#b19df6', '#b091f6', '#b17ef6', '#af72f3', '#ab64ee', '#a453e4', '#9842d4', '#913bc9',
    '#8230ac', '#8331a9', '#8e3581', '#963c8e', '#9b4084', '#a44779', '#ab4f6f', '#b35765',
    '#b95c5c'
  ];
  var SNOWR_C = [
    '#a4f7fd', '#97e2f7', '#88c9f9', '#7fb8f8', '#74a6f7', '#6890f6', '#5167e1', '#4552d4',
    '#3a3ec6', '#302cb5', '#2a1fa9', '#270e95', '#2c1290', '#441f81', '#8a3280', '#ad3e81',
    '#cf4b7d'
  ];
  var ACC_T = [0.01, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8, 9, 10, 12, 14, 16, 20, 24];
  var ACC_C = [
    '#c8e9d1', '#b1d4ba', '#99bda1', '#81a688', '#6a8f70', '#547a58', '#3c5e3d', '#436184',
    '#5b7a9a', '#7291b1', '#8ba9c4', '#a5c1db', '#bfd8ef', '#e4d7e9', '#d1c0d6', '#bcaac2',
    '#a892af', '#947b9c', '#81648a', '#6c4d76', '#593662', '#571b32', '#6f343c', '#8c5448',
    '#a77655', '#c59962', '#e6c97b', '#ead688', '#f1e493', '#f6f1a0', '#fcfeac'
  ];
  var SNOW_T = [0.1, 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 8.5, 9.0, 9.5, 10.0, 10.5, 11.0, 11.5, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48];
  var SNOW_C = [
    '#444696', '#585ea3', '#6d77b0', '#8390bf', '#98a8cd', '#aec2db', '#b6bee0', '#a8a0d8',
    '#9d86d1', '#926bc9', '#8a52c0', '#7e3bb4', '#a35294', '#a75d9a', '#ae68a2', '#b473a9',
    '#b678ac', '#bf8bb7', '#c697bf', '#cba3c7', '#d2afce', '#d9bcd7', '#dfc8dd', '#e7d5e5',
    '#deefe7', '#cfe7dc', '#c0dfd0', '#b1d8c6', '#a3d0ba', '#97caaf', '#7fb395', '#74a488',
    '#69957c', '#5a816b', '#517561', '#466854', '#4a477d', '#555380', '#616082', '#6e6c87',
    '#757485', '#85858d', '#9d9d94', '#a9aaa0', '#b6b7ad', '#c3c4ba', '#d1d1c7', '#ddddd4',
    '#e9eae0'
  ];
  // 2 m temperature: one color per degree F from -70 to 130, blended to quarter degrees
  var TMIN = -70, TMAX = 130;
  var TCOL = [
    '#ddc7ec', '#dfc3ed', '#d9b2e6', '#d9aee5', '#d7a2dc', '#d49dd3', '#d295cb', '#d393c8', '#d182be', '#d07bba',
    '#cf74b6', '#cf73b5', '#cf69ad', '#ce5ea2', '#ce5b9f', '#ce5a9e', '#cf5191', '#cf5191', '#cc4c85', '#cb4b81',
    '#cb4b81', '#cb4b81', '#cb4b81', '#cb4b81', '#c84a82', '#c64a82', '#c04982', '#bf4982', '#bc4982', '#bc4982',
    '#bb4982', '#ba4982', '#b74a82', '#b74a82', '#b14b83', '#af4c83', '#af4c83', '#af4c83', '#ae4e85', '#ad4f85',
    '#ac528a', '#aa578e', '#ab5890', '#ab5890', '#ae649f', '#af69a3', '#b06da8', '#b06da8', '#b171ac', '#b47eb9',
    '#b07ebc', '#b07ebc', '#a275b8', '#976db5', '#9369b2', '#8b63b0', '#815dac', '#8058a9', '#6f53a3', '#6f53a3',
    '#6f53a3', '#7054a3', '#7863ae', '#8a77b9', '#8f7ebb', '#9d8ec6', '#a299ce', '#afabd7', '#b4b2db', '#cfd0e0',
    '#cacadf', '#b9b7dc', '#b3b0da', '#a49ed0', '#9893cc', '#8987ca', '#8080cb', '#736fc2', '#726abb', '#5752b3',
    '#5752b3', '#5752b3', '#5754b7', '#575bc2', '#575bc2', '#5a65cf', '#5c6bd6', '#5d6cd7', '#5f71dc', '#637be5',
    '#6682eb', '#6a8af0', '#6c8ff1', '#75a1f5', '#7baff7', '#7db1f8', '#80b8f8', '#8ccefa', '#91d5fa', '#98e2fb',
    '#9ceafc', '#a4f7fd', '#a2e8bc', '#a1dd9d', '#9cda96', '#95d28a', '#91ce83', '#8ac778', '#85c270', '#7fbc64',
    '#7bb85e', '#74b254', '#70ad4e', '#6aa644', '#67a23f', '#619a36', '#5e9733', '#669e37', '#6ca33b', '#77ac42',
    '#7db146', '#8bba4f', '#93bf54', '#a1c95d', '#aace63', '#bad86c', '#c3de72', '#d3e77c', '#dded81', '#edf68c',
    '#f8fc92', '#f7f68e', '#f4ee8a', '#f1e484', '#edde80', '#e9d279', '#e6cb75', '#e2c270', '#e0bc6c', '#deb164',
    '#dbaa61', '#d59d57', '#d09652', '#ca8949', '#c78143', '#c1743a', '#bc6d35', '#b7612d', '#b45a28', '#b05325',
    '#a7451e', '#a13f1c', '#a13f1c', '#973b1f', '#933920', '#903823', '#903823', '#87352b', '#84342f', '#803333',
    '#803333', '#843839', '#84393b', '#8f4447', '#94494d', '#994f53', '#9d5457', '#a85f61', '#b2696a', '#b66e70',
    '#bb7378', '#c88089', '#ca8390', '#d08da7', '#d290ae', '#dba0c4', '#dba2cc', '#e2add5', '#e3b6e0', '#e4c0ee',
    '#e5c5f4', '#e0bcee', '#dbb1e8', '#d3a8e3', '#c89dde', '#bd91d9', '#b98dd5', '#b083cb', '#a97ac2', '#9a6fb7',
    '#8e64b0', '#8359ab', '#8153a4', '#7e4897', '#7c418f', '#7b3c88', '#7a3a86', '#78347c', '#77337a', '#732a67',
    '#752b5d'
  ];
  var TLUT = (function () {
    var out = [], base = TCOL.map(hex);
    for (var v = TMIN; v <= TMAX; v += 0.25) {
      var i = Math.min(Math.floor(v - TMIN), base.length - 2), f = v - TMIN - i, a = base[i], b = base[i + 1];
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]);
    }
    return out;
  })();
  function tIdx(v) { return clamp(Math.round((v - TMIN) * 4), 0, TLUT.length - 1); }
  function band(v, T) { if (!(v >= T[0])) return -1; var k = 0; while (k < T.length - 1 && v >= T[k + 1]) k++; return k; }
  var RATE_RGB = RATE_C.map(hex), RAIN_RGB = RAIN_C.map(hex), FRZR_RGB = FRZR_C.map(hex), SLEET_RGB = SLEET_C.map(hex), SNOWR_RGB = SNOWR_C.map(hex);
  var ACC_RGB = ACC_C.map(hex);
  var SNOW_RGB = SNOW_C.map(hex);

  // ---------------------------------------------------------------- model data
  var gridData = null;   // maps
  var pointData = null;  // backyard series
  var station = null;
  var gridNote = '';
  var modelId = store.get('wx.model', 'ecmwf');
  var ttModelId = store.get('wx.ttmodel', 'ecmwf'); // Tropical Tidbits links have their own model choice
  if (!MODELS.some(function (m) { return m.id === modelId; })) modelId = 'ecmwf';
  function curModel() { return MODELS.filter(function (m) { return m.id === modelId; })[0]; }
  function effDetail(M) { return M.fine ? 'fine' : settings.detail; }
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
  var rateUntil = 0;
  function rateWait(sec) {
    rateUntil = Math.max(rateUntil, Date.now() + sec * 1000);
    return new Promise(function (res) {
      (function tick() {
        var left = Math.ceil((rateUntil - Date.now()) / 1000);
        if (left <= 0) { res(); return; }
        el('map-note').textContent = 'Open-Meteo free limit reached. Retrying in ' + left + ' s\u2026'; el('map-note').className = 'small muted';
        setTimeout(tick, 1000);
      })();
    });
  }
  async function fetchGrid(spec, useType, M) {
    var pts = [], j, i;
    for (j = 0; j < spec.ny; j++) for (i = 0; i < spec.nx; i++) pts.push([spec.lats[j], spec.lons[i]]);
    var CH = 100, chunks = [];
    for (var k = 0; k < pts.length; k += CH) chunks.push(pts.slice(k, k + CH));
    var vars = 'pressure_msl,precipitation,temperature_2m,snowfall' + (useType ? ',precipitation_type' : '');
    var results = new Array(chunks.length), next = 0;
    async function worker() {
      while (next < chunks.length) {
        var c = next++;
        var lat = chunks[c].map(function (p) { return p[0]; }).join(',');
        var lon = chunks[c].map(function (p) { return p[1]; }).join(',');
        var url = OM_BASE + M.ep + '?latitude=' + lat + '&longitude=' + lon + '&hourly=' + vars +
          '&models=' + M.om + '&temperature_unit=fahrenheit&precipitation_unit=inch&timeformat=unixtime&timezone=GMT&forecast_days=' + M.days;
        var arr;
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
    var first = pick(results[0][0].hourly, 'time'), nt = first.length, npts = pts.length;
    var d = {
      detail: effDetail(M), dom: DOM_KEY, ver: CACHE_VER, modelId: M.id, spec: spec, nt: nt, times: Float64Array.from(first), fetchedAt: Date.now(),
      p: new Float32Array(npts * nt), pr: new Float32Array(npts * nt), t: new Float32Array(npts * nt), sn: new Float32Array(npts * nt),
      pt: useType ? new Int8Array(npts * nt) : null, hasType: !!useType, model: M.om, hLast: 0
    };
    var base = 0;
    results.forEach(function (arr, c) {
      arr.forEach(function (loc, q) {
        var h = loc.hourly, idx = (c * CH + q) * nt;
        var P = pick(h, 'pressure_msl'), R = pick(h, 'precipitation'), T = pick(h, 'temperature_2m'), S = pick(h, 'snowfall'), Y = useType ? pick(h, 'precipitation_type') : null;
        for (var x = 0; x < nt; x++) {
          d.p[idx + x] = P && P[x] !== null ? P[x] : NaN;
          d.pr[idx + x] = R && R[x] !== null ? R[x] : NaN;
          d.t[idx + x] = T && T[x] !== null ? T[x] : NaN;
          // Open-Meteo snowfall is 0.7 cm (0.7 x water depth); x 10/7 gives a 10:1 snow depth like Tropical Tidbits
          d.sn[idx + x] = S && S[x] !== null ? S[x] * 10 / 7 : NaN;
          if (P && P[x] !== null && x > d.hLast) d.hLast = x;
          if (useType) d.pt[idx + x] = Y && Y[x] !== null ? Y[x] : -1;
        }
      });
      base += arr.length;
    });
    return d;
  }
  async function loadGrid(force) {
    var M = curModel(), spec = gridSpec(effDetail(M)), key = 'grid-' + M.id;
    gridNote = '';
    if (demo) { gridData = makeDemoGrid(spec, M); buildSteps(gridData); gridNote = 'DEMO data (not real forecasts)'; return; }
    var cached = await idb.get(key);
    function usable(c) { return c && c.ver === CACHE_VER && c.detail === effDetail(M) && c.dom === DOM_KEY && c.modelId === M.id; }
    var fresh = usable(cached) && (Date.now() - cached.fetchedAt) < GRID_TTL;
    if (M.id !== modelId) return;
    if (fresh && !force) { gridData = cached; buildSteps(gridData); log(M.short + ': using saved data from ' + fmtClock(cached.fetchedAt)); return; }
    var useType = !!M.type && store.get('wx.hasType', true);
    try {
      var d;
      try {
        d = await fetchGrid(spec, useType, M);
      } catch (e) {
        if (useType && /precipitation_type|variable/i.test(e.message || '')) {
          log('Maps: precipitation type not offered; retrying without it (type will be estimated)');
          useType = false; store.set('wx.hasType', false);
          d = await fetchGrid(spec, false, M);
        } else { throw e; }
      }
      idb.set(key, d);
      log(M.short + ': fetched ' + spec.nx * spec.ny + ' points, ' + d.nt + ' hours' + (d.hasType ? ', with precip type' : ', type from snowfall'));
      if (M.id !== modelId) return;
      gridData = d; buildSteps(d);
    } catch (e) {
      log(M.short + ' error: ' + friendlyError(e));
      if (M.id !== modelId) return;
      if (usable(cached)) {
        gridData = cached; buildSteps(cached);
        gridNote = 'Showing saved run from ' + fmtClock(cached.fetchedAt) + ' (could not refresh: ' + friendlyError(e) + ')';
      } else {
        gridData = null; gridNote = 'Could not load ' + M.short + ' data: ' + friendlyError(e);
      }
    }
  }
  function buildSteps(d) {
    var now = Date.now() / 1000, t0 = Math.floor(now / 10800) * 10800, steps = [];
    for (var h = 0; h < d.nt; h++) {
      var t = d.times[h]; if (t < t0) continue;
      var lead = (t - t0) / 3600; if (lead > 168 || h > d.hLast) break;
      var hr = t / 3600;
      if (hr % 3 !== 0) continue;
      if (lead > 144 && hr % 6 !== 0) continue;
      steps.push({ h: h, t: t, lead: lead });
    }
    d.steps = steps;
    stepCache.clear();
    if (stepIdx >= steps.length) stepIdx = 0;
  }

  // backyard forecast: one point, four selectable models
  var PT_MODELS = [
    { id: 'ecmwf', label: 'Euro', name: 'Euro IFS', ep: 'ecmwf', om: ['ecmwf_ifs', 'ecmwf_ifs025'] },
    { id: 'gfs', label: 'GFS', name: 'GFS', ep: 'gfs', om: ['gfs_seamless'] },
    { id: 'aifs', label: 'AI Euro', name: 'AI Euro (ECMWF AIFS)', ep: 'ecmwf', om: ['ecmwf_aifs025_single'] },
    { id: 'aigfs', label: 'AI GFS', name: 'AI GFS (NOAA AIGFS)', ep: 'gfs', om: ['ncep_aigfs025'] }
  ];
  var ptModelId = store.get('wx.ptmodel', 'ecmwf'), pointCache = {};
  if (!PT_MODELS.some(function (m) { return m.id === ptModelId; })) ptModelId = 'ecmwf';
  function curPt() { return PT_MODELS.filter(function (m) { return m.id === ptModelId; })[0]; }
  async function loadPoint(force) {
    var P = curPt(), id = P.id;
    if (demo) { pointData = makeDemoPoint(id); pointData.pid = id; return; }
    var c = pointCache[id];
    if (c && !force && Date.now() - c.fetchedAt < 3600000) { pointData = c; return; }
    var base = OM_BASE + P.ep + '?latitude=' + HOME.lat + '&longitude=' + HOME.lon +
      '&hourly=temperature_2m,precipitation,pressure_msl&temperature_unit=fahrenheit&precipitation_unit=inch&timeformat=unixtime&timezone=GMT&forecast_days=8';
    var lastErr = null;
    for (var m = 0; m < P.om.length; m++) {
      try {
        var j = await omFetch(base + '&models=' + P.om[m]);
        var h = j.hourly, d = { pid: id, model: P.om[m], times: pick(h, 'time'), t: pick(h, 'temperature_2m'), pr: pick(h, 'precipitation'), p: pick(h, 'pressure_msl'), fetchedAt: Date.now() };
        pointCache[id] = d;
        if (id !== ptModelId) return;
        pointData = d; el('point-note').textContent = '';
        log('Backyard forecast OK (' + P.om[m] + ')');
        return;
      } catch (e) { lastErr = e; log('Backyard forecast (' + P.om[m] + ') failed: ' + friendlyError(e)); }
    }
    if (id !== ptModelId) return;
    pointData = c || null;
    el('point-note').textContent = 'Could not load the ' + P.label + ' backyard forecast: ' + friendlyError(lastErr);
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
        await loadPoint(false);
        if (m.id !== ptModelId) return;
        renderPoint(); updateCompare();
      });
      box.appendChild(b);
    });
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
    c.textContent = 'The ' + curPt().label + ' has ' + e.toFixed(0) + '° for your backyard right now; your station reads ' + Math.abs(d).toFixed(1) + '° ' + (d >= 0 ? 'warmer' : 'colder') + '.';
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
    var mslp = new Float32Array(npts), t2 = new Float32Array(npts), rate = new Float32Array(npts), acc = new Float32Array(npts), snacc = new Float32Array(npts);
    var fs = new Float32Array(npts), fm = new Float32Array(npts), ff = new Float32Array(npts);
    for (var p = 0; p < npts; p++) {
      var base = p * nt;
      mslp[p] = d.p[base + h]; t2[p] = d.t[base + h];
      var sum = 0, cnt = 0, k, v;
      for (k = Math.max(0, h - dt + 1); k <= h; k++) { v = d.pr[base + k]; if (v === v) { sum += v; cnt++; } }
      rate[p] = cnt ? sum / cnt : 0;
      var a = 0; for (k = s0 + 1; k <= h; k++) { v = d.pr[base + k]; if (v === v) a += v; }
      acc[p] = a;
      var sa = 0; for (k = s0 + 1; k <= h; k++) { v = d.sn[base + k]; if (v === v) sa += v; }
      snacc[p] = sa;
      var code = d.hasType ? d.pt[base + h] : -1, T = t2[p];
      if (code > 0) {
        if (code === 5 || code === 6) fs[p] = 1; else if (code === 7) fm[p] = 1; else if (code === 3 || code === 8 || code === 12) ff[p] = 1;
      } else if (!d.hasType) {
        // no type from the model: share of the water that fell as snow (10:1 depth / 10 = snow water), rest by temperature
        var wnow = d.pr[base + h], snw = d.sn[base + h] * 0.1; // d.sn is a 10:1 depth, so water = depth / 10
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
    var K2 = spec.step <= 0.25 ? 2 : 4;
    var g = {
      K: K2, nxu: (spec.nx - 1) * K2 + 1, nyu: (spec.ny - 1) * K2 + 1, spec: spec, deg: spec.step / K2,
      mslp: upCubic(mslp, spec.nx, spec.ny, K2), t2: upCubic(t2, spec.nx, spec.ny, K2),
      rate: upBilinear(rate, spec.nx, spec.ny, K2), acc: upBilinear(acc, spec.nx, spec.ny, K2), snacc: upBilinear(snacc, spec.nx, spec.ny, K2),
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
          rgb = TLUT[tIdx(v)]; alpha = 240;
        } else if (view === 'apcpn') {
          v = bil(g.acc, x0, tx, y0, ty); k = band(v, ACC_T);
          if (k >= 0) { rgb = ACC_RGB[k]; alpha = 235; }
        } else if (view === 'asnow') {
          v = bil(g.snacc, x0, tx, y0, ty); k = band(v, SNOW_T);
          if (k >= 0) { rgb = SNOW_RGB[k]; alpha = 235; }
        } else {
          v = bil(g.rate, x0, tx, y0, ty) * 25.4; // inches/hr -> mm/hr, as on Tropical Tidbits
          if (view === 'mslp_pcpn_frzn') {
            var fs = bil(g.fs, x0, tx, y0, ty), fm = bil(g.fm, x0, tx, y0, ty), ff = bil(g.ff, x0, tx, y0, ty), best = 1 - (fs + fm + ff), pal = RAIN_RGB, T = RAIN_T;
            if (fs > best) { pal = SNOWR_RGB; T = FRZ_T; best = fs; }
            if (fm > best) { pal = SLEET_RGB; T = FRZ_T; best = fm; }
            if (ff > best) { pal = FRZR_RGB; T = FRZ_T; }
            k = band(v, T); if (k >= 0) { rgb = pal[k]; alpha = 235; }
          } else {
            k = band(v, RATE_T); if (k >= 0) { rgb = RATE_RGB[k]; alpha = 235; }
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
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
  }
  function renderMap() {
    var cv = el('map'), wrap = el('map-wrap'), d = gridData;
    var W = Math.floor(wrap.getBoundingClientRect().width) || 340;
    var aspect = (DOM.lon1 - DOM.lon0) * Math.cos((DOM.lat0 + DOM.lat1) / 2 * Math.PI / 180) / (DOM.lat1 - DOM.lat0);
    var H = Math.round(W / aspect), dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
    function proj(lon, lat) { return [(lon - DOM.lon0) / (DOM.lon1 - DOM.lon0) * W, (DOM.lat1 - lat) / (DOM.lat1 - DOM.lat0) * H]; }
    if (d && d.steps && d.steps.length) {
      var g = stepGrids(d, stepIdx);
      shade(g, W, H, W > 520 ? 1.5 : 2);
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(off, 0, 0, W, H);
      geoLines(ctx, proj);
      if (view === 't2m') {
        contourChains(g.t2, g.nxu, g.nyu, 32).forEach(function (ch) {
          pathChain(ctx, ch, g, proj); ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3.4; ctx.stroke();
          ctx.strokeStyle = '#0a2a6e'; ctx.lineWidth = 1.6; ctx.stroke();
        });
      } else if (view !== 'apcpn' && view !== 'asnow') {
        drawPressure(ctx, g, proj);
      }
    } else {
      geoLines(ctx, proj);
      ctx.fillStyle = '#5d6b79'; ctx.font = '14px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(d ? 'No forecast steps available' : (/could not/i.test(gridNote) ? 'Forecast data unavailable' : 'Loading ' + curModel().short + ' data…'), W / 2, H / 2);
    }
    cities(ctx, proj, W, H);
    drawLegend();
    updateTimeUI();
  }
  function geoLines(ctx, proj) {
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(30,38,48,.42)'; ctx.lineWidth = 0.7; drawLines(ctx, GEO.states, proj);
    ctx.strokeStyle = 'rgba(15,20,28,.75)'; ctx.lineWidth = 1.1; drawLines(ctx, GEO.border, proj);
    ctx.strokeStyle = 'rgba(15,20,28,.85)'; ctx.lineWidth = 1; drawLines(ctx, GEO.coast, proj);
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
        ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = bold ? 3.6 : 2.6; ctx.stroke();
        ctx.strokeStyle = 'rgba(12,16,24,.92)'; ctx.lineWidth = bold ? 1.7 : 1; ctx.stroke();
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
    ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#111820';
    labels.forEach(function (L) { ctx.save(); ctx.translate(L.x, L.y); ctx.rotate(L.ang); halo(ctx, L.text, 0, 0); ctx.restore(); });
    findExtremes(g).forEach(function (e) {
      var p = proj(DOM.lon0 + e.i * g.deg, DOM.lat0 + e.j * g.deg);
      ctx.font = '800 22px -apple-system, system-ui, sans-serif'; ctx.fillStyle = e.type === 'L' ? '#d42a2a' : '#1f5fd6';
      halo(ctx, e.type, p[0], p[1]);
      ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.fillStyle = '#111820'; halo(ctx, String(Math.round(e.v)), p[0], p[1] + 14);
    });
    ctx.textBaseline = 'alphabetic';
  }
  function cities(ctx, proj, W, H) {
    ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    CITIES.forEach(function (c) {
      var p = proj(c[2], c[1]); if (p[0] < 6 || p[0] > W - 40 || p[1] < 6 || p[1] > H - 6) return;
      ctx.fillStyle = 'rgba(15,20,28,.9)'; ctx.beginPath(); ctx.arc(p[0], p[1], 1.8, 0, 6.3); ctx.fill();
      ctx.fillStyle = '#18202b'; halo(ctx, c[0], p[0] + 4, p[1]);
    });
    var h = proj(HOME.lon, HOME.lat);
    ctx.fillStyle = '#ffd84d'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(h[0], h[1], 5, 0, 6.3); ctx.fill(); ctx.stroke();
    ctx.font = '700 11px -apple-system, system-ui, sans-serif'; ctx.fillStyle = '#9a5a00'; ctx.textAlign = 'right'; halo(ctx, 'Home', h[0] - 8, h[1] - 6); ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
  }
  function drawLegend() {
    var cv = el('legend'), W = Math.floor(el('map-wrap').getBoundingClientRect().width) || 340, dpr = Math.min(window.devicePixelRatio || 1, 3);
    var frzn = view === 'mslp_pcpn_frzn', H = frzn ? 4 * 30 + 2 : 40;
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    var css = getComputedStyle(document.documentElement), txt = css.getPropertyValue('--muted').trim() || '#667';
    ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
    var i;
    // rates are shaded on Tropical Tidbits' mm/hr break points but labelled in inches/hr
    function inHr(mm) { var v = mm / 25.4; return String(+(v < 0.01 ? v.toFixed(3) : v.toFixed(2))); }
    // equal-width color boxes like the Tropical Tidbits color bars; a label sits on a box's left edge (its lower limit)
    function bins(x0, bw, yy, thr, cols, wanted, fmtr) {
      var n = thr.length, cw = bw / n, k;
      for (k = 0; k < n; k++) { ctx.fillStyle = cols[k]; ctx.fillRect(x0 + k * cw, yy, cw + 0.6, 12); }
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.6; ctx.strokeRect(x0, yy, bw, 12);
      ctx.fillStyle = txt; var last = -1e9;
      for (k = 0; k < n; k++) {
        if (wanted && wanted.indexOf(thr[k]) < 0) continue;
        var lab = fmtr ? fmtr(thr[k]) : String(thr[k]), w = ctx.measureText(lab).width, cx = clamp(x0 + k * cw, x0 + w / 2, x0 + bw - w / 2);
        if (cx - w / 2 < last + 3) continue;
        ctx.fillText(lab, cx, yy + 23); ctx.fillRect(x0 + k * cw - 0.3, yy + 12, 0.6, 3); last = cx + w / 2;
      }
    }
    if (view === 't2m') {
      var lo = -40, hi = 110, bw = W - 8;
      for (i = 0; i < bw; i++) { var c = TLUT[tIdx(lo + (i / bw) * (hi - lo))]; ctx.fillStyle = 'rgb(' + c.map(Math.round).join(',') + ')'; ctx.fillRect(4 + i, 2, 1.5, 12); }
      ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.6; ctx.strokeRect(4, 2, bw, 12);
      ctx.fillStyle = txt; for (var t = lo; t <= hi - 10; t += 20) ctx.fillText(t + '°', clamp(4 + (t - lo) / (hi - lo) * bw, 12, W - 12), 27);
      return;
    }
    if (view === 'apcpn') { bins(4, W - 8, 2, ACC_T, ACC_C, [0.01, 0.1, 0.3, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 14, 20, 24]); return; }
    if (view === 'asnow') { bins(4, W - 8, 2, SNOW_T, SNOW_C, [0.1, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48]); return; }
    if (!frzn) { bins(4, W - 8, 2, RATE_T, RATE_C, null, inHr); return; }
    var wr = [0.1, 0.5, 1.5, 2.5, 4, 6, 10, 16, 24], wf = [0.1, 0.5, 1, 2, 3, 4, 6, 10, 14]; // the same break points Tropical Tidbits labels
    var rows = [['Rain', RAIN_T, RAIN_C, wr], ['FrzR', FRZ_T, FRZR_C, wf], ['Sleet', FRZ_T, SLEET_C, wf], ['Snow', FRZ_T, SNOWR_C, wf]];
    rows.forEach(function (r, q) {
      ctx.fillStyle = txt; ctx.textAlign = 'left'; ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.fillText(r[0], 4, 2 + q * 30 + 10);
      ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
      bins(44, W - 48, 2 + q * 30, r[1], r[2], r[3], inHr);
    });
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
      if (!msg) msg = curModel().short + ' via Open-Meteo · ' + d.spec.step + '° map grid · loaded ' + fmtClock(d.fetchedAt) + (d.hasType ? '' : ' · rain/snow from snowfall amount') + ' · runs to +' + Math.round(d.steps[d.steps.length - 1].lead) + ' h';
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
    playTimer = setInterval(function () { setStep(stepIdx >= gridData.steps.length - 1 ? 0 : stepIdx + 1); }, clamp(+settings.playMs || 700, 250, 1500));
  }
  function buildModelPicker() {
    var sel = el('model'); sel.innerHTML = '';
    MODELS.forEach(function (m) { var o = document.createElement('option'); o.value = m.id; o.textContent = m.label; sel.appendChild(o); });
    sel.value = modelId;
    el('model-chip').textContent = curModel().short;
    var ts = el('tt-model'); ts.innerHTML = '';
    MODELS.forEach(function (m) { var o = document.createElement('option'); o.value = m.id; o.textContent = m.label; ts.appendChild(o); });
    if (!MODELS.some(function (m) { return m.id === ttModelId; })) ttModelId = 'ecmwf';
    ts.value = ttModelId;
  }
  function buildLinks() {
    var M = MODELS.filter(function (m) { return m.id === ttModelId; })[0] || MODELS[0], links = el('links'); links.innerHTML = '';
    VIEWS.forEach(function (v) {
      var pkg = (v.id === 'mslp_pcpn_frzn' && M.noFrzn) ? 'mslp_pcpn' : v.tt;
      var a = document.createElement('a'); a.className = 'link'; a.href = TT_BASE + '&model=' + M.tt + '&pkg=' + pkg; a.target = '_blank'; a.rel = 'noopener';
      a.innerHTML = '<span></span><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      a.firstChild.textContent = M.short + ' · ' + v.label; links.appendChild(a);
    });
  }
  async function switchModel(id) {
    var oldT = gridData && gridData.steps && gridData.steps[stepIdx] ? gridData.steps[stepIdx].t : null;
    stopPlay(); modelId = id; store.set('wx.model', id);
    el('model-chip').textContent = curModel().short;
    gridData = null; gridNote = ''; stepCache.clear(); scheduleRender();
    el('map-note').textContent = 'Loading ' + curModel().short + '…'; el('map-note').className = 'small muted';
    await loadGrid(false);
    if (id !== modelId) return;
    if (oldT && gridData && gridData.steps && gridData.steps.length) {
      var best = 0, bd = Infinity;
      gridData.steps.forEach(function (st, i) { var dd = Math.abs(st.t - oldT); if (dd < bd) { bd = dd; best = i; } });
      stepIdx = best;
    }
    scheduleRender();
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


  // ---------------------------------------------------------------- station day charts (Weather Underground 5-minute history)
  var hist = null, histOffset = 0, histFetchedAt = 0, histCache = {}, histMsg = 'Loading…', hoverT = null, hoverTimer = 0;
  function dayStartFor(offset) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - offset); return d; }
  function ymd(d) { return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }
  function num() { for (var i = 0; i < arguments.length; i++) { var v = arguments[i]; if (v !== null && v !== undefined && v !== '' && !isNaN(v)) return +v; } return null; }
  async function loadHistory(force) {
    var day = dayStartFor(histOffset), ds = ymd(day), t0 = day.getTime() / 1000, t1 = dayStartFor(histOffset - 1).getTime() / 1000;
    var label = histOffset === 0 ? 'Today' : histOffset === 1 ? 'Yesterday' : day.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
    el('day-label').textContent = label + (histOffset <= 1 ? ' · ' + day.toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');
    el('day-next').disabled = histOffset === 0; el('day-prev').disabled = histOffset >= 14;
    histMsg = '';
    if (demo) { hist = makeDemoHistory(day, t0, t1); histFetchedAt = Date.now(); renderHistory(); return; }
    if (!settings.apiKey) { hist = null; histMsg = 'Add your Weather Underground API key in Settings to see the station charts.'; renderHistory(); return; }
    var c = histCache[ds];
    if (c && !force && (histOffset > 0 || Date.now() - c.fetchedAt < 240000)) { hist = c; histFetchedAt = c.fetchedAt; renderHistory(); return; }
    var url = 'https://api.weather.com/v2/pws/history/all?stationId=' + encodeURIComponent(settings.stationId) +
      '&format=json&units=e&numericPrecision=decimal&date=' + ds + '&apiKey=' + encodeURIComponent(settings.apiKey);
    try {
      var r = await fetch(url, { cache: 'no-store' });
      if (ds !== ymd(dayStartFor(histOffset))) return; // day changed while loading
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
      log('Station history ' + ds + ': ' + rows.length + ' readings' + (obs[0] ? '; fields: ' + Object.keys(obs[0].imperial || {}).join(',') : ''));
      if (!rows.length) histMsg = 'No readings reported for this day.';
    } catch (e) {
      log('Station history error: ' + friendlyError(e));
      hist = c || null; histMsg = 'Could not load station charts: ' + friendlyError(e);
    }
    renderHistory();
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
    var cv = el(cfg.id), W = Math.floor(cv.parentNode.getBoundingClientRect().width) || 320, H = clamp(Math.round(W * 0.46), 160, 230), dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    var css = getComputedStyle(document.documentElement), txt = css.getPropertyValue('--muted').trim() || '#667', line = css.getPropertyValue('--line').trim() || '#ddd', tcol = css.getPropertyValue('--text').trim() || '#111';
    var scol = function (s) { return s.color === 'text' ? tcol : s.color; };
    var d = hist, rows = d ? d.rows : [], t0 = d ? d.t0 : dayStartFor(histOffset).getTime() / 1000, t1 = d ? d.t1 : t0 + 86400;
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
    ticks.forEach(function (v) { ctx.strokeStyle = line; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(L, Y(v)); ctx.lineTo(W - R, Y(v)); ctx.stroke(); ctx.fillStyle = txt; ctx.fillText(tdp ? v.toFixed(tdp) : String(v), L - 5, Y(v)); });
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    var step = W < 480 ? 6 : 3;
    for (var h2 = 0; h2 <= 24; h2 += step) { var tx = clamp(X(t0 + h2 * 3600), L + 12, W - R - 12); ctx.fillStyle = txt; ctx.fillText(hourLabel(h2), tx, H - 6); }
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
    if (!rows.length) { ctx.fillStyle = txt; ctx.textAlign = 'center'; ctx.fillText(histMsg || 'No data', L + pw / 2, T + ph / 2); }
    // hover / touch readout
    if (hoverT !== null && rows.length) {
      var best = null, bd = Infinity;
      rows.forEach(function (r) { var dd = Math.abs(r.t - hoverT); if (dd < bd) { bd = dd; best = r; } });
      if (best && bd < 1800) {
        var hx = X(best.t);
        ctx.strokeStyle = txt; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(hx, T); ctx.lineTo(hx, T + ph); ctx.stroke();
        var lines = [new Date(best.t * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })];
        cfg.series.forEach(function (s) { var v = best[s.key]; if (v !== null && v !== undefined) { ctx.fillStyle = scol(s); ctx.beginPath(); ctx.arc(hx, Y(v), 3.4, 0, 6.3); ctx.fill(); lines.push([{ color: s.color === 'text' ? '#e8eef4' : scol(s) }, s.name + ': ' + v.toFixed(s.dp !== undefined ? s.dp : cfg.dp) + s.unit]); } });
        ctx.font = '600 12px -apple-system, system-ui, sans-serif';
        var bw = 0; lines.forEach(function (l, i) { var tx2 = i ? l[1] : l; bw = Math.max(bw, ctx.measureText(tx2).width + (i ? 16 : 0)); });
        bw += 16; var bh = lines.length * 17 + 8, bx = hx + 10; if (bx + bw > W - 2) bx = hx - 10 - bw; if (bx < 2) bx = 2;
        var by = T + 4;
        ctx.fillStyle = 'rgba(28,34,42,.93)'; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 7); else ctx.rect(bx, by, bw, bh); ctx.fill();
        ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
        lines.forEach(function (l, i) {
          var yy = by + 4 + i * 17 + 8.5;
          if (!i) { ctx.fillStyle = '#ffffff'; ctx.fillText(l, bx + 8, yy); }
          else { ctx.fillStyle = l[0].color; ctx.fillRect(bx + 8, yy - 5, 9, 9); ctx.fillStyle = '#ffffff'; ctx.fillText(l[1], bx + 22, yy); }
        });
        ctx.textBaseline = 'alphabetic';
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
  function histPointer(e) {
    var cv = e.currentTarget, rect = cv.getBoundingClientRect(), cfg = HCHARTS.filter(function (c) { return c.id === cv.id; })[0];
    if (!cfg || !cfg._geo) return;
    var g = cfg._geo, x = e.clientX - rect.left;
    hoverT = g.t0 + clamp((x - g.L) / (g.W - g.L - g.R), 0, 1) * (g.t1 - g.t0);
    clearTimeout(hoverTimer); renderHistory();
  }
  function histPointerEnd(e) {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(function () { hoverT = null; renderHistory(); }, e.pointerType === 'mouse' ? 50 : 3000);
  }
  function setHistDay(delta) {
    histOffset = clamp(histOffset + delta, 0, 14); hoverT = null; loadHistory(false);
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

  // ---------------------------------------------------------------- screen layout (phone / iPad portrait / iPad landscape)
  // two columns on a landscape iPad: map + Euro forecast on the left, station + charts + links on the right
  var placedBig = null;
  function placeCards(big) {
    if (placedBig === big) return; placedBig = big;
    var main = document.querySelector('main'), foot = document.querySelector('footer'), L = el('colL'), R = el('colR');
    if (big) { ['maps', 'point'].forEach(function (id) { L.appendChild(el(id)); }); ['station', 'today', 'tt'].forEach(function (id) { R.appendChild(el(id)); }); }
    else ['station', 'maps', 'point', 'today', 'tt'].forEach(function (id) { main.insertBefore(el(id), foot); });
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

  // ---------------------------------------------------------------- backyard chart
  function localDayStart(t) { var d = new Date(t * 1000); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; }
  function renderPoint() {
    var cv = el('chart'), wrap = el('chart-wrap'), W = Math.floor(wrap.getBoundingClientRect().width) || 340, H = 200, dpr = Math.min(window.devicePixelRatio || 1, 3);
    cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    var css = getComputedStyle(document.documentElement), txt = css.getPropertyValue('--muted').trim() || '#667', line = css.getPropertyValue('--line').trim() || '#ddd';
    var pd = pointData; if (pd && pd.pid && pd.pid !== ptModelId) pd = null; if (!pd) { el('daily').innerHTML = ''; return; }
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
    el('point-note').textContent = curPt().name + (pd.model === 'ecmwf_ifs' ? ' (9 km)' : '') + ' at ' + HOME.lat.toFixed(2) + '°N ' + Math.abs(HOME.lon).toFixed(2) + '°W. Orange = temperature, blue bars = hourly precipitation, yellow dot = your station now.';
  }

  // ---------------------------------------------------------------- demo data
  function makeDemoGrid(spec, M) {
    var nt = 8 * 24, npts = spec.nx * spec.ny, t0 = Math.floor(Date.now() / 86400000) * 86400, hasT = !!M.type;
    var d = { detail: effDetail(M), dom: DOM_KEY, ver: CACHE_VER, modelId: M.id, spec: spec, nt: nt, times: new Float64Array(nt), fetchedAt: Date.now(), p: new Float32Array(npts * nt), pr: new Float32Array(npts * nt), t: new Float32Array(npts * nt), sn: new Float32Array(npts * nt), pt: hasT ? new Int8Array(npts * nt) : null, hasType: hasT, model: 'demo', hLast: M.id === 'rrfs' ? 96 : nt - 1 };
    var shift = { ecmwf: 0, gfs: 0.25, aifs: -0.2, aigfs: 0.4, rrfs: 0.1 }[M.id] || 0;
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
        var rate = Math.max(0, 0.22 * band * wob - 0.015 + shift * 0.01);
        d.pr[idx] = rate;
        var diur = 3 * Math.sin(((t0 + h * 3600) / 3600 % 24 - 9) / 24 * 6.283);
        var T = 41 - 2.6 * (lat - 42) + (lon + 71) * 0.4 + diur - 5 * Math.exp(-r2 / 18);
        d.t[idx] = T;
        if (hasT) d.pt[idx] = rate > 0 ? (T <= 30 ? 5 : T <= 33 ? (lon < -72 ? 3 : 7) : T <= 36 ? 7 : 1) : 0;
        // demo snowfall (10:1 inches): all-snow when cold, half when near freezing
        d.sn[idx] = rate > 0 ? rate * 10 * (T <= 31 ? 1 : T <= 34 ? 0.5 : 0) : 0;
      }
    }
    return d;
  }
  function makeDemoPoint(id) {
    var off = { ecmwf: 0, gfs: 1.2, aifs: -0.9, aigfs: 2 }[id] || 0, t0 = Math.floor(Date.now() / 86400000) * 86400, n = 8 * 24, o = { model: 'demo', times: [], t: [], pr: [], p: [] };
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

  // ---------------------------------------------------------------- settings + diagnostics
  function openSettings() {
    el('set-key').value = settings.apiKey; el('set-station').value = settings.stationId; el('set-detail').value = settings.detail;
    el('set-demo').checked = !!demo; el('set-layout').value = settings.layout || 'auto';
    el('set-speed').value = clamp(+settings.playMs || 700, 250, 1500); showSpeed();
    var dlg = el('settings'); if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', '');
    el('diag-log').textContent = logLines.join('\n');
  }
  function showSpeed() { el('speed-val').textContent = (el('set-speed').value / 1000).toFixed(2).replace(/0$/, '') + ' s per frame'; }
  function saveSettings() {
    var changedDetail = el('set-detail').value !== settings.detail;
    settings.apiKey = el('set-key').value.trim(); settings.stationId = (el('set-station').value.trim() || 'KMAHOPKI22').toUpperCase(); settings.detail = el('set-detail').value;
    settings.playMs = +el('set-speed').value || 700; settings.layout = el('set-layout').value;
    store.set('wx.settings', settings);
    if (playTimer) { stopPlay(); togglePlay(); }
    var wantDemo = el('set-demo').checked, demoChanged = wantDemo !== demo;
    demo = wantDemo; store.set('wx.demo', demo);
    el('settings').close();
    updateBanner();
    document.querySelector('.sub').textContent = 'Hopkinton, MA · ' + settings.stationId;
    applyLayout(); scheduleRender(); renderPoint(); renderHistory();
    histCache = {}; if (changedDetail || demoChanged) { stepIdx = 0; refreshAll(true); } else { loadStation(); loadHistory(true); }
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
      var M = curModel(), j3 = await omFetch(OM_BASE + M.ep + '?latitude=' + HOME.lat + '&longitude=' + HOME.lon + '&hourly=pressure_msl,precipitation,temperature_2m,snowfall&models=' + M.om + '&forecast_days=2&timeformat=unixtime');
      add(M.short + ' maps data: OK ✓ (' + (pick(j3.hourly, 'snowfall') || []).length + ' hours incl. snowfall)');
    } catch (e) { add(curModel().short + ' maps data: FAILED – ' + friendlyError(e)); }
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
    await Promise.all([loadStation(), loadPoint(force), loadGrid(force), loadHistory(force)]);
    renderPoint(); updateCompare(); scheduleRender();
    btn.classList.remove('spin');
  }
  function init() {
    document.querySelector('.sub').textContent = 'Hopkinton, MA · ' + settings.stationId;
    applyLayout();
    buildModelPicker(); buildLinks(); buildPtTabs();
    el('day-prev').addEventListener('click', function () { setHistDay(1); });
    el('day-next').addEventListener('click', function () { setHistDay(-1); });
    HCHARTS.forEach(function (c) { var cv = el(c.id); cv.addEventListener('pointerdown', histPointer); cv.addEventListener('pointermove', histPointer); cv.addEventListener('pointerup', histPointerEnd); cv.addEventListener('pointerleave', histPointerEnd); cv.addEventListener('pointercancel', histPointerEnd); });
    buildTabs(); updateBanner();
    el('model').addEventListener('change', function (e) { switchModel(e.target.value); });
    el('tt-model').addEventListener('change', function (e) { ttModelId = e.target.value; store.set('wx.ttmodel', ttModelId); buildLinks(); });
    el('slider').addEventListener('input', function (e) { stopPlay(); setStep(+e.target.value); });
    el('prev').addEventListener('click', function () { stopPlay(); setStep(stepIdx - 1); });
    el('next').addEventListener('click', function () { stopPlay(); setStep(stepIdx + 1); });
    el('play').addEventListener('click', togglePlay);
    el('refresh').addEventListener('click', function () { refreshAll(true); });
    el('open-settings').addEventListener('click', openSettings);
    el('set-save').addEventListener('click', function (e) { e.preventDefault(); saveSettings(); });
    el('set-cancel').addEventListener('click', function () { el('settings').close(); });
    el('set-check').addEventListener('click', runChecks);
    el('set-speed').addEventListener('input', showSpeed);
    el('set-clear').addEventListener('click', async function () { await Promise.all(MODELS.map(function (m) { return idb.del('grid-' + m.id); })); await idb.del('grid'); store.del('wx.hasType'); stepCache.clear(); log('Saved model data cleared'); el('check-out').textContent = 'Saved model data cleared.'; });
    document.body.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('[data-action]'); if (!a) return;
      if (a.dataset.action === 'settings') openSettings();
      if (a.dataset.action === 'dismiss-tip') { store.set('wx.tipDismissed', true); updateBanner(); }
    });
    var rz; window.addEventListener('resize', function () { applyLayout(); clearTimeout(rz); rz = setTimeout(function () { applyLayout(); scheduleRender(); renderPoint(); renderHistory(); }, 120); });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      if (!station || Date.now() - station.fetchedAt > 60000) loadStation();
      if (histOffset === 0 && Date.now() - histFetchedAt > 240000) loadHistory(true);
      if (gridData && Date.now() - gridData.fetchedAt > GRID_TTL && !demo) refreshAll(false);
    });
    setInterval(function () { if (document.visibilityState === 'visible') { loadStation(); if (histOffset === 0 && Date.now() - histFetchedAt > 290000) loadHistory(true); } }, 60000);
    if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { scheduleRender(); renderPoint(); renderHistory(); });
    renderStation(settings.apiKey || demo ? undefined : 'nokey');
    refreshAll(false);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
