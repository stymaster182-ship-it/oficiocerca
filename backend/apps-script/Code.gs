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
  'Comisión pagada (fecha)', 'Valoración (1-5)', 'Motivo cancelación', 'Notas internas'
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
  req_(d, ['nombre', 'whatsapp', 'ciudad', 'codigoPostal', 'zona', 'oficio', 'tipoTrabajo', 'descripcion', 'prioridad', 'contactoPreferido', 'tipoSolicitante']);
  if (d.consentContacto !== 'si' || d.consentCompartir !== 'si' || d.consentPrivacidad !== 'si') throw new Error('faltan consentimientos');

  var code = nextCode_('SEQ_OC', 'OC-');
  var fotos = (d.fotos || []).slice(0, CONFIG.MAX_PHOTOS);
  var folderUrl = '';
  if (fotos.length) folderUrl = savePhotos_(code, fotos);

  var row = [
    code, new Date(), 'Nueva', s_(d.tipoSolicitante), s_(d.nombre), s_(d.empresa), t_(d.whatsapp), t_(d.telefonoAlt), s_(d.email),
    s_(d.ciudad), t_(d.codigoPostal), s_(d.zona), s_(d.oficio), s_(d.oficioOtro), s_(d.tipoTrabajo), s_(d.descripcion, 3000), s_(d.prioridad),
    s_(d.contactoPreferido), fotos.length, folderUrl, 'Sí', 'Sí', 'Sí',
    origen_(d), '', '', '', '', '', '', '', ''
  ];
  // Importe y comisión se rellenan a mano: el modelo (porcentaje o tramos) está pendiente de definir.
  sheet_('Solicitudes').appendRow(row);
  notify_('Nueva solicitud ' + code + ' · ' + s_(d.oficio) + ' · ' + s_(d.zona),
    'Código: ' + code + '\nTipo: ' + s_(d.tipoSolicitante) + '\nNombre: ' + s_(d.nombre) + '\nWhatsApp: ' + s_(d.whatsapp) +
    '\nZona: ' + s_(d.zona) + ' (' + s_(d.codigoPostal) + ')\nOficio: ' + s_(d.oficio) + ' ' + s_(d.oficioOtro) +
    '\nPrioridad: ' + s_(d.prioridad) + '\n\n' + s_(d.descripcion, 3000) + '\n\nFotos: ' + (folderUrl || 'ninguna'));
  return { ok: true, code: code };
}

function saveProfesional_(d) {
  req_(d, ['nombre', 'whatsapp', 'profesion', 'experiencia', 'ciudad', 'codigoPostal', 'zonas', 'distancia', 'disponibilidad', 'conParticulares', 'conEmpresas']);
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
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[OficioCerca] ' + subject, body);
  } catch (err) {
    console.warn('No se pudo enviar el aviso: ' + err);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
