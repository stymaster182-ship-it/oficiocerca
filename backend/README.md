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

## V1.3 — Flujo operativo (asignar, enviar ficha, respuesta, contacto)

Preparación (una vez): ejecuta `prepararV13` (columnas, desplegable de respuesta, casillas, pestaña
«Historial envíos» y activador `alEditarPanel`). Diagnóstico: `estadoPiloto` (cuota real de correo
`MailApp.getRemainingDailyQuota`, contadores, filas, activador). Reinicio: `reiniciarContadoresPiloto`
(se niega si quedan filas en Solicitudes, Profesionales o Historial).

Uso diario en **Solicitudes** (nada se envía al cambiar una celda salvo que marques una casilla):

1. Escribe el código en **Profesional asignado (PRO)** → se rellenan nombre y correo (profesional «Activo»).
2. Marca **Enviar ficha** → 1 correo SIN datos de contacto del cliente, con las fotos adjuntas.
   Respuesta profesional = «Pendiente». Queda una fila en «Historial envíos».
3. Anota la **Respuesta profesional**: Pendiente / Aceptó / Rechazó / Sin respuesta.
4. Solo con «Aceptó» (en la fila y en el historial), marca **Enviar contacto** → correo con los datos
   de contacto del cliente a ese profesional. Estado = «Profesional asignado».
5. Reasignar: escribe otro PRO. El historial no se borra. Reenviar a la misma pareja OC+PRO exige
   marcar **Reenviar ficha**.

Bloqueos: duplicado OC+PRO, contacto sin «Aceptó», contacto ya enviado, profesional no activo,
correo inválido o cambiado, sin consentimiento, cuota insuficiente (cada envío usa 2: destinatario + copia oculta).

Fotos: se adjuntan desde la carpeta de ESA solicitud. No se cambian permisos de Drive; ninguna carpeta se comparte.
