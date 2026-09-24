(function () {
  "use strict";

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function $all(sel, root) {
    return [].slice.call((root || document).querySelectorAll(sel));
  }

  function tween(dur, write, done) {
    var t0 = null;
    requestAnimationFrame(function step(now) {
      if (t0 === null) t0 = now;
      var k = Math.min((now - t0) / dur, 1);
      write(1 - Math.pow(1 - k, 3));
      if (k < 1) requestAnimationFrame(step); else done();
    });
  }

  function initEnter() {
    requestAnimationFrame(function () {
      document.documentElement.classList.add("is-loaded");
    });
  }

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

  function initNavScroll() {
    var nav = document.getElementById("nav");
    if (!nav) return;
    var on = false;
    var SHUT = 96, OPEN = 32;
    function check() {
      var y = window.scrollY;
      var next = on ? y > OPEN : y > SHUT;
      if (next === on) return;
      on = next;
      nav.classList.toggle("is-stuck", on);
      document.documentElement.classList.toggle("nav-stuck", on);
    }
    check();
    window.addEventListener("scroll", check, { passive: true });
  }

  function initMenu() {
    var burger = document.getElementById("nav-burger");
    var menu = document.getElementById("mobile-menu");
    if (!burger || !menu) return;

    var openLabel = burger.getAttribute("aria-label") || "";
    var closeLabel = burger.getAttribute("data-label-close") || openLabel;
    var parked = 0;

    function close() {
      if (!menu.classList.contains("open")) return;
      menu.classList.remove("open");
      burger.classList.remove("open");
      burger.setAttribute("aria-expanded", "false");
      burger.setAttribute("aria-label", openLabel);
      document.body.classList.remove("menu-open");
      document.body.style.top = "";
      window.scrollTo(0, parked);
    }
    function open() {
      parked = window.scrollY;
      menu.classList.add("open");
      burger.classList.add("open");
      burger.setAttribute("aria-expanded", "true");
      burger.setAttribute("aria-label", closeLabel);
      document.body.style.top = -parked + "px";
      document.body.classList.add("menu-open");
    }

    burger.addEventListener("click", function () {
      if (menu.classList.contains("open")) close(); else open();
    });
    $all("a", menu).forEach(function (a) {
      a.addEventListener("click", function (e) {
        var href = a.getAttribute("href") || "";
        if (href.charAt(0) === "#" && href.length > 1) {
          var target = document.querySelector(href);
          if (target) {
            e.preventDefault();
            close();
            requestAnimationFrame(function () {
              target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
            });
            return;
          }
        }
        close();
      });
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") close(); });
    window.addEventListener("resize", function () { if (window.innerWidth > 1000) close(); });
  }

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
    initCountUp();
    initForm();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
