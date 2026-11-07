/* Backyard Weather: dawn, sunrise, solar noon, sunset, dusk and day length, worked out on the device (NOAA method). */
'use strict';

function sunPos(jd) {
  var rad = Math.PI / 180, T = (jd - 2451545) / 36525;
  var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360, M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  var C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
  var om = 125.04 - 1934.136 * T, lam = L0 + C - 0.00569 - 0.00478 * Math.sin(om * rad);
  var eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om * rad);
  var decl = Math.asin(Math.sin(eps * rad) * Math.sin(lam * rad)) / rad, y = Math.pow(Math.tan(eps * rad / 2), 2);
  var eq = 4 * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad)) / rad;
  return { decl: decl, eq: eq };
}
// returns UTC milliseconds for the calendar day y-m-d at (lat, lon); lon is degrees east (negative in the US)
function sunDay(y, m, d, lat, lon) {
  var rad = Math.PI / 180, day0 = Date.UTC(y, m - 1, d), jd0 = day0 / 86400000 + 2440587.5;
  function noonMin(p) { return 720 - 4 * lon - p.eq; }
  function at(minUTC, zen, sign) { // sign -1 morning, +1 evening
    var p = sunPos(jd0 + minUTC / 1440), cosH = (Math.cos(zen * rad) / (Math.cos(lat * rad) * Math.cos(p.decl * rad))) - Math.tan(lat * rad) * Math.tan(p.decl * rad);
    if (cosH < -1 || cosH > 1) return null;
    return noonMin(p) + sign * 4 * Math.acos(cosH) / rad;
  }
  var p0 = sunPos(jd0 + 0.5 - lon / 360), noon0 = noonMin(p0), out = {};
  function solve(zen, sign) { var m1 = at(noon0 + sign * 360, zen, sign); if (m1 === null) return null; var m2 = at(m1, zen, sign); return m2 === null ? null : m2; }
  var noon = noonMin(sunPos(jd0 + noon0 / 1440));
  out.noon = day0 + noon * 60000;
  [['dawn', 96, -1], ['rise', 90.833, -1], ['set', 90.833, 1], ['dusk', 96, 1]].forEach(function (k) { var mm = solve(k[1], k[2]); out[k[0]] = mm === null ? null : day0 + mm * 60000; });
  return out;
}
function daylightHome() {
  var loc = homeLoc();
  var parts = new Intl.DateTimeFormat('en-CA', { timeZone: HOME_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number);
  return { loc: loc, y: parts[0], m: parts[1], d: parts[2] };
}
function hm(ms) { return ms === null || ms === undefined ? '–' : new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone: HOME_TZ }); }
function durTxt(ms) { var m = Math.round(ms / 60000); return Math.floor(m / 60) + 'h ' + pad2(m % 60) + 'm'; }
function renderDaylight() {
  var box = el('daylight-body'); if (!box) return;
  var q = daylightHome(), L = q.loc, t = sunDay(q.y, q.m, q.d, L.lat, L.lon), y = sunDay(q.y, q.m, q.d - 1, L.lat, L.lon);
  var len = (t.rise !== null && t.set !== null) ? t.set - t.rise : null, ylen = (y.rise !== null && y.set !== null) ? y.set - y.rise : null;
  var now = Date.now(), order = ['dawn', 'rise', 'noon', 'set', 'dusk'], next = null;
  order.forEach(function (k) { if (next === null && t[k] !== null && t[k] > now) next = k; });
  function tl(k, label) { return '<div class="tile' + (next === k ? ' next' : '') + '"><div class="k">' + label + '</div><div class="v">' + hm(t[k]) + '</div></div>'; }
  box.innerHTML = '<div class="tiles sun-tiles">' + tl('dawn', 'Dawn') + tl('rise', 'Rise') + tl('noon', 'Peak') + tl('set', 'Set') + tl('dusk', 'Dusk') +
    '<div class="tile"><div class="k">Length</div><div class="v">' + (len === null ? '–' : durTxt(len)) + '</div></div></div>';
  var diff = (len !== null && ylen !== null) ? Math.round((len - ylen) / 1000) : null, dtxt = '';
  if (diff !== null) { var a = Math.round(Math.abs(diff) / 60); dtxt = ' Days are getting ' + (diff >= 0 ? 'longer' : 'shorter') + ' by ' + (a < 1 ? 'less than a minute' : a + (a === 1 ? ' minute' : ' minutes')) + ' per day.'; }
  el('daylight-note').textContent = 'Dawn and dusk are civil twilight (sun 6° below the horizon); Peak is solar noon. For ' + Math.abs(L.lat).toFixed(3) + '°' + (L.lat >= 0 ? 'N' : 'S') + ' ' + Math.abs(L.lon).toFixed(3) + '°' + (L.lon >= 0 ? 'E' : 'W') + (store.get('wx.loc', null) && !demo ? ' (your station)' : ' (Hopkinton)') + '.' + dtxt;
}
