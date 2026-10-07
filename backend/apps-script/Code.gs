/**
 * OficioCerca — backend gratuito en Google Apps Script.
 *
 * Qué hace:
 *  - Recibe los formularios de la web (POST JSON).
 *  - Genera códigos correlativos sin duplicados: OC-0001… (solicitudes) y PRO-0001… (profesionales).
 *  - Guarda cada registro en Google Sheets (que funciona como panel interno).
 *  - Guarda las fotos en Google Drive, una carpeta por solicitud.
 *  - Envía un correo de aviso a la cuenta propietaria.
 *
 * Puesta en marcha (una sola vez): ver backend/README.md
 *  1) Pegar este archivo en un proyecto de Apps Script.
 *  2) Ejecutar la función setup() y autorizar los permisos.
 *  3) Implementar como "Aplicación web" (ejecutar como: yo · acceso: cualquier usuario).
 *  4) Copiar la URL /exec en assets/js/config.js → ENDPOINT.
 */

var CONFIG = {
  SPREADSHEET_NAME: 'OficioCerca — Panel piloto',
  PHOTOS_FOLDER_NAME: 'OficioCerca — Fotos de solicitudes',
  NOTIFY: true,               // correo de aviso por cada registro nuevo
  MAX_PHOTOS: 5,
  MAX_PHOTO_BYTES: 4 * 1024 * 1024,
  CODE_DIGITS: 4
};

var ESTADOS_SOLICITUD = [
  'Nueva',
  'Buscando profesional',
  'Profesional asignado',
  'Presupuesto enviado',
  'Cliente aceptó',
  'Finalizado',
  'Comisión pagada',
  'Valoración recibida',
  'Cancelado / Perdido'
];

var ESTADOS_PROFESIONAL = ['Pendiente de revisar', 'Contactado', 'Activo', 'Pausado', 'Baja'];

var COLS_SOLICITUDES = [
  'Código', 'Fecha', 'Estado', 'Tipo solicitante', 'Nombre', 'Empresa', 'WhatsApp', 'Teléfono alt.', 'Email',
  'Ciudad', 'Código postal', 'Zona', 'Oficio', 'Oficio (otro)', 'Tipo de trabajo', 'Descripción', 'Prioridad',
  'Contacto preferido', 'Nº fotos', 'Carpeta fotos', 'Consent. contacto', 'Consent. compartir', 'Consent. privacidad',
  'Origen', 'Profesional asignado (PRO)', 'Fecha asignación', 'Importe mano de obra (€)', 'Comisión (€)',
  'Comisión pagada (fecha)', 'Valoración (1-5)', 'Motivo cancelación', 'Notas internas',
  // V1.2 — asignación y envío de ficha al profesional (se reutilizan «Profesional asignado (PRO)» y «Fecha asignación»)
  'Nombre profesional', 'Correo profesional', 'Enviar ficha', 'Estado envío ficha', 'Ficha enviada (fecha)',
  // V1.3 — respuesta, contacto del cliente, reenvío deliberado y trazabilidad del consentimiento
  'Respuesta profesional', 'Enviar contacto', 'Contacto enviado (fecha)', 'Reenviar ficha', 'Versión consentimiento'
];

var RESPUESTAS = ['Pendiente', 'Aceptó', 'Rechazó', 'Sin respuesta'];

var COLS_HISTORIAL = [
  'Fecha', 'Código OC', 'Código PRO', 'Nombre profesional', 'Correo profesional', 'Tipo de envío',
  'Servicio', 'Zona', 'Nº fotos', 'Resultado envío', 'Respuesta profesional', 'Fecha respuesta', 'Notas'
];

var COLS_PROFESIONALES = [
  'Código', 'Fecha', 'Estado', 'Nombre', 'Empresa / autónomo', 'Profesión', 'Profesión (otra)', 'Especialidades',
  'WhatsApp', 'Teléfono', 'Email', 'Ciudad', 'Código postal', 'Zonas', 'Distancia', 'Experiencia', 'Disponibilidad',
  'Con particulares', 'Con empresas', 'Descripción', 'Consent. contacto', 'Consent. privacidad', 'Origen',
  'NIF/CIF', 'Habilitación instalador', 'Seguro RC', 'Documentación', 'Trabajos ofrecidos', 'Trabajos aceptados',
  'Trabajos completados', 'Valoración media', 'Notas internas'
];

/* ------------------------------------------------------------------ setup */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss;
  if (props.getProperty('SPREADSHEET_ID')) {
    ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  } else {
    ss = SpreadsheetApp.create(CONFIG.SPREADSHEET_NAME);
    props.setProperty('SPREADSHEET_ID', ss.getId());
  }
  ss.setSpreadsheetTimeZone('Europe/Madrid');
  prepareSheet_(ss, 'Solicitudes', COLS_SOLICITUDES, ESTADOS_SOLICITUD);
  prepareSheet_(ss, 'Profesionales', COLS_PROFESIONALES, ESTADOS_PROFESIONAL);

  var info = ss.getSheetByName('Estados') || ss.insertSheet('Estados');
  info.clear();
  info.getRange(1, 1, 1, 2).setValues([['Estado de solicitud', 'Qué significa']]).setFontWeight('bold');
  var desc = [
    ['Nueva', 'Llegó por la web. Revisar datos y contactar al cliente.'],
    ['Buscando profesional', 'Ficha enviada a un profesional; esperando respuesta.'],
    ['Profesional asignado', 'Un profesional aceptó; se le pasaron los datos del cliente.'],
    ['Presupuesto enviado', 'Hubo contacto/visita y el profesional presupuestó.'],
    ['Cliente aceptó', 'El cliente aceptó. Anotar importe de mano de obra que confirma el CLIENTE.'],
    ['Finalizado', 'El cliente confirma que el trabajo terminó.'],
    ['Comisión pagada', 'El profesional pagó la comisión.'],
    ['Valoración recibida', 'Cerrada con valoración.'],
    ['Cancelado / Perdido', 'Indicar motivo en la columna «Motivo cancelación».']
  ];
  info.getRange(2, 1, desc.length, 2).setValues(desc);
  info.autoResizeColumns(1, 2);
  var def = ss.getSheetByName('Hoja 1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1) ss.deleteSheet(def);

  if (!props.getProperty('PHOTOS_FOLDER_ID')) {
    var folder = DriveApp.createFolder(CONFIG.PHOTOS_FOLDER_NAME);
    props.setProperty('PHOTOS_FOLDER_ID', folder.getId());
  }
  if (!props.getProperty('SEQ_OC')) props.setProperty('SEQ_OC', '0');
  if (!props.getProperty('SEQ_PRO')) props.setProperty('SEQ_PRO', '0');

  Logger.log('Hoja: ' + ss.getUrl());
  Logger.log('Carpeta fotos: https://drive.google.com/drive/folders/' + props.getProperty('PHOTOS_FOLDER_ID'));
}

function prepareSheet_(ss, name, cols, estados) {
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#13253D').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.setFrozenColumns(1);
  var rule = SpreadsheetApp.newDataValidation().requireValueInList(estados, true).setAllowInvalid(false).build();
  sh.getRange(2, 3, 1000, 1).setDataValidation(rule);
  return sh;
}

/**
 * Reinicia SEQ_OC y SEQ_PRO a 0 para que el próximo registro real sea OC-0001 / PRO-0001.
 * Seguridad: solo actúa si las pestañas Solicitudes y Profesionales NO tienen filas de datos.
 * No toca SPREADSHEET_ID ni PHOTOS_FOLDER_ID. Ejecutar a mano desde el editor.
 */
function reiniciarContadoresPiloto() {
  var sol = sheet_('Solicitudes').getLastRow();
  var pro = sheet_('Profesionales').getLastRow();
  var hs = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')).getSheetByName('Historial envíos');
  var his = hs ? hs.getLastRow() : 1;
  if (sol > 1 || pro > 1 || his > 1) throw new Error('Hay registros (Solicitudes: ' + (sol - 1) + ', Profesionales: ' + (pro - 1) + ', Historial: ' + (his - 1) + '). No se reinicia.');
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SEQ_OC', '0');
  props.setProperty('SEQ_PRO', '0');
  Logger.log('SEQ_OC=' + props.getProperty('SEQ_OC') + ' · SEQ_PRO=' + props.getProperty('SEQ_PRO'));
}

/** Diagnóstico sencillo del piloto: cuota real de correo, contadores, destinatario de avisos y estado operativo. */
function estadoPiloto() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  var cuota = MailApp.getRemainingDailyQuota();
  var filas = function (n) { var sh = ss.getSheetByName(n); return sh ? Math.max(sh.getLastRow() - 1, 0) : 'NO EXISTE'; };
  var trig = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'alEditarPanel'; });
  Logger.log('Cuota de correo restante hoy (real, MailApp.getRemainingDailyQuota): ' + cuota);
  Logger.log('SEQ_OC=' + props.getProperty('SEQ_OC') + ' · SEQ_PRO=' + props.getProperty('SEQ_PRO'));
  Logger.log('Avisos a: ' + Session.getEffectiveUser().getEmail());
  Logger.log('Filas — Solicitudes: ' + filas('Solicitudes') + ' · Profesionales: ' + filas('Profesionales') + ' · Historial envíos: ' + filas('Historial envíos'));
  Logger.log('Activador del panel (alEditarPanel): ' + (trig ? 'activo' : 'FALTA — ejecuta prepararV13'));
  Logger.log('Operativo: ' + (trig && cuota >= CORREOS_POR_ENVIO && ss.getSheetByName('Historial envíos') ? 'SÍ' : 'NO (revisa lo anterior)'));
}

/* ------------------------------------------------------------------ web */
function doGet() {
  return json_({ ok: true, service: 'OficioCerca', status: 'online' });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return json_({ ok: false, error: 'sin datos' });
    var d = JSON.parse(e.postData.contents);
    if (d.web) return json_({ ok: false, error: 'rechazado' }); // trampa anti-spam
    if (d.tipo === 'solicitud') return json_(saveSolicitud_(d));
    if (d.tipo === 'profesional') return json_(saveProfesional_(d));
    return json_({ ok: false, error: 'tipo desconocido' });
  } catch (err) {
    console.error(err);
    return json_({ ok: false, error: 'error interno' });
  }
}

function saveSolicitud_(d) {
  // Reglas del piloto (deben coincidir con el formulario web):
  // obligatorios: tipo de solicitante, nombre, WhatsApp, zona, servicio, descripción y 3 consentimientos;
  // si el servicio es «Otro servicio», también qué servicio/profesional necesita.
  req_(d, ['tipoSolicitante', 'nombre', 'whatsapp', 'zona', 'oficio', 'descripcion']);
  if (esOtro_(d.oficio) && !String(d.oficioOtro || '').trim()) throw new Error('falta oficioOtro');
  if (d.consentContacto !== 'si' || d.consentCompartir !== 'si' || d.consentPrivacidad !== 'si') throw new Error('faltan consentimientos');
  // Valores por defecto del piloto
  d.ciudad = 'Córdoba';
  if (!d.prioridad) d.prioridad = 'Normal';
  if (!d.contactoPreferido) d.contactoPreferido = 'WhatsApp';

  var code = nextCode_('SEQ_OC', 'OC-');
  var fotos = (d.fotos || []).slice(0, CONFIG.MAX_PHOTOS);
  var folderUrl = '';
  if (fotos.length) folderUrl = savePhotos_(code, fotos);

  var row = [
    code, new Date(), 'Nueva', s_(d.tipoSolicitante), s_(d.nombre), s_(d.empresa), t_(d.whatsapp), t_(d.telefonoAlt), s_(d.email),
    s_(d.ciudad), t_(d.codigoPostal), s_(d.zona), s_(d.oficio), s_(d.oficioOtro), s_(d.tipoTrabajo), s_(d.descripcion, 3000), s_(d.prioridad),
    s_(d.contactoPreferido), fotos.length, folderUrl, 'Sí', 'Sí', 'Sí',
    origen_(d), '', '', '', '', '', '', '', '',
    '', '', false, 'Sin asignar', '',
    '', false, '', false, s_(d.consentVersion || 'C1')
  ];
  // Importe y comisión se rellenan a mano: el modelo (porcentaje o tramos) está pendiente de definir.
  var shSol = sheet_('Solicitudes');
  shSol.appendRow(row);
  var nr = shSol.getLastRow();
  ['Enviar ficha', 'Reenviar ficha', 'Enviar contacto'].forEach(function (c) { shSol.getRange(nr, col_(c)).insertCheckboxes(); });
  notify_('Nueva solicitud ' + code + ' · ' + s_(d.oficio) + ' · ' + s_(d.zona),
    'Código: ' + code + '\nTipo: ' + s_(d.tipoSolicitante) + '\nNombre: ' + s_(d.nombre) + '\nWhatsApp: ' + s_(d.whatsapp) +
    '\nZona: ' + s_(d.zona) + ' (' + s_(d.codigoPostal) + ')\nOficio: ' + s_(d.oficio) + ' ' + s_(d.oficioOtro) +
    '\nPrioridad: ' + s_(d.prioridad) + '\n\n' + s_(d.descripcion, 3000) + '\n\nFotos: ' + (folderUrl || 'ninguna'));
  return { ok: true, code: code };
}

function saveProfesional_(d) {
  req_(d, ['nombre', 'whatsapp', 'email', 'profesion', 'experiencia', 'ciudad', 'codigoPostal', 'zonas', 'distancia', 'disponibilidad', 'conParticulares', 'conEmpresas']);
  if (!emailOk_(d.email)) throw new Error('email no válido');
  if (d.consentContacto !== 'si' || d.consentPrivacidad !== 'si') throw new Error('faltan consentimientos');
  var code = nextCode_('SEQ_PRO', 'PRO-');
  var row = [
    code, new Date(), 'Pendiente de revisar', s_(d.nombre), s_(d.empresa), s_(d.profesion), s_(d.profesionOtro), s_(d.especialidades),
    t_(d.whatsapp), t_(d.telefono), s_(d.email), s_(d.ciudad), t_(d.codigoPostal), s_(d.zonas), s_(d.distancia),
    s_(d.experiencia), s_(d.disponibilidad), s_(d.conParticulares), s_(d.conEmpresas), s_(d.descripcion, 1500), 'Sí', 'Sí',
    origen_(d), '', '', '', '', 0, 0, 0, '', ''
  ];
  sheet_('Profesionales').appendRow(row);
  notify_('Nuevo profesional ' + code + ' · ' + s_(d.profesion),
    'Código: ' + code + '\nNombre: ' + s_(d.nombre) + '\nWhatsApp: ' + s_(d.whatsapp) + '\nOficio: ' + s_(d.profesion) + ' ' + s_(d.profesionOtro) +
    '\nZonas: ' + s_(d.zonas) + '\nDisponibilidad: ' + s_(d.disponibilidad));
  return { ok: true, code: code };
}

/* ------------------------------------------------------------------ helpers */
function nextCode_(key, prefix) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var props = PropertiesService.getScriptProperties();
    var n = parseInt(props.getProperty(key) || '0', 10) + 1;
    props.setProperty(key, String(n));
    var s = String(n);
    while (s.length < CONFIG.CODE_DIGITS) s = '0' + s;
    return prefix + s;
  } finally {
    lock.releaseLock();
  }
}

function savePhotos_(code, fotos) {
  var root = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PHOTOS_FOLDER_ID'));
  var folder = root.createFolder(code);
  fotos.forEach(function (f, i) {
    if (!f || !f.data) return;
    var bytes = Utilities.base64Decode(f.data);
    if (bytes.length > CONFIG.MAX_PHOTO_BYTES) return;
    folder.createFile(Utilities.newBlob(bytes, 'image/jpeg', code + '-foto-' + (i + 1) + '.jpg'));
  });
  return folder.getUrl();
}

function esOtro_(v) {
  v = String(v || '').toLowerCase();
  return v === 'otro' || v === 'otro servicio';
}

function sheet_(name) {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Ejecuta setup() primero');
  return SpreadsheetApp.openById(id).getSheetByName(name);
}

function req_(d, keys) {
  keys.forEach(function (k) { if (!d[k] || !String(d[k]).trim()) throw new Error('falta ' + k); });
}

// Limpia texto y evita que una celda empiece por = + - @ (inyección de fórmulas)
function s_(v, max) {
  if (v === undefined || v === null) return '';
  var t = String(v).trim().slice(0, max || 300);
  if (/^[=+\-@]/.test(t)) t = "'" + t;
  return t;
}

// Teléfonos y códigos postales como texto (conserva el + y los ceros iniciales)
function t_(v) {
  var t = String(v || '').replace(/[^0-9+]/g, '').slice(0, 20);
  return t ? "'" + t : '';
}

function origen_(d) {
  var o = d.origen || {};
  var parts = [];
  if (o.utm_source) parts.push('utm:' + o.utm_source + '/' + (o.utm_medium || '') + '/' + (o.utm_campaign || ''));
  if (o.ref) parts.push('ref:' + o.ref);
  return s_(parts.join(' · ') || 'directo', 300);
}

function notify_(subject, body) {
  if (!CONFIG.NOTIFY) return;
  try {
    if (MailApp.getRemainingDailyQuota() < 1) { console.warn('Sin cuota de correo para el aviso'); return; }
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[OficioCerca] ' + subject, body);
  } catch (err) {
    console.warn('No se pudo enviar el aviso: ' + err);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ======================================================================
 * V1.3 — Asignación, historial, respuesta del profesional y contacto del cliente
 * ----------------------------------------------------------------------
 * Todo ocurre en la hoja «Solicitudes» y siempre por una acción deliberada:
 *  1. «Profesional asignado (PRO)»: escribe el código → se rellenan nombre y correo del candidato.
 *     Cambiarlo NO borra nada del pasado: cada envío queda en la pestaña «Historial envíos».
 *  2. «Enviar ficha» (casilla): envía la ficha SIN datos de contacto + fotos adjuntas.
 *     Si esa OC ya se envió a ese PRO, se bloquea; para reenviar a propósito marca antes «Reenviar ficha».
 *  3. «Respuesta profesional» (desplegable): Pendiente / Aceptó / Rechazó / Sin respuesta.
 *     Se copia a la fila correspondiente del historial. «Aceptó» pasa la solicitud a «Profesional asignado».
 *  4. «Enviar contacto» (casilla): solo si la respuesta es «Aceptó» y ese PRO recibió la ficha.
 *     Envía al profesional los datos de contacto del cliente y lo registra en el historial.
 * Las fotos nunca se comparten por Drive: viajan como adjuntos. Las carpetas siguen privadas.
 * ==================================================================== */

var CORREOS_POR_ENVIO = 2; // destinatario + copia oculta a la cuenta propietaria

/** Ejecutar UNA vez desde el editor: columnas V1.3, desplegable de respuesta, pestaña de historial y activador. */
function prepararV13() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  prepareSheet_(ss, 'Solicitudes', COLS_SOLICITUDES, ESTADOS_SOLICITUD);
  var sh = ss.getSheetByName('Solicitudes');
  var regla = SpreadsheetApp.newDataValidation().requireValueInList(RESPUESTAS, true).setAllowInvalid(false).build();
  sh.getRange(2, col_('Respuesta profesional'), 999, 1).setDataValidation(regla);
  var last = sh.getLastRow();
  if (last > 1) ['Enviar ficha', 'Reenviar ficha', 'Enviar contacto'].forEach(function (c) { sh.getRange(2, col_(c), last - 1, 1).insertCheckboxes(); });
  var hs = ss.getSheetByName('Historial envíos') || ss.insertSheet('Historial envíos');
  hs.getRange(1, 1, 1, COLS_HISTORIAL.length).setValues([COLS_HISTORIAL]).setFontWeight('bold').setBackground('#13253D').setFontColor('#FFFFFF');
  hs.setFrozenRows(1);
  var existe = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'alEditarPanel'; });
  if (!existe) ScriptApp.newTrigger('alEditarPanel').forSpreadsheet(ss).onEdit().create();
  Logger.log('V1.3 lista. Activador: ' + (existe ? 'ya existía' : 'creado'));
}

/** Activador instalable onEdit (solo reacciona a 4 columnas de «Solicitudes»). */
function alEditarPanel(e) {
  if (!e || !e.range) return;
  var r = e.range, sh = r.getSheet();
  if (sh.getName() !== 'Solicitudes' || r.getRow() < 2 || r.getNumRows() !== 1 || r.getNumColumns() !== 1) return;
  var c = r.getColumn(), row = r.getRow();
  if (c === col_('Profesional asignado (PRO)')) return asignarProfesional_(sh, row);
  if (c === col_('Enviar ficha') && r.getValue() === true) return enviarFicha_(sh, row);
  if (c === col_('Respuesta profesional')) return registrarRespuesta_(sh, row);
  if (c === col_('Enviar contacto') && r.getValue() === true) return enviarContacto_(sh, row);
}

function celdas_(sh, row) { return function (name) { return sh.getRange(row, col_(name)); }; }

function asignarProfesional_(sh, row) {
  var get = celdas_(sh, row);
  var pro = String(get('Profesional asignado (PRO)').getValue() || '').trim().toUpperCase();
  // Nuevo candidato: se limpian los campos del candidato actual (el pasado queda en «Historial envíos»)
  ['Nombre profesional', 'Correo profesional', 'Ficha enviada (fecha)', 'Respuesta profesional', 'Contacto enviado (fecha)'].forEach(function (n) { get(n).setValue(''); });
  get('Reenviar ficha').setValue(false);
  if (!pro) { get('Estado envío ficha').setValue('Sin asignar'); return; }
  get('Profesional asignado (PRO)').setValue(pro);
  var p = buscarProfesional_(pro);
  if (!p) { get('Estado envío ficha').setValue('Error: ' + pro + ' no existe en «Profesionales».'); return; }
  get('Nombre profesional').setValue(p.nombre);
  get('Correo profesional').setValue(p.email);
  get('Fecha asignación').setValue(new Date());
  var oc = get('Código').getValue();
  var previo = ultimoEnvio_(oc, pro, ['Ficha', 'Reenvío ficha']);
  if (previo) {
    get('Ficha enviada (fecha)').setValue(previo.fecha);
    get('Respuesta profesional').setValue(previo.respuesta || 'Pendiente');
    get('Estado envío ficha').setValue('Ya recibió la ficha el ' + fecha_(previo.fecha) + '. Para reenviar a propósito marca «Reenviar ficha» y luego «Enviar ficha».');
    return;
  }
  get('Estado envío ficha').setValue(motivoBloqueo_(p, sh, row) || 'Listo para enviar: revisa nombre y correo y marca «Enviar ficha».');
}

function enviarFicha_(sh, row) {
  var get = celdas_(sh, row);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var pro = String(get('Profesional asignado (PRO)').getValue() || '').trim().toUpperCase();
    var p = pro && buscarProfesional_(pro);
    if (!p) { get('Estado envío ficha').setValue('Error: indica un código PRO válido antes de enviar.'); return; }
    if (String(get('Correo profesional').getValue()).trim().toLowerCase() !== p.email.toLowerCase()) {
      get('Nombre profesional').setValue(p.nombre); get('Correo profesional').setValue(p.email);
      get('Estado envío ficha').setValue('Revisa: los datos del profesional cambiaron. Comprueba nombre y correo y vuelve a marcar.');
      return;
    }
    var bloqueo = motivoBloqueo_(p, sh, row);
    if (bloqueo) { get('Estado envío ficha').setValue(bloqueo); return; }
    var oc = get('Código').getValue();
    var previo = ultimoEnvio_(oc, pro, ['Ficha', 'Reenvío ficha']);
    var reenvio = get('Reenviar ficha').getValue() === true;
    if (previo && !reenvio) {
      get('Estado envío ficha').setValue('Bloqueado: ' + oc + ' ya se envió a ' + pro + ' el ' + fecha_(previo.fecha) + '. Para reenviar a propósito marca «Reenviar ficha» y luego «Enviar ficha».');
      return;
    }
    var cuota = MailApp.getRemainingDailyQuota();
    if (cuota < CORREOS_POR_ENVIO) { get('Estado envío ficha').setValue('Sin cuota de correo hoy (quedan ' + cuota + '). Inténtalo mañana; no se ha enviado nada.'); return; }

    var v = filaComoObjeto_(sh, row);
    var adjuntos = fotosDeSolicitud_(v['Carpeta fotos']);
    var ficha = componerFicha_(v, p, adjuntos.length);
    var tipo = previo ? 'Reenvío ficha' : 'Ficha';
    try {
      MailApp.sendEmail({ to: p.email, bcc: Session.getEffectiveUser().getEmail(), subject: ficha.asunto, body: ficha.texto, htmlBody: ficha.html, name: 'OficioCerca', attachments: adjuntos });
    } catch (err) {
      registrarHistorial_(v, p, tipo, adjuntos.length, 'Error: ' + String(err && err.message || err).slice(0, 150), '');
      get('Estado envío ficha').setValue('Error al enviar: ' + String(err && err.message || err).slice(0, 150));
      return;
    }
    var ahora = new Date();
    registrarHistorial_(v, p, tipo, adjuntos.length, 'Enviada', 'Pendiente', ahora);
    get('Ficha enviada (fecha)').setValue(ahora);
    get('Respuesta profesional').setValue('Pendiente');
    get('Estado envío ficha').setValue((previo ? 'Reenviada' : 'Enviada') + ' a ' + pro + ' · ' + adjuntos.length + ' foto(s) · registra su respuesta en «Respuesta profesional».');
    if (get('Estado').getValue() === 'Nueva') get('Estado').setValue('Buscando profesional');
  } finally {
    get('Enviar ficha').setValue(false);
    get('Reenviar ficha').setValue(false);
    lock.releaseLock();
  }
}

function registrarRespuesta_(sh, row) {
  var get = celdas_(sh, row);
  var resp = String(get('Respuesta profesional').getValue() || '').trim();
  var pro = String(get('Profesional asignado (PRO)').getValue() || '').trim().toUpperCase();
  var oc = get('Código').getValue();
  var previo = pro && ultimoEnvio_(oc, pro, ['Ficha', 'Reenvío ficha']);
  if (!previo) {
    get('Respuesta profesional').setValue('');
    get('Estado envío ficha').setValue('No hay ficha enviada a ' + (pro || 'ningún PRO') + ' para esta solicitud: primero envía la ficha.');
    return;
  }
  var hs = sheet_('Historial envíos');
  hs.getRange(previo.fila, COLS_HISTORIAL.indexOf('Respuesta profesional') + 1).setValue(resp);
  hs.getRange(previo.fila, COLS_HISTORIAL.indexOf('Fecha respuesta') + 1).setValue(resp ? new Date() : '');
  if (resp === 'Aceptó') {
    get('Estado').setValue('Profesional asignado');
    get('Estado envío ficha').setValue(pro + ' aceptó. Para compartirle los datos de contacto del cliente marca «Enviar contacto».');
  } else if (resp === 'Rechazó' || resp === 'Sin respuesta') {
    get('Estado envío ficha').setValue(pro + ': ' + resp.toLowerCase() + '. Puedes asignar otro profesional; este envío queda en el historial.');
  } else {
    get('Estado envío ficha').setValue('Esperando respuesta de ' + pro + '.');
  }
}

function enviarContacto_(sh, row) {
  var get = celdas_(sh, row);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var pro = String(get('Profesional asignado (PRO)').getValue() || '').trim().toUpperCase();
    var oc = get('Código').getValue();
    var p = pro && buscarProfesional_(pro);
    if (!p) { get('Estado envío ficha').setValue('Contacto no enviado: no hay un PRO válido asignado.'); return; }
    if (String(get('Respuesta profesional').getValue()).trim() !== 'Aceptó') { get('Estado envío ficha').setValue('Contacto no enviado: ' + pro + ' no figura como «Aceptó».'); return; }
    var ficha = ultimoEnvio_(oc, pro, ['Ficha', 'Reenvío ficha']);
    if (!ficha || ficha.respuesta !== 'Aceptó') { get('Estado envío ficha').setValue('Contacto no enviado: el historial no registra que ' + pro + ' recibiera la ficha y aceptara.'); return; }
    var ya = ultimoEnvio_(oc, pro, ['Contacto cliente']);
    if (ya) { get('Estado envío ficha').setValue('Bloqueado: el contacto ya se envió a ' + pro + ' el ' + fecha_(ya.fecha) + '.'); return; }
    var bloqueo = motivoBloqueo_(p, sh, row);
    if (bloqueo) { get('Estado envío ficha').setValue(bloqueo); return; }
    var cuota = MailApp.getRemainingDailyQuota();
    if (cuota < CORREOS_POR_ENVIO) { get('Estado envío ficha').setValue('Sin cuota de correo hoy (quedan ' + cuota + '). No se ha enviado el contacto.'); return; }
    var v = filaComoObjeto_(sh, row);
    var m = componerContacto_(v, p);
    try {
      MailApp.sendEmail({ to: p.email, bcc: Session.getEffectiveUser().getEmail(), subject: m.asunto, body: m.texto, htmlBody: m.html, name: 'OficioCerca' });
    } catch (err) {
      registrarHistorial_(v, p, 'Contacto cliente', 0, 'Error: ' + String(err && err.message || err).slice(0, 150), '');
      get('Estado envío ficha').setValue('Error al enviar el contacto: ' + String(err && err.message || err).slice(0, 150));
      return;
    }
    var ahora = new Date();
    registrarHistorial_(v, p, 'Contacto cliente', 0, 'Enviado', 'Aceptó', ahora);
    get('Contacto enviado (fecha)').setValue(ahora);
    get('Estado envío ficha').setValue('Contacto del cliente enviado a ' + pro + ' el ' + fecha_(ahora) + '.');
  } finally {
    get('Enviar contacto').setValue(false);
    lock.releaseLock();
  }
}

function registrarHistorial_(v, p, tipo, nFotos, resultado, respuesta, fecha) {
  var servicio = String(v['Oficio'] || '') + (v['Oficio (otro)'] ? ' — ' + v['Oficio (otro)'] : '');
  sheet_('Historial envíos').appendRow([fecha || new Date(), v['Código'], p.codigo, p.nombre, p.email, tipo, servicio, v['Zona'], nFotos, resultado, respuesta, '', '']);
}

/** Último envío CORRECTO de un tipo para OC+PRO en el historial (o null). */
function ultimoEnvio_(oc, pro, tipos) {
  var hs = sheet_('Historial envíos');
  if (!hs || hs.getLastRow() < 2) return null;
  var d = hs.getRange(2, 1, hs.getLastRow() - 1, COLS_HISTORIAL.length).getValues();
  for (var i = d.length - 1; i >= 0; i--) {
    var ok = /^Enviad/.test(String(d[i][9]));
    if (ok && d[i][1] === oc && String(d[i][2]).toUpperCase() === pro && tipos.indexOf(d[i][5]) >= 0) {
      return { fila: i + 2, fecha: d[i][0], respuesta: String(d[i][10] || '') };
    }
  }
  return null;
}

function motivoBloqueo_(p, sh, row) {
  if (String(p.estado).trim() !== 'Activo') return 'Bloqueado: ' + p.codigo + ' está «' + (p.estado || 'sin estado') + '». Ponlo en «Activo» en Profesionales para poder enviarle.';
  if (!emailOk_(p.email)) return 'Sin correo válido: ' + p.codigo + ' no puede recibir envíos automáticos. Añade su correo en Profesionales.';
  if (String(sh.getRange(row, col_('Consent. compartir')).getValue()).trim() !== 'Sí') return 'Bloqueado: el cliente no autorizó compartir la información con profesionales.';
  return '';
}

function buscarProfesional_(codigo) {
  var data = sheet_('Profesionales').getDataRange().getValues();
  var h = data[0];
  var iC = h.indexOf('Código'), iN = h.indexOf('Nombre'), iE = h.indexOf('Email'), iS = h.indexOf('Estado');
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][iC]).trim().toUpperCase() === codigo) {
      return { codigo: codigo, nombre: String(data[i][iN]).trim(), email: String(data[i][iE]).trim(), estado: String(data[i][iS]).trim() };
    }
  }
  return null;
}

function filaComoObjeto_(sh, row) {
  var h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  var v = sh.getRange(row, 1, 1, h.length).getValues()[0];
  var o = {};
  h.forEach(function (k, i) { o[k] = v[i]; });
  return o;
}

/** Fotos de ESA solicitud únicamente (la carpeta enlazada en su fila), como adjuntos. No cambia permisos. */
function fotosDeSolicitud_(url) {
  var m = String(url || '').match(/folders\/([\w-]+)/);
  if (!m) return [];
  var out = [];
  var it = DriveApp.getFolderById(m[1]).getFiles();
  while (it.hasNext() && out.length < CONFIG.MAX_PHOTOS) {
    var f = it.next();
    if (/^image\//.test(f.getMimeType())) out.push(f.getBlob().setName(f.getName()));
  }
  out.sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
  return out;
}

var esc_ = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };

function tablaHtml_(filas) {
  return '<table style="border-collapse:collapse;width:100%;margin:12px 0">' + filas.map(function (f) {
    return '<tr><td style="padding:8px;border:1px solid #DED6C8;background:#F6F2EB;width:160px"><b>' + esc_(f[0]) + '</b></td><td style="padding:8px;border:1px solid #DED6C8">' + esc_(f[1]) + '</td></tr>';
  }).join('') + '</table>';
}

/** Ficha SIN datos de contacto del cliente (nombre, teléfono, correo, empresa y código postal no se incluyen). */
function componerFicha_(v, p, nFotos) {
  var servicio = String(v['Oficio'] || '') + (v['Oficio (otro)'] ? ' — ' + v['Oficio (otro)'] : '');
  var filas = [
    ['Solicitud', v['Código']], ['Servicio', servicio],
    ['Zona / barrio', v['Zona'] + (v['Ciudad'] ? ' (' + v['Ciudad'] + ')' : '')],
    ['Prioridad', v['Prioridad'] || 'Normal'], ['Tipo de trabajo', v['Tipo de trabajo'] || 'Sin especificar'],
    ['Fotos', nFotos ? nFotos + ' adjunta(s) a este correo' : 'El cliente no adjuntó fotos']
  ];
  var intro = 'Te proponemos este trabajo en Córdoba. Revisa la ficha y responde a este correo indicando si puedes atenderlo (SÍ / NO). Si confirmas, te enviaremos los datos de contacto del cliente para que acordéis la visita y el presupuesto.';
  var pie = 'Esta ficha es confidencial: no la reenvíes ni publiques las fotos. — OficioCerca (piloto en Córdoba)';
  return {
    asunto: '[OficioCerca] Nueva oportunidad ' + v['Código'] + ' · ' + servicio + ' · ' + v['Zona'],
    texto: 'Hola ' + p.nombre + ',\n\n' + intro + '\n\n' + filas.map(function (f) { return f[0] + ': ' + f[1]; }).join('\n') + '\n\nDescripción del trabajo:\n' + v['Descripción'] + '\n\n' + pie,
    html: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#0E1A2B;max-width:600px"><p>Hola ' + esc_(p.nombre) + ',</p><p>' + esc_(intro) + '</p>' + tablaHtml_(filas) +
      '<p><b>Descripción del trabajo</b><br>' + esc_(v['Descripción']).replace(/\n/g, '<br>') + '</p><p style="color:#586374;font-size:13px">' + esc_(pie) + '</p></div>'
  };
}

/** Segundo correo, solo tras «Aceptó»: datos de contacto del cliente. */
function componerContacto_(v, p) {
  var filas = [
    ['Solicitud', v['Código']], ['Cliente', v['Nombre']], ['Empresa', v['Empresa'] || '—'],
    ['WhatsApp', String(v['WhatsApp'] || '').replace(/^'/, '')], ['Teléfono alternativo', String(v['Teléfono alt.'] || '—').replace(/^'/, '')],
    ['Correo', v['Email'] || '—'], ['Prefiere contacto por', v['Contacto preferido'] || 'WhatsApp'],
    ['Zona / barrio', v['Zona']], ['Código postal', String(v['Código postal'] || '—').replace(/^'/, '')]
  ];
  var intro = 'Gracias por confirmar que puedes atender esta solicitud. Estos son los datos de contacto del cliente. Contacta con él para acordar la visita y el presupuesto; el presupuesto y el cobro del trabajo son directamente entre vosotros.';
  var pie = 'Datos personales: úsalos solo para esta solicitud y no los compartas. — OficioCerca (piloto en Córdoba)';
  return {
    asunto: '[OficioCerca] Contacto del cliente · ' + v['Código'],
    texto: 'Hola ' + p.nombre + ',\n\n' + intro + '\n\n' + filas.map(function (f) { return f[0] + ': ' + f[1]; }).join('\n') + '\n\n' + pie,
    html: '<div style="font-family:Arial,sans-serif;font-size:15px;color:#0E1A2B;max-width:600px"><p>Hola ' + esc_(p.nombre) + ',</p><p>' + esc_(intro) + '</p>' + tablaHtml_(filas) + '<p style="color:#586374;font-size:13px">' + esc_(pie) + '</p></div>'
  };
}

function col_(name) {
  var i = COLS_SOLICITUDES.indexOf(name);
  if (i < 0) throw new Error('Columna desconocida: ' + name);
  return i + 1;
}

function emailOk_(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || '').trim());
}

function fecha_(d) {
  return Utilities.formatDate(new Date(d), 'Europe/Madrid', 'dd/MM/yyyy HH:mm');
}
