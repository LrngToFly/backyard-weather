/* Backyard Weather: drawing the forecast maps and the map controls.
   Fixed parts (county/state/coast lines, city names) are drawn once per map size; each frame's shading,
   pressure lines and wind barbs are kept after the first time they are drawn, so replaying an animation is cheap. */
'use strict';

var MAP_ASPECT = (DOM.lon1 - DOM.lon0) * Math.cos((DOM.lat0 + DOM.lat1) / 2 * Math.PI / 180) / (DOM.lat1 - DOM.lat0);
function viewDef(id) { return VIEWS.filter(function (v) { return v.id === id; })[0]; }
function useKuch() { return view === 'asnow' && settings.snowRatio === 'kuchera'; }
function dprNow() { return Math.min(window.devicePixelRatio || 1, 3); }
// resize a canvas only when its size actually changes (resizing wipes and reallocates it)
function sizeCanvas(cv, W, H) {
  var dpr = dprNow(), w = Math.round(W * dpr), h = Math.round(H * dpr);
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  if (cv._cw !== W || cv._ch !== H) { cv.style.width = W + 'px'; cv.style.height = H + 'px'; cv._cw = W; cv._ch = H; }
  var ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
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

// ---------------------------------------------------------------- per-frame geometry (kept with the frame)
function geomFor(g, W, H) { var k = W + 'x' + H; if (!g.geom || g.geom.k !== k) g.geom = { k: k }; return g.geom; }
function gridProj(g, W, H) {
  var sx = g.deg / (DOM.lon1 - DOM.lon0) * W, sy = g.deg / (DOM.lat1 - DOM.lat0) * H;
  return function (q) { return [q[0] * sx, H - q[1] * sy]; };
}
function addChain(path, pts) { pts.forEach(function (p, i) { if (i === 0) path.moveTo(p[0], p[1]); else path.lineTo(p[0], p[1]); }); }
function fieldRange(a) { var mn = Infinity, mx = -Infinity; for (var i = 0; i < a.length; i++) { var v = a[i]; if (v < mn) mn = v; if (v > mx) mx = v; } return [mn, mx]; }
function pressureGeom(g, W, H) {
  var G = geomFor(g, W, H); if (G.p) return G.p;
  var pg = gridProj(g, W, H), r = fieldRange(g.mslp), iso = new Path2D(), labels = [];
  for (var lev = Math.ceil(r[0] / 4) * 4; lev <= r[1]; lev += 4) {
    contourChains(g.mslp, g.nxu, g.nyu, lev).forEach(function (ch) {
      if (ch.length < 3) return;
      var pts = ch.map(pg); addChain(iso, pts);
      if (lev % 8 !== 0) return;
      var len = 0; for (var s = 1; s < pts.length; s++) len += Math.hypot(pts[s][0] - pts[s - 1][0], pts[s][1] - pts[s - 1][1]);
      if (len <= 150) return;
      var m = Math.floor(pts.length / 2), a = pts[Math.max(0, m - 2)], b = pts[Math.min(pts.length - 1, m + 2)];
      var ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      if (ang > Math.PI / 2 || ang < -Math.PI / 2) ang += Math.PI;
      labels.push({ x: pts[m][0], y: pts[m][1], ang: ang, text: String(lev) });
    });
  }
  var ext = findExtremes(g).map(function (e) { return { p: pg([e.i, e.j]), type: e.type, v: e.v }; });
  G.p = { iso: iso, labels: labels, ext: ext };
  return G.p;
}
function thicknessGeom(g, W, H) {
  var G = geomFor(g, W, H); if (G.th) return G.th;
  var pg = gridProj(g, W, H), r = fieldRange(g.th), out = { c540: new Path2D(), cold: new Path2D(), warm: new Path2D() };
  for (var lev = Math.ceil(r[0] / 6) * 6; lev <= r[1]; lev += 6) {
    var path = lev === 540 ? out.c540 : lev < 540 ? out.cold : out.warm;
    contourChains(g.th, g.nxu, g.nyu, lev).forEach(function (ch) { if (ch.length >= 3) addChain(path, ch.map(pg)); });
  }
  G.th = out;
  return out;
}
function freezeGeom(g, W, H) {
  var G = geomFor(g, W, H); if (G.t32) return G.t32;
  var pg = gridProj(g, W, H), path = new Path2D();
  contourChains(g.t2, g.nxu, g.nyu, 32).forEach(function (ch) { addChain(path, ch.map(pg)); });
  G.t32 = path;
  return path;
}
// standard wind barbs (speeds in knots): the staff points toward where the wind comes from
function barbGeom(g, W, H) {
  var G = geomFor(g, W, H); if (G.barbs) return G.barbs;
  var S = W > 520 ? 38 : 29, L = W > 520 ? 24 : 19, nxu = g.nxu, nyu = g.nyu, line = new Path2D(), fill = new Path2D();
  for (var py = S / 2; py < H - 4; py += S) {
    for (var px = S / 2; px < W - 4; px += S) {
      var lon = DOM.lon0 + px / W * (DOM.lon1 - DOM.lon0), lat = DOM.lat1 - py / H * (DOM.lat1 - DOM.lat0);
      var fx = clamp((lon - DOM.lon0) / g.deg, 0, nxu - 1.0001), fy = clamp((lat - DOM.lat0) / g.deg, 0, nyu - 1.0001), x0 = fx | 0, y0 = fy | 0, tx = fx - x0, ty = fy - y0, i = y0 * nxu + x0;
      var u = (g.u[i] * (1 - tx) + g.u[i + 1] * tx) * (1 - ty) + (g.u[i + nxu] * (1 - tx) + g.u[i + nxu + 1] * tx) * ty;
      var v = (g.v[i] * (1 - tx) + g.v[i + 1] * tx) * (1 - ty) + (g.v[i + nxu] * (1 - tx) + g.v[i + nxu + 1] * tx) * ty;
      var sp = Math.hypot(u, v), r5 = Math.round(sp / 5) * 5;
      if (r5 < 5) { line.moveTo(px + 2.2, py); line.arc(px, py, 2.2, 0, 6.3); continue; }
      var sx = -u / sp, sy = v / sp; // screen vector from the point toward the wind source (y is down)
      var qx = -sy, qy = sx;         // perpendicular, clockwise side
      var ex = px + sx * L, ey = py + sy * L;
      line.moveTo(px, py); line.lineTo(ex, ey);
      var pos = 0, rem = r5, bl = 8.5;
      var at = function (t) { return [ex - sx * t, ey - sy * t]; };
      while (rem >= 50) { var a = at(pos), b = at(pos + 4.2); fill.moveTo(a[0], a[1]); fill.lineTo(a[0] + qx * bl + sx * 1.5, a[1] + qy * bl + sy * 1.5); fill.lineTo(b[0], b[1]); fill.closePath(); pos += 5.5; rem -= 50; }
      while (rem >= 10) { var c = at(pos); line.moveTo(c[0], c[1]); line.lineTo(c[0] + qx * bl + sx * 3, c[1] + qy * bl + sy * 3); pos += 3.4; rem -= 10; }
      if (rem >= 5) { if (pos === 0) pos = 3.4; var e = at(pos); line.moveTo(e[0], e[1]); line.lineTo(e[0] + qx * bl * 0.5 + sx * 1.6, e[1] + qy * bl * 0.5 + sy * 1.6); }
    }
  }
  G.barbs = { line: line, fill: fill };
  return G.barbs;
}

// ---------------------------------------------------------------- shading (kept per frame within a memory budget)
var shadeCv = document.createElement('canvas');
var frameCache = new Map(), frameBytes = 0, FRAME_BUDGET = 48e6;
function clearFrames() { frameCache.clear(); frameBytes = 0; }
function shadeFor(g, W, H) {
  var scale = W > 520 ? 1.5 : 2, w = Math.round(W * scale), h = Math.round(H * scale), kuch = useKuch() && !!g.snaccK;
  var key = view + '|' + g.h + '|' + w + 'x' + h + (kuch ? '|k' : '');
  var hit = frameCache.get(key); if (hit) return hit;
  var img = shade(g, w, h, kuch), bytes = w * h * 4;
  // Make room: frames of an old map size always go; frames of other views go when over budget.
  // Frames of the current view are never swapped out, so a playing loop keeps reusing the ones it has.
  frameCache.forEach(function (c, k) {
    var otherSize = k.indexOf('|' + w + 'x' + h) < 0, otherView = k.indexOf(view + '|') !== 0;
    if (otherSize || (otherView && frameBytes + bytes > FRAME_BUDGET)) { frameCache.delete(k); frameBytes -= c.width * c.height * 4; }
  });
  if (frameBytes + bytes <= FRAME_BUDGET) {
    var c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').putImageData(img, 0, 0);
    frameCache.set(key, c); frameBytes += bytes; return c;
  }
  shadeCv.width = w; shadeCv.height = h; shadeCv.getContext('2d').putImageData(img, 0, 0);
  return shadeCv;
}
function shade(g, w, h, kuch) {
  var img = new ImageData(w, h), data = img.data;
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
  var snowField = kuch ? g.snaccK : g.snacc;
  for (py = 0; py < h; py++) {
    var lat = DOM.lat1 - (py + 0.5) / h * (DOM.lat1 - DOM.lat0), fy = clamp((lat - DOM.lat0) / deg, 0, nyu - 1.0001), y0 = fy | 0, ty = fy - y0;
    for (px = 0; px < w; px++) {
      var x0 = X0[px], tx = TX[px], o = (py * w + px) * 4, rgb = null, alpha = 0, k, v;
      if (view === 't2m') {
        v = bil(g.t2, x0, tx, y0, ty);
        rgb = TLUT[tIdx(v)]; alpha = 240;
      } else if (view === 'dew') {
        if (g.dw) { v = bil(g.dw, x0, tx, y0, ty); rgb = DLUT[dIdx(v)]; alpha = 240; }
      } else if (view === 'wind') {
        if (g.u) { v = Math.hypot(bil(g.u, x0, tx, y0, ty), bil(g.v, x0, tx, y0, ty)); k = band(v, WIND_T); if (k >= 0) { rgb = WIND_RGB[k]; alpha = 240; } }
      } else if (view === 'apcpn') {
        v = bil(g.acc, x0, tx, y0, ty); k = band(v, ACC_T);
        if (k >= 0) { rgb = ACC_RGB[k]; alpha = 235; }
      } else if (view === 'asnow') {
        v = bil(snowField, x0, tx, y0, ty); k = band(v, SNOW_T);
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
  return img;
}

// ---------------------------------------------------------------- fixed layers (drawn once per map size)
var layers = { key: '', base: null, top: null };
function proj(lon, lat, W, H) { return [(lon - DOM.lon0) / (DOM.lon1 - DOM.lon0) * W, (DOM.lat1 - lat) / (DOM.lat1 - DOM.lat0) * H]; }
function ensureLayers(W, H) {
  var dpr = dprNow(), key = W + 'x' + H + '@' + dpr;
  if (layers.key === key) return;
  function make() { var c = document.createElement('canvas'); c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); var x = c.getContext('2d'); x.setTransform(dpr, 0, 0, dpr, 0, 0); return [c, x]; }
  var b = make(), t = make();
  geoLines(b[1], W, H); cities(t[1], W, H);
  layers = { key: key, base: b[0], top: t[0] };
}
function drawLines(ctx, lines, W, H) {
  ctx.beginPath();
  lines.forEach(function (l) {
    for (var i = 0; i < l.length; i += 2) { var p = proj(l[i], l[i + 1], W, H); if (i === 0) ctx.moveTo(p[0], p[1]); else ctx.lineTo(p[0], p[1]); }
  });
  ctx.stroke();
}
function geoLines(ctx, W, H) {
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (GEO.counties) { ctx.strokeStyle = 'rgba(95,105,118,.45)'; ctx.lineWidth = 0.5; drawLines(ctx, GEO.counties, W, H); }
  ctx.strokeStyle = 'rgba(30,38,48,.55)'; ctx.lineWidth = 0.8; drawLines(ctx, GEO.states, W, H);
  ctx.strokeStyle = 'rgba(15,20,28,.75)'; ctx.lineWidth = 1.1; drawLines(ctx, GEO.border, W, H);
  ctx.strokeStyle = 'rgba(15,20,28,.85)'; ctx.lineWidth = 1; drawLines(ctx, GEO.coast, W, H);
}
function halo(ctx, text, x, y) {
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.lineJoin = 'round'; ctx.strokeText(text, x, y); ctx.fillText(text, x, y);
}
function cities(ctx, W, H) {
  ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  CITIES.forEach(function (c) {
    var p = proj(c[2], c[1], W, H); if (p[0] < 6 || p[0] > W - 40 || p[1] < 6 || p[1] > H - 6) return;
    ctx.fillStyle = 'rgba(15,20,28,.9)'; ctx.beginPath(); ctx.arc(p[0], p[1], 1.8, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#18202b'; halo(ctx, c[0], p[0] + 4, p[1]);
  });
  var h = proj(HOME.lon, HOME.lat, W, H);
  ctx.fillStyle = '#ffd84d'; ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(h[0], h[1], 5, 0, 6.3); ctx.fill(); ctx.stroke();
  ctx.font = '700 11px -apple-system, system-ui, sans-serif'; ctx.fillStyle = '#9a5a00'; ctx.textAlign = 'right'; halo(ctx, 'Home', h[0] - 8, h[1] - 6); ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------- one map frame
function renderMap() {
  var cv = el('map'), wrap = el('map-wrap'), d = gridData;
  var W = Math.floor(wrap.getBoundingClientRect().width) || 340, H = Math.round(W / MAP_ASPECT);
  var ctx = sizeCanvas(cv, W, H);
  ensureLayers(W, H);
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, W, H);
  if (d && d.steps && d.steps.length) {
    var g = stepGrids(d, stepIdx);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(shadeFor(g, W, H), 0, 0, W, H);
    ctx.drawImage(layers.base, 0, 0, W, H);
    if (view === 't2m') {
      var f = freezeGeom(g, W, H);
      ctx.lineJoin = 'round'; ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 3.4; ctx.stroke(f);
      ctx.strokeStyle = '#0a2a6e'; ctx.lineWidth = 1.6; ctx.stroke(f);
    } else if (view === 'dew') {
      if (g.dw) drawPressure(ctx, g, W, H, { thick: false, labels: false, extremes: false });
      else noData(ctx, W, curModel().short + ' does not provide dewpoint');
    } else if (view === 'wind') {
      if (g.u) {
        drawPressure(ctx, g, W, H, { thick: false });
        var bg = barbGeom(g, W, H);
        ctx.save(); ctx.strokeStyle = '#161d26'; ctx.fillStyle = '#161d26'; ctx.lineWidth = 1.05; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.stroke(bg.line); ctx.fill(bg.fill); ctx.restore();
      } else noData(ctx, W, curModel().short + ' does not provide wind');
    } else if (view !== 'apcpn' && view !== 'asnow') {
      drawPressure(ctx, g, W, H, {});
    }
  } else {
    ctx.drawImage(layers.base, 0, 0, W, H);
    ctx.fillStyle = '#5d6b79'; ctx.font = '14px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(d ? 'No forecast steps available' : (/could not/i.test(gridNote) ? 'Forecast data unavailable' : 'Loading ' + curModel().short + ' data…'), W / 2, H / 2);
  }
  ctx.drawImage(layers.top, 0, 0, W, H);
  drawLegend(W);
  updateTimeUI();
}
function noData(ctx, W, msg) {
  ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(W / 2 - 140, 8, 280, 28);
  ctx.fillStyle = '#5d6b79'; ctx.font = '13px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(msg, W / 2, 22); ctx.textBaseline = 'alphabetic';
}
function drawPressure(ctx, g, W, H, opt) {
  if (opt.thick !== false && g.th) {
    var th = thicknessGeom(g, W, H);
    ctx.save(); ctx.lineJoin = 'round'; ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#2f6fd0'; ctx.lineWidth = 0.9; ctx.stroke(th.cold);
    ctx.strokeStyle = '#d42a2a'; ctx.stroke(th.warm);
    ctx.strokeStyle = '#1f5fd6'; ctx.lineWidth = 1.3; ctx.stroke(th.c540);
    ctx.restore();
  }
  var P = pressureGeom(g, W, H);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,.4)'; ctx.lineWidth = 2.2; ctx.stroke(P.iso);
  ctx.strokeStyle = 'rgba(0,0,0,.95)'; ctx.lineWidth = 0.9; ctx.stroke(P.iso);
  ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#111820';
  if (opt.labels !== false) P.labels.forEach(function (L) { ctx.save(); ctx.translate(L.x, L.y); ctx.rotate(L.ang); halo(ctx, L.text, 0, 0); ctx.restore(); });
  if (opt.extremes !== false) P.ext.forEach(function (e) {
    ctx.font = '800 22px -apple-system, system-ui, sans-serif'; ctx.fillStyle = e.type === 'L' ? '#d42a2a' : '#1f5fd6';
    halo(ctx, e.type, e.p[0], e.p[1]);
    ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.fillStyle = '#111820'; halo(ctx, String(Math.round(e.v)), e.p[0], e.p[1] + 14);
  });
  ctx.textBaseline = 'alphabetic';
}

// ---------------------------------------------------------------- legend (redrawn only when the view, width or theme changes)
var legendKey = '';
function isDark() { return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches); }
function drawLegend(W) {
  var key = view + '|' + W + '|' + dprNow() + '|' + isDark();
  if (key === legendKey) return; legendKey = key;
  var cv = el('legend'), frzn = view === 'mslp_pcpn_frzn', H = frzn ? 4 * 30 + 2 : 40;
  var ctx = sizeCanvas(cv, W, H); ctx.clearRect(0, 0, W, H);
  var css = getComputedStyle(document.documentElement), tc = css.getPropertyValue('--muted').trim() || '#667';
  ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
  var i;
  // rates are shaded on Tropical Tidbits' mm/hr break points but labelled in inches/hr
  function inHr(mm) { var v = mm / 25.4; return String(+(v < 0.01 ? v.toFixed(3) : v.toFixed(2))); }
  // equal-width color boxes like the Tropical Tidbits color bars; a label sits on a box's left edge (its lower limit)
  function bins(x0, bw, yy, thr, cols, wanted, fmtr) {
    var n = thr.length, cw = bw / n, k;
    for (k = 0; k < n; k++) { ctx.fillStyle = cols[k]; ctx.fillRect(x0 + k * cw, yy, cw + 0.6, 12); }
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.6; ctx.strokeRect(x0, yy, bw, 12);
    ctx.fillStyle = tc; var last = -1e9;
    for (k = 0; k < n; k++) {
      if (wanted && wanted.indexOf(thr[k]) < 0) continue;
      var lab = fmtr ? fmtr(thr[k]) : String(thr[k]), w = ctx.measureText(lab).width, cx = clamp(x0 + k * cw, x0 + w / 2, x0 + bw - w / 2);
      if (cx - w / 2 < last + 3) continue;
      ctx.fillText(lab, cx, yy + 23); ctx.fillRect(x0 + k * cw - 0.3, yy + 12, 0.6, 3); last = cx + w / 2;
    }
  }
  function ramp(lut, idx, lo, hi, step) {
    var bw = W - 8;
    for (i = 0; i < bw; i++) { var c = lut[idx(lo + (i / bw) * (hi - lo))]; ctx.fillStyle = 'rgb(' + c.map(Math.round).join(',') + ')'; ctx.fillRect(4 + i, 2, 1.5, 12); }
    ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.lineWidth = 0.6; ctx.strokeRect(4, 2, bw, 12);
    ctx.fillStyle = tc; for (var t = lo; t <= hi - (hi - lo) / 15; t += step) ctx.fillText(t + '°', clamp(4 + (t - lo) / (hi - lo) * bw, 12, W - 12), 27);
  }
  if (view === 't2m') { ramp(TLUT, tIdx, -40, 110, 20); return; }
  if (view === 'dew') { ramp(DLUT, dIdx, -40, 80, 20); return; }
  if (view === 'wind') { bins(4, W - 8, 2, WIND_T, WIND_C, [4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 46, 52, 60, 70, 80], function (kt) { return String(Math.round(kt * KT2MPH)); }); return; }
  if (view === 'apcpn') { bins(4, W - 8, 2, ACC_T, ACC_C, [0.01, 0.1, 0.3, 0.5, 1, 1.5, 2, 3, 4, 5, 6, 8, 10, 14, 20, 24]); return; }
  if (view === 'asnow') { bins(4, W - 8, 2, SNOW_T, SNOW_C, [0.1, 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48]); return; }
  if (!frzn) { bins(4, W - 8, 2, RATE_T, RATE_C, null, inHr); return; }
  var wr = [0.1, 0.5, 1.5, 2.5, 4, 6, 10, 16, 24], wf = [0.1, 0.5, 1, 2, 3, 4, 6, 10, 14]; // the same break points Tropical Tidbits labels
  var rows = [['Rain', RAIN_T, RAIN_C, wr], ['FrzR', FRZ_T, FRZR_C, wf], ['Sleet', FRZ_T, SLEET_C, wf], ['Snow', FRZ_T, SNOWR_C, wf]];
  rows.forEach(function (r, q) {
    ctx.fillStyle = tc; ctx.textAlign = 'left'; ctx.font = '600 10px -apple-system, system-ui, sans-serif'; ctx.fillText(r[0], 4, 2 + q * 30 + 10);
    ctx.font = '10px -apple-system, system-ui, sans-serif'; ctx.textAlign = 'center';
    bins(44, W - 48, 2 + q * 30, r[1], r[2], r[3], inHr);
  });
}

// ---------------------------------------------------------------- map controls
function updateTimeUI() {
  var d = gridData, sl = el('slider'), lab = el('time-label'), note = el('map-note'), sub = el('map-sub'), V = viewDef(view);
  sub.textContent = useKuch() ? V.subK : V.sub;
  el('snow-seg').hidden = view !== 'asnow';
  var msg = gridNote || kuchNote || '';
  if (d && d.steps && d.steps.length) {
    sl.max = d.steps.length - 1; sl.value = stepIdx; sl.disabled = false;
    var s = d.steps[stepIdx];
    lab.textContent = fmtDay(s.t) + '  ·  +' + Math.round(s.lead) + ' h';
    if (!msg) {
      var M = modelById(d.modelId);
      msg = M.short + (d.runInit ? ' ' + runText(d.runInit) : '') + ' via Open-Meteo · ' + d.spec.step + '° grid · ' +
        (gridCheckedAt ? 'checked ' + fmtClock(gridCheckedAt) : 'loaded ' + fmtClock(d.fetchedAt)) +
        (d.hasType ? '' : ' · rain/snow from snowfall amount') + ' · runs to +' + Math.round(d.steps[d.steps.length - 1].lead) + ' h';
    }
  } else { sl.disabled = true; lab.textContent = '—'; }
  note.textContent = msg; note.className = 'small ' + (/could not/i.test(msg) ? 'warn' : 'muted');
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
  playTimer = setInterval(function () { if (!gridData || !gridData.steps) return; setStep(stepIdx >= gridData.steps.length - 1 ? 0 : stepIdx + 1); }, clamp(+settings.playMs || 700, 250, 1500));
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
  var M = modelById(ttModelId) || MODELS[0], links = el('links'); links.innerHTML = '';
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
  gridData = null; gridNote = ''; kuchNote = ''; stepCache.clear(); clearFrames(); scheduleRender();
  el('map-note').textContent = 'Loading ' + curModel().short + '…'; el('map-note').className = 'small muted';
  await loadGrid({});
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
    b.addEventListener('click', function () { view = v.id; store.set('wx.view', view); buildTabs(); if (useKuch()) ensureKuchera(); scheduleRender(); });
    box.appendChild(b);
  });
}
function buildSnowSeg() {
  var box = el('snow-seg'); box.innerHTML = '';
  [['ten', '10:1 ratio'], ['kuchera', 'Kuchera ratio']].forEach(function (o) {
    var b = document.createElement('button'); b.type = 'button'; b.className = 'tab' + (settings.snowRatio === o[0] ? ' on' : ''); b.textContent = o[1];
    b.addEventListener('click', function () {
      if (settings.snowRatio === o[0]) return;
      settings.snowRatio = o[0]; store.set('wx.settings', settings); buildSnowSeg();
      if (useKuch()) ensureKuchera();
      scheduleRender();
    });
    box.appendChild(b);
  });
}
