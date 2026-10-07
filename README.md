# OficioCerca — web V1 (piloto Córdoba)

- **URL pública del piloto:** https://oficiocerca.pages.dev (Cloudflare Pages, despliegue automático desde la rama `main`)
- **Respaldo técnico:** https://stymaster182-ship-it.github.io/oficiocerca/ (GitHub Pages)
- **Backend:** Google Apps Script (ver `backend/README.md`)

Profesionales para obras, reformas y reparaciones. Sitio estático para GitHub Pages, coste 0 €.

## Estructura

```
index.html                 Inicio
solicitar/                 Formulario de clientes (particular / empresa) + fotos + código OC
profesionales/             Registro de profesionales + código PRO
cordoba/                   Página de ciudad (zona piloto)
privacidad/ condiciones/   BORRADORES legales (pendientes de revisión, noindex)
404.html  robots.txt  sitemap.xml  favicon.svg
assets/css/styles.css
assets/js/config.js        ENDPOINT del backend, WhatsApp (vacío hasta tener número español)
assets/js/forms.js         Validación, compresión de fotos y envío
assets/data/catalogo.json  Servicios del piloto (5 + «Otro servicio»), ciudades y tipos de trabajo
backend/apps-script/       Backend gratuito (Google Apps Script) — ver backend/README.md
tools/build.py             Genera los HTML desde catalogo.json
```

## Tareas habituales

- **Añadir un oficio o ciudad:** edita `assets/data/catalogo.json` y ejecuta `python3 tools/build.py`.
- **Abrir una ciudad nueva:** `"activa": true` en la ciudad → build.
- **Crear páginas SEO** como `/cordoba/electricistas/`: añade a `paginasOficioCiudad`
  `{"ciudad": "cordoba", "oficio": "electricidad"}` → build (se añaden también al sitemap).
- **Activar WhatsApp:** pon el número español en `config.js` → `WHATSAPP: "346XXXXXXXX"`.
- **Dominio propio (más adelante):** cambia `SITE` en `tools/build.py` y `SITE_URL` en `config.js`, build, y añade el archivo `CNAME`.

## Sin coste y sin inventos

Sin pasarela de pagos, sin precios, sin reseñas ni cifras inventadas, sin cookies de analítica.
Los formularios no simulan envíos: si `ENDPOINT` está vacío, avisan de que no están conectados.
