/**
 * OficioCerca — backend V1.4 (Google Apps Script, cuenta oficiocerca@gmail.com).
 *
 * Flujo automático:
 *  solicitud web → confirmación al cliente → matching por reglas (oficio, zona, distancia, tipo de cliente,
 *  disponibilidad) → oferta SECUENCIAL al mejor candidato (ficha sin datos de contacto + fotos adjuntas)
 *  → el profesional responde con botones (enlace con token) → si su plazo encaja se asigna; si no, queda
 *  como respaldo y se sigue buscando → contacto automático solo al asignado → presupuesto → aceptación
 *  del cliente → comisión calculada (cobro DESACTIVADO) → finalización confirmada por el cliente →
 *  valoración / incidencias. El administrador interviene en excepciones desde la pestaña PANEL.
 *
 * Puesta en marcha: ver backend/README.md (función instalarV14).
 * El código no contiene secretos: los IDs se guardan en Propiedades del script.
 */

var VERSION_BACKEND = 'V1.4';
var ZONA_HORARIA = 'Europe/Madrid';

/** Valores por defecto de la pestaña «Configuración» (editables allí, salvo los de solo lectura). */
var CONFIG_DEFECTO = [
  ['COMMISSION_COLLECTION_ENABLED', 'FALSE', 'Cobro real de comisiones. FALSE = solo se calculan y registran (no se cobra nada). No activar sin titular, fiscalidad y revisión legal.'],
  ['COMISION_PORCENTAJE', '10', '% sobre la MANO DE OBRA aceptada por el cliente (materiales excluidos).'],
  ['COMISION_MAXIMO_EUR', '200', 'Máximo de comisión por solicitud/trabajo (€).'],
  ['ADMIN_EMAIL', 'oficiocerca@gmail.com', 'Recibe SOLO alertas (errores, incidencias, excepciones) y el resumen diario.'],
  ['RESUMEN_DIARIO', 'SI', 'SI = un único correo resumen cada mañana al administrador.'],
  ['URL_WEB', 'https://oficiocerca.pages.dev/', 'Web pública.'],
  ['URL_APP', '', 'URL /exec de esta aplicación web (enlaces de los correos). Se rellena al desplegar.'],
  ['HORAS_RESPUESTA_URGENTE', '4', 'Horas para responder a una oportunidad cuando el cliente pide «Hoy o mañana».'],
  ['HORAS_RESPUESTA_NORMAL', '24', 'Horas para responder a una oportunidad en el resto de casos.'],
  ['DIAS_VALIDEZ_ENLACES', '30', 'Días de validez de los enlaces enviados a clientes (presupuesto, finalización…).'],
  ['CUOTA_RESERVA', '3', 'Correos que se reservan para alertas al administrador.'],
  ['PRO_COND_VERSION', 'PRO-COND-2026-10-V1', 'Versión vigente de las condiciones para profesionales.'],
  ['CONSENT_VERSION', 'C3-2026-10', 'Versión vigente del consentimiento de clientes.'],
  ['Cuota correo disponible', '', 'Solo lectura: MailApp.getRemainingDailyQuota() en la última comprobación.'],
  ['Última comprobación', '', 'Solo lectura.'],
  ['Correos pendientes', '', 'Solo lectura: en cola por cuota.'],
  ['Envíos fallidos', '', 'Solo lectura.'],
  ['Versión backend', VERSION_BACKEND, 'Solo lectura.']
];

/** Servicios normalizados (el matching usa SOLO estos códigos, nunca texto libre). */
var SERVICIOS = {
  electricidad: 'Electricidad',
  fontaneria: 'Fontanería',
  albanileria: 'Albañilería y pequeñas reformas',
  pintura: 'Pintura',
  carpinteria: 'Carpintería y ebanistería',
  marmoleria: 'Marmolería',
  otro: 'Otro servicio'
};

/** Plazo pedido por el cliente → días máximos (null = flexible). */
var PLAZOS_CLIENTE = {
  HOY_MANANA: { t: 'Hoy o mañana', d: 1 },
  DOS_TRES_DIAS: { t: 'En 2–3 días', d: 3 },
  ESTA_SEMANA: { t: 'Esta semana', d: 7 },
  UNA_DOS_SEMANAS: { t: 'En 1–2 semanas', d: 14 },
  FLEXIBLE: { t: 'Flexible / sin fecha concreta', d: null },
  OTRA_FECHA: { t: 'Otra fecha', d: 'fecha' }
};

/** Disponibilidad que indica el profesional al responder → días hasta poder atender. */
var DISP_PRO = {
  HOY: { t: 'Hoy', d: 0 },
  MANANA: { t: 'Mañana', d: 1 },
  DOS_TRES_DIAS: { t: 'En 2–3 días', d: 3 },
  ESTA_SEMANA: { t: 'Esta semana', d: 7 },
  UNA_DOS_SEMANAS: { t: 'En 1–2 semanas', d: 14 },
  OTRA_FECHA: { t: 'Otra fecha', d: 'fecha' }
};

var ESTADOS_SOLICITUD = [
  'Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional',
  'Esperando decisión cliente', 'Sin profesional compatible', 'Profesional asignado', 'Presupuesto enviado',
  'Presupuesto no aceptado', 'Cliente aceptó', 'Finalización por confirmar', 'Finalizado', 'Valorada', 'Cancelada'
];
var ESTADOS_PROFESIONAL = ['Pendiente de revisar', 'Activo', 'En revisión', 'Pausado', 'Baja'];
var ESTADOS_OFERTA = ['Enviada', 'Seleccionada', 'Respaldo', 'Rechazada', 'Sin respuesta', 'Cerrada'];
var ESTADOS_PRESUPUESTO = ['Enviado al cliente', 'Sustituido', 'Aceptado', 'No aceptado'];
var ESTADOS_COMISION = ['Generada', 'Pendiente de habilitación', 'Pendiente', 'Pagada', 'En revisión', 'Anulada'];
var ESTADOS_INCIDENCIA = ['Abierta', 'En revisión', 'Verificada', 'Descartada', 'Cerrada'];
var CATEGORIAS_INCIDENCIA = ['Problema con el profesional', 'Problema con el trabajo', 'Comunicación', 'Sugerencia para OficioCerca', 'Valoración baja', 'Otro'];

var ESQUEMA = {
  'Solicitudes': ['Código', 'Fecha', 'Estado', 'Requiere intervención', 'Tipo solicitante', 'Nombre', 'Empresa', 'WhatsApp',
    'Teléfono alt.', 'Email', 'Ciudad', 'Código postal', 'Zona', 'Servicio (código)', 'Servicio', 'Servicio (otro)',
    'Tipo de trabajo', 'Descripción', 'Plazo (código)', 'Plazo', 'Fecha deseada', 'Contacto preferido (para el profesional)',
    'Nº fotos', 'Carpeta fotos (ID)', 'Consent. contacto', 'Consent. compartir', 'Consent. privacidad', 'Versión consentimiento',
    'Origen', 'Ofrecer a (PRO manual)', 'Profesional asignado (PRO)', 'Fecha asignación', 'Disponibilidad profesional',
    'Respaldo (PRO)', 'Respaldo disponibilidad', 'Decisión cliente', 'Contacto enviado (fecha)', 'Presupuesto vigente',
    'Mano de obra aceptada (€)', 'Total aceptado (€)', 'Comisión (€)', 'Fecha aceptación', 'Finalizado (fecha)',
    'Valoración (1-5)', 'Motivo cierre', 'Última actualización', 'Notas internas'],
  'Profesionales': ['Código', 'Fecha', 'Estado', 'Nombre', 'Empresa / autónomo', 'Servicios (códigos)', 'Servicios',
    'Servicio otro', 'Especialidades', 'WhatsApp', 'Teléfono', 'Email', 'Ciudad', 'Código postal', 'Zonas', 'Distancia',
    'Experiencia', 'Disponibilidad habitual', 'Con particulares', 'Con empresas', 'Descripción', 'Consent. contacto',
    'Consent. privacidad', 'Condiciones (versión)', 'Condiciones aceptadas (fecha)', 'Origen', 'Prioridad',
    'Ofertas recibidas', 'Respuestas', 'Aceptadas', 'Asignaciones', 'Completados', 'Tiempo medio respuesta (h)',
    'Valoración media', 'Nº valoraciones', 'Incidencias verificadas', 'Comisiones pendientes', 'Última oferta', 'Notas internas'],
  'Ofertas': ['ID', 'Fecha envío', 'Código OC', 'Código PRO', 'Profesional', 'Servicio', 'Puntuación', 'Motivo ranking',
    'Estado', 'Respuesta', 'Disponibilidad (código)', 'Disponibilidad', 'Días hasta disponibilidad', 'Fecha respuesta',
    'Expira', 'Notas'],
  'Presupuestos': ['ID', 'Fecha', 'Código OC', 'Código PRO', 'Versión', 'Mano de obra (€)', 'Materiales (€)', 'Total (€)',
    'Observaciones', 'Estado', 'Respuesta cliente (fecha)', 'Notas'],
  'Comisiones': ['Código OC', 'Código PRO', 'Profesional', 'Presupuesto', 'Mano de obra (€)', 'Porcentaje', 'Importe comisión (€)',
    'Fecha generación', 'Estado', 'Fecha pago', 'Notas'],
  'Incidencias': ['ID', 'Fecha', 'Tipo', 'Código OC', 'Código PRO', 'Origen', 'Categoría', 'Gravedad', 'Descripción', 'Estado',
    'Pausa preventiva', 'Acción tomada', 'Administrador', 'Fecha resolución', 'Notas'],
  'Valoraciones': ['Fecha', 'Código OC', 'Código PRO', 'Estrellas', 'Comentario', 'Publicable', 'Notas'],
  'Historial envíos': ['ID', 'Fecha', 'Clave', 'Tipo', 'Destinatario', 'Correo', 'Código OC', 'Código PRO', 'Asunto',
    'Estado', 'Intentos', 'Fecha envío', 'Nº adjuntos', 'Último error', 'Datos'],
  'Registro': ['Fecha', 'Tipo', 'Acción', 'Código OC', 'Código PRO', 'Detalle', 'Usuario'],
  'Tokens': ['Hash', 'Tipo', 'Código OC', 'Código PRO', 'Referencia', 'Creado', 'Expira', 'Usado', 'Resultado'],
  'Configuración': ['Clave', 'Valor', 'Descripción']
};

/** Orden de pestañas: PANEL primero. */
var ORDEN_PESTANAS = ['PANEL', 'Solicitudes', 'Profesionales', 'Ofertas', 'Presupuestos', 'Comisiones', 'Incidencias',
  'Valoraciones', 'Historial envíos', 'Registro', 'Configuración', 'Tokens'];

var DESPLEGABLES = {
  'Solicitudes': { 'Estado': ESTADOS_SOLICITUD },
  'Profesionales': { 'Estado': ESTADOS_PROFESIONAL, 'Prioridad': ['Normal', 'Baja'] },
  'Ofertas': { 'Estado': ESTADOS_OFERTA },
  'Presupuestos': { 'Estado': ESTADOS_PRESUPUESTO },
  'Comisiones': { 'Estado': ESTADOS_COMISION },
  'Incidencias': { 'Estado': ESTADOS_INCIDENCIA, 'Gravedad': ['Normal', 'Grave'], 'Categoría': CATEGORIAS_INCIDENCIA }
};
/* ============================================================ BASE: hojas, tablas, bloqueo, utilidades */

var _ss = null, _cfg = null, _lockDepth = 0, _tablas = {};

function ss_() {
  if (_ss) return _ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Falta SPREADSHEET_ID: ejecuta instalarV14 desde el editor.');
  _ss = SpreadsheetApp.openById(id);
  return _ss;
}

function hoja_(nombre) {
  var sh = ss_().getSheetByName(nombre);
  if (!sh) throw new Error('Falta la pestaña «' + nombre + '»: ejecuta instalarV14.');
  return sh;
}

/** Acceso por NOMBRE de columna (no por posición) a una pestaña del esquema. */
function tabla_(nombre) {
  if (_tablas[nombre]) return _tablas[nombre];
  var cols = ESQUEMA[nombre], sh = hoja_(nombre);
  var t = {
    nombre: nombre, sh: sh, cols: cols,
    col: function (c) { var j = cols.indexOf(c); if (j < 0) throw new Error('Columna desconocida ' + nombre + '.' + c); return j + 1; },
    todas: function () {
      var n = sh.getLastRow();
      if (n < 2) return [];
      var v = sh.getRange(2, 1, n - 1, cols.length).getValues();
      var out = [];
      v.forEach(function (r, i) {
        if (r.every(function (x) { return x === '' || x === false; })) return;
        var o = { _fila: i + 2 };
        cols.forEach(function (c, j) { o[c] = r[j]; });
        out.push(o);
      });
      return out;
    },
    buscar: function (c, val) {
      var all = t.todas();
      for (var i = 0; i < all.length; i++) if (String(all[i][c]).trim() === String(val).trim()) return all[i];
      return null;
    },
    agregar: function (o) {
      var fila = cols.map(function (c) { return o[c] === undefined ? '' : o[c]; });
      sh.appendRow(fila);
      return sh.getLastRow();
    },
    poner: function (fila, o) {
      Object.keys(o).forEach(function (k) { sh.getRange(fila, t.col(k)).setValue(o[k]); });
    }
  };
  _tablas[nombre] = t;
  return t;
}

/** Ejecuta fn con el bloqueo del script (reentrante dentro de la misma ejecución). */
function conLock_(fn) {
  if (_lockDepth > 0) { _lockDepth++; try { return fn(); } finally { _lockDepth--; } }
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  _lockDepth = 1;
  try { return fn(); } finally { _lockDepth = 0; SpreadsheetApp.flush(); lock.releaseLock(); }
}

function cfg_(clave) {
  if (!_cfg) {
    _cfg = {};
    CONFIG_DEFECTO.forEach(function (r) { _cfg[r[0]] = r[1]; });
    try { tabla_('Configuración').todas().forEach(function (r) { if (r['Clave']) _cfg[String(r['Clave']).trim()] = String(r['Valor']).trim(); }); } catch (e) { }
  }
  return _cfg[clave];
}
function cfgNum_(clave, def) { var n = parseFloat(String(cfg_(clave)).replace(',', '.')); return isNaN(n) ? def : n; }
function cfgBool_(clave) { return /^(true|si|sí|1|verdadero)$/i.test(String(cfg_(clave) || '').trim()); }
function cfgPoner_(clave, valor) {
  var t = tabla_('Configuración'), r = t.buscar('Clave', clave);
  if (r) t.poner(r._fila, { 'Valor': valor }); else t.agregar({ 'Clave': clave, 'Valor': valor });
  if (_cfg) _cfg[clave] = String(valor);
}

function urlApp_() {
  var u = cfg_('URL_APP');
  if (u) return u;
  try { u = ScriptApp.getService().getUrl(); } catch (e) { u = ''; }
  return u || '';
}

function siguienteCodigo_(clave, prefijo) {
  return conLock_(function () {
    var props = PropertiesService.getScriptProperties();
    var n = parseInt(props.getProperty(clave) || '0', 10) + 1;
    props.setProperty(clave, String(n));
    return prefijo + ('0000' + n).slice(-Math.max(4, String(n).length));
  });
}

function registrar_(tipo, accion, oc, pro, detalle, usuario) {
  try {
    tabla_('Registro').agregar({ 'Fecha': new Date(), 'Tipo': tipo, 'Acción': accion, 'Código OC': oc || '', 'Código PRO': pro || '',
      'Detalle': s_(detalle, 500), 'Usuario': usuario || 'sistema' });
  } catch (e) { console.error('registro: ' + e); }
}

/* ---------- limpieza de entradas ---------- */
// Texto: recorta, limita longitud y evita fórmulas (= + - @ al inicio).
function s_(v, max) {
  if (v === undefined || v === null) return '';
  var t = String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max || 300);
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return t;
}
// Teléfonos / códigos postales como texto (conserva + y ceros).
function t_(v) { var t = String(v || '').replace(/[^0-9+]/g, '').slice(0, 20); return t ? "'" + t : ''; }
function limpio_(v) { return String(v === undefined || v === null ? '' : v).replace(/^'/, '').trim(); }
function emailOk_(v) { return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/.test(String(v || '').trim()); }
function sinAcentos_(v) { return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim(); }
function esc_(t) { return String(t === undefined || t === null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function fecha_(d) { return d ? Utilities.formatDate(new Date(d), ZONA_HORARIA, 'dd/MM/yyyy HH:mm') : ''; }
function dia_(d) { return d ? Utilities.formatDate(new Date(d), ZONA_HORARIA, 'dd/MM/yyyy') : ''; }
function euros_(n) { return (Math.round(Number(n || 0) * 100) / 100).toFixed(2).replace('.', ',') + ' €'; }
function num_(v) {
  if (typeof v === 'number') return v;
  var t = String(v || '').replace(/\s|€/g, '');
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  else t = t.replace(/,/g, '');
  var n = parseFloat(t);
  return isNaN(n) ? NaN : Math.round(n * 100) / 100;
}

/** Servicio normalizado a partir del código o del nombre visible. */
function normServicio_(v) {
  var k = sinAcentos_(v);
  if (SERVICIOS[k]) return k;
  for (var c in SERVICIOS) if (sinAcentos_(SERVICIOS[c]) === k) return c;
  if (k === 'otro servicio' || k === 'otro') return 'otro';
  return '';
}
function listaServicios_(v) {
  var arr = Array.isArray(v) ? v : String(v || '').split(/[,;]/);
  var out = [];
  arr.forEach(function (x) { var c = normServicio_(x); if (c && out.indexOf(c) < 0) out.push(c); });
  return out;
}

/** Días (desde hoy, hora de Madrid) hasta una fecha AAAA-MM-DD; mínimo 0. */
function diasHasta_(f) {
  var m = String(f || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd').split('-');
  var a = Date.UTC(+hoy[0], +hoy[1] - 1, +hoy[2]), b = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  return Math.max(0, Math.round((b - a) / 86400000));
}

/** Días máximos aceptables para el cliente (null = flexible). */
function diasCliente_(sol) {
  var p = PLAZOS_CLIENTE[String(sol['Plazo (código)'])];
  if (!p || p.d === null) return null;
  if (p.d === 'fecha') { var d = diasHasta_(fechaIso_(sol['Fecha deseada'])); return d === null ? null : d; }
  return p.d;
}
function fechaIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ZONA_HORARIA, 'yyyy-MM-dd');
  return String(v || '').replace(/^'/, '').slice(0, 10);
}

function hash_(t) {
  var b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(t), Utilities.Charset.UTF_8);
  return b.map(function (x) { return ('0' + (x & 0xff).toString(16)).slice(-2); }).join('');
}

function json_(obj) { return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON); }
/* ============================================================ INSTALACIÓN (ejecutar desde el editor) */

/**
 * Prepara (o actualiza sin borrar datos) la hoja operativa a la que está vinculado este script:
 * pestañas, cabeceras, desplegables, configuración, carpeta de fotos y activadores.
 */
var NOMBRE_HOJA = 'OficioCerca — Operación';

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
  if (!hay('cicloAutomatico')) ScriptApp.newTrigger('cicloAutomatico').timeBased().everyMinutes(10).create();
  if (!hay('resumenDiario')) ScriptApp.newTrigger('resumenDiario').timeBased().atHour(8).nearMinute(5).everyDays(1).inTimezone(ZONA_HORARIA).create();

  actualizarPanel();
  ss.setActiveSheet(ss.getSheetByName('PANEL'));
  Logger.log('V1.4 instalada. Hoja: ' + ss.getUrl());
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
  if (d.consentContacto !== 'si' || d.consentCompartir !== 'si' || d.consentPrivacidad !== 'si') invalido_('faltan consentimientos');
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
    var manual = servicio === 'otro';
    ts.agregar({
      'Código': code, 'Fecha': new Date(), 'Estado': manual ? 'Revisión manual' : 'Nueva',
      'Requiere intervención': manual ? 'Otro servicio: revisar demanda' : '',
      'Tipo solicitante': /empresa/i.test(d.tipoSolicitante) ? 'Empresa / Contratista' : 'Particular',
      'Nombre': s_(d.nombre, 120), 'Empresa': s_(d.empresa, 120), 'WhatsApp': t_(d.whatsapp), 'Teléfono alt.': t_(d.telefonoAlt),
      'Email': s_(d.email, 160).toLowerCase(), 'Ciudad': 'Córdoba', 'Código postal': t_(d.codigoPostal), 'Zona': s_(d.zona, 120),
      'Servicio (código)': servicio, 'Servicio': SERVICIOS[servicio], 'Servicio (otro)': s_(d.oficioOtro, 120),
      'Tipo de trabajo': s_(d.tipoTrabajo, 80), 'Descripción': s_(d.descripcion, 3000), 'Plazo (código)': d.plazo,
      'Plazo': PLAZOS_CLIENTE[d.plazo].t, 'Fecha deseada': d.plazo === 'OTRA_FECHA' ? "'" + String(d.fechaDeseada).slice(0, 10) : '',
      'Contacto preferido (para el profesional)': ['WhatsApp', 'Llamada', 'Correo'].indexOf(d.contactoPreferido) >= 0 ? d.contactoPreferido : 'WhatsApp',
      'Nº fotos': fotos.length, 'Carpeta fotos (ID)': carpetaId, 'Consent. contacto': 'Sí', 'Consent. compartir': 'Sí', 'Consent. privacidad': 'Sí',
      'Versión consentimiento': s_(d.consentVersion || cfg_('CONSENT_VERSION'), 40), 'Origen': origen_(d), 'Última actualización': new Date()
    });
    registrar_('Sistema', 'Solicitud recibida', code, '', SERVICIOS[servicio] + ' · ' + PLAZOS_CLIENTE[d.plazo].t + ' · ' + fotos.length + ' foto(s)');
    encolarCorreo_('cli-confirmacion-' + code, 'confirmacion_cliente', 'Cliente', s_(d.email, 160).toLowerCase(), code, '', { token: { tipo: 'cliente', dias: 180 } });
    if (!manual) { try { motor_(code); } catch (err) { errorSistema_('motor ' + code, err); } }
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
  var servicios = listaServicios_(d.servicios);
  if (!servicios.length) invalido_('elige al menos un servicio');
  if (servicios.indexOf('otro') >= 0 && !String(d.servicioOtro || '').trim()) invalido_('falta servicioOtro');
  if (d.consentContacto !== 'si' || d.consentPrivacidad !== 'si' || d.consentCondiciones !== 'si') invalido_('faltan consentimientos');
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
      'Con empresas': d.conEmpresas === 'Sí' ? 'Sí' : 'No', 'Descripción': s_(d.descripcion, 1500), 'Consent. contacto': 'Sí', 'Consent. privacidad': 'Sí',
      'Condiciones (versión)': version, 'Condiciones aceptadas (fecha)': new Date(), 'Origen': origen_(d), 'Prioridad': 'Normal',
      'Ofertas recibidas': 0, 'Respuestas': 0, 'Aceptadas': 0, 'Asignaciones': 0, 'Completados': 0, 'Incidencias verificadas': 0
    });
    registrar_('Sistema', 'Profesional registrado (pendiente de revisar)', '', code, servicios.join(', ') + ' · condiciones ' + version);
    encolarCorreo_('pro-registro-' + code, 'registro_profesional', 'Profesional', email, '', code, {});
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
/* ============================================================ MOTOR DE MATCHING (reglas deterministas, sin IA)
 *
 * FILTROS DUROS (todos obligatorios):
 *  1. Profesional «Activo» (no Pendiente, En revisión, Pausado ni Baja) y con correo válido.
 *  2. El servicio pedido está entre SUS servicios declarados (códigos normalizados).
 *  3. Condiciones para profesionales aceptadas (versión registrada).
 *  4. Zona/distancia compatibles con Córdoba capital:
 *       - ciudad Córdoba: sirve, salvo «Solo mi barrio o pueblo» sin coincidencia de zona/CP;
 *       - otra localidad de la provincia (CP 14…): solo si se desplaza «Hasta 25 km» o más.
 *  5. Atiende ese tipo de cliente (particulares / empresas).
 *  6. No ha recibido ya esta solicitud.
 * ORDEN (explicable, se guarda en «Motivo ranking»):
 *  +3 su zona menciona el barrio o el CP del cliente · +2 su disponibilidad habitual encaja con el plazo
 *  +1 valoración media ≥ 4 · −2 por incidencia verificada · −3 prioridad «Baja»
 *  desempate: menos ofertas en 30 días (rotación justa) → oferta más antigua → alta más antigua.
 * Ofertas SECUENCIALES: una oferta activa por solicitud, nunca envíos masivos.
 */

var ESTADOS_BUSQUEDA = ['Nueva', 'Buscando profesional', 'Esperando respuesta profesional', 'Sin profesional compatible'];

function solicitud_(oc) {
  var r = tabla_('Solicitudes').buscar('Código', oc);
  if (!r) throw new Error('No existe ' + oc);
  return r;
}
function profesional_(pro) { return tabla_('Profesionales').buscar('Código', String(pro || '').trim().toUpperCase()); }
function actualizarSol_(sol, cambios) {
  cambios['Última actualización'] = new Date();
  tabla_('Solicitudes').poner(sol._fila, cambios);
  Object.keys(cambios).forEach(function (k) { sol[k] = cambios[k]; });
}

/** Avanza la búsqueda de una solicitud. Seguro de llamar varias veces (idempotente). */
function motor_(oc) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (ESTADOS_BUSQUEDA.indexOf(sol['Estado']) < 0) return 'sin búsqueda (' + sol['Estado'] + ')';
    if (sol['Servicio (código)'] === 'otro') { actualizarSol_(sol, { 'Estado': 'Revisión manual', 'Requiere intervención': 'Otro servicio: revisar demanda' }); return 'manual'; }
    var ofertas = tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === oc; });
    var activa = ofertas.filter(function (o) { return o['Estado'] === 'Enviada'; })[0];
    if (activa) return 'esperando ' + activa['Código PRO'];

    var cand = candidatos_(sol, ofertas);
    if (cand.length) {
      ofrecer_(sol, cand[0]);
      return 'ofrecida a ' + cand[0].pro['Código'];
    }
    // Sin más candidatos
    var respaldo = mejorRespaldo_(ofertas);
    if (respaldo && sol['Decisión cliente'] !== 'Seguir buscando') {
      if (sol['Estado'] !== 'Esperando decisión cliente') {
        actualizarSol_(sol, { 'Estado': 'Esperando decisión cliente', 'Requiere intervención': '', 'Respaldo (PRO)': respaldo['Código PRO'], 'Respaldo disponibilidad': respaldo['Disponibilidad'] });
        encolarCorreo_('cli-respaldo-' + oc + '-' + respaldo['Código PRO'], 'respaldo_cliente', 'Cliente', sol['Email'], oc, respaldo['Código PRO'],
          { token: { tipo: 'respaldo', ref: respaldo['ID'], dias: 7 } });
        registrar_('Sistema', 'Cliente debe decidir sobre disponibilidad posterior', oc, respaldo['Código PRO'], respaldo['Disponibilidad']);
      }
      return 'respaldo ' + respaldo['Código PRO'];
    }
    if (sol['Estado'] !== 'Sin profesional compatible') {
      actualizarSol_(sol, { 'Estado': 'Sin profesional compatible', 'Requiere intervención': 'No hay profesional compatible disponible' + (respaldo ? ' (el cliente pidió seguir buscando)' : '') });
      registrar_('Sistema', 'Sin profesional compatible', oc, '', SERVICIOS[sol['Servicio (código)']] + ' · ' + sol['Zona']);
    }
    return 'sin candidatos';
  });
}

function candidatos_(sol, ofertasOC) {
  var servicio = sol['Servicio (código)'];
  var yaOfrecidos = ofertasOC.map(function (o) { return String(o['Código PRO']); });
  var empresa = /empresa/i.test(sol['Tipo solicitante']);
  var dCli = diasCliente_(sol);
  var hace30 = Date.now() - 30 * 86400000;
  var todasOfertas = tabla_('Ofertas').todas();
  var out = [];
  tabla_('Profesionales').todas().forEach(function (p) {
    var code = String(p['Código']);
    if (String(p['Estado']).trim() !== 'Activo') return;
    if (!emailOk_(p['Email'])) return;
    if (listaServicios_(p['Servicios (códigos)']).indexOf(servicio) < 0) return;
    if (!String(p['Condiciones (versión)']).trim() || !p['Condiciones aceptadas (fecha)']) return;
    if (empresa ? p['Con empresas'] !== 'Sí' : p['Con particulares'] !== 'Sí') return;
    if (yaOfrecidos.indexOf(code) >= 0) return;
    var zona = zonaCompatible_(p, sol);
    if (!zona.ok) return;
    var puntos = 0, motivos = [];
    if (zona.coincide) { puntos += 3; motivos.push('zona +3'); }
    var habitual = sinAcentos_(p['Disponibilidad habitual']);
    if (dCli !== null && dCli <= 7 && /esta semana/.test(habitual)) { puntos += 2; motivos.push('disponibilidad habitual +2'); }
    if (dCli !== null && dCli > 7 && /1-2 semanas|1–2 semanas/.test(habitual)) { puntos += 1; motivos.push('disponibilidad habitual +1'); }
    if (dCli === null && !/completa/.test(habitual)) { puntos += 1; motivos.push('plazo flexible +1'); }
    var media = Number(p['Valoración media']) || 0;
    if (media >= 4) { puntos += 1; motivos.push('valoración +1'); }
    var inc = Number(p['Incidencias verificadas']) || 0;
    if (inc) { puntos -= 2 * inc; motivos.push('incidencias −' + 2 * inc); }
    if (p['Prioridad'] === 'Baja') { puntos -= 3; motivos.push('prioridad baja −3'); }
    var recientes = todasOfertas.filter(function (o) { return o['Código PRO'] === code && new Date(o['Fecha envío']).getTime() > hace30; });
    var ultima = recientes.reduce(function (m, o) { return Math.max(m, new Date(o['Fecha envío']).getTime()); }, 0);
    motivos.push(recientes.length + ' oferta(s)/30 días');
    out.push({ pro: p, puntos: puntos, recientes: recientes.length, ultima: ultima, alta: new Date(p['Fecha']).getTime(), motivo: motivos.join(' · ') });
  });
  out.sort(function (a, b) { return b.puntos - a.puntos || a.recientes - b.recientes || a.ultima - b.ultima || a.alta - b.alta; });
  return out;
}

function zonaCompatible_(p, sol) {
  var ciudad = sinAcentos_(p['Ciudad']), dist = sinAcentos_(p['Distancia']);
  var zonasPro = sinAcentos_(p['Zonas']), zonaCli = sinAcentos_(sol['Zona']), cpCli = limpio_(sol['Código postal']);
  var coincide = (zonaCli.length >= 3 && zonasPro.indexOf(zonaCli) >= 0) || (cpCli && zonasPro.indexOf(cpCli) >= 0) || (cpCli && cpCli === limpio_(p['Código postal']));
  var enCordoba = /(^|\b)cordoba(\b|$)/.test(ciudad) && !/provincia/.test(ciudad);
  if (enCordoba) {
    if (/solo mi barrio/.test(dist) && !coincide) return { ok: false };
    return { ok: true, coincide: coincide };
  }
  var cpPro = limpio_(p['Código postal']);
  if (/^14/.test(cpPro) && /(25|50) km|provincia/.test(dist)) return { ok: true, coincide: coincide };
  return { ok: false };
}

function plazoRespuestaHoras_(sol) {
  var d = diasCliente_(sol);
  return (d !== null && d <= 1) ? cfgNum_('HORAS_RESPUESTA_URGENTE', 4) : cfgNum_('HORAS_RESPUESTA_NORMAL', 24);
}
/** Vencimiento evitando la noche: si cae entre 21:00 y 9:00 se pasa a las 10:00. */
function vencimiento_(horas) {
  var d = new Date(Date.now() + horas * 3600000);
  var h = Number(Utilities.formatDate(d, ZONA_HORARIA, 'H'));
  if (h >= 21) d = new Date(d.getTime() + (24 - h + 10) * 3600000);
  else if (h < 9) d = new Date(d.getTime() + (10 - h) * 3600000);
  return d;
}

function ofrecer_(sol, c) {
  var oc = sol['Código'], p = c.pro, pro = p['Código'];
  var id = 'OF-' + oc + '-' + pro;
  var expira = vencimiento_(plazoRespuestaHoras_(sol));
  tabla_('Ofertas').agregar({
    'ID': id, 'Fecha envío': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Profesional': p['Nombre'],
    'Servicio': SERVICIOS[sol['Servicio (código)']] || sol['Servicio'], 'Puntuación': c.puntos, 'Motivo ranking': c.motivo,
    'Estado': 'Enviada', 'Expira': expira
  });
  actualizarSol_(sol, { 'Estado': 'Esperando respuesta profesional', 'Requiere intervención': '' });
  encolarCorreo_('pro-oferta-' + id, 'oferta_profesional', 'Profesional', p['Email'], oc, pro,
    { token: { tipo: 'oferta', ref: id, expira: expira.getTime() }, expira: expira.getTime() });
  registrar_('Sistema', 'Oportunidad enviada', oc, pro, c.motivo + ' · responde antes de ' + fecha_(expira));
}

/** Mejor respaldo = el que puede antes (menos días). */
function mejorRespaldo_(ofertasOC) {
  var r = ofertasOC.filter(function (o) { return o['Estado'] === 'Respaldo'; })
    .filter(function (o) { var p = profesional_(o['Código PRO']); return p && p['Estado'] === 'Activo'; });
  r.sort(function (a, b) { return Number(a['Días hasta disponibilidad']) - Number(b['Días hasta disponibilidad']); });
  return r[0] || null;
}

/**
 * Respuesta del profesional a una oportunidad (desde la página del enlace).
 * tipo: 'si' (disp = código DISP_PRO), 'mas_adelante' (fecha), 'no'.
 */
function procesarRespuestaOferta_(ofertaId, tipo, disp, fecha, nota) {
  return conLock_(function () {
    var to = tabla_('Ofertas'), of = to.buscar('ID', ofertaId);
    if (!of) return { ok: false, msg: 'Oportunidad no encontrada.' };
    if (of['Estado'] !== 'Enviada') return { ok: true, ya: true, msg: 'Ya habíamos registrado tu respuesta. ¡Gracias!' };
    var sol = solicitud_(of['Código OC']);
    if (['Esperando respuesta profesional', 'Buscando profesional'].indexOf(sol['Estado']) < 0) {
      to.poner(of._fila, { 'Estado': 'Cerrada', 'Fecha respuesta': new Date(), 'Notas': 'Respuesta tras cierre de la búsqueda' });
      return { ok: true, msg: 'Gracias. Esta solicitud ya no necesita profesional.' };
    }
    var ahora = new Date();
    if (tipo === 'no') {
      to.poner(of._fila, { 'Estado': 'Rechazada', 'Respuesta': 'No puede / no le interesa', 'Fecha respuesta': ahora, 'Notas': s_(nota, 300) });
      registrar_('Sistema', 'Profesional rechaza', sol['Código'], of['Código PRO'], s_(nota, 200));
      motor_(sol['Código']);
      return { ok: true, msg: 'Gracias por responder. Te enviaremos otras oportunidades compatibles.' };
    }
    var dias, dispCod, dispTxt;
    if (tipo === 'si' && DISP_PRO[disp] && disp !== 'OTRA_FECHA') { dispCod = disp; dias = DISP_PRO[disp].d; dispTxt = DISP_PRO[disp].t; }
    else {
      dias = diasHasta_(fecha);
      if (dias === null) return { ok: false, msg: 'Indica una fecha aproximada válida.' };
      dispCod = 'OTRA_FECHA'; dispTxt = 'A partir del ' + String(fecha).slice(8, 10) + '/' + String(fecha).slice(5, 7) + '/' + String(fecha).slice(0, 4);
    }
    var dCli = diasCliente_(sol);
    var encaja = dCli === null || dias <= dCli;
    to.poner(of._fila, {
      'Estado': encaja ? 'Seleccionada' : 'Respaldo', 'Respuesta': tipo === 'si' ? 'Puede atenderlo' : 'Puede, más adelante',
      'Disponibilidad (código)': dispCod, 'Disponibilidad': dispTxt, 'Días hasta disponibilidad': dias, 'Fecha respuesta': ahora, 'Notas': s_(nota, 300)
    });
    if (encaja) {
      asignar_(sol, of['Código PRO'], dispTxt, 'Plazo compatible');
      return { ok: true, msg: '¡Gracias! Te asignamos la solicitud. En unos minutos recibirás un correo con los datos de contacto del cliente.' };
    }
    registrar_('Sistema', 'Candidato de respaldo (plazo posterior)', sol['Código'], of['Código PRO'], dispTxt + ' · cliente: ' + sol['Plazo']);
    motor_(sol['Código']);
    return { ok: true, msg: 'Gracias. El cliente pidió un plazo más corto: guardamos tu disponibilidad como opción y te avisaremos si la solicitud es para ti.' };
  });
}

/** Asigna, cierra las demás ofertas y comparte el contacto SOLO con el asignado. Idempotente. */
function asignar_(sol, pro, dispTxt, motivo) {
  var oc = sol['Código'];
  if (sol['Profesional asignado (PRO)']) return false;
  var p = profesional_(pro);
  if (!p || p['Estado'] !== 'Activo') throw new Error(pro + ' no está activo');
  var to = tabla_('Ofertas');
  to.todas().filter(function (o) { return o['Código OC'] === oc; }).forEach(function (o) {
    if (o['Código PRO'] === pro) { if (o['Estado'] !== 'Seleccionada') to.poner(o._fila, { 'Estado': 'Seleccionada' }); return; }
    if (o['Estado'] === 'Enviada') to.poner(o._fila, { 'Estado': 'Cerrada', 'Notas': 'Solicitud asignada a otro profesional' });
    if (o['Estado'] === 'Respaldo') {
      to.poner(o._fila, { 'Estado': 'Cerrada', 'Notas': 'Se encontró disponibilidad antes' });
      var pr = profesional_(o['Código PRO']);
      if (pr) encolarCorreo_('pro-cubierta-' + oc + '-' + o['Código PRO'], 'solicitud_cubierta', 'Profesional', pr['Email'], oc, o['Código PRO'], {});
    }
  });
  actualizarSol_(sol, { 'Estado': 'Profesional asignado', 'Requiere intervención': '', 'Profesional asignado (PRO)': pro, 'Fecha asignación': new Date(), 'Disponibilidad profesional': dispTxt });
  encolarCorreo_('pro-contacto-' + oc + '-' + pro, 'contacto_profesional', 'Profesional', p['Email'], oc, pro, { token: { tipo: 'gestion', dias: 180 } });
  encolarCorreo_('cli-asignado-' + oc + '-' + pro, 'asignado_cliente', 'Cliente', sol['Email'], oc, pro, { disp: dispTxt, token: { tipo: 'cliente', dias: 180 } });
  actualizarSol_(sol, { 'Contacto enviado (fecha)': new Date() });
  registrar_('Sistema', 'Asignación automática y contacto compartido', oc, pro, motivo + ' · ' + dispTxt);
  return true;
}

/** Decisión del cliente cuando solo hay disponibilidad posterior. */
function procesarDecisionRespaldo_(ofertaId, decision) {
  return conLock_(function () {
    var of = tabla_('Ofertas').buscar('ID', ofertaId);
    if (!of) return { ok: false, msg: 'Enlace no válido.' };
    var sol = solicitud_(of['Código OC']);
    if (sol['Estado'] !== 'Esperando decisión cliente') return { ok: true, ya: true, msg: 'Ya habíamos registrado tu decisión. Estado actual: ' + sol['Estado'] + '.' };
    if (decision === 'continuar') {
      if (of['Estado'] !== 'Respaldo') return { ok: false, msg: 'Esa disponibilidad ya no está vigente. Seguimos buscando.' };
      var p = profesional_(of['Código PRO']);
      if (!p || p['Estado'] !== 'Activo') { actualizarSol_(sol, { 'Estado': 'Buscando profesional' }); motor_(sol['Código']); return { ok: true, msg: 'Ese profesional ya no está disponible. Seguimos buscando y te escribiremos.' }; }
      actualizarSol_(sol, { 'Decisión cliente': 'Continuar con respaldo (' + fecha_(new Date()) + ')' });
      tabla_('Ofertas').poner(of._fila, { 'Estado': 'Seleccionada', 'Notas': 'Aceptado por el cliente con plazo posterior' });
      asignar_(sol, of['Código PRO'], of['Disponibilidad'], 'El cliente aceptó la disponibilidad posterior');
      return { ok: true, msg: 'Perfecto. Hemos asignado tu solicitud a ese profesional: te enviamos un correo con sus datos y él te contactará.' };
    }
    if (decision === 'seguir') {
      actualizarSol_(sol, { 'Estado': 'Buscando profesional', 'Decisión cliente': 'Seguir buscando', 'Requiere intervención': '' });
      registrar_('Sistema', 'Cliente pide seguir buscando', sol['Código'], of['Código PRO'], '');
      motor_(sol['Código']);
      return { ok: true, msg: 'De acuerdo, seguimos buscando. Conservamos la opción anterior por si la necesitas.' };
    }
    if (decision === 'cancelar') {
      cancelarSolicitud_(sol, 'Cancelada por el cliente (plazo no encaja)');
      return { ok: true, msg: 'Hemos cancelado tu solicitud. Gracias por confiar en OficioCerca.' };
    }
    return { ok: false, msg: 'Opción no válida.' };
  });
}

function cancelarSolicitud_(sol, motivo) {
  var to = tabla_('Ofertas');
  to.todas().filter(function (o) { return o['Código OC'] === sol['Código'] && (o['Estado'] === 'Enviada' || o['Estado'] === 'Respaldo'); })
    .forEach(function (o) { to.poner(o._fila, { 'Estado': 'Cerrada', 'Notas': 'Solicitud cancelada' }); });
  actualizarSol_(sol, { 'Estado': 'Cancelada', 'Motivo cierre': motivo, 'Requiere intervención': '' });
  registrar_('Sistema', 'Solicitud cancelada', sol['Código'], '', motivo);
}

/** Vencimientos y reintentos (lo llama el ciclo automático). */
function revisarOfertas_() {
  var ahora = Date.now(), tocadas = {};
  var to = tabla_('Ofertas');
  to.todas().forEach(function (o) {
    if (o['Estado'] !== 'Enviada') return;
    var p = profesional_(o['Código PRO']);
    if (!p || p['Estado'] !== 'Activo') { to.poner(o._fila, { 'Estado': 'Cerrada', 'Notas': 'Profesional ya no activo' }); tocadas[o['Código OC']] = 1; return; }
    if (o['Expira'] && new Date(o['Expira']).getTime() < ahora) {
      to.poner(o._fila, { 'Estado': 'Sin respuesta', 'Respuesta': 'Sin respuesta en plazo', 'Notas': 'Venció ' + fecha_(o['Expira']) });
      registrar_('Sistema', 'Oferta sin respuesta (vencida)', o['Código OC'], o['Código PRO'], '');
      tocadas[o['Código OC']] = 1;
    }
  });
  tabla_('Solicitudes').todas().forEach(function (s) {
    if (['Nueva', 'Buscando profesional', 'Sin profesional compatible'].indexOf(s['Estado']) >= 0) tocadas[s['Código']] = 1;
  });
  Object.keys(tocadas).forEach(function (oc) { try { motor_(oc); } catch (e) { errorSistema_('motor ' + oc, e); } });
}

/** Oferta manual del administrador (columna «Ofrecer a (PRO manual)»), p. ej. para «Otro servicio». */
function ofertaManual_(sol, pro) {
  pro = String(pro || '').trim().toUpperCase();
  var p = profesional_(pro);
  if (!p) return 'No existe ' + pro;
  if (p['Estado'] !== 'Activo') return pro + ' no está Activo';
  if (!p['Condiciones aceptadas (fecha)']) return pro + ' no ha aceptado las condiciones';
  var ofertas = tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === sol['Código']; });
  if (ofertas.some(function (o) { return o['Estado'] === 'Enviada'; })) return 'Ya hay una oferta pendiente de respuesta';
  if (ofertas.some(function (o) { return o['Código PRO'] === pro; })) return pro + ' ya recibió esta solicitud';
  if (['Profesional asignado', 'Presupuesto enviado', 'Cliente aceptó', 'Finalizado', 'Valorada', 'Cancelada'].indexOf(sol['Estado']) >= 0) return 'La solicitud está «' + sol['Estado'] + '»';
  ofrecer_(sol, { pro: p, puntos: '', motivo: 'Oferta manual del administrador' });
  return 'Oferta enviada a ' + pro;
}
/* ============================================================ PRESUPUESTO · COMISIÓN · FINALIZACIÓN · VALORACIÓN · INCIDENCIAS */

var ESTADOS_PERMITEN_PRESUPUESTO = ['Profesional asignado', 'Presupuesto enviado', 'Presupuesto no aceptado'];

/** El profesional asignado registra (o corrige) su presupuesto. Cada cambio = nueva versión; nada se sobrescribe. */
function registrarPresupuesto_(oc, pro, manoObra, materiales, obs) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Esta solicitud no está asignada a ti.' };
    if (ESTADOS_PERMITEN_PRESUPUESTO.indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no se puede registrar un presupuesto (estado: ' + sol['Estado'] + ').' };
    var mo = num_(manoObra), mat = materiales === '' || materiales === undefined || materiales === null ? 0 : num_(materiales);
    if (isNaN(mo) || mo < 0 || isNaN(mat) || mat < 0) return { ok: false, msg: 'Revisa los importes: usa números (por ejemplo 350 o 350,50).' };
    if (mo > 1000000 || mat > 1000000) return { ok: false, msg: 'Importe demasiado alto. Revisa las cifras.' };
    var total = Math.round((mo + mat) * 100) / 100;
    if (total <= 0) return { ok: false, msg: 'El total debe ser mayor que 0.' };
    var tp = tabla_('Presupuestos');
    var previos = tp.todas().filter(function (r) { return r['Código OC'] === oc; });
    var ultimo = previos[previos.length - 1];
    // Doble clic / recarga: mismo importe y observaciones en los últimos 10 minutos → no se duplica
    if (ultimo && Number(ultimo['Mano de obra (€)']) === mo && Number(ultimo['Materiales (€)']) === mat && String(ultimo['Observaciones']) === s_(obs, 1000) &&
      Date.now() - new Date(ultimo['Fecha']).getTime() < 10 * 60000) return { ok: true, ya: true, msg: 'Este presupuesto ya estaba registrado (versión ' + ultimo['Versión'] + ').' };
    previos.forEach(function (r) { if (r['Estado'] === 'Enviado al cliente') tp.poner(r._fila, { 'Estado': 'Sustituido' }); });
    var version = previos.length + 1, id = 'P-' + oc + '-v' + version;
    tp.agregar({ 'ID': id, 'Fecha': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Versión': version, 'Mano de obra (€)': mo, 'Materiales (€)': mat,
      'Total (€)': total, 'Observaciones': s_(obs, 1000), 'Estado': 'Enviado al cliente' });
    actualizarSol_(sol, { 'Estado': 'Presupuesto enviado', 'Presupuesto vigente': id });
    encolarCorreo_('cli-presupuesto-' + id, 'presupuesto_cliente', 'Cliente', sol['Email'], oc, pro, { presupuesto: id, token: { tipo: 'presupuesto', ref: id } });
    registrar_('Sistema', 'Presupuesto registrado', oc, pro, id + ' · MO ' + euros_(mo) + ' · materiales ' + euros_(mat) + ' · total ' + euros_(total));
    return { ok: true, msg: 'Presupuesto registrado (versión ' + version + ', total ' + euros_(total) + '). Se lo hemos enviado al cliente para que lo acepte o no.' };
  });
}

function comisionDe_(manoObra) {
  var pct = cfgNum_('COMISION_PORCENTAJE', 10), max = cfgNum_('COMISION_MAXIMO_EUR', 200);
  return { pct: pct, importe: Math.min(Math.round(manoObra * pct) / 100, max) };
}

/** Respuesta del CLIENTE a un presupuesto: 'aceptar' | 'rechazar' | 'hablar'. */
function procesarRespuestaPresupuesto_(presId, decision) {
  return conLock_(function () {
    var tp = tabla_('Presupuestos'), pr = tp.buscar('ID', presId);
    if (!pr) return { ok: false, msg: 'Presupuesto no encontrado.' };
    var sol = solicitud_(pr['Código OC']), oc = sol['Código'], pro = pr['Código PRO'];
    var p = profesional_(pro);
    if (pr['Estado'] === 'Aceptado') return { ok: true, ya: true, msg: 'Ya habías aceptado este presupuesto. ¡Gracias!' };
    if (pr['Estado'] === 'No aceptado') return { ok: true, ya: true, msg: 'Ya nos indicaste que no aceptas este presupuesto.' };
    if (pr['Estado'] !== 'Enviado al cliente' || sol['Presupuesto vigente'] !== presId) return { ok: false, msg: 'Este presupuesto fue sustituido por una versión más reciente. Revisa el último correo que te enviamos.' };
    var ahora = new Date();
    if (decision === 'aceptar') {
      var mo = Number(pr['Mano de obra (€)']) || 0, com = comisionDe_(mo);
      tp.poner(pr._fila, { 'Estado': 'Aceptado', 'Respuesta cliente (fecha)': ahora });
      actualizarSol_(sol, { 'Estado': 'Cliente aceptó', 'Mano de obra aceptada (€)': mo, 'Total aceptado (€)': Number(pr['Total (€)']),
        'Comisión (€)': com.importe, 'Fecha aceptación': ahora });
      var tc = tabla_('Comisiones');
      var existe = tc.todas().some(function (c) { return c['Código OC'] === oc && c['Estado'] !== 'Anulada'; });
      if (!existe) tc.agregar({ 'Código OC': oc, 'Código PRO': pro, 'Profesional': p ? p['Nombre'] : '', 'Presupuesto': presId, 'Mano de obra (€)': mo,
        'Porcentaje': com.pct + ' %', 'Importe comisión (€)': com.importe, 'Fecha generación': ahora,
        'Estado': cfgBool_('COMMISSION_COLLECTION_ENABLED') ? 'Pendiente' : 'Pendiente de habilitación',
        'Notas': cfgBool_('COMMISSION_COLLECTION_ENABLED') ? '' : 'Cobro no habilitado: solo cálculo y registro.' });
      if (p) encolarCorreo_('pro-pres-aceptado-' + presId, 'presupuesto_aceptado_pro', 'Profesional', p['Email'], oc, pro, { presupuesto: presId, token: { tipo: 'gestion', dias: 180 } });
      registrar_('Sistema', 'Cliente acepta presupuesto · comisión calculada', oc, pro, presId + ' · MO ' + euros_(mo) + ' · comisión ' + euros_(com.importe));
      return { ok: true, msg: 'Has aceptado el presupuesto. El profesional ya está avisado. Cuando termine el trabajo te pediremos que lo confirmes.' };
    }
    if (decision === 'rechazar') {
      tp.poner(pr._fila, { 'Estado': 'No aceptado', 'Respuesta cliente (fecha)': ahora });
      actualizarSol_(sol, { 'Estado': 'Presupuesto no aceptado' });
      if (p) encolarCorreo_('pro-pres-rechazado-' + presId, 'presupuesto_rechazado_pro', 'Profesional', p['Email'], oc, pro, { presupuesto: presId, token: { tipo: 'gestion', dias: 180 } });
      registrar_('Sistema', 'Cliente no acepta presupuesto', oc, pro, presId);
      return { ok: true, msg: 'Hemos registrado que no aceptas este presupuesto. El profesional puede enviarte otra propuesta si lo ve oportuno.' };
    }
    if (decision === 'hablar') {
      if (p) encolarCorreo_('pro-pres-hablar-' + presId, 'presupuesto_hablar_pro', 'Profesional', p['Email'], oc, pro, { presupuesto: presId });
      tp.poner(pr._fila, { 'Notas': 'El cliente quiere hablar (' + fecha_(ahora) + ')' });
      registrar_('Sistema', 'Cliente quiere hablar con el profesional', oc, pro, presId);
      return { ok: true, noConsume: true, msg: 'Hemos pedido al profesional que te contacte. Este enlace sigue sirviendo para aceptar o no el presupuesto más tarde.' };
    }
    return { ok: false, msg: 'Opción no válida.' };
  });
}

/** El profesional indica que terminó. No cierra la solicitud: el cliente debe confirmarlo. */
function marcarFinalizado_(oc, pro) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Esta solicitud no está asignada a ti.' };
    if (sol['Estado'] === 'Finalización por confirmar') return { ok: true, ya: true, msg: 'Ya lo habías indicado. Estamos esperando la confirmación del cliente.' };
    if (sol['Estado'] !== 'Cliente aceptó') return { ok: false, msg: 'Solo se puede marcar como finalizado un trabajo con presupuesto aceptado (estado actual: ' + sol['Estado'] + ').' };
    var n = tabla_('Registro').todas().filter(function (r) { return r['Código OC'] === oc && r['Acción'] === 'Profesional indica trabajo finalizado'; }).length + 1;
    actualizarSol_(sol, { 'Estado': 'Finalización por confirmar' });
    encolarCorreo_('cli-fin-' + oc + '-' + n, 'fin_cliente', 'Cliente', sol['Email'], oc, pro, { token: { tipo: 'fin' } });
    registrar_('Sistema', 'Profesional indica trabajo finalizado', oc, pro, 'Aviso ' + n);
    return { ok: true, msg: 'Gracias. Hemos pedido al cliente que confirme que el trabajo terminó.' };
  });
}

/** Confirmación del cliente: 'si' | 'aun_no' | 'problema' (+ texto y gravedad). */
function procesarFinCliente_(oc, decision, texto, grave) {
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'], p = profesional_(pro);
    if (['Finalizado', 'Valorada'].indexOf(sol['Estado']) >= 0) return { ok: true, ya: true, msg: 'Ya confirmaste que el trabajo terminó. ¡Gracias!' };
    if (sol['Estado'] !== 'Finalización por confirmar') return { ok: false, msg: 'Este enlace ya no está vigente (estado: ' + sol['Estado'] + ').' };
    if (decision === 'si') {
      actualizarSol_(sol, { 'Estado': 'Finalizado', 'Finalizado (fecha)': new Date() });
      encolarCorreo_('cli-valorar-' + oc, 'valorar_cliente', 'Cliente', sol['Email'], oc, pro, { token: { tipo: 'valorar', dias: 60 } });
      registrar_('Sistema', 'Cliente confirma finalización', oc, pro, '');
      return { ok: true, valorar: true, msg: '¡Gracias! Hemos cerrado el trabajo como finalizado. Te acabamos de enviar un correo para valorar el servicio.' };
    }
    if (decision === 'aun_no') {
      actualizarSol_(sol, { 'Estado': 'Cliente aceptó' });
      if (p) encolarCorreo_('pro-aun-no-' + oc + '-' + Date.now(), 'aun_no_pro', 'Profesional', p['Email'], oc, pro, { token: { tipo: 'gestion', dias: 180 } });
      registrar_('Sistema', 'Cliente indica que aún no ha terminado', oc, pro, '');
      return { ok: true, msg: 'Entendido. Avisamos al profesional. Cuando termine, te volveremos a preguntar.' };
    }
    if (decision === 'problema') {
      actualizarSol_(sol, { 'Estado': 'Cliente aceptó' });
      crearIncidencia_({ tipo: 'Incidencia', oc: oc, pro: pro, origen: 'Cliente (finalización)', categoria: 'Problema con el trabajo', grave: !!grave, texto: texto });
      return { ok: true, msg: 'Lo sentimos. Hemos registrado el problema y una persona de OficioCerca lo revisará y te escribirá.' };
    }
    return { ok: false, msg: 'Opción no válida.' };
  });
}

/** Valoración 1–5 ligada a OC + PRO (una por solicitud). */
function procesarValoracion_(oc, estrellas, comentario) {
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'];
    estrellas = parseInt(estrellas, 10);
    if (!(estrellas >= 1 && estrellas <= 5)) return { ok: false, msg: 'Elige de 1 a 5 estrellas.' };
    if (['Finalizado', 'Valorada'].indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Solo se puede valorar un trabajo finalizado.' };
    var tv = tabla_('Valoraciones');
    if (tv.todas().some(function (v) { return v['Código OC'] === oc; })) return { ok: true, ya: true, msg: 'Ya habíamos recibido tu valoración. ¡Gracias!' };
    tv.agregar({ 'Fecha': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Estrellas': estrellas, 'Comentario': s_(comentario, 1000), 'Publicable': 'No' });
    actualizarSol_(sol, { 'Estado': 'Valorada', 'Valoración (1-5)': estrellas });
    var p = profesional_(pro);
    if (estrellas >= 4 && p) encolarCorreo_('pro-buen-trabajo-' + oc, 'buen_trabajo_pro', 'Profesional', p['Email'], oc, pro, { estrellas: estrellas });
    if (estrellas <= 3) crearIncidencia_({ tipo: 'Incidencia', oc: oc, pro: pro, origen: 'Valoración', categoria: 'Valoración baja', grave: false, texto: estrellas + '/5 · ' + s_(comentario, 500) });
    registrar_('Sistema', 'Valoración recibida', oc, pro, estrellas + '/5');
    recalcularMetricas_();
    return { ok: true, msg: '¡Gracias por tu valoración! Nos ayuda a mejorar.' };
  });
}

/** Problema o sugerencia enviada por el cliente (independiente de la valoración). */
function procesarComentarioCliente_(oc, tipo, categoria, texto, grave) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    var previas = tabla_('Incidencias').todas().filter(function (i) { return i['Código OC'] === oc && /^Cliente/.test(i['Origen']); });
    if (previas.length >= 5) return { ok: false, msg: 'Ya hemos recibido varios mensajes sobre esta solicitud. Te escribiremos pronto.' };
    if (previas.some(function (i) { return String(i['Descripción']) === s_(texto, 1500) && i['Categoría'] === categoria; })) return { ok: true, ya: true, msg: 'Ya habíamos recibido este mensaje. ¡Gracias!' };
    var cat = CATEGORIAS_INCIDENCIA.indexOf(categoria) >= 0 ? categoria : 'Otro';
    var sug = tipo === 'sugerencia' || cat === 'Sugerencia para OficioCerca';
    crearIncidencia_({ tipo: sug ? 'Sugerencia' : 'Incidencia', oc: oc, pro: sug ? '' : sol['Profesional asignado (PRO)'], origen: tipo === 'ayuda' ? 'Cliente (pide ayuda)' : 'Cliente',
      categoria: cat, grave: !sug && !!grave, texto: texto });
    return { ok: true, msg: sug ? '¡Gracias por tu sugerencia!' : 'Hemos registrado tu mensaje. Una persona de OficioCerca lo revisará y te escribirá.' };
  });
}

function crearIncidencia_(o) {
  var id = siguienteCodigo_('SEQ_INC', 'INC-');
  var esSug = o.tipo === 'Sugerencia';
  tabla_('Incidencias').agregar({ 'ID': id, 'Fecha': new Date(), 'Tipo': o.tipo, 'Código OC': o.oc || '', 'Código PRO': o.pro || '', 'Origen': o.origen,
    'Categoría': o.categoria, 'Gravedad': o.grave ? 'Grave' : 'Normal', 'Descripción': s_(o.texto, 1500), 'Estado': esSug ? 'Cerrada' : 'Abierta',
    'Pausa preventiva': false, 'Notas': esSug ? 'Sugerencia: no cuenta como incidencia del profesional.' : '' });
  var fila = hoja_('Incidencias').getLastRow();
  hoja_('Incidencias').getRange(fila, tabla_('Incidencias').col('Pausa preventiva')).insertCheckboxes();
  registrar_('Sistema', esSug ? 'Sugerencia recibida' : 'Incidencia creada (' + (o.grave ? 'GRAVE' : 'normal') + ')', o.oc, o.pro, id + ' · ' + o.categoria);
  if (!esSug) alertaAdmin_('inc-' + id, 'Incidencia', (o.grave ? 'GRAVE · ' : '') + 'Incidencia ' + id + ' · ' + (o.oc || '') + ' ' + (o.pro || ''),
    'Origen: ' + o.origen + '\nCategoría: ' + o.categoria + '\nGravedad: ' + (o.grave ? 'Grave (puedes aplicar pausa preventiva marcando «Pausa preventiva» en Incidencias)' : 'Normal') +
    '\n\n' + s_(o.texto, 1500) + '\n\nRevísala en la pestaña Incidencias. Ninguna sanción es automática.');
  return id;
}

/** Métricas internas por profesional (derivadas: se recalculan desde los datos, sin desajustes). */
function recalcularMetricas_() {
  var tp = tabla_('Profesionales'), pros = tp.todas();
  if (!pros.length) return;
  var ofertas = tabla_('Ofertas').todas(), vals = tabla_('Valoraciones').todas(), incs = tabla_('Incidencias').todas();
  var sols = tabla_('Solicitudes').todas(), coms = tabla_('Comisiones').todas();
  var cols = ['Ofertas recibidas', 'Respuestas', 'Aceptadas', 'Asignaciones', 'Completados', 'Tiempo medio respuesta (h)', 'Valoración media',
    'Nº valoraciones', 'Incidencias verificadas', 'Comisiones pendientes', 'Última oferta'];
  var c0 = tp.col(cols[0]);
  var valores = pros.map(function (p) {
    var code = p['Código'];
    var of = ofertas.filter(function (o) { return o['Código PRO'] === code; });
    var resp = of.filter(function (o) { return o['Fecha respuesta'] && /Puede|No puede/.test(o['Respuesta']); });
    var tiempos = resp.map(function (o) { return (new Date(o['Fecha respuesta']) - new Date(o['Fecha envío'])) / 3600000; });
    var v = vals.filter(function (x) { return x['Código PRO'] === code; });
    var ultima = of.reduce(function (m, o) { return Math.max(m, new Date(o['Fecha envío']).getTime()); }, 0);
    return [of.length, resp.length, resp.filter(function (o) { return /^Puede/.test(o['Respuesta']); }).length,
      sols.filter(function (s) { return s['Profesional asignado (PRO)'] === code; }).length,
      sols.filter(function (s) { return s['Profesional asignado (PRO)'] === code && (s['Estado'] === 'Finalizado' || s['Estado'] === 'Valorada'); }).length,
      tiempos.length ? Math.round(tiempos.reduce(function (a, b) { return a + b; }, 0) / tiempos.length * 10) / 10 : '',
      v.length ? Math.round(v.reduce(function (a, x) { return a + Number(x['Estrellas']); }, 0) / v.length * 10) / 10 : '',
      v.length,
      incs.filter(function (i) { return i['Código PRO'] === code && i['Tipo'] === 'Incidencia' && i['Estado'] === 'Verificada'; }).length,
      coms.filter(function (c) { return c['Código PRO'] === code && c['Estado'] === 'Pendiente'; }).length,
      ultima ? new Date(ultima) : ''];
  });
  // Escritura por bloques contiguos (las filas pueden no ser consecutivas si hay huecos)
  pros.forEach(function (p, i) { tp.sh.getRange(p._fila, c0, 1, cols.length).setValues([valores[i]]); });
}
/* ============================================================ CORREO: cola, cuota, plantillas y enlaces seguros
 * - Remitente: la cuenta propietaria del script (oficiocerca@gmail.com) con nombre «OficioCerca».
 * - Sin copia oculta: la evidencia es la pestaña «Historial envíos».
 * - Cada correo tiene una CLAVE única → nunca se envía dos veces.
 * - Antes de enviar se consulta MailApp.getRemainingDailyQuota(); si no alcanza, queda
 *   «Pendiente por cuota» y el ciclo automático lo reintenta.
 * - Los enlaces llevan un token aleatorio (64 hex); en la hoja solo se guarda su SHA-256.
 */

var CORREO_NOMBRE = 'OficioCerca';
var MAX_INTENTOS = 3;

function encolarCorreo_(clave, tipo, rol, correo, oc, pro, datos) {
  var th = tabla_('Historial envíos');
  var ya = th.todas().filter(function (r) { return r['Clave'] === clave; })[0];
  if (ya) return ya['Estado'];
  if (!emailOk_(correo)) {
    th.agregar({ 'ID': 'M-' + Date.now(), 'Fecha': new Date(), 'Clave': clave, 'Tipo': tipo, 'Destinatario': rol, 'Correo': s_(correo, 160), 'Código OC': oc, 'Código PRO': pro,
      'Estado': 'Fallido', 'Intentos': 0, 'Último error': 'Correo no válido', 'Datos': JSON.stringify(datos || {}) });
    return 'Fallido';
  }
  var fila = th.agregar({ 'ID': 'M-' + Utilities.getUuid().slice(0, 8), 'Fecha': new Date(), 'Clave': clave, 'Tipo': tipo, 'Destinatario': rol, 'Correo': correo,
    'Código OC': oc, 'Código PRO': pro, 'Estado': 'Pendiente por cuota', 'Intentos': 0, 'Datos': JSON.stringify(datos || {}) });
  return enviarFila_(fila);
}

/** Intenta enviar una fila de la cola. */
function enviarFila_(fila) {
  var th = tabla_('Historial envíos');
  var r = th.todas().filter(function (x) { return x._fila === fila; })[0];
  if (!r || r['Estado'] === 'Enviado' || r['Estado'] === 'Fallido') return r ? r['Estado'] : '';
  var esAlerta = r['Destinatario'] === 'Administrador';
  var reserva = esAlerta ? 0 : cfgNum_('CUOTA_RESERVA', 3);
  var cuota = MailApp.getRemainingDailyQuota();
  if (cuota < 1 + reserva) { th.poner(fila, { 'Estado': 'Pendiente por cuota', 'Último error': 'Cuota insuficiente (' + cuota + ')' }); return 'Pendiente por cuota'; }
  var intentos = Number(r['Intentos'] || 0) + 1;
  try {
    var datos = JSON.parse(r['Datos'] || '{}');
    if (datos.token) datos.url = urlToken_(datos.token, r['Código OC'], r['Código PRO']);
    var m = componer_(r['Tipo'], r['Código OC'], r['Código PRO'], datos);
    if (!m) { th.poner(fila, { 'Estado': 'Omitido', 'Intentos': intentos, 'Último error': 'Ya no aplica' }); return 'Omitido'; }
    var opts = { to: r['Correo'], subject: m.asunto, htmlBody: m.html, body: m.texto, name: CORREO_NOMBRE };
    if (m.adjuntos && m.adjuntos.length) opts.attachments = m.adjuntos;
    MailApp.sendEmail(opts);
    th.poner(fila, { 'Estado': 'Enviado', 'Asunto': m.asunto, 'Intentos': intentos, 'Fecha envío': new Date(), 'Nº adjuntos': (m.adjuntos || []).length, 'Último error': '' });
    return 'Enviado';
  } catch (err) {
    var msg = String(err && err.message || err).slice(0, 200);
    var fin = intentos >= MAX_INTENTOS;
    th.poner(fila, { 'Estado': fin ? 'Fallido' : 'Pendiente por cuota', 'Intentos': intentos, 'Último error': msg });
    if (fin && !esAlerta) alertaAdmin_('fallo-' + r['Clave'], 'Sistema', 'Correo fallido ' + r['Tipo'] + ' ' + (r['Código OC'] || r['Código PRO']), msg);
    return fin ? 'Fallido' : 'Pendiente por cuota';
  }
}

function procesarCola_() {
  var th = tabla_('Historial envíos');
  th.todas().filter(function (r) { return r['Estado'] === 'Pendiente por cuota'; }).forEach(function (r) { enviarFila_(r._fila); });
}

function alertaAdmin_(clave, categoria, asunto, texto) {
  var admin = cfg_('ADMIN_EMAIL');
  if (!emailOk_(admin)) return;
  encolarCorreo_('admin-' + clave, 'alerta_admin', 'Administrador', admin, '', '', { categoria: categoria, asunto: asunto, texto: texto });
}

/* ---------- tokens ---------- */
function crearToken_(tipo, oc, pro, ref, expiraMs) {
  var t = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  tabla_('Tokens').agregar({ 'Hash': hash_(t), 'Tipo': tipo, 'Código OC': oc || '', 'Código PRO': pro || '', 'Referencia': ref || '', 'Creado': new Date(), 'Expira': new Date(expiraMs) });
  return t;
}
function urlToken_(spec, oc, pro) {
  var dias = spec.dias || cfgNum_('DIAS_VALIDEZ_ENLACES', 30);
  var exp = spec.expira || (Date.now() + dias * 86400000);
  var t = crearToken_(spec.tipo, oc, pro, spec.ref || '', exp);
  // Enlace a la web propia: el token va tras «#» (no se envía a ningún servidor ni queda en registros)
  return String(cfg_('URL_WEB') || 'https://oficiocerca.pages.dev/').replace(/\/?$/, '/') + 'gestion/#' + t;
}
/** Devuelve el registro del token si es válido (no caducado). */
function leerToken_(t) {
  if (!/^[a-f0-9]{64}$/.test(String(t || ''))) return null;
  var r = tabla_('Tokens').buscar('Hash', hash_(t));
  if (!r) return null;
  r.caducado = r['Expira'] && new Date(r['Expira']).getTime() < Date.now();
  return r;
}
function marcarToken_(tok, resultado) {
  tabla_('Tokens').poner(tok._fila, { 'Usado': new Date(), 'Resultado': s_(resultado, 200) });
}

/* ---------- plantillas ---------- */
function boton_(url, texto, color) {
  return '<a href="' + esc_(url) + '" style="display:inline-block;background:' + (color || '#13253D') + ';color:#ffffff;text-decoration:none;font-weight:bold;' +
    'font-size:17px;padding:14px 22px;border-radius:10px;margin:6px 0">' + esc_(texto) + '</a>';
}
function tabla_html_(filas) {
  return '<table role="presentation" style="border-collapse:collapse;width:100%;margin:14px 0;font-size:16px">' + filas.map(function (f) {
    return '<tr><td style="padding:9px;border:1px solid #DED6C8;background:#F6F2EB;width:38%;vertical-align:top"><b>' + esc_(f[0]) + '</b></td>' +
      '<td style="padding:9px;border:1px solid #DED6C8">' + esc_(f[1]).replace(/\n/g, '<br>') + '</td></tr>';
  }).join('') + '</table>';
}
function plantilla_(titulo, saludo, bloques, pie) {
  var html = '<div style="background:#F6F2EB;padding:18px 10px"><div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#0E1A2B;font-size:16px;line-height:1.5">' +
    '<div style="background:#13253D;color:#ffffff;padding:18px 22px;font-size:20px;font-weight:bold;letter-spacing:.5px">OFICIO<span style="color:#F2A65A">CERCA</span></div>' +
    '<div style="padding:22px">' + '<h1 style="font-size:21px;margin:0 0 12px">' + esc_(titulo) + '</h1>' + (saludo ? '<p>' + esc_(saludo) + '</p>' : '') + bloques.join('') +
    '<p style="color:#586374;font-size:13px;margin-top:24px;border-top:1px solid #eee;padding-top:12px">' + esc_(pie || 'OficioCerca · Piloto en Córdoba capital') +
    '<br>Contacto: <a href="mailto:oficiocerca@gmail.com" style="color:#13253D">oficiocerca@gmail.com</a></p></div></div></div>';
  return html;
}
function p_(t) { return '<p>' + esc_(t) + '</p>'; }
function destacado_(t) { return '<p style="background:#FFF4E5;border-left:4px solid #F2A65A;padding:12px 14px;border-radius:6px"><b>' + esc_(t) + '</b></p>'; }
function texto_(m) { return m.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|tr|h1|div)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim(); }

function servicioTxt_(sol) { return (SERVICIOS[sol['Servicio (código)']] || sol['Servicio']) + (sol['Servicio (otro)'] ? ' — ' + sol['Servicio (otro)'] : ''); }
function plazoTxt_(sol) { return sol['Plazo'] + (sol['Plazo (código)'] === 'OTRA_FECHA' && sol['Fecha deseada'] ? ' (' + fechaIso_(sol['Fecha deseada']).split('-').reverse().join('/') + ')' : ''); }

/** Compone un correo a partir de los datos ACTUALES de la hoja. Devuelve null si ya no aplica. */
function componer_(tipo, oc, pro, d) {
  var sol = oc ? solicitud_(oc) : null, p = pro ? profesional_(pro) : null;
  var A = '[OficioCerca] ', AP = '[OficioCerca Profesionales] ', asunto, titulo, saludo, b = [], adj = [];
  switch (tipo) {
    case 'confirmacion_cliente':
      asunto = A + 'Hemos recibido tu solicitud ' + oc;
      titulo = 'Hemos recibido tu solicitud ' + oc; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(p_('Gracias por confiar en OficioCerca. Estos son los datos de tu solicitud:'));
      b.push(tabla_html_([['Código', oc], ['Servicio', servicioTxt_(sol)], ['Zona', sol['Zona']], ['Plazo solicitado', plazoTxt_(sol)],
        ['Resumen', String(sol['Descripción']).slice(0, 400) + (String(sol['Descripción']).length > 400 ? '…' : '')]]));
      b.push('<p><b>Cómo seguimos:</b></p><ol style="padding-left:20px"><li>' + (sol['Servicio (código)'] === 'otro' ? 'Revisamos si hay profesionales disponibles para este servicio.' : 'Buscamos un profesional compatible con tu trabajo, zona y plazo.') +
        '</li><li>Le enviamos la información del trabajo <b>sin tus datos de contacto</b>.</li><li>Cuando uno confirme que puede atenderlo, te avisamos y te contactará.</li></ol>');
      b.push(destacado_('Mantente pendiente de este correo. Por aquí te informaremos de los avances de tu solicitud.'));
      b.push(p_('Si no lo encuentras, revisa también Spam o Promociones. No podemos garantizar disponibilidad ni plazos: no ofrecemos servicio de urgencias 24 horas.'));
      if (d.url) b.push(p_('¿Necesitas ayuda o quieres cancelar la solicitud?') + boton_(d.url, 'Gestionar mi solicitud', '#586374'));
      break;
    case 'oferta_profesional':
      if (!p) return null;
      asunto = AP + 'Nueva oportunidad ' + oc + ' · ' + servicioTxt_(sol) + ' · ' + sol['Zona'];
      titulo = 'Nueva oportunidad de trabajo · ' + oc; saludo = 'Hola ' + p['Nombre'] + ',';
      adj = fotos_(sol['Carpeta fotos (ID)']);
      b.push(p_('Tenemos un trabajo compatible con tu oficio y zona. Revisa la ficha (no incluye datos del cliente) y dinos si puedes atenderlo.'));
      b.push(tabla_html_([['Solicitud', oc], ['Servicio', servicioTxt_(sol)], ['Zona / barrio', sol['Zona'] + ' (Córdoba)'], ['Tipo de trabajo', sol['Tipo de trabajo'] || 'Sin especificar'],
        ['Plazo que pide el cliente', plazoTxt_(sol)], ['Cliente', /empresa/i.test(sol['Tipo solicitante']) ? 'Empresa / contratista' : 'Particular'],
        ['Fotos', adj.length ? adj.length + ' adjunta(s) a este correo' : 'Sin fotos'], ['Descripción', sol['Descripción']]]));
      b.push('<div style="text-align:center;margin:18px 0">' + boton_(d.url, 'RESPONDER A ESTA OPORTUNIDAD') + '</div>');
      b.push(p_('Podrás indicar: «Puedo atenderlo» (y cuándo), «Puedo, pero más adelante» o «No puedo». Responde antes del ' + fecha_(d.expira) + '; después la ofreceremos a otro profesional.'));
      b.push(p_('Aceptar significa que estás interesado y tienes disponibilidad para contactar al cliente y valorar/presupuestar el trabajo. Esta ficha es confidencial: no la reenvíes ni publiques las fotos.'));
      break;
    case 'contacto_profesional':
      if (!p) return null;
      asunto = AP + 'Asignada: contacto del cliente · ' + oc;
      titulo = 'Te hemos asignado la solicitud ' + oc; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(p_('Gracias por confirmar tu disponibilidad. Estos son los datos de contacto del cliente. Contacta con él para acordar la visita y el presupuesto.'));
      b.push(tabla_html_([['Solicitud', oc], ['Servicio', servicioTxt_(sol)], ['Cliente', sol['Nombre']], ['Empresa', sol['Empresa'] || '—'], ['WhatsApp', limpio_(sol['WhatsApp'])],
        ['Teléfono alternativo', limpio_(sol['Teléfono alt.']) || '—'], ['Correo', sol['Email']], ['Prefiere que le contactes por', sol['Contacto preferido (para el profesional)']],
        ['Zona', sol['Zona']], ['Código postal', limpio_(sol['Código postal']) || '—'], ['Tu disponibilidad indicada', sol['Disponibilidad profesional']]]));
      b.push(destacado_('Cuando tengas el presupuesto, regístralo aquí: el cliente lo recibirá para aceptarlo o no.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'REGISTRAR PRESUPUESTO / GESTIONAR TRABAJO') + '</div>');
      b.push(p_('Indica la mano de obra y, aparte, los materiales. Tú fijas tu precio y acuerdas el pago directamente con el cliente. Datos personales: úsalos solo para esta solicitud.'));
      break;
    case 'asignado_cliente':
      if (!p) return null;
      asunto = A + 'Hemos encontrado un profesional · ' + oc;
      titulo = 'Hemos encontrado un profesional que puede atender tu solicitud'; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(tabla_html_([['Solicitud', oc], ['Profesional', p['Nombre'] + (p['Empresa / autónomo'] ? ' · ' + p['Empresa / autónomo'] : '')], ['Disponibilidad indicada', d.disp || sol['Disponibilidad profesional']]]));
      b.push(p_('Siguiente paso: el profesional te contactará (' + sol['Contacto preferido (para el profesional)'] + ', como preferiste) para valorar el trabajo y prepararte un presupuesto. El presupuesto te llegará también por este correo para que lo aceptes o no. Tú decides.'));
      b.push(p_('El pago del trabajo se acuerda directamente con el profesional.'));
      if (d.url) b.push(boton_(d.url, 'Necesito ayuda / cancelar', '#586374'));
      break;
    case 'respaldo_cliente':
      var of = tabla_('Ofertas').buscar('ID', d.token.ref);
      if (!of || sol['Estado'] !== 'Esperando decisión cliente') return null;
      asunto = A + 'Disponibilidad para tu solicitud ' + oc;
      titulo = 'No hemos encontrado disponibilidad para el plazo que pediste'; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(p_('Pediste: ' + plazoTxt_(sol) + '. La opción más próxima que encontramos puede atenderte aproximadamente: ' + of['Disponibilidad'] + '.'));
      b.push(p_('¿Qué prefieres? Hasta que respondas no compartimos tus datos de contacto con nadie.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'ELEGIR UNA OPCIÓN') + '</div>');
      b.push(p_('Opciones: continuar con este profesional · seguir buscando · cancelar la solicitud.'));
      break;
    case 'solicitud_cubierta':
      if (!p) return null;
      asunto = AP + oc + ' ya está cubierta';
      titulo = 'Gracias por tu disponibilidad'; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(p_('La solicitud ' + oc + ' ya ha sido asignada a un profesional que podía atenderla antes. Seguiremos enviándote oportunidades compatibles.'));
      break;
    case 'presupuesto_cliente':
      var pr = tabla_('Presupuestos').buscar('ID', d.presupuesto);
      if (!pr || pr['Estado'] !== 'Enviado al cliente') return null;
      asunto = A + 'Has recibido un presupuesto · ' + oc;
      titulo = 'Has recibido un presupuesto para tu solicitud ' + oc; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(tabla_html_([['Profesional', p ? p['Nombre'] + (p['Empresa / autónomo'] ? ' · ' + p['Empresa / autónomo'] : '') : pro], ['Mano de obra', euros_(pr['Mano de obra (€)'])],
        ['Materiales', euros_(pr['Materiales (€)'])], ['Total', euros_(pr['Total (€)'])], ['Observaciones', pr['Observaciones'] || '—'], ['Versión', pr['Versión']]]));
      b.push('<div style="text-align:center">' + boton_(d.url, 'VER Y RESPONDER AL PRESUPUESTO') + '</div>');
      b.push(p_('Podrás elegir: aceptar el presupuesto, no aceptarlo o pedir hablar con el profesional. Aceptar o no es libre y gratuito. El pago se hace directamente al profesional, que es responsable de emitir el presupuesto o factura formal que corresponda.'));
      break;
    case 'presupuesto_aceptado_pro':
      asunto = AP + 'El cliente aceptó tu presupuesto · ' + oc;
      titulo = 'El cliente ha aceptado tu presupuesto'; saludo = 'Hola ' + (p ? p['Nombre'] : '') + ',';
      b.push(p_('Presupuesto ' + d.presupuesto + ' aceptado por el cliente. Acordad directamente la ejecución y el pago.'));
      b.push(p_('Cuando termines el trabajo, indícalo aquí. Después pediremos al cliente que lo confirme.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'GESTIONAR TRABAJO / MARCAR FINALIZADO') + '</div>');
      break;
    case 'presupuesto_rechazado_pro':
      asunto = AP + 'El cliente no aceptó el presupuesto · ' + oc;
      titulo = 'El cliente no ha aceptado el presupuesto'; saludo = 'Hola ' + (p ? p['Nombre'] : '') + ',';
      b.push(p_('Si lo ves oportuno, puedes hablar con el cliente y registrar una nueva versión del presupuesto.'));
      b.push(boton_(d.url, 'Registrar otra versión'));
      break;
    case 'presupuesto_hablar_pro':
      asunto = AP + 'El cliente quiere hablar contigo · ' + oc;
      titulo = 'El cliente quiere hablar sobre el presupuesto'; saludo = 'Hola ' + (p ? p['Nombre'] : '') + ',';
      b.push(p_('Ponte en contacto con el cliente de la solicitud ' + oc + ' (tienes sus datos en el correo de asignación) para aclarar el presupuesto ' + d.presupuesto + '.'));
      break;
    case 'aun_no_pro':
      asunto = AP + 'El cliente indica que el trabajo aún no ha terminado · ' + oc;
      titulo = 'El cliente indica que aún no ha terminado'; saludo = 'Hola ' + (p ? p['Nombre'] : '') + ',';
      b.push(p_('Cuando el trabajo esté terminado, vuelve a indicarlo:'));
      b.push(boton_(d.url, 'Marcar trabajo finalizado'));
      break;
    case 'fin_cliente':
      if (sol['Estado'] !== 'Finalización por confirmar') return null;
      asunto = A + '¿Ha terminado el trabajo? · ' + oc;
      titulo = 'El profesional ha indicado que el trabajo finalizó'; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(p_('¿Puedes confirmarlo? Solo cerramos la solicitud cuando tú lo confirmas.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'RESPONDER') + '</div>');
      b.push(p_('Opciones: «Sí, el trabajo terminó» · «Aún no ha terminado» · «Tengo un problema».'));
      break;
    case 'valorar_cliente':
      asunto = A + 'Valora el servicio · ' + oc;
      titulo = '¿Qué tal ha ido?'; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(p_('Tu opinión nos ayuda a mejorar y a recomendar a los mejores profesionales. Solo te llevará un minuto (de 1 a 5 estrellas y un comentario opcional). También puedes contarnos un problema o una sugerencia.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'VALORAR EL SERVICIO') + '</div>');
      break;
    case 'buen_trabajo_pro':
      asunto = AP + 'Buen trabajo · ' + oc;
      titulo = 'Buen trabajo'; saludo = 'Hola ' + (p ? p['Nombre'] : '') + ',';
      b.push(p_('Buen trabajo. El cliente ha valorado positivamente el servicio (' + d.estrellas + '/5). Lo tendremos en cuenta en tu historial.'));
      break;
    case 'registro_profesional':
      if (!p) return null;
      asunto = AP + 'Hemos recibido tu registro ' + pro;
      titulo = 'Registro recibido · ' + pro; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(tabla_html_([['Código', pro], ['Servicios', p['Servicios'] + (p['Servicio otro'] ? ' (' + p['Servicio otro'] + ')' : '')], ['Condiciones aceptadas', p['Condiciones (versión)']]]));
      b.push(p_('Revisaremos tus datos. Cuando tu alta quede activa te avisaremos y empezarás a recibir en este correo oportunidades compatibles con tus servicios y tu zona.'));
      break;
    case 'alta_activada':
      if (!p) return null;
      asunto = AP + 'Tu alta está activa · ' + pro;
      titulo = 'Ya puedes recibir oportunidades'; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(p_('Tu alta en OficioCerca está activa. Te enviaremos a este correo las oportunidades compatibles con tus servicios (' + p['Servicios'] + ') y tu zona. Cada una trae un botón para responder.'));
      break;
    case 'alerta_admin':
      return { asunto: '[OficioCerca · ' + d.categoria + '] ' + d.asunto, html: plantilla_(d.asunto, '', ['<pre style="white-space:pre-wrap;font-family:inherit">' + esc_(d.texto) + '</pre>'], 'Alerta automática de OficioCerca'), texto: d.asunto + '\n\n' + d.texto };
    case 'resumen_diario':
      return { asunto: '[OficioCerca · Resumen diario] ' + d.fecha, html: plantilla_('Resumen diario · ' + d.fecha, '', [d.html], 'Un único resumen al día'), texto: texto_(d.html) };
    default:
      throw new Error('Plantilla desconocida: ' + tipo);
  }
  var html = plantilla_(titulo, saludo, b);
  return { asunto: asunto, html: html, texto: texto_(html), adjuntos: adj };
}

/** Fotos de ESA solicitud (carpeta privada) como adjuntos. No cambia permisos. */
function fotos_(carpetaId) {
  if (!carpetaId) return [];
  var out = [], it = DriveApp.getFolderById(carpetaId).getFiles();
  while (it.hasNext() && out.length < 5) {
    var f = it.next();
    if (/^image\//.test(f.getMimeType())) out.push(f.getBlob().setName(f.getName()));
  }
  out.sort(function (a, b) { return a.getName() < b.getName() ? -1 : 1; });
  return out;
}
/* ============================================================ PÁGINAS DE LOS ENLACES (doGet ?t=TOKEN) */

function doGet(e) {
  var t = e && e.parameter && e.parameter.t;
  if (!t) return json_({ ok: true, service: 'OficioCerca', status: 'online' });
  try { return pagina_(String(t)); }
  catch (err) { errorSistema_('doGet', err); return html_('Algo ha fallado', '<p>No hemos podido abrir esta página. Inténtalo de nuevo en unos minutos o escríbenos a <a href="mailto:oficiocerca@gmail.com">oficiocerca@gmail.com</a>.</p>'); }
}

var _modoJson = false;

/** Versión JSON de una página (la usa la página estática /gestion/ de la web). */
function paginaJson_(t) {
  _modoJson = true;
  try { var r = pagina_(String(t || '')); return { ok: true, titulo: r.titulo, cuerpo: r.cuerpo, script: r.script || '' }; }
  catch (err) { errorSistema_('paginaJson', err); return { ok: false, titulo: 'Algo ha fallado', cuerpo: '<p>No hemos podido abrir esta página. Inténtalo de nuevo en unos minutos.</p>' }; }
  finally { _modoJson = false; }
}

function html_(titulo, cuerpo, token, script) {
  if (_modoJson) return { titulo: titulo, cuerpo: cuerpo, script: script || '' };
  var css = 'body{margin:0;background:#F6F2EB;font-family:Arial,Helvetica,sans-serif;color:#0E1A2B;font-size:18px;line-height:1.5}' +
    '.top{background:#13253D;color:#fff;padding:16px 20px;font-weight:bold;font-size:21px;letter-spacing:.5px}.top b{color:#F2A65A}' +
    '.box{max-width:640px;margin:18px auto;background:#fff;border-radius:14px;padding:22px 20px;box-shadow:0 2px 10px rgba(0,0,0,.06)}' +
    'h1{font-size:24px;margin:0 0 14px;line-height:1.25}h2{font-size:20px;margin:22px 0 10px}' +
    'table{border-collapse:collapse;width:100%;margin:10px 0}td{border:1px solid #DED6C8;padding:9px;vertical-align:top}td:first-child{background:#F6F2EB;font-weight:bold;width:40%}' +
    '.btn{display:block;width:100%;box-sizing:border-box;border:0;border-radius:12px;padding:17px 16px;margin:12px 0;font-size:19px;font-weight:bold;cursor:pointer;background:#13253D;color:#fff;text-align:center}' +
    '.btn.sec{background:#fff;color:#13253D;border:2px solid #13253D}.btn.rojo{background:#fff;color:#A3262A;border:2px solid #A3262A}.btn:disabled{opacity:.55;cursor:wait}' +
    'label{display:block;font-weight:bold;margin:14px 0 6px}select,input,textarea{width:100%;box-sizing:border-box;font-size:18px;padding:13px;border:2px solid #8B95A3;border-radius:10px;background:#fff;color:#0E1A2B}' +
    'textarea{min-height:110px}.opc{border:2px solid #DED6C8;border-radius:12px;padding:6px 16px 10px;margin:14px 0}.nota{color:#586374;font-size:15px}' +
    '.ok{background:#E8F5EC;border-left:5px solid #2E7D4F;padding:14px;border-radius:8px}.err{background:#FDECEC;border-left:5px solid #A3262A;padding:14px;border-radius:8px}' +
    '.stars{display:flex;gap:6px;flex-wrap:wrap}.stars label{margin:0;flex:1;min-width:52px}.stars input{display:none}.stars span{display:block;text-align:center;border:2px solid #8B95A3;border-radius:10px;padding:12px 0;font-size:22px;cursor:pointer}' +
    '.stars input:checked+span{background:#13253D;color:#F2A65A;border-color:#13253D}.hide{display:none}';
  var js = '<script>var T=' + JSON.stringify(token || '') + ';' +
    'function enviar(p,btn){var bs=document.querySelectorAll("button");bs.forEach(function(b){b.disabled=true});' +
    'var m=document.getElementById("msg");m.className="";m.textContent="Enviando…";' +
    'google.script.run.withSuccessHandler(function(r){if(r&&r.ok){document.getElementById("zona").innerHTML="";m.className="ok";m.textContent=r.msg;' +
    'if(r.html){document.getElementById("zona").innerHTML=r.html}}else{m.className="err";m.textContent=(r&&r.msg)||"No se pudo guardar.";bs.forEach(function(b){b.disabled=false})}})' +
    '.withFailureHandler(function(){m.className="err";m.textContent="No hemos podido guardar tu respuesta. Revisa tu conexión e inténtalo de nuevo.";bs.forEach(function(b){b.disabled=false})})' +
    '.accion(T,p)}' +
    'function ver(id){document.querySelectorAll(".panel").forEach(function(x){x.classList.add("hide")});var e=document.getElementById(id);if(e){e.classList.remove("hide");e.scrollIntoView({behavior:"smooth"})}}' +
    'function val(id){var e=document.getElementById(id);return e?e.value:""}' + (script || '') + '</script>';
  var out = HtmlService.createHtmlOutput('<!doctype html><html lang="es"><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    '<div class="top">OFICIO<b>CERCA</b></div><div class="box"><h1>' + esc_(titulo) + '</h1><div id="zona">' + cuerpo + '</div><p id="msg" role="status" aria-live="polite"></p>' +
    '<p class="nota">¿Dudas? Escríbenos a <a href="mailto:oficiocerca@gmail.com">oficiocerca@gmail.com</a></p></div>' + js + '</body></html>');
  out.setTitle('OficioCerca').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return out;
}

function filas_(f) { return '<table>' + f.map(function (x) { return '<tr><td>' + esc_(x[0]) + '</td><td>' + esc_(x[1]).replace(/\n/g, '<br>') + '</td></tr>'; }).join('') + '</table>'; }

function pagina_(t) {
  var tok = leerToken_(t);
  if (!tok) return html_('Enlace no válido', '<p>Este enlace no es válido o está incompleto. Abre el botón directamente desde el correo que te enviamos.</p>');
  var tipo = tok['Tipo'], oc = tok['Código OC'], pro = tok['Código PRO'];
  var sol = oc ? solicitud_(oc) : null;
  var unUso = ['oferta', 'respaldo', 'presupuesto', 'fin'].indexOf(tipo) >= 0;
  if (unUso && tok['Usado']) return html_('Respuesta ya registrada', '<div class="ok">Ya habíamos registrado tu respuesta: ' + esc_(tok['Resultado'] || '') + '</div>');
  if (tok.caducado) return html_('Enlace caducado', '<p>Este enlace ya no está vigente' + (tipo === 'oferta' ? ': el plazo para responder a esta oportunidad terminó y la ofrecimos a otro profesional.' : '.') + '</p><p>Si necesitas algo, escríbenos.</p>');

  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  if (tipo === 'oferta') {
    var of = tabla_('Ofertas').buscar('ID', tok['Referencia']);
    if (!of || of['Estado'] !== 'Enviada') return html_('Oportunidad cerrada', '<p>Esta oportunidad ya no está abierta. ¡Gracias!</p>');
    var opts = Object.keys(DISP_PRO).filter(function (k) { return k !== 'OTRA_FECHA'; }).map(function (k) { return '<option value="' + k + '">' + esc_(DISP_PRO[k].t) + '</option>'; }).join('');
    return html_('Oportunidad ' + oc, filas_([['Servicio', servicioTxt_(sol)], ['Zona / barrio', sol['Zona'] + ' (Córdoba)'], ['Tipo de trabajo', sol['Tipo de trabajo'] || 'Sin especificar'],
      ['Plazo que pide el cliente', plazoTxt_(sol)], ['Descripción', sol['Descripción']], ['Responde antes de', fecha_(of['Expira'])]]) +
      '<p class="nota">Aceptar significa: «Estoy interesado y tengo disponibilidad para contactar al cliente y valorar/presupuestar el trabajo». No te compromete todavía a ejecutar la obra.</p>' +
      '<button class="btn" onclick="ver(\'pa\')">✔ PUEDO ATENDERLO</button>' +
      '<div id="pa" class="panel opc hide"><label for="disp">¿Cuándo podrías empezar?</label><select id="disp">' + opts + '</select>' +
      '<button class="btn" onclick="enviar({a:\'si\',disp:val(\'disp\')})">Confirmar: puedo atenderlo</button></div>' +
      '<button class="btn sec" onclick="ver(\'pb\')">🕒 PUEDO HACERLO, PERO MÁS ADELANTE</button>' +
      '<div id="pb" class="panel opc hide"><label for="fecha">¿A partir de qué fecha aproximada?</label><input type="date" id="fecha" min="' + hoy + '">' +
      '<button class="btn sec" onclick="if(!val(\'fecha\')){alert(\'Elige una fecha\');return}enviar({a:\'mas_adelante\',fecha:val(\'fecha\')})">Confirmar fecha</button></div>' +
      '<button class="btn rojo" onclick="ver(\'pc\')">✖ NO PUEDO / NO ME INTERESA</button>' +
      '<div id="pc" class="panel opc hide"><label for="nota">Motivo (opcional)</label><input id="nota" maxlength="200">' +
      '<button class="btn rojo" onclick="enviar({a:\'no\',nota:val(\'nota\')})">Confirmar: no puedo</button></div>', t);
  }
  if (tipo === 'respaldo') {
    var ofr = tabla_('Ofertas').buscar('ID', tok['Referencia']);
    if (sol['Estado'] !== 'Esperando decisión cliente') return html_('Solicitud ' + oc, '<p>Estado actual de tu solicitud: <b>' + esc_(sol['Estado']) + '</b>.</p>');
    return html_('Disponibilidad para tu solicitud ' + oc, '<p>Pediste: <b>' + esc_(plazoTxt_(sol)) + '</b>. La opción más próxima que encontramos puede atenderte aproximadamente: <b>' + esc_(ofr ? ofr['Disponibilidad'] : '') + '</b>.</p>' +
      '<button class="btn" onclick="enviar({a:\'continuar\'})">Sí, continuar con este profesional</button>' +
      '<button class="btn sec" onclick="enviar({a:\'seguir\'})">Seguir buscando</button>' +
      '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar la solicitud?\'))enviar({a:\'cancelar\'})">Cancelar solicitud</button>' +
      '<p class="nota">Hasta que elijas, no compartimos tus datos de contacto con ningún profesional.</p>', t);
  }
  if (tipo === 'presupuesto') {
    var pr = tabla_('Presupuestos').buscar('ID', tok['Referencia']), pp = profesional_(pro);
    if (!pr) return html_('Presupuesto', '<p>Presupuesto no encontrado.</p>');
    if (pr['Estado'] !== 'Enviado al cliente' || sol['Presupuesto vigente'] !== pr['ID']) return html_('Presupuesto ' + pr['ID'], '<p>Este presupuesto está: <b>' + esc_(pr['Estado']) + '</b>.' + (pr['Estado'] === 'Sustituido' ? ' Revisa el correo con la versión más reciente.' : '') + '</p>');
    return html_('Presupuesto para tu solicitud ' + oc, filas_([['Profesional', pp ? pp['Nombre'] + (pp['Empresa / autónomo'] ? ' · ' + pp['Empresa / autónomo'] : '') : pro],
      ['Mano de obra', euros_(pr['Mano de obra (€)'])], ['Materiales', euros_(pr['Materiales (€)'])], ['Total', euros_(pr['Total (€)'])], ['Observaciones', pr['Observaciones'] || '—'], ['Versión', pr['Versión']]]) +
      '<button class="btn" onclick="if(confirm(\'¿Aceptas este presupuesto?\'))enviar({a:\'aceptar\'})">✔ Aceptar presupuesto</button>' +
      '<button class="btn sec" onclick="enviar({a:\'hablar\'})">Necesito hablar con el profesional</button>' +
      '<button class="btn rojo" onclick="if(confirm(\'¿No aceptas este presupuesto?\'))enviar({a:\'rechazar\'})">No aceptar</button>' +
      '<p class="nota">Aceptar es libre y gratuito para ti. El pago del trabajo se hace directamente al profesional.</p>', t);
  }
  if (tipo === 'fin') {
    if (sol['Estado'] !== 'Finalización por confirmar') return html_('Solicitud ' + oc, '<p>Estado actual: <b>' + esc_(sol['Estado']) + '</b>.</p>');
    return html_('¿Ha terminado el trabajo? · ' + oc, '<p>El profesional ha indicado que el trabajo finalizó.</p>' +
      '<button class="btn" onclick="enviar({a:\'si\'})">✔ Sí, el trabajo terminó</button>' +
      '<button class="btn sec" onclick="enviar({a:\'aun_no\'})">Aún no ha terminado</button>' +
      '<button class="btn rojo" onclick="ver(\'pp\')">Tengo un problema</button>' +
      '<div id="pp" class="panel opc hide"><label for="txt">Cuéntanos qué ha pasado</label><textarea id="txt" maxlength="1500"></textarea>' +
      '<label><input type="checkbox" id="grave" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de mis datos)</label>' +
      '<button class="btn rojo" onclick="if(!val(\'txt\').trim()){alert(\'Describe el problema\');return}enviar({a:\'problema\',texto:val(\'txt\'),grave:document.getElementById(\'grave\').checked})">Enviar problema</button></div>', t);
  }
  if (tipo === 'valorar') {
    var ya = tabla_('Valoraciones').todas().some(function (v) { return v['Código OC'] === oc; });
    var estrellas = [1, 2, 3, 4, 5].map(function (n) { return '<label><input type="radio" name="st" value="' + n + '"><span>' + n + '★</span></label>'; }).join('');
    var cats = CATEGORIAS_INCIDENCIA.filter(function (c) { return c !== 'Valoración baja'; }).map(function (c) { return '<option>' + esc_(c) + '</option>'; }).join('');
    return html_('Valora el servicio · ' + oc, (ya ? '<div class="ok">Ya recibimos tu valoración. ¡Gracias!</div>' :
      '<label>¿Cómo valoras el servicio? (1 = muy mal · 5 = excelente)</label><div class="stars">' + estrellas + '</div>' +
      '<label for="com">Comentario (opcional)</label><textarea id="com" maxlength="1000"></textarea>' +
      '<button class="btn" onclick="var s=document.querySelector(\'input[name=st]:checked\');if(!s){alert(\'Elige de 1 a 5 estrellas\');return}enviar({a:\'valorar\',estrellas:s.value,comentario:val(\'com\')})">Enviar valoración</button>') +
      '<h2>¿Algo más?</h2>' +
      '<button class="btn rojo" onclick="ver(\'pq\')">Tuve un problema</button>' +
      '<button class="btn sec" onclick="ver(\'ps\')">Quiero ayudaros a mejorar</button>' +
      '<div id="pq" class="panel opc hide"><label for="cat">Tipo de problema</label><select id="cat">' + cats + '</select><label for="tq">Cuéntanos</label><textarea id="tq" maxlength="1500"></textarea>' +
      '<label><input type="checkbox" id="gq" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de datos)</label>' +
      '<button class="btn rojo" onclick="if(!val(\'tq\').trim()){alert(\'Escribe qué ha pasado\');return}enviar({a:\'problema\',categoria:val(\'cat\'),texto:val(\'tq\'),grave:document.getElementById(\'gq\').checked})">Enviar</button></div>' +
      '<div id="ps" class="panel opc hide"><label for="ts">Tu sugerencia</label><textarea id="ts" maxlength="1500"></textarea>' +
      '<button class="btn sec" onclick="if(!val(\'ts\').trim()){alert(\'Escribe tu sugerencia\');return}enviar({a:\'sugerencia\',texto:val(\'ts\')})">Enviar sugerencia</button></div>', t);
  }
  if (tipo === 'gestion') {
    var p = profesional_(pro);
    if (sol['Profesional asignado (PRO)'] !== pro) return html_('Solicitud ' + oc, '<p>Esta solicitud ya no está asignada a ti.</p>');
    var pres = tabla_('Presupuestos').todas().filter(function (r) { return r['Código OC'] === oc; });
    var lista = pres.length ? '<h2>Tus presupuestos</h2>' + filas_(pres.map(function (r) { return ['Versión ' + r['Versión'] + ' · ' + dia_(r['Fecha']), euros_(r['Total (€)']) + ' (MO ' + euros_(r['Mano de obra (€)']) + ' + materiales ' + euros_(r['Materiales (€)']) + ') · ' + r['Estado']]; })) : '';
    var cuerpo = filas_([['Solicitud', oc], ['Servicio', servicioTxt_(sol)], ['Cliente', sol['Nombre']], ['Estado', sol['Estado']]]) + lista;
    if (ESTADOS_PERMITEN_PRESUPUESTO.indexOf(sol['Estado']) >= 0) {
      cuerpo += '<h2>' + (pres.length ? 'Registrar nueva versión del presupuesto' : 'Registrar presupuesto') + '</h2>' +
        '<label for="mo">Mano de obra (€) *</label><input id="mo" inputmode="decimal" placeholder="Ej.: 350" oninput="tot()">' +
        '<label for="mat">Materiales (€) <span class="nota">(si los hay)</span></label><input id="mat" inputmode="decimal" placeholder="0" oninput="tot()">' +
        '<p>Total: <b id="tt">0,00 €</b> <span class="nota">(mano de obra + materiales)</span></p>' +
        '<label for="obs">Observaciones (opcional)</label><textarea id="obs" maxlength="1000" placeholder="Qué incluye, plazo de ejecución…"></textarea>' +
        '<button class="btn" onclick="if(!val(\'mo\').trim()){alert(\'Indica la mano de obra\');return}if(confirm(\'¿Enviar este presupuesto al cliente?\'))enviar({a:\'presupuesto\',mo:val(\'mo\'),mat:val(\'mat\'),obs:val(\'obs\')})">Enviar presupuesto al cliente</button>' +
        '<p class="nota">Declara importes reales. La tarifa de OficioCerca (10 % de la mano de obra aceptada, máx. 200 €) solo se calcula si el cliente acepta; en el piloto no se cobra todavía. Falsear importes puede conllevar revisión o suspensión.</p>';
    }
    if (sol['Estado'] === 'Cliente aceptó') cuerpo += '<h2>¿Has terminado el trabajo?</h2><button class="btn" onclick="if(confirm(\'¿Confirmas que el trabajo está terminado?\'))enviar({a:\'finalizado\'})">✔ TRABAJO FINALIZADO</button><p class="nota">El cliente deberá confirmarlo.</p>';
    if (sol['Estado'] === 'Finalización por confirmar') cuerpo += '<div class="ok">Esperando que el cliente confirme la finalización.</div>';
    return html_('Gestionar trabajo · ' + oc, cuerpo, t, 'function n(v){v=(v||"").replace(/\\s|€/g,"");if(/,\\d{1,2}$/.test(v))v=v.replace(/\\./g,"").replace(",",".");else v=v.replace(/,/g,"");var x=parseFloat(v);return isNaN(x)?0:x}' +
      'function tot(){var t=n(val("mo"))+n(val("mat"));document.getElementById("tt").textContent=t.toFixed(2).replace(".",",")+" €"}');
  }
  if (tipo === 'cliente') {
    var cancelable = ['Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional', 'Esperando decisión cliente', 'Sin profesional compatible'].indexOf(sol['Estado']) >= 0;
    return html_('Tu solicitud ' + oc, filas_([['Servicio', servicioTxt_(sol)], ['Zona', sol['Zona']], ['Estado', sol['Estado']]]) +
      '<button class="btn sec" onclick="ver(\'ph\')">Necesito ayuda</button>' +
      '<div id="ph" class="panel opc hide"><label for="th">¿En qué te ayudamos?</label><textarea id="th" maxlength="1500"></textarea>' +
      '<label><input type="checkbox" id="gh" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de mis datos)</label>' +
      '<button class="btn sec" onclick="if(!val(\'th\').trim()){alert(\'Escribe tu consulta\');return}enviar({a:\'ayuda\',texto:val(\'th\'),grave:document.getElementById(\'gh\').checked})">Enviar</button></div>' +
      (cancelable ? '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar tu solicitud?\'))enviar({a:\'cancelar\'})">Cancelar mi solicitud</button>' : ''), t);
  }
  return html_('Enlace no válido', '<p>Tipo de enlace desconocido.</p>');
}

/** Única función llamada desde las páginas (google.script.run). Revalida el token en cada llamada. */
function accion(t, p) {
  try {
    p = p || {};
    var tok = leerToken_(t);
    if (!tok) return { ok: false, msg: 'Enlace no válido.' };
    if (tok.caducado) return { ok: false, msg: 'Este enlace ha caducado.' };
    var tipo = tok['Tipo'], oc = tok['Código OC'], pro = tok['Código PRO'], r;
    var unUso = ['oferta', 'respaldo', 'presupuesto', 'fin'].indexOf(tipo) >= 0;
    if (unUso && tok['Usado']) return { ok: true, ya: true, msg: 'Ya habíamos registrado tu respuesta: ' + tok['Resultado'] };
    switch (tipo) {
      case 'oferta': r = procesarRespuestaOferta_(tok['Referencia'], p.a, p.disp, p.fecha, p.nota); break;
      case 'respaldo': r = procesarDecisionRespaldo_(tok['Referencia'], p.a); break;
      case 'presupuesto': r = procesarRespuestaPresupuesto_(tok['Referencia'], p.a); break;
      case 'fin': r = procesarFinCliente_(oc, p.a, p.texto, p.grave === true); break;
      case 'valorar':
        if (p.a === 'valorar') r = procesarValoracion_(oc, p.estrellas, p.comentario);
        else if (p.a === 'problema') r = procesarComentarioCliente_(oc, 'problema', p.categoria, p.texto, p.grave === true);
        else if (p.a === 'sugerencia') r = procesarComentarioCliente_(oc, 'sugerencia', 'Sugerencia para OficioCerca', p.texto, false);
        break;
      case 'gestion':
        if (p.a === 'presupuesto') r = registrarPresupuesto_(oc, pro, p.mo, p.mat, p.obs);
        else if (p.a === 'finalizado') r = marcarFinalizado_(oc, pro);
        break;
      case 'cliente':
        if (p.a === 'ayuda') r = procesarComentarioCliente_(oc, 'ayuda', 'Otro', p.texto, p.grave === true);
        else if (p.a === 'cancelar') r = conLock_(function () {
          var sol = solicitud_(oc);
          if (sol['Estado'] === 'Cancelada') return { ok: true, ya: true, msg: 'Tu solicitud ya estaba cancelada.' };
          if (['Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional', 'Esperando decisión cliente', 'Sin profesional compatible'].indexOf(sol['Estado']) < 0)
            return { ok: false, msg: 'Tu solicitud ya tiene profesional asignado. Si quieres cancelarla, usa «Necesito ayuda».' };
          cancelarSolicitud_(sol, 'Cancelada por el cliente');
          return { ok: true, msg: 'Hemos cancelado tu solicitud.' };
        });
        break;
    }
    if (!r) return { ok: false, msg: 'Acción no válida.' };
    if (r.ok && unUso && !r.noConsume) marcarToken_(tok, r.msg);
    try { actualizarPanel(); } catch (e) { }
    return { ok: !!r.ok, msg: r.msg };
  } catch (err) {
    errorSistema_('accion', err);
    return { ok: false, msg: 'Ha ocurrido un error. Inténtalo de nuevo en unos minutos.' };
  }
}
/* ============================================================ CICLO AUTOMÁTICO · PANEL · EDICIONES DEL ADMINISTRADOR · RESUMEN */

/** Activador cada 10 minutos: cola de correo, vencimientos, nuevas búsquedas, métricas y panel. */
function cicloAutomatico() {
  try {
    conLock_(function () {
      procesarCola_();
      revisarOfertas_();
      recalcularMetricas_();
      estadisticasCorreo_();
    });
  } catch (err) { errorSistema_('cicloAutomatico', err); }
  try { actualizarPanel(); } catch (e) { console.error(e); }
}

function estadisticasCorreo_() {
  var h = tabla_('Historial envíos').todas();
  cfgPoner_('Cuota correo disponible', MailApp.getRemainingDailyQuota());
  cfgPoner_('Última comprobación', fecha_(new Date()));
  cfgPoner_('Correos pendientes', h.filter(function (r) { return r['Estado'] === 'Pendiente por cuota'; }).length);
  cfgPoner_('Envíos fallidos', h.filter(function (r) { return r['Estado'] === 'Fallido'; }).length);
}

function intervenciones_(sol, pros, incs, correos, registro) {
  var out = [];
  sol.forEach(function (s) {
    if (s['Estado'] === 'Revisión manual') out.push(['Otro servicio', s['Código'], (s['Servicio (otro)'] || 'Otro') + ' · ' + s['Zona'], 'Solicitudes: ofrece con «Ofrecer a (PRO manual)», cambia el servicio o cancela']);
    if (s['Estado'] === 'Sin profesional compatible') out.push(['Sin profesional compatible', s['Código'], servicioTxt_(s) + ' · ' + s['Zona'] + ' · ' + s['Plazo'], 'Capta/activa un profesional (se reintenta solo) o contacta al cliente']);
  });
  incs.filter(function (i) { return i['Tipo'] === 'Incidencia' && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); })
    .sort(function (a, b) { return (a['Gravedad'] === 'Grave' ? 0 : 1) - (b['Gravedad'] === 'Grave' ? 0 : 1); })
    .forEach(function (i) { out.push([(i['Gravedad'] === 'Grave' ? 'INCIDENCIA GRAVE' : /ayuda/.test(i['Origen']) ? 'Cliente pide ayuda' : 'Incidencia'), i['ID'] + ' ' + i['Código OC'] + ' ' + i['Código PRO'], String(i['Categoría']) + ': ' + String(i['Descripción']).slice(0, 90), 'Incidencias: revisa y cambia el estado']); });
  pros.filter(function (p) { return p['Estado'] === 'Pendiente de revisar'; }).forEach(function (p) {
    out.push(['Profesional por revisar', p['Código'], p['Nombre'] + ' · ' + p['Servicios'] + ' · ' + p['Ciudad'], 'Profesionales: revisa y pon «Activo» (o Baja)']);
  });
  correos.filter(function (c) { return c['Estado'] === 'Fallido'; }).forEach(function (c) { out.push(['Correo fallido', c['Código OC'] || c['Código PRO'], c['Tipo'] + ' → ' + c['Correo'] + ' · ' + c['Último error'], 'Historial envíos: revisa el correo del destinatario']); });
  var hace72 = Date.now() - 72 * 3600000;
  registro.filter(function (r) { return r['Tipo'] === 'Error' && new Date(r['Fecha']).getTime() > hace72; }).slice(-10)
    .forEach(function (r) { out.push(['Error del sistema', fecha_(r['Fecha']), String(r['Detalle']).slice(0, 120), 'Registro (últimas 72 h)']); });
  return out;
}

function actualizarPanel() {
  var sh = ss_().getSheetByName('PANEL');
  if (!sh) return;
  var sol = tabla_('Solicitudes').todas(), pros = tabla_('Profesionales').todas(), incs = tabla_('Incidencias').todas();
  var correos = tabla_('Historial envíos').todas(), registro = tabla_('Registro').todas(), coms = tabla_('Comisiones').todas(), ofertas = tabla_('Ofertas').todas();
  var cuenta = function (estados) { return sol.filter(function (s) { return estados.indexOf(s['Estado']) >= 0; }).length; };
  var conRespaldo = sol.filter(function (s) {
    return ESTADOS_BUSQUEDA.concat(['Esperando decisión cliente']).indexOf(s['Estado']) >= 0 &&
      ofertas.some(function (o) { return o['Código OC'] === s['Código'] && o['Estado'] === 'Respaldo'; });
  }).length;
  var comPend = coms.filter(function (c) { return c['Estado'] === 'Pendiente' || c['Estado'] === 'Pendiente de habilitación'; });
  var sumaCom = comPend.reduce(function (a, c) { return a + Number(c['Importe comisión (€)'] || 0); }, 0);
  var hace7 = Date.now() - 7 * 86400000;
  var inter = intervenciones_(sol, pros, incs, correos, registro);

  var indicadores = [
    ['Solicitudes nuevas', cuenta(['Nueva'])],
    ['Buscando profesional', cuenta(['Buscando profesional'])],
    ['Esperando respuesta profesional', cuenta(['Esperando respuesta profesional'])],
    ['Con candidato de respaldo', conRespaldo],
    ['Esperando respuesta cliente', cuenta(['Esperando decisión cliente', 'Finalización por confirmar'])],
    ['Profesional asignado', cuenta(['Profesional asignado'])],
    ['Presupuestos enviados', cuenta(['Presupuesto enviado'])],
    ['Presupuestos aceptados (en curso)', cuenta(['Cliente aceptó', 'Finalización por confirmar'])],
    ['Trabajos finalizados', cuenta(['Finalizado', 'Valorada'])],
    ['Profesionales pendientes de revisar', pros.filter(function (p) { return p['Estado'] === 'Pendiente de revisar'; }).length],
    ['Profesionales activos', pros.filter(function (p) { return p['Estado'] === 'Activo'; }).length],
    ['Incidencias abiertas', incs.filter(function (i) { return i['Tipo'] === 'Incidencia' && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); }).length],
    ['Comisiones pendientes (' + (cfgBool_('COMMISSION_COLLECTION_ENABLED') ? 'cobro activo' : 'cobro NO habilitado') + ')', comPend.length + ' · ' + euros_(sumaCom)],
    ['Errores del sistema (7 días)', registro.filter(function (r) { return r['Tipo'] === 'Error' && new Date(r['Fecha']).getTime() > hace7; }).length],
    ['Correos en cola (por cuota)', correos.filter(function (c) { return c['Estado'] === 'Pendiente por cuota'; }).length],
    ['Correos fallidos', correos.filter(function (c) { return c['Estado'] === 'Fallido'; }).length]
  ];

  sh.clear();
  sh.getRange(1, 1, 1, 4).merge().setValue('OFICIOCERCA · PANEL DE CONTROL').setFontSize(16).setFontWeight('bold').setBackground('#13253D').setFontColor('#FFFFFF');
  sh.getRange(2, 1, 1, 4).merge().setValue('Actualizado: ' + fecha_(new Date()) + ' · se actualiza solo cada 10 min (menú OficioCerca → Actualizar panel ahora)').setFontColor('#586374');
  var f = 4;
  sh.getRange(f, 1, 1, 4).merge().setValue('REQUIERE MI INTERVENCIÓN (' + inter.length + ')').setFontWeight('bold').setFontSize(13)
    .setBackground(inter.length ? '#A3262A' : '#2E7D4F').setFontColor('#FFFFFF');
  f++;
  sh.getRange(f, 1, 1, 4).setValues([['Qué', 'Referencia', 'Detalle', 'Dónde actuar']]).setFontWeight('bold').setBackground('#F6F2EB');
  f++;
  if (inter.length) {
    sh.getRange(f, 1, inter.length, 4).setValues(inter).setWrap(true).setVerticalAlignment('top');
    inter.forEach(function (r, i) { if (/GRAVE|Error/.test(r[0])) sh.getRange(f + i, 1, 1, 4).setBackground('#FDECEC'); });
    f += inter.length;
  } else {
    sh.getRange(f, 1, 1, 4).merge().setValue('Nada pendiente. El sistema trabaja solo.').setFontColor('#2E7D4F'); f++;
  }
  f++;
  sh.getRange(f, 1, 1, 4).merge().setValue('ESTADO GENERAL').setFontWeight('bold').setFontSize(13).setBackground('#13253D').setFontColor('#FFFFFF');
  f++;
  sh.getRange(f, 1, indicadores.length, 2).setValues(indicadores);
  indicadores.forEach(function (r, i) {
    var cel = sh.getRange(f + i, 2).setFontWeight('bold').setHorizontalAlignment('center');
    var n = parseInt(r[1], 10) || 0;
    if (/Incidencias|Errores|fallidos|pendientes de revisar/.test(r[0]) && n > 0) cel.setBackground('#FDECEC').setFontColor('#A3262A');
    else if (/cola|respaldo|Esperando/.test(r[0]) && n > 0) cel.setBackground('#FFF4E5');
    else if (n > 0) cel.setBackground('#E8F5EC');
  });
  f += indicadores.length + 1;
  var guia = [
    ['CÓMO INTERVENGO', ''],
    ['Activar un profesional', 'Profesionales → Estado = «Activo» (exige condiciones aceptadas). Desde ese momento entra solo en el matching.'],
    ['Pausar / dar de baja', 'Profesionales → Estado = «Pausado», «En revisión» o «Baja». Sus ofertas abiertas se cierran solas.'],
    ['«Otro servicio»', 'Solicitudes → «Ofrecer a (PRO manual)» con un código PRO activo, o cambia «Servicio (código)» y pon Estado «Buscando profesional».'],
    ['Incidencia grave', 'Incidencias → marca «Pausa preventiva» (pausa al profesional y lo registra). La decisión final siempre es manual.'],
    ['Cancelar una solicitud', 'Solicitudes → Estado «Cancelada» y escribe el motivo en «Motivo cierre».'],
    ['Cobro de comisiones', 'Configuración → COMMISSION_COLLECTION_ENABLED sigue en FALSE hasta tener titular, fiscalidad y revisión legal.']
  ];
  sh.getRange(f, 1, guia.length, 2).setValues(guia).setWrap(true).setVerticalAlignment('top');
  sh.getRange(f, 1, 1, 2).setFontWeight('bold').setBackground('#F6F2EB');
  sh.setColumnWidth(1, 260); sh.setColumnWidth(2, 190); sh.setColumnWidth(3, 420); sh.setColumnWidth(4, 360);
  sh.setFrozenRows(2);
}

/* ---------- ediciones del administrador (activador instalable onEdit) ---------- */
function alEditar(e) {
  if (!e || !e.range || e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1 || e.range.getRow() < 2) return;
  var sh = e.range.getSheet(), nombre = sh.getName();
  if (!ESQUEMA[nombre]) return;
  var col = ESQUEMA[nombre][e.range.getColumn() - 1], fila = e.range.getRow();
  var usuario = (e.user && e.user.getEmail && e.user.getEmail()) || 'administrador';
  var valor = e.range.getValue(), antes = e.oldValue === undefined ? '' : e.oldValue;
  try {
    conLock_(function () {
      var t = tabla_(nombre), reg = t.todas().filter(function (r) { return r._fila === fila; })[0];
      if (!reg) return;
      if (nombre === 'Profesionales') {
        if (col === 'Estado') {
          if (valor === 'Activo' && (!reg['Condiciones (versión)'] || !reg['Condiciones aceptadas (fecha)'])) {
            t.poner(fila, { 'Estado': antes || 'Pendiente de revisar' });
            t.poner(fila, { 'Notas internas': fecha_(new Date()) + ' No se puede activar: no constan condiciones aceptadas. ' + reg['Notas internas'] });
            registrar_('Admin', 'Activación bloqueada (sin condiciones)', '', reg['Código'], '', usuario);
            return;
          }
          registrar_('Admin', 'Estado profesional: ' + (antes || '—') + ' → ' + valor, '', reg['Código'], '', usuario);
          if (valor === 'Activo' && antes !== 'Activo') {
            encolarCorreo_('pro-alta-' + reg['Código'], 'alta_activada', 'Profesional', reg['Email'], '', reg['Código'], {});
            revisarOfertas_();
          }
          if (valor !== 'Activo' && antes === 'Activo') revisarOfertas_();
        }
        if (col === 'Servicios (códigos)') {
          var lista = listaServicios_(valor);
          t.poner(fila, { 'Servicios (códigos)': lista.join(', '), 'Servicios': lista.map(function (c) { return SERVICIOS[c]; }).join(', ') });
          registrar_('Admin', 'Servicios cambiados', '', reg['Código'], lista.join(', '), usuario);
        }
      }
      if (nombre === 'Solicitudes') {
        if (col === 'Ofrecer a (PRO manual)' && valor) {
          var res = ofertaManual_(reg, valor);
          t.poner(fila, { 'Notas internas': fecha_(new Date()) + ' Oferta manual ' + valor + ': ' + res + '\n' + reg['Notas internas'] });
          registrar_('Admin', 'Oferta manual', reg['Código'], String(valor).toUpperCase(), res, usuario);
        }
        if (col === 'Servicio (código)') {
          var c = normServicio_(valor);
          t.poner(fila, { 'Servicio (código)': c || antes, 'Servicio': SERVICIOS[c || antes] || '' });
          registrar_('Admin', 'Servicio cambiado', reg['Código'], '', (antes || '—') + ' → ' + (c || 'no válido'), usuario);
        }
        if (col === 'Estado') {
          registrar_('Admin', 'Estado solicitud: ' + (antes || '—') + ' → ' + valor, reg['Código'], '', '', usuario);
          if (valor === 'Cancelada') cancelarSolicitud_(reg, reg['Motivo cierre'] || 'Cancelada por el administrador');
          if (valor === 'Buscando profesional') { t.poner(fila, { 'Requiere intervención': '', 'Decisión cliente': '' }); motor_(reg['Código']); }
        }
      }
      if (nombre === 'Incidencias') {
        if (col === 'Pausa preventiva' && valor === true && reg['Código PRO']) {
          var p = profesional_(reg['Código PRO']);
          if (p && p['Estado'] !== 'Pausado' && p['Estado'] !== 'Baja') {
            tabla_('Profesionales').poner(p._fila, { 'Estado': 'Pausado', 'Notas internas': fecha_(new Date()) + ' Pausa preventiva por ' + reg['ID'] + '\n' + p['Notas internas'] });
            revisarOfertas_();
          }
          t.poner(fila, { 'Acción tomada': 'Pausa preventiva (' + fecha_(new Date()) + ')', 'Administrador': usuario, 'Estado': reg['Estado'] === 'Abierta' ? 'En revisión' : reg['Estado'] });
          registrar_('Admin', 'Pausa preventiva', reg['Código OC'], reg['Código PRO'], reg['ID'], usuario);
        }
        if (col === 'Estado') {
          if (['Verificada', 'Descartada', 'Cerrada'].indexOf(valor) >= 0) t.poner(fila, { 'Fecha resolución': new Date(), 'Administrador': usuario });
          registrar_('Admin', 'Incidencia ' + reg['ID'] + ': ' + (antes || '—') + ' → ' + valor, reg['Código OC'], reg['Código PRO'], '', usuario);
          recalcularMetricas_();
        }
      }
      if (nombre === 'Comisiones' && col === 'Estado') registrar_('Admin', 'Comisión: ' + (antes || '—') + ' → ' + valor, reg['Código OC'], reg['Código PRO'], '', usuario);
      if (nombre === 'Configuración') { _cfg = null; registrar_('Admin', 'Configuración: ' + reg['Clave'], '', '', (antes || '—') + ' → ' + valor, usuario); }
    });
  } catch (err) { errorSistema_('alEditar ' + nombre, err); }
  try { actualizarPanel(); } catch (x) { }
}

/** Un único resumen diario al administrador. */
function resumenDiario() {
  try {
    if (!/^s[ií]$/i.test(String(cfg_('RESUMEN_DIARIO')))) return;
    var desde = Date.now() - 86400000, en = function (r, c) { return new Date(r[c]).getTime() > desde; };
    var sol = tabla_('Solicitudes').todas(), reg = tabla_('Registro').todas(), pros = tabla_('Profesionales').todas(), incs = tabla_('Incidencias').todas(), coms = tabla_('Comisiones').todas();
    var acc = function (a) { return reg.filter(function (r) { return en(r, 'Fecha') && r['Acción'] === a; }).length; };
    var inter = intervenciones_(sol, pros, incs, tabla_('Historial envíos').todas(), reg);
    var filas = [
      ['Nuevas solicitudes', sol.filter(function (s) { return en(s, 'Fecha'); }).length],
      ['Asignadas', acc('Asignación automática y contacto compartido')],
      ['Sin profesional compatible (ahora)', sol.filter(function (s) { return s['Estado'] === 'Sin profesional compatible'; }).length],
      ['Presupuestos aceptados', acc('Cliente acepta presupuesto · comisión calculada')],
      ['Trabajos terminados', acc('Cliente confirma finalización')],
      ['Incidencias nuevas', incs.filter(function (i) { return en(i, 'Fecha') && i['Tipo'] === 'Incidencia'; }).length],
      ['Comisiones generadas', coms.filter(function (c) { return en(c, 'Fecha generación'); }).length],
      ['Profesionales nuevos por revisar', pros.filter(function (p) { return en(p, 'Fecha'); }).length],
      ['Requieren tu intervención', inter.length]
    ];
    var hayAlgo = filas.some(function (f) { return Number(f[1]) > 0; });
    if (!hayAlgo) return; // sin actividad ni pendientes: no se envía nada
    var html = tabla_html_(filas) + (inter.length ? '<p><b>Requiere tu intervención:</b></p><ul>' + inter.slice(0, 20).map(function (r) { return '<li>' + esc_(r[0] + ' · ' + r[1] + ' · ' + r[2]) + '</li>'; }).join('') + '</ul>' : '') +
      '<p>Detalle en la pestaña PANEL de la hoja operativa.</p>';
    var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'dd/MM/yyyy');
    encolarCorreo_('admin-resumen-' + hoy, 'resumen_diario', 'Administrador', cfg_('ADMIN_EMAIL'), '', '', { fecha: hoy, html: html });
  } catch (err) { errorSistema_('resumenDiario', err); }
}
