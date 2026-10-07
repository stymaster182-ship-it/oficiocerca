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
  'Nombre profesional', 'Correo profesional', 'Enviar ficha', 'Estado envío ficha', 'Ficha enviada (fecha)'
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
  if (sol > 1 || pro > 1) throw new Error('Hay registros en la hoja (Solicitudes: ' + (sol - 1) + ', Profesionales: ' + (pro - 1) + '). No se reinicia.');
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SEQ_OC', '0');
  props.setProperty('SEQ_PRO', '0');
  Logger.log('SEQ_OC=' + props.getProperty('SEQ_OC') + ' · SEQ_PRO=' + props.getProperty('SEQ_PRO'));
}

/** Muestra en el registro el estado actual (contadores, IDs y destinatario de avisos). */
function estadoPiloto() {
  var props = PropertiesService.getScriptProperties();
  Logger.log('SEQ_OC=' + props.getProperty('SEQ_OC') + ' · SEQ_PRO=' + props.getProperty('SEQ_PRO'));
  Logger.log('SPREADSHEET_ID=' + props.getProperty('SPREADSHEET_ID') + ' · PHOTOS_FOLDER_ID=' + props.getProperty('PHOTOS_FOLDER_ID'));
  Logger.log('Avisos a: ' + Session.getEffectiveUser().getEmail());
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
    '', '', false, 'Sin asignar', ''
  ];
  // Importe y comisión se rellenan a mano: el modelo (porcentaje o tramos) está pendiente de definir.
  var shSol = sheet_('Solicitudes');
  shSol.appendRow(row);
  shSol.getRange(shSol.getLastRow(), col_('Enviar ficha')).insertCheckboxes();
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
    MailApp.sendEmail(Session.getEffectiveUser().getEmail(), '[OficioCerca] ' + subject, body);
  } catch (err) {
    console.warn('No se pudo enviar el aviso: ' + err);
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ======================================================================
 * V1.2 — Asignación de una solicitud a un profesional y envío de la ficha
 * ----------------------------------------------------------------------
 * Flujo en la hoja «Solicitudes» (todo manual y deliberado):
 *  1. Escribe el código del profesional en «Profesional asignado (PRO)».
 *     → El script rellena «Nombre profesional», «Correo profesional», «Fecha asignación»
 *       y deja «Estado envío ficha» = «Listo para enviar» (o explica por qué no se puede).
 *  2. Revisa nombre y correo. Si son correctos, marca la casilla «Enviar ficha».
 *     → Se envía UNA ficha por correo con las fotos adjuntas (sin datos de contacto del cliente),
 *       se registra fecha y estado y la casilla vuelve a desmarcarse.
 *  Bloqueos: no se envía si ya hay «Ficha enviada (fecha)», si el profesional no está «Activo»,
 *  si no tiene correo válido o si el cliente no autorizó compartir datos.
 *  Para reasignar a otro profesional: borra a mano «Ficha enviada (fecha)» y repite los pasos.
 * Las fotos NO se comparten por Drive: viajan como adjuntos del correo. Las carpetas siguen privadas.
 * ==================================================================== */

/** Ejecutar UNA vez desde el editor: añade las columnas nuevas y el activador de edición del panel. */
function prepararAsignacionV12() {
  var ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID'));
  prepareSheet_(ss, 'Solicitudes', COLS_SOLICITUDES, ESTADOS_SOLICITUD);
  var sh = ss.getSheetByName('Solicitudes');
  var last = sh.getLastRow();
  if (last > 1) {
    sh.getRange(2, col_('Enviar ficha'), last - 1, 1).insertCheckboxes();
    var est = sh.getRange(2, col_('Estado envío ficha'), last - 1, 1);
    var vals = est.getValues().map(function (r) { return [r[0] || 'Sin asignar']; });
    est.setValues(vals);
  }
  var existe = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'alEditarPanel'; });
  if (!existe) ScriptApp.newTrigger('alEditarPanel').forSpreadsheet(ss).onEdit().create();
  Logger.log('Columnas V1.2 listas. Activador alEditarPanel: ' + (existe ? 'ya existía' : 'creado'));
}

/** Activador instalable onEdit de la hoja (solo reacciona a 2 columnas de «Solicitudes»). */
function alEditarPanel(e) {
  if (!e || !e.range) return;
  var r = e.range, sh = r.getSheet();
  if (sh.getName() !== 'Solicitudes' || r.getRow() < 2 || r.getNumRows() !== 1 || r.getNumColumns() !== 1) return;
  var c = r.getColumn(), row = r.getRow();
  if (c === col_('Profesional asignado (PRO)')) return asignarProfesional_(sh, row, e.oldValue);
  if (c === col_('Enviar ficha') && r.getValue() === true) return enviarFicha_(sh, row);
}

function asignarProfesional_(sh, row, anterior) {
  var get = function (name) { return sh.getRange(row, col_(name)); };
  var pro = String(get('Profesional asignado (PRO)').getValue() || '').trim().toUpperCase();
  if (get('Ficha enviada (fecha)').getValue()) {
    get('Profesional asignado (PRO)').setValue(anterior === undefined ? '' : anterior); // se deshace el cambio
    get('Estado envío ficha').setValue('Bloqueado: ya se envió una ficha. Para reasignar, borra «Ficha enviada (fecha)».');
    return;
  }
  if (!pro) {
    get('Nombre profesional').setValue(''); get('Correo profesional').setValue('');
    get('Estado envío ficha').setValue('Sin asignar');
    return;
  }
  get('Profesional asignado (PRO)').setValue(pro);
  var p = buscarProfesional_(pro);
  if (!p) {
    get('Nombre profesional').setValue(''); get('Correo profesional').setValue('');
    get('Estado envío ficha').setValue('Error: ' + pro + ' no existe en «Profesionales».');
    return;
  }
  get('Nombre profesional').setValue(p.nombre);
  get('Correo profesional').setValue(p.email);
  get('Fecha asignación').setValue(new Date());
  get('Estado envío ficha').setValue(motivoBloqueo_(p, sh, row) || 'Listo para enviar: revisa nombre y correo y marca «Enviar ficha».');
}

function enviarFicha_(sh, row) {
  var get = function (name) { return sh.getRange(row, col_(name)); };
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (get('Ficha enviada (fecha)').getValue()) {
      get('Estado envío ficha').setValue('Bloqueado: esta ficha ya se envió el ' + fecha_(get('Ficha enviada (fecha)').getValue()) + '. No se reenvía.');
      return;
    }
    var pro = String(get('Profesional asignado (PRO)').getValue() || '').trim().toUpperCase();
    var p = pro && buscarProfesional_(pro);
    if (!p) { get('Estado envío ficha').setValue('Error: indica un código PRO válido antes de enviar.'); return; }
    // El destinatario debe coincidir con lo que se mostró al asignar (evita enviar al profesional equivocado)
    if (String(get('Correo profesional').getValue()).trim().toLowerCase() !== p.email.toLowerCase()) {
      get('Nombre profesional').setValue(p.nombre); get('Correo profesional').setValue(p.email);
      get('Estado envío ficha').setValue('Revisa: los datos del profesional cambiaron. Comprueba nombre y correo y vuelve a marcar.');
      return;
    }
    var bloqueo = motivoBloqueo_(p, sh, row);
    if (bloqueo) { get('Estado envío ficha').setValue(bloqueo); return; }

    var v = filaComoObjeto_(sh, row);
    var adjuntos = fotosDeSolicitud_(v['Carpeta fotos']);
    var ficha = componerFicha_(v, p, adjuntos.length);
    MailApp.sendEmail({
      to: p.email,
      bcc: Session.getEffectiveUser().getEmail(),
      subject: ficha.asunto,
      body: ficha.texto,
      htmlBody: ficha.html,
      name: 'OficioCerca',
      attachments: adjuntos
    });
    var ahora = new Date();
    get('Ficha enviada (fecha)').setValue(ahora);
    get('Estado envío ficha').setValue('Enviada a ' + pro + ' (' + p.email + ') · ' + adjuntos.length + ' foto(s) · esperando respuesta');
    if (get('Estado').getValue() === 'Nueva') get('Estado').setValue('Buscando profesional');
  } catch (err) {
    get('Estado envío ficha').setValue('Error al enviar: ' + String(err && err.message || err).slice(0, 180));
  } finally {
    get('Enviar ficha').setValue(false);
    lock.releaseLock();
  }
}

function motivoBloqueo_(p, sh, row) {
  if (String(p.estado).trim() !== 'Activo') return 'Bloqueado: ' + p.codigo + ' está «' + (p.estado || 'sin estado') + '». Ponlo en «Activo» en Profesionales para poder enviarle fichas.';
  if (!emailOk_(p.email)) return 'Sin correo válido: ' + p.codigo + ' no puede recibir la ficha automática. Añade su correo en Profesionales o envíala a mano.';
  if (String(sh.getRange(row, col_('Consent. compartir')).getValue()).trim() !== 'Sí') return 'Bloqueado: el cliente no autorizó compartir datos con un profesional.';
  return '';
}

function buscarProfesional_(codigo) {
  var sh = sheet_('Profesionales');
  var data = sh.getDataRange().getValues();
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

/** Ficha SIN datos de contacto del cliente (nombre, teléfono, correo, empresa y código postal no se incluyen). */
function componerFicha_(v, p, nFotos) {
  var servicio = String(v['Oficio'] || '') + (v['Oficio (otro)'] ? ' — ' + v['Oficio (otro)'] : '');
  var filas = [
    ['Solicitud', v['Código']],
    ['Servicio', servicio],
    ['Zona / barrio', v['Zona'] + (v['Ciudad'] ? ' (' + v['Ciudad'] + ')' : '')],
    ['Prioridad', v['Prioridad'] || 'Normal'],
    ['Tipo de trabajo', v['Tipo de trabajo'] || 'Sin especificar'],
    ['Fotos', nFotos ? nFotos + ' adjunta(s) a este correo' : 'El cliente no adjuntó fotos']
  ];
  var esc = function (t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); };
  var asunto = '[OficioCerca] Nueva oportunidad ' + v['Código'] + ' · ' + servicio + ' · ' + v['Zona'];
  var intro = 'Hola ' + (p.nombre || '') + ',\n\nTe proponemos este trabajo en Córdoba. Revisa la ficha y responde a este correo indicando si puedes atenderlo (SÍ / NO).\nSi confirmas, te enviaremos los datos de contacto del cliente para que acordéis la visita y el presupuesto.';
  var texto = intro + '\n\n' + filas.map(function (f) { return f[0] + ': ' + f[1]; }).join('\n') +
    '\n\nDescripción del trabajo:\n' + v['Descripción'] +
    '\n\nEsta ficha es confidencial: no la reenvíes ni publiques las fotos.\n— OficioCerca (piloto en Córdoba)';
  var html = '<div style="font-family:Arial,sans-serif;font-size:15px;color:#0E1A2B;max-width:600px">' +
    '<p>Hola ' + esc(p.nombre || '') + ',</p><p>Te proponemos este trabajo en Córdoba. Revisa la ficha y <b>responde a este correo indicando si puedes atenderlo (SÍ / NO)</b>. Si confirmas, te enviaremos los datos de contacto del cliente para que acordéis la visita y el presupuesto.</p>' +
    '<table style="border-collapse:collapse;width:100%;margin:12px 0">' +
    filas.map(function (f) { return '<tr><td style="padding:8px;border:1px solid #DED6C8;background:#F6F2EB;width:150px"><b>' + esc(f[0]) + '</b></td><td style="padding:8px;border:1px solid #DED6C8">' + esc(f[1]) + '</td></tr>'; }).join('') +
    '</table><p><b>Descripción del trabajo</b><br>' + esc(v['Descripción']).replace(/\n/g, '<br>') + '</p>' +
    '<p style="color:#586374;font-size:13px">Esta ficha es confidencial: no la reenvíes ni publiques las fotos.<br>— OficioCerca (piloto en Córdoba)</p></div>';
  return { asunto: asunto, texto: texto, html: html };
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
