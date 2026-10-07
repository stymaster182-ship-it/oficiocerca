# Backend gratuito de OficioCerca (Google Apps Script)

GitHub Pages solo sirve archivos estáticos. Para guardar solicitudes, fotos y códigos usamos
**Google Apps Script + Google Sheets + Google Drive** con la cuenta de Google del proyecto. Coste: 0 €.

## Qué crea

| Elemento | Para qué |
|---|---|
| Hoja «OficioCerca — Panel piloto» | Panel interno: pestañas Solicitudes, Profesionales y Estados |
| Carpeta «OficioCerca — Fotos de solicitudes» | Una subcarpeta por código (OC-0001, OC-0002…) |
| Web App (URL `/exec`) | Recibe los formularios y devuelve el código |

Los códigos son correlativos y sin duplicados (bloqueo `LockService` + contador en Script Properties).

## Puesta en marcha (una vez, ~10 minutos)

1. Entra en <https://script.google.com> con la cuenta de Google del proyecto → **Nuevo proyecto**.
2. Renombra el proyecto a `OficioCerca backend`.
3. Borra el contenido de `Código.gs` y pega `backend/apps-script/Code.gs`.
4. (Opcional) En Configuración del proyecto → marca «Mostrar el archivo de manifiesto» y pega `appsscript.json`.
5. Selecciona la función **`setup`** → **Ejecutar** → Google pedirá permisos:
   *Revisar permisos → elegir la cuenta → «Configuración avanzada» → «Ir a OficioCerca backend (no seguro)» → Permitir.*
   (El aviso «no verificada» aparece en todos los scripts propios; el script es tuyo y solo accede a tu Drive, tus hojas y tu correo.)
6. **Implementar → Nueva implementación → tipo «Aplicación web»**
   - Ejecutar como: **Yo**
   - Quién tiene acceso: **Cualquier usuario**
   → Implementar → copia la URL que termina en `/exec`.
7. Pega esa URL en `assets/js/config.js` → `ENDPOINT: "https://script.google.com/macros/s/…/exec"`.

La URL `/exec` es pública por diseño (es donde envía el formulario); no es una clave secreta.

## Límites del plan gratuito (cuenta personal de Google)

- Correos de aviso: ~100 destinatarios/día.
- Ejecución: máx. 6 min por envío (cada envío tarda 1-5 s).
- Drive: 15 GB compartidos con Gmail y Fotos. Cada foto llega comprimida (~100-400 KB).

## Si cambias el código

Implementar → **Gestionar implementaciones** → editar → versión «Nueva versión». Así la URL `/exec` no cambia.

## Estados de una solicitud

Nueva → Buscando profesional → Profesional asignado → Presupuesto enviado → Cliente aceptó →
Finalizado → Comisión pagada → Valoración recibida · (salida: Cancelado / Perdido, con motivo)

Se simplificaron los 14 estados propuestos a 9: «Contacto realizado», «En ejecución» o «Comisión pendiente»
son hechos que se anotan en columnas (fechas, importe, comisión), no pasos distintos.

## V1.2 — Asignar una solicitud y enviar la ficha al profesional

Preparación (una vez): en el editor de Apps Script ejecuta `prepararAsignacionV12` (añade columnas y el
activador `alEditarPanel`; Google pedirá autorizar «gestionar activadores»).

Uso diario en la hoja **Solicitudes**:

1. En **Profesionales**, el profesional debe estar en estado **Activo** y tener **Email**.
2. En la solicitud, escribe su código en **Profesional asignado (PRO)** → se rellenan *Nombre profesional*,
   *Correo profesional*, *Fecha asignación* y *Estado envío ficha* = «Listo para enviar».
3. Revisa nombre y correo y marca **Enviar ficha** → se envía 1 correo con la ficha y las fotos adjuntas
   (copia oculta a la cuenta propietaria), se rellena *Ficha enviada (fecha)* y la casilla se desmarca.

La ficha NO incluye nombre, teléfono, correo, empresa ni código postal del cliente. El contacto se comparte
a mano solo cuando el profesional confirma (respondiendo al correo).

Protecciones: no reenvía si ya hay *Ficha enviada (fecha)*; no cambia de profesional tras el envío
(para reasignar, borra a mano *Ficha enviada (fecha)*); exige profesional «Activo», correo válido y
consentimiento de compartir; si el correo del profesional cambió entre asignar y enviar, pide revisar.

Fotos: se adjuntan al correo desde la carpeta de ESA solicitud. No se cambian permisos de Drive y
ninguna carpeta se comparte (ni por enlace ni por correo).
