# Backend de OficioCerca V1.7 (Google Apps Script · cuenta oficiocerca@gmail.com)

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
3. Ejecutar `instalarV15` (→ `instalarV17`: incluye `instalarV14`, `instalarV16`, la migración de estados V1.7 y el formato de fechas; idempotente) (autorizar permisos con la cuenta oficiocerca@gmail.com).
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
6. **Contacto = inicio del trabajo en OficioCerca.** Cliente y profesional hablan, visitan y acuerdan FUERA (OficioCerca no cotiza ni negocia).
7. Profesional: «REGISTRAR ACUERDO ALCANZADO» → mano de obra inicial (obligatoria) + duración (cantidad + horas/días/semanas, obligatoria)
   + materiales estimados (opcional, informativo, sin comisión) + nota. `Fecha estimada fin` = instante exacto del registro + duración.
   → «Trabajo en proceso». El cliente NO confirma el acuerdo: lo ve en su seguimiento y, si no coincide, reporta un problema.
8. Al llegar la fecha estimada (`05/12 → motorSeguimiento_`): aviso a ambos «Indica su estado» (terminado / sigue / problema).
   «Sigue en proceso» del profesional = nueva duración (historial en `Historial plazos`); del cliente = se pide al profesional actualizar el plazo.
9. Cierre (lo inicia cualquiera): el profesional registra mano de obra FINAL, trabajos adicionales Sí/No, motivo (obligatorio si cambia el valor)
   y materiales finales (opcional) → «Finalización por confirmar» → cliente: «Sí, terminó y confirmo» / «Todavía no» / «Hay un problema».
10. SOLO con el «Sí» del cliente nace la comisión sobre la mano de obra FINAL (`12-v16.gs → comisionV16_`):
   10 % de los primeros 2.000 € + 5 % del exceso, sin tope, materiales excluidos
   (1.000→100 · 2.000→200 · 3.000→250 · 5.000→350 · 10.000→600). Sin cobro habilitado queda `NO_HABILITADA`
   (no bloquea) y el servicio pasa a «Cerrado»; con cobro, `DUE` → «Comisión pendiente» → pago Wompi → `PAID` → «Cerrado».
   Se guardan inicial, final, diferencia, motivo y fechas.
11. Valoración 1–5 (+ comentario) solo tras cierre confirmado, marcada «Trabajo verificado». Aviso corto al profesional.
12. **Incidencias** (cliente o profesional, 11 categorías): servicio → «En revisión» (se detienen cierre, cobro y reseñas; comisión `EN_REVISION`),
   aviso inmediato a oficiocerca@gmail.com «⚠ Nueva incidencia — OC-XXXX» con botón a la pestaña, botón de soporte por WhatsApp en la web
   (sin número visible ni token). Resolución manual en «Incidencias → Resultado»: RESUELTO — TRABAJO COMPLETO · RESUELTO — TRABAJO PARCIAL
   (comisión sobre «Mano de obra reconocida (€)») · CANCELADO — NO HUBO TRABAJO (comisión 0) · SIN ACUERDO / REVISIÓN MANUAL (sin comisión) · OTRO.
   Ninguna queja bloquea sola; la «pausa temporal de nuevas oportunidades» la decide una persona.
13. **Inactividad** (intervalos en Configuración: `SEG_RECORDATORIO_2_HORAS` 48 · `SEG_RECORDATORIO_3_HORAS` 120 · `SEG_CIERRE_HORAS` 48):
   T0 → +48 h → último aviso (+5 días) → 48 h después, si nadie responde: «Archivado por inactividad / cierre no confirmado»
   (sin comisión ni reseña, reabrible). Si solo falta una parte: avisos solo a esa parte y, agotados, «En revisión» + alerta a soporte.
   Si el profesional no registra el acuerdo en `SEG_ACUERDO_DIAS` (3) días, se le recuerda con el mismo ciclo.
14. **Reputación** (`04-motor.gs → puntosReputacion_`): señal secundaria tras los filtros duros; pesos `REP_PESO_VALORACION`,
   `REP_PESO_RESPUESTA`, `REP_PESO_SEGUIMIENTO`; nuevo (< 3 oportunidades) +1; tope total ±1 (la zona suma 3); a igualdad manda la rotación.

## Activadores

- `alEditar` (al editar la hoja): activar/pausar profesionales, pausa preventiva, oferta manual, cancelaciones.
- `procesarPendientes` (cada minuto; sale al instante si no hay nada): cola de correo y matching de solicitudes nuevas.
- `procesarPendientes` también atiende el seguimiento en el minuto exacto programado (`PROX_SEGUIMIENTO`) y recalcula la reputación tras una valoración.
- `cicloAutomatico` (cada 10 min): cola de correo, ofertas vencidas, motor de seguimiento, métricas, PANEL.
- Editar a mano `Fecha estimada fin` o `Acción desde` en Solicitudes reprograma el seguimiento al momento.
- Si Google deshabilita un activador: ejecutar `repararActivadoresV16` (los borra y recrea uno de cada, sin duplicados).
- `resumenDiario` (8:00 Madrid): un único correo al administrador, solo si hay actividad o pendientes.

## Correo

Remitente: OficioCerca &lt;oficiocerca@gmail.com&gt;. Sin copia oculta (evidencia = pestaña «Historial envíos»).
Antes de cada envío se consulta `MailApp.getRemainingDailyQuota()` con reserva según prioridad: alertas al administrador sin reserva,
prioridad normal `CUOTA_RESERVA` (3), baja prioridad `CUOTA_RESERVA_BAJA` (15). Lo que no cabe queda «Pendiente por cuota» y sale
cuando vuelve la cuota (la cola se ordena: administrador → normal → baja). Cada correo tiene una clave única: nunca se duplica ni se pierde.
Los correos se recomponen al enviarse: si la acción ya se hizo, no salen («Omitido»).

| Tipo | Destinatario | Cuándo | Prioridad |
|---|---|---|---|
| `confirmacion_cliente` | Cliente | Solicitud recibida (A) | normal |
| `asignado_cliente` | Cliente | Profesional encontrado (B), botón VER MI SEGUIMIENTO | normal |
| `sin_profesional` | Cliente | Una vez por ronda, con VOLVER A BUSCAR | normal |
| `respaldo_cliente` | Cliente | Solo hay disponibilidad posterior: decidir | normal |
| `seguimiento` (vencimiento / confirmar_cierre / actualizar_plazo / registrar_cierre / registrar_acuerdo) | Cliente y/o profesional, solo a quien falta | Fecha estimada (C), cierre pendiente (D), recordatorios | normal (recordatorios de vencimiento: baja) |
| `incidencia_parte` | La otra parte | Incidencia registrada (E) | normal |
| `incidencia_resuelta` | Ambos | Resultado de la incidencia | baja |
| `valorar_cliente` | Cliente | 24 h tras el cierre si no valoró (F) | baja |
| `oferta_profesional` | Profesional | Oportunidad compatible | normal |
| `contacto_profesional` | Profesional | Asignación: datos del cliente + mensaje de inicio del trabajo | normal |
| `valoracion_pro` | Profesional | «Recibiste una nueva valoración de N estrellas» | baja |
| `comision_exigible` / `recordatorio_comision` / `pago_aprobado_pro` / `pago_rechazado_pro` | Profesional | Solo con cobro habilitado | normal / baja |
| `registro_profesional` / `alta_activada` / `condiciones_pro` | Profesional | Alta y nuevas condiciones | normal / baja |
| `incidencia_admin` | oficiocerca@gmail.com | «⚠ Nueva incidencia — OC-XXXX» | admin (sin reserva) |
| `alerta_admin` / `resumen_diario` | oficiocerca@gmail.com | Revisión manual, errores; resumen diario | admin / baja |

## Utilidades

- `estadoSistema` — diagnóstico (cuota real, contadores, filas, activadores).
- `limpiarDatosDePrueba` — borra filas y fotos SOLO si todos los registros son de prueba (nombre con «PRUEBA») y pone SEQ a 0.
- `respaldoV13PreMigracion` / `respaldoV14PostMigracion` / `respaldoV16*` / `respaldoV17Evidencias` / `respaldoV17Final` — respaldos en `04 - Respaldos`.
- `sbxE2E_enlaces` — enlaces de PRUEBA sin gastar correo (si la cuota está agotada).

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
- **Página de pago:** `gestion/#<token>` en la web propia (también `/exec?wpago=<token>`; se acepta `?wsbx=` por compatibilidad). Correo «Comisión pendiente» con botón directo.
- **Tasa EUR→COP de producción (`12-v16.gs → tasaEurCop_`):** nunca usa `TEST_EXCHANGE_RATE`. `FX_MODO = SIN_DEFINIR` (bloquea el cobro),
  `MANUAL` (`FX_EUR_COP_MANUAL` + `FX_FECHA_MANUAL`, máx. `FX_MAX_DIAS`) o `TRM_BCE` (PROPUESTA pendiente de aprobación:
  TRM oficial USD/COP de la Superfinanciera en datos.gov.co × EUR/USD de referencia del BCE; exige `FX_FUENTE_APROBADA = SI`).
  Cada pago guarda comisión €, tasa aplicada, fuente, fecha de la tasa, importe COP y referencia Wompi.
- **Pendiente antes de producción:** aprobación del comercio en Wompi, cuenta de abono, tasa EUR→COP real aprobada,
  revisión legal/fiscal y autorización final de Steven. Hasta entonces `COMMISSION_COLLECTION_ENABLED = FALSE`.
- **Pruebas:** `node backend/apps-script/tests/v17.test.js` (offline, secretos falsos generados al vuelo; incluye los casos Wompi 45a–c).
  En vivo (solo datos PRUEBA): `sbxE2E_activar` → `sbxE2E_preparar` → pagar en el checkout de PRUEBAS → `sbxE2E_estado` → `sbxE2E_desactivar`.

## Condiciones para profesionales

Versión vigente `PRO-COND-2026-10-V4` (Configuración → `PRO_COND_VERSION`; la V3 queda archivada en `/condiciones-profesionales/v3/`). Cada aceptación queda en «Aceptaciones condiciones»
(nunca se sobrescribe). Para recibir oportunidades hay que tener aceptada la versión vigente: `pedirAceptacionCondiciones()` envía a los
activos con una versión anterior un enlace para aceptarla.

## Varios servicios por cliente

Cada servicio es una OC independiente (profesional, estado, acuerdo, comisión, pago y cierre propios). Desde su seguimiento el cliente puede
«Añadir otro servicio» o «Solicitar este servicio al mismo profesional» (el profesional debe aceptarlo; si está bloqueado o no ofrece ese
servicio, se le indica que añada el servicio normalmente). Se agrupan por «Grupo cliente», que solo crea el servidor.

