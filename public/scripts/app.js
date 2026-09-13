/* ============ Eddy Classroom — landing interactions ============
   Vanilla ES5, no build step, no dependencies. Everything here is either a
   state indicator or a one-shot entrance; nothing loops except the four
   hero badges and the two pulse dots, which are CSS.

   One init per concern, wired up in boot() at the bottom, and the library
   band — the only concern with several moving parts — is itself split the
   same way: the comb solver, the segmented control, the pointer field and
   the row-by-row assembly each get a function of their own. The two things
   every init shares, the reduced-motion answer and the query helper, are
   read once up here so no init carries its own copy.                    */
(function () {
  "use strict";

  /* Read once. The OS setting does not change under a page in any way that
     matters here, and one answer keeps every init on the same side of it. */
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $all(sel, root) {
    return [].slice.call((root || document).querySelectorAll(sel));
  }

  /* Cubic ease-out, driven off requestAnimationFrame: `write` gets the eased
     0..1 every frame, `done` runs once at the end. Both count-ups on the
     page use this one loop; each used to carry a copy of it. */
  function tween(dur, write, done) {
    var t0 = null;
    requestAnimationFrame(function step(now) {
      if (t0 === null) t0 = now;
      var k = Math.min((now - t0) / dur, 1);
      write(1 - Math.pow(1 - k, 3));
      if (k < 1) requestAnimationFrame(step); else done();
    });
  }

  /* ---------- hero entrance ---------- */
  function initEnter() {
    requestAnimationFrame(function () {
      document.documentElement.classList.add("is-loaded");
    });
  }

  /* ---------- scroll reveal ---------- */
  function initReveal() {
    var els = $all(".reveal");
    if (!els.length) return;
    if (reduce || !("IntersectionObserver" in window)) {
      els.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        e.target.classList.add("is-visible");
        io.unobserve(e.target);
      });
    }, { threshold: 0.18, rootMargin: "0px 0px -12% 0px" });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- sticky nav shadow ---------- */
  function initNavScroll() {
    var nav = document.getElementById("nav");
    if (!nav) return;
    var on = false;
    // Two thresholds, not one. With a single value, any scroll that hovers
    // around it flips the state on every wheel notch and the header rattles;
    // the gap means the close has to be committed to before it plays, and
    // undone properly before it reopens.
    var SHUT = 96, OPEN = 32;
    function check() {
      var y = window.scrollY;
      var next = on ? y > OPEN : y > SHUT;
      if (next === on) return;
      on = next;
      nav.classList.toggle("is-stuck", on);
      // the hero's coloured light is bound to the same beat
      document.documentElement.classList.toggle("nav-stuck", on);
    }
    check();
    window.addEventListener("scroll", check, { passive: true });
  }

  /* ---------- mobile menu ---------- */
  function initMenu() {
    var burger = document.getElementById("nav-burger");
    var menu = document.getElementById("mobile-menu");
    if (!burger || !menu) return;

    function close() {
      menu.classList.remove("open");
      burger.classList.remove("open");
      burger.setAttribute("aria-expanded", "false");
      document.body.style.overflow = "";
    }
    function open() {
      menu.classList.add("open");
      burger.classList.add("open");
      burger.setAttribute("aria-expanded", "true");
    }

    burger.addEventListener("click", function () {
      if (menu.classList.contains("open")) close(); else open();
    });
    $all("a", menu).forEach(function (a) {
      a.addEventListener("click", close);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    window.addEventListener("resize", function () { if (window.innerWidth > 960) close(); });
  }

  /* ---------- library: segmented control ----------
     The white pill is one absolutely-positioned element that physically
     slides between options — the same control the app uses for its own
     filters, which is the strongest "same product" cue on the page.

     The options are ARIA tabs, so they behave like tabs from the keyboard:
     one Tab stop for the whole control, arrows to move between subjects,
     and moving is choosing (automatic activation — there is no panel to
     load, the filter is instant). `onPick` is the filter itself.         */
  function initSegTabs(seg, opts, onPick) {
    var pill = seg.querySelector(".seg-pill");
    // the panel every tab controls, so its label can follow the selection
    var panel = document.getElementById(opts[0].getAttribute("aria-controls") || "");

    function movePill(btn, animate) {
      if (!pill) return;
      if (!animate) pill.style.transition = "none";
      pill.style.width = btn.offsetWidth + "px";
      pill.style.transform = "translateX(" + (btn.offsetLeft - seg.clientLeft - 4) + "px)";
      if (!animate) {
        // force reflow so the suppressed transition does not leak
        void pill.offsetWidth;
        pill.style.transition = "";
      }
    }

    function active() {
      return seg.querySelector(".seg-opt.is-active") || opts[0];
    }

    function select(btn, focus) {
      opts.forEach(function (o) {
        var on = o === btn;
        o.classList.toggle("is-active", on);
        o.setAttribute("aria-selected", on ? "true" : "false");
        o.setAttribute("tabindex", on ? "0" : "-1");
      });
      if (panel && btn.id) panel.setAttribute("aria-labelledby", btn.id);
      if (focus) btn.focus();
      movePill(btn, true);
      onPick(btn.dataset.subject);
    }

    opts.forEach(function (btn, i) {
      btn.setAttribute("tabindex", btn.classList.contains("is-active") ? "0" : "-1");
      btn.addEventListener("click", function () { select(btn, false); });
      btn.addEventListener("keydown", function (e) {
        var to = -1;
        if (e.key === "ArrowRight") to = (i + 1) % opts.length;
        else if (e.key === "ArrowLeft") to = (i - 1 + opts.length) % opts.length;
        else if (e.key === "Home") to = 0;
        else if (e.key === "End") to = opts.length - 1;
        if (to < 0) return;
        e.preventDefault();
        select(opts[to], true);
      });
    });

    /* Re-seat the pill without animating: on load, after a resize, and
       once the web font has swapped in — Ukrainian subject labels reflow
       when Manrope replaces the fallback face. */
    function reposition() { movePill(active(), false); }
    reposition();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(reposition);

    return { reposition: reposition };
  }

  /* ---------- library: the pointer field ----------
     Every cell inside the radius drifts away from the cursor, hardest
     right next to it and fading to nothing at the edge, so moving across
     the comb feels like pushing something with a little weight rather
     than lighting up one tile at a time. Centres are read from layout
     offsets, never from getBoundingClientRect: a rect already includes
     the transform this handler wrote last frame, and feeding that back
     in makes the cells drift away on their own.                          */
  function initCursorField(grid, tiles) {
    if (reduce || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var raf = 0, mx = 0, my = 0;

    function rest() {
      tiles.forEach(function (t) {
        t.style.setProperty("--px", "0px");
        t.style.setProperty("--py", "0px");
      });
    }

    function push() {
      raf = 0;
      var box = grid.getBoundingClientRect();
      for (var i = 0; i < tiles.length; i++) {
        var t = tiles[i];
        if (t.classList.contains("is-hidden")) continue;
        var w = t.offsetWidth;
        if (!w) continue;
        var dx = box.left + t.offsetLeft + w / 2 - mx;
        var dy = box.top + t.offsetTop + t.offsetHeight / 2 - my;
        var d = Math.sqrt(dx * dx + dy * dy) || 1;
        var r = w * 1.7;
        if (d > r) {
          if (t.style.getPropertyValue("--px") !== "0px") {
            t.style.setProperty("--px", "0px");
            t.style.setProperty("--py", "0px");
          }
          continue;
        }
        // squared falloff: the two or three nearest cells carry the move
        var f = 1 - d / r;
        var k = f * f * (w * .028);
        t.style.setProperty("--px", (dx / d * k).toFixed(2) + "px");
        t.style.setProperty("--py", (dy / d * k).toFixed(2) + "px");
      }
    }

    grid.addEventListener("pointermove", function (e) {
      mx = e.clientX; my = e.clientY;
      if (!raf) raf = requestAnimationFrame(push);
    });
    grid.addEventListener("pointerleave", function () {
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      rest();
    });
  }

  /* ---------- library: assembling the comb, a row at a time ----------
     A row arrives when the scroll reaches it, not when the band does: all
     eight at once is one event the reader has already scrolled past by the
     time it finishes. Within a row the middle cell lands first and the
     flanks close in, and which side a cell comes from is read off the
     finished layout — the comb is 3/3/2 on a desktop and 2/1/2/1/2 on a
     phone, and the subject filter reshuffles it again.

     Cells are grouped by offsetTop rather than by index for the same
     reason: an indented row holds a different number of cells depending
     on the breakpoint, so index arithmetic would split rows in half.

     Returns the row builder so the resize handler can re-derive the rows;
     returns nothing at all when the cells will not be hidden — nothing is
     hidden unless we are certain we can show it again.                   */
  function initAssembly(grid, tiles) {
    if (reduce || !("IntersectionObserver" in window)) return null;

    function buildRows() {
      var cx = grid.clientWidth / 2;
      var byTop = {}, keys = [];
      tiles.forEach(function (t) {
        if (t.classList.contains("is-hidden")) return;
        var key = Math.round(t.offsetTop / 8) * 8;
        if (!byTop[key]) { byTop[key] = []; keys.push(key); }
        byTop[key].push(t);
      });
      keys.sort(function (p, q) { return p - q; });
      keys.forEach(function (key) {
        var row = byTop[key];
        var far = 1;
        row.forEach(function (t) {
          far = Math.max(far, Math.abs(t.offsetLeft + t.offsetWidth / 2 - cx));
        });
        row.slice().sort(function (p, q) {
          return Math.abs(p.offsetLeft + p.offsetWidth / 2 - cx)
               - Math.abs(q.offsetLeft + q.offsetWidth / 2 - cx);
        }).forEach(function (t, i) {
          var dx = t.offsetLeft + t.offsetWidth / 2 - cx;
          var k = Math.abs(dx) / far;
          var dir = dx < 0 ? -1 : 1;
          t.style.setProperty("--fly-x", Math.round(dir * (130 + 140 * k)) + "px");
          t.style.setProperty("--fly-y", Math.round(10 + 10 * k) + "px");
          t.style.setProperty("--fly-r", (dir * (6 + 8 * k)).toFixed(1) + "deg");
          t.style.setProperty("--fly-d", i * 95 + "ms");
          t.flyRow = row;
        });
      });
    }

    grid.classList.add("is-staged");
    buildRows();
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        // arm the whole row together, or a wide row half-fills itself
        var row = e.target.flyRow || [e.target];
        row.forEach(function (t) {
          t.classList.add("is-in");
          io.unobserve(t);
        });
      });
    }, { threshold: 0.34, rootMargin: "0px 0px -6% 0px" });
    tiles.forEach(function (t) { io.observe(t); });

    return buildRows;
  }

  /* ---------- library: the band ----------
     Owns the one piece of state the parts share — which subject is showing
     — and the comb solver that depends on it. Everything else is wired in
     from the three inits above.                                          */
  function initLibrary() {
    var seg = document.getElementById("lib-tabs");
    var grid = document.getElementById("lib-grid");
    if (!seg || !grid) return;

    var opts = $all(".seg-opt", seg);
    var tiles = $all(".hex", grid);
    var current = "all";
    if (!opts.length) return;

    /* The honeycomb nests in CSS, but which cell STARTS a row is a runtime
       fact: it changes when a subject is filtered out, and again when the
       breakpoint drops the comb from three cells per row to two. So the
       half-cell indent of every other row is (re)applied here, off the list
       of cells that are about to be visible — not off the DOM order, which
       still contains the hidden ones. */
    function comb() {
      var cs = getComputedStyle(grid);
      var cols = parseInt(cs.getPropertyValue("--hex-cols"), 10) || 3;
      /* A row is `cols` cells wide and the offset row starts half a cell in,
         so the track is (cols + .5) cells plus (cols - .5) gaps. Solving that
         for the cell width is the only way the comb reliably fits every
         viewport: a vw-based cell overflows the wrap on narrow screens, and
         flex-wrap answers by putting one hexagon per row. */
      var gap = parseFloat(cs.columnGap) || 12;
      /* clientWidth includes the wrap's own padding, which is 16px a side on
         a phone — enough to make the offset row one cell too wide and drop
         its last cell onto a line of its own */
      var host = grid.parentElement, avail;
      if (host) {
        var hcs = getComputedStyle(host);
        avail = host.clientWidth - parseFloat(hcs.paddingLeft) - parseFloat(hcs.paddingRight);
      } else {
        avail = grid.clientWidth;
      }
      if (avail > 0) {
        // -2px covers the 1px of slack the track adds plus any rounding
        var w = (avail - 2 - (cols - .5) * gap) / (cols + .5);
        grid.style.setProperty("--hex-w", Math.max(112, Math.min(236, Math.floor(w))) + "px");
      }
      var shown = tiles.filter(function (t) {
        return current === "all" || t.dataset.subject === current;
      });
      tiles.forEach(function (t) { t.classList.remove("is-shift"); });
      /* The track is `cols` cells plus a half, so an indented row still
         holds a full `cols` and eight cells run 3 / 3 / 2. Only the first
         cell of an indented row carries the indent. */
      for (var i = 0; i < shown.length; i += cols) {
        if ((i / cols) % 2) shown[i].classList.add("is-shift");
      }
      // one short row looks abandoned at the left edge of the track
      grid.classList.toggle("is-short", shown.length <= cols);
    }

    function filter(subject) {
      current = subject;
      comb();
      tiles.forEach(function (tile, i) {
        var show = subject === "all" || tile.dataset.subject === subject;
        if (reduce) {
          tile.classList.toggle("is-hidden", !show);
          tile.classList.remove("is-out");
          return;
        }
        if (show) {
          tile.classList.remove("is-hidden");
          setTimeout(function () { tile.classList.remove("is-out"); }, 20 + (i % 8) * 30);
        } else {
          tile.classList.add("is-out");
          setTimeout(function () {
            if (tile.classList.contains("is-out")) tile.classList.add("is-hidden");
          }, 200);
        }
      });
    }

    var tabs = initSegTabs(seg, opts, filter);
    comb();
    // after comb(): the rows are read off the solved layout
    var rebuildRows = initAssembly(grid, tiles);
    initCursorField(grid, tiles);

    var tid;
    window.addEventListener("resize", function () {
      clearTimeout(tid);
      tid = setTimeout(function () {
        tabs.reposition();
        comb();
        // the breakpoint may have changed 3/3/2 into 2/1/2/1/2; cells that
        // have not arrived yet need their side and delay re-derived
        if (rebuildRows) rebuildRows();
      }, 120);
    });
  }

  /* ---------- count-up on numerals ---------- */
  function initCountUp() {
    var els = $all("[data-countup]");
    if (!els.length || reduce || !("IntersectionObserver" in window)) return;

    function run(el) {
      var raw = el.textContent;
      var nums = raw.match(/\d+/g);
      if (!nums) return;
      var targets = nums.map(Number);
      tween(1000, function (e) {
        var i = 0;
        el.textContent = raw.replace(/\d+/g, function () {
          return String(Math.round(targets[i++] * e));
        });
      }, function () { el.textContent = raw; });
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        run(e.target);
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });
  }

  /* ---------- hero roster ticks up once ---------- */
  function initRoster() {
    var el = document.getElementById("roster-count");
    if (!el) return;
    var final = el.textContent;
    var parts = final.split("/");
    if (parts.length !== 2) return;
    var to = parseInt(parts[0], 10);
    var of = parts[1];
    if (reduce || isNaN(to)) return;
    var from = Math.max(0, to - 4);
    el.textContent = from + "/" + of;
    setTimeout(function () {
      tween(900, function (e) {
        el.textContent = Math.round(from + (to - from) * e) + "/" + of;
      }, function () { el.textContent = final; });
    }, 1200);
  }

  /* ---------- lead form ---------- */
  function initForm() {
    var f = document.getElementById("demo-form");
    if (!f) return;
    var btn = f.querySelector('[type="submit"]');
    var hint = f.querySelector(".form-hint");
    var ok = document.querySelector(".form-ok");

    var submitText = f.dataset.submit || "Send";
    var sendingText = f.dataset.sending || "Sending…";
    var errorText = f.dataset.error || submitText;
    var errorHint = f.dataset.errorHint || "";

    f.addEventListener("submit", function (e) {
      e.preventDefault();
      btn.disabled = true;
      btn.textContent = sendingText;
      if (hint) hint.textContent = "";

      fetch("/send.php", { method: "POST", body: new FormData(f) })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          if (!data || !data.ok) throw new Error("rejected");
          f.style.display = "none";
          if (ok) ok.classList.add("show");
        })
        .catch(function () {
          btn.disabled = false;
          btn.textContent = errorText;
          if (hint) hint.textContent = errorHint;
        });
    });
  }

  function boot() {
    initEnter();
    initReveal();
    initNavScroll();
    initMenu();
    initLibrary();
    initCountUp();
    initRoster();
    initForm();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
