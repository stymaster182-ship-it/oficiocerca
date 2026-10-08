/* ============================================================ INSTALACIÓN (ejecutar desde el editor) */

/**
 * Prepara (o actualiza sin borrar datos) la hoja operativa a la que está vinculado este script:
 * pestañas, cabeceras, desplegables, configuración, carpeta de fotos y activadores.
 */
var NOMBRE_HOJA = 'OficioCerca — Operación';

/** V1.5: misma instalación idempotente (no borra datos). */
function instalarV15() { instalarV14(); }

function instalarV14() {
  var props = PropertiesService.getScriptProperties();
  var ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { }
  if (!ss && props.getProperty('SPREADSHEET_ID')) ss = SpreadsheetApp.openById(props.getProperty('SPREADSHEET_ID'));
  var operacion = carpetaPorNombre_('01 - Operación');
  if (!ss) { // proyecto independiente: usa la hoja «OficioCerca — Operación» de la carpeta 01 - Operación
    var fs = operacion.getFilesByName(NOMBRE_HOJA);
    if (!fs.hasNext()) throw new Error('No encuentro la hoja «' + NOMBRE_HOJA + '» en «01 - Operación».');
    ss = SpreadsheetApp.openById(fs.next().getId());
  }
  // El proyecto de Apps Script se guarda junto a la hoja, en «01 - Operación»
  try { DriveApp.getFileById(ScriptApp.getScriptId()).moveTo(operacion); } catch (e) { }
  props.setProperty('SPREADSHEET_ID', ss.getId());
  _ss = ss;
  ss.setSpreadsheetTimeZone(ZONA_HORARIA);

  ORDEN_PESTANAS.forEach(function (n, i) {
    var sh = ss.getSheetByName(n) || ss.insertSheet(n);
    if (n !== 'PANEL') {
      var cols = ESQUEMA[n];
      if (sh.getMaxColumns() < cols.length) sh.insertColumnsAfter(sh.getMaxColumns(), cols.length - sh.getMaxColumns());
      sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold').setBackground('#13253D').setFontColor('#FFFFFF').setWrap(true);
      sh.setFrozenRows(1);
      if (n !== 'Configuración' && n !== 'Registro' && n !== 'Valoraciones') sh.setFrozenColumns(1);
      var dv = DESPLEGABLES[n] || {};
      Object.keys(dv).forEach(function (c) {
        var regla = SpreadsheetApp.newDataValidation().requireValueInList(dv[c], true).setAllowInvalid(false).build();
        sh.getRange(2, cols.indexOf(c) + 1, Math.max(sh.getMaxRows() - 1, 1), 1).setDataValidation(regla);
      });
    }
    ss.setActiveSheet(sh);
    ss.moveActiveSheet(i + 1);
  });
  ['Hoja 1', 'Sheet1', 'Hoja1'].forEach(function (n) { var d = ss.getSheetByName(n); if (d) ss.deleteSheet(d); });
  ss.getSheetByName('Tokens').hideSheet();
  _tablas = {};

  // Configuración: añade solo las claves que falten (no pisa valores ya editados)
  var tc = tabla_('Configuración');
  var existentes = tc.todas().map(function (r) { return String(r['Clave']); });
  CONFIG_DEFECTO.forEach(function (r) {
    if (existentes.indexOf(r[0]) < 0) tc.agregar({ 'Clave': r[0], 'Valor': r[1], 'Descripción': r[2] });
  });
  _cfg = null;
  cfgPoner_('Versión backend', VERSION_BACKEND);
  // Las versiones vigentes de consentimiento/condiciones siguen al código
  cfgPoner_('CONSENT_VERSION', CONFIG_DEFECTO.filter(function (r) { return r[0] === 'CONSENT_VERSION'; })[0][1]);
  cfgPoner_('PRO_COND_VERSION', CONFIG_DEFECTO.filter(function (r) { return r[0] === 'PRO_COND_VERSION'; })[0][1]);

  // Carpetas privadas dentro de OFICIOCERCA
  if (!props.getProperty('PHOTOS_FOLDER_ID')) props.setProperty('PHOTOS_FOLDER_ID', carpetaPorNombre_('02 - Fotos de solicitudes').getId());
  if (!props.getProperty('BACKUP_FOLDER_ID')) props.setProperty('BACKUP_FOLDER_ID', carpetaPorNombre_('04 - Respaldos').getId());
  if (!props.getProperty('SEQ_OC')) props.setProperty('SEQ_OC', '0');
  if (!props.getProperty('SEQ_PRO')) props.setProperty('SEQ_PRO', '0');
  if (!props.getProperty('SEQ_INC')) props.setProperty('SEQ_INC', '0');

  // Activadores (sin duplicar)
  var hay = function (f) { return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === f; }); };
  if (!hay('alEditar')) ScriptApp.newTrigger('alEditar').forSpreadsheet(ss).onEdit().create();
  if (!hay('alAbrir')) ScriptApp.newTrigger('alAbrir').forSpreadsheet(ss).onOpen().create();
  if (!hay('procesarPendientes')) ScriptApp.newTrigger('procesarPendientes').timeBased().everyMinutes(1).create();
  if (!hay('cicloAutomatico')) ScriptApp.newTrigger('cicloAutomatico').timeBased().everyMinutes(10).create();
  if (!hay('resumenDiario')) ScriptApp.newTrigger('resumenDiario').timeBased().atHour(8).nearMinute(5).everyDays(1).inTimezone(ZONA_HORARIA).create();

  actualizarPanel();
  ss.setActiveSheet(ss.getSheetByName('PANEL'));
  Logger.log(VERSION_BACKEND + ' instalada. Hoja: ' + ss.getUrl());
  Logger.log('Fotos: ' + props.getProperty('PHOTOS_FOLDER_ID') + ' · Respaldos: ' + props.getProperty('BACKUP_FOLDER_ID'));
  Logger.log('Activadores: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', '));
}

function carpetaPorNombre_(nombre) {
  var it = DriveApp.getFoldersByName(nombre);
  if (!it.hasNext()) throw new Error('No encuentro la carpeta «' + nombre + '» en el Drive de esta cuenta.');
  return it.next();
}

/** Menú en la hoja (activador instalable al abrir). */
function alAbrir() { onOpen(); }
function onOpen() {
  SpreadsheetApp.getUi().createMenu('OficioCerca')
    .addItem('Actualizar panel ahora', 'actualizarPanel')
    .addItem('Ejecutar ciclo automático ahora', 'cicloAutomatico')
    .addItem('Estado del sistema (registro)', 'estadoSistema')
    .addToUi();
}

/** Diagnóstico: cuota real, contadores, filas, activadores. */
function estadoSistema() {
  var props = PropertiesService.getScriptProperties();
  var cuota = MailApp.getRemainingDailyQuota();
  Logger.log('Versión: ' + VERSION_BACKEND + ' · Cuenta: ' + Session.getEffectiveUser().getEmail());
  Logger.log('Cuota de correo restante hoy (MailApp.getRemainingDailyQuota): ' + cuota);
  Logger.log('SEQ_OC=' + props.getProperty('SEQ_OC') + ' · SEQ_PRO=' + props.getProperty('SEQ_PRO') + ' · SEQ_INC=' + props.getProperty('SEQ_INC'));
  Logger.log('Filas: ' + ORDEN_PESTANAS.filter(function (n) { return n !== 'PANEL'; }).map(function (n) {
    return n + '=' + Math.max(hoja_(n).getLastRow() - 1, 0);
  }).join(' · '));
  Logger.log('Activadores: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction(); }).join(', '));
  Logger.log('URL_APP: ' + (cfg_('URL_APP') || '(vacía)') + ' · Cobro comisiones: ' + (cfgBool_('COMMISSION_COLLECTION_ENABLED') ? 'ACTIVADO' : 'desactivado'));
}

/**
 * Borra TODO dato de prueba (filas de las pestañas operativas y carpetas de fotos OC-xxxx) y pone los
 * contadores a 0. Se niega si existe algún registro que NO esté marcado como prueba.
 */
function limpiarDatosDePrueba() {
  conLock_(function () {
    var sol = tabla_('Solicitudes').todas(), pro = tabla_('Profesionales').todas();
    var esPrueba = function (r, campo) { return /PRUEBA/i.test(String(r[campo] || '')) || /PRUEBA/i.test(String(r['Notas internas'] || '')); };
    var reales = sol.filter(function (r) { return !esPrueba(r, 'Nombre'); }).length + pro.filter(function (r) { return !esPrueba(r, 'Nombre'); }).length;
    if (reales) throw new Error('Hay ' + reales + ' registro(s) que no son de prueba. No se borra nada.');
    var fotos = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PHOTOS_FOLDER_ID'));
    sol.forEach(function (r) { if (r['Carpeta fotos (ID)']) try { DriveApp.getFolderById(r['Carpeta fotos (ID)']).setTrashed(true); } catch (e) { } });
    var it = fotos.getFolders(); while (it.hasNext()) { var f = it.next(); if (/^OC-\d+/.test(f.getName())) f.setTrashed(true); }
    ['Solicitudes', 'Profesionales', 'Ofertas', 'Presupuestos', 'Comisiones', 'Incidencias', 'Valoraciones', 'Historial envíos', 'Registro', 'Tokens'].forEach(function (n) {
      var sh = hoja_(n); if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });
    var props = PropertiesService.getScriptProperties();
    props.setProperty('SEQ_OC', '0'); props.setProperty('SEQ_PRO', '0'); props.setProperty('SEQ_INC', '0');
    _tablas = {};
  });
  actualizarPanel();
  estadoSistema();
}

/** Respaldo en «04 - Respaldos»: zip del repositorio (etiqueta GitHub) + copia de la hoja operativa. */
function crearRespaldo_(nombre, etiquetaGithub) {
  var dest = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('BACKUP_FOLDER_ID'));
  var it = dest.getFoldersByName(nombre);
  var carpeta = it.hasNext() ? it.next() : dest.createFolder(nombre);
  if (etiquetaGithub) {
    var url = 'https://codeload.github.com/stymaster182-ship-it/oficiocerca/zip/refs/tags/' + encodeURIComponent(etiquetaGithub);
    var r = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('No se pudo descargar ' + url + ' (' + r.getResponseCode() + ')');
    carpeta.createFile(r.getBlob().setName(nombre + '-repositorio.zip'));
  }
  return carpeta;
}

function respaldoV13PreMigracion() {
  var c = crearRespaldo_('OFICIOCERCA-V1.3-PRE-MIGRACION', 'OFICIOCERCA-V1.3-PRE-MIGRACION');
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.3-PRE-MIGRACION — sistema anterior (cuenta stevencontentstudio@gmail.com).',
    'Apps Script antiguo: implementación Versión 4, endpoint',
    'https://script.google.com/macros/s/AKfycbyAPYvE78dXkVdarRMy0tyT7XZra-k_sVF8iDh07DJ7otVZDj5fiRYYPmAvQgAD50rMTw/exec',
    'Hoja antigua «OficioCerca — Panel piloto» (vacía) y carpeta de fotos antigua: se conservan sin cambios en esa cuenta.',
    'Rollback: poner ese ENDPOINT en assets/js/config.js y subirlo a GitHub (Cloudflare Pages despliega solo).'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

function respaldoV14PostMigracion() {
  var c = crearRespaldo_('OFICIOCERCA-V1.4-POST-MIGRACION', 'OFICIOCERCA-V1.4-POST-MIGRACION');
  DriveApp.getFileById(ss_().getId()).makeCopy('OFICIOCERCA-V1.4-POST-MIGRACION — copia de la hoja (estructura y configuración)', c);
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.4-POST-MIGRACION — sistema operativo en oficiocerca@gmail.com.',
    'Contenido: zip del repositorio (web + backend/apps-script) y copia de la hoja operativa sin datos.',
    'Endpoint V1.4: ' + cfg_('URL_APP'),
    'Rollback a V1.3: ver OFICIOCERCA-V1.3-PRE-MIGRACION/LEEME.txt (el backend antiguo sigue existiendo, sin tráfico).'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

function respaldoV14PreV15() {
  var c = crearRespaldo_('OFICIOCERCA-V1.4-PRE-V1.5', 'OFICIOCERCA-V1.4-PRE-V1.5');
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.4-PRE-V1.5 — estado del repositorio justo antes de la V1.5 (cierre del piloto).',
    'Rollback de la web: restaurar los archivos de este zip en GitHub (Cloudflare Pages despliega solo).',
    'Rollback del backend: Apps Script → Gestionar implementaciones → editar → Versión 3 («V1.4 produccion»).'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

function respaldoV15CierrePiloto() {
  var c = crearRespaldo_('OFICIOCERCA-V1.5-CIERRE-PILOTO', 'OFICIOCERCA-V1.5-CIERRE-PILOTO');
  DriveApp.getFileById(ss_().getId()).makeCopy('OFICIOCERCA-V1.5-CIERRE-PILOTO — copia de la hoja (estructura y configuración, sin datos)', c);
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.5-CIERRE-PILOTO — sistema listo para el piloto real (cuenta oficiocerca@gmail.com).',
    'Contenido: zip del repositorio (web + backend/apps-script) y copia de la hoja operativa sin datos de prueba.',
    'Endpoint: ' + cfg_('URL_APP'),
    'Rollback a V1.4: ver OFICIOCERCA-V1.4-PRE-V1.5/LEEME.txt.'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

function respaldoV15PreSoporte() {
  var c = crearRespaldo_('OFICIOCERCA-V1.5-PRE-SOPORTE', 'OFICIOCERCA-V1.5-PRE-SOPORTE');
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.5-PRE-SOPORTE — estado justo antes del remate final (soporte WhatsApp + tutoriales).',
    'Es idéntico a OFICIOCERCA-V1.5-CIERRE-PILOTO. Rollback de la web: restaurar los archivos de este zip en GitHub.'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

function respaldoV15FinalPiloto() {
  var c = crearRespaldo_('OFICIOCERCA-V1.5-FINAL-PILOTO', 'OFICIOCERCA-V1.5-FINAL-PILOTO');
  DriveApp.getFileById(ss_().getId()).makeCopy('OFICIOCERCA-V1.5-FINAL-PILOTO — copia de la hoja (estructura y configuración, sin datos)', c);
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.5-FINAL-PILOTO — versión final para el piloto real (soporte WhatsApp contextual + tutoriales en vídeo).',
    'Contenido: zip del repositorio (web + backend/apps-script + vídeos) y copia de la hoja operativa sin datos.',
    'Endpoint: ' + cfg_('URL_APP'),
    'Rollback: ver OFICIOCERCA-V1.5-PRE-SOPORTE/LEEME.txt.'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

/* ============================================================ ENTRADA DESDE LA WEB */

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 30 * 1024 * 1024) return json_({ ok: false, error: 'sin datos' });
    var d = JSON.parse(e.postData.contents);
    if (d.web) return json_({ ok: false, error: 'rechazado' }); // trampa anti-spam
    if (d.tipo === 'solicitud') return json_(guardarSolicitud_(d));
    if (d.tipo === 'profesional') return json_(guardarProfesional_(d));
    if (d.tipo === 'pagina') return json_(paginaJson_(d.t));
    if (d.tipo === 'accion') return json_(accion(String(d.t || ''), d.p || {}));
    return json_({ ok: false, error: 'tipo desconocido' });
  } catch (err) {
    var msg = String(err && err.message || err);
    if (/^Validación:/.test(msg)) return json_({ ok: false, error: msg.replace(/^Validación:\s*/, '') });
    console.error(err);
    errorSistema_('doPost', msg);
    return json_({ ok: false, error: 'error interno' });
  }
}

function invalido_(m) { throw new Error('Validación: ' + m); }
function req_(d, keys) { keys.forEach(function (k) { if (!d[k] || !String(d[k]).trim()) invalido_('falta ' + k); }); }

function guardarSolicitud_(d) {
  req_(d, ['tipoSolicitante', 'nombre', 'whatsapp', 'email', 'zona', 'oficio', 'descripcion', 'plazo']);
  if (!emailOk_(d.email)) invalido_('email no válido');
  var servicio = normServicio_(d.oficio);
  if (!servicio) invalido_('servicio no válido');
  if (servicio === 'otro' && !String(d.oficioOtro || '').trim()) invalido_('falta oficioOtro');
  if (!PLAZOS_CLIENTE[d.plazo]) invalido_('plazo no válido');
  if (d.plazo === 'OTRA_FECHA' && diasHasta_(d.fechaDeseada) === null) invalido_('fecha deseada no válida');
  // V1.5: una única casilla operativa (no premarcada). Compatibilidad: acepta las 3 casillas de V1.4.
  var consOk = d.consentOperativo === 'si' || (d.consentContacto === 'si' && d.consentCompartir === 'si' && d.consentPrivacidad === 'si');
  if (!consOk) invalido_('falta el consentimiento');
  var tipoSol = TIPOS_SOLICITANTE.filter(function (t) { return sinAcentos_(t) === sinAcentos_(d.tipoSolicitante); })[0] ||
    (/contratista/i.test(d.tipoSolicitante) ? 'Contratista' : /empresa/i.test(d.tipoSolicitante) ? 'Empresa' : 'Particular');
  var fotos = validarFotos_(d.fotos);

  return conLock_(function () {
    var ts = tabla_('Solicitudes');
    // Doble envío (doble clic / recarga): misma persona y descripción en los últimos 15 min → mismo código
    var hace = Date.now() - 15 * 60000;
    var previa = ts.todas().filter(function (r) {
      return limpio_(r['WhatsApp']) === limpio_(t_(d.whatsapp)) && String(r['Descripción']) === s_(d.descripcion, 3000) && new Date(r['Fecha']).getTime() > hace;
    })[0];
    if (previa) return { ok: true, code: previa['Código'], duplicada: true };

    var code = siguienteCodigo_('SEQ_OC', 'OC-');
    var carpetaId = fotos.length ? guardarFotos_(code, fotos) : '';
    var manual = SERVICIOS_ACTIVOS.indexOf(servicio) < 0; // «Otro» o servicio legacy → revisión manual
    ts.agregar({
      'Código': code, 'Fecha': new Date(), 'Estado': manual ? 'Revisión manual' : 'Nueva',
      'Requiere intervención': manual ? (servicio === 'otro' ? 'Otro servicio: revisar demanda' : 'Servicio no activo en el piloto: revisar') : '',
      'Tipo solicitante': tipoSol,
      'Nombre': s_(d.nombre, 120), 'Empresa': tipoSol === 'Particular' ? '' : s_(d.empresa, 120), 'WhatsApp': t_(d.whatsapp), 'Teléfono alt.': t_(d.telefonoAlt),
      'Email': s_(d.email, 160).toLowerCase(), 'Ciudad': 'Córdoba', 'Código postal': t_(d.codigoPostal), 'Zona': s_(d.zona, 120),
      'Servicio (código)': servicio, 'Servicio': SERVICIOS[servicio], 'Servicio (otro)': s_(d.oficioOtro, 120),
      'Descripción': s_(d.descripcion, 3000), 'Plazo (código)': d.plazo,
      'Plazo': PLAZOS_CLIENTE[d.plazo].t, 'Fecha deseada': d.plazo === 'OTRA_FECHA' ? "'" + String(d.fechaDeseada).slice(0, 10) : '',
      'Contacto preferido (para el profesional)': ['WhatsApp', 'Llamada', 'Correo'].indexOf(d.contactoPreferido) >= 0 ? d.contactoPreferido : 'WhatsApp',
      'Nº fotos': fotos.length, 'Carpeta fotos (ID)': carpetaId,
      'Consentimiento operativo': 'Sí', 'Consentimiento (fecha)': new Date(),
      'Versión consentimiento': s_(d.consentVersion || cfg_('CONSENT_VERSION'), 40), 'Origen': origen_(d), 'Última actualización': new Date()
    });
    registrar_('Sistema', 'Solicitud recibida', code, '', SERVICIOS[servicio] + ' · ' + PLAZOS_CLIENTE[d.plazo].t + ' · ' + fotos.length + ' foto(s)');
    // V1.5: respuesta rápida. Confirmación y matching los hace el procesador de cola (cada minuto).
    encolarCorreo_('cli-confirmacion-' + code, 'confirmacion_cliente', 'Cliente', s_(d.email, 160).toLowerCase(), code, '', {}, true);
    marcarPendiente_();
    return { ok: true, code: code };
  });
}

/** Fotos: máx. 5, ≤ 4 MB, y que sean de verdad JPEG/PNG/WebP (cabecera del archivo). */
function validarFotos_(lista) {
  var out = [];
  (Array.isArray(lista) ? lista : []).slice(0, 5).forEach(function (f) {
    if (!f || !f.data || typeof f.data !== 'string') return;
    var bytes;
    try { bytes = Utilities.base64Decode(f.data); } catch (e) { return; }
    if (!bytes || bytes.length < 12 || bytes.length > 4 * 1024 * 1024) return;
    var b = function (i) { return bytes[i] & 0xff; };
    var mime = (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) ? 'image/jpeg'
      : (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47) ? 'image/png'
        : (b(0) === 0x52 && b(1) === 0x49 && b(8) === 0x57 && b(9) === 0x45) ? 'image/webp' : '';
    if (mime) out.push({ bytes: bytes, mime: mime });
  });
  return out;
}

function guardarFotos_(code, fotos) {
  var raiz = DriveApp.getFolderById(PropertiesService.getScriptProperties().getProperty('PHOTOS_FOLDER_ID'));
  var carpeta = raiz.createFolder(code); // hereda la privacidad de la carpeta padre; nunca se comparte
  fotos.forEach(function (f, i) {
    var ext = f.mime === 'image/png' ? 'png' : f.mime === 'image/webp' ? 'webp' : 'jpg';
    carpeta.createFile(Utilities.newBlob(f.bytes, f.mime, code + '-foto-' + (i + 1) + '.' + ext));
  });
  return carpeta.getId();
}

function guardarProfesional_(d) {
  req_(d, ['nombre', 'whatsapp', 'email', 'experiencia', 'ciudad', 'codigoPostal', 'zonas', 'distancia', 'disponibilidad', 'conParticulares', 'conEmpresas']);
  if (!emailOk_(d.email)) invalido_('email no válido');
  var servicios = listaServicios_(d.servicios).filter(function (c) { return SERVICIOS_ACTIVOS.indexOf(c) >= 0 || c === 'otro'; });
  if (!servicios.length) invalido_('elige al menos un servicio');
  if (servicios.indexOf('otro') >= 0 && !String(d.servicioOtro || '').trim()) invalido_('falta servicioOtro');
  // V1.5: una única casilla (condiciones para profesionales + política de privacidad), no premarcada
  if (d.consentCondiciones !== 'si') invalido_('faltan las condiciones');
  var tipoProv = TIPOS_PROVEEDOR.indexOf(d.tipoProveedor) >= 0 ? d.tipoProveedor : 'Profesional independiente / autónomo';
  var version = s_(d.condVersion || cfg_('PRO_COND_VERSION'), 40);
  return conLock_(function () {
    var tp = tabla_('Profesionales');
    var email = s_(d.email, 160).toLowerCase();
    var ya = tp.todas().filter(function (r) { return String(r['Email']).toLowerCase() === email; })[0];
    if (ya) { registrar_('Sistema', 'Registro profesional repetido', '', ya['Código'], 'Mismo correo; no se crea otro alta.'); return { ok: true, code: ya['Código'], duplicado: true }; }
    var code = siguienteCodigo_('SEQ_PRO', 'PRO-');
    tp.agregar({
      'Código': code, 'Fecha': new Date(), 'Estado': 'Pendiente de revisar', 'Nombre': s_(d.nombre, 120), 'Empresa / autónomo': s_(d.empresa, 120),
      'Servicios (códigos)': servicios.join(', '), 'Servicios': servicios.map(function (c) { return SERVICIOS[c]; }).join(', '),
      'Servicio otro': s_(d.servicioOtro, 120), 'Especialidades': s_(d.especialidades, 300), 'WhatsApp': t_(d.whatsapp), 'Teléfono': t_(d.telefono),
      'Email': email, 'Ciudad': s_(d.ciudad, 80), 'Código postal': t_(d.codigoPostal), 'Zonas': s_(d.zonas, 300), 'Distancia': s_(d.distancia, 40),
      'Experiencia': s_(d.experiencia, 40), 'Disponibilidad habitual': s_(d.disponibilidad, 60), 'Con particulares': d.conParticulares === 'Sí' ? 'Sí' : 'No',
      'Con empresas': d.conEmpresas === 'Sí' ? 'Sí' : 'No', 'Descripción': s_(d.descripcion, 1500), 'Tipo de proveedor': tipoProv,
      'Condiciones (versión)': version, 'Condiciones aceptadas (fecha)': new Date(), 'Origen': origen_(d), 'Prioridad': 'Normal',
      'Ofertas recibidas': 0, 'Respuestas': 0, 'Aceptadas': 0, 'Asignaciones': 0, 'Completados': 0, 'Incidencias verificadas': 0
    });
    registrar_('Sistema', 'Profesional registrado (pendiente de revisar)', '', code, servicios.join(', ') + ' · condiciones ' + version);
    encolarCorreo_('pro-registro-' + code, 'registro_profesional', 'Profesional', email, '', code, {}, true);
    marcarPendiente_();
    return { ok: true, code: code };
  });
}

function origen_(d) {
  var o = d.origen || {}, parts = [];
  if (o.utm_source) parts.push('utm:' + o.utm_source + '/' + (o.utm_medium || '') + '/' + (o.utm_campaign || ''));
  if (o.ref) parts.push('ref:' + o.ref);
  return s_(parts.join(' · ') || 'directo', 300);
}

function errorSistema_(donde, err) {
  var m = String(err && err.message || err).slice(0, 300);
  registrar_('Error', 'Error del sistema', '', '', donde + ': ' + m);
  try { alertaAdmin_('error-' + donde + '-' + Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyyMMddHH'), 'Sistema', 'Error del sistema en ' + donde, m); } catch (e) { }
}
