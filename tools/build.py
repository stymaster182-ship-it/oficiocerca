#!/usr/bin/env python3
"""
OficioCerca — generador estático.

Genera los HTML del sitio a partir de assets/data/catalogo.json para que cabecera, pie,
oficios y ciudades estén en un único sitio. Sin dependencias: solo Python 3.

Uso:  python3 tools/build.py
Para crear páginas SEO tipo /cordoba/electricistas/ añade en catalogo.json:
  "paginasOficioCiudad": [{"ciudad": "cordoba", "oficio": "electricidad"}]
"""
import json, os, html
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CAT = json.loads((ROOT / "assets/data/catalogo.json").read_text(encoding="utf-8"))
OFICIOS, CIUDADES, TIPOS = CAT["oficios"], CAT["ciudades"], CAT["tiposTrabajo"]
SITE = "https://oficiocerca.pages.dev/"
VERSION = "6"
CONSENT_VERSION = "C3-2026-10"  # cambia este código si cambias el texto del consentimiento
PRO_COND_VERSION = "PRO-COND-2026-10-V1"  # versión de las condiciones para profesionales
CONTACT_EMAIL = "oficiocerca@gmail.com"
e = html.escape

ICONS = {}
for line in (ROOT / "assets/js/icons.js").read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if ":" in line and line.split(":")[0].isidentifier() and "'" in line:
        k = line.split(":")[0]
        ICONS[k] = line.split("'", 1)[1].rsplit("'", 1)[0]

def ico(name, cls="ico"):
    return (f'<svg class="{cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" '
            f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">{ICONS.get(name, ICONS["plus"])}</svg>')

LOGO = ('<svg class="brand-mark" viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" rx="10" fill="#13253D"/>'
        '<path d="M9 21.5 20 12.5l11 9" stroke="#DD6326" stroke-width="3.4" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
        '<circle cx="20" cy="25.5" r="4.2" fill="#fff"/></svg>')

def ciudad_activa():
    return next(c for c in CIUDADES if c["activa"])

# ---------------------------------------------------------------- layout
MOTION_JS = """<script>(function(d){try{if(window.matchMedia&&!matchMedia('(prefers-reduced-motion: reduce)').matches&&'IntersectionObserver' in window){d.classList.add('js-motion');setTimeout(function(){if(!window.__ocReveal){d.classList.remove('js-motion')}},2500)}}catch(e){}})(document.documentElement)</script>"""

def head(title, desc, path, p, noindex=False, jsonld=None):
    url = SITE + path
    robots = '<meta name="robots" content="noindex,follow">' if noindex else ''
    ld = f'<script type="application/ld+json">{json.dumps(jsonld, ensure_ascii=False)}</script>' if jsonld else ''
    return f"""<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<script>if(/\\.github\\.io$/.test(location.hostname)){{location.replace("https://oficiocerca.pages.dev"+location.pathname.replace(/^\\/oficiocerca/,"")+location.search+location.hash)}}</script>
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{e(title)}</title>
<meta name="description" content="{e(desc)}">
<link rel="canonical" href="{url}">
{robots}
<meta name="theme-color" content="#13253D">
<meta property="og:type" content="website">
<meta property="og:locale" content="es_ES">
<meta property="og:site_name" content="OficioCerca">
<meta property="og:title" content="{e(title)}">
<meta property="og:description" content="{e(desc)}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}assets/img/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="{p}favicon.svg" type="image/svg+xml">
<link rel="icon" href="{p}assets/img/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="{p}assets/img/apple-touch-icon.png">
<link rel="stylesheet" href="{p}assets/css/styles.css?v={VERSION}">
{MOTION_JS}
{ld}
</head>
<body>
<a class="skip" href="#main">Saltar al contenido</a>
"""

def header(p):
    nav = [("Inicio", f"{p}"), ("Cómo funciona", f"{p}#como-funciona"), ("Servicios", f"{p}#servicios"),
           ("Empresas", f"{p}solicitar/?tipo=empresa"), ("Para profesionales", f"{p}profesionales/"), ("Contacto", f"{p}#contacto")]
    links = "".join(f'<a href="{h}">{t}</a>' for t, h in nav)
    return f"""<header class="hdr" id="top">
  <div class="wrap">
    <a class="brand" href="{p}" aria-label="OficioCerca, inicio">{LOGO}<span class="brand-name">OFICIO<b>CERCA</b></span></a>
    <nav class="nav" aria-label="Principal">{links}</nav>
    <a class="btn btn-primary btn-sm hdr-cta" href="{p}solicitar/">Solicitar profesional</a>
    <button class="menu-btn" type="button" aria-expanded="false" aria-controls="mnav" aria-label="Abrir menú">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
    </button>
  </div>
  <nav class="mobile-nav" id="mnav" aria-label="Menú móvil">{links}<a class="btn btn-primary" href="{p}solicitar/">Solicitar profesional</a></nav>
</header>
"""

def footer(p, extra_js=""):
    c = ciudad_activa()
    return f"""<footer class="ftr" id="contacto">
  <div class="wrap">
    <div class="ftr-grid">
      <div>
        <a class="brand" href="{p}">{LOGO}<span class="brand-name">OFICIO<b>CERCA</b></span></a>
        <p style="margin-top:12px">Profesionales para obras, reformas y reparaciones.</p>
        <p>{e(c['nombre'])}, España — zona piloto.</p>
        <p>Correo: <a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a></p>
      </div>
      <div>
        <h2>Solicitar</h2>
        <ul>
          <li><a href="{p}solicitar/?tipo=empresa">Empresa o contratista</a></li>
          <li><a href="{p}solicitar/?tipo=particular">Particular</a></li>
          <li><a href="{p}{c['slug']}/">Oficios en {e(c['nombre'])}</a></li>
        </ul>
      </div>
      <div>
        <h2>Profesionales</h2>
        <ul>
          <li><a href="{p}profesionales/">Registro de profesionales</a></li>
          <li><a href="{p}condiciones-profesionales/">Condiciones para profesionales</a></li>
          <li><a href="{p}#como-funciona">Cómo funciona</a></li>
        </ul>
      </div>
      <div>
        <h2>Contacto</h2>
        <ul data-oc-contact>
          <li><a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a></li>
          <li><a href="{p}solicitar/">Formulario de solicitud</a></li>
          <li><a href="{p}privacidad/">Política de privacidad</a></li>
          <li><a href="{p}condiciones/">Condiciones de uso</a></li>
        </ul>
      </div>
    </div>
    <div class="ftr-bottom">
      <span>© <span data-year>2026</span> OficioCerca · Servicio en fase piloto.</span>
      <span>OficioCerca pone en contacto a clientes y profesionales independientes. No ejecuta obras ni cobra los trabajos.</span>
    </div>
  </div>
</footer>
<script src="{p}assets/js/config.js?v={VERSION}"></script>
<script src="{p}assets/js/icons.js?v={VERSION}"></script>
<script src="{p}assets/js/main.js?v={VERSION}" defer></script>
{extra_js}
</body>
</html>
"""

def write(path, content):
    f = ROOT / path
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(content, encoding="utf-8")
    print("  ", path)

# ---------------------------------------------------------------- pieces
def trades_grid(p, ciudad=None):
    """Servicios principales del piloto + tarjeta destacada «¿Necesitas otro servicio?»."""
    out = []
    for o in OFICIOS:
        if o["slug"] == "otro":
            continue
        q = f"?oficio={o['slug']}" + (f"&ciudad={ciudad}" if ciudad else "")
        out.append(f'<a class="trade" data-reveal href="{p}solicitar/{q}"><span class="trade-ico">{ico(o["icon"])}</span>'
                   f'<span class="trade-txt"><strong>{e(o["nombre"])}</strong><span>{e(o["desc"])}</span></span>'
                   f'<span class="trade-go" aria-hidden="true">{ico("arrow")}</span></a>')
    q = "?oficio=otro" + (f"&ciudad={ciudad}" if ciudad else "")
    out.append(f'<a class="trade trade-other" data-reveal href="{p}solicitar/{q}"><span class="trade-ico">{ico("plus")}</span>'
               f'<span class="trade-txt"><strong>¿Necesitas otro servicio?</strong>'
               f'<span>Cuéntanos qué trabajo necesitas y revisaremos si hay profesionales disponibles en Córdoba. Te contactaremos para informarte.</span></span>'
               f'<span class="trade-go" aria-hidden="true">{ico("arrow")}</span></a>')
    return '<div class="trades">' + "".join(out) + "</div>"

STEPS = [
    ("Cuéntanos qué necesitas", "Describe el trabajo, tu zona y cuándo lo necesitas. Recibes un correo con tu código."),
    ("Buscamos un profesional compatible", "Según oficio, zona, plazo y tipo de cliente. Le enviamos el trabajo sin tus datos de contacto."),
    ("Te ponemos en contacto", "Cuando uno confirma que puede atenderlo en tu plazo, le facilitamos tu contacto y te avisamos."),
    ("Presupuesto y seguimiento", "Recibes el presupuesto por correo y decides. Confirmas el final y valoras el servicio."),
]

def steps_html():
    items = []
    for i, (t, d) in enumerate(STEPS):
        hl = ' hl' if i == len(STEPS) - 1 else ''
        items.append(f'<li class="step{hl}" data-reveal><div><h3>{e(t)}</h3><p>{e(d)}</p></div></li>')
    return '<ol class="steps">' + "".join(items) + "</ol>"

def options(items, placeholder):
    return f'<option value="">{e(placeholder)}</option>' + "".join(f'<option value="{e(v)}">{e(t)}</option>' for v, t in items)

def oficio_opts():
    return options([(o["slug"], o["nombre"]) for o in OFICIOS], "Selecciona un servicio")

def page_home():
    p = ""
    c = ciudad_activa()
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Organization", "@id": SITE + "#org", "name": "OficioCerca", "url": SITE, "email": CONTACT_EMAIL,
         "logo": SITE + "assets/img/apple-touch-icon.png",
         "description": "Servicio de intermediación que conecta a clientes y empresas con profesionales de obras, reformas y reparaciones.",
         "areaServed": {"@type": "City", "name": "Córdoba", "containedInPlace": {"@type": "Country", "name": "España"}}},
        {"@type": "WebSite", "@id": SITE + "#web", "name": "OficioCerca", "url": SITE, "inLanguage": "es-ES", "publisher": {"@id": SITE + "#org"}}]}
    opciones = [
        ("Necesito un profesional", "Tengo una reparación, obra o reforma y quiero encontrar quién la haga.", "Solicitar un profesional", "solicitar/?tipo=particular", "home"),
        ("Soy empresa o contratista", "Necesito un profesional u oficio para una obra o proyecto.", "Solicitar un profesional para una obra", "solicitar/?tipo=empresa", "brick"),
        ("Soy profesional", "Quiero registrarme para recibir oportunidades de trabajo.", "Registrarme como profesional", "profesionales/", "wrench"),
    ]
    opts = "".join(
        f'<a class="hopt" href="{h}"><span class="hopt-ico">{ico(i)}</span><span class="hopt-t">{e(t)}</span>'
        f'<span class="hopt-d">{e(d)}</span><span class="hopt-cta">{e(a)} {ico("arrow")}</span></a>'
        for t, d, a, h, i in opciones)
    body = f"""<main id="main">
<section class="hero hero14" aria-labelledby="h-hero">
  <div class="hero-photo" aria-hidden="true"></div>
  <div class="wrap">
    <span class="pill"><span class="dot" aria-hidden="true"></span>Piloto en {e(c["nombre"])} capital</span>
    <h1 id="h-hero">Encuentra al profesional que necesita tu proyecto</h1>
    <p class="lead">Cuéntanos qué trabajo necesitas. Buscamos un profesional compatible con tu trabajo, tu zona y tu plazo, y te informamos por correo de cada paso.</p>
    <p class="hero-pick">Elige una opción:</p>
    <div class="hero-opts">{opts}</div>
    <p class="hero-note">Gratis y sin compromiso para quien solicita · No ofrecemos servicio de urgencias 24 horas</p>
  </div>
</section>

<section class="sec" id="servicios" aria-labelledby="h-serv">
  <div class="wrap">
    <div class="sec-head" data-reveal>
      <span class="eyebrow">Servicios del piloto</span>
      <h2 id="h-serv">¿Qué necesitas?</h2>
      <p>Empezamos con estos servicios. Si buscas otro, cuéntanoslo: revisaremos disponibilidad, sin garantizar que haya profesional.</p>
    </div>
    {trades_grid(p)}
  </div>
</section>

<section class="sec sec-white" id="como-funciona" aria-labelledby="h-como">
  <div class="wrap">
    <div class="sec-head" data-reveal>
      <span class="eyebrow">Cómo funciona</span>
      <h2 id="h-como">Cuatro pasos, con seguimiento por correo</h2>
    </div>
    {steps_html()}
    <div class="notice" data-reveal>{ico('check')}<p><strong>La solicitud es gratuita.</strong> El presupuesto y el pago se acuerdan directamente con el profesional; OficioCerca no cobra ni procesa pagos de los trabajos.</p></div>
  </div>
</section>

<section class="sec" id="por-que" aria-labelledby="h-why">
  <div class="wrap">
    <div class="sec-head" data-reveal>
      <span class="eyebrow">¿Por qué OficioCerca?</span>
      <h2 id="h-why">Un proceso ordenado, no una lista de teléfonos</h2>
    </div>
    <div class="why why-3">
      <div class="why-item" data-reveal>{ico('gear')}<h3>Profesionales revisados</h3><p>Revisamos cada alta antes de que un profesional reciba trabajos.</p></div>
      <div class="why-item" data-reveal>{ico('home')}<h3>Según oficio, zona y plazo</h3><p>Solo ofrecemos tu trabajo a profesionales que hacen ese servicio en tu zona, de uno en uno.</p></div>
      <div class="why-item" data-reveal>{ico('check')}<h3>Seguimiento por correo</h3><p>Cada solicitud tiene su código y te avisamos de cada paso: profesional, presupuesto y final.</p></div>
    </div>
  </div>
</section>

<section class="sec sec-tight">
  <div class="wrap">
    <div class="cta-band" data-reveal>
      <div><h2>Cuéntanos qué necesitas</h2><p>Piloto en Córdoba capital. Solicitud gratuita y sin compromiso.</p></div>
      <div class="row">
        <a class="btn btn-light" href="solicitar/?tipo=particular">Solicitar un profesional</a>
        <a class="btn btn-light" href="solicitar/?tipo=empresa">Profesional para una obra</a>
        <a class="btn btn-dark-on" href="profesionales/">Registrarme como profesional</a>
      </div>
    </div>
  </div>
</section>
</main>
"""
    write("index.html", head("OficioCerca · Profesionales para obras, reformas y reparaciones",
                             "Cuéntanos qué trabajo necesitas y buscamos un profesional compatible con tu trabajo, zona y plazo. Piloto en Córdoba capital. Solicitud gratuita y con seguimiento por correo.",
                             "", p, jsonld=ld) + header(p) + body + footer(p))

def consent_block(prefix, items):
    out = []
    for i, (name, text) in enumerate(items):
        out.append(f'''<div class="consent" data-consent>
  <input type="checkbox" id="{prefix}-{name}" name="{name}" value="si" required>
  <label for="{prefix}-{name}">{text}</label>
  <span class="err-msg">Necesitamos esta autorización para continuar.</span>
</div>''')
    return "".join(out)

PLAZOS = [("HOY_MANANA", "Hoy o mañana"), ("DOS_TRES_DIAS", "En 2–3 días"), ("ESTA_SEMANA", "Esta semana"),
          ("UNA_DOS_SEMANAS", "En 1–2 semanas"), ("FLEXIBLE", "Flexible / sin fecha concreta"), ("OTRA_FECHA", "Otra fecha")]

def page_solicitar():
    p = "../"
    c = ciudad_activa()
    tipos = "".join(f'<option value="{e(t)}">{e(t)}</option>' for t in TIPOS)
    plazos = "".join(f'<label class="choice"><input type="radio" name="plazo" value="{v}"{" required" if i == 0 else ""}><span>{e(t)}</span></label>' for i, (v, t) in enumerate(PLAZOS))
    body = f"""<main id="main">
<section class="page-hero"><div class="wrap">
  <div class="crumbs"><a href="../">Inicio</a> / Solicitar profesional</div>
  <h1>Solicitar un profesional</h1>
  <p>Cuéntanos qué necesitas. Buscamos un profesional compatible con tu trabajo, tu zona y tu plazo en {e(c['nombre'])}, y te informamos por correo. Es gratuito y sin compromiso.</p>
  <p class="req-legend"><span class="req">*</span> Obligatorio. El resto es opcional.</p>
</div></section>
<div class="wrap form-layout">
  <div class="form-card">
    <form id="form-solicitud" data-oc-form="solicitud" novalidate>
      <div class="hp" aria-hidden="true"><label>No rellenar <input type="text" name="web" tabindex="-1" autocomplete="off"></label></div>

      <fieldset>
        <legend><span class="n">1</span>Quién lo solicita</legend>
        <fieldset class="choice-group" data-required-group="tipoSolicitante">
          <legend class="sr-only">Tipo de solicitante</legend>
          <div class="choices c2">
            <label class="choice"><input type="radio" name="tipoSolicitante" value="Particular" required><span>Particular<small>Mi casa o local</small></span></label>
            <label class="choice"><input type="radio" name="tipoSolicitante" value="Empresa / Contratista"><span>Empresa / contratista<small>Obra, proyecto o comunidad</small></span></label>
          </div>
          <span class="err-msg">Elige una opción.</span>
        </fieldset>
        <div class="grid2">
          <div class="field"><label for="s-nombre">Nombre y apellidos <span class="req">*</span></label><input id="s-nombre" name="nombre" type="text" autocomplete="name" required maxlength="120"><span class="err-msg">Escribe tu nombre.</span></div>
          <div class="field" data-show-if="tipoSolicitante=Empresa / Contratista"><label for="s-empresa">Empresa <span class="opt">(si aplica)</span></label><input id="s-empresa" name="empresa" type="text" autocomplete="organization" maxlength="120"></div>
        </div>
        <div class="field"><label for="s-email">Correo para seguimiento <span class="req">*</span></label><input id="s-email" name="email" type="email" autocomplete="email" maxlength="160" required><span class="hint">Te enviaremos aquí el código y las novedades de tu solicitud.</span><span class="err-msg">Escribe un correo válido: por aquí te informaremos.</span></div>
        <div class="grid2">
          <div class="field"><label for="s-wa">WhatsApp <span class="req">*</span></label><input id="s-wa" name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" required placeholder="600 000 000" data-phone><span class="hint">Solo se lo daremos al profesional que atienda tu trabajo.</span><span class="err-msg">Revisa el número (9 dígitos o con prefijo +).</span></div>
          <div class="field"><label for="s-tel2">Teléfono alternativo <span class="opt">(opcional)</span></label><input id="s-tel2" name="telefonoAlt" type="tel" inputmode="tel" data-phone-optional><span class="err-msg">Revisa el número.</span></div>
        </div>
      </fieldset>

      <fieldset>
        <legend><span class="n">2</span>Qué necesitas</legend>
        <div class="field"><label for="s-oficio">Servicio que necesitas <span class="req">*</span></label><select id="s-oficio" name="oficio" required data-keep-value>{oficio_opts()}</select><span class="err-msg">Elige un servicio (o «Otro servicio»).</span></div>
        <div class="field otro-box" data-show-if="oficio=otro"><label for="s-otro">¿Qué servicio o profesional necesitas? <span class="req">*</span></label><input id="s-otro" name="oficioOtro" type="text" maxlength="120" data-required-if="oficio=otro" placeholder="Ej.: cerrajero, cristalero…"><span class="hint">Revisaremos si hay profesionales disponibles en {e(c['nombre'])}. No podemos garantizar que los haya.</span><span class="err-msg">Indica qué servicio o profesional necesitas.</span></div>
        <div class="field"><label for="s-desc">Describe el trabajo <span class="req">*</span></label><textarea id="s-desc" name="descripcion" required minlength="10" maxlength="3000" placeholder="Qué ha pasado o qué quieres hacer. Si puedes: medidas, materiales o detalles."></textarea><span class="hint"><span data-count="s-desc">0</span>/3000</span><span class="err-msg">Describe brevemente el trabajo (mínimo 10 caracteres).</span></div>
        <div class="field"><label for="s-tipo">Tipo de trabajo <span class="opt">(opcional)</span></label><select id="s-tipo" name="tipoTrabajo"><option value="">Sin especificar</option>{tipos}</select></div>
        <fieldset class="choice-group" data-required-group="plazo">
          <legend class="label">¿Cuándo necesitas que pueda atenderse el trabajo? <span class="req">*</span></legend>
          <div class="choices c2 plazos">{plazos}</div>
          <span class="err-msg">Elige cuándo lo necesitas.</span>
        </fieldset>
        <div class="field" data-show-if="plazo=OTRA_FECHA"><label for="s-fecha">Fecha aproximada <span class="req">*</span></label><input id="s-fecha" name="fechaDeseada" type="date" data-required-if="plazo=OTRA_FECHA" data-min-today><span class="err-msg">Elige una fecha a partir de hoy.</span></div>
        <p class="hint" style="margin-top:6px">OficioCerca no ofrece actualmente un servicio garantizado de emergencias 24/7.</p>
      </fieldset>

      <fieldset>
        <legend><span class="n">3</span>Dónde es el trabajo</legend>
        <p class="fs-help">Zona piloto: {e(c['nombre'])} capital. La dirección exacta la acordarás con el profesional.</p>
        <input type="hidden" name="ciudad" value="{e(c['nombre'])}">
        <input type="hidden" name="consentVersion" value="{CONSENT_VERSION}">
        <div class="grid2">
          <div class="field"><label for="s-zona">Zona o barrio <span class="req">*</span></label><input id="s-zona" name="zona" type="text" required maxlength="120" placeholder="Ej.: Centro, Ciudad Jardín…"><span class="err-msg">Indica la zona o el barrio.</span></div>
          <div class="field"><label for="s-cp">Código postal <span class="opt">(opcional)</span></label><input id="s-cp" name="codigoPostal" type="text" inputmode="numeric" autocomplete="postal-code" maxlength="5" pattern="[0-9]{{5}}" placeholder="14000"><span class="err-msg">Si lo indicas, deben ser 5 cifras.</span></div>
        </div>
      </fieldset>

      <fieldset>
        <legend><span class="n">4</span>Fotos del trabajo <span class="opt">(opcional)</span></legend>
        <div class="photos" data-photos>
          {ico('camera')}
          <p>Puedes adjuntar hasta 5 fotos para que el profesional entienda mejor el trabajo.</p>
          <label class="btn btn-ghost btn-sm" for="s-fotos">Añadir fotos</label>
          <input id="s-fotos" type="file" accept="image/*" multiple class="sr-only" data-photo-input>
          <div class="photo-list" data-photo-list aria-live="polite"></div>
          <p class="hint" data-photo-msg style="margin:10px 0 0"></p>
        </div>
      </fieldset>

      <fieldset>
        <legend><span class="n">5</span>Contacto y autorizaciones</legend>
        <fieldset class="choice-group">
          <legend class="label">Cuando encontremos un profesional, ¿cómo prefieres que te contacte?</legend>
          <div class="choices c3">
            <label class="choice"><input type="radio" name="contactoPreferido" value="WhatsApp" checked><span>WhatsApp</span></label>
            <label class="choice"><input type="radio" name="contactoPreferido" value="Llamada"><span>Llamada</span></label>
            <label class="choice"><input type="radio" name="contactoPreferido" value="Correo"><span>Correo</span></label>
          </div>
          <span class="hint">OficioCerca utilizará tu correo electrónico para mantenerte informado sobre el estado de tu solicitud.</span>
        </fieldset>
        {consent_block("s", [
            ("consentContacto", "Autorizo a OficioCerca a contactarme, principalmente por correo, para gestionar esta solicitud. <span class=\"req\">*</span>"),
            ("consentCompartir", "Autorizo a OficioCerca a compartir la información necesaria para valorar mi solicitud (servicio, zona o barrio, tipo de trabajo, plazo, descripción y fotos) con profesionales compatibles, de uno en uno. Mis datos de contacto solo se compartirán con el profesional que confirme que puede atenderla en mi plazo, o con el que yo apruebe. <span class=\"req\">*</span>"),
            ("consentPrivacidad", "He leído la <a href=\"../privacidad/\" target=\"_blank\" rel=\"noopener\">política de privacidad</a> y las <a href=\"../condiciones/\" target=\"_blank\" rel=\"noopener\">condiciones de uso</a>. <span class=\"req\">*</span>")])}
      </fieldset>

      <div class="submit-row">
        <button class="btn btn-primary btn-block" type="submit"><span class="spinner" aria-hidden="true"></span><span data-btn-label>Enviar solicitud</span></button>
        <span class="hint">Gratis y sin compromiso. Para valorar el trabajo solo enviamos la información del trabajo; tus datos de contacto, únicamente al profesional que lo vaya a atender.</span>
      </div>
      <div class="form-status" role="alert" data-status></div>
    </form>

    <div class="success" data-success tabindex="-1">
      <div class="badge">{ico('check')}</div>
      <h2>Solicitud recibida</h2>
      <div class="ticket"><small>Tu código de solicitud</small><strong data-code>—</strong></div>
      <p class="mail-alert"><strong>Te hemos enviado un correo de confirmación. Mantente pendiente de tu correo: por ahí te informaremos de los avances de tu solicitud.</strong></p>
      <p>Si no lo encuentras, revisa también <strong>Spam</strong> o <strong>Promociones</strong>.</p>
      <div class="next"><strong>Próximos pasos</strong><ol><li>Buscamos un profesional compatible con tu trabajo, zona y plazo.</li><li>Cuando uno confirme que puede atenderlo, te avisamos por correo y te contactará.</li><li>Recibirás su presupuesto por correo y decidirás si lo aceptas.</li></ol></div>
      <a class="btn btn-ghost" href="../">Volver al inicio</a>
    </div>
  </div>

  <aside class="aside-sticky">
    <div class="aside-card">
      <h2>Qué pasa después</h2>
      <ol><li>Recibes un correo con tu código.</li><li>Ofrecemos el trabajo, sin tus datos de contacto, a un profesional compatible cada vez.</li><li>Si confirma que puede en tu plazo, le facilitamos tu contacto y te avisamos.</li><li>Recibes el presupuesto por correo y tú decides.</li><li>Confirmas el final del trabajo y lo valoras.</li></ol>
      <p>No garantizamos disponibilidad. El presupuesto y el pago son directamente con el profesional.</p>
    </div>
  </aside>
</div>
</main>
"""
    write("solicitar/index.html", head("Solicitar un profesional · OficioCerca",
          f"Formulario para solicitar electricista, fontanero, marmolista u otro profesional en {c['nombre']}. Gratis, con seguimiento por correo y hasta 5 fotos.",
          "solicitar/", p) + header(p) + body + footer(p, f'<script src="{p}assets/js/forms.js?v={VERSION}" defer></script>'))

def page_profesionales():
    p = "../"
    servs = "".join(f'<label class="choice"><input type="checkbox" name="servicios" value="{o["slug"]}"{" required" if i == 0 else ""}><span>{e(o["nombre"] if o["slug"] != "otro" else "Otro")}</span></label>'
                    for i, o in enumerate(OFICIOS))
    body = f"""<main id="main">
<section class="page-hero"><div class="wrap">
  <div class="crumbs"><a href="../">Inicio</a> / Profesionales</div>
  <h1>Regístrate como profesional</h1>
  <p>Recibe por correo oportunidades compatibles con tus servicios y tu zona. Tú decides cuáles atiendes. Registro gratuito.</p>
  <p class="req-legend"><span class="req">*</span> Obligatorio. El resto es opcional.</p>
</div></section>
<div class="wrap form-layout">
  <div class="form-card">
    <form id="form-profesional" data-oc-form="profesional" novalidate>
      <div class="hp" aria-hidden="true"><label>No rellenar <input type="text" name="web" tabindex="-1" autocomplete="off"></label></div>
      <input type="hidden" name="condVersion" value="{PRO_COND_VERSION}">
      <fieldset>
        <legend><span class="n">1</span>Tus datos</legend>
        <div class="grid2">
          <div class="field"><label for="p-nombre">Nombre y apellidos <span class="req">*</span></label><input id="p-nombre" name="nombre" type="text" autocomplete="name" required maxlength="120"><span class="err-msg">Escribe tu nombre.</span></div>
          <div class="field"><label for="p-empresa">Empresa o autónomo <span class="opt">(si aplica)</span></label><input id="p-empresa" name="empresa" type="text" autocomplete="organization" maxlength="120"></div>
        </div>
        <div class="field"><label for="p-email">Correo electrónico <span class="req">*</span></label><input id="p-email" name="email" type="email" autocomplete="email" maxlength="160" required><span class="hint">Este correo se utilizará para enviarte oportunidades y gestionar el seguimiento de los trabajos.</span><span class="err-msg">Escribe un correo válido.</span></div>
        <div class="grid2">
          <div class="field"><label for="p-wa">WhatsApp <span class="req">*</span></label><input id="p-wa" name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" required data-phone><span class="err-msg">Revisa el número.</span></div>
          <div class="field"><label for="p-tel">Teléfono <span class="opt">(si es distinto)</span></label><input id="p-tel" name="telefono" type="tel" inputmode="tel" data-phone-optional><span class="err-msg">Revisa el número.</span></div>
        </div>
      </fieldset>
      <fieldset>
        <legend><span class="n">2</span>Servicios que realizas</legend>
        <fieldset class="choice-group" data-required-group="servicios">
          <legend class="label">Marca todos los que haces <span class="req">*</span></legend>
          <div class="choices c2 servs">{servs}</div>
          <span class="hint">Solo te enviaremos trabajos de los servicios que marques.</span>
          <span class="err-msg">Marca al menos un servicio.</span>
        </fieldset>
        <div class="field" data-show-if-has="servicios=otro"><label for="p-otro">¿Qué otro servicio haces? <span class="req">*</span></label><input id="p-otro" name="servicioOtro" type="text" maxlength="120" data-required-if-has="servicios=otro"><span class="err-msg">Indica el servicio.</span></div>
        <div class="grid2">
          <div class="field"><label for="p-exp">Años de experiencia <span class="req">*</span></label><select id="p-exp" name="experiencia" required><option value="">Selecciona</option><option>Menos de 2 años</option><option>2 a 5 años</option><option>6 a 10 años</option><option>Más de 10 años</option></select><span class="err-msg">Elige una opción.</span></div>
          <div class="field"><label for="p-esp">Especialidades <span class="opt">(opcional)</span></label><input id="p-esp" name="especialidades" type="text" maxlength="300" placeholder="Ej.: boletines, encimeras de cuarzo…"></div>
        </div>
        <div class="field"><label for="p-desc">Descripción breve de tu experiencia <span class="opt">(opcional)</span></label><textarea id="p-desc" name="descripcion" maxlength="1500" placeholder="Tipo de trabajos que haces, con quién trabajas…"></textarea></div>
      </fieldset>
      <fieldset>
        <legend><span class="n">3</span>Zona y disponibilidad</legend>
        <div class="grid2">
          <div class="field"><label for="p-ciudad">Ciudad <span class="req">*</span></label><input id="p-ciudad" name="ciudad" type="text" required maxlength="80" value="Córdoba"><span class="err-msg">Indica tu ciudad.</span></div>
          <div class="field"><label for="p-cp">Código postal <span class="req">*</span></label><input id="p-cp" name="codigoPostal" type="text" inputmode="numeric" required maxlength="5" pattern="[0-9]{{5}}"><span class="err-msg">5 cifras.</span></div>
        </div>
        <div class="field"><label for="p-zonas">Zonas donde trabajas <span class="req">*</span></label><input id="p-zonas" name="zonas" type="text" required maxlength="300" placeholder="Barrios, pueblos o códigos postales"><span class="err-msg">Indica al menos una zona.</span></div>
        <div class="grid2">
          <div class="field"><label for="p-dist">Distancia que te desplazas <span class="req">*</span></label><select id="p-dist" name="distancia" required><option value="">Selecciona</option><option>Solo mi barrio o pueblo</option><option>Hasta 10 km</option><option>Hasta 25 km</option><option>Hasta 50 km</option><option>Toda la provincia</option></select><span class="err-msg">Elige una opción.</span></div>
          <div class="field"><label for="p-disp">Disponibilidad habitual <span class="req">*</span></label><select id="p-disp" name="disponibilidad" required><option value="">Selecciona</option><option>Esta semana</option><option>En 1-2 semanas</option><option>Solo trabajos puntuales</option><option>Agenda completa, pero me interesa</option></select><span class="hint">En cada oportunidad te preguntaremos cuándo puedes.</span><span class="err-msg">Elige una opción.</span></div>
        </div>
        <div class="grid2">
          <fieldset class="choice-group" data-required-group="conParticulares"><legend class="label">¿Atiendes a particulares? <span class="req">*</span></legend><div class="choices c2"><label class="choice"><input type="radio" name="conParticulares" value="Sí" required><span>Sí</span></label><label class="choice"><input type="radio" name="conParticulares" value="No"><span>No</span></label></div><span class="err-msg">Elige una opción.</span></fieldset>
          <fieldset class="choice-group" data-required-group="conEmpresas"><legend class="label">¿Atiendes a empresas y contratistas? <span class="req">*</span></legend><div class="choices c2"><label class="choice"><input type="radio" name="conEmpresas" value="Sí" required><span>Sí</span></label><label class="choice"><input type="radio" name="conEmpresas" value="No"><span>No</span></label></div><span class="err-msg">Elige una opción.</span></fieldset>
        </div>
      </fieldset>
      <fieldset>
        <legend><span class="n">4</span>Condiciones y autorizaciones</legend>
        <p class="fs-help">Resumen: tú decides qué oportunidades atiendes y fijas tu precio; el cliente te paga directamente. La tarifa de OficioCerca solo se calcula si el cliente acepta un presupuesto registrado aquí (10 % de la mano de obra, máximo 200 €) y durante el piloto no se cobra.</p>
        {consent_block("p", [
            ("consentCondiciones", f"He leído y acepto las <a href=\"../condiciones-profesionales/\" target=\"_blank\" rel=\"noopener\">condiciones para profesionales</a> (versión {PRO_COND_VERSION}). <span class=\"req\">*</span>"),
            ("consentContacto", "Autorizo a OficioCerca a contactarme por correo, WhatsApp o llamada para enviarme oportunidades y gestionar mi alta. <span class=\"req\">*</span>"),
            ("consentPrivacidad", "He leído la <a href=\"../privacidad/\" target=\"_blank\" rel=\"noopener\">política de privacidad</a> y las <a href=\"../condiciones/\" target=\"_blank\" rel=\"noopener\">condiciones de uso</a>. <span class=\"req\">*</span>")])}
      </fieldset>
      <div class="submit-row">
        <button class="btn btn-primary btn-block" type="submit"><span class="spinner" aria-hidden="true"></span><span data-btn-label>Registrarme como profesional</span></button>
        <span class="hint">Registro gratuito. Tu alta queda pendiente de revisión antes de recibir trabajos.</span>
      </div>
      <div class="form-status" role="alert" data-status></div>
    </form>
    <div class="success" data-success tabindex="-1">
      <div class="badge">{ico('check')}</div>
      <h2>Registro recibido</h2>
      <div class="ticket"><small>Tu código de profesional</small><strong data-code>—</strong></div>
      <p class="mail-alert"><strong>Tu alta queda pendiente de revisión. Te avisaremos por correo cuando esté activa.</strong></p>
      <p>Si no ves nuestro correo, revisa también <strong>Spam</strong> o <strong>Promociones</strong>.</p>
      <div class="next"><strong>Después</strong><ol><li>Recibirás por correo oportunidades de tus servicios y tu zona.</li><li>Respondes con un botón: puedo, puedo más adelante o no puedo.</li><li>Si te la asignamos, recibes el contacto del cliente y registras tu presupuesto.</li></ol></div>
      <a class="btn btn-ghost" href="../">Volver al inicio</a>
    </div>
  </div>
  <aside class="aside-sticky">
    <div class="aside-card">
      <h2>Cómo funciona para ti</h2>
      <ol><li>Revisamos tu alta y la activamos.</li><li>Recibes por correo una ficha: servicio, zona, plazo, descripción y fotos (sin datos del cliente).</li><li>Respondes con un botón e indicas cuándo puedes.</li><li>Si te asignamos el trabajo, recibes el contacto del cliente.</li><li>Registras tu presupuesto; el cliente lo acepta o no y te paga directamente.</li></ol>
      <p>Aceptar una oportunidad significa que tienes interés y disponibilidad para contactar al cliente y presupuestar; no te obliga a ejecutar la obra.</p>
    </div>
  </aside>
</div>
</main>
"""
    write("profesionales/index.html", head("Profesionales: recibe trabajos de tu oficio · OficioCerca",
          "Regístrate en OficioCerca y recibe por correo oportunidades compatibles con tus servicios y tu zona. Registro gratuito. Piloto en Córdoba.",
          "profesionales/", p) + header(p) + body + footer(p, f'<script src="{p}assets/js/forms.js?v={VERSION}" defer></script>'))

def page_ciudad(c):
    p = "../"
    body = f"""<main id="main">
<section class="page-hero"><div class="wrap">
  <div class="crumbs"><a href="../">Inicio</a> / {e(c['nombre'])}</div>
  <h1>Profesionales para obras y reparaciones en {e(c['nombre'])}</h1>
  <p>{e(c['nombre'])} es la zona piloto de OficioCerca. Elige el oficio que necesitas y te buscamos un profesional disponible.</p>
</div></section>
<section class="sec" style="padding-top:20px"><div class="wrap">{trades_grid(p, c['slug'])}</div></section>
</main>
"""
    write(f"{c['slug']}/index.html", head(f"Profesionales en {c['nombre']}: electricistas, fontaneros y más · OficioCerca",
          f"Solicita electricista, fontanero, marmolista, albañil u otro profesional en {c['nombre']}. Servicio piloto gratuito con seguimiento.",
          f"{c['slug']}/", p) + header(p) + body + footer(p))

def page_oficio_ciudad(c, o):
    """Plantilla preparada para /<ciudad>/<oficio>/ (ej. /cordoba/electricistas/)."""
    p = "../../"
    body = f"""<main id="main">
<section class="page-hero"><div class="wrap">
  <div class="crumbs"><a href="{p}">Inicio</a> / <a href="{p}{c['slug']}/">{e(c['nombre'])}</a> / {e(o['nombre'])}</div>
  <h1>{e(o['nombre'])} en {e(c['nombre'])}</h1>
  <p>¿Necesitas {e(o['profesional'].lower())} en {e(c['nombre'])}? Cuéntanos el trabajo y buscamos un profesional disponible en tu zona. Solicitud gratuita con seguimiento.</p>
  <a class="btn btn-primary" href="{p}solicitar/?oficio={o['slug']}&ciudad={c['slug']}">Solicitar {e(o['nombre'].lower())} {ico('arrow')}</a>
</div></section>
<section class="sec sec-white"><div class="wrap"><h2>Cómo funciona</h2>{steps_html()}</div></section>
</main>
"""
    write(f"{c['slug']}/{o['url']}/index.html", head(f"{o['nombre']} en {c['nombre']} · OficioCerca",
          f"Solicita {o['profesional'].lower()} en {c['nombre']} con OficioCerca: revisamos tu solicitud, buscamos profesional y hacemos seguimiento.",
          f"{c['slug']}/{o['url']}/", p) + header(p) + body + footer(p))

LEGAL_NOTE = '<div class="draft-banner">BORRADOR PROVISIONAL. Este texto es orientativo y debe ser revisado por un profesional jurídico antes de la explotación comercial de OficioCerca. Los campos marcados en amarillo están pendientes de completar.</div>'
PH = lambda t: f'<span class="placeholder">[{t}]</span>'
MAIL = f'<a href="mailto:{CONTACT_EMAIL}">{CONTACT_EMAIL}</a>'

def page_privacidad():
    p = "../"
    body = f"""<main id="main"><div class="wrap"><section class="page-hero"><div class="crumbs"><a href="../">Inicio</a> / Privacidad</div><h1>Política de privacidad</h1></section>
<article class="legal">{LEGAL_NOTE}
<h2>1. Responsable del tratamiento</h2>
<p>Titular: {PH('nombre completo o razón social pendiente')}. Identificación fiscal: {PH('pendiente')}. Domicilio y país de establecimiento: {PH('pendiente')}. Correo de contacto: {MAIL}.</p>
<h2>2. Qué datos tratamos</h2>
<p>Clientes: nombre, correo electrónico, WhatsApp, zona o barrio, servicio, descripción del trabajo y plazo deseado (obligatorios); y, si el usuario los indica, empresa, teléfono alternativo, código postal, tipo de trabajo, fecha aproximada, preferencia de contacto y fotografías.</p>
<p>Profesionales: nombre, correo, WhatsApp, servicios que realiza, experiencia, ciudad, código postal, zonas, distancia, disponibilidad habitual y tipo de clientes que atiende (obligatorios); y, si los indica, empresa, especialidades y descripción.</p>
<p>Durante la gestión también registramos: la versión del consentimiento o de las condiciones aceptadas y su fecha; las oportunidades enviadas a cada profesional, sus respuestas y la disponibilidad indicada; los presupuestos registrados (mano de obra, materiales y total) y la respuesta del cliente; la confirmación de finalización, las valoraciones, las incidencias y sugerencias; y un registro de los correos enviados. Sirven para dar el servicio, poder demostrar qué se compartió y con quién, y calcular la tarifa de intermediación cuando proceda.</p>
<p>Recomendamos no incluir en las fotos personas, documentos ni datos que no sean necesarios para valorar el trabajo.</p>
<h2>3. Para qué los usamos</h2>
<p>Gestionar la solicitud, encontrar un profesional compatible, facilitar el contacto, informar al cliente por correo de cada paso, registrar presupuestos y su aceptación, confirmar la finalización, recoger valoraciones e incidencias y mejorar el servicio. En el caso de profesionales: revisar su alta, enviarles oportunidades de sus servicios y zona, y llevar su historial interno (oportunidades, respuestas, trabajos y valoraciones), que no se publica.</p>
<h2>4. Cómo se elige al profesional (reglas, no IA)</h2>
<p>La selección puede hacerse de forma automática mediante reglas de compatibilidad fijas: servicio declarado por el profesional, ciudad, zona y distancia, tipo de cliente (particular o empresa), disponibilidad y estado del profesional (solo profesionales activos y revisados). Entre los compatibles se ordena por coincidencia de zona, disponibilidad, historial y rotación para repartir las oportunidades. No se utiliza inteligencia artificial ni se toman decisiones con efectos jurídicos sobre el cliente: el cliente decide siempre si acepta un presupuesto, y las sanciones a profesionales las decide una persona. Las solicitudes de «Otro servicio» se revisan manualmente.</p>
<h2>5. Base legal</h2>
<p>El consentimiento expreso otorgado en los formularios y la gestión de la solicitud o del alta a petición del propio interesado. {PH('revisar con asesor jurídico')}</p>
<h2>6. Con quién se comparten</h2>
<p>El reparto se hace en dos momentos y de uno en uno (nunca a muchos profesionales a la vez):</p>
<ul>
<li><strong>Para valorar el trabajo:</strong> se envía por correo a un profesional compatible una ficha con el código, el servicio, la zona o barrio, el tipo de trabajo, el plazo deseado, la descripción y las fotos adjuntas. La ficha no incluye nombre, empresa, teléfonos, correo ni código postal del cliente. Si no puede atenderlo, se ofrece al siguiente compatible.</li>
<li><strong>Solo al profesional asignado:</strong> cuando un profesional confirma que puede atenderlo dentro del plazo pedido, o cuando el cliente aprueba expresamente una disponibilidad posterior, se le envían automáticamente los datos de contacto del cliente (nombre, empresa si la hay, teléfonos, correo, preferencia de contacto, zona y código postal). Al cliente se le comunica el nombre o empresa del profesional y su disponibilidad.</li>
</ul>
<p>Las fotos se guardan en una carpeta privada y se envían únicamente como adjuntos de esos correos; no se comparten por enlace. Una vez enviado un correo, su copia queda en el buzón del destinatario y OficioCerca no puede retirarla.</p>
<p>Los datos se almacenan y los correos se envían mediante servicios de Google {PH('revisar transferencias internacionales y garantías aplicables')}. No vendemos datos a terceros. Las valoraciones no se publican.</p>
<h2>7. Cuánto tiempo los conservamos</h2>
<p>{PH('plazo pendiente; propuesta: solicitudes no gestionadas, 6 meses; solicitudes gestionadas y presupuestos, el tiempo necesario para el seguimiento, la tarifa y las obligaciones legales')}.</p>
<h2>8. Tus derechos</h2>
<p>Puedes solicitar acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a {MAIL}, y presentar una reclamación ante la Agencia Española de Protección de Datos (aepd.es).</p>
<h2>9. Cookies</h2>
<p>Este sitio no utiliza cookies de analítica ni publicidad en esta versión. Si se añadieran, se informará y se pedirá consentimiento cuando corresponda.</p>
</article></div></main>
"""
    write("privacidad/index.html", head("Política de privacidad (borrador) · OficioCerca", "Borrador provisional de la política de privacidad de OficioCerca.", "privacidad/", p, noindex=True) + header(p) + body + footer(p))

def page_condiciones():
    p = "../"
    body = f"""<main id="main"><div class="wrap"><section class="page-hero"><div class="crumbs"><a href="../">Inicio</a> / Condiciones</div><h1>Condiciones de uso</h1></section>
<article class="legal">{LEGAL_NOTE}
<h2>1. Qué es OficioCerca</h2>
<p>OficioCerca es un servicio, actualmente en fase piloto en Córdoba capital, que pone en contacto a personas y empresas que necesitan un trabajo de obra, reforma, reparación o mantenimiento con profesionales independientes que pueden atenderlo. Titular: {PH('pendiente')}. Contacto: {MAIL}.</p>
<h2>2. Papel de OficioCerca</h2>
<p>OficioCerca actúa como intermediario. No ejecuta obras, no fija los precios de los trabajos, no emite los presupuestos de los trabajos y no cobra, recibe ni custodia el dinero de los trabajos. El contrato del trabajo se establece directamente entre el cliente y el profesional, que es responsable de su ejecución, permisos, garantías legales y seguros. OficioCerca no presta garantías propias sobre los trabajos.</p>
<h2>3. Para clientes</h2>
<p>La solicitud es gratuita y no obliga a aceptar ningún presupuesto. OficioCerca ofrece la solicitud a profesionales compatibles, de uno en uno, según reglas de oficio, zona, plazo y tipo de cliente. Si solo hay disponibilidad posterior al plazo pedido, el cliente decide si continúa con ese profesional, si seguimos buscando o si cancela. Los datos de contacto del cliente solo se facilitan al profesional asignado.</p>
<p>OficioCerca no garantiza que exista un profesional disponible para todas las solicitudes, ni plazos de atención, y no ofrece un servicio de urgencias 24 horas. El cliente puede cancelar su solicitud antes de la asignación desde el enlace de su correo.</p>
<h2>4. Seguimiento por correo</h2>
<p>OficioCerca informa al cliente por correo electrónico de cada paso: confirmación, profesional asignado, presupuesto (que el cliente puede aceptar, no aceptar o pedir aclarar), finalización (que debe confirmar el cliente) y valoración. Los enlaces de esos correos son personales y caducan.</p>
<h2>5. Valoraciones e incidencias</h2>
<p>Las valoraciones solo proceden de solicitudes gestionadas y finalizadas a través de OficioCerca, están ligadas a esa solicitud y profesional, y no se publican de forma automática. El cliente puede comunicar un problema o una sugerencia en cualquier momento; una persona de OficioCerca revisa cada incidencia. Ninguna valoración aislada provoca por sí sola sanciones automáticas.</p>
<h2>6. Uso correcto</h2>
<p>No está permitido enviar solicitudes falsas, datos de terceros sin autorización o contenido ofensivo, ni usar los datos de contacto recibidos para fines distintos de la solicitud.</p>
<h2>7. Profesionales</h2>
<p>Los profesionales se rigen además por las <a href="../condiciones-profesionales/">condiciones para profesionales</a>.</p>
<h2>8. Ley aplicable</h2>
<p>{PH('pendiente de revisión jurídica')}</p>
</article></div></main>
"""
    write("condiciones/index.html", head("Condiciones de uso (borrador) · OficioCerca", "Borrador provisional de las condiciones de uso de OficioCerca.", "condiciones/", p, noindex=True) + header(p) + body + footer(p))

def page_condiciones_profesionales():
    p = "../"
    body = f"""<main id="main"><div class="wrap"><section class="page-hero"><div class="crumbs"><a href="../">Inicio</a> / <a href="../profesionales/">Profesionales</a> / Condiciones</div><h1>Condiciones para profesionales</h1><p>Versión {PRO_COND_VERSION}</p></section>
<article class="legal">{LEGAL_NOTE}
<h2>1. Papel de OficioCerca</h2>
<p>OficioCerca actúa como intermediario entre clientes y profesionales independientes. No es empleador del profesional ni parte del contrato del trabajo. Titular: {PH('pendiente')}. Contacto: {MAIL}.</p>
<h2>2. Alta y revisión</h2>
<p>El registro es gratuito. Cada alta queda «Pendiente de revisar» y solo recibe oportunidades cuando OficioCerca la marca como «Activo». Para activarse es necesario haber aceptado esta versión de las condiciones (se registra la versión, la fecha y la hora). El registro no da derecho a un número mínimo de trabajos.</p>
<h2>3. Oportunidades</h2>
<p>El profesional solo recibe oportunidades de los servicios que declara, en su zona y para el tipo de cliente que atiende. Cada oportunidad llega por correo con una ficha sin datos del cliente y un botón para responder: «Puedo atenderlo» (indicando cuándo), «Puedo, pero más adelante» o «No puedo / no me interesa». Si no responde en el plazo indicado, la oportunidad se ofrece a otro profesional. El profesional decide libremente si quiere valorar una oportunidad.</p>
<p><strong>Aceptar una oportunidad significa:</strong> «Estoy interesado y tengo disponibilidad para contactar al cliente y valorar/presupuestar el trabajo». No significa que ya se haya comprometido jurídicamente a ejecutar toda la obra.</p>
<h2>4. Contacto, presupuesto y pago</h2>
<p>Si se le asigna la solicitud, recibe los datos de contacto del cliente, que solo puede usar para esa solicitud. El profesional fija su propio precio y registra su presupuesto a través del enlace de OficioCerca, indicando por separado la mano de obra, los materiales (si existen) y el total. El cliente acepta o no el presupuesto. Cliente y profesional acuerdan directamente la ejecución y el pago del trabajo. Durante este piloto OficioCerca no recibe ni custodia el dinero de la obra. El profesional es responsable de emitir el presupuesto o factura formal que legalmente corresponda.</p>
<h2>5. Tarifa de éxito (modelo piloto)</h2>
<p>La tarifa de OficioCerca es el <strong>10 % del importe de mano de obra aceptado por el cliente, con un máximo de 200 € por solicitud/trabajo</strong>. Los materiales no forman parte de la base. Fórmula: comisión = mínimo(mano de obra × 10 %, 200 €).</p>
<p>La tarifa solo nace cuando el <strong>cliente</strong> acepta un presupuesto registrado mediante OficioCerca. No se cobra por registrarse, por recibir una oportunidad, por rechazarla ni por enviar un presupuesto que no se acepta.</p>
<p><strong>Durante el piloto la tarifa solo se calcula y se registra: no se cobra.</strong> Su cobro real queda condicionado a definir el titular, la fiscalidad aplicable y la revisión legal, y se comunicará por escrito antes de aplicarse. {PH('condiciones de facturación y pago pendientes')}</p>
<p>El profesional debe declarar los importes de forma realista. Falsear deliberadamente los importes para evitar la tarifa puede provocar la revisión o suspensión de su alta.</p>
<h2>6. Calidad, incidencias y suspensiones</h2>
<p>Los clientes pueden valorar el servicio y comunicar incidencias. Una valoración negativa aislada no provoca una baja automática. Cada incidencia se registra y la revisa una persona. Ante una incidencia potencialmente grave (fraude, comportamiento peligroso, acoso, documentación falsa, uso indebido de datos o incumplimiento grave) OficioCerca puede aplicar una pausa preventiva mientras la revisa. Varias incidencias verificadas pueden suponer menor prioridad, pausa o baja. Se registra siempre el motivo, la fecha, la acción y la solicitud relacionada. No existen multas automáticas.</p>
<p>Cuando el cobro de la tarifa esté legalmente operativo, una tarifa vencida y no regularizada podrá impedir recibir nuevas oportunidades.</p>
<h2>7. Estados del profesional</h2>
<p>Pendiente de revisar · Activo · En revisión · Pausado · Baja. El profesional puede pedir la baja en cualquier momento escribiendo a {MAIL}.</p>
<h2>8. Ley aplicable</h2>
<p>{PH('pendiente de revisión jurídica')}</p>
</article></div></main>
"""
    write("condiciones-profesionales/index.html", head("Condiciones para profesionales (borrador) · OficioCerca", "Borrador provisional de las condiciones para profesionales de OficioCerca.", "condiciones-profesionales/", p, noindex=True) + header(p) + body + footer(p))

def page_gestion():
    """Página de los enlaces de los correos (botones de profesionales y clientes). El token va tras «#»."""
    p = "../"
    js = """<script>
(function(){
  var cfg=window.OC_CONFIG||{}, T=(location.hash||'').replace(/^#/,'');
  var box=document.getElementById('g-zona'), tit=document.getElementById('g-titulo'), msg=document.getElementById('msg');
  function post(o){return fetch(cfg.ENDPOINT,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(o),redirect:'follow'}).then(function(r){return r.json();});}
  window.ver=function(id){document.querySelectorAll('#gestion .panel').forEach(function(x){x.classList.add('hide')});var e=document.getElementById(id);if(e){e.classList.remove('hide');e.scrollIntoView({behavior:'smooth',block:'center'});}};
  window.val=function(id){var e=document.getElementById(id);return e?e.value:'';};
  window.enviar=function(p){var bs=box.querySelectorAll('button');bs.forEach(function(b){b.disabled=true});msg.className='';msg.textContent='Enviando…';
    post({tipo:'accion',t:T,p:p}).then(function(r){if(r&&r.ok){box.innerHTML='';msg.className='ok';msg.textContent=r.msg;}else{msg.className='err';msg.textContent=(r&&r.msg)||'No se pudo guardar.';bs.forEach(function(b){b.disabled=false});}})
    .catch(function(){msg.className='err';msg.textContent='No hemos podido guardar tu respuesta. Revisa tu conexión e inténtalo de nuevo.';bs.forEach(function(b){b.disabled=false});});};
  if(!/^[a-f0-9]{64}$/.test(T)||!cfg.ENDPOINT){tit.textContent='Enlace no válido';box.innerHTML='<p>Abre el botón directamente desde el correo que te enviamos.</p>';return;}
  post({tipo:'pagina',t:T}).then(function(r){tit.textContent=r.titulo||'OficioCerca';box.innerHTML=r.cuerpo||'';if(r.script){var s=document.createElement('script');s.text=r.script;document.body.appendChild(s);}})
  .catch(function(){tit.textContent='No se pudo cargar';box.innerHTML='<p>Revisa tu conexión y vuelve a abrir el enlace del correo.</p>';});
})();
</script>"""
    body = """<main id="main"><div class="wrap"><section id="gestion" class="g-box" aria-live="polite">
<h1 id="g-titulo">Cargando…</h1><div id="g-zona"><p class="nota">Un momento, por favor.</p></div><p id="msg" role="status"></p>
<p class="nota">¿Dudas? Escríbenos a <a href="mailto:oficiocerca@gmail.com">oficiocerca@gmail.com</a></p>
</section></div></main>
"""
    write("gestion/index.html", head("Tu solicitud · OficioCerca", "Gestión de solicitudes de OficioCerca.", "gestion/", p, noindex=True)
          .replace('<meta name="robots"', '<meta name="referrer" content="no-referrer">\n<meta name="robots"') + header(p) + body + footer(p, js))

def page_404():
    # 404 en GitHub Pages se sirve en cualquier ruta: usamos URLs absolutas del sitio.
    p = SITE
    body = """<main id="main"><section class="page-hero"><div class="wrap"><h1>Página no encontrada</h1><p>La página que buscas no existe o ha cambiado de dirección.</p><a class="btn btn-primary" href="%s">Ir al inicio</a></div></section></main>""" % SITE
    write("404.html", head("Página no encontrada · OficioCerca", "Página no encontrada.", "404.html", p, noindex=True) + header(p) + body + footer(p))

def data_js():
    js = ("/* GENERADO por tools/build.py desde assets/data/catalogo.json — no editar a mano. */\n"
          f"window.OC_OFICIOS = {json.dumps(OFICIOS, ensure_ascii=False)};\n"
          f"window.OC_CIUDADES = {json.dumps(CIUDADES, ensure_ascii=False)};\n"
          f"window.OC_TIPOS_TRABAJO = {json.dumps(TIPOS, ensure_ascii=False)};\n")
    write("assets/js/data.js", js)

def sitemap():
    urls = ["", "solicitar/", "profesionales/"] + [f"{c['slug']}/" for c in CIUDADES if c["activa"]]
    for pg in CAT.get("paginasOficioCiudad", []):
        o = next(x for x in OFICIOS if x["slug"] == pg["oficio"])
        urls.append(f"{pg['ciudad']}/{o['url']}/")
    body = "".join(f"<url><loc>{SITE}{u}</loc></url>" for u in urls)
    write("sitemap.xml", f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{body}</urlset>\n')
    write("robots.txt", f"User-agent: *\nAllow: /\nDisallow: /backend/\nDisallow: /tools/\n\nSitemap: {SITE}sitemap.xml\n")

if __name__ == "__main__":
    print("Generando OficioCerca…")
    data_js()
    page_home(); page_solicitar(); page_profesionales()
    for c in CIUDADES:
        if c["activa"]:
            page_ciudad(c)
    for pg in CAT.get("paginasOficioCiudad", []):
        page_oficio_ciudad(next(x for x in CIUDADES if x["slug"] == pg["ciudad"]), next(x for x in OFICIOS if x["slug"] == pg["oficio"]))
    page_privacidad(); page_condiciones(); page_condiciones_profesionales(); page_gestion(); page_404(); sitemap()
    print("Listo.")
