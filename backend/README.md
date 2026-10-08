# Backend de OficioCerca V1.6 (Google Apps Script · cuenta oficiocerca@gmail.com)

Coste 0 €. Todo vive en el Drive de **oficiocerca@gmail.com**, carpeta `OFICIOCERCA`:

| Elemento | Dónde |
|---|---|
| Hoja operativa «OficioCerca — Operación» + script vinculado | `01 - Operación` |
| Fotos de clientes (una subcarpeta privada por OC) | `02 - Fotos de solicitudes` |
| Respaldos (zip del repositorio + copia de la hoja) | `04 - Respaldos` |

El código está en `backend/apps-script/src/*.gs` y se une en `backend/apps-script/Code.gs`
(`cat src/*.gs > Code.gs`). Es el archivo que se pega en el editor de Apps Script.

## Instalación (una vez)

1. Crear la hoja en `01 - Operación` → Extensiones → Apps Script → pegar `Code.gs`.
2. Configuración del proyecto → zona horaria `Europe/Madrid`.
3. Ejecutar `instalarV16` (incluye `instalarV14`, la migración V1.6 y las claves de cobro; idempotente) (autorizar permisos con la cuenta oficiocerca@gmail.com).
4. Implementar → Nueva implementación → Aplicación web · Ejecutar como **Yo** · Acceso **Cualquier usuario**.
5. Copiar la URL `/exec` en: pestaña Configuración → `URL_APP`, y en `assets/js/config.js` → `ENDPOINT`.
6. Para cambios de código: Gestionar implementaciones → editar → Nueva versión (la URL no cambia).

## Flujo automático

1. Solicitud web → código OC + correo de confirmación al cliente.
2. Matching por reglas (sin IA): servicio declarado, Activo, condiciones aceptadas, zona/distancia,
   tipo de cliente; orden por zona, disponibilidad habitual, historial y rotación (ver `04-motor.gs`).
3. Oferta **secuencial** al mejor candidato: ficha sin datos de contacto + fotos adjuntas + botón.
4. Respuesta con botón (token aleatorio de 64 hex, solo se guarda su SHA-256, caduca):
   - puede dentro del plazo del cliente → **se asigna** y se envía el contacto automáticamente;
   - puede más tarde → **respaldo** y se sigue buscando;
   - no puede / no responde a tiempo (4 h urgentes, 24 h resto) → siguiente candidato.
5. Sin más candidatos y con respaldo → el cliente elige: continuar · seguir buscando · cancelar.
6. Profesional: «Ya hablé con el cliente / Registrar acuerdo» (mano de obra, materiales, fecha acordada, nota) →
   «Acuerdo pendiente del cliente». Cada cambio = nueva versión en «Presupuestos» que el cliente debe reconfirmar.
7. Cliente: «Confirmar acuerdo» / «No estoy de acuerdo» → «Acuerdo confirmado» (o «Trabajo en proceso» al llegar la fecha).
8. Profesional: «Trabajo terminado» → cliente: «Sí» / «Todavía no» / «Hay un problema» (doble cierre).
9. SOLO con el «Sí» del cliente nace la comisión (`12-v16.gs → comisionV16_`, fórmula única):
   10 % de los primeros 2.000 € de mano de obra + 5 % del exceso, sin tope, materiales excluidos
   (1.000→100 · 2.000→200 · 3.000→250 · 5.000→350 · 10.000→600). Sin cobro habilitado queda `NO_HABILITADA`
   (no bloquea) y el servicio pasa a «Cerrado»; con cobro, `DUE` → «Comisión pendiente» → pago Wompi → `PAID` → «Cerrado».
10. Valoración 1–5 en la misma página de seguimiento (no cambia el estado).

## Activadores

- `alEditar` (al editar la hoja): activar/pausar profesionales, pausa preventiva, oferta manual, cancelaciones.
- `procesarPendientes` (cada minuto; sale al instante si no hay nada): cola de correo y matching de solicitudes nuevas.
- `cicloAutomatico` (cada 10 min): cola de correo, vencimientos, nuevas búsquedas, recordatorios (máx. uno por acción), «Trabajo en proceso», métricas, PANEL.
- Si Google deshabilita un activador: ejecutar `repararActivadoresV16` (los borra y recrea uno de cada, sin duplicados).
- `resumenDiario` (8:00 Madrid): un único correo al administrador, solo si hay actividad o pendientes.

## Correo

Remitente: OficioCerca &lt;oficiocerca@gmail.com&gt;. Sin copia oculta (evidencia = pestaña «Historial envíos»).
Antes de cada envío se consulta `MailApp.getRemainingDailyQuota()`; si no alcanza queda «Pendiente por cuota»
y se reintenta. Cada correo tiene una clave única: nunca se duplica.

## Utilidades

- `estadoSistema` — diagnóstico (cuota real, contadores, filas, activadores).
- `limpiarDatosDePrueba` — borra filas y fotos SOLO si todos los registros son de prueba (nombre con «PRUEBA») y pone SEQ a 0.
- `respaldoV13PreMigracion` / `respaldoV14PostMigracion` — respaldos en `04 - Respaldos`.

## Rollback a V1.3

Poner en `assets/js/config.js` el ENDPOINT antiguo (ver etiqueta GitHub `OFICIOCERCA-V1.3-PRE-MIGRACION`
y `04 - Respaldos/OFICIOCERCA-V1.3-PRE-MIGRACION/LEEME.txt`) y subirlo a `main`. El backend antiguo no se ha borrado.

## Novedades V1.5 (cierre del piloto)

- **Respuesta rápida del formulario:** `doPost` guarda la solicitud y las fotos y responde al momento.
  Correos y matching se procesan en segundo plano con un único activador `procesarPendientes` (cada minuto,
  sale al instante si no hay nada pendiente: no crea activadores por solicitud).
- **Servicios activos:** Electricidad, Fontanería, Marmolería, Carpintería y ebanistería, Pintura y «Otro servicio»
  (siempre a revisión manual). Albañilería queda como legado (no aparece en web, formularios ni matching).
- **Solicitante:** Particular / Empresa / Contratista (Empresa y Contratista = B2B en el matching).
  «Tipo de trabajo» eliminado (la columna queda como `(legacy)`).
- **Proveedor:** Profesional independiente / autónomo, Contratista o Empresa (columna «Tipo de proveedor»).
- **Consentimientos únicos:** cliente `C4-2026-10` («Consentimiento operativo» + fecha);
  profesional `PRO-COND-2026-10-V2`. Columnas antiguas renombradas `(legacy)`.
- **Portal privado `/seguimiento/#token`** (`09-portal.gs`): progreso en lenguaje humano, datos del profesional tras
  la asignación, presupuesto, doble cierre (Sí / Terminó con problema → incidencia / Todavía no → discrepancia),
  valoración y «+ Solicitar otro servicio». Token de 64 hex, solo se guarda su SHA-256, ligado a una OC,
  revocable con `revocarSeguimiento('OC-XXXX')`. Todos los correos al cliente llevan «VER SEGUIMIENTO DE MI SOLICITUD».
- **Sin conformidad automática:** si el profesional declara el fin y el cliente no responde, se envían como máximo
  2 recordatorios (≥3 y ≥7 días); el estado sigue «Finalización declarada por el profesional · pendiente de
  confirmación del cliente».

## Cobro de comisiones con Wompi (`10-wompi.gs`) — PRODUCCIÓN PREPARADA PERO DESACTIVADA

Una sola estructura para sandbox y producción: pestañas «Comisiones», «Pagos comisión» y «Eventos Wompi».

- **Ambiente de cada comisión:** `SANDBOX` (solo si `WOMPI_SANDBOX_ENABLED = TRUE` y cliente Y profesional son «PRUEBA»),
  `PRODUCCION` (solo si `COMMISSION_COLLECTION_ENABLED = TRUE`) o `NO_HABILITADO` (lo normal en el piloto: calcula y registra, no cobra, no bloquea).
- **Secretos (Propiedades del script, nunca en código/hoja/GitHub):** pruebas `WOMPI_TEST_PUBLIC_KEY` / `WOMPI_TEST_INTEGRITY_SECRET` /
  `WOMPI_TEST_EVENTS_SECRET`; producción `WOMPI_PROD_PUBLIC_KEY` (pub_prod_…) / `WOMPI_PROD_INTEGRITY_SECRET` (prod_integrity_…) /
  `WOMPI_PROD_EVENTS_SECRET` (prod_events_…). Prefijo incorrecto → se detiene.
- **Estados:** `NO_HABILITADA` · `DUE` · `PAYMENT_PENDING` · `PAID` · `PAYMENT_FAILED` · `MANUAL_REVIEW` · `ANULADA`.
  Solo el evento de Wompi verificado (checksum SHA-256, comparación en tiempo constante, idempotencia `tx.id|status`) cambia estados.
- **Firma de integridad:** `SHA256(referencia + centavos + COP + secreto)` en el servidor. Referencia `OC-<ID>-COM-<AAAAMMDDhhmmss>` (nunca se reutiliza).
- **Bloqueo:** comisión `DUE`/`PAYMENT_PENDING`/`PAYMENT_FAILED`/`MANUAL_REVIEW` → sin NUEVAS oportunidades (tampoco «mismo profesional»
  ni oferta manual). No toca cuenta, historial ni trabajos en curso. `PAID` → desbloqueo automático.
- **Página de pago:** `/exec?wpago=<token>` (se acepta `?wsbx=` por compatibilidad). Correo «Comisión pendiente» con botón directo.
- **Tasa EUR→COP de producción (`12-v16.gs → tasaEurCop_`):** nunca usa `TEST_EXCHANGE_RATE`. `FX_MODO = SIN_DEFINIR` (bloquea el cobro),
  `MANUAL` (`FX_EUR_COP_MANUAL` + `FX_FECHA_MANUAL`, máx. `FX_MAX_DIAS`) o `TRM_BCE` (PROPUESTA pendiente de aprobación:
  TRM oficial USD/COP de la Superfinanciera en datos.gov.co × EUR/USD de referencia del BCE; exige `FX_FUENTE_APROBADA = SI`).
  Cada pago guarda comisión €, tasa aplicada, fuente, fecha de la tasa, importe COP y referencia Wompi.
- **Pendiente antes de producción:** aprobación del comercio en Wompi, cuenta de abono, tasa EUR→COP real aprobada,
  revisión legal/fiscal y autorización final de Steven. Hasta entonces `COMMISSION_COLLECTION_ENABLED = FALSE`.
- **Pruebas:** `node backend/apps-script/tests/v16.test.js` (offline, secretos falsos generados al vuelo; 22 escenarios).
  En vivo (solo datos PRUEBA): `sbxE2E_activar` → `sbxE2E_preparar` → pagar en el checkout de PRUEBAS → `sbxE2E_estado` → `sbxE2E_desactivar`.

## Condiciones para profesionales

Versión vigente `PRO-COND-2026-10-V3` (Configuración → `PRO_COND_VERSION`). Cada aceptación queda en «Aceptaciones condiciones»
(nunca se sobrescribe). Para recibir oportunidades hay que tener aceptada la versión vigente: `pedirAceptacionCondiciones()` envía a los
activos con una versión anterior un enlace para aceptarla.

## Varios servicios por cliente

Cada servicio es una OC independiente (profesional, estado, acuerdo, comisión, pago y cierre propios). Desde su seguimiento el cliente puede
«Añadir otro servicio» o «Solicitar este servicio al mismo profesional» (el profesional debe aceptarlo; si está bloqueado o no ofrece ese
servicio, se le indica que añada el servicio normalmente). Se agrupan por «Grupo cliente», que solo crea el servidor.

