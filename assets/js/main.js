/* OficioCerca — navegación y utilidades comunes. */
(function () {
  "use strict";
  var cfg = window.OC_CONFIG || {};

  // Cabecera con borde al hacer scroll
  var hdr = document.querySelector(".hdr");
  function onScroll() { if (hdr) hdr.classList.toggle("scrolled", window.scrollY > 8); }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();

  // Menú móvil
  var btn = document.querySelector(".menu-btn"), mnav = document.getElementById("mnav");
  if (btn && mnav) {
    btn.addEventListener("click", function () {
      var open = mnav.classList.toggle("open");
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      btn.setAttribute("aria-label", open ? "Cerrar menú" : "Abrir menú");
    });
    mnav.addEventListener("click", function (e) {
      if (e.target.closest("a")) { mnav.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && mnav.classList.contains("open")) { mnav.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); btn.focus(); }
    });
  }

  // Aparición suave de secciones (solo si html.js-motion; ver <head>)
  window.__ocReveal = true;
  if (document.documentElement.classList.contains("js-motion")) {
    var els = document.querySelectorAll("[data-reveal]");
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add("is-in"); io.unobserve(en.target); }
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.08 });
    els.forEach(function (el, i) {
      var sib = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
      el.style.transitionDelay = Math.min(sib, 5) * 60 + "ms";
      io.observe(el);
    });
  }

  // Año
  document.querySelectorAll("[data-year]").forEach(function (n) { n.textContent = new Date().getFullYear(); });

  // WhatsApp: no se muestra ningún enlace hasta que exista un número real en config.js
  if (cfg.WHATSAPP && /^\d{8,15}$/.test(cfg.WHATSAPP)) {
    var href = "https://wa.me/" + cfg.WHATSAPP + "?text=" + encodeURIComponent("Hola OficioCerca, quiero hacer una consulta.");
    document.querySelectorAll("[data-oc-contact]").forEach(function (ul) {
      var li = document.createElement("li"), a = document.createElement("a");
      a.href = href; a.target = "_blank"; a.rel = "noopener"; a.textContent = "WhatsApp";
      li.appendChild(a); ul.insertBefore(li, ul.children[1] || null);
    });
  }
})();
