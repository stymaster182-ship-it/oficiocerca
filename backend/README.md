# Backend de OficioCerca V1.5 (Google Apps Script · cuenta oficiocerca@gmail.com)

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
3. Ejecutar `instalarV15` (incluye `instalarV14`, idempotente) (autorizar permisos con la cuenta oficiocerca@gmail.com).
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
6. Profesional registra presupuesto (mano de obra + materiales = total; versiones, nada se sobrescribe).
7. Cliente acepta / no acepta / pide hablar. Al aceptar: comisión = mín(10 % mano de obra, 200 €),
   estado «Pendiente de habilitación» mientras `COMMISSION_COLLECTION_ENABLED = FALSE` (no se cobra).
8. Profesional marca finalizado → el cliente confirma (sí / aún no / problema).
9. Valoración 1–5 (+ problema o sugerencia). 4–5 → «Buen trabajo» al profesional; ≤ 3 → incidencia.

## Activadores

- `alEditar` (al editar la hoja): activar/pausar profesionales, pausa preventiva, oferta manual, cancelaciones.
- `cicloAutomatico` (cada 10 min): cola de correo, vencimientos, nuevas búsquedas, métricas, PANEL.
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
