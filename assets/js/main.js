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

  // Ayuda contextual por WhatsApp (soporte humano). Sin botón flotante ni enlace global:
  // solo los botones [data-wa-msg] de cada proceso, cada uno con su propio mensaje.
  // El número sale únicamente de OC_CONFIG.WHATSAPP_SUPPORT; si falta, esos botones no se muestran.
  var WA = String(cfg.WHATSAPP_SUPPORT || "").replace(/\D/g, "");
  document.querySelectorAll("a[data-wa-msg]").forEach(function (a) {
    if (a.id === "wa-seg") return; // el portal de seguimiento lo gestiona su propia página (añade el código OC)
    if (!/^\d{8,15}$/.test(WA)) return;
    a.href = "https://wa.me/" + WA + "?text=" + encodeURIComponent(a.getAttribute("data-wa-msg"));
    var item = a.closest("[data-wa-item]"); if (item) item.hidden = false;
  });

  // Huecos para vídeos futuros (data-video-slot): solo aparecen cuando OC_VIDEOS tiene un archivo o URL.
  var VID = window.OC_VIDEOS || {};
  document.querySelectorAll("[data-video-slot]").forEach(function (slot) {
    var src = String(VID[slot.getAttribute("data-video-slot")] || "").trim();
    if (!src) return;
    var titulo = (slot.querySelector("figcaption") || {}).textContent || "Vídeo de OficioCerca";
    var media = slot.querySelector(".video-slot-media"), yt = src.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{11})/);
    var el;
    if (yt) {
      el = document.createElement("iframe");
      el.src = "https://www.youtube-nocookie.com/embed/" + yt[1];
      el.setAttribute("allow", "encrypted-media; picture-in-picture; fullscreen"); el.setAttribute("allowfullscreen", "");
      el.setAttribute("loading", "lazy"); el.title = titulo;
    } else if (/^(\/|https:\/\/)[^\s"'<>]+\.(mp4|webm)(\?.*)?$/i.test(src)) {
      el = document.createElement("video");
      el.controls = true; el.preload = "none"; el.setAttribute("playsinline", ""); el.src = src; el.setAttribute("aria-label", titulo);
    } else return;
    media.appendChild(el); slot.hidden = false;
  });

  // Vídeos (tutoriales e institucional): modal dentro de la misma página (no se toca ningún formulario).
  // El MP4 y su portada no se descargan hasta que la persona pulsa el botón. Al cerrar, el vídeo se pausa.
  var dialogos = {};
  document.querySelectorAll("[data-video-open]").forEach(function (btn) {
    var id = btn.getAttribute("data-video-open"), dlg = document.getElementById(id);
    if (!dlg) return;
    var video = dlg.querySelector("video");
    if (!dialogos[id]) {
      dialogos[id] = true;
      var cerrar = function () { if (video) video.pause(); if (dlg.open) dlg.close(); };
      dlg.querySelectorAll("[data-video-close]").forEach(function (b) { b.addEventListener("click", cerrar); });
      dlg.addEventListener("click", function (ev) { if (ev.target === dlg) cerrar(); }); // clic fuera del recuadro
      dlg.addEventListener("close", function () {
        if (video) video.pause();
        document.documentElement.classList.remove("modal-abierto");
        if (dlg._opener) dlg._opener.focus({ preventScroll: true });
      });
    }
    btn.addEventListener("click", function () {
      if (video && !video.getAttribute("src")) {
        var tr = video.querySelector("track[data-src]");
        if (tr) tr.setAttribute("src", tr.getAttribute("data-src"));
        if (video.getAttribute("data-poster")) video.setAttribute("poster", video.getAttribute("data-poster"));
        video.setAttribute("preload", "metadata");
        video.setAttribute("src", video.getAttribute("data-src"));
      }
      dlg._opener = btn;
      if (typeof dlg.showModal === "function") dlg.showModal(); else dlg.setAttribute("open", "");
      document.documentElement.classList.add("modal-abierto");
      var x = dlg.querySelector(".vmodal-x"); if (x) x.focus();
    });
  });
})();
