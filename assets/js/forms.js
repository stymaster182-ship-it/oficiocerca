/* OficioCerca — formularios: validación, fotos, envío al backend (Google Apps Script). */
(function () {
  "use strict";
  var cfg = window.OC_CONFIG || {};
  var MAX_PHOTOS = cfg.MAX_PHOTOS || 5;
  var params = new URLSearchParams(location.search);

  // Guardar origen (utm, referrer) para medir de dónde llegan las solicitudes
  var origin = { ref: document.referrer || "", utm_source: params.get("utm_source") || "", utm_medium: params.get("utm_medium") || "", utm_campaign: params.get("utm_campaign") || "" };
  try {
    var saved = JSON.parse(sessionStorage.getItem("oc_origin") || "null");
    if (saved && !origin.utm_source) origin = saved; else sessionStorage.setItem("oc_origin", JSON.stringify(origin));
  } catch (e) {}

  document.querySelectorAll("form[data-oc-form]").forEach(setupForm);

  function setupForm(form) {
    var kind = form.getAttribute("data-oc-form");
    var card = form.parentElement;
    var success = card.querySelector("[data-success]");
    var statusBox = form.querySelector("[data-status]");
    var submitBtn = form.querySelector("button[type=submit]");
    var photos = [];

    // ---- Prefill desde la URL (?tipo=empresa&oficio=electricidad&ciudad=cordoba)
    var tipo = params.get("tipo");
    if (tipo && form.elements.tipoSolicitante) {
      var val = tipo === "empresa" ? "Empresa / Contratista" : tipo === "particular" ? "Particular" : "";
      Array.prototype.forEach.call(form.querySelectorAll("input[name=tipoSolicitante]"), function (r) { if (r.value === val) r.checked = true; });
    }
    setSelect(form.elements.oficio, params.get("oficio"));
    setSelect(form.elements.ciudad, params.get("ciudad"));

    // ---- Campos condicionales
    var condFields = form.querySelectorAll("[data-show-if]");
    function updateConditions() {
      condFields.forEach(function (f) {
        var rule = f.getAttribute("data-show-if").split("="), show = getValue(form, rule[0]) === rule[1];
        f.classList.toggle("cond-hidden", !show);
      });
    }
    form.addEventListener("change", updateConditions); updateConditions();

    // ---- Contador de caracteres
    form.querySelectorAll("[data-count]").forEach(function (c) {
      var t = document.getElementById(c.getAttribute("data-count"));
      var upd = function () { c.textContent = t.value.length; };
      t.addEventListener("input", upd); upd();
    });

    // ---- Limpiar errores al corregir
    form.addEventListener("input", function (e) { clearError(e.target); });
    form.addEventListener("change", function (e) { clearError(e.target); });

    // ---- Fotos
    var photoInput = form.querySelector("[data-photo-input]");
    if (photoInput) {
      var list = form.querySelector("[data-photo-list]"), msg = form.querySelector("[data-photo-msg]");
      photoInput.addEventListener("change", function () {
        var files = Array.prototype.slice.call(photoInput.files || []);
        photoInput.value = "";
        var room = MAX_PHOTOS - photos.length;
        if (files.length > room) msg.textContent = "Máximo " + MAX_PHOTOS + " fotos. Se han añadido las primeras " + Math.max(room, 0) + ".";
        else msg.textContent = "";
        files.slice(0, Math.max(room, 0)).forEach(function (file) {
          if (!/^image\//.test(file.type) && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)) { msg.textContent = "«" + file.name + "» no es una imagen."; return; }
          if (file.size > 25 * 1024 * 1024) { msg.textContent = "«" + file.name + "» pesa demasiado (máx. 25 MB)."; return; }
          var item = { name: file.name, data: null, pending: true };
          photos.push(item); renderPhotos();
          compress(file).then(function (dataUrl) { item.data = dataUrl; item.pending = false; renderPhotos(); })
            .catch(function () { photos.splice(photos.indexOf(item), 1); msg.textContent = "No se pudo leer «" + file.name + "». Prueba con una foto JPG o PNG."; renderPhotos(); });
        });
      });
      function renderPhotos() {
        list.innerHTML = "";
        photos.forEach(function (p, i) {
          var d = document.createElement("div"); d.className = "thumb";
          if (p.data) { var img = document.createElement("img"); img.src = p.data; img.alt = "Foto " + (i + 1) + " del trabajo"; d.appendChild(img); }
          var b = document.createElement("button"); b.type = "button"; b.setAttribute("aria-label", "Quitar foto " + (i + 1));
          b.innerHTML = window.ocIcon ? window.ocIcon("x", "") : "×";
          b.addEventListener("click", function () { photos.splice(i, 1); renderPhotos(); });
          d.appendChild(b); list.appendChild(d);
        });
        var label = form.querySelector("label[for='" + photoInput.id + "']");
        if (label) label.style.display = photos.length >= MAX_PHOTOS ? "none" : "";
      }
    }

    // ---- Envío
    var sending = false;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (sending) return;
      hideStatus();
      var firstBad = validate(form);
      if (firstBad) { firstBad.focus({ preventScroll: false }); firstBad.scrollIntoView({ block: "center", behavior: "smooth" }); showStatus("error", "Revisa los campos marcados en rojo."); return; }
      if (photos.some(function (p) { return p.pending; })) { showStatus("info", "Estamos preparando las fotos, espera un segundo y vuelve a enviar."); return; }
      if (form.elements.web && form.elements.web.value) return; // trampa anti-spam

      if (!cfg.ENDPOINT) {
        showStatus("info", "El formulario todavía no está conectado a nuestra base de datos, así que esta solicitud NO se ha enviado. Estamos terminando la puesta en marcha del piloto.");
        return;
      }

      var payload = collect(form, kind);
      payload.fotos = photos.map(function (p, i) { return { name: "foto-" + (i + 1) + ".jpg", data: p.data.split(",")[1] }; });
      setSending(true);
      var ctrl = "AbortController" in window ? new AbortController() : null;
      var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, 90000);
      fetch(cfg.ENDPOINT, { method: "POST", headers: { "Content-Type": "text/plain;charset=utf-8" }, body: JSON.stringify(payload), redirect: "follow", signal: ctrl ? ctrl.signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          clearTimeout(timer);
          if (!res || !res.ok || !res.code) throw new Error((res && res.error) || "respuesta inválida");
          form.hidden = true;
          success.querySelector("[data-code]").textContent = res.code;
          success.classList.add("show");
          window.scrollTo(0, Math.max(0, card.getBoundingClientRect().top + window.scrollY - 90));
          success.focus({ preventScroll: true });
        })
        .catch(function () {
          clearTimeout(timer);
          setSending(false);
          showStatus("error", "No hemos podido enviar la solicitud. Comprueba tu conexión e inténtalo de nuevo en unos minutos. Tus datos siguen en el formulario.");
        });
    });

    function setSending(on) {
      sending = on;
      submitBtn.disabled = on;
      submitBtn.classList.toggle("loading", on);
      var l = submitBtn.querySelector("[data-btn-label]");
      if (on) { l.setAttribute("data-orig", l.textContent); l.textContent = photos.length ? "Enviando solicitud y fotos…" : "Enviando…"; }
      else if (l.getAttribute("data-orig")) l.textContent = l.getAttribute("data-orig");
    }
    function showStatus(type, text) { statusBox.className = "form-status show " + type; statusBox.textContent = text; }
    function hideStatus() { statusBox.className = "form-status"; statusBox.textContent = ""; }
  }

  // ------------------------------------------------------------ helpers
  function setSelect(sel, v) {
    if (!sel || !v || !sel.options) return;
    for (var i = 0; i < sel.options.length; i++) if (sel.options[i].value === v && !sel.options[i].disabled) { sel.value = v; return; }
  }
  function getValue(form, name) {
    var el = form.elements[name];
    if (!el) return "";
    if (el instanceof RadioNodeList || (el.length && !el.tagName)) { for (var i = 0; i < el.length; i++) if (el[i].checked) return el[i].value; return ""; }
    return el.value;
  }
  function cleanPhone(v) { return (v || "").replace(/[\s\-.()]/g, ""); }
  function phoneOk(v) {
    v = cleanPhone(v);
    if (/^\+\d{8,15}$/.test(v) || /^00\d{8,15}$/.test(v)) return true;
    return /^[6789]\d{8}$/.test(v);
  }
  function markInvalid(container) { container.classList.add("invalid"); }
  function clearError(el) {
    var c = el.closest(".field, .choice-group, .consent");
    if (c) c.classList.remove("invalid");
    var f = el.form && el.form.querySelector("[data-status].error");
    if (f && !el.form.querySelector(".invalid")) { f.className = "form-status"; }
  }
  function validate(form) {
    var first = null;
    function bad(el, container) { markInvalid(container); if (!first) first = el; }
    form.querySelectorAll(".invalid").forEach(function (n) { n.classList.remove("invalid"); });

    form.querySelectorAll("[data-required-group]").forEach(function (g) {
      var name = g.getAttribute("data-required-group");
      if (!getValue(form, name)) bad(g.querySelector("input"), g);
    });
    form.querySelectorAll("input, select, textarea").forEach(function (el) {
      if (el.type === "radio" || el.type === "file" || el.name === "web") return;
      var field = el.closest(".field, .consent");
      if (!field || field.classList.contains("cond-hidden")) return;
      var v = (el.value || "").trim();
      if (el.type === "checkbox") { if (el.required && !el.checked) bad(el, field); return; }
      var reqIf = el.getAttribute("data-required-if");
      var required = el.required || (reqIf && getValue(form, reqIf.split("=")[0]) === reqIf.split("=")[1]);
      if (required && !v) return bad(el, field);
      if (!v) return;
      if (el.hasAttribute("data-phone") || el.hasAttribute("data-phone-optional")) { if (!phoneOk(v)) bad(el, field); return; }
      if (el.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return bad(el, field);
      if (el.pattern && !new RegExp("^(?:" + el.pattern + ")$").test(v)) return bad(el, field);
      if (el.minLength > 0 && v.length < el.minLength) return bad(el, field);
    });
    return first;
  }
  function collect(form, kind) {
    var data = { tipo: kind, enviadoEn: new Date().toISOString(), pagina: location.pathname, origen: origin, ua: navigator.userAgent.slice(0, 180) };
    var fd = new FormData(form);
    fd.forEach(function (v, k) { if (k !== "web") data[k] = typeof v === "string" ? v.trim() : v; });
    // En selects de oficio/ciudad guardamos el nombre legible (no el código interno)
    form.querySelectorAll("select").forEach(function (sel) { if (sel.name && data[sel.name] && sel.value !== "") data[sel.name] = sel.options[sel.selectedIndex].text.replace(/ \(próximamente\)$/, ""); });
    ["whatsapp", "telefonoAlt", "telefono"].forEach(function (k) { if (data[k]) data[k] = cleanPhone(data[k]); });
    form.querySelectorAll("[data-show-if].cond-hidden input, [data-show-if].cond-hidden select").forEach(function (el) { delete data[el.name]; });
    return data;
  }
  function compress(file) {
    var maxSide = cfg.PHOTO_MAX_SIDE || 1600, q = cfg.PHOTO_QUALITY || 0.78;
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var w = img.naturalWidth, h = img.naturalHeight, s = Math.min(1, maxSide / Math.max(w, h));
        var c = document.createElement("canvas"); c.width = Math.round(w * s); c.height = Math.round(h * s);
        var ctx = c.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", q));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("decode")); };
      img.src = url;
    });
  }
})();
