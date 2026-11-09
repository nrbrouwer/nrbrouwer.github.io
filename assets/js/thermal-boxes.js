/* Dashed boxes. The site's one piece of chrome: a thin white dashed
   rectangle, DASH px dashes with GAP px between, THICK px wide, always PAD
   px out from the type it frames. It appears in two ways.

   Drawn on hover (and on keyboard focus) round the controls, HOVER: the
   buttons, the abstract toggles on the papers page and the nav links. The
   box draws itself from the top-left corner clockwise over DRAW seconds and
   stops when it closes; it goes when the cursor leaves. One SVG overlay
   pinned to the viewport holds it, so it can sit round anything.

   Standing, round the sidebar's list of links and the page title and
   section headings (STATIC_LIST and STATIC_HEADINGS), as an SVG inside the
   element, so it moves with it. The stylesheet gives those elements the
   room: PAD px of padding above and below the type, a little more at the
   sides (see .page__title and .page__content h2 in _page.scss, .archive h2
   in _archive.scss and .author__urls in _sidebar.scss).

   The box is measured from the element's content box (its padding taken
   off, and the trailing letter-space of spaced capitals), so the gap to
   the type is the same on every side of every box. The dash spacing is
   stretched a little per box so a whole number of dashes goes round and
   every corner starts on a dash. Coordinates land on whole pixels so the
   lines stay crisp. */
(function () {
  var PAD = 8, DASH = 12, GAP = 8, THICK = 2, DRAW = 1.5;
  var HOVER = '.btn, .paper__disclosure > summary, .greedy-nav .visible-links a';
  var STATIC_HEADINGS = '.page__title, .archive h2, .page__content h2';
  var STATIC_LIST = '.author__urls-wrapper';

  if (!document.createElementNS || !window.requestAnimationFrame ||
      !Element.prototype.closest || !window.getComputedStyle) { return; }

  var NS = 'http://www.w3.org/2000/svg';

  function num(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }

  function dashes(P) {
    var n = Math.max(4, Math.round(P / (DASH + GAP)));
    return DASH + ' ' + (P / n - DASH);
  }

  /* The type's own box, in viewport coordinates. */
  function content(el) {
    var r = el.getBoundingClientRect(), c = getComputedStyle(el);
    return {
      left: r.left + num(c.paddingLeft) + num(c.borderLeftWidth),
      top: r.top + num(c.paddingTop) + num(c.borderTopWidth),
      right: r.right - num(c.paddingRight) - num(c.borderRightWidth) - num(c.letterSpacing),
      bottom: r.bottom - num(c.paddingBottom) - num(c.borderBottomWidth)
    };
  }

  function union(els) {
    var u = null, i, c;
    for (i = 0; i < els.length; i++) {
      c = content(els[i]);
      if (!u) { u = c; continue; }
      if (c.left < u.left) { u.left = c.left; }
      if (c.top < u.top) { u.top = c.top; }
      if (c.right > u.right) { u.right = c.right; }
      if (c.bottom > u.bottom) { u.bottom = c.bottom; }
    }
    return u;
  }

  /* Sets path to the box round rect, PAD out, in a space whose origin is
     (ox, oy); returns the perimeter. */
  function setPath(path, rect, ox, oy) {
    var half = (THICK % 2) ? 0.5 : 0;
    var x0 = Math.round(rect.left - PAD - ox) + half, y0 = Math.round(rect.top - PAD - oy) + half;
    var x1 = Math.round(rect.right + PAD - ox) - half, y1 = Math.round(rect.bottom + PAD - oy) - half;
    var P = 2 * ((x1 - x0) + (y1 - y0));
    path.setAttribute('d', 'M' + x0 + ' ' + y0 + 'H' + x1 + 'V' + y1 + 'H' + x0 + 'Z');
    path.setAttribute('stroke-dasharray', dashes(P));
    return P;
  }

  function makePath() {
    var p = document.createElementNS(NS, 'path');
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', '#fff');
    p.setAttribute('stroke-width', THICK);
    if (THICK % 2) { p.setAttribute('shape-rendering', 'crispEdges'); }
    return p;
  }

  /*
     Standing boxes
     ========================================================================== */

  /* An SVG the size of el, inside it, holding one box. */
  function standing(el, rect) {
    var svg = el.querySelector(':scope > svg.dashed-box');
    if (!svg) {
      svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('class', 'dashed-box');
      svg.setAttribute('aria-hidden', 'true');
      svg.appendChild(makePath());
      el.appendChild(svg);
    }
    var r = el.getBoundingClientRect();
    svg.style.width = r.width + 'px';
    svg.style.height = r.height + 'px';
    svg.setAttribute('viewBox', '0 0 ' + r.width + ' ' + r.height);
    setPath(svg.firstChild, rect, r.left, r.top);
  }

  function statics() {
    var heads = document.querySelectorAll(STATIC_HEADINGS), i, wrap, links, svg;
    for (i = 0; i < heads.length; i++) { standing(heads[i], content(heads[i])); }
    wrap = document.querySelector(STATIC_LIST);
    if (wrap) {
      links = wrap.querySelectorAll('.author__urls li > a');
      /* only once the list is laid out as a column (on narrow screens it is
         a pop-up behind a button, and gets no box) */
      if (links.length && getComputedStyle(links[0].parentNode.parentNode).position !== 'absolute') {
        standing(wrap, union(links));
      } else {
        svg = wrap.querySelector(':scope > svg.dashed-box');
        if (svg) { svg.remove(); }
      }
    }
  }

  /*
     The hover box
     ========================================================================== */

  var ov = document.createElementNS(NS, 'svg');
  ov.setAttribute('class', 'dashed-box dashed-box--hover');
  ov.setAttribute('aria-hidden', 'true');
  var defs = document.createElementNS(NS, 'defs');
  var mask = document.createElementNS(NS, 'mask');
  mask.setAttribute('id', 'dashed-box-reveal');
  mask.setAttribute('maskUnits', 'userSpaceOnUse');
  mask.setAttribute('x', '0'); mask.setAttribute('y', '0');
  mask.setAttribute('width', '100000'); mask.setAttribute('height', '100000');
  /* the reveal: a solid stroke along the same box, drawn on by its
     dash offset; the dashed box shows only where it has been */
  var reveal = document.createElementNS(NS, 'path');
  reveal.setAttribute('fill', 'none');
  reveal.setAttribute('stroke', '#fff');
  reveal.setAttribute('stroke-width', THICK * 4);
  mask.appendChild(reveal);
  defs.appendChild(mask);
  var box = makePath();
  box.setAttribute('mask', 'url(#dashed-box-reveal)');
  box.style.display = 'none';
  ov.appendChild(defs);
  ov.appendChild(box);
  document.body.appendChild(ov);

  var target = null, since = 0, raf = 0;

  function place() {
    raf = 0;
    if (!target) { box.style.display = 'none'; return; }
    var P = setPath(box, content(target), 0, 0);
    reveal.setAttribute('d', box.getAttribute('d'));
    reveal.setAttribute('stroke-dasharray', P + ' ' + P);
    reveal.setAttribute('stroke-dashoffset', P * (1 - Math.min(1, (performance.now() - since) / (DRAW * 1000))));
    box.style.display = '';
    raf = requestAnimationFrame(place);
  }

  function show(el) {
    if (el === target) { return; }
    target = el; since = performance.now();
    if (!raf) { raf = requestAnimationFrame(place); }
  }

  function hide(el) {
    if (el === target) { target = null; }
  }

  function owner(node) {
    return (node && node.closest) ? node.closest(HOVER) : null;
  }

  document.addEventListener('mouseover', function (e) {
    var el = owner(e.target);
    if (el) { show(el); }
  });
  document.addEventListener('mouseout', function (e) {
    var el = owner(e.target);
    if (el && !(e.relatedTarget && el.contains(e.relatedTarget))) { hide(el); }
  });
  /* keyboard focus draws it too; focus left behind by a click does not */
  document.addEventListener('focusin', function (e) {
    var el = owner(e.target), visible = false;
    if (!el) { return; }
    try { visible = el.matches(':focus-visible'); } catch (err) { visible = false; }
    if (visible) { show(el); }
  });
  document.addEventListener('focusout', function (e) {
    var el = owner(e.target);
    if (el && !el.matches(':hover')) { hide(el); }
  });

  /*
     Keeping the standing boxes in place
     ========================================================================== */

  statics();
  window.addEventListener('resize', statics);
  /* the type's width changes when the webfonts arrive */
  if (document.fonts && document.fonts.ready) { document.fonts.ready.then(statics); }
  window.addEventListener('load', statics);
})();
