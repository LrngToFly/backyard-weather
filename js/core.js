/* Backyard Weather: shared constants, helpers, settings and on-device storage.
   Loaded first. The scripts after it share these names (plain scripts, no build step). */
'use strict';

// ---------------------------------------------------------------- place
var HOME = { lat: 42.240, lon: -71.504 };
var HOME_TZ = 'America/New_York';
var HOME_NAME = 'Hopkinton, MA';
// Map area: home is near the middle; extra room to the west so upstate NY is in view (weather arrives from there).
// 7 x 4.5 degrees = about 550 points on the fine (0.25 degree) grid, under Open-Meteo's 600 per minute limit.
var DOM = { lat0: 40.0, lat1: 44.5, lon0: -75.5, lon1: -68.5 };
var DOM_KEY = [DOM.lat0, DOM.lat1, DOM.lon0, DOM.lon1].join(',');

// ---------------------------------------------------------------- services
var OM_BASE = 'https://api.open-meteo.com/v1/';
var OM_META = 'https://api.open-meteo.com/data/';                         // per-model "latest run" files
var OM_PREV = 'https://previous-runs-api.open-meteo.com/v1/forecast';     // past forecasts (model scorecard)
var OM_AQ = 'https://air-quality-api.open-meteo.com/v1/air-quality';
var WU_BASE = 'https://api.weather.com/v2/pws/';
var NWS_BASE = 'https://api.weather.gov/';
var AIRNOW_BASE = 'https://www.airnowapi.org/aq/';
var AMB_BASE = 'https://rt.ambientweather.net/v1/';
var TT_BASE = 'https://www.tropicaltidbits.com/analysis/models/?region=neus';

var CACHE_VER = 7;                // bump when the saved-map format changes
var GRID_TTL = 2 * 3600 * 1000;   // only used when the "new run?" check can't be reached
var HIST_KEEP_DAYS = 14;          // past days of 5-minute station history kept on the device
// The station sits between the house and trees; wind or gust readings above this are sensor glitches and are ignored.
var MAX_WIND_MPH = 60;
function windOk(v) { return v === null || v === undefined || isNaN(v) || v > MAX_WIND_MPH ? null : +v; }

var CITIES = [
  ['Boston', 42.36, -71.06], ['Hartford', 41.76, -72.67], ['Providence', 41.82, -71.41],
  ['Albany', 42.65, -73.76], ['Portland', 43.66, -70.26], ['Springfield', 42.10, -72.59],
  ['Concord', 43.21, -71.54], ['New York', 40.71, -74.0], ['Hyannis', 41.65, -70.28], ['Utica', 43.10, -75.23]
];
var VIEWS = [
  { id: 'mslp_pcpn', label: 'MSLP & Precip', tt: 'mslp_pcpn', sub: 'Sea-level pressure (hPa) and precipitation rate (in/hr). Dashed lines: 1000–500 mb thickness (blue = 540 dam)' },
  { id: 'mslp_pcpn_frzn', label: 'Rain / Frozen', tt: 'mslp_pcpn_frzn', sub: 'Sea-level pressure (hPa), precipitation rate (in/hr) colored by type. Dashed lines: 1000–500 mb thickness (blue = 540 dam)' },
  { id: 'apcpn', label: 'Total Precip', tt: 'apcpn', sub: 'Precipitation accumulated since the first time shown (inches)' },
  { id: 'asnow', label: 'Total Snow', tt: 'asnow', sub: 'Snowfall accumulated since the first time shown (inches, 10:1 snow-to-water ratio)',
    subK: 'Snowfall accumulated since the first time shown (inches, Kuchera ratio: fluffier when the air above is colder)' },
  { id: 't2m', label: '2m Temp', tt: 'T2m', sub: '2-metre air temperature (°F); dark blue line = 32°F' },
  { id: 'dew', label: '2m Dewpoint', tt: 'Td2m', sub: '2-metre dewpoint (°F), with sea-level pressure lines' },
  { id: 'wind', label: '10m Wind', tt: 'mslp_wind', sub: 'Wind at 10 metres: speed shaded in mph, barbs in knots (a long barb is 10 kt, a short one 5 kt, a flag 50 kt), sea-level pressure lines (hPa)' }
];
// Forecast models. ep/om = Open-Meteo endpoint and model name; meta = Open-Meteo's "latest run" file for it;
// tt = Tropical Tidbits model code. type: Open-Meteo reports rain/snow type directly (otherwise it is worked out from the snowfall amount).
var MODELS = [
  { id: 'ecmwf', label: 'Euro (ECMWF IFS)', short: 'Euro', ep: 'ecmwf', om: 'ecmwf_ifs025', meta: 'ecmwf_ifs025', tt: 'ecmwf', type: true },
  { id: 'gfs', label: 'GFS', short: 'GFS', ep: 'gfs', om: 'gfs_seamless', meta: 'ncep_gfs025', tt: 'gfs' },
  { id: 'aifs', label: 'EC-AIFS (AI)', short: 'EC-AIFS', ep: 'ecmwf', om: 'ecmwf_aifs025_single', meta: 'ecmwf_aifs025_single', tt: 'ec-aifs' },
  { id: 'aigfs', label: 'AIGFS (AI)', short: 'AIGFS', ep: 'gfs', om: 'ncep_aigfs025', meta: 'ncep_aigfs025', tt: 'aigfs' },
  { id: 'rrfs', label: 'RRFS (3 km, 4 days)', short: 'RRFS', ep: 'gfs', om: 'ncep_rrfs_conus', meta: 'ncep_rrfs_conus', tt: 'rrfs', fine: true, noFrzn: true }
];

// ---------------------------------------------------------------- helpers
function el(id) { return document.getElementById(id); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function sleep(ms) { return new Promise(function (res) { setTimeout(res, ms); }); }
function fmtDay(t) { return new Date(t * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric' }); }
function fmtClock(ms) { return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
function fmt(v, dp) { return (v === null || v === undefined || isNaN(v)) ? '–' : Number(v).toFixed(dp); }
function hex(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
function num() { for (var i = 0; i < arguments.length; i++) { var v = arguments[i]; if (v !== null && v !== undefined && v !== '' && !isNaN(v)) return +v; } return null; }
function compass(deg) {
  var d = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return d[Math.round(((deg % 360) + 360) % 360 / 22.5) % 16];
}
// calendar days on the device (the station's local time)
function ymd(d) { return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()); }
function dayStart(offset) { var d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - offset); return d; }
function dsDate(ds) { return new Date(+ds.slice(0, 4), +ds.slice(4, 6) - 1, +ds.slice(6, 8)); }
function mkEl(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; }

var store = {
  get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  del: function (k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
};
var settings = Object.assign({ apiKey: '', airnowKey: '', ambientApiKey: '', ambientAppKey: '', stationId: 'KMAHOPKI22', detail: 'fine', playMs: 700, layout: 'auto', snowRatio: 'ten' }, store.get('wx.settings', {}));
// local testing only (localhost): keys from keys.local.js fill in any that aren't saved; the live app never has this file
if (window.LOCAL_KEYS) {
  var LK = window.LOCAL_KEYS;
  if (LK.wu && !settings.apiKey) settings.apiKey = LK.wu;
  if (LK.airnow && !settings.airnowKey) settings.airnowKey = LK.airnow;
  if (LK.ambientApi && !settings.ambientApiKey) settings.ambientApiKey = LK.ambientApi;
  if (LK.ambientApp && !settings.ambientAppKey) settings.ambientAppKey = LK.ambientApp;
}
var params = new URLSearchParams(location.search);
var demo = params.get('demo') === '1' || store.get('wx.demo', false);
// the station's own coordinates once it has reported them, else the town
function homeLoc() { return (!demo && store.get('wx.loc', null)) || { lat: HOME.lat, lon: HOME.lon }; }
function wuUrl(path, extra) {
  return WU_BASE + path + '?stationId=' + encodeURIComponent(settings.stationId) + '&format=json&units=e&numericPrecision=decimal' +
    (extra || '') + '&apiKey=' + encodeURIComponent(settings.apiKey);
}
// Every Weather Underground request goes through wuFetch. When Weather Underground refuses the key (usually the
// 1,500-a-day limit), all requests pause until the allowance resets at midnight UTC (7 or 8 PM in Massachusetts),
// so refused requests don't keep counting. Saving the key in Settings ends the pause.
// soft: a refusal from this request doesn't pause (the hourly history can be limited on its own while the rest works).
function wuPausedUntil() { var u = store.get('wx.wuPause', 0); return u > Date.now() ? u : 0; }
function wuPauseMsg() {
  return 'Weather Underground refused the key, most likely because today\'s limit of 1,500 requests was reached. ' +
    'The app stops asking until ' + new Date(wuPausedUntil()).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) + ', when the limit resets.';
}
function wuRefused(status) { return new Error(wuPausedUntil() ? wuPauseMsg() : 'Weather Underground rejected the key (HTTP ' + status + ')'); }
// identical requests made at the same moment (e.g. start-up and returning to the app both refreshing) share one download
var wuInflight = {};
async function wuFetch(path, extra, soft) {
  if (wuPausedUntil()) { var e = new Error(wuPauseMsg()); e.paused = true; throw e; }
  var url = wuUrl(path, extra), p = wuInflight[url];
  if (!p) {
    p = wuInflight[url] = fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!soft && (r.status === 401 || r.status === 403 || r.status === 429)) {
        var d = new Date(); store.set('wx.wuPause', Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
        log('Weather Underground refused the key (HTTP ' + r.status + '); pausing its requests until ' + new Date(wuPausedUntil()).toLocaleTimeString());
      }
      return r;
    });
    p.then(function () { delete wuInflight[url]; }, function () { delete wuInflight[url]; });
  }
  return (await p).clone(); // each caller reads its own copy of the answer
}

// IndexedDB key/value store for the larger saved data (maps, station history)
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
  ready: async function () { if (!this.db) this.db = await this.open(); return this.db; },
  get: async function (k) {
    var db = await this.ready(); if (!db) return null;
    return new Promise(function (res) {
      try { var q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = function () { res(q.result || null); }; q.onerror = function () { res(null); }; } catch (e) { res(null); }
    });
  },
  set: async function (k, v) {
    var db = await this.ready(); if (!db) return;
    return new Promise(function (res) {
      try { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(v, k); tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); }; } catch (e) { res(); }
    });
  },
  del: async function (k) {
    var db = await this.ready(); if (!db) return;
    return new Promise(function (res) {
      try { var tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete(k); tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); }; } catch (e) { res(); }
    });
  },
  keys: async function () {
    var db = await this.ready(); if (!db) return [];
    return new Promise(function (res) {
      try { var q = db.transaction('kv').objectStore('kv').getAllKeys(); q.onsuccess = function () { res(q.result || []); }; q.onerror = function () { res([]); }; } catch (e) { res([]); }
    });
  }
};

// ---------------------------------------------------------------- diagnostics
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
  if ((e && e.name === 'TypeError') || /Load failed|Failed to fetch|NetworkError/i.test(m)) {
    return 'Could not connect (' + m + '). Either there is no internet, or the site refuses requests from a web page.';
  }
  if (e && e.status === 429) return 'Open-Meteo\'s free limit was reached (' + (e.reason || 'too many requests') + '). Wait a minute, then tap refresh.';
  return m;
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
function pick(h, name) {
  if (h[name]) return h[name];
  var k = Object.keys(h).filter(function (x) { return x.indexOf(name) === 0; })[0];
  return k ? h[k] : null;
}

// ---------------------------------------------------------------- tap-to-read on charts
// A tap (or a sideways slide) shows the readout and it stays; tapping again hides it. Scrolling past a chart does nothing.
// With a mouse the readout follows the pointer.
var readouts = [];
function tapReadout(cv, show, hide, isOpen) {
  var t = null;
  cv.classList.add('readout');
  cv.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse') { show(e); return; }
    t = { x: e.clientX, moved: false, wasOpen: isOpen() };
  });
  cv.addEventListener('pointermove', function (e) {
    if (e.pointerType === 'mouse') { show(e); return; }
    if (!t) return;
    if (!t.moved && Math.abs(e.clientX - t.x) > 8) t.moved = true;
    if (t.moved) show(e);
  });
  cv.addEventListener('pointerup', function (e) {
    if (e.pointerType === 'mouse' || !t) return;
    if (!t.moved) { if (t.wasOpen) hide(); else show(e); }
    t = null;
  });
  cv.addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') hide(); });
  cv.addEventListener('pointercancel', function () { t = null; });
  readouts.push(hide);
}
document.addEventListener('pointerdown', function (e) {
  if (e.target.closest && e.target.closest('canvas.readout')) return;
  readouts.forEach(function (h) { h(); });
});
