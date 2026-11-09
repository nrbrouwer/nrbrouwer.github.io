/* Thermal field. The whole page is one black surface seen through a thermal
   camera: a grid of CELL px cells, coloured from the thermal ramp
   (--thermal-ramp, published from _sass/_thermal.scss) as they warm, from
   black through deep purple, indigo, blue, teal, green and red to magenta
   and hot pink.

   Two things warm it. The cursor leaves heat wherever it passes: TRACE_RATE
   per 16.7ms it covers a spot, so about half a second of hovering takes a
   spot to the top of the ramp (TRACE_MAX) and a quick pass leaves a faint
   mark; the heat cools to a third in TRACE_COOL seconds and leaks a little
   to its neighbours (TRACE_SPREAD) as it would, and a touch of directional
   light (TRACE_LIGHT) gives the warm spots a surface. And, with AMBIENT on,
   broad patches of warmth drift across the page on their own: a field of
   slow noise, black below FLOOR and rising to a core RANGE further up, that
   morphs in place and drifts right (DRIFT cells a second). How hot the
   patches get follows the site's 180s wall-clock cycle, TOP_COLD of the way
   up the ramp at its cold end and TOP_HOT at its hot end, so they deepen
   from indigo and blue toward teal and green and back. Nothing goes above
   CAP, which keeps white type readable over any of it.

   The field is drawn into two canvases this script creates: one fixed
   behind the page, and one in the fixed masthead showing the same cells
   (the masthead covers the page, so it needs its own copy to look
   transparent). The grid is recomputed at FIELD_HZ, so the picture steps
   like a sensor's rather than flowing. Reduced motion: a still frame, no
   cursor heat. */
(function () {
  var CELL = 4, FIELD_HZ = 12, COARSE = 4;
  var TRACE_R = 6, TRACE_RATE = 0.04, TRACE_MAX = 1.3;
  var TRACE_COOL = 25, TRACE_SPREAD = 0.05, TRACE_LIGHT = 0.15, SLOPE = 6;
  var CAP = 1;
  var AMBIENT = true, NOISE_SCALE = 70, MORPH = 10.4, DRIFT = 2.5;
  var FLOOR = 0.5, RANGE = 0.3, TOP_COLD = 0.3, TOP_HOT = 0.6;

  if (!window.requestAnimationFrame || !window.Float32Array ||
      !document.createElement('canvas').getContext) { return; }

  var still = window.matchMedia &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var touch = window.matchMedia &&
              window.matchMedia('(pointer: coarse)').matches;

  /* The ramp, as a table of 256 colours over heat. */
  var lut = (function () {
    var raw = getComputedStyle(document.documentElement)
                .getPropertyValue('--thermal-ramp').replace(/["']/g, '');
    var stops = [], parts = raw.split(','), i, m;
    for (i = 0; i < parts.length; i++) {
      m = /([\d.]+)\s+#([0-9a-f]{6})/i.exec(parts[i]);
      if (m) {
        stops.push([parseFloat(m[1]), parseInt(m[2].slice(0, 2), 16),
                    parseInt(m[2].slice(2, 4), 16), parseInt(m[2].slice(4, 6), 16)]);
      }
    }
    if (stops.length < 2) {
      stops = [[0, 5, 5, 20], [0.4, 28, 70, 184], [0.8, 156, 29, 42], [1, 255, 90, 168]];
    }
    var table = new Uint8ClampedArray(256 * 3), t, s, a, b, f, c;
    for (i = 0; i < 256; i++) {
      t = i / 255;
      for (s = 1; s < stops.length - 1 && t > stops[s][0]; s++) {}
      a = stops[s - 1]; b = stops[s];
      f = (t - a[0]) / (b[0] - a[0]);
      if (f < 0) { f = 0; } else if (f > 1) { f = 1; }
      for (c = 0; c < 3; c++) { table[i * 3 + c] = a[c + 1] + (b[c + 1] - a[c + 1]) * f; }
    }
    return table;
  })();

  /* How far through its cycle the clock is, 0 (cold) to 1 (hot): a 180s
     rise and a 180s fall on the wall clock, so it carries across pages. */
  function clockNow(t) {
    if (still) { return 0; }
    var ph = (t / 1000) % 360;
    return ph < 180 ? ph / 180 : 2 - ph / 180;
  }

  /* 3-D value noise on a seeded lattice: the field is the same on every
     page and only the wall clock moves it. */
  var LAT = 32, lat = new Float32Array(LAT * LAT * LAT);
  var seed = 2463534242, li;
  for (li = 0; li < lat.length; li++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    lat[li] = (seed >>> 0) / 4294967296;
  }
  function latAt(i, j, k) {
    return lat[(((i & 31) * LAT) + (j & 31)) * LAT + (k & 31)];
  }
  function noise3(x, y, z) {
    var xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    var fx = x - xi, fy = y - yi, fz = z - zi;
    fx = fx * fx * (3 - 2 * fx);
    fy = fy * fy * (3 - 2 * fy);
    fz = fz * fz * (3 - 2 * fz);
    var a = latAt(xi, yi, zi), b = latAt(xi + 1, yi, zi);
    var c = latAt(xi, yi + 1, zi), d = latAt(xi + 1, yi + 1, zi);
    var e = latAt(xi, yi, zi + 1), f = latAt(xi + 1, yi, zi + 1);
    var g = latAt(xi, yi + 1, zi + 1), h = latAt(xi + 1, yi + 1, zi + 1);
    var ab = a + (b - a) * fx, cd = c + (d - c) * fx;
    var ef = e + (f - e) * fx, gh = g + (h - g) * fx;
    var lo = ab + (cd - ab) * fy, hi = ef + (gh - ef) * fy;
    return lo + (hi - lo) * fz;
  }
  function fbm(x, y, z) {
    return noise3(x, y, z) * 0.8 +
           noise3(x * 2.1 + 3.1, y * 2.1 + 7.7, z * 1.5 + 2.1) * 0.2;
  }

  function layer(parent, cls) {
    var c = document.createElement('canvas');
    c.className = 'thermal-field ' + cls;
    c.setAttribute('aria-hidden', 'true');
    parent.insertBefore(c, parent.firstChild);
    return c;
  }
  var mastEl = document.querySelector('.masthead');
  var page = layer(document.body, 'thermal-field--page');
  var mast = mastEl ? layer(mastEl, 'thermal-field--masthead') : null;
  var pctx = page.getContext('2d'), mctx = mast ? mast.getContext('2d') : null;

  /* cw x ch cells cover the viewport. The noise is sampled on a grid
     COARSE cells apart (gw x gh points) and interpolated between, which is
     indistinguishable at this scale and a sixteenth of the work. trace is
     the cursor's heat and scratch its working copy. */
  var cw = 0, ch = 0, gw = 0, gh = 0, img = null;
  var coarse = null, trace = null, scratch = null;
  var traced = false, blank = false, last = -1e9;
  var LX = -0.45, LY = -0.55, LZ = 0.7;
  var LL = Math.sqrt(LX * LX + LY * LY + LZ * LZ);
  LX /= LL; LY /= LL; LZ /= LL;

  function size() {
    var w = window.innerWidth, h = window.innerHeight;
    /* phones: the viewport grows when the browser's bars slide away;
       cover the whole screen so no gap opens before the resize arrives */
    if (touch && window.screen && screen.height > h) { h = screen.height; }
    var nw = Math.ceil(w / CELL), nh = Math.ceil(h / CELL);
    /* a hidden tab can report no size at all; try again next frame */
    if (!nw || !nh) { return; }
    if (nw !== cw || nh !== ch) {
      cw = nw; ch = nh;
      gw = Math.ceil(cw / COARSE) + 2; gh = Math.ceil(ch / COARSE) + 2;
      page.width = cw; page.height = ch;
      page.style.width = cw * CELL + 'px';
      page.style.height = ch * CELL + 'px';
      img = pctx.createImageData(cw, ch);
      coarse = new Float32Array(gw * gh);
      trace = new Float32Array(cw * ch);
      scratch = new Float32Array(cw * ch);
      traced = false; blank = false;
    }
    if (mast) {
      var mw = Math.ceil(mastEl.offsetWidth / CELL);
      var mh = Math.ceil(mastEl.offsetHeight / CELL);
      if (mast.width !== mw || mast.height !== mh) {
        mast.width = mw; mast.height = mh;
        mast.style.width = mw * CELL + 'px';
        mast.style.height = mh * CELL + 'px';
        blank = false;
      }
      /* trimmed to the masthead exactly */
      mast.style.clipPath = 'inset(0 ' + (mw * CELL - mastEl.offsetWidth) + 'px ' +
                            (mh * CELL - mastEl.offsetHeight) + 'px 0)';
    }
    last = -1e9;
  }

  /* The cursor's warmth: a gaussian into the trace grid, scaled to the
     time the event covers, capped at TRACE_MAX. The canvas is pinned at
     the viewport's origin, so client coordinates are canvas coordinates. */
  function warm(x, y, scale) {
    if (!trace) { return; }
    var cx = x / CELL, cy = y / CELL, s2 = 2 * TRACE_R * TRACE_R;
    var i0 = Math.max(0, Math.floor(cx - 2 * TRACE_R));
    var i1 = Math.min(cw - 1, Math.ceil(cx + 2 * TRACE_R));
    var j0 = Math.max(0, Math.floor(cy - 2 * TRACE_R));
    var j1 = Math.min(ch - 1, Math.ceil(cy + 2 * TRACE_R));
    var amt = TRACE_RATE * scale, i, j, dx, dy, v;
    for (j = j0; j <= j1; j++) {
      for (i = i0; i <= i1; i++) {
        dx = i + 0.5 - cx; dy = j + 0.5 - cy;
        v = trace[j * cw + i] + amt * Math.exp(-(dx * dx + dy * dy) / s2);
        if (v > TRACE_MAX) { v = TRACE_MAX; }
        trace[j * cw + i] = v;
      }
    }
    traced = true;
  }

  /* Cool every cell by the same factor and let a little heat leak to its
     four neighbours; once it has all but gone, stop tracking it. */
  function coolTrace() {
    var cool = Math.exp(-Math.log(3) / (TRACE_COOL * FIELD_HZ));
    var x, y, q, hc, peak = 0, swap;
    for (y = 0, q = 0; y < ch; y++) {
      for (x = 0; x < cw; x++, q++) {
        hc = trace[q];
        hc = (hc + TRACE_SPREAD * ((trace[x > 0 ? q - 1 : q] + trace[x < cw - 1 ? q + 1 : q] +
              trace[y > 0 ? q - cw : q] + trace[y < ch - 1 ? q + cw : q]) * 0.25 - hc)) * cool;
        scratch[q] = hc;
        if (hc > peak) { peak = hc; }
      }
    }
    swap = trace; trace = scratch; scratch = swap;
    if (peak < 0.004) {
      for (q = 0; q < trace.length; q++) { trace[q] = 0; }
      traced = false;
    }
  }

  function render(t) {
    if (!img) { return; }
    var d = img.data, p = 0;
    var x, y, row, ju, jd, il, ir, gx, gy, x0, y0, fx, fy, r0, r1, a, b, h, k, nl, ndl, shade;
    /* nothing warm anywhere: paint black once and wait */
    if (!traced && !AMBIENT) {
      if (!blank) {
        for (p = 0; p < d.length; p += 4) { d[p] = lut[0]; d[p + 1] = lut[1]; d[p + 2] = lut[2]; d[p + 3] = 255; }
        pctx.putImageData(img, 0, 0);
        if (mctx) { mctx.putImageData(img, 0, 0); }
        blank = true;
      }
      return;
    }
    blank = false;
    var sec = t / 1000, top = TOP_COLD + (TOP_HOT - TOP_COLD) * clockNow(t);
    if (AMBIENT) {
      var z = sec / MORPH, dx = sec * DRIFT;
      for (gy = 0; gy < gh; gy++) {
        for (gx = 0; gx < gw; gx++) {
          coarse[gy * gw + gx] = fbm((gx * COARSE - dx) / NOISE_SCALE,
                                     gy * COARSE / NOISE_SCALE, z);
        }
      }
    }
    if (traced) { coolTrace(); }
    var lit = traced && TRACE_LIGHT > 0;
    for (y = 0; y < ch; y++) {
      row = y * cw;
      ju = (y > 0 ? y - 1 : y) * cw;
      jd = (y < ch - 1 ? y + 1 : y) * cw;
      gy = y / COARSE; y0 = gy | 0; fy = gy - y0;
      r0 = y0 * gw; r1 = r0 + gw;
      for (x = 0; x < cw; x++) {
        h = traced ? trace[row + x] / TRACE_MAX : 0;
        if (AMBIENT) {
          gx = x / COARSE; x0 = gx | 0; fx = gx - x0;
          a = coarse[r0 + x0]; a += (coarse[r0 + x0 + 1] - a) * fx;
          b = coarse[r1 + x0]; b += (coarse[r1 + x0 + 1] - b) * fx;
          a = (a + (b - a) * fy - FLOOR) / RANGE;
          if (a < 0) { a = 0; } else if (a > 1) { a = 1; }
          h += a * a * (3 - 2 * a) * top;
        }
        if (h > CAP) { h = CAP; }
        k = Math.round(h * 255);
        if (k > 255) { k = 255; }
        shade = 1;
        if (lit) {
          il = x > 0 ? x - 1 : x; ir = x < cw - 1 ? x + 1 : x;
          gx = (trace[row + ir] - trace[row + il]) * SLOPE;
          gy = (trace[jd + x] - trace[ju + x]) * SLOPE;
          nl = Math.sqrt(gx * gx + gy * gy + 1);
          ndl = (LZ - gx * LX - gy * LY) / nl;
          if (ndl < 0) { ndl = 0; }
          shade = (1 - TRACE_LIGHT) + TRACE_LIGHT * ndl / LZ;
        }
        d[p++] = lut[k * 3] * shade;
        d[p++] = lut[k * 3 + 1] * shade;
        d[p++] = lut[k * 3 + 2] * shade;
        d[p++] = 255;
      }
    }
    pctx.putImageData(img, 0, 0);
    if (mctx) { mctx.putImageData(img, 0, 0); }
  }

  function frame() {
    var t = Date.now();
    if (!img) { size(); }
    if (img && t - last >= 1000 / FIELD_HZ) { render(t); last = t; }
    requestAnimationFrame(frame);
  }

  size();
  render(Date.now());
  last = Date.now();
  document.documentElement.classList.add('thermal-field-on');
  window.addEventListener('resize', function () {
    size();
    if (still) { render(Date.now()); }
  });
  if (!still) {
    requestAnimationFrame(frame);
    /* heat is laid down per mouse event, scaled to the time the event
       covers, so a quick flick lands in full even when frames are slow */
    var pmt = 0, havePrev = false;
    window.addEventListener('mousemove', function (e) {
      var t = e.timeStamp;
      warm(e.clientX, e.clientY, (havePrev && t - pmt < 120) ? (t - pmt) / 16.7 : 1);
      pmt = t; havePrev = true;
    }, { passive: true });
  }
})();
