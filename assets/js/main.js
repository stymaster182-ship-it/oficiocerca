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

  // Año
  document.querySelectorAll("[data-year]").forEach(function (n) { n.textContent = new Date().getFullYear(); });

  // WhatsApp: solo aparece cuando hay un número configurado en config.js
  if (cfg.WHATSAPP && /^\d{8,15}$/.test(cfg.WHATSAPP)) {
    var href = "https://wa.me/" + cfg.WHATSAPP + "?text=" + encodeURIComponent("Hola OficioCerca, quiero hacer una consulta.");
    document.querySelectorAll("[data-oc-wa]").forEach(function (a) { a.href = href; a.target = "_blank"; a.rel = "noopener"; });
    document.querySelectorAll("[data-oc-wa-footer]").forEach(function (li) { li.hidden = false; });
  }
})();
