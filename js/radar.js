/* Backyard Weather: live radar loop. Iowa Environmental Mesonet's US NEXRAD composite (base reflectivity),
   the last 50 minutes in 5-minute frames, drawn over the same area, county lines and cities as the forecast maps.
   Free, no key. The images come as one picture per frame for exactly the map's area (WMS), so nothing is stitched here. */
'use strict';

var RADAR_WMS = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi';
var RADAR_META = 'https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json';
var RADAR_AGES = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0]; // minutes before the latest scan
var radar = { valid: 0, frames: [], idx: 0, timer: null, at: 0, px: 0, err: '' };
var radarView = store.get('wx.radarView', 'radar'); // 'radar' or 'sat': which one the card shows
// approximate NWS reflectivity colors for the legend (dBZ)
var DBZ = [[20, '#02fd02'], [25, '#01c501'], [30, '#008e00'], [35, '#fdf802'],
  [40, '#e5bc00'], [45, '#fd9500'], [50, '#fd0000'], [55, '#d40000'], [60, '#bc0000'], [65, '#f800fd'], [70, '#9854c6'], [75, '#fdfdfd']];

function radarSize() {
  var W = Math.floor(el('radar-wrap').getBoundingClientRect().width) || 340;
  return { W: W, H: Math.round(W / MAP_ASPECT) };
}
async function loadRadar(force) {
  if (radarView === 'sat') loadSat(force);
  if (!force && radar.frames.length && Date.now() - radar.at < 4 * 60000) return;
  try {
    var r = await fetch(RADAR_META, { cache: 'no-store' });
    if (!r.ok) throw new Error('Iowa Mesonet HTTP ' + r.status);
    var valid = Date.parse((await r.json()).meta.valid) / 1000;
    var S = radarSize(), px = Math.min(1400, Math.round(S.W * dprNow()));
    radar.at = Date.now(); radar.err = '';
    if (valid === radar.valid && px === radar.px) return;
    radar.valid = valid; radar.px = px;
    var ph = Math.round(px / MAP_ASPECT), base = RADAR_WMS + '?SERVICE=WMS&REQUEST=GetMap&VERSION=1.1.1&FORMAT=image/png&TRANSPARENT=true&STYLES=&SRS=EPSG:4326' +
      '&BBOX=' + [DOM.lon0, DOM.lat0, DOM.lon1, DOM.lat1].join(',') + '&WIDTH=' + px + '&HEIGHT=' + ph;
    radar.frames = RADAR_AGES.map(function (m) {
      var img = new Image(), f = { t: valid - m * 60, img: img, ok: false };
      img.onload = function () { f.ok = true; if (radar.frames.indexOf(f) === radar.idx || !radar.timer) drawRadar(); };
      img.src = base + '&LAYERS=nexrad-n0q' + (m ? '-m' + pad2(m) + 'm' : '') + '&v=' + valid; // v: a new address for each scan, so nothing stale is reused
      return f;
    });
    if (!radar.timer) radar.idx = radar.frames.length - 1;
    log('Radar: latest scan ' + fmtClock(valid * 1000));
  } catch (e) { radar.err = friendlyError(e); log('Radar error: ' + radar.err); }
  drawRadar();
}
function drawRadar() {
  var cv = el('radar'); if (!cv) return;
  var S = radarSize(), W = S.W, H = S.H, ctx = sizeCanvas(cv, W, H);
  ensureLayers(W, H);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  var f = radar.frames[radar.idx];
  if (f && f.ok) { ctx.imageSmoothingEnabled = true; ctx.drawImage(f.img, 0, 0, W, H); }
  ctx.drawImage(layers.base, 0, 0, W, H);
  ctx.drawImage(layers.top, 0, 0, W, H);
  if (!f || !f.ok) {
    ctx.fillStyle = '#5d6b79'; ctx.font = '14px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(radar.err ? 'Radar unavailable' : 'Loading radar…', W / 2, H / 2);
  }
  if (radarView !== 'radar') return; // the satellite view owns the shared controls
  var lab = el('radar-time'), age = f ? Math.round((Date.now() / 1000 - f.t) / 60) : null;
  lab.textContent = f ? fmtClock(f.t * 1000) + '  ·  ' + (age < 1 ? 'just now' : age + ' min ago') : '—';
  el('radar-slider').max = Math.max(0, radar.frames.length - 1); el('radar-slider').value = radar.idx;
  el('radar-note').textContent = radar.err ? 'Could not load radar: ' + radar.err :
    'NWS NEXRAD composite via Iowa Environmental Mesonet · 5-minute scans · ' + (radar.at ? 'checked ' + fmtClock(radar.at) : '');
  el('radar-note').className = 'small ' + (radar.err ? 'warn' : 'muted');
  drawRadarLegend(W);
}
var radarLegendKey = '';
function drawRadarLegend(W) {
  var key = W + '|' + dprNow() + '|' + isDark(); if (key === radarLegendKey) return; radarLegendKey = key;
  var cv = el('radar-legend'), ctx = sizeCanvas(cv, W, 40); ctx.clearRect(0, 0, W, 40);
  var tc = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim() || '#667', bw = W - 8, cw = bw / DBZ.length;
  DBZ.forEach(function (d, k) { ctx.fillStyle = d[1]; ctx.fillRect(4 + k * cw, 2, cw + 0.6, 12); });
  ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.6; ctx.strokeRect(4, 2, bw, 12);
  ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.fillStyle = tc;
  ctx.textAlign = 'left'; ctx.fillText('Light', 4, 27);
  ctx.textAlign = 'center'; ctx.fillText('Moderate', 4 + 4 * cw, 27); ctx.fillText('Heavy', 4 + 7.5 * cw, 27);
  ctx.textAlign = 'right'; ctx.fillText('Hail', W - 4, 27);
}
// the play, step and slider controls work on whichever loop is shown
function loopNow() { return radarView === 'sat' ? sat : radar; }
function drawLoop() { if (radarView === 'sat') drawSat(); else drawRadar(); }
function radarStop() {
  [radar, sat].forEach(function (o) { if (o.timer) { clearTimeout(o.timer); o.timer = null; } });
  el('radar-play').textContent = '▶'; el('radar-play').setAttribute('aria-label', 'Play loop');
}
function radarPlay() {
  var o = loopNow();
  if (o.timer) { radarStop(); return; }
  el('radar-play').textContent = '❚❚'; el('radar-play').setAttribute('aria-label', 'Pause loop');
  (function tick() {
    o.idx = o.idx >= o.frames.length - 1 ? 0 : o.idx + 1; drawLoop();
    // linger on the latest frame so it is easy to read
    o.timer = setTimeout(tick, o.idx === o.frames.length - 1 ? 1600 : clamp(+settings.playMs || 700, 250, 1500) * 0.7);
  })();
}
function radarStep(d) { radarStop(); var o = loopNow(); o.idx = clamp(o.idx + d, 0, Math.max(0, o.frames.length - 1)); drawLoop(); }

// ---------------------------------------------------------------- satellite
// NOAA's GOES-19 GeoColor images of the Northeast (true color by day, infrared clouds with city lights at night),
// the last hour in 5-minute frames. Free, no key. Each frame is named by its UTC time (year, day of the year, hour,
// minute), always on minutes ending in 1 or 6, so the names are worked out here; if that ever stops working, NOAA's
// file list (large) is read once instead.
var SAT_BASE = 'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/SECTOR/ne/GEOCOLOR/';
var SAT_SIZE = '600x600', SAT_FRAMES = 12;
var sat = { frames: [], idx: 0, timer: null, at: 0, err: '', imgs: {}, useList: false };
function satName(t) {
  var d = new Date(t * 1000), y = d.getUTCFullYear(), doy = Math.floor((Date.UTC(y, d.getUTCMonth(), d.getUTCDate()) - Date.UTC(y, 0, 1)) / 86400000) + 1;
  return y + String(doy).padStart(3, '0') + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes()) + '_GOES19-ABI-ne-GEOCOLOR-' + SAT_SIZE + '.jpg';
}
function satTime(name) {
  var m = /^(\d{4})(\d{3})(\d{2})(\d{2})_/.exec(name); if (!m) return 0;
  return Date.UTC(+m[1], 0, +m[2], +m[3], +m[4]) / 1000;
}
async function satNames() {
  if (sat.useList) {
    var r = await fetch(SAT_BASE, { cache: 'no-store' });
    if (!r.ok) throw new Error('NOAA HTTP ' + r.status);
    var re = new RegExp('\\d{11}_GOES19-ABI-ne-GEOCOLOR-' + SAT_SIZE + '\\.jpg', 'g'), seen = {}, out = [];
    ((await r.text()).match(re) || []).forEach(function (n) { if (!seen[n]) { seen[n] = 1; out.push(n); } });
    return out.sort().slice(-(SAT_FRAMES + 2));
  }
  // every 5 minutes on :01, :06, …, from 80 minutes ago to now (the newest one or two may not be posted yet)
  var now = Math.floor(Date.now() / 1000), t = Math.floor((now - 60) / 300) * 300 + 60, names = [];
  for (var k = 0; k < SAT_FRAMES + 4; k++) names.unshift(satName(t - k * 300));
  return names;
}
function satImage(name) {
  if (sat.imgs[name]) return sat.imgs[name];
  var p = new Promise(function (res) {
    var img = new Image();
    img.onload = function () { res({ name: name, t: satTime(name), img: img }); };
    img.onerror = function () { res(null); };
    img.src = SAT_BASE + name;
  });
  sat.imgs[name] = p;
  p.then(function (f) { if (!f) delete sat.imgs[name]; }); // a frame not posted yet is tried again next time
  return p;
}
async function loadSat(force) {
  if (!force && sat.frames.length && Date.now() - sat.at < 4.5 * 60000) { drawSat(); return; }
  sat.at = Date.now();
  try {
    var got = (await Promise.all((await satNames()).map(satImage))).filter(Boolean);
    if (!got.length && !sat.useList) { sat.useList = true; log('Satellite: frame names not found; reading NOAA\'s file list'); got = (await Promise.all((await satNames()).map(satImage))).filter(Boolean); }
    if (!got.length) throw new Error('no satellite images found');
    got = got.slice(-SAT_FRAMES);
    var atEnd = !sat.frames.length || sat.idx >= sat.frames.length - 1;
    sat.frames = got; sat.err = '';
    if (!sat.timer && atEnd) sat.idx = got.length - 1;
    sat.idx = Math.min(sat.idx, got.length - 1);
    // forget images older than the loop
    var keep = {}; got.forEach(function (f) { keep[f.name] = 1; });
    Object.keys(sat.imgs).forEach(function (n) { if (!keep[n] && satTime(n) < got[0].t) delete sat.imgs[n]; });
    log('Satellite: latest image ' + fmtClock(got[got.length - 1].t * 1000));
  } catch (e) { sat.err = friendlyError(e); log('Satellite error: ' + sat.err); }
  drawSat();
}
function drawSat() {
  if (radarView !== 'sat') return;
  var f = sat.frames[sat.idx], img = el('sat-img');
  if (f && img.getAttribute('src') !== f.img.src) img.src = f.img.src;
  var age = f ? Math.round((Date.now() / 1000 - f.t) / 60) : null;
  el('radar-time').textContent = f ? fmtClock(f.t * 1000) + '  ·  ' + (age < 1 ? 'just now' : age + ' min ago') : (sat.err ? '—' : 'Loading satellite…');
  el('radar-slider').max = Math.max(0, sat.frames.length - 1); el('radar-slider').value = sat.idx;
  el('radar-note').textContent = sat.err ? 'Could not load satellite: ' + sat.err :
    'NOAA GOES-19 GeoColor, Northeast view · true color by day, infrared clouds and city lights at night · 5-minute images' + (sat.at ? ' · checked ' + fmtClock(sat.at) : '');
  el('radar-note').className = 'small ' + (sat.err ? 'warn' : 'muted');
}
function setRadarView(v) {
  radarStop(); radarView = v; store.set('wx.radarView', v);
  var isSat = v === 'sat';
  el('radar-wrap').hidden = isSat; el('radar-legend').hidden = isSat; el('sat-wrap').hidden = !isSat;
  buildRadarSeg();
  if (isSat) { drawSat(); loadSat(false); } else drawRadar();
}
function buildRadarSeg() {
  var box = el('radar-seg'); box.innerHTML = '';
  [['radar', 'Radar'], ['sat', 'Satellite']].forEach(function (o) {
    var b = mkEl('button', 'tab' + (radarView === o[0] ? ' on' : ''), o[1]); b.type = 'button';
    b.addEventListener('click', function () { if (radarView !== o[0]) setRadarView(o[0]); });
    box.appendChild(b);
  });
}
function initRadar() {
  el('radar-play').addEventListener('click', radarPlay);
  el('radar-prev').addEventListener('click', function () { radarStep(-1); });
  el('radar-next').addEventListener('click', function () { radarStep(1); });
  el('radar-slider').addEventListener('input', function (e) { radarStop(); loopNow().idx = +e.target.value; drawLoop(); });
  setRadarView(radarView === 'sat' ? 'sat' : 'radar');
  loadRadar(true);
}
