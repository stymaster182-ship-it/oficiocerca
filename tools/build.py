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
VERSION = "5"
CONSENT_VERSION = "C2-2026-10"  # cambia este código si cambias el texto del consentimiento
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
          <li><a href="{p}#como-funciona">Cómo funciona</a></li>
        </ul>
      </div>
      <div>
        <h2>Contacto</h2>
        <ul data-oc-contact>
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
    ("Cuéntanos qué necesitas", "Describe el trabajo y añade fotos si quieres. Es gratis."),
    ("Revisamos y buscamos", "Enviamos la información del trabajo a profesionales compatibles, sin tus datos de contacto."),
    ("Un profesional lo valora", "Si confirma que puede atenderlo, le facilitamos tu contacto y te escribe."),
    ("Presupuesto y seguimiento", "Acordáis visita y presupuesto; tú decides. Hacemos seguimiento hasta el final."),
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

HERO_ART = """<svg class="hero-art" viewBox="0 0 640 220" fill="none" aria-hidden="true" preserveAspectRatio="xMidYMax meet">
  <g stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round">
    <path d="M0 210h640"/>
    <path d="M30 210v-78l54-40 54 40v78"/><path d="M62 210v-34h44v34"/><rect x="58" y="128" width="20" height="18" rx="2"/><rect x="92" y="128" width="20" height="18" rx="2"/>
    <path d="M150 210V96h96v114"/><path d="M150 96l48-30 48 30"/><rect x="166" y="116" width="22" height="22" rx="2"/><rect x="208" y="116" width="22" height="22" rx="2"/><rect x="166" y="154" width="22" height="22" rx="2"/><path d="M208 210v-46h22v46"/>
    <path d="M262 210v-64h70v64"/><path d="M256 150l41-28 41 28"/><rect x="282" y="164" width="30" height="20" rx="2"/>
    <path d="M354 210V72h120v138"/><path d="M354 72h120"/><path d="M372 92h20v20h-20zM408 92h20v20h-20zM444 92h14v20h-14zM372 130h20v20h-20zM408 130h20v20h-20zM444 130h14v20h-14z"/><path d="M402 210v-38h28v38"/>
    <path d="M500 210v-58l40-30 40 30v58"/><rect x="522" y="160" width="36" height="24" rx="2"/>
    <path d="M598 210v-96M598 114h36M598 114l-18 14M620 114v18"/>
  </g>
</svg>"""

def page_home():
    p = ""
    c = ciudad_activa()
    ld = {"@context": "https://schema.org", "@graph": [
        {"@type": "Organization", "@id": SITE + "#org", "name": "OficioCerca", "url": SITE,
         "logo": SITE + "assets/img/apple-touch-icon.png",
         "description": "Servicio de intermediación que conecta a clientes y empresas con profesionales de obras, reformas y reparaciones.",
         "areaServed": {"@type": "City", "name": "Córdoba", "containedInPlace": {"@type": "Country", "name": "España"}}},
        {"@type": "WebSite", "@id": SITE + "#web", "name": "OficioCerca", "url": SITE, "inLanguage": "es-ES", "publisher": {"@id": SITE + "#org"}}]}
    principales = [o for o in OFICIOS if o["slug"] != "otro"]
    body = f"""<main id="main">
<section class="hero">
  <div class="hero-bg" aria-hidden="true"><span class="blob b1"></span><span class="blob b2"></span><span class="blob b3"></span></div>
  {HERO_ART}
  <div class="wrap hero-grid">
    <div class="hero-copy">
      <span class="pill"><span class="dot" aria-hidden="true"></span>Disponible inicialmente en {e(c['nombre'])}</span>
      <h1>Encuentra al profesional que <em>necesita tu proyecto</em></h1>
      <p class="lead">Cuéntanos qué trabajo necesitas. Buscamos un profesional disponible en tu zona y te acompañamos hasta el final.</p>
      <div class="hero-ctas">
        <a class="btn btn-primary btn-lg" href="solicitar/?tipo=particular">Solicitar profesional {ico('arrow')}</a>
        <a class="btn btn-ghost btn-lg" href="profesionales/">Soy profesional</a>
      </div>
      <a class="hero-b2b" href="solicitar/?tipo=empresa"><span class="hb-k">Empresas y contratistas</span><span class="hb-t">¿Te falta un oficio para terminar una obra? Solicítalo aquí</span>{ico('arrow')}</a>
    </div>
    <aside class="req-card" aria-label="Ilustración de cómo se sigue una solicitud">
      <div class="req-head"><span class="tag">Así se sigue una solicitud</span><span class="req-code">OC-····</span></div>
      <div class="req-row">{ico('drop')}<div><strong>Fontanería · Reparación</strong><small>Zona, descripción y fotos opcionales</small></div></div>
      <ul class="req-steps">
        <li class="done"><span class="st">{ico('check')}</span>Solicitud recibida</li>
        <li class="done"><span class="st">{ico('check')}</span>Solicitud revisada</li>
        <li class="now"><span class="st"></span>Buscando profesional disponible</li>
        <li class="todo"><span class="st"></span>Presupuesto del profesional</li>
        <li class="todo"><span class="st"></span>Seguimiento y valoración</li>
      </ul>
      <p class="req-note">Ilustración del proceso. No es una solicitud real.</p>
    </aside>
  </div>
</section>

<section class="aud-sec" aria-labelledby="quien">
  <div class="wrap">
    <h2 id="quien" class="sr-only">¿Quién eres?</h2>
    <div class="aud">
      <a class="aud-card" data-reveal href="solicitar/?tipo=particular">
        <span class="k">Particular</span>
        <h3>Necesito un arreglo o una reforma</h3>
        <p>Cuéntanos el trabajo y buscamos un profesional disponible en tu zona.</p>
        <span class="go">Solicitar profesional {ico('arrow')}</span>
      </a>
      <a class="aud-card featured" data-reveal href="solicitar/?tipo=empresa">
        <span class="k">Empresa / contratista</span>
        <h3>Me falta un oficio en una obra</h3>
        <p>Para contratistas, reformistas y administradores de fincas.</p>
        <span class="go">Solicitar profesional {ico('arrow')}</span>
      </a>
      <a class="aud-card" data-reveal href="profesionales/">
        <span class="k">Profesional</span>
        <h3>Quiero recibir trabajos</h3>
        <p>Regístrate y recibe oportunidades de tu oficio y zona.</p>
        <span class="go">Registrarme {ico('arrow')}</span>
      </a>
    </div>
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
      <h2 id="h-como">Cuatro pasos, con seguimiento</h2>
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
      <div class="why-item" data-reveal>{ico('gear')}<h3>Solicitudes revisadas</h3><p>Revisamos cada solicitud antes de enviarla a un profesional.</p></div>
      <div class="why-item" data-reveal>{ico('home')}<h3>Según oficio y zona</h3><p>Buscamos profesionales compatibles con tu trabajo y tu barrio.</p></div>
      <div class="why-item" data-reveal>{ico('check')}<h3>Seguimiento con código</h3><p>Cada solicitud tiene su código. Las futuras valoraciones estarán ligadas a trabajos reales.</p></div>
    </div>
  </div>
</section>

<section class="sec sec-tight">
  <div class="wrap">
    <div class="cta-band" data-reveal>
      <div><h2>Cuéntanos qué necesitas</h2><p>Piloto en Córdoba capital. Solicitud gratuita y sin compromiso.</p></div>
      <div class="row">
        <a class="btn btn-light" href="solicitar/?tipo=particular">Soy particular</a>
        <a class="btn btn-light" href="solicitar/?tipo=empresa">Soy empresa</a>
        <a class="btn btn-dark-on" href="profesionales/">Soy profesional</a>
      </div>
    </div>
  </div>
</section>
</main>
"""
    write("index.html", head("OficioCerca · Profesionales para obras, reformas y reparaciones",
                             "Cuéntanos qué trabajo necesitas y buscamos profesionales disponibles para tu obra, reforma o reparación. Piloto en Córdoba capital. Solicitud gratuita y con seguimiento.",
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

def page_solicitar():
    p = "../"
    c = ciudad_activa()
    tipos = "".join(f'<option value="{e(t)}">{e(t)}</option>' for t in TIPOS)
    body = f"""<main id="main">
<section class="page-hero"><div class="wrap">
  <div class="crumbs"><a href="../">Inicio</a> / Solicitar profesional</div>
  <h1>Solicitar un profesional</h1>
  <p>Cuéntanos qué necesitas. Revisamos tu solicitud, buscamos profesionales disponibles en {e(c['nombre'])} y te contactamos para continuar. Es gratuito y sin compromiso.</p>
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
        <div class="grid2">
          <div class="field"><label for="s-wa">WhatsApp <span class="req">*</span></label><input id="s-wa" name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" required placeholder="600 000 000" data-phone><span class="hint">Te escribiremos por aquí para continuar.</span><span class="err-msg">Revisa el número (9 dígitos o con prefijo +).</span></div>
          <div class="field"><label for="s-tel2">Teléfono alternativo <span class="opt">(opcional)</span></label><input id="s-tel2" name="telefonoAlt" type="tel" inputmode="tel" data-phone-optional><span class="err-msg">Revisa el número.</span></div>
        </div>
        <div class="field"><label for="s-email">Correo electrónico <span class="opt">(opcional)</span></label><input id="s-email" name="email" type="email" autocomplete="email" maxlength="160"><span class="err-msg">Revisa el correo.</span></div>
      </fieldset>

      <fieldset>
        <legend><span class="n">2</span>Qué necesitas</legend>
        <div class="field"><label for="s-oficio">Servicio que necesitas <span class="req">*</span></label><select id="s-oficio" name="oficio" required>{oficio_opts()}</select><span class="err-msg">Elige un servicio (o «Otro servicio»).</span></div>
        <div class="field otro-box" data-show-if="oficio=otro"><label for="s-otro">¿Qué servicio o profesional necesitas? <span class="req">*</span></label><input id="s-otro" name="oficioOtro" type="text" maxlength="120" data-required-if="oficio=otro" placeholder="Ej.: marmolista, cerrajero…"><span class="hint">Revisaremos si hay profesionales disponibles en {e(c['nombre'])} y te contactaremos para informarte.</span><span class="err-msg">Indica qué servicio o profesional necesitas.</span></div>
        <div class="field"><label for="s-desc">Describe el trabajo <span class="req">*</span></label><textarea id="s-desc" name="descripcion" required minlength="10" maxlength="3000" placeholder="Qué ha pasado o qué quieres hacer. Si puedes: medidas, materiales o plazos."></textarea><span class="hint"><span data-count="s-desc">0</span>/3000</span><span class="err-msg">Describe brevemente el trabajo (mínimo 10 caracteres).</span></div>
        <div class="field"><label for="s-tipo">Tipo de trabajo <span class="opt">(opcional)</span></label><select id="s-tipo" name="tipoTrabajo"><option value="">Sin especificar</option>{tipos}</select></div>
        <fieldset class="choice-group">
          <legend class="label">Prioridad <span class="opt">(opcional)</span></legend>
          <div class="choices c2">
            <label class="choice"><input type="radio" name="prioridad" value="Normal" checked><span>Normal<small>En los próximos días o semanas</small></span></label>
            <label class="choice"><input type="radio" name="prioridad" value="Prioritaria"><span>Prioritaria<small>Lo antes posible</small></span></label>
          </div>
          <span class="hint">En el piloto no ofrecemos servicio de urgencias inmediatas.</span>
        </fieldset>
      </fieldset>

      <fieldset>
        <legend><span class="n">3</span>Dónde es el trabajo</legend>
        <p class="fs-help">Zona piloto: {e(c['nombre'])} capital. La dirección exacta te la pediremos por WhatsApp si hace falta.</p>
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
          <p>Puedes adjuntar hasta 5 fotos para ayudarnos a entender mejor el trabajo.</p>
          <label class="btn btn-ghost btn-sm" for="s-fotos">Añadir fotos</label>
          <input id="s-fotos" type="file" accept="image/*" multiple class="sr-only" data-photo-input>
          <div class="photo-list" data-photo-list aria-live="polite"></div>
          <p class="hint" data-photo-msg style="margin:10px 0 0"></p>
        </div>
      </fieldset>

      <fieldset>
        <legend><span class="n">5</span>Contacto y autorizaciones</legend>
        <fieldset class="choice-group">
          <legend class="label">¿Cómo prefieres que te contactemos? <span class="opt">(opcional)</span></legend>
          <div class="choices c3">
            <label class="choice"><input type="radio" name="contactoPreferido" value="WhatsApp" checked><span>WhatsApp</span></label>
            <label class="choice"><input type="radio" name="contactoPreferido" value="Llamada"><span>Llamada</span></label>
            <label class="choice"><input type="radio" name="contactoPreferido" value="Correo"><span>Correo</span></label>
          </div>
        </fieldset>
        {consent_block("s", [
            ("consentContacto", "Autorizo a OficioCerca a ponerse en contacto conmigo para gestionar esta solicitud. <span class=\"req\">*</span>"),
            ("consentCompartir", "Autorizo a OficioCerca a compartir con uno o más profesionales seleccionados la información necesaria para valorar mi solicitud: servicio, zona o barrio, descripción del trabajo y las fotos que adjunte. Mis datos de contacto no se compartirán hasta que un profesional confirme que puede atender la solicitud. <span class=\"req\">*</span>"),
            ("consentPrivacidad", "He leído la <a href=\"../privacidad/\" target=\"_blank\" rel=\"noopener\">política de privacidad</a> y las <a href=\"../condiciones/\" target=\"_blank\" rel=\"noopener\">condiciones de uso</a>. <span class=\"req\">*</span>")])}
      </fieldset>

      <div class="submit-row">
        <button class="btn btn-primary btn-block" type="submit"><span class="spinner" aria-hidden="true"></span><span data-btn-label>Enviar solicitud</span></button>
        <span class="hint">Gratis y sin compromiso. Para valorar el trabajo solo enviamos la información del trabajo; tus datos de contacto, únicamente al profesional que confirme que puede atenderlo.</span>
      </div>
      <div class="form-status" role="alert" data-status></div>
    </form>

    <div class="success" data-success tabindex="-1">
      <div class="badge">{ico('check')}</div>
      <h2>Solicitud recibida</h2>
      <p>Estamos revisando tu solicitud y buscando un profesional disponible para tu zona.</p>
      <div class="ticket"><small>Tu código de solicitud</small><strong data-code>—</strong></div>
      <p>OficioCerca te mantendrá informado sobre el proceso. Guarda este código para cualquier consulta.</p>
      <div class="next"><strong>Próximos pasos</strong><ol><li>Revisamos los datos y, si falta algo, te escribimos.</li><li>Revisamos la disponibilidad de profesionales para tu zona y trabajo.</li><li>Te contactamos para informarte y continuar el proceso.</li></ol></div>
      <a class="btn btn-ghost" href="../">Volver al inicio</a>
    </div>
  </div>

  <aside class="aside-sticky">
    <div class="aside-card">
      <h2>Qué pasa después</h2>
      <ol><li>Recibes un código de solicitud.</li><li>Revisamos y buscamos disponibilidad.</li><li>Enviamos la información del trabajo (sin tus datos de contacto) a profesionales compatibles.</li><li>Si uno confirma que puede atenderlo, le facilitamos tu contacto y te escribe.</li><li>Tú decides si aceptas su presupuesto. Hacemos seguimiento.</li></ol>
      <p>La disponibilidad no está garantizada: en el piloto revisamos cada solicitud. El presupuesto y el pago son directamente con el profesional.</p>
    </div>
  </aside>
</div>
</main>
"""
    write("solicitar/index.html", head("Solicitar un profesional · OficioCerca",
          f"Formulario para solicitar electricista, fontanero, marmolista u otro profesional en {c['nombre']}. Gratis, con seguimiento y hasta 5 fotos.",
          "solicitar/", p) + header(p) + body + footer(p, f'<script src="{p}assets/js/forms.js?v={VERSION}" defer></script>'))

def page_profesionales():
    p = "../"
    profs = options([(o["slug"], o["profesional"] if o["slug"] != "otro" else "Otro oficio") for o in OFICIOS], "Selecciona tu oficio principal")
    body = f"""<main id="main">
<section class="page-hero"><div class="wrap">
  <div class="crumbs"><a href="../">Inicio</a> / Profesionales</div>
  <h1>Únete a OficioCerca</h1>
  <p>Recibe oportunidades compatibles con tu oficio y zona. Te enviamos una ficha del trabajo y tú decides si la aceptas.</p>
</div></section>
<div class="wrap form-layout">
  <div class="form-card">
    <form id="form-profesional" data-oc-form="profesional" novalidate>
      <div class="hp" aria-hidden="true"><label>No rellenar <input type="text" name="web" tabindex="-1" autocomplete="off"></label></div>
      <fieldset>
        <legend><span class="n">1</span>Tus datos</legend>
        <div class="grid2">
          <div class="field"><label for="p-nombre">Nombre y apellidos <span class="req">*</span></label><input id="p-nombre" name="nombre" type="text" autocomplete="name" required maxlength="120"><span class="err-msg">Escribe tu nombre.</span></div>
          <div class="field"><label for="p-empresa">Empresa o autónomo <span class="opt">(si aplica)</span></label><input id="p-empresa" name="empresa" type="text" autocomplete="organization" maxlength="120"></div>
        </div>
        <div class="grid2">
          <div class="field"><label for="p-wa">WhatsApp <span class="req">*</span></label><input id="p-wa" name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" required data-phone><span class="err-msg">Revisa el número.</span></div>
          <div class="field"><label for="p-tel">Teléfono <span class="opt">(si es distinto)</span></label><input id="p-tel" name="telefono" type="tel" inputmode="tel" data-phone-optional><span class="err-msg">Revisa el número.</span></div>
        </div>
        <div class="field"><label for="p-email">Correo electrónico <span class="req">*</span></label><input id="p-email" name="email" type="email" autocomplete="email" maxlength="160" required><span class="hint">Aquí recibirás las fichas de trabajo con sus fotos.</span><span class="err-msg">Escribe un correo válido: lo usamos para enviarte las fichas.</span></div>
      </fieldset>
      <fieldset>
        <legend><span class="n">2</span>Tu oficio</legend>
        <div class="grid2">
          <div class="field"><label for="p-prof">Profesión principal <span class="req">*</span></label><select id="p-prof" name="profesion" required>{profs}</select><span class="err-msg">Elige tu oficio.</span></div>
          <div class="field"><label for="p-exp">Años de experiencia <span class="req">*</span></label><select id="p-exp" name="experiencia" required><option value="">Selecciona</option><option>Menos de 2 años</option><option>2 a 5 años</option><option>6 a 10 años</option><option>Más de 10 años</option></select><span class="err-msg">Elige una opción.</span></div>
        </div>
        <div class="field" data-show-if="profesion=otro"><label for="p-otro">¿Cuál es tu oficio? <span class="req">*</span></label><input id="p-otro" name="profesionOtro" type="text" maxlength="120" data-required-if="profesion=otro"><span class="err-msg">Indica tu oficio.</span></div>
        <div class="field"><label for="p-esp">Especialidades <span class="opt">(opcional)</span></label><input id="p-esp" name="especialidades" type="text" maxlength="300" placeholder="Ej.: boletines, cuadros eléctricos, encimeras de cuarzo…"></div>
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
          <div class="field"><label for="p-disp">Disponibilidad <span class="req">*</span></label><select id="p-disp" name="disponibilidad" required><option value="">Selecciona</option><option>Esta semana</option><option>En 1-2 semanas</option><option>Solo trabajos puntuales</option><option>Agenda completa, pero me interesa</option></select><span class="err-msg">Elige una opción.</span></div>
        </div>
        <div class="grid2">
          <fieldset class="choice-group" data-required-group="conParticulares"><legend class="label">¿Trabajas con particulares? <span class="req">*</span></legend><div class="choices c2"><label class="choice"><input type="radio" name="conParticulares" value="Sí" required><span>Sí</span></label><label class="choice"><input type="radio" name="conParticulares" value="No"><span>No</span></label></div><span class="err-msg">Elige una opción.</span></fieldset>
          <fieldset class="choice-group" data-required-group="conEmpresas"><legend class="label">¿Con empresas y contratistas? <span class="req">*</span></legend><div class="choices c2"><label class="choice"><input type="radio" name="conEmpresas" value="Sí" required><span>Sí</span></label><label class="choice"><input type="radio" name="conEmpresas" value="No"><span>No</span></label></div><span class="err-msg">Elige una opción.</span></fieldset>
        </div>
      </fieldset>
      <fieldset>
        <legend><span class="n">4</span>Autorizaciones</legend>
        <p class="fs-help">Documentación, seguros, acreditaciones y fotos de trabajos te los pediremos más adelante, solo si hacen falta para tu oficio.</p>
        {consent_block("p", [
            ("consentContacto", "Autorizo a OficioCerca a contactarme por WhatsApp, llamada o correo para ofrecerme trabajos y gestionar mi alta. <span class=\"req\">*</span>"),
            ("consentPrivacidad", "He leído la <a href=\"../privacidad/\" target=\"_blank\" rel=\"noopener\">política de privacidad</a> y las <a href=\"../condiciones/\" target=\"_blank\" rel=\"noopener\">condiciones de uso</a>. <span class=\"req\">*</span>")])}
      </fieldset>
      <div class="submit-row">
        <button class="btn btn-primary btn-block" type="submit"><span class="spinner" aria-hidden="true"></span><span data-btn-label>Quiero recibir trabajos</span></button>
        <span class="hint">El registro es gratuito. Las condiciones económicas se informan y aceptan antes de recibir trabajos.</span>
      </div>
      <div class="form-status" role="alert" data-status></div>
    </form>
    <div class="success" data-success tabindex="-1">
      <div class="badge">{ico('check')}</div>
      <h2>Registro recibido</h2>
      <p>Gracias por querer formar parte de OficioCerca. Revisaremos tus datos y te contactaremos para completar el alta.</p>
      <div class="ticket"><small>Tu código de profesional</small><strong data-code>—</strong></div>
      <div class="next"><strong>Próximos pasos</strong><ol><li>Te contactamos para conocerte y explicarte las condiciones.</li><li>Si encaja, te enviamos fichas de trabajos compatibles.</li><li>Tú decides cuáles aceptas.</li></ol></div>
      <a class="btn btn-ghost" href="../">Volver al inicio</a>
    </div>
  </div>
  <aside class="aside-sticky">
    <div class="aside-card">
      <h2>Cómo funciona para ti</h2>
      <ol><li>Te damos de alta tras una breve llamada.</li><li>Recibes por correo una ficha: servicio, zona, prioridad, descripción y fotos (sin datos del cliente).</li><li>Respondes al correo indicando si puedes atenderlo.</li><li>Si confirmas, te pasamos el contacto del cliente.</li><li>Tú presupuestas y cobras directamente al cliente.</li></ol>
      <p>En el piloto inicial solo existe coste cuando un trabajo gestionado por OficioCerca se concreta. Las condiciones económicas se informan y aceptan antes de recibir trabajos.</p>
    </div>
  </aside>
</div>
</main>
"""
    write("profesionales/index.html", head("Profesionales: recibe trabajos de tu oficio · OficioCerca",
          "Únete a la red de OficioCerca y recibe oportunidades de trabajo compatibles con tu oficio y zona. Registro gratuito. Piloto en Córdoba.",
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

def page_privacidad():
    p = "../"
    body = f"""<main id="main"><div class="wrap"><section class="page-hero"><div class="crumbs"><a href="../">Inicio</a> / Privacidad</div><h1>Política de privacidad</h1></section>
<article class="legal">{LEGAL_NOTE}
<h2>1. Responsable del tratamiento</h2>
<p>Titular: {PH('nombre completo o razón social pendiente')}. Identificación fiscal: {PH('pendiente')}. Correo de contacto para privacidad: {PH('correo pendiente')}. País de establecimiento: {PH('pendiente')}.</p>
<h2>2. Qué datos tratamos</h2>
<p>Clientes: nombre, WhatsApp, zona o barrio, servicio y descripción del trabajo (obligatorios); y, si el usuario los indica, empresa, teléfono alternativo, correo, código postal, tipo de trabajo, prioridad, preferencia de contacto y fotografías.</p>
<p>Profesionales: nombre, profesión, WhatsApp, correo, ciudad, código postal, zonas de trabajo, distancia, experiencia y disponibilidad (obligatorios); y, si los indica, empresa, especialidades y descripción.</p>
<p>Además guardamos la fecha de cada solicitud, la versión del texto de consentimiento aceptado y un registro interno de envíos (qué ficha o contacto se envió, a qué profesional, cuándo y su respuesta), para poder demostrar qué se compartió y con quién.</p>
<p>Recomendamos no incluir en las fotos personas, documentos ni datos que no sean necesarios para valorar el trabajo.</p>
<h2>3. Para qué los usamos</h2>
<p>Revisar la solicitud, buscar un profesional compatible por oficio y zona, enviarle la información necesaria para valorarla, facilitar el contacto cuando confirme que puede atenderla y hacer seguimiento del resultado. En el caso de profesionales, revisar su alta y enviarles oportunidades de su oficio y zona.</p>
<h2>4. Base legal</h2>
<p>El consentimiento expreso otorgado en los formularios y la gestión de la solicitud a petición del propio interesado. {PH('revisar con asesor jurídico')}</p>
<h2>5. Con quién se comparten</h2>
<p>Cada solicitud la revisa una persona de OficioCerca, que decide manualmente a qué profesional enviarla; nada se envía de forma automática. El reparto se hace en dos momentos:</p>
<ul>
<li><strong>Para valorar el trabajo:</strong> se envía por correo a uno o más profesionales seleccionados (uno cada vez) una ficha con el servicio, la zona o barrio, el tipo de trabajo, la prioridad, la descripción y las fotos adjuntas. La ficha no incluye nombre, empresa, teléfono, correo ni código postal del cliente.</li>
<li><strong>Si un profesional confirma que puede atenderlo:</strong> solo a ese profesional se le envían los datos de contacto del cliente (nombre, empresa si la hay, teléfonos, correo, preferencia de contacto, zona y código postal). Si un profesional no puede atenderlo, no recibe esos datos.</li>
</ul>
<p>Las fotos se envían únicamente como adjuntos de ese correo. Las carpetas donde se guardan son privadas y no se comparten por enlace. Una vez enviado un correo, su copia queda en el buzón del profesional y OficioCerca no puede retirarla.</p>
<p>Los datos se almacenan y los correos se envían mediante servicios de Google {PH('revisar transferencias internacionales y garantías aplicables')}. No vendemos datos a terceros.</p>
<h2>6. Cuánto tiempo los conservamos</h2>
<p>{PH('plazo pendiente; propuesta: solicitudes no gestionadas, 6 meses; solicitudes gestionadas, el tiempo necesario para el seguimiento y obligaciones legales')}.</p>
<h2>7. Tus derechos</h2>
<p>Puedes solicitar acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a {PH('correo pendiente')}, y presentar una reclamación ante la Agencia Española de Protección de Datos (aepd.es).</p>
<h2>8. Cookies</h2>
<p>Este sitio no utiliza cookies de analítica ni publicidad en esta versión. Si se añadieran, se informará y se pedirá consentimiento cuando corresponda.</p>
</article></div></main>
"""
    write("privacidad/index.html", head("Política de privacidad (borrador) · OficioCerca", "Borrador provisional de la política de privacidad de OficioCerca.", "privacidad/", p, noindex=True) + header(p) + body + footer(p))

def page_condiciones():
    p = "../"
    body = f"""<main id="main"><div class="wrap"><section class="page-hero"><div class="crumbs"><a href="../">Inicio</a> / Condiciones</div><h1>Condiciones de uso</h1></section>
<article class="legal">{LEGAL_NOTE}
<h2>1. Qué es OficioCerca</h2>
<p>OficioCerca es un servicio, actualmente en fase piloto, que pone en contacto a personas y empresas que necesitan un trabajo de obra, reforma, reparación o mantenimiento con profesionales independientes que pueden atenderlo. Titular: {PH('pendiente')}.</p>
<h2>2. Papel de OficioCerca</h2>
<p>OficioCerca actúa como intermediario. No ejecuta obras, no fija precios de los trabajos, no emite presupuestos de los trabajos y no cobra ni procesa los pagos de los trabajos. El contrato del trabajo se establece directamente entre el cliente y el profesional, que es responsable de su ejecución, sus permisos, garantías y seguros.</p>
<h2>3. Para clientes</h2>
<p>La solicitud es gratuita y no obliga a aceptar ningún presupuesto. OficioCerca revisa cada solicitud y puede ofrecerla a uno o más profesionales, de uno en uno, hasta que alguno confirme que puede atenderla. Los datos de contacto del cliente solo se facilitan al profesional que confirme. OficioCerca no garantiza que exista un profesional disponible para todas las solicitudes, ni plazos de atención inmediata.</p>
<h2>4. Para profesionales</h2>
<p>El registro es gratuito y queda pendiente de revisión: no da derecho a recibir un número mínimo de trabajos. El profesional recibe por correo fichas de trabajo sin datos del cliente y responde si puede atenderlas; solo si confirma recibe los datos de contacto, que debe usar exclusivamente para ese trabajo. Las condiciones económicas aplicables a los trabajos gestionados se informan y aceptan por escrito antes de recibir trabajos. {PH('condiciones económicas pendientes de definir')}</p>
<h2>5. Seguimiento y valoraciones</h2>
<p>OficioCerca puede contactar a ambas partes para conocer el estado y resultado de la solicitud. Las valoraciones solo pueden proceder de solicitudes gestionadas a través de OficioCerca.</p>
<h2>6. Uso correcto</h2>
<p>No está permitido enviar solicitudes falsas, datos de terceros sin autorización o contenido ofensivo.</p>
<h2>7. Ley aplicable</h2>
<p>{PH('pendiente de revisión jurídica')}</p>
</article></div></main>
"""
    write("condiciones/index.html", head("Condiciones de uso (borrador) · OficioCerca", "Borrador provisional de las condiciones de uso de OficioCerca.", "condiciones/", p, noindex=True) + header(p) + body + footer(p))

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
    page_privacidad(); page_condiciones(); page_404(); sitemap()
    print("Listo.")
