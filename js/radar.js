/* Backyard Weather: live radar loop. Iowa Environmental Mesonet's US NEXRAD composite (base reflectivity),
   the last 50 minutes in 5-minute frames, drawn over the same area, county lines and cities as the forecast maps.
   Free, no key. The images come as one picture per frame for exactly the map's area (WMS), so nothing is stitched here. */
'use strict';

var RADAR_WMS = 'https://mesonet.agron.iastate.edu/cgi-bin/wms/nexrad/n0q.cgi';
var RADAR_META = 'https://mesonet.agron.iastate.edu/data/gis/images/4326/USCOMP/n0q_0.json';
var RADAR_AGES = [50, 45, 40, 35, 30, 25, 20, 15, 10, 5, 0]; // minutes before the latest scan
var radar = { valid: 0, frames: [], idx: 0, timer: null, at: 0, px: 0, err: '' };
// approximate NWS reflectivity colors for the legend (dBZ)
var DBZ = [[20, '#02fd02'], [25, '#01c501'], [30, '#008e00'], [35, '#fdf802'],
  [40, '#e5bc00'], [45, '#fd9500'], [50, '#fd0000'], [55, '#d40000'], [60, '#bc0000'], [65, '#f800fd'], [70, '#9854c6'], [75, '#fdfdfd']];

function radarSize() {
  var W = Math.floor(el('radar-wrap').getBoundingClientRect().width) || 340;
  return { W: W, H: Math.round(W / MAP_ASPECT) };
}
async function loadRadar(force) {
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
function radarStop() { if (radar.timer) { clearTimeout(radar.timer); radar.timer = null; } el('radar-play').textContent = '▶'; el('radar-play').setAttribute('aria-label', 'Play radar'); }
function radarPlay() {
  if (radar.timer) { radarStop(); return; }
  el('radar-play').textContent = '❚❚'; el('radar-play').setAttribute('aria-label', 'Pause radar');
  (function tick() {
    radar.idx = radar.idx >= radar.frames.length - 1 ? 0 : radar.idx + 1; drawRadar();
    // linger on the latest scan so it is easy to read
    radar.timer = setTimeout(tick, radar.idx === radar.frames.length - 1 ? 1600 : clamp(+settings.playMs || 700, 250, 1500) * 0.7);
  })();
}
function radarStep(d) { radarStop(); radar.idx = clamp(radar.idx + d, 0, Math.max(0, radar.frames.length - 1)); drawRadar(); }
function initRadar() {
  el('radar-play').addEventListener('click', radarPlay);
  el('radar-prev').addEventListener('click', function () { radarStep(-1); });
  el('radar-next').addEventListener('click', function () { radarStep(1); });
  el('radar-slider').addEventListener('input', function (e) { radarStop(); radar.idx = +e.target.value; drawRadar(); });
  loadRadar(true);
}
