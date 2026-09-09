/* ============ Eddy Classroom — landing interactions ============
   Vanilla, no dependencies. Everything here is either a state indicator
   or a one-shot entrance; nothing loops except the four hero badges and
   the two pulse dots, which are CSS.                                    */
(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- hero entrance ---------- */
  function initEnter() {
    requestAnimationFrame(function () {
      document.documentElement.classList.add("is-loaded");
    });
  }

  /* ---------- scroll reveal ---------- */
  function initReveal() {
    var els = [].slice.call(document.querySelectorAll(".reveal"));
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
    [].slice.call(menu.querySelectorAll("a")).forEach(function (a) {
      a.addEventListener("click", close);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    window.addEventListener("resize", function () { if (window.innerWidth > 960) close(); });
  }

  /* ---------- library: segmented control + tile filter ----------
     The white pill is one absolutely-positioned element that physically
     slides between options — the same control the app uses for its own
     filters, which is the strongest "same product" cue on the page.     */
  function initLibrary() {
    var seg = document.getElementById("lib-tabs");
    var grid = document.getElementById("lib-grid");
    if (!seg || !grid) return;

    var pill = seg.querySelector(".seg-pill");
    var opts = [].slice.call(seg.querySelectorAll(".seg-opt"));
    var tiles = [].slice.call(grid.querySelectorAll(".tile"));
    if (!opts.length) return;

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

    function filter(subject) {
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

    opts.forEach(function (btn) {
      btn.addEventListener("click", function () {
        opts.forEach(function (o) {
          o.classList.remove("is-active");
          o.setAttribute("aria-selected", "false");
        });
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");
        movePill(btn, true);
        filter(btn.dataset.subject);
      });
    });

    function reposition() {
      var active = seg.querySelector(".seg-opt.is-active") || opts[0];
      movePill(active, false);
    }

    reposition();
    // Ukrainian subject labels reflow once Inter swaps in
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(reposition);
    var tid;
    window.addEventListener("resize", function () {
      clearTimeout(tid);
      tid = setTimeout(reposition, 120);
    });
  }

  /* ---------- count-up on numerals ---------- */
  function initCountUp() {
    var els = [].slice.call(document.querySelectorAll("[data-countup]"));
    if (!els.length || reduce || !("IntersectionObserver" in window)) return;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        run(e.target);
      });
    }, { threshold: 0.4 });
    els.forEach(function (el) { io.observe(el); });

    function run(el) {
      var raw = el.textContent;
      var nums = raw.match(/\d+/g);
      if (!nums) return;
      var targets = nums.map(Number);
      var dur = 1000;
      var t0 = performance.now();
      function step(now) {
        var k = Math.min((now - t0) / dur, 1);
        var e = 1 - Math.pow(1 - k, 3);
        var i = 0;
        el.textContent = raw.replace(/\d+/g, function () {
          return String(Math.round(targets[i++] * e));
        });
        if (k < 1) requestAnimationFrame(step);
        else el.textContent = raw;
      }
      requestAnimationFrame(step);
    }
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
    var t0 = null;
    setTimeout(function () {
      requestAnimationFrame(function step(now) {
        if (t0 === null) t0 = now;
        var k = Math.min((now - t0) / 900, 1);
        var e = 1 - Math.pow(1 - k, 3);
        el.textContent = Math.round(from + (to - from) * e) + "/" + of;
        if (k < 1) requestAnimationFrame(step);
        else el.textContent = final;
      });
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
