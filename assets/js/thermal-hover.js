/* Thermal hover. The pill buttons, the papers page's abstract toggles and
   the nav type heat up the longer the cursor rests on them, the way the
   ribbon does under the cursor (see _includes/sidebar.html), and cool back
   down after it leaves.

   Each element carries one heat value, 0 to 1. Hovering it (or focusing it
   from the keyboard) adds heat at a steady rate, so HEAT_TIME seconds of
   hovering takes it from cold to full. Away from it, it cools, losing two
   thirds of its heat every COOL_TIME seconds; coming back picks up from
   wherever it had cooled to.

   The heat is drawn as rings around the element's centre, coloured from the
   bloom ramp (--bloom-ramp, published from _sass/_thermal.scss): the centre
   sits at the element's heat on the ramp and the edge at EDGE of it, so as
   the heat rises the hot core spreads outward from the middle.

   The script hands the picture to CSS as two custom properties on the
   element, --heat-fill (the gradient) and --heat-alpha (its opacity, which
   rises over the first FADE of heat so the fill eases in rather than
   appearing as a solid black pill), and gives the element the class is-warm
   while the fill is opaque enough to carry white type. The html element gets
   the class heat-hover once the script is running; without it, the CSS falls
   back to the plain hover bloom. */
(function () {
  var SELECTOR = '.btn, .paper__disclosure > summary, .greedy-nav a';
  var HEAT_TIME = 2.5, COOL_TIME = 1.2, EDGE = 0.45, FADE = 0.08;
  var WARM = 0.5, RINGS = 8, STILL_HEAT = 0.75;

  if (!window.requestAnimationFrame || !document.documentElement.classList ||
      !Element.prototype.closest) { return; }

  var still = window.matchMedia &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* The ramp, as a table of 256 colours over heat. */
  var lut = (function () {
    var raw = getComputedStyle(document.documentElement)
                .getPropertyValue('--bloom-ramp').replace(/["']/g, '');
    var stops = [], parts = raw.split(','), i, m, hex;
    for (i = 0; i < parts.length; i++) {
      m = /([\d.]+)\s+#([0-9a-f]{3,6})/i.exec(parts[i]);
      if (!m) { continue; }
      hex = m[2];
      if (hex.length === 3) {
        hex = hex.charAt(0) + hex.charAt(0) + hex.charAt(1) + hex.charAt(1) +
              hex.charAt(2) + hex.charAt(2);
      }
      stops.push([parseFloat(m[1]), parseInt(hex.slice(0, 2), 16),
                  parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)]);
    }
    if (stops.length < 2) {
      stops = [[0, 5, 5, 20], [0.5, 28, 70, 184], [1, 255, 90, 168]];
    }
    var table = [], t, s, a, b, f;
    for (i = 0; i < 256; i++) {
      t = i / 255;
      for (s = 1; s < stops.length - 1 && t > stops[s][0]; s++) {}
      a = stops[s - 1]; b = stops[s];
      f = (t - a[0]) / (b[0] - a[0]);
      if (f < 0) { f = 0; } else if (f > 1) { f = 1; }
      table.push('rgb(' + Math.round(a[1] + (b[1] - a[1]) * f) + ',' +
                 Math.round(a[2] + (b[2] - a[2]) * f) + ',' +
                 Math.round(a[3] + (b[3] - a[3]) * f) + ')');
    }
    return table;
  })();

  /* The rings for heat h: RINGS stops from the centre (r = 0) to the edge
     of the ellipse (r = 1), each at h scaled down by r squared toward EDGE. */
  function gradient(h) {
    var stops = [], i, r, k;
    for (i = 0; i < RINGS; i++) {
      r = i / (RINGS - 1);
      k = Math.round(h * (1 - (1 - EDGE) * r * r) * 255);
      if (k < 0) { k = 0; } else if (k > 255) { k = 255; }
      stops.push(lut[k] + ' ' + Math.round(r * 100) + '%');
    }
    return 'radial-gradient(ellipse closest-side, ' + stops.join(', ') + ')';
  }

  function paint(el, h) {
    var a = h / FADE;
    if (a > 1) { a = 1; }
    el.style.setProperty('--heat-fill', gradient(h));
    el.style.setProperty('--heat-alpha', a.toFixed(3));
    if (a >= WARM) { el.classList.add('is-warm'); }
    else { el.classList.remove('is-warm'); }
  }

  function clear(el) {
    el.style.removeProperty('--heat-fill');
    el.style.removeProperty('--heat-alpha');
    el.classList.remove('is-warm');
  }

  /* Elements with any heat, and the loop that heats and cools them; it
     runs only while one of them is warm or hovered. */
  var active = [], running = false, last = 0;

  /* dt is capped so a long gap (a background tab, where frames stop) does
     not land as one jump; a slow device's 100-200ms frames still count in
     full, so heating takes HEAT_TIME there too. */
  function tick(now) {
    var dt = (now - last) / 1000, i, el, s;
    last = now;
    if (dt > 0.25) { dt = 0.25; }
    var cool = Math.exp(-Math.log(3) * dt / COOL_TIME);
    for (i = active.length - 1; i >= 0; i--) {
      el = active[i]; s = el.__heat;
      if (s.on) {
        s.h += dt / HEAT_TIME;
        if (s.h > 1) { s.h = 1; }
      } else {
        s.h *= cool;
        if (s.h < 0.004) {
          clear(el); el.__heat = null; active.splice(i, 1);
          continue;
        }
      }
      if (Math.abs(s.h - s.drawn) > 0.002) { paint(el, s.h); s.drawn = s.h; }
    }
    if (active.length) { requestAnimationFrame(tick); }
    else { running = false; }
  }

  function heat(el, on) {
    if (still) {
      if (on) { paint(el, STILL_HEAT); } else { clear(el); }
      return;
    }
    var s = el.__heat;
    if (!s) {
      if (!on) { return; }
      s = el.__heat = { h: 0, on: true, drawn: -1 };
      active.push(el);
    }
    s.on = on;
    if (!running) {
      running = true;
      last = performance.now();
      requestAnimationFrame(tick);
    }
  }

  function owner(node) {
    return (node && node.closest) ? node.closest(SELECTOR) : null;
  }

  document.addEventListener('mouseover', function (e) {
    var el = owner(e.target);
    if (el) { heat(el, true); }
  });
  document.addEventListener('mouseout', function (e) {
    var el = owner(e.target);
    if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) { heat(el, false); }
  });

  /* Keyboard focus heats too; focus left behind by a click does not, or a
     clicked toggle would keep heating after the cursor had gone. */
  document.addEventListener('focusin', function (e) {
    var el = owner(e.target), visible = false;
    if (!el) { return; }
    try { visible = el.matches(':focus-visible'); } catch (err) { visible = false; }
    if (visible) { heat(el, true); }
  });
  document.addEventListener('focusout', function (e) {
    var el = owner(e.target);
    if (el && !el.matches(':hover')) { heat(el, false); }
  });

  document.documentElement.classList.add('heat-hover');
})();
