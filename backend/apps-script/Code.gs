/**
 * OficioCerca — backend V1.7 (Google Apps Script, cuenta oficiocerca@gmail.com).
 *
 * Flujo: solicitud web (se guarda siempre) → matching por reglas → oferta SECUENCIAL → profesional asignado
 *  (contacto habilitado: «recibir el contacto inicia el trabajo en OficioCerca») → hablan, visitan y acuerdan FUERA
 *  → el profesional registra el ACUERDO ALCANZADO (mano de obra inicial + duración; materiales opcionales) → trabajo
 *  en proceso con fecha estimada de fin → seguimiento al vencer (terminado / sigue / problema) → cierre: el profesional
 *  registra el valor FINAL y el cliente confirma → SOLO entonces nace la comisión (10 % de los primeros 2.000 € de mano
 *  de obra final + 5 % del exceso, sin tope, materiales excluidos) → cobro con Wompi únicamente si está habilitado
 *  (en el piloto NO) → cerrado → valoración. Incidencias → «En revisión» (sin cierre, cobro ni reseña automáticos).
 *  Sin respuesta → archivado por inactividad (ambos) o revisión manual (una parte).
 *  «El correo avisa. La plataforma registra.»
 *
 * Puesta en marcha / actualización: ver backend/README.md (función instalarV15 → instalarV17, idempotente).
 * El código no contiene secretos: los IDs y credenciales se guardan en Propiedades del script.
 */

var VERSION_BACKEND = 'V1.7';
var ZONA_HORARIA = 'Europe/Madrid';

/** Valores por defecto de la pestaña «Configuración» (editables allí, salvo los de solo lectura). */
var CONFIG_DEFECTO = [
  ['COMMISSION_COLLECTION_ENABLED', 'FALSE', 'Cobro real de comisiones. FALSE = solo se calculan y registran (no se cobra nada). No activar sin titular, fiscalidad y revisión legal.'],
  ['COMISION_POLITICA', 'COM-2026-10-V2', 'Solo lectura. Política vigente: 10 % de los primeros 2.000 € de mano de obra + 5 % del exceso, sin tope, materiales excluidos (fórmula única en 12-v16.gs → comisionV16_).'],
  ['ADMIN_EMAIL', 'oficiocerca@gmail.com', 'Recibe SOLO alertas (errores, incidencias, excepciones) y el resumen diario.'],
  ['RESUMEN_DIARIO', 'SI', 'SI = un único correo resumen cada mañana al administrador.'],
  ['URL_WEB', 'https://oficiocerca.pages.dev/', 'Web pública.'],
  ['URL_APP', '', 'URL /exec de esta aplicación web (enlaces de los correos). Se rellena al desplegar.'],
  ['HORAS_RESPUESTA_URGENTE', '4', 'Horas para responder a una oportunidad cuando el cliente pide «Hoy o mañana».'],
  ['HORAS_RESPUESTA_NORMAL', '24', 'Horas para responder a una oportunidad en el resto de casos.'],
  ['DIAS_VALIDEZ_ENLACES', '30', 'Días de validez de los enlaces enviados a clientes (presupuesto, finalización…).'],
  ['CUOTA_RESERVA', '3', 'Correos que se reservan SOLO para alertas al administrador.'],
  ['CUOTA_RESERVA_BAJA', '15', 'Por debajo de esta cuota solo salen correos de prioridad alta; los demás esperan en cola (nunca se pierden).'],
  ['SEG_RECORDATORIO_2_HORAS', '48', 'Seguimiento: horas desde el primer aviso hasta el segundo.'],
  ['SEG_RECORDATORIO_3_HORAS', '120', 'Seguimiento: horas desde el primer aviso hasta el último recordatorio (5 días).'],
  ['SEG_CIERRE_HORAS', '48', 'Seguimiento: horas tras el último recordatorio para archivar (nadie respondió) o pasar a revisión (faltó una parte).'],
  ['SEG_ACUERDO_DIAS', '3', 'Días desde la asignación hasta recordar al profesional que registre el acuerdo alcanzado.'],
  ['REP_PESO_VALORACION', '1', 'Prioridad: peso de la valoración media (señal secundaria; 0 = no influye).'],
  ['REP_PESO_RESPUESTA', '1', 'Prioridad: peso de la tasa de respuesta a oportunidades (0 = no influye).'],
  ['REP_PESO_SEGUIMIENTO', '1', 'Prioridad: peso del cumplimiento del seguimiento (0 = no influye).'],
  ['PRO_COND_VERSION', 'PRO-COND-2026-10-V4', 'Versión vigente de las condiciones para profesionales.'],
  ['CONSENT_VERSION', 'C4-2026-10', 'Versión vigente del consentimiento de clientes.'],
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
  albanileria: 'Albañilería y pequeñas reformas', // LEGACY: inactiva en el piloto (no pública, sin matching)
  pintura: 'Pintura',
  carpinteria: 'Carpintería y ebanistería',
  marmoleria: 'Marmolería',
  otro: 'Otro servicio'
};

/** Servicios ACTIVOS del piloto (matching automático). «otro» y los legacy van a revisión manual. */
var SERVICIOS_ACTIVOS = ['electricidad', 'fontaneria', 'marmoleria', 'carpinteria', 'pintura'];
var TIPOS_SOLICITANTE = ['Particular', 'Empresa', 'Contratista'];
var TIPOS_PROVEEDOR = ['Profesional independiente / autónomo', 'Contratista', 'Empresa'];

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
  'Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional', 'Esperando decisión cliente',
  'Sin profesional disponible', 'Profesional asignado', 'Trabajo en proceso', 'Cierre pendiente del profesional',
  'Finalización por confirmar', 'Comisión pendiente', 'Cerrado', 'En revisión', 'Archivado por inactividad', 'Cancelada'
];
var ESTADOS_PROFESIONAL = ['Pendiente de revisar', 'Activo', 'En revisión', 'Pausado', 'Baja'];
var ESTADOS_OFERTA = ['Enviada', 'Seleccionada', 'Respaldo', 'Rechazada', 'Sin respuesta', 'Cerrada'];
var ESTADOS_PRESUPUESTO = ['Registrado', 'Sustituido'];
/** Comisiones (códigos técnicos): NO_HABILITADA = calculada sin cobro (no bloquea) · EN_REVISION = congelada por incidencia (no bloquea). */
var ESTADOS_COMISION = ['NO_HABILITADA', 'DUE', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED', 'MANUAL_REVIEW', 'EN_REVISION', 'ANULADA'];
var ESTADOS_INCIDENCIA = ['Abierta', 'En revisión', 'Resuelta', 'Descartada', 'Cerrada'];
var CATEGORIAS_INCIDENCIA = ['No se pudo contactar', 'Retraso', 'Trabajo abandonado', 'Trabajo parcial', 'Desacuerdo económico',
  'Problema de calidad', 'Daños', 'Materiales / bienes', 'Falta de comunicación', 'Otro', 'Situación grave'];
var RESULTADOS_INCIDENCIA = ['RESUELTO — TRABAJO COMPLETO', 'RESUELTO — TRABAJO PARCIAL', 'CANCELADO — NO HUBO TRABAJO',
  'SIN ACUERDO / REVISIÓN MANUAL', 'OTRO'];
var UNIDADES_DURACION = { horas: 3600000, dias: 86400000, semanas: 604800000 };

var ESQUEMA = {
  'Solicitudes': ['Código', 'Fecha', 'Estado', 'Requiere intervención', 'Tipo solicitante', 'Nombre', 'Empresa', 'WhatsApp',
    'Teléfono alt.', 'Email', 'Ciudad', 'Código postal', 'Zona', 'Servicio (código)', 'Servicio', 'Servicio (otro)',
    'Tipo de trabajo (legacy)', 'Descripción', 'Plazo (código)', 'Plazo', 'Fecha deseada', 'Contacto preferido (para el profesional)',
    'Nº fotos', 'Carpeta fotos (ID)', 'Consent. contacto (legacy)', 'Consent. compartir (legacy)', 'Consent. privacidad (legacy)', 'Versión consentimiento',
    'Origen', 'Ofrecer a (PRO manual)', 'Profesional asignado (PRO)', 'Fecha asignación', 'Disponibilidad profesional',
    'Respaldo (PRO)', 'Respaldo disponibilidad', 'Decisión cliente', 'Contacto enviado (fecha)', 'Presupuesto vigente',
    'Mano de obra aceptada (€)', 'Total aceptado (€)', 'Comisión (€)', 'Fecha aceptación', 'Finalizado (fecha)',
    'Valoración (1-5)', 'Motivo cierre', 'Última actualización', 'Notas internas', 'Consentimiento operativo', 'Consentimiento (fecha)',
    'Grupo cliente', 'Origen servicio', 'Fecha acordada', 'Materiales aceptados (€)', 'Versión acuerdo', 'Cliente confirmó fin (fecha)',
    'Fecha registro acuerdo', 'Duración estimada', 'Fecha estimada fin', 'Mano de obra inicial (€)', 'Mano de obra final (€)',
    'Materiales finales (€)', 'Trabajos adicionales', 'Motivo cambio valor', 'Cierre iniciado por', 'Acción pendiente de', 'Acción desde',
    'Plantilla seguimiento', 'Recordatorios enviados', 'Último aviso', 'Estado previo', 'Escalado por', 'Ronda búsqueda', 'Historial plazos'],
  'Profesionales': ['Código', 'Fecha', 'Estado', 'Nombre', 'Empresa / autónomo', 'Servicios (códigos)', 'Servicios',
    'Servicio otro', 'Especialidades', 'WhatsApp', 'Teléfono', 'Email', 'Ciudad', 'Código postal', 'Zonas', 'Distancia',
    'Experiencia', 'Disponibilidad habitual', 'Con particulares', 'Con empresas', 'Descripción', 'Consent. contacto (legacy)',
    'Consent. privacidad (legacy)', 'Condiciones (versión)', 'Condiciones aceptadas (fecha)', 'Origen', 'Prioridad',
    'Ofertas recibidas', 'Respuestas', 'Aceptadas', 'Asignaciones', 'Completados', 'Tiempo medio respuesta (h)',
    'Valoración media', 'Nº valoraciones', 'Incidencias verificadas', 'Comisiones pendientes', 'Última oferta', 'Notas internas', 'Tipo de proveedor',
    'Tasa respuesta (%)', 'Cumplimiento seguimiento (%)'],
  'Ofertas': ['ID', 'Fecha envío', 'Código OC', 'Código PRO', 'Profesional', 'Servicio', 'Puntuación', 'Motivo ranking',
    'Estado', 'Respuesta', 'Disponibilidad (código)', 'Disponibilidad', 'Días hasta disponibilidad', 'Fecha respuesta',
    'Expira', 'Notas', 'Ronda'],
  'Presupuestos': ['ID', 'Fecha', 'Código OC', 'Código PRO', 'Versión', 'Mano de obra (€)', 'Materiales (€)', 'Total (€)',
    'Observaciones', 'Estado', 'Respuesta cliente (fecha)', 'Notas', 'Fecha acordada', 'Registrado por', 'Confirmado por', 'Política comisión',
    'Duración (cantidad)', 'Duración (unidad)', 'Fecha estimada fin'],
  'Comisiones': ['Código OC', 'Código PRO', 'Profesional', 'Presupuesto', 'Mano de obra (€)', 'Porcentaje', 'Importe comisión (€)',
    'Fecha generación', 'Estado', 'Fecha pago', 'Notas', 'Materiales (€)', 'Política', 'Tramo 10 % (€)', 'Tramo 5 % (€)', 'Fecha exigible',
    'Referencia vigente', 'Transaction ID', 'Importe pagado (COP)', 'Tasa EUR→COP', 'Fuente tasa', 'Fecha tasa', 'Moneda', 'Ambiente'],
  'Pagos comisión': ['Referencia', 'Código OC', 'Código PRO', 'Comisión (€)', 'Tasa EUR→COP', 'Fuente tasa', 'Fecha tasa', 'Importe (COP)',
    'Importe (centavos)', 'Moneda', 'Creado', 'Estado', 'Transaction ID', 'Estado Wompi', 'Fecha estado', 'Ambiente', 'Notas'],
  'Eventos Wompi': ['Clave', 'Recibido', 'Evento', 'Ambiente', 'Transaction ID', 'Referencia', 'Estado Wompi', 'Firma válida', 'Resultado', 'Repeticiones', 'Timestamp'],
  'Aceptaciones condiciones': ['Fecha', 'Código PRO', 'Versión', 'Origen', 'Notas'],
  'Incidencias': ['ID', 'Fecha', 'Tipo', 'Código OC', 'Código PRO', 'Origen', 'Categoría', 'Gravedad', 'Descripción', 'Estado',
    'Pausa preventiva', 'Acción tomada', 'Administrador', 'Fecha resolución', 'Notas', 'Servicio', 'Cliente', 'Reportado por',
    'Resultado', 'Mano de obra reconocida (€)', 'Estado previo servicio'],
  'Valoraciones': ['Fecha', 'Código OC', 'Código PRO', 'Estrellas', 'Comentario', 'Publicable', 'Notas', 'Trabajo verificado'],
  'Historial envíos': ['ID', 'Fecha', 'Clave', 'Tipo', 'Destinatario', 'Correo', 'Código OC', 'Código PRO', 'Asunto',
    'Estado', 'Intentos', 'Fecha envío', 'Nº adjuntos', 'Último error', 'Datos'],
  'Registro': ['Fecha', 'Tipo', 'Acción', 'Código OC', 'Código PRO', 'Detalle', 'Usuario'],
  'Tokens': ['Hash', 'Tipo', 'Código OC', 'Código PRO', 'Referencia', 'Creado', 'Expira', 'Usado', 'Resultado'],
  'Configuración': ['Clave', 'Valor', 'Descripción']
};

/** Orden de pestañas: PANEL primero. */
var ORDEN_PESTANAS = ['PANEL', 'Solicitudes', 'Profesionales', 'Ofertas', 'Presupuestos', 'Comisiones', 'Pagos comisión', 'Eventos Wompi',
  'Incidencias', 'Valoraciones', 'Aceptaciones condiciones', 'Historial envíos', 'Registro', 'Configuración', 'Tokens'];

var DESPLEGABLES = {
  'Solicitudes': { 'Estado': ESTADOS_SOLICITUD },
  'Profesionales': { 'Estado': ESTADOS_PROFESIONAL, 'Prioridad': ['Normal', 'Baja'], 'Tipo de proveedor': TIPOS_PROVEEDOR },
  'Ofertas': { 'Estado': ESTADOS_OFERTA },
  'Presupuestos': { 'Estado': ESTADOS_PRESUPUESTO },
  'Comisiones': { 'Estado': ESTADOS_COMISION },
  'Incidencias': { 'Estado': ESTADOS_INCIDENCIA, 'Gravedad': ['Normal', 'Alta', 'Grave'], 'Resultado': RESULTADOS_INCIDENCIA }
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
    _cache: null,
    /** Lectura completa memorizada durante la ejecución (se invalida al escribir): evita releer la hoja en cada consulta. */
    todas: function () {
      if (t._cache) return t._cache;
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
      t._cache = out;
      return out;
    },
    /** Búsqueda directa de UNA fila por valor exacto en una columna (TextFinder: no lee toda la hoja). */
    buscarRapido: function (c, val) {
      if (t._cache) return t.buscar(c, val);
      var n = sh.getLastRow();
      if (n < 2 || !val) return null;
      var celda = sh.getRange(2, t.col(c), n - 1, 1).createTextFinder(String(val)).matchEntireCell(true).findNext();
      if (!celda) return null;
      var fila = celda.getRow(), v = sh.getRange(fila, 1, 1, cols.length).getValues()[0], o = { _fila: fila };
      cols.forEach(function (k, j) { o[k] = v[j]; });
      return o;
    },
    buscar: function (c, val) {
      var all = t.todas();
      for (var i = 0; i < all.length; i++) if (String(all[i][c]).trim() === String(val).trim()) return all[i];
      return null;
    },
    agregar: function (o) {
      var fila = cols.map(function (c) { return o[c] === undefined ? '' : o[c]; });
      sh.appendRow(fila);
      t._cache = null;
      return sh.getLastRow();
    },
    poner: function (fila, o) {
      var ks = Object.keys(o);
      // Celdas contiguas en una sola escritura cuando es posible
      var idx = ks.map(function (k) { return t.col(k); });
      var contiguas = idx.every(function (c, i) { return i === 0 || c === idx[i - 1] + 1; });
      if (ks.length > 1 && contiguas) sh.getRange(fila, idx[0], 1, ks.length).setValues([ks.map(function (k) { return o[k]; })]);
      else ks.forEach(function (k, i) { sh.getRange(fila, idx[i]).setValue(o[k]); });
      if (t._cache) { var reg = t._cache.filter(function (x) { return x._fila === fila; })[0]; if (reg) ks.forEach(function (k) { reg[k] = o[k]; }); }
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

/** V1.5 → V1.6: misma instalación idempotente (no borra datos) + migración V1.6. */
function instalarV15() { instalarV17(); }

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
    ['Solicitudes', 'Profesionales', 'Ofertas', 'Presupuestos', 'Comisiones', 'Pagos comisión', 'Eventos Wompi', 'Incidencias', 'Valoraciones',
      'Aceptaciones condiciones', 'Historial envíos', 'Registro', 'Tokens'].forEach(function (n) {
      var sh = hoja_(n); if (sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
    });
    // Pestañas exclusivas de las pruebas Wompi de V1.5 (solo contenían datos de PRUEBA)
    ['Comisiones Sandbox', 'Pagos Sandbox'].forEach(function (n) { var sh = ss_().getSheetByName(n); if (sh) ss_().deleteSheet(sh); });
    var props = PropertiesService.getScriptProperties();
    props.setProperty('SEQ_OC', '0'); props.setProperty('SEQ_PRO', '0'); props.setProperty('SEQ_INC', '0');
    props.deleteProperty('SBX_E2E_OC'); props.deleteProperty('PENDIENTE'); props.deleteProperty('PROX_SEGUIMIENTO'); props.deleteProperty('METRICAS_PENDIENTES');
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

function respaldoV15FinalPiloto2() {
  var c = crearRespaldo_('OFICIOCERCA-V1.5-FINAL-PILOTO-2', 'OFICIOCERCA-V1.5-FINAL-PILOTO-2');
  DriveApp.getFileById(ss_().getId()).makeCopy('OFICIOCERCA-V1.5-FINAL-PILOTO-2 — copia de la hoja (estructura y configuración, sin datos)', c);
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.5-FINAL-PILOTO-2 — versión final vigente para el piloto real.',
    'Igual que OFICIOCERCA-V1.5-FINAL-PILOTO + accesos generales a asesoría (cabecera, menú móvil y pie de página).',
    'Endpoint: ' + cfg_('URL_APP'),
    'Rollback: OFICIOCERCA-V1.5-FINAL-PILOTO (sin accesos generales) u OFICIOCERCA-V1.5-PRE-SOPORTE.'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

function respaldoV15PreVideoInstitucional() {
  var c = crearRespaldo_('OFICIOCERCA-V1.5-PRE-VIDEO-INSTITUCIONAL', 'OFICIOCERCA-V1.5-PRE-VIDEO-INSTITUCIONAL');
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.5-PRE-VIDEO-INSTITUCIONAL — estado justo antes de integrar el vídeo institucional en la home.',
    'Idéntico a OFICIOCERCA-V1.5-FINAL-PILOTO-2. Rollback de la web: restaurar los archivos de este zip en GitHub.'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

function respaldoV15VideoInstitucional() {
  var c = crearRespaldo_('OFICIOCERCA-V1.5-VIDEO-INSTITUCIONAL', 'OFICIOCERCA-V1.5-VIDEO-INSTITUCIONAL');
  DriveApp.getFileById(ss_().getId()).makeCopy('OFICIOCERCA-V1.5-VIDEO-INSTITUCIONAL — copia de la hoja (estructura y configuración, sin datos)', c);
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.5-VIDEO-INSTITUCIONAL — versión vigente con el vídeo institucional en la home.',
    'El zip incluye la versión web del vídeo (assets/video/oficiocerca-institucional.mp4) y su póster.',
    'El MASTER original del vídeo (26,9 MB, supera el límite de 25 MB por archivo de Cloudflare Pages) está adjunto a la release de GitHub OFICIOCERCA-V1.5-VIDEO-INSTITUCIONAL.',
    'Endpoint: ' + cfg_('URL_APP'),
    'Rollback: OFICIOCERCA-V1.5-PRE-VIDEO-INSTITUCIONAL.'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

/* ============================================================ V1.6 · RESPALDO, AUDITORÍA Y ACTIVADORES */

function respaldoV16Pre() {
  var c = crearRespaldo_('OFICIOCERCA-V1.6-PRE', 'OFICIOCERCA-V1.6-PRE');
  DriveApp.getFileById(ss_().getId()).makeCopy('OFICIOCERCA-V1.6-PRE — copia de la hoja (con los registros PRUEBA SANDBOX)', c);
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.6-PRE — estado justo antes de la V1.6 (comisiones 10 %/5 %, acuerdo, seguimiento, Wompi).',
    'GitHub: main = d9b2d224 · wompi-sandbox = fccb17f4 (etiqueta OFICIOCERCA-V1.6-PRE) · Apps Script: implementación versión 10.',
    'La copia de la hoja incluye los registros marcados PRUEBA SANDBOX (no hay registros reales).',
    'Endpoint: ' + cfg_('URL_APP'),
    'Rollback del backend: Gestionar implementaciones → editar → Versión 10. Rollback web: rama main (sin cambios).'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

/** Auditoría sin secretos: pestañas, cabeceras, filas, nombres de propiedades, registros reales vs. prueba. */
function auditoriaV16() {
  var ss = ss_(), props = PropertiesService.getScriptProperties().getProperties();
  Logger.log('Versión: ' + VERSION_BACKEND + ' · Hoja: ' + ss.getId());
  ss.getSheets().forEach(function (sh) {
    var c = sh.getLastColumn(), cab = c ? sh.getRange(1, 1, 1, c).getValues()[0].filter(String) : [];
    Logger.log('Pestaña «' + sh.getName() + '» · filas ' + Math.max(sh.getLastRow() - 1, 0) + ' · ' + cab.length + ' columnas: ' + cab.join(' | '));
  });
  Logger.log('Propiedades (solo nombres): ' + Object.keys(props).sort().join(', '));
  ['SEQ_OC', 'SEQ_PRO', 'SEQ_INC'].forEach(function (k) { Logger.log(k + ' → ' + props[k]); });
  ['COMMISSION_COLLECTION_ENABLED', 'WOMPI_SANDBOX_ENABLED', 'TEST_EXCHANGE_RATE', 'PRO_COND_VERSION', 'CONSENT_VERSION', 'COMISION_MAXIMO_EUR'].forEach(function (k) {
    Logger.log('Config ' + k + ' → ' + cfg_(k));
  });
  var esPrueba = function (r) { return /PRUEBA|SANDBOX/i.test([r['Nombre'], r['Notas internas'], r['Origen']].join(' ')); };
  ['Solicitudes', 'Profesionales'].forEach(function (n) {
    var t = tabla_(n).todas();
    Logger.log(n + ': ' + t.length + ' registro(s) · prueba ' + t.filter(esPrueba).length + ' · NO prueba ' + t.filter(function (r) { return !esPrueba(r); }).length +
      ' · códigos ' + t.map(function (r) { return r['Código'] + (esPrueba(r) ? '(prueba)' : '(REAL?)'); }).join(', '));
  });
  Logger.log('Activadores: ' + ScriptApp.getProjectTriggers().map(function (t) { return t.getHandlerFunction() + '[' + t.getEventType() + ']'; }).join(', '));
}

/**
 * Activadores deshabilitados por Google («Se ha desactivado la cuenta del propietario de este activador»):
 * se eliminan los de procesarPendientes y cicloAutomatico y se crean de nuevo con la cuenta actual (uno de cada).
 */
function repararActivadoresV16() {
  var ss = ss_();
  var fijar = { procesarPendientes: function () { ScriptApp.newTrigger('procesarPendientes').timeBased().everyMinutes(1).create(); },
                cicloAutomatico: function () { ScriptApp.newTrigger('cicloAutomatico').timeBased().everyMinutes(10).create(); } };
  ScriptApp.getProjectTriggers().forEach(function (t) { if (fijar[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t); });
  Object.keys(fijar).forEach(function (f) { fijar[f](); });
  var hay = function (f) { return ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === f; }); };
  if (!hay('alEditar')) ScriptApp.newTrigger('alEditar').forSpreadsheet(ss).onEdit().create();
  if (!hay('alAbrir')) ScriptApp.newTrigger('alAbrir').forSpreadsheet(ss).onOpen().create();
  if (!hay('resumenDiario')) ScriptApp.newTrigger('resumenDiario').timeBased().atHour(8).nearMinute(5).everyDays(1).inTimezone(ZONA_HORARIA).create();
  var cuenta = {};
  ScriptApp.getProjectTriggers().forEach(function (t) { cuenta[t.getHandlerFunction()] = (cuenta[t.getHandlerFunction()] || 0) + 1; });
  Logger.log('Activadores (función × número): ' + JSON.stringify(cuenta) + ' · cuenta ' + Session.getEffectiveUser().getEmail());
}

function respaldoV16Evidencias() {
  var c = crearRespaldo_('OFICIOCERCA-V1.6-EVIDENCIAS-PRUEBAS', 'OFICIOCERCA-V1.6-EVIDENCIAS-PRUEBAS');
  DriveApp.getFileById(ss_().getId()).makeCopy('OFICIOCERCA-V1.6-EVIDENCIAS-PRUEBAS — copia de la hoja CON los registros de PRUEBA (evidencia E2E)', c);
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.6-EVIDENCIAS-PRUEBAS — evidencia de las pruebas E2E de la V1.6, justo antes de la limpieza total.',
    'La copia de la hoja contiene SOLO registros de PRUEBA / SANDBOX (ningún cliente ni profesional real). No se cobró dinero real.',
    'Endpoint: ' + cfg_('URL_APP')
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

function respaldoV16Final() {
  var c = crearRespaldo_('OFICIOCERCA-V1.6-FINAL', 'OFICIOCERCA-V1.6-FINAL');
  DriveApp.getFileById(ss_().getId()).makeCopy('OFICIOCERCA-V1.6-FINAL — copia de la hoja limpia (estructura y configuración, sin datos)', c);
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.6-FINAL — backend V1.6 en la rama oficiocerca-v1.6 (NO fusionada en main), hoja limpia y contadores a cero.',
    'Cobro real: COMMISSION_COLLECTION_ENABLED = FALSE. Wompi SANDBOX desactivado (se puede reactivar con sbxE2E_activar).',
    'Endpoint: ' + cfg_('URL_APP'),
    'Rollback: OFICIOCERCA-V1.6-PRE (Apps Script versión 10).'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

function respaldoV17Evidencias() {
  var c = crearRespaldo_('OFICIOCERCA-V1.7-EVIDENCIAS-PRUEBAS', null);
  DriveApp.getFileById(ss_().getId()).makeCopy('OFICIOCERCA-V1.7-EVIDENCIAS-PRUEBAS — copia de la hoja CON los registros de PRUEBA (evidencia E2E)', c);
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.7-EVIDENCIAS-PRUEBAS — evidencia de las pruebas E2E reales de la V1.7, justo antes de la limpieza.',
    'Solo registros PRUEBA / E2E (ningún cliente ni profesional real). No se cobró dinero real (cobro y sandbox desactivados).',
    'Backend: Apps Script V1.7 · Endpoint: ' + cfg_('URL_APP')
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

function respaldoV17Final() {
  var c = crearRespaldo_('OFICIOCERCA-V1.7-FINAL', 'OFICIOCERCA-V1.7-FINAL');
  DriveApp.getFileById(ss_().getId()).makeCopy('OFICIOCERCA-V1.7-FINAL — copia de la hoja limpia (estructura y configuración, sin datos)', c);
  c.createFile('LEEME.txt', [
    'OFICIOCERCA-V1.7-FINAL — backend V1.7 en la rama oficiocerca-v1.6 (NO fusionada en main), hoja limpia y contadores a cero.',
    'Cobro real: COMMISSION_COLLECTION_ENABLED = FALSE. Wompi SANDBOX desactivado. Condiciones vigentes ' + condVigente_() + '.',
    'Endpoint: ' + cfg_('URL_APP'),
    'Rollback: etiqueta OFICIOCERCA-V1.6-PRE-V17 + Apps Script versión 12.'
  ].join('\n'));
  Logger.log('Respaldo: ' + c.getUrl());
}

/* ============================================================ ENTRADA DESDE LA WEB */

/** Límite de frecuencia sencillo (CacheService): máx. «n» operaciones por clave y ventana. Sin datos personales en claro. */
function limiteFrecuencia_(clave, n, segundos) {
  try {
    var c = CacheService.getScriptCache(), k = 'rl-' + hash_(clave).slice(0, 32), v = Number(c.get(k) || 0);
    if (v >= n) return false;
    c.put(k, String(v + 1), segundos);
  } catch (e) { }
  return true;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents || e.postData.contents.length > 30 * 1024 * 1024) return json_({ ok: false, error: 'sin datos' });
    var d = JSON.parse(e.postData.contents);
    if (d && d.event && d.signature && d.data) return json_(webhookWompi_(d)); // Wompi: URL de eventos (verificada)
    if (d.web) return json_({ ok: false, error: 'rechazado' }); // trampa anti-spam
    if (d.tipo === 'solicitud') return json_(guardarSolicitud_(d));
    if (d.tipo === 'profesional') return json_(guardarProfesional_(d));
    if (d.tipo === 'pagina') return json_(paginaJson_(d.t));
    if (d.tipo === 'accion') {
      // V1.7: la respuesta incluye ya la página actualizada → la web no necesita una segunda llamada
      var res = accion(String(d.t || ''), d.p || {});
      if (res && res.ok && !res.url && !res.t) { try { res.pagina = paginaJson_(String(d.t || '')); } catch (e) { } }
      return json_(res);
    }
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

  if (!limiteFrecuencia_('sol-' + limpio_(t_(d.whatsapp)) + '-' + String(d.email).toLowerCase(), 6, 3600)) invalido_('demasiadas solicitudes seguidas; inténtalo más tarde');
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
  if (!limiteFrecuencia_('pro-' + String(d.email).toLowerCase(), 4, 3600)) invalido_('demasiados intentos seguidos; inténtalo más tarde');
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
    registrarAceptacionCond_(code, version, 'Formulario de registro');
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

var ESTADOS_BUSQUEDA = ['Nueva', 'Buscando profesional', 'Esperando respuesta profesional', 'Sin profesional disponible'];

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
    if (SERVICIOS_ACTIVOS.indexOf(sol['Servicio (código)']) < 0) {
      actualizarSol_(sol, { 'Estado': 'Revisión manual', 'Requiere intervención': sol['Servicio (código)'] === 'otro' ? 'Otro servicio: revisar demanda' : 'Servicio no activo en el piloto: revisar' });
      return 'manual';
    }
    var ronda = rondaDe_(sol);
    var ofertas = tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === oc && (Number(o['Ronda']) || 1) === ronda; });
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
    if (sol['Estado'] !== 'Sin profesional disponible') {
      actualizarSol_(sol, { 'Estado': 'Sin profesional disponible', 'Requiere intervención': 'No hay profesional compatible disponible' + (respaldo ? ' (el cliente pidió seguir buscando)' : '') });
      registrar_('Sistema', 'Sin profesional disponible', oc, '', SERVICIOS[sol['Servicio (código)']] + ' · ' + sol['Zona'] + ' · ronda ' + ronda);
      // UN solo correo por ronda de búsqueda (la clave lo hace idempotente); se sigue reintentando en silencio
      encolarCorreo_('cli-sinpro-' + oc + '-r' + ronda, 'sin_profesional', 'Cliente', sol['Email'], oc, '', {}, true);
    }
    return 'sin candidatos';
  });
}

function candidatos_(sol, ofertasOC) {
  var servicio = sol['Servicio (código)'];
  var yaOfrecidos = ofertasOC.map(function (o) { return String(o['Código PRO']); });
  var empresa = /empresa|contratista/i.test(sol['Tipo solicitante']); // Empresa y Contratista = cliente B2B
  var dCli = diasCliente_(sol);
  var hace30 = Date.now() - 30 * 86400000;
  var todasOfertas = tabla_('Ofertas').todas();
  var bloqueados = prosBloqueados_(); // comisión exigible sin pagar → sin NUEVAS oportunidades (trabajos actuales intactos)
  var out = [];
  tabla_('Profesionales').todas().forEach(function (p) {
    var code = String(p['Código']);
    if (String(p['Estado']).trim() !== 'Activo') return;
    if (!emailOk_(p['Email'])) return;
    if (listaServicios_(p['Servicios (códigos)']).indexOf(servicio) < 0) return;
    if (!condAlDia_(p)) return; // V1.6: debe haber aceptado la versión VIGENTE de las condiciones
    if (empresa ? p['Con empresas'] !== 'Sí' : p['Con particulares'] !== 'Sí') return;
    if (yaOfrecidos.indexOf(code) >= 0) return;
    if (bloqueados[code]) return;
    var zona = zonaCompatible_(p, sol);
    if (!zona.ok) return;
    var puntos = 0, motivos = [];
    if (zona.coincide) { puntos += 3; motivos.push('zona +3'); }
    var habitual = sinAcentos_(p['Disponibilidad habitual']);
    if (dCli !== null && dCli <= 7 && /esta semana/.test(habitual)) { puntos += 2; motivos.push('disponibilidad habitual +2'); }
    if (dCli !== null && dCli > 7 && /1-2 semanas|1–2 semanas/.test(habitual)) { puntos += 1; motivos.push('disponibilidad habitual +1'); }
    if (dCli === null && !/completa/.test(habitual)) { puntos += 1; motivos.push('plazo flexible +1'); }
    var rep = puntosReputacion_(p);
    if (rep.puntos) { puntos += rep.puntos; motivos.push(rep.motivo); }
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
  var ronda = rondaDe_(sol), id = 'OF-' + oc + '-' + pro + (ronda > 1 ? '-R' + ronda : ''); // ID único por ronda (volver a buscar)
  var expira = vencimiento_(plazoRespuestaHoras_(sol));
  tabla_('Ofertas').agregar({
    'ID': id, 'Fecha envío': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Profesional': p['Nombre'],
    'Servicio': SERVICIOS[sol['Servicio (código)']] || sol['Servicio'], 'Puntuación': c.puntos, 'Motivo ranking': c.motivo,
    'Estado': 'Enviada', 'Expira': expira, 'Ronda': ronda
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
    }
  });
  actualizarSol_(sol, { 'Estado': 'Profesional asignado', 'Requiere intervención': '', 'Profesional asignado (PRO)': pro, 'Fecha asignación': new Date(), 'Disponibilidad profesional': dispTxt });
  encolarCorreo_('pro-contacto-' + oc + '-' + pro, 'contacto_profesional', 'Profesional', p['Email'], oc, pro, { token: { tipo: 'gestion', dias: 180 } });
  encolarCorreo_('cli-asignado-' + oc + '-' + pro, 'asignado_cliente', 'Cliente', sol['Email'], oc, pro, { disp: dispTxt });
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
    if (['Nueva', 'Buscando profesional', 'Sin profesional disponible'].indexOf(s['Estado']) >= 0) tocadas[s['Código']] = 1;
  });
  Object.keys(tocadas).forEach(function (oc) { try { motor_(oc); } catch (e) { errorSistema_('motor ' + oc, e); } });
}

/** Oferta manual del administrador (columna «Ofrecer a (PRO manual)»), p. ej. para «Otro servicio». */
function ofertaManual_(sol, pro) {
  pro = String(pro || '').trim().toUpperCase();
  var p = profesional_(pro);
  if (!p) return 'No existe ' + pro;
  if (p['Estado'] !== 'Activo') return pro + ' no está Activo';
  if (!condAlDia_(p)) return pro + ' no ha aceptado las condiciones vigentes (' + condVigente_() + ')';
  if (proBloqueado_(pro)) return pro + ' tiene una comisión exigible pendiente: no recibe nuevas oportunidades';
  var ofertas = tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === sol['Código']; });
  if (ofertas.some(function (o) { return o['Estado'] === 'Enviada'; })) return 'Ya hay una oferta pendiente de respuesta';
  if (ofertas.some(function (o) { return o['Código PRO'] === pro; })) return pro + ' ya recibió esta solicitud';
  if (ESTADOS_BUSQUEDA.concat(['Revisión manual', 'Esperando decisión cliente']).indexOf(sol['Estado']) < 0) return 'La solicitud está «' + sol['Estado'] + '»';
  ofrecer_(sol, { pro: p, puntos: '', motivo: 'Oferta manual del administrador' });
  return 'Oferta enviada a ' + pro;
}

/** Ronda de búsqueda vigente (cada «Volver a buscar» abre una ronda nueva sin pedir otra vez los datos). */
function rondaDe_(sol) { return Number(sol['Ronda búsqueda']) || 1; }

/**
 * Reputación como SEÑAL SECUNDARIA de prioridad (los filtros duros —servicio, zona, tipo de cliente, estado activo,
 * condiciones vigentes y ausencia de bloqueo— se aplican antes). Pesos configurables (REP_PESO_*; 0 = no influye).
 * Un profesional nuevo sin datos puntúa 0 (neutro) y la rotación (menos ofertas en 30 días primero) le da oportunidades.
 *  - Valoración: solo con ≥ 1 valoración → (media − 3) / 2  (de −1 a +1).
 *  - Respuesta: solo con ≥ 3 ofertas → +1 si responde ≥ 80 %, −1 si responde < 40 %.
 *  - Seguimiento: solo con ≥ 2 trabajos → +0,5 si ≥ 90 % al día, −1 si < 60 %.
 *  - Nuevo (menos de 3 oportunidades recibidas): +1, para que entre en rotación sin necesitar reseñas.
 *  - Tope total ±1 (la zona coincidente suma 3): la reputación desempata, nunca domina.
 */
function puntosReputacion_(p) {
  var w1 = cfgNum_('REP_PESO_VALORACION', 1), w2 = cfgNum_('REP_PESO_RESPUESTA', 1), w3 = cfgNum_('REP_PESO_SEGUIMIENTO', 1);
  var pts = 0, m = [];
  var nv = Number(p['Nº valoraciones']) || 0, media = Number(p['Valoración media']) || 0;
  if (nv >= 1 && w1) { var a = w1 * (media - 3) / 2; pts += a; m.push('valoración ' + (a >= 0 ? '+' : '') + Math.round(a * 10) / 10); }
  var of = Number(p['Ofertas recibidas']) || 0, tr = p['Tasa respuesta (%)'];
  if (of >= 3 && tr !== '' && tr !== undefined && w2) { var b = Number(tr) >= 80 ? w2 : Number(tr) < 40 ? -w2 : 0; if (b) { pts += b; m.push('respuesta ' + (b > 0 ? '+' : '') + b); } }
  var cs = p['Cumplimiento seguimiento (%)'], tj = Number(p['Asignaciones']) || 0;
  if (tj >= 2 && cs !== '' && cs !== undefined && w3) { var c = Number(cs) >= 90 ? 0.5 * w3 : Number(cs) < 60 ? -w3 : 0; if (c) { pts += c; m.push('seguimiento ' + (c > 0 ? '+' : '') + c); } }
  // Profesional nuevo (menos de 3 oportunidades recibidas): +1 para que tenga oportunidades reales aunque no tenga historial
  if (of < 3) { pts += 1; m.push('nuevo +1'); }
  // Señal SECUNDARIA: la reputación nunca suma ni resta más de 1 punto (la zona suma 3). A igualdad de puntos manda la
  // rotación (menos oportunidades en 30 días), así que nadie queda «siempre primero».
  var tope = 1, lim = Math.max(-tope, Math.min(tope, pts));
  if (lim !== pts) m.push('tope ±' + tope);
  return { puntos: Math.round(lim * 10) / 10, motivo: m.join(' · ') };
}

/** «Volver a buscar»: nueva ronda sobre la MISMA solicitud (sin rellenar nada otra vez). */
function volverABuscar_(oc) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Estado'] !== 'Sin profesional disponible') return { ok: false, msg: 'Ahora mismo tu solicitud ya está en búsqueda o en curso.' };
    var ronda = rondaDe_(sol) + 1;
    actualizarSol_(sol, { 'Estado': 'Buscando profesional', 'Ronda búsqueda': ronda, 'Requiere intervención': '', 'Decisión cliente': '' });
    registrar_('Sistema', 'El cliente vuelve a buscar (ronda ' + ronda + ')', oc, '', '');
    motor_(oc);
    return { ok: true, msg: 'Hemos vuelto a buscar un profesional para tu solicitud. Te avisaremos por correo cuando haya uno.' };
  });
}
/* ============================================================ V1.7 · ACUERDO EXTERNO · PLAZO · CIERRE · VALORACIÓN · INCIDENCIAS
 *
 * OficioCerca NO cotiza ni negocia precios. Cliente y profesional hablan, visitan y acuerdan POR FUERA.
 * Después el profesional vuelve y REGISTRA EL ACUERDO YA ALCANZADO (mano de obra inicial + duración estimada).
 * La duración es el reloj del seguimiento: al vencer, la plataforma pregunta el estado a las partes (12-v16.gs).
 * Cierre: cualquiera lo inicia; el profesional registra la mano de obra FINAL; el cliente confirma. Solo entonces
 * se calcula la comisión (sobre la mano de obra final confirmada; materiales nunca).
 */

var ESTADOS_PERMITEN_ACUERDO = ['Profesional asignado', 'Trabajo en proceso'];
var ESTADOS_PERMITEN_PRESUPUESTO = ESTADOS_PERMITEN_ACUERDO; // compatibilidad
var ESTADOS_TRAS_CONFIRMAR_FIN = ['Comisión pendiente', 'Cerrado'];
/** Estados en los que el servicio está «vivo» (se puede reportar un problema e indicar el estado del trabajo). */
var ESTADOS_ACTIVOS_SERVICIO = ['Profesional asignado', 'Trabajo en proceso', 'Cierre pendiente del profesional', 'Finalización por confirmar', 'Archivado por inactividad'];

/** Duración «cantidad + unidad» → { ms, texto } o null si no es válida. */
function duracion_(cantidad, unidad) {
  var n = parseInt(cantidad, 10), u = String(unidad || '').toLowerCase().replace('í', 'i');
  if (!(n >= 1 && n <= 365) || !UNIDADES_DURACION[u]) return null;
  var nombres = { horas: ['hora', 'horas'], dias: ['día', 'días'], semanas: ['semana', 'semanas'] };
  return { n: n, unidad: u, ms: n * UNIDADES_DURACION[u], texto: n + ' ' + nombres[u][n === 1 ? 0 : 1] };
}

function anotarPlazo_(sol, texto) {
  var h = String(sol['Historial plazos'] || '');
  return (h ? h + '\n' : '') + fecha_(new Date()) + ' · ' + texto;
}

/** «REGISTRAR ACUERDO ALCANZADO» (el acuerdo ya existe: se negoció fuera de OficioCerca). */
function registrarAcuerdo_(oc, pro, manoObra, materiales, cantidad, unidad, nota) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Este trabajo no está asignado a ti.' };
    if (ESTADOS_PERMITEN_ACUERDO.indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no se puede registrar el acuerdo (estado: ' + sol['Estado'] + ').' };
    if (String(manoObra === undefined || manoObra === null ? '' : manoObra).trim() === '') return { ok: false, msg: 'Indica la mano de obra acordada.' };
    var mo = num_(manoObra), mat = materiales === '' || materiales === undefined || materiales === null ? 0 : num_(materiales);
    if (isNaN(mo) || mo <= 0 || isNaN(mat) || mat < 0) return { ok: false, msg: 'Revisa los importes: usa números (por ejemplo 350 o 350,50).' };
    if (mo > 1000000 || mat > 1000000) return { ok: false, msg: 'Importe demasiado alto. Revisa las cifras.' };
    var d = duracion_(cantidad, unidad);
    if (!d) return { ok: false, msg: 'Indica la duración estimada (por ejemplo 7 días).' };
    var tp = tabla_('Presupuestos');
    var previos = tp.todas().filter(function (r) { return r['Código OC'] === oc; });
    var ultimo = previos[previos.length - 1];
    if (ultimo && Number(ultimo['Mano de obra (€)']) === mo && Number(ultimo['Materiales (€)']) === mat && String(ultimo['Duración (cantidad)']) === String(d.n) &&
      String(ultimo['Duración (unidad)']) === d.unidad && Date.now() - new Date(ultimo['Fecha']).getTime() < 10 * 60000)
      return { ok: true, ya: true, msg: 'Este acuerdo ya estaba registrado.' };
    previos.forEach(function (r) { if (r['Estado'] !== 'Sustituido') tp.poner(r._fila, { 'Estado': 'Sustituido' }); });
    var ahora = new Date(), fin = new Date(ahora.getTime() + d.ms);
    var version = previos.length + 1, id = 'P-' + oc + '-v' + version;
    tp.agregar({ 'ID': id, 'Fecha': ahora, 'Código OC': oc, 'Código PRO': pro, 'Versión': version, 'Mano de obra (€)': mo, 'Materiales (€)': mat,
      'Total (€)': Math.round((mo + mat) * 100) / 100, 'Observaciones': s_(nota, 1000), 'Estado': 'Registrado', 'Registrado por': pro,
      'Política comisión': POLITICA_COMISION.version, 'Duración (cantidad)': d.n, 'Duración (unidad)': d.unidad, 'Fecha estimada fin': fin });
    actualizarSol_(sol, { 'Estado': 'Trabajo en proceso', 'Presupuesto vigente': id, 'Versión acuerdo': version, 'Fecha registro acuerdo': ahora,
      'Duración estimada': d.texto, 'Fecha estimada fin': fin, 'Mano de obra inicial (€)': mo, 'Materiales aceptados (€)': mat,
      'Historial plazos': anotarPlazo_(sol, (version > 1 ? 'Acuerdo corregido' : 'Acuerdo registrado') + ': ' + d.texto + ' → fin estimado ' + fecha_(fin)) });
    pararAccion_(sol);
    programarRevision_(fin);
    registrar_('Sistema', version > 1 ? 'Acuerdo corregido' : 'Acuerdo alcanzado registrado', oc, pro,
      id + ' · MO ' + euros_(mo) + ' · materiales ' + euros_(mat) + ' · ' + d.texto + ' · fin estimado ' + fecha_(fin));
    return { ok: true, msg: 'Acuerdo registrado. Fin estimado: ' + fecha_(fin) + '. Te recordaremos el seguimiento en esa fecha.' };
  });
}
/** Compatibilidad con llamadas antiguas (V1.5/V1.6): sin duración no se puede registrar. */
function registrarPresupuesto_(oc, pro, manoObra, materiales, obs, cantidad, unidad) { return registrarAcuerdo_(oc, pro, manoObra, materiales, cantidad, unidad, obs); }

/** «Sigue en proceso» del PROFESIONAL: nueva duración/fecha (se conserva el historial). */
function actualizarPlazo_(oc, pro, cantidad, unidad, nota) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Este trabajo no está asignado a ti.' };
    if (['Trabajo en proceso', 'Archivado por inactividad'].indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no se puede actualizar el plazo (estado: ' + sol['Estado'] + ').' };
    if (!sol['Presupuesto vigente']) return { ok: false, msg: 'Primero registra el acuerdo alcanzado.' };
    var d = duracion_(cantidad, unidad);
    if (!d) return { ok: false, msg: 'Indica cuánto tiempo más necesitas (por ejemplo 3 días).' };
    var fin = new Date(Date.now() + d.ms);
    if (sol['Estado'] === 'Archivado por inactividad') registrar_('Sistema', 'Servicio reabierto', oc, pro, 'Por el profesional');
    actualizarSol_(sol, { 'Estado': 'Trabajo en proceso', 'Fecha estimada fin': fin, 'Duración estimada': d.texto,
      'Historial plazos': anotarPlazo_(sol, 'Plazo actualizado por el profesional: +' + d.texto + ' → fin estimado ' + fecha_(fin) + (nota ? ' (' + s_(nota, 200) + ')' : '')) });
    pararAccion_(sol);
    programarRevision_(fin);
    registrar_('Sistema', 'Plazo actualizado', oc, pro, d.texto + ' · fin estimado ' + fecha_(fin));
    return { ok: true, msg: 'Plazo actualizado. Nuevo fin estimado: ' + fecha_(fin) + '.' };
  });
}

/** «Sigue en proceso» del CLIENTE: se pide al profesional que actualice el plazo. */
function clienteSigueEnProceso_(oc) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (['Trabajo en proceso', 'Archivado por inactividad', 'Finalización por confirmar'].indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no aplica (estado: ' + sol['Estado'] + ').' };
    if (sol['Estado'] !== 'Trabajo en proceso') registrar_('Sistema', sol['Estado'] === 'Archivado por inactividad' ? 'Servicio reabierto' : 'El cliente indica que aún no ha terminado', oc, sol['Profesional asignado (PRO)'], 'Por el cliente');
    actualizarSol_(sol, { 'Estado': 'Trabajo en proceso', 'Historial plazos': anotarPlazo_(sol, 'El cliente indica que el trabajo sigue en proceso') });
    iniciarAccion_(sol, 'profesional', 'actualizar_plazo');
    registrar_('Sistema', 'Cliente: el trabajo sigue en proceso', oc, sol['Profesional asignado (PRO)'], '');
    return { ok: true, msg: 'Gracias. Hemos pedido al profesional que actualice la fecha estimada.' };
  });
}

/** «MARCAR TRABAJO COMO TERMINADO» (profesional): valor FINAL de mano de obra + adicionales + motivo. */
function marcarFinalizado_(oc, pro, moFinal, adicionales, motivo, matFinal) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Este trabajo no está asignado a ti.' };
    if (sol['Estado'] === 'Finalización por confirmar') return { ok: true, ya: true, msg: 'Ya lo habías indicado. Estamos esperando la confirmación del cliente.' };
    if (['Trabajo en proceso', 'Cierre pendiente del profesional', 'Archivado por inactividad', 'Profesional asignado'].indexOf(sol['Estado']) < 0)
      return { ok: false, msg: 'Ahora no se puede cerrar este trabajo (estado: ' + sol['Estado'] + ').' };
    if (String(moFinal === undefined || moFinal === null ? '' : moFinal).trim() === '') return { ok: false, msg: 'Indica el valor final de la mano de obra.' };
    var mo = num_(moFinal), mat = matFinal === '' || matFinal === undefined || matFinal === null ? '' : num_(matFinal);
    if (isNaN(mo) || mo <= 0 || mo > 1000000 || (mat !== '' && (isNaN(mat) || mat < 0))) return { ok: false, msg: 'Revisa los importes.' };
    var inicial = sol['Mano de obra inicial (€)'] === '' ? null : Number(sol['Mano de obra inicial (€)']);
    var cambia = inicial !== null && Math.abs(mo - inicial) >= 0.01;
    var adic = adicionales === 'si' || adicionales === true || adicionales === 'Sí';
    if (cambia && !String(motivo || '').trim()) return { ok: false, msg: 'El valor final es distinto del inicial: explica brevemente el motivo.' };
    var iniciadoPor = sol['Estado'] === 'Cierre pendiente del profesional' ? 'Cliente' : 'Profesional';
    if (sol['Estado'] === 'Archivado por inactividad') registrar_('Sistema', 'Servicio reabierto', oc, pro, 'Por el profesional');
    actualizarSol_(sol, { 'Estado': 'Finalización por confirmar', 'Mano de obra final (€)': mo, 'Materiales finales (€)': mat,
      'Trabajos adicionales': adic ? 'Sí' : 'No', 'Motivo cambio valor': s_(motivo, 500), 'Cierre iniciado por': iniciadoPor });
    iniciarAccion_(sol, 'cliente', 'confirmar_cierre');
    registrar_('Sistema', 'Profesional indica trabajo finalizado', oc, pro, 'MO final ' + euros_(mo) + (inicial !== null ? ' (inicial ' + euros_(inicial) + ')' : '') + (adic ? ' · con trabajos adicionales' : ''));
    return { ok: true, msg: 'Gracias. Hemos pedido al cliente que confirme el cierre.' };
  });
}

/** «EL TRABAJO TERMINÓ» (cliente): el profesional debe registrar el valor final; después el cliente confirma. */
function clienteTerminado_(oc) {
  return conLock_(function () {
    var sol = solicitud_(oc);
    if (sol['Estado'] === 'Cierre pendiente del profesional') return { ok: true, ya: true, msg: 'Ya lo habías indicado. Estamos esperando al profesional.' };
    if (['Trabajo en proceso', 'Archivado por inactividad', 'Profesional asignado'].indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Ahora no aplica (estado: ' + sol['Estado'] + ').' };
    if (sol['Estado'] === 'Archivado por inactividad') registrar_('Sistema', 'Servicio reabierto', oc, sol['Profesional asignado (PRO)'], 'Por el cliente');
    actualizarSol_(sol, { 'Estado': 'Cierre pendiente del profesional', 'Cierre iniciado por': 'Cliente' });
    iniciarAccion_(sol, 'profesional', 'registrar_cierre');
    registrar_('Sistema', 'Cliente indica que el trabajo terminó', oc, sol['Profesional asignado (PRO)'], '');
    return { ok: true, msg: 'Gracias. Hemos pedido al profesional que registre el valor final para completar el cierre. Después te pediremos tu confirmación.' };
  });
}

/** Confirmación definitiva del CLIENTE: 'si' | 'aun_no' | 'problema'. La comisión SOLO nace con 'si'. */
function procesarFinCliente_(oc, decision, texto, grave, categoria) {
  if (decision === 'aun_no') return clienteSigueEnProceso_(oc);
  if (decision === 'problema') return reportarIncidencia_(oc, 'cliente', categoria || (grave ? 'Situación grave' : 'Otro'), texto);
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'], p = profesional_(pro);
    if (ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(sol['Estado']) >= 0) return { ok: true, ya: true, msg: 'Ya confirmaste el cierre. ¡Gracias!' };
    if (sol['Estado'] !== 'Finalización por confirmar') return { ok: false, msg: 'Ahora no hay ningún cierre pendiente de confirmar (estado: ' + sol['Estado'] + ').' };
    if (decision !== 'si') return { ok: false, msg: 'Opción no válida.' };
    var ahora = new Date();
    actualizarSol_(sol, { 'Finalizado (fecha)': ahora, 'Cliente confirmó fin (fecha)': ahora });
    pararAccion_(sol);
    registrar_('Sistema', 'Cliente confirma el cierre', oc, pro, 'MO final ' + euros_(sol['Mano de obra final (€)']));
    var c = crearObligacionComision_(sol, p, Number(sol['Mano de obra final (€)']));
    actualizarSol_(sol, { 'Estado': c && ESTADOS_COMISION_BLOQUEAN.indexOf(c.estado) >= 0 ? 'Comisión pendiente' : 'Cerrado', 'Comisión (€)': c ? c.importe : '' });
    return { ok: true, valorar: true, msg: '¡Gracias! El servicio queda cerrado. Si quieres, valóralo aquí mismo.' };
  });
}

/** Valoración 1–5: SOLO tras un cierre real confirmado (o resuelto por soporte como trabajo completo/parcial). */
function procesarValoracion_(oc, estrellas, comentario) {
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'];
    estrellas = parseInt(estrellas, 10);
    if (!(estrellas >= 1 && estrellas <= 5)) return { ok: false, msg: 'Elige de 1 a 5 estrellas.' };
    if (!sol['Cliente confirmó fin (fecha)'] || ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(sol['Estado']) < 0) return { ok: false, msg: 'Solo se puede valorar un trabajo con cierre confirmado.' };
    var tv = tabla_('Valoraciones');
    if (tv.todas().some(function (v) { return v['Código OC'] === oc; })) return { ok: true, ya: true, msg: 'Ya habíamos recibido tu valoración. ¡Gracias!' };
    tv.agregar({ 'Fecha': new Date(), 'Código OC': oc, 'Código PRO': pro, 'Estrellas': estrellas, 'Comentario': s_(comentario, 1000), 'Publicable': 'No', 'Trabajo verificado': 'Sí' });
    actualizarSol_(sol, { 'Valoración (1-5)': estrellas });
    var p = profesional_(pro);
    if (p) encolarCorreo_('pro-valoracion-' + oc, 'valoracion_pro', 'Profesional', p['Email'], oc, pro, { estrellas: estrellas, token: { tipo: 'gestion', dias: 180 } }, true);
    registrar_('Sistema', 'Valoración recibida', oc, pro, estrellas + '/5');
    // La reputación se recalcula en segundo plano (procesador de cada minuto): la respuesta al cliente no espera
    PropertiesService.getScriptProperties().setProperty('METRICAS_PENDIENTES', '1'); marcarPendiente_();
    return { ok: true, msg: '¡Gracias por tu valoración! Nos ayuda a mejorar.' };
  });
}

/* ---------- INCIDENCIAS (cliente o profesional) ---------- */

/** «HAY UN PROBLEMA / REPORTAR INCIDENCIA». Detiene cierre y cobro, no decide culpables, avisa a soporte al momento. */
function reportarIncidencia_(oc, quien, categoria, comentario) {
  return conLock_(function () {
    var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'];
    var cat = CATEGORIAS_INCIDENCIA.indexOf(categoria) >= 0 ? categoria : 'Otro';
    if (!String(comentario || '').trim()) return { ok: false, msg: 'Cuéntanos brevemente qué ha pasado.' };
    var abiertas = tabla_('Incidencias').todas().filter(function (i) { return i['Código OC'] === oc && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); });
    if (abiertas.some(function (i) { return String(i['Descripción']) === s_(comentario, 1500); })) return { ok: true, ya: true, soporte: true, msg: 'Ya habíamos registrado esta incidencia. Soporte la está revisando.' };
    if (abiertas.length >= 5) return { ok: false, msg: 'Ya hay varias incidencias abiertas en este servicio. Soporte te escribirá.' };
    var id = crearIncidencia_({ tipo: 'Incidencia', oc: oc, pro: pro, origen: quien === 'profesional' ? 'Profesional' : 'Cliente', categoria: cat,
      grave: cat === 'Situación grave', texto: comentario, sol: sol, quien: quien });
    // El servicio queda EN REVISIÓN: se detienen el cierre automático, los recordatorios y el cobro automático
    if (sol['Estado'] !== 'En revisión' && sol['Estado'] !== 'Cancelada') {
      actualizarSol_(sol, { 'Estado previo': sol['Estado'], 'Estado': 'En revisión', 'Requiere intervención': 'Incidencia ' + id });
      pararAccion_(sol);
    }
    var c = comisionDeOC_(oc);
    if (c && ['DUE', 'PAYMENT_FAILED', 'NO_HABILITADA'].indexOf(c['Estado']) >= 0) tabla_('Comisiones').poner(c._fila, { 'Estado': 'EN_REVISION', 'Notas': 'Congelada por la incidencia ' + id });
    // Aviso corto a la otra parte (no se decide quién tiene razón)
    var otra = quien === 'profesional' ? sol['Email'] : (profesional_(pro) || {})['Email'];
    if (emailOk_(otra)) encolarCorreo_('inc-parte-' + id, 'incidencia_parte', quien === 'profesional' ? 'Cliente' : 'Profesional', otra, oc, quien === 'profesional' ? '' : pro,
      quien === 'profesional' ? {} : { token: { tipo: 'gestion', dias: 180 } }, true);
    return { ok: true, soporte: true, msg: 'Hemos registrado la incidencia ' + id + '. El servicio queda en revisión y soporte ya está avisado. Si lo necesitas, escríbenos por WhatsApp.' };
  });
}

/** Mensaje general del cliente (ayuda) o sugerencia: no cambia el estado del servicio. */
function procesarComentarioCliente_(oc, tipo, categoria, texto, grave) {
  if (tipo !== 'sugerencia' && tipo !== 'ayuda') return reportarIncidencia_(oc, 'cliente', categoria, texto);
  return conLock_(function () {
    var previas = tabla_('Incidencias').todas().filter(function (i) { return i['Código OC'] === oc && /^Cliente/.test(i['Origen']); });
    if (previas.length >= 5) return { ok: false, msg: 'Ya hemos recibido varios mensajes sobre esta solicitud. Te escribiremos pronto.' };
    if (previas.some(function (i) { return String(i['Descripción']) === s_(texto, 1500); })) return { ok: true, ya: true, msg: 'Ya habíamos recibido este mensaje. ¡Gracias!' };
    var sug = tipo === 'sugerencia';
    crearIncidencia_({ tipo: sug ? 'Sugerencia' : 'Ayuda', oc: oc, pro: '', origen: sug ? 'Cliente (sugerencia)' : 'Cliente (pide ayuda)', categoria: 'Otro', grave: !!grave, texto: texto, sol: solicitud_(oc), quien: 'cliente' });
    return { ok: true, msg: sug ? '¡Gracias por tu sugerencia!' : 'Hemos recibido tu mensaje. Una persona de OficioCerca te escribirá.' };
  });
}

function crearIncidencia_(o) {
  var id = siguienteCodigo_('SEQ_INC', 'INC-');
  var esSug = o.tipo === 'Sugerencia', sol = o.sol || (o.oc ? solicitud_(o.oc) : null);
  var prioridad = o.grave ? 'Grave' : ['Daños', 'Trabajo abandonado', 'Desacuerdo económico'].indexOf(o.categoria) >= 0 ? 'Alta' : 'Normal';
  tabla_('Incidencias').agregar({ 'ID': id, 'Fecha': new Date(), 'Tipo': o.tipo, 'Código OC': o.oc || '', 'Código PRO': o.pro || '', 'Origen': o.origen,
    'Categoría': o.categoria, 'Gravedad': prioridad, 'Descripción': s_(o.texto, 1500), 'Estado': esSug ? 'Cerrada' : 'Abierta',
    'Pausa preventiva': false, 'Notas': esSug ? 'Sugerencia: no cuenta como incidencia del profesional.' : '',
    'Servicio': sol ? servicioTxt_(sol) : '', 'Cliente': sol ? sol['Nombre'] : '', 'Reportado por': o.quien === 'profesional' ? 'Profesional' : 'Cliente',
    'Estado previo servicio': sol ? sol['Estado'] : '' });
  var fila = hoja_('Incidencias').getLastRow();
  hoja_('Incidencias').getRange(fila, tabla_('Incidencias').col('Pausa preventiva')).insertCheckboxes();
  registrar_('Sistema', esSug ? 'Sugerencia recibida' : 'Incidencia creada (' + prioridad + ')', o.oc, o.pro, id + ' · ' + o.categoria);
  if (!esSug) {
    var admin = cfg_('ADMIN_EMAIL');
    if (emailOk_(admin)) encolarCorreo_('admin-inc-' + id, 'incidencia_admin', 'Administrador', admin, o.oc || '', o.pro || '',
      { id: id, categoria: o.categoria, prioridad: prioridad, quien: o.origen, texto: s_(o.texto, 600) });
  }
  return id;
}

/**
 * Resolución MANUAL de una incidencia (columna «Resultado» de la pestaña Incidencias; la llama alEditar).
 *  - TRABAJO COMPLETO: comisión sobre la mano de obra final (o «Mano de obra reconocida (€)» si se rellena) → cierre.
 *  - TRABAJO PARCIAL: comisión SOLO sobre «Mano de obra reconocida (€)» (obligatoria) → cierre.
 *  - NO HUBO TRABAJO: comisión 0 → servicio cancelado.
 *  - SIN ACUERDO: no se genera comisión; sigue en revisión manual.
 *  - OTRO: se cierra la incidencia y el servicio vuelve a su estado anterior (se reanuda el seguimiento).
 */
function resolverIncidencia_(id, resultado, usuario) {
  var ti = tabla_('Incidencias'), inc = ti.buscar('ID', id);
  if (!inc) return 'Incidencia no encontrada';
  var oc = inc['Código OC'];
  if (!oc) return 'Sin solicitud asociada';
  var sol = solicitud_(oc), pro = sol['Profesional asignado (PRO)'], p = profesional_(pro), ahora = new Date();
  var reconocida = String(inc['Mano de obra reconocida (€)']).trim() === '' ? NaN : num_(inc['Mano de obra reconocida (€)']);
  var c = comisionDeOC_(oc), out = '';
  var cerrarCon = function (mo) {
    if (c && c['Estado'] !== 'PAID') tabla_('Comisiones').poner(c._fila, { 'Estado': 'ANULADA', 'Notas': 'Sustituida por la resolución de ' + id });
    actualizarSol_(sol, { 'Mano de obra final (€)': mo, 'Finalizado (fecha)': sol['Finalizado (fecha)'] || ahora, 'Cliente confirmó fin (fecha)': sol['Cliente confirmó fin (fecha)'] || ahora });
    var nueva = crearObligacionComision_(sol, p, mo, true);
    actualizarSol_(sol, { 'Estado': nueva && ESTADOS_COMISION_BLOQUEAN.indexOf(nueva.estado) >= 0 ? 'Comisión pendiente' : 'Cerrado', 'Comisión (€)': nueva ? nueva.importe : '', 'Requiere intervención': '' });
    return 'comisión ' + euros_(nueva ? nueva.importe : 0) + ' sobre ' + euros_(mo);
  };
  if (resultado === 'RESUELTO — TRABAJO COMPLETO') {
    var mo = !isNaN(reconocida) && reconocida > 0 ? reconocida : Number(sol['Mano de obra final (€)']) || Number(sol['Mano de obra inicial (€)']) || 0;
    if (!(mo > 0)) return 'Falta la mano de obra: rellena «Mano de obra reconocida (€)»';
    out = 'Trabajo completo · ' + cerrarCon(mo);
  } else if (resultado === 'RESUELTO — TRABAJO PARCIAL') {
    if (!(reconocida > 0)) return 'Para trabajo parcial rellena antes «Mano de obra reconocida (€)»';
    out = 'Trabajo parcial · ' + cerrarCon(reconocida);
  } else if (resultado === 'CANCELADO — NO HUBO TRABAJO') {
    if (c && c['Estado'] !== 'PAID') tabla_('Comisiones').poner(c._fila, { 'Estado': 'ANULADA', 'Notas': 'No hubo trabajo (' + id + ')' });
    actualizarSol_(sol, { 'Estado': 'Cancelada', 'Motivo cierre': 'No hubo trabajo (' + id + ')', 'Requiere intervención': '' });
    out = 'Cancelado · comisión 0';
  } else if (resultado === 'SIN ACUERDO / REVISIÓN MANUAL') {
    actualizarSol_(sol, { 'Estado': 'En revisión', 'Requiere intervención': 'Sin acuerdo: revisión manual (' + id + ')' });
    ti.poner(inc._fila, { 'Estado': 'En revisión', 'Administrador': usuario || '' });
    registrar_('Admin', 'Incidencia sin acuerdo: revisión manual', oc, pro, id, usuario);
    return 'Sin acuerdo: queda en revisión manual (sin comisión automática)';
  } else if (resultado === 'OTRO') {
    var previo = inc['Estado previo servicio'] && ESTADOS_SOLICITUD.indexOf(inc['Estado previo servicio']) >= 0 ? inc['Estado previo servicio'] : 'Trabajo en proceso';
    if (previo === 'En revisión') previo = 'Trabajo en proceso';
    if (c && c['Estado'] === 'EN_REVISION') tabla_('Comisiones').poner(c._fila, { 'Estado': c['Ambiente'] === 'NO_HABILITADO' ? 'NO_HABILITADA' : 'DUE', 'Notas': 'Reanudada tras ' + id });
    actualizarSol_(sol, { 'Estado': previo, 'Requiere intervención': '' });
    out = 'Seguimiento reanudado (' + previo + ')';
  } else return 'Resultado no válido';
  ti.poner(inc._fila, { 'Estado': 'Resuelta', 'Fecha resolución': ahora, 'Administrador': usuario || '', 'Acción tomada': out });
  registrar_('Admin', 'Incidencia resuelta: ' + resultado, oc, pro, id + ' · ' + out, usuario);
  [['Cliente', sol['Email'], ''], ['Profesional', p && p['Email'], pro]].forEach(function (d) {
    if (emailOk_(d[1])) encolarCorreo_('inc-res-' + id + '-' + d[0], 'incidencia_resuelta', d[0], d[1], oc, d[2], d[0] === 'Profesional' ? { resultado: resultado, token: { tipo: 'gestion', dias: 180 } } : { resultado: resultado }, true);
  });
  return out;
}

/** Métricas internas por profesional (derivadas: se recalculan desde los datos, sin desajustes). */
function recalcularMetricas_() {
  var tp = tabla_('Profesionales'), pros = tp.todas();
  if (!pros.length) return;
  var ofertas = tabla_('Ofertas').todas(), vals = tabla_('Valoraciones').todas(), incs = tabla_('Incidencias').todas();
  var sols = tabla_('Solicitudes').todas(), coms = tabla_('Comisiones').todas();
  var cols = ['Ofertas recibidas', 'Respuestas', 'Aceptadas', 'Asignaciones', 'Completados', 'Tiempo medio respuesta (h)', 'Valoración media',
    'Nº valoraciones', 'Incidencias verificadas', 'Comisiones pendientes', 'Última oferta'];
  var colsRep = ['Tasa respuesta (%)', 'Cumplimiento seguimiento (%)'];
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
      sols.filter(function (s) { return s['Profesional asignado (PRO)'] === code && !!s['Cliente confirmó fin (fecha)'] && ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(s['Estado']) >= 0; }).length,
      tiempos.length ? Math.round(tiempos.reduce(function (a, b) { return a + b; }, 0) / tiempos.length * 10) / 10 : '',
      v.length ? Math.round(v.reduce(function (a, x) { return a + Number(x['Estrellas']); }, 0) / v.length * 10) / 10 : '',
      v.length,
      incs.filter(function (i) { return i['Código PRO'] === code && i['Tipo'] === 'Incidencia' && /Resuelta|Verificada/.test(i['Estado']) && /PARCIAL|NO HUBO/.test(String(i['Resultado'])); }).length,
      coms.filter(function (c) { return c['Código PRO'] === code && ESTADOS_COMISION_BLOQUEAN.indexOf(c['Estado']) >= 0; }).length,
      ultima ? new Date(ultima) : ''];
  });
  // Escritura por bloques contiguos (las filas pueden no ser consecutivas si hay huecos)
  pros.forEach(function (p, i) { tp.sh.getRange(p._fila, c0, 1, cols.length).setValues([valores[i]]); });
  // Reputación: tasa de respuesta a oportunidades y cumplimiento del seguimiento (servicios con acuerdo que NO acabaron
  // archivados ni escalados por inacción del profesional). Vacío si aún no hay datos (profesional nuevo = neutro).
  var c1 = tp.col(colsRep[0]);
  pros.forEach(function (p) {
    var code = p['Código'], of = ofertas.filter(function (o) { return o['Código PRO'] === code; });
    var cerradasOf = of.filter(function (o) { return o['Estado'] !== 'Enviada'; });
    var resp = cerradasOf.filter(function (o) { return /Puede|No puede/.test(o['Respuesta']); }).length;
    var trab = sols.filter(function (s) { return s['Profesional asignado (PRO)'] === code && s['Fecha registro acuerdo']; });
    var malos = trab.filter(function (s) { return /profesional|ambos/.test(String(s['Escalado por'])); }).length;
    tp.sh.getRange(p._fila, c1, 1, 2).setValues([[cerradasOf.length ? Math.round(resp / cerradasOf.length * 100) : '', trab.length ? Math.round((1 - malos / trab.length) * 100) : '']]);
  });
  _tablas['Profesionales'] && (_tablas['Profesionales']._cache = null);
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

/** diferir=true: solo lo deja «En cola» (lo envía el procesador de cada minuto). */
function encolarCorreo_(clave, tipo, rol, correo, oc, pro, datos, diferir) {
  var th = tabla_('Historial envíos');
  var ya = th.todas().filter(function (r) { return r['Clave'] === clave; })[0];
  if (ya) return ya['Estado'];
  if (!emailOk_(correo)) {
    th.agregar({ 'ID': 'M-' + Date.now(), 'Fecha': new Date(), 'Clave': clave, 'Tipo': tipo, 'Destinatario': rol, 'Correo': s_(correo, 160), 'Código OC': oc, 'Código PRO': pro,
      'Estado': 'Fallido', 'Intentos': 0, 'Último error': 'Correo no válido', 'Datos': JSON.stringify(datos || {}) });
    return 'Fallido';
  }
  var fila = th.agregar({ 'ID': 'M-' + Utilities.getUuid().slice(0, 8), 'Fecha': new Date(), 'Clave': clave, 'Tipo': tipo, 'Destinatario': rol, 'Correo': correo,
    'Código OC': oc, 'Código PRO': pro, 'Estado': diferir ? 'En cola' : 'Pendiente por cuota', 'Intentos': 0, 'Datos': JSON.stringify(datos || {}) });
  if (diferir) { marcarPendiente_(); return 'En cola'; }
  return enviarFila_(fila);
}

/** Intenta enviar una fila de la cola. */
function enviarFila_(fila) {
  var th = tabla_('Historial envíos');
  var r = th.todas().filter(function (x) { return x._fila === fila; })[0];
  if (!r || r['Estado'] === 'Enviado' || r['Estado'] === 'Fallido') return r ? r['Estado'] : '';
  var esAlerta = r['Destinatario'] === 'Administrador';
  var datosFila = {}; try { datosFila = JSON.parse(r['Datos'] || '{}'); } catch (e) { }
  var reserva = esAlerta ? 0 : prioridadCorreo_(r['Tipo'], datosFila) === 2 ? cfgNum_('CUOTA_RESERVA_BAJA', 15) : cfgNum_('CUOTA_RESERVA', 3);
  var cuota = MailApp.getRemainingDailyQuota();
  if (cuota < 1 + reserva) { th.poner(fila, { 'Estado': 'Pendiente por cuota', 'Último error': 'Cuota insuficiente (' + cuota + ')' }); return 'Pendiente por cuota'; }
  var intentos = Number(r['Intentos'] || 0) + 1;
  try {
    var datos = JSON.parse(r['Datos'] || '{}');
    if (datos.token) datos.url = urlToken_(datos.token, r['Código OC'], r['Código PRO']);
    // V1.5: todo correo al cliente lleva su enlace privado de seguimiento (solo su solicitud)
    if (r['Destinatario'] === 'Cliente' && r['Código OC']) datos.urlSeg = urlToken_({ tipo: 'seguimiento', dias: 365 }, r['Código OC'], '');
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
  // Primero alertas y prioridad alta; si la cuota no alcanza, el resto espera en cola (nunca se pierde)
  var pend = th.todas().filter(function (r) { return r['Estado'] === 'Pendiente por cuota' || r['Estado'] === 'En cola'; });
  var peso = function (r) { if (r['Destinatario'] === 'Administrador') return 0; var d = {}; try { d = JSON.parse(r['Datos'] || '{}'); } catch (e) { } return prioridadCorreo_(r['Tipo'], d); };
  pend.sort(function (a, b) { return peso(a) - peso(b) || a._fila - b._fila; });
  pend.forEach(function (r) { enviarFila_(r._fila); });
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
  return String(cfg_('URL_WEB') || 'https://oficiocerca.pages.dev/').replace(/\/?$/, '/') + (spec.tipo === 'seguimiento' ? 'seguimiento/#' : 'gestion/#') + t;
}
/** Devuelve el registro del token si es válido (no caducado). */
function leerToken_(t) {
  if (!/^[a-f0-9]{64}$/.test(String(t || ''))) return null;
  var r = tabla_('Tokens').buscarRapido('Hash', hash_(t));
  if (!r) return null;
  r.caducado = (r['Expira'] && new Date(r['Expira']).getTime() < Date.now()) || r['Resultado'] === 'Revocado';
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

/* «EL CORREO AVISA. LA PLATAFORMA REGISTRA.»
 * Formato único: asunto claro · 1 frase de qué pasó · 1 frase de qué hacer · 1 botón · como mucho una nota corta.
 * La información extensa vive en el Centro de ayuda y en el seguimiento. Cada correo = 1 destinatario (1 unidad de cuota).
 * Prioridad 1 (alta): incidencias, asignación/contacto, oportunidades, cierre, comisión y pagos, confirmación de solicitud.
 * Prioridad 2 (baja): recordatorios no críticos, valoraciones, avisos informativos. Con poca cuota esperan en cola.
 */
var CORREOS_RETIRADOS_V16 = ['solicitud_cubierta', 'presupuesto_cliente', 'presupuesto_aceptado_pro', 'presupuesto_rechazado_pro', 'presupuesto_hablar_pro',
  'buen_trabajo_pro', 'comision_exigible_sbx', 'acuerdo_cliente', 'recordatorio_acuerdo', 'fin_cliente', 'recordatorio_fin', 'acuerdo_confirmado_pro',
  'acuerdo_no_confirmado_pro', 'aun_no_pro', 'recordatorio_acuerdo_pro'];
var PRIORIDAD_BAJA = ['recordatorio_comision', 'valorar_cliente', 'valoracion_pro', 'condiciones_pro', 'alta_activada', 'resumen_diario', 'incidencia_resuelta'];
function prioridadCorreo_(tipo, datos) {
  if (tipo === 'seguimiento') return datos && datos.n > 0 && datos.plantilla === 'vencimiento' ? 2 : 1;
  return PRIORIDAD_BAJA.indexOf(tipo) >= 0 ? 2 : 1;
}

function datosProTxt_(p) { return p ? p['Nombre'] + (p['Empresa / autónomo'] ? ' · ' + p['Empresa / autónomo'] : '') : ''; }
function fechaAcordadaTxt_(v) { var f = fechaIso_(v); return /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.split('-').reverse().join('/') : 'Sin fecha concreta'; }
function prefijoPrueba_(c) { return c && c['Ambiente'] === 'SANDBOX' ? '[PRUEBA / SANDBOX] ' : ''; }

/** Correo corto estándar. */
function corto_(asunto, titulo, pasa, haz, url, boton, nota, color) {
  var b = [p_(pasa)];
  if (haz) b.push('<p><b>' + esc_(haz) + '</b></p>');
  if (url) b.push('<div style="text-align:center;margin:18px 0">' + boton_(url, boton, color) + '</div>');
  if (nota) b.push('<p style="color:#586374;font-size:14px">' + esc_(nota) + '</p>');
  var html = plantilla_(titulo, '', b);
  return { asunto: asunto, html: html, texto: texto_(html), adjuntos: [] };
}

/** Compone un correo a partir de los datos ACTUALES de la hoja. Devuelve null si ya no aplica (acción hecha → no sale). */
function componer_(tipo, oc, pro, d) {
  if (CORREOS_RETIRADOS_V16.indexOf(tipo) >= 0) return null;
  var sol = oc ? solicitud_(oc) : null, p = pro ? profesional_(pro) : null;
  var A = '[OficioCerca] ', AP = '[OficioCerca Profesionales] ';
  var com = oc ? comisionDeOC_(oc) : null, seg = d.urlSeg, gest = d.url;
  switch (tipo) {
    /* ---------------- CLIENTE ---------------- */
    case 'confirmacion_cliente':
      return corto_('Recibimos tu solicitud ' + oc, 'Recibimos tu solicitud ' + oc,
        'Recibimos tu solicitud de ' + servicioTxt_(sol) + ' y estamos buscando un profesional compatible.', '', seg, 'VER SEGUIMIENTO',
        'Guarda este correo: el botón abre tu seguimiento privado (sin cuenta). No ofrecemos urgencias 24 h.');
    case 'asignado_cliente':
      if (!p) return null;
      return corto_('Ya encontramos un profesional · ' + oc, 'Ya encontramos un profesional',
        datosProTxt_(p) + ' se pondrá en contacto contigo directamente. Los acuerdos se realizan directamente entre vosotros.',
        'Conserva tu seguimiento para confirmar el cierre o reportar cualquier problema.', seg, 'VER MI SEGUIMIENTO');
    case 'respaldo_cliente':
      var of = tabla_('Ofertas').buscar('ID', d.token.ref);
      if (!of || sol['Estado'] !== 'Esperando decisión cliente') return null;
      return corto_('Hay un profesional disponible más adelante · ' + oc, 'Necesitamos tu decisión',
        'El profesional más próximo puede atenderte aproximadamente: ' + of['Disponibilidad'] + '.', 'Elige si continúas, seguimos buscando o cancelas.', d.url, 'ELEGIR UNA OPCIÓN');
    case 'sin_profesional':
      if (sol['Estado'] !== 'Sin profesional disponible') return null;
      return corto_('Aún no hay profesional disponible · ' + oc, 'Por ahora no encontramos profesional',
        'Por ahora no encontramos un profesional compatible para tu solicitud ' + oc + '.', 'Puedes conservarla y volver a intentar la búsqueda desde tu seguimiento.', seg, 'VOLVER A BUSCAR');
    case 'valorar_cliente':
      if (ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(sol['Estado']) < 0 || tabla_('Valoraciones').todas().some(function (v) { return v['Código OC'] === oc; })) return null;
      return corto_('¿Qué tal fue el servicio? · ' + oc, 'Valora el servicio', 'El servicio ' + oc + ' está cerrado.', 'Valóralo en un minuto (de 1 a 5 estrellas).', seg, 'VALORAR');

    /* ---------------- SEGUIMIENTO (cliente o profesional según «Acción pendiente de») ---------------- */
    case 'seguimiento':
      if (!sol['Acción desde'] || new Date(sol['Acción desde']).getTime() !== Number(d.desde) || sol['Plantilla seguimiento'] !== d.plantilla) return null; // ya respondieron
      var esCli = !pro || !gest, url = esCli ? seg : gest, ult = d.ultimo ? 'Último recordatorio: ' : (d.n > 0 ? 'Recordatorio: ' : '');
      var notaUlt = d.ultimo ? (sol['Acción pendiente de'] === 'ambos' ? 'Si no recibimos respuesta, el seguimiento quedará archivado por inactividad.' : 'Si no recibimos respuesta, el servicio pasará a revisión manual.') : '';
      if (d.plantilla === 'vencimiento') return corto_((d.ultimo ? 'Último recordatorio: ' : '') + 'Indica el estado del servicio ' + oc, 'Llegó la fecha estimada',
        d.ultimo ? 'Último recordatorio: necesitamos conocer el estado del servicio ' + oc + '.' : 'Llegó la fecha estimada de finalización del servicio ' + oc + '.',
        esCli ? 'Indica su estado: terminado, sigue en proceso o hay un problema.' : 'Indica su estado: terminado o sigue en proceso (con el nuevo plazo).', url, 'INDICAR ESTADO', notaUlt);
      if (d.plantilla === 'actualizar_plazo') return corto_(ult + 'Actualiza el plazo de ' + oc, 'El cliente indica que sigue en proceso',
        'El cliente indica que el servicio ' + oc + ' sigue en proceso.', 'Registra la nueva duración estimada.', url, 'ACTUALIZAR PLAZO', notaUlt);
      if (d.plantilla === 'confirmar_cierre') return corto_(ult + 'Confirma el cierre de ' + oc, 'Confirma el cierre',
        'El profesional indicó que el servicio ' + oc + ' terminó.', 'Confirma el cierre (o indica «Todavía no» o «Hay un problema»).', url, 'CONFIRMAR CIERRE', notaUlt);
      if (d.plantilla === 'registrar_cierre') return corto_(ult + 'Registra el valor final de ' + oc, 'El cliente indica que el trabajo terminó',
        'El cliente indicó que el trabajo de ' + oc + ' terminó.', 'Registra el valor final de la mano de obra para completar el cierre.', url, 'REGISTRAR VALOR FINAL', notaUlt);
      if (d.plantilla === 'registrar_acuerdo') return corto_(ult + 'Registra el acuerdo de ' + oc, '¿Ya acordaste el trabajo?',
        'Tienes el contacto del cliente de ' + oc + ' desde el ' + dia_(sol['Fecha asignación']) + '.', 'Cuando lleguéis a un acuerdo, registra la mano de obra y la duración estimada.', url, 'REGISTRAR ACUERDO ALCANZADO', notaUlt);
      return null;

    /* ---------------- PROFESIONAL ---------------- */
    case 'oferta_profesional':
      if (!p) return null;
      var adj = fotos_(sol['Carpeta fotos (ID)']);
      var b = [p_(/mismo profesional/i.test(sol['Origen servicio'] || '') ? 'Un cliente con el que ya trabajaste te pide otro servicio.' : 'Tienes una oportunidad compatible con tu oficio y zona.'),
        tabla_html_([['Solicitud', oc], ['Servicio', servicioTxt_(sol)], ['Zona', sol['Zona'] + ' (Córdoba)'], ['Plazo del cliente', plazoTxt_(sol)],
          ['Cliente', sol['Tipo solicitante'] || 'Particular'], ['Fotos', adj.length ? adj.length + ' adjunta(s)' : 'Sin fotos'], ['Descripción', String(sol['Descripción']).slice(0, 600)]]),
        '<p><b>Responde antes del ' + esc_(fecha_(d.expira)) + '.</b></p>',
        '<div style="text-align:center;margin:18px 0">' + boton_(d.url, 'RESPONDER A ESTA OPORTUNIDAD') + '</div>',
        '<p style="color:#586374;font-size:14px">Sin datos del cliente hasta que aceptes. Rechazarla no tiene coste. Ficha confidencial.</p>'];
      var hO = plantilla_('Nueva oportunidad · ' + oc, '', b);
      return { asunto: AP + 'Nueva oportunidad ' + oc + ' · ' + servicioTxt_(sol) + ' · ' + sol['Zona'], html: hO, texto: texto_(hO), adjuntos: adj };
    case 'contacto_profesional':
      if (!p) return null;
      var bc = [p_('Te asignamos ' + oc + ' (' + servicioTxt_(sol) + '). Estos son los datos del cliente:'),
        tabla_html_([['Cliente', sol['Nombre'] + (sol['Empresa'] ? ' · ' + sol['Empresa'] : '')], ['WhatsApp', limpio_(sol['WhatsApp'])]]
          .concat(limpio_(sol['Teléfono alt.']) ? [['Otro teléfono', limpio_(sol['Teléfono alt.'])]] : [])
          .concat([['Correo', sol['Email']], ['Prefiere', sol['Contacto preferido (para el profesional)']], ['Zona / CP', sol['Zona'] + (limpio_(sol['Código postal']) ? ' · ' + limpio_(sol['Código postal']) : '')]])),
        destacado_('Recibir el contacto inicia el trabajo en OficioCerca. Después de hablar con el cliente y llegar a un acuerdo, vuelve a la plataforma para registrar el valor acordado y la duración estimada. Mantener actualizado el seguimiento hasta el cierre forma parte del proceso.'),
        '<div style="text-align:center;margin:18px 0">' + boton_(d.url, 'GESTIONAR ESTE TRABAJO') + '</div>',
        '<p style="color:#586374;font-size:14px">Usa estos datos solo para este servicio.</p>'];
      var hC = plantilla_('Cliente asignado · ' + oc, '', bc);
      return { asunto: AP + 'Cliente asignado: datos de contacto · ' + oc, html: hC, texto: texto_(hC), adjuntos: [] };
    case 'comision_exigible':
    case 'recordatorio_comision':
      if (!p || !com || ['DUE', 'PAYMENT_FAILED', 'PAYMENT_PENDING'].indexOf(com['Estado']) < 0) return null;
      return corto_(AP + prefijoPrueba_(com) + (tipo === 'recordatorio_comision' ? 'Recordatorio: ' : '') + 'Comisión pendiente · ' + oc, prefijoPrueba_(com) + 'Comisión pendiente',
        'El cliente confirmó el cierre de ' + oc + '. Comisión: ' + euros_(com['Importe comisión (€)']) + ' (sobre ' + euros_(com['Mano de obra (€)']) + ' de mano de obra; materiales excluidos).',
        'Págala para seguir recibiendo nuevas oportunidades.', urlPagoComision_(oc, pro), com['Ambiente'] === 'SANDBOX' ? 'PAGAR COMISIÓN (SANDBOX)' : 'PAGAR COMISIÓN',
        com['Ambiente'] === 'SANDBOX' ? 'PRUEBA / SANDBOX: sin dinero real.' : 'Tu cuenta, tu historial y tus trabajos en curso no cambian.', com['Ambiente'] === 'SANDBOX' ? '#7B1FA2' : '');
    case 'pago_aprobado_pro':
      if (!p || !com || com['Estado'] !== 'PAID') return null;
      return corto_(AP + prefijoPrueba_(com) + 'Pago recibido · ' + oc, 'Pago confirmado', 'Recibimos el pago de la comisión de ' + oc + ' (' + euros_(com['Importe comisión (€)']) + ').',
        'Vuelves a recibir oportunidades.', d.url, 'VER EL TRABAJO');
    case 'pago_rechazado_pro':
      if (!p || !com || com['Estado'] !== 'PAYMENT_FAILED') return null;
      return corto_(AP + prefijoPrueba_(com) + 'El pago no se completó · ' + oc, 'El pago no se completó', 'Wompi no aprobó el pago de la comisión de ' + oc + '. No se cobró nada.',
        'Puedes intentarlo de nuevo.', urlPagoComision_(oc, pro), 'INTENTAR DE NUEVO');
    case 'valoracion_pro':
      if (!p) return null;
      return corto_(AP + 'Nueva valoración · ' + oc, 'Nueva valoración', 'Recibiste una nueva valoración de ' + d.estrellas + ' estrella' + (d.estrellas === 1 ? '' : 's') + ' en ' + oc + '.',
        '', d.url, 'VER MI REPUTACIÓN');
    case 'condiciones_pro':
      if (!p || condAlDia_(p)) return null;
      return corto_(AP + 'Nuevas condiciones ' + condVigente_(), 'Nuevas condiciones para profesionales',
        'Actualizamos las condiciones: acuerdo y precio fuera de OficioCerca, seguimiento hasta el cierre y comisión sobre la mano de obra final (10 % hasta 2.000 € + 5 % del exceso, sin materiales).',
        'Acéptalas para seguir recibiendo nuevas oportunidades.', d.url, 'LEER Y ACEPTAR', 'Tus trabajos e historial no cambian.');
    case 'registro_profesional':
      if (!p) return null;
      return corto_(AP + 'Hemos recibido tu registro ' + pro, 'Registro recibido · ' + pro, 'Recibimos tu registro (' + p['Servicios'] + ').', 'Te avisaremos cuando tu alta esté activa.', '', '', 'Condiciones aceptadas: ' + p['Condiciones (versión)']);
    case 'alta_activada':
      if (!p) return null;
      return corto_(AP + 'Tu alta está activa · ' + pro, 'Ya puedes recibir oportunidades', 'Tu alta en OficioCerca está activa.', 'Las oportunidades compatibles te llegarán a este correo con un botón para responder.', urlAyuda_('profesional'), 'CÓMO FUNCIONA');

    /* ---------------- INCIDENCIAS ---------------- */
    case 'incidencia_parte':
      return corto_((pro ? AP : A) + 'Incidencia registrada · ' + oc, 'Incidencia registrada', 'Se registró una incidencia en el servicio ' + oc + '. El servicio queda en revisión.',
        'Soporte la revisará y os contactará. No hace falta que hagas nada ahora.', pro ? d.url : seg, 'VER EL SERVICIO');
    case 'incidencia_resuelta':
      return corto_((pro ? AP : A) + 'Incidencia resuelta · ' + oc, 'Incidencia resuelta', 'Soporte registró el resultado de la incidencia de ' + oc + ': ' + String(d.resultado || '').replace(/ — /g, ': ').toLowerCase() + '.',
        '', pro ? d.url : seg, 'VER EL SERVICIO');
    case 'incidencia_admin':
      var urlHoja = ''; try { urlHoja = ss_().getUrl() + '#gid=' + hoja_('Incidencias').getSheetId(); } catch (e) { }
      var hI = plantilla_('Nueva incidencia — ' + (oc || d.id), '', [tabla_html_([['Incidencia', d.id], ['Solicitud', oc || '—'], ['Tipo', d.categoria], ['Prioridad', d.prioridad],
        ['Reportó', d.quien], ['Resumen', d.texto]]), urlHoja ? '<div style="text-align:center">' + boton_(urlHoja, 'REVISAR INCIDENCIA') + '</div>' : '',
        p_('Resultado: rellena «Resultado» en la pestaña Incidencias (y «Mano de obra reconocida (€)» si fue parcial).')], 'Aviso interno de OficioCerca');
      return { asunto: '⚠ Nueva incidencia — ' + (oc || d.id), html: hI, texto: texto_(hI), adjuntos: [] };

    /* ---------------- ADMINISTRADOR ---------------- */
    case 'alerta_admin':
      return { asunto: '[OficioCerca · ' + d.categoria + '] ' + d.asunto, html: plantilla_(d.asunto, '', ['<pre style="white-space:pre-wrap;font-family:inherit">' + esc_(d.texto) + '</pre>'], 'Alerta automática de OficioCerca'), texto: d.asunto + '\n\n' + d.texto };
    case 'resumen_diario':
      return { asunto: '[OficioCerca · Resumen diario] ' + d.fecha, html: plantilla_('Resumen diario · ' + d.fecha, '', [d.html], 'Un único resumen al día'), texto: texto_(d.html) };
    default:
      throw new Error('Plantilla desconocida: ' + tipo);
  }
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
  var tp = e && e.parameter && (e.parameter.wpago || e.parameter.wsbx);
  if (tp) { try { return paginaPago_(String(tp)); } catch (err) { errorSistema_('paginaPago', err); return html_('Algo ha fallado', '<p>No hemos podido abrir la página de pago. Inténtalo de nuevo en unos minutos.</p>'); } }
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
    '.stars input:checked+span{background:#13253D;color:#F2A65A;border-color:#13253D}.hide{display:none}' +
    '.prog{list-style:none;padding:0;margin:14px 0}.prog li{padding:8px 10px;border-left:4px solid #DED6C8;margin:4px 0}.prog .hecho{border-color:#2E7D4F}.prog .ahora{border-color:#F2A65A;font-weight:bold;background:#FFF4E5}.prog .pend{color:#8B95A3}a.btn{text-decoration:none}' +
    '.panel4{background:#F6F2EB;border-radius:12px;padding:10px 16px;margin:10px 0}.panel4 p{margin:6px 0}.servicios{padding-left:18px}.servicios li{margin:6px 0}.servicios .actual{font-weight:bold}' +
    '.mini{border:2px solid #13253D;background:#fff;color:#13253D;border-radius:8px;padding:4px 10px;font-weight:bold;cursor:pointer}details.hist{margin:10px 0}details.hist summary{cursor:pointer;font-weight:bold}.fila2{display:flex;gap:10px;align-items:center}.fila2>*{flex:1}';
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
  var unUso = ['oferta', 'respaldo'].indexOf(tipo) >= 0;
  if (unUso && tok['Usado']) return html_('Respuesta ya registrada', '<div class="ok">Ya habíamos registrado tu respuesta: ' + esc_(tok['Resultado'] || '') + '</div>');
  if (tok.caducado) return html_('Enlace caducado', '<p>Este enlace ya no está vigente' + (tipo === 'oferta' ? ': el plazo para responder a esta oportunidad terminó y la ofrecimos a otro profesional.' : '.') + '</p><p>Si necesitas algo, escríbenos.</p>');

  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  if (tipo === 'oferta') {
    var of = tabla_('Ofertas').buscar('ID', tok['Referencia']);
    if (!of || of['Estado'] !== 'Enviada') return html_('Oportunidad cerrada', '<p>Esta oportunidad ya no está abierta. ¡Gracias!</p>');
    var opts = Object.keys(DISP_PRO).filter(function (k) { return k !== 'OTRA_FECHA'; }).map(function (k) { return '<option value="' + k + '">' + esc_(DISP_PRO[k].t) + '</option>'; }).join('');
    return html_('Oportunidad ' + oc, filas_([['Servicio', servicioTxt_(sol)], ['Zona / barrio', sol['Zona'] + ' (Córdoba)'],
      ['Plazo que pide el cliente', plazoTxt_(sol)], ['Descripción', sol['Descripción']], ['Responde antes de', fecha_(of['Expira'])]]) +
      '<p class="nota">Aceptar significa: «Estoy interesado y tengo disponibilidad para contactar al cliente». Al aceptar recibirás su contacto: eso inicia el trabajo en OficioCerca. Precio y condiciones los acordáis directamente. Recibir o rechazar oportunidades no tiene coste.</p>' +
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
  if (tipo === 'presupuesto' || tipo === 'fin' || tipo === 'cliente') {
    // Enlaces de V1.5: llevan ahora al seguimiento de ese servicio (mismas acciones, solo las válidas)
    return paginaSeguimiento_(t, oc);
  }
  if (tipo === 'seguimiento') return paginaSeguimiento_(t, oc);
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
  if (tipo === 'gestion') return paginaGestion_(t, oc, pro);
  if (tipo === 'pago_comision' || tipo === 'pago_sbx') return paginaPago_(t);
  if (tipo === 'condiciones') {
    var pc = profesional_(pro), urlCond = String(cfg_('URL_WEB') || 'https://oficiocerca.pages.dev/').replace(/\/?$/, '/') + 'condiciones-profesionales/';
    if (!pc) return html_('Enlace no válido', '<p>Profesional no encontrado.</p>');
    if (condAlDia_(pc)) return html_('Condiciones aceptadas', '<div class="ok">Ya aceptaste la versión vigente (' + esc_(condVigente_()) + '). No tienes que hacer nada más.</div>');
    return html_('Nuevas condiciones ' + condVigente_(), '<div class="panel4"><p><b>Precio y acuerdo:</b> los negocias directamente con el cliente, fuera de OficioCerca. Después registras aquí el acuerdo alcanzado (mano de obra y duración estimada).</p>' +
      '<p><b>Seguimiento:</b> recibir el contacto inicia el trabajo en OficioCerca; mantenerlo actualizado hasta el cierre forma parte del proceso. Si no se actualiza de forma reiterada, puede influir en tu prioridad para nuevas oportunidades.</p>' +
      '<p><b>Comisión:</b> 10 % de los primeros 2.000 € de mano de obra y 5 % del exceso, sin tope, sobre la mano de obra FINAL confirmada por el cliente. Los materiales nunca cuentan. Registrarte, recibir o rechazar oportunidades: sin coste.</p>' +
      '<p><b>Incidencias y comisión pendiente:</b> una incidencia no te bloquea automáticamente. Una comisión exigible sin pagar impide recibir NUEVAS oportunidades hasta pagarla, sin borrar tu cuenta, tu historial ni tus trabajos.</p></div>' +
      '<p><a href="' + esc_(urlCond) + '" target="_blank" rel="noopener">Leer las condiciones completas</a></p>' +
      '<button class="btn" onclick="enviar({a:\'aceptar\'})">✔ He leído y acepto las condiciones ' + esc_(condVigente_()) + '</button>', t);
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
    var unUso = ['oferta', 'respaldo'].indexOf(tipo) >= 0;
    if (unUso && tok['Usado']) return { ok: true, ya: true, msg: 'Ya habíamos registrado tu respuesta: ' + tok['Resultado'] };
    switch (tipo) {
      case 'oferta': r = procesarRespuestaOferta_(tok['Referencia'], p.a, p.disp, p.fecha, p.nota); break;
      case 'respaldo': r = procesarDecisionRespaldo_(tok['Referencia'], p.a); break;
      case 'presupuesto': case 'fin': case 'cliente': r = accionSeguimiento_(oc, p); break;
      case 'condiciones': if (p.a === 'aceptar') r = aceptarCondiciones_(pro); break;
      case 'valorar':
        if (p.a === 'valorar') r = procesarValoracion_(oc, p.estrellas, p.comentario);
        else if (p.a === 'problema') r = procesarComentarioCliente_(oc, 'problema', p.categoria, p.texto, p.grave === true);
        else if (p.a === 'sugerencia') r = procesarComentarioCliente_(oc, 'sugerencia', 'Sugerencia para OficioCerca', p.texto, false);
        break;
      case 'gestion': r = accionGestion_(oc, pro, p); break;
      case 'seguimiento': r = accionSeguimiento_(oc, p); break;
    }
    if (!r) return { ok: false, msg: 'Acción no válida.' };
    if (r.ok && unUso && !r.noConsume) marcarToken_(tok, r.msg);
    if (r.ok) marcarPendiente_(); // el panel y la cola se actualizan en segundo plano (respuesta más rápida)
    return { ok: !!r.ok, msg: r.msg, t: r.t || undefined, url: r.url || undefined };
  } catch (err) {
    errorSistema_('accion', err);
    return { ok: false, msg: 'Ha ocurrido un error. Inténtalo de nuevo en unos minutos.' };
  }
}

/* ---------- espacio del PROFESIONAL para un trabajo (token 'gestion') ---------- */
function paginaGestion_(t, oc, pro) {
  var sol = solicitud_(oc), estado = sol['Estado'], com = comisionDeOC_(oc);
  if (sol['Profesional asignado (PRO)'] !== pro) return html_('Trabajo ' + oc, '<p>Este trabajo ya no está asignado a ti.</p>');
  var p = profesional_(pro);
  var h = resumenV16_(sol, com, 'pro') + lineaProgresoV16_(sol, com, 'pro');
  var estPro = { 'Profesional asignado': 'Contacto habilitado · falta registrar el acuerdo alcanzado', 'Finalización por confirmar': 'Cierre registrado · pendiente de la confirmación del cliente',
    'Comisión pendiente': 'Terminado · comisión pendiente', 'Cierre pendiente del profesional': 'El cliente indica que terminó · registra el valor final' }[estado];
  h += '<h2>Datos del trabajo</h2>' + filas_([['Servicio', servicioTxt_(sol)], ['Cliente', sol['Nombre']], ['WhatsApp del cliente', limpio_(sol['WhatsApp'])],
    ['Correo del cliente', sol['Email']], ['Zona', sol['Zona']], ['Estado', estPro || ESTADO_HUMANO[estado] || estado]]);
  h += bloqueAcuerdo_(sol, 'Acuerdo registrado').replace('<p class="nota">Lo acordasteis directamente entre vosotros. Si algo no coincide con lo hablado, usa «Hay un problema».</p>', '') + bloqueCierre_(sol);
  if (estado === 'En revisión' || incidenciaAbierta_(oc)) h += '<div class="ok"><b>Soporte está revisando este trabajo.</b> Se han detenido el cierre y el cobro automáticos.</div>' + botonSoporteWA_(oc);
  var unidades = '<option value="horas">horas</option><option value="dias" selected>días</option><option value="semanas">semanas</option>';
  if (estado === 'Profesional asignado' || (estado === 'Trabajo en proceso' && !sol['Fecha registro acuerdo'])) {
    h += '<div class="ok">Recibir el contacto inicia el trabajo en OficioCerca. Después de hablar con el cliente y llegar a un acuerdo, vuelve aquí para registrar el valor acordado y la duración estimada. Mantener actualizado el seguimiento hasta el cierre forma parte del proceso.</div>' +
      '<h2>REGISTRAR ACUERDO ALCANZADO</h2><div id="pa" class="panel opc">' +
      '<label for="mo">Mano de obra acordada (€) *</label><input id="mo" inputmode="decimal" placeholder="Ej.: 350">' +
      '<label>Duración estimada del trabajo *</label><div class="fila2"><input id="dn" type="number" min="1" max="365" inputmode="numeric" placeholder="Ej.: 7"><select id="du">' + unidades + '</select></div>' +
      '<label for="mat">Materiales estimados — opcional / informativo</label><input id="mat" inputmode="decimal" placeholder="0">' +
      '<p class="nota">Los materiales no generan comisión de OficioCerca.</p>' +
      '<label for="obs">Nota (opcional)</label><textarea id="obs" maxlength="1000" placeholder="Lo que incluye, cómo os organizáis…"></textarea>' +
      '<button class="btn" onclick="if(!val(\'mo\').trim()){alert(\'Indica la mano de obra acordada\');return}if(!val(\'dn\').trim()){alert(\'Indica la duración estimada\');return}enviar({a:\'acuerdo\',mo:val(\'mo\'),mat:val(\'mat\'),dn:val(\'dn\'),du:val(\'du\'),nota:val(\'obs\')})">Registrar acuerdo alcanzado</button></div>';
  }
  var cierre = '<label for="mf">Valor FINAL de la mano de obra (€) *</label><input id="mf" inputmode="decimal" value="' + esc_(sol['Mano de obra inicial (€)'] === '' ? '' : String(sol['Mano de obra inicial (€)']).replace('.', ',')) + '">' +
    '<label>¿Hubo trabajos adicionales?</label><div class="fila2"><label><input type="radio" name="ad" value="no" checked style="width:auto"> No</label><label><input type="radio" name="ad" value="si" style="width:auto"> Sí</label></div>' +
    '<label for="mm">Si el valor final cambia frente al inicial, explica brevemente por qué</label><textarea id="mm" maxlength="500"></textarea>' +
    '<label for="mtf">Materiales finales — opcional / informativo (no generan comisión)</label><input id="mtf" inputmode="decimal">' +
    '<button class="btn" onclick="if(!val(\'mf\').trim()){alert(\'Indica el valor final de la mano de obra\');return}if(confirm(\'¿Marcar el trabajo como terminado? El cliente deberá confirmarlo.\'))enviar({a:\'finalizado\',mo:val(\'mf\'),adicionales:(document.querySelector(\'input[name=ad]:checked\')||{}).value,motivo:val(\'mm\'),mat:val(\'mtf\')})">Enviar cierre al cliente</button>';
  if (['Trabajo en proceso', 'Archivado por inactividad'].indexOf(estado) >= 0 && sol['Fecha registro acuerdo']) {
    h += '<h2>' + (estado === 'Archivado por inactividad' ? 'Indica el estado para reabrir el seguimiento' : '¿Cómo va el trabajo?') + '</h2>' +
      '<button class="btn" onclick="ver(\'pf\')">✔ MARCAR TRABAJO COMO TERMINADO</button><div id="pf" class="panel opc hide">' + cierre + '</div>' +
      '<button class="btn sec" onclick="ver(\'pp\')">Sigue en proceso · actualizar plazo</button><div id="pp" class="panel opc hide">' +
      '<label>¿Cuánto tiempo más necesitas? *</label><div class="fila2"><input id="pn2" type="number" min="1" max="365" inputmode="numeric"><select id="pu2">' + unidades + '</select></div>' +
      '<label for="pno">Nota (opcional)</label><input id="pno" maxlength="200">' +
      '<button class="btn sec" onclick="if(!val(\'pn2\').trim()){alert(\'Indica el nuevo plazo\');return}enviar({a:\'plazo\',dn:val(\'pn2\'),du:val(\'pu2\'),nota:val(\'pno\')})">Actualizar plazo</button></div>';
  }
  if (estado === 'Cierre pendiente del profesional') h += '<h2>Registra el valor final para completar el cierre</h2><div class="panel opc">' + cierre + '</div>';
  if (com && ['ANULADA'].indexOf(com['Estado']) < 0) {
    var filas = [['Mano de obra final confirmada', euros_(com['Mano de obra (€)'])], ['Materiales (no cuentan)', euros_(com['Materiales (€)'])],
      ['10 % de los primeros 2.000 €', euros_(com['Tramo 10 % (€)'])], ['5 % del exceso', euros_(com['Tramo 5 % (€)'])], ['Comisión', euros_(com['Importe comisión (€)'])]];
    var estTxt = { NO_HABILITADA: 'Calculada · en el piloto no se cobra', DUE: 'Pendiente de pago', PAYMENT_PENDING: 'Pago en proceso', PAID: 'Pagada', PAYMENT_FAILED: 'Pago no completado', MANUAL_REVIEW: 'En revisión', EN_REVISION: 'Congelada por una incidencia' }[com['Estado']] || com['Estado'];
    filas.push(['Estado', estTxt + (com['Ambiente'] === 'SANDBOX' ? ' (PRUEBA / SANDBOX)' : '')]);
    if (com['Estado'] === 'PAID') filas.push(['Referencia de pago', com['Referencia vigente']]);
    h += '<h2>Comisión de OficioCerca</h2>' + filas_(filas);
    if (['DUE', 'PAYMENT_FAILED'].indexOf(com['Estado']) >= 0) h += '<button class="btn" onclick="enviar({a:\'pagar\'})">' + (com['Ambiente'] === 'SANDBOX' ? 'PAGAR COMISIÓN (SANDBOX)' : 'PAGAR COMISIÓN') + '</button>' +
      '<p class="nota">Mientras esté pendiente no recibirás nuevas oportunidades. Tu cuenta, tu historial y tus trabajos en curso no cambian.</p>';
  }
  if (ESTADOS_ACTIVOS_SERVICIO.indexOf(estado) >= 0) h += formIncidencia_('pi');
  if (p) h += bloqueReputacion_(p);
  h += historialBasico_(oc);
  h += '<p class="nota">Comisión: ' + esc_(POLITICA_COMISION.texto) + ', sobre la mano de obra final confirmada por el cliente. <a href="' + esc_(urlAyuda_('profesional')) + '" target="_blank" rel="noopener">Centro de ayuda y políticas</a></p>';
  return html_('Trabajo ' + oc + ' · ' + servicioTxt_(sol), h, t);
}

/** «TU REPUTACIÓN EN OFICIOCERCA» (datos agregados; sin detalles de incidencias). */
function bloqueReputacion_(p) {
  var f = [['Valoración promedio', Number(p['Nº valoraciones']) ? String(p['Valoración media']).replace('.', ',') + ' / 5' : 'Aún sin valoraciones'],
    ['Trabajos cerrados', String(Number(p['Completados']) || 0)], ['Valoraciones recibidas', String(Number(p['Nº valoraciones']) || 0)]];
  if (p['Tasa respuesta (%)'] !== '' && p['Tasa respuesta (%)'] !== undefined) f.push(['Respuesta a oportunidades', p['Tasa respuesta (%)'] + ' %']);
  if (p['Cumplimiento seguimiento (%)'] !== '' && p['Cumplimiento seguimiento (%)'] !== undefined) f.push(['Seguimiento al día', p['Cumplimiento seguimiento (%)'] + ' %']);
  return '<details class="hist"><summary>Tu reputación en OficioCerca</summary>' + filas_(f) +
    '<p class="nota">Las buenas valoraciones, el cumplimiento del seguimiento y una buena respuesta pueden ayudarte a ser tenido en cuenta con mayor prioridad para futuras oportunidades. Primero cuentan siempre el servicio, la zona y la disponibilidad.</p></details>';
}

function accionGestion_(oc, pro, p) {
  switch (p.a) {
    case 'acuerdo': case 'presupuesto': return registrarAcuerdo_(oc, pro, p.mo, p.mat, p.dn, p.du, p.nota !== undefined ? p.nota : p.obs);
    case 'plazo': return actualizarPlazo_(oc, pro, p.dn, p.du, p.nota);
    case 'finalizado': return marcarFinalizado_(oc, pro, p.mo, p.adicionales, p.motivo, p.mat);
    case 'incidencia': return reportarIncidencia_(oc, 'profesional', p.categoria, p.texto);
    case 'pagar':
      var sol = solicitud_(oc);
      if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Este trabajo no está asignado a ti.' };
      var c = comisionDeOC_(oc);
      if (!c || ['DUE', 'PAYMENT_FAILED'].indexOf(c['Estado']) < 0) return { ok: false, msg: 'No hay ninguna comisión pendiente de pago.' };
      return { ok: true, url: urlPagoComision_(oc, pro), msg: 'Abriendo la página de pago…' };
  }
  return { ok: false, msg: 'Acción no válida.' };
}
/* ============================================================ CICLO AUTOMÁTICO · PANEL · EDICIONES DEL ADMINISTRADOR · RESUMEN */

/** Activador cada 10 minutos: cola de correo, vencimientos, nuevas búsquedas, métricas y panel. */
function cicloAutomatico() {
  try {
    conLock_(function () {
      procesarCola_();
      altasPendientes_();
      revisarOfertas_();
      motorSeguimiento_();
      recalcularMetricas_();
      estadisticasCorreo_();
    });
  } catch (err) { errorSistema_('cicloAutomatico', err); }
  try { actualizarPanel(); } catch (e) { console.error(e); }
}

/**
 * Red de seguridad: si una edición rápida en la hoja no disparó «alEditar», el profesional queda Activo pero sin
 * correo de alta. Aquí se envía (una sola vez: la clave pro-alta-PRO-xxxx lo hace idempotente).
 */
function altasPendientes_() {
  tabla_('Profesionales').todas().forEach(function (p) {
    if (p['Estado'] !== 'Activo' || !p['Condiciones (versión)'] || !p['Condiciones aceptadas (fecha)'] || !emailOk_(p['Email'])) return;
    var est = encolarCorreo_('pro-alta-' + p['Código'], 'alta_activada', 'Profesional', p['Email'], '', p['Código'], {}, true);
    if (est === 'En cola') registrar_('Sistema', 'Alta activada (comprobación automática)', '', p['Código'], '', 'sistema');
  });
}

function estadisticasCorreo_() {
  var h = tabla_('Historial envíos').todas();
  cfgPoner_('Cuota correo disponible', MailApp.getRemainingDailyQuota());
  cfgPoner_('Última comprobación', fecha_(new Date()));
  cfgPoner_('Correos pendientes', h.filter(function (r) { return r['Estado'] === 'Pendiente por cuota' || r['Estado'] === 'En cola'; }).length);
  cfgPoner_('Envíos fallidos', h.filter(function (r) { return r['Estado'] === 'Fallido'; }).length);
}

function intervenciones_(sol, pros, incs, correos, registro) {
  var out = [];
  sol.forEach(function (s) {
    if (s['Estado'] === 'Revisión manual') out.push(['Otro servicio', s['Código'], (s['Servicio (otro)'] || 'Otro') + ' · ' + s['Zona'], 'Solicitudes: ofrece con «Ofrecer a (PRO manual)», cambia el servicio o cancela']);
    if (s['Estado'] === 'Sin profesional disponible') out.push(['Sin profesional disponible', s['Código'], servicioTxt_(s) + ' · ' + s['Zona'] + ' · ' + s['Plazo'], 'Capta/activa un profesional (se reintenta solo; el cliente puede «Volver a buscar»)']);
    if (s['Estado'] === 'En revisión') out.push(['Servicio en revisión', s['Código'], String(s['Requiere intervención'] || ''), 'Incidencias: rellena «Resultado» (o contacta a las partes)']);
  });
  incs.filter(function (i) { return (i['Tipo'] === 'Incidencia' || i['Tipo'] === 'Ayuda') && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); })
    .sort(function (a, b) { var g = { Grave: 0, Alta: 1 }; return (g[a['Gravedad']] === undefined ? 2 : g[a['Gravedad']]) - (g[b['Gravedad']] === undefined ? 2 : g[b['Gravedad']]); })
    .forEach(function (i) { out.push([(i['Gravedad'] === 'Grave' ? 'INCIDENCIA GRAVE' : i['Tipo'] === 'Ayuda' ? 'Cliente pide ayuda' : 'Incidencia ' + i['Gravedad']), i['ID'] + ' ' + i['Código OC'] + ' ' + i['Código PRO'], String(i['Categoría']) + ': ' + String(i['Descripción']).slice(0, 90), 'Incidencias: rellena «Resultado»']); });
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
  var comPend = coms.filter(function (c) { return ESTADOS_COMISION_BLOQUEAN.indexOf(c['Estado']) >= 0; });
  var sumaCom = comPend.reduce(function (a, c) { return a + Number(c['Importe comisión (€)'] || 0); }, 0);
  var comNoHab = coms.filter(function (c) { return c['Estado'] === 'NO_HABILITADA'; });
  var hace7 = Date.now() - 7 * 86400000;
  var inter = intervenciones_(sol, pros, incs, correos, registro);

  var indicadores = [
    ['Solicitudes nuevas', cuenta(['Nueva'])],
    ['Buscando profesional', cuenta(['Buscando profesional'])],
    ['Esperando respuesta profesional', cuenta(['Esperando respuesta profesional'])],
    ['Con candidato de respaldo', conRespaldo],
    ['Esperando respuesta cliente', cuenta(['Esperando decisión cliente', 'Finalización por confirmar'])],
    ['Profesional asignado (sin acuerdo registrado)', cuenta(['Profesional asignado'])],
    ['Trabajos en proceso', cuenta(['Trabajo en proceso'])],
    ['Cierres pendientes (cliente o profesional)', cuenta(['Finalización por confirmar', 'Cierre pendiente del profesional'])],
    ['En revisión (incidencia o sin respuesta)', cuenta(['En revisión'])],
    ['Archivados por inactividad', cuenta(['Archivado por inactividad'])],
    ['Trabajos terminados (confirmados por el cliente)', cuenta(['Comisión pendiente', 'Cerrado'])],
    ['Profesionales pendientes de revisar', pros.filter(function (p) { return p['Estado'] === 'Pendiente de revisar'; }).length],
    ['Profesionales activos', pros.filter(function (p) { return p['Estado'] === 'Activo'; }).length],
    ['Incidencias abiertas', incs.filter(function (i) { return i['Tipo'] === 'Incidencia' && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); }).length],
    ['Comisiones exigibles sin pagar (bloquean nuevas oportunidades)', comPend.length + ' · ' + euros_(sumaCom)],
    ['Comisiones calculadas sin cobro (piloto: cobro ' + (cfgBool_('COMMISSION_COLLECTION_ENABLED') ? 'ACTIVO' : 'NO habilitado') + ')', comNoHab.length + ' · ' + euros_(comNoHab.reduce(function (a, c) { return a + Number(c['Importe comisión (€)'] || 0); }, 0))],
    ['Errores del sistema (7 días)', registro.filter(function (r) { return r['Tipo'] === 'Error' && new Date(r['Fecha']).getTime() > hace7; }).length],
    ['Correos en cola', correos.filter(function (c) { return c['Estado'] === 'Pendiente por cuota' || c['Estado'] === 'En cola'; }).length],
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
    ['Incidencias', 'Te llega un correo «⚠ Nueva incidencia». Resuélvela en Incidencias → «Resultado» (completo / parcial con «Mano de obra reconocida (€)» / sin trabajo / sin acuerdo / otro).'],
    ['Pausa temporal', 'Incidencias → «Pausa preventiva» o Profesionales → Estado «Pausado»: sin NUEVAS oportunidades; no borra cuenta, historial ni trabajos actuales. Anota el motivo.'],
    ['Cancelar una solicitud', 'Solicitudes → Estado «Cancelada» y escribe el motivo en «Motivo cierre».'],
    ['Cobro de comisiones', 'Configuración → COMMISSION_COLLECTION_ENABLED sigue en FALSE hasta la aprobación de Wompi, la cuenta de abono, la tasa EUR→COP real, la revisión legal/fiscal y la autorización de Steven.'],
    ['Nuevas condiciones', 'Ejecutar pedirAceptacionCondiciones() desde el editor para pedir la versión vigente a los profesionales activos que tengan una anterior.']
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
        // Fechas del seguimiento corregidas a mano: el motor las atiende en el minuto (no espera a la fecha antigua)
        if ((col === 'Fecha estimada fin' || col === 'Acción desde') && valor instanceof Date) {
          programarRevision_(valor);
          registrar_('Admin', col + ' cambiada', reg['Código'], reg['Profesional asignado (PRO)'], (antes || '—') + ' → ' + fecha_(valor), usuario);
        }
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
      if (nombre === 'Incidencias' && col === 'Resultado' && valor) {
        var res = resolverIncidencia_(reg['ID'], String(valor), usuario);
        t.poner(fila, { 'Notas': fecha_(new Date()) + ' ' + res + (reg['Notas'] ? '\n' + reg['Notas'] : '') });
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
      ['Sin profesional disponible (ahora)', sol.filter(function (s) { return s['Estado'] === 'Sin profesional disponible'; }).length],
      ['Acuerdos confirmados', acc('Cliente confirma el acuerdo')],
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
/* ============================================================ V1.7 · SEGUIMIENTO (centro del servicio) Y RUTA VISUAL
 * - Enlace privado por correo (/seguimiento/#TOKEN): aleatorio (64 hex), solo se guarda su SHA-256, ligado a UNA solicitud,
 *   válido 365 días y revocable. El navegador nunca elige la solicitud: el servidor la toma del token.
 * - Varios servicios del mismo cliente = OC independientes agrupadas por «Grupo cliente» (solo lo crea el servidor).
 * - El cliente NO ve la comisión ni fórmulas. Sin tokens en WhatsApp ni en textos públicos.
 * - Cada pantalla responde: ¿dónde estoy? ¿qué está pasando? ¿qué hago ahora? ¿qué pasa después?
 */

var PASOS_V17 = ['Solicitud enviada', 'Profesional encontrado', 'Contacto habilitado', 'Acuerdo registrado', 'Trabajo en proceso',
  'Cierre iniciado', 'Cliente confirma', 'Comisión pendiente', 'Comisión pagada', 'Cerrado'];
var PASOS_SOLO_PRO = [7, 8]; // el cliente no ve la comisión

var ESTADO_HUMANO = {
  'Nueva': 'Buscando un profesional compatible', 'Buscando profesional': 'Buscando un profesional compatible',
  'Esperando respuesta profesional': 'Buscando un profesional compatible', 'Revisión manual': 'Estamos revisando tu solicitud',
  'Esperando decisión cliente': 'Necesitamos tu decisión', 'Sin profesional disponible': 'Sin profesional disponible por ahora',
  'Profesional asignado': 'Profesional encontrado · contacto habilitado', 'Trabajo en proceso': 'Trabajo en proceso',
  'Cierre pendiente del profesional': 'Cierre iniciado · falta el valor final del profesional',
  'Finalización por confirmar': 'Cierre iniciado · falta la confirmación del cliente',
  'Comisión pendiente': 'Trabajo terminado', 'Cerrado': 'Servicio cerrado', 'En revisión': 'En revisión por soporte',
  'Archivado por inactividad': 'Archivado por inactividad (cierre no confirmado)', 'Cancelada': 'Solicitud cancelada'
};
var ESTADOS_CANCELABLES = ['Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional', 'Esperando decisión cliente', 'Sin profesional disponible'];

function pasoActualV17_(sol) {
  var e = sol['Estado'];
  if (ESTADOS_CANCELABLES.indexOf(e) >= 0) return 1;
  return ({ 'Profesional asignado': 3, 'Trabajo en proceso': 4, 'Cierre pendiente del profesional': 5, 'Finalización por confirmar': 6,
    'Comisión pendiente': 7, 'Cerrado': 10 })[e] || (sol['Presupuesto vigente'] ? 4 : 3);
}

function lineaProgresoV16_(sol, com, vista) {
  var actual = pasoActualV17_(sol), sinCobro = !com || ['NO_HABILITADA', 'ANULADA'].indexOf(com['Estado']) >= 0;
  if (vista === 'cliente' && sol['Estado'] === 'Comisión pendiente') actual = 10; // para el cliente su servicio ya está terminado
  if (sol['Estado'] === 'Comisión pendiente' && com && com['Estado'] === 'PAYMENT_PENDING') actual = 8;
  var pausa = sol['Estado'] === 'En revisión' ? ' (en revisión)' : sol['Estado'] === 'Archivado por inactividad' ? ' (archivado)' : '';
  return '<ol class="prog">' + PASOS_V17.map(function (txt, i) {
    if (vista === 'cliente' && PASOS_SOLO_PRO.indexOf(i) >= 0) return '';
    var na = PASOS_SOLO_PRO.indexOf(i) >= 0 && sinCobro && actual > 6;
    var cls = na ? 'pend' : i < actual ? 'hecho' : i === actual ? 'ahora' : 'pend';
    var ico = na ? '–' : i < actual ? '✓' : i === actual ? '◉' : '○';
    if (na) txt += ' (no aplica: cobro no habilitado en el piloto)';
    if (i === 4 && sol['Fecha estimada fin'] && actual <= 4) txt += ' · fin estimado ' + fecha_(sol['Fecha estimada fin']);
    if (i === actual) txt += pausa;
    return '<li class="' + cls + '"><span aria-hidden="true">' + ico + '</span> ' + esc_(txt) + '</li>';
  }).join('') + '</ol>';
}

/** Las cuatro preguntas de cada pantalla. */
function resumenV16_(sol, com, vista) {
  var e = sol['Estado'], cli = vista === 'cliente', vencido = sol['Fecha estimada fin'] && new Date(sol['Fecha estimada fin']).getTime() <= Date.now();
  var R = function (pasa, haces, sigue) { return { pasa: pasa, haces: haces, sigue: sigue }; };
  var r;
  if (e === 'Esperando decisión cliente') r = R('Solo hay disponibilidad posterior a la que pediste.', 'Elige una opción más abajo.', 'Según elijas, asignamos al profesional o seguimos buscando.');
  else if (e === 'Sin profesional disponible') r = R('Por ahora no encontramos un profesional compatible.', 'Puedes pulsar «Volver a buscar» cuando quieras: no tienes que rellenar nada otra vez.', 'Si aparece un profesional, te avisaremos por correo.');
  else if (ESTADOS_CANCELABLES.indexOf(e) >= 0) r = /mismo profesional/i.test(sol['Origen servicio'] || '') && e === 'Esperando respuesta profesional' ?
    R('Hemos pedido este servicio a tu profesional y esperamos su respuesta.', 'Nada por ahora. Te avisaremos por correo.', 'Si acepta, verás aquí sus datos; si no puede, buscaremos otro profesional compatible.') :
    R('Estamos buscando un profesional compatible con tu trabajo, zona y plazo.', 'Nada por ahora. Te avisaremos por correo.', 'Cuando un profesional acepte, verás aquí sus datos de contacto.');
  else if (e === 'Profesional asignado') r = cli ? R('Ya tienes profesional. Se pondrá en contacto contigo directamente.', 'Hablad, y si hace falta que visite el trabajo. El precio y las condiciones los acordáis entre vosotros.', 'Cuando lleguéis a un acuerdo, el profesional lo registrará aquí con la duración estimada.')
    : R('Tienes el contacto del cliente.', 'Habla con el cliente (y visítalo si hace falta). Cuando lleguéis a un acuerdo, pulsa «Registrar acuerdo alcanzado».', 'La duración que indiques será la fecha en la que te preguntaremos cómo va.');
  else if (e === 'Trabajo en proceso' && sol['Plantilla seguimiento'] === 'actualizar_plazo') r = cli ? R('Indicaste que el trabajo sigue en proceso.', 'Nada por ahora.', 'El profesional registrará la nueva fecha estimada y la verás aquí.')
    : R('El cliente indica que el trabajo sigue en proceso.', 'Registra la nueva duración estimada con «Sigue en proceso · actualizar plazo».', 'Te preguntaremos de nuevo al llegar la nueva fecha.');
  else if (e === 'Trabajo en proceso') r = cli ? R(vencido ? 'Llegó la fecha estimada de finalización.' : 'El trabajo está en proceso. Fin estimado: ' + fecha_(sol['Fecha estimada fin']) + '.', vencido ? 'Indica el estado: «El trabajo terminó», «Sigue en proceso» o «Hay un problema».' : 'Nada. Si el trabajo termina antes o hay un problema, indícalo aquí.', 'Al terminar, el profesional registrará el valor final y tú confirmarás el cierre.')
    : R(vencido ? 'Llegó la fecha estimada de finalización.' : 'Trabajo en proceso. Fin estimado: ' + fecha_(sol['Fecha estimada fin']) + '.', vencido ? 'Indica el estado: «Marcar trabajo como terminado» o «Sigue en proceso» (con el nuevo plazo).' : 'Al terminar, pulsa «Marcar trabajo como terminado». Si necesitas más tiempo, actualiza el plazo.', 'El cliente confirmará el cierre.');
  else if (e === 'Cierre pendiente del profesional') r = cli ? R('Indicaste que el trabajo terminó.', 'Nada por ahora.', 'El profesional registrará el valor final y te pediremos que confirmes el cierre.')
    : R('El cliente indica que el trabajo terminó.', 'Registra el valor final de la mano de obra para completar el cierre.', 'El cliente confirmará el cierre.');
  else if (e === 'Finalización por confirmar') r = cli ? R('El profesional indicó que el trabajo terminó y registró el valor final.', 'Revisa el cierre y confírmalo, o indica «Todavía no» o «Hay un problema».', 'Con tu confirmación el servicio queda cerrado y podrás valorarlo.')
    : R('Has registrado el cierre. Falta la confirmación del cliente.', 'Nada por ahora.', 'Cuando el cliente confirme, se cerrará el servicio (y, si aplica, se generará la comisión).');
  else if (e === 'Comisión pendiente') r = cli ? R('Confirmaste el cierre. ¡Gracias!', 'Si quieres, valora el servicio.', 'Nada más: tu servicio está terminado.')
    : (com && com['Estado'] === 'PAYMENT_PENDING' ? R('Wompi está procesando tu pago.', 'Nada: espera la confirmación.', 'Al aprobarse, el servicio se cierra y vuelves a recibir oportunidades.')
      : R('El cliente confirmó el cierre. La comisión está pendiente de pago.', 'Paga la comisión con el botón «Pagar comisión».', 'Al confirmarse el pago el servicio se cierra y vuelves a recibir oportunidades.'));
  else if (e === 'Cerrado') r = cli ? R('Servicio cerrado.', 'Si quieres, valora el servicio o pide otro.', 'Nada más.') : R('Servicio cerrado.', 'Nada.', 'Seguirás recibiendo oportunidades compatibles.');
  else if (e === 'En revisión') r = R('Hay una incidencia o falta una respuesta: soporte está revisando el servicio. Se han detenido el cierre y el cobro automáticos.', 'Si necesitas añadir algo, escríbenos por WhatsApp.', 'Soporte te contactará y registrará el resultado aquí.');
  else if (e === 'Archivado por inactividad') r = R('No recibimos respuesta y el seguimiento quedó archivado. No se ha cerrado ni cobrado nada.', 'Si el servicio sigue vivo, indica su estado más abajo para reabrirlo.', 'Al indicar el estado, el seguimiento continúa donde estaba.');
  else r = R('Esta solicitud está cancelada.', 'Si lo necesitas, pide un servicio nuevo.', 'Nada más.');
  return '<div class="panel4"><p><b>¿Dónde estoy?</b> ' + esc_((cli ? 'Seguimiento de tu servicio ' : 'Trabajo ') + sol['Código'] + ' · ' + servicioTxt_(sol)) + '</p>' +
    '<p><b>¿Qué está pasando?</b> ' + esc_(r.pasa) + '</p><p><b>¿Qué hago ahora?</b> ' + esc_(r.haces) + '</p><p><b>¿Qué pasa después?</b> ' + esc_(r.sigue) + '</p></div>';
}

function incidenciaAbierta_(oc) {
  return tabla_('Incidencias').todas().some(function (i) { return i['Código OC'] === oc && i['Tipo'] === 'Incidencia' && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); });
}

/** Acuerdo registrado por el profesional (solo lectura; sin comisión). */
function bloqueAcuerdo_(sol, titulo) {
  if (!sol['Fecha registro acuerdo']) return '';
  var f = [['Mano de obra acordada', euros_(sol['Mano de obra inicial (€)'])], ['Duración estimada', sol['Duración estimada'] || '—'],
    ['Fin estimado', fecha_(sol['Fecha estimada fin'])]];
  if (Number(sol['Materiales aceptados (€)']) > 0) f.push(['Materiales estimados (informativo)', euros_(sol['Materiales aceptados (€)'])]);
  return '<h2>' + esc_(titulo || 'Acuerdo registrado por el profesional') + '</h2>' + filas_(f) +
    '<p class="nota">Lo acordasteis directamente entre vosotros. Si algo no coincide con lo hablado, usa «Hay un problema».</p>';
}
function bloqueCierre_(sol) {
  if (sol['Mano de obra final (€)'] === '' || sol['Mano de obra final (€)'] === undefined) return '';
  var f = [['Mano de obra inicial', sol['Mano de obra inicial (€)'] === '' ? '—' : euros_(sol['Mano de obra inicial (€)'])], ['Mano de obra final', euros_(sol['Mano de obra final (€)'])],
    ['Trabajos adicionales', sol['Trabajos adicionales'] || 'No']];
  if (sol['Motivo cambio valor']) f.push(['Motivo del cambio', sol['Motivo cambio valor']]);
  if (sol['Materiales finales (€)'] !== '' && sol['Materiales finales (€)'] !== undefined) f.push(['Materiales (informativo)', euros_(sol['Materiales finales (€)'])]);
  return '<h2>Cierre registrado</h2>' + filas_(f);
}
/** Historial básico en lenguaje humano (sin datos internos). */
var HISTORIAL_HUMANO = {
  'Solicitud recibida': 'Solicitud recibida', 'Asignación automática y contacto compartido': 'Profesional asignado · contacto habilitado',
  'Acuerdo alcanzado registrado': 'Acuerdo registrado', 'Acuerdo corregido': 'Acuerdo corregido', 'Plazo actualizado': 'Plazo actualizado',
  'Llegó la fecha estimada de finalización': 'Llegó la fecha estimada', 'Cliente: el trabajo sigue en proceso': 'El cliente indica que sigue en proceso',
  'Profesional indica trabajo finalizado': 'El profesional registra el cierre', 'Cliente indica que el trabajo terminó': 'El cliente indica que terminó',
  'Cliente confirma el cierre': 'Cierre confirmado', 'Servicio reabierto': 'Servicio reabierto', 'Archivado por inactividad (cierre no confirmado)': 'Archivado por inactividad',
  'Escalado a revisión manual': 'En revisión por soporte', 'Valoración recibida': 'Valoración recibida', 'Solicitud cancelada': 'Solicitud cancelada'
};
function historialBasico_(oc) {
  var ev = tabla_('Registro').todas().filter(function (r) { return r['Código OC'] === oc && (HISTORIAL_HUMANO[r['Acción']] || /^Incidencia (creada|resuelta)/.test(r['Acción'])); });
  if (!ev.length) return '';
  return '<details class="hist"><summary>Historial (' + ev.length + ')</summary><ul class="servicios">' + ev.map(function (r) {
    var t = HISTORIAL_HUMANO[r['Acción']] || (/creada/.test(r['Acción']) ? 'Incidencia registrada' : 'Incidencia resuelta');
    return '<li>' + esc_(fecha_(r['Fecha']) + ' · ' + t) + '</li>';
  }).join('') + '</ul></details>';
}

function urlAyuda_(ancla) { return String(cfg_('URL_WEB') || 'https://oficiocerca.pages.dev/').replace(/\/?$/, '/') + 'ayuda/' + (ancla ? '#' + ancla : ''); }

/** Botón de soporte por WhatsApp: la web rellena el número oficial (config.js); sin tokens ni datos privados. */
function botonSoporteWA_(oc) {
  return '<a class="btn sec wa-soporte" data-wa-soporte="' + esc_(oc) + '" target="_blank" rel="noopener" hidden>HABLAR CON SOPORTE POR WHATSAPP</a>';
}
function formIncidencia_(id) {
  var cats = CATEGORIAS_INCIDENCIA.map(function (c) { return '<option>' + esc_(c) + '</option>'; }).join('');
  return '<button class="btn rojo" onclick="ver(\'' + id + '\')">HAY UN PROBLEMA / REPORTAR INCIDENCIA</button>' +
    '<div id="' + id + '" class="panel opc hide"><label for="' + id + 'c">Tipo de problema</label><select id="' + id + 'c">' + cats + '</select>' +
    '<label for="' + id + 't">Cuéntanos qué ha pasado</label><textarea id="' + id + 't" maxlength="1500"></textarea>' +
    '<p class="nota">Al reportarlo, el servicio queda en revisión: se detienen el cierre y el cobro automáticos y soporte recibe un aviso. No decidimos automáticamente quién tiene razón.</p>' +
    '<button class="btn rojo" onclick="if(!val(\'' + id + 't\').trim()){alert(\'Cuéntanos qué ha pasado\');return}enviar({a:\'incidencia\',categoria:val(\'' + id + 'c\'),texto:val(\'' + id + 't\')})">Enviar incidencia</button></div>';
}

function bloqueValorar_() {
  var estrellas = [1, 2, 3, 4, 5].map(function (n) { return '<label><input type="radio" name="st" value="' + n + '"><span>' + n + '★</span></label>'; }).join('');
  return '<label>¿Cómo valoras el servicio? (1 = muy mal · 5 = excelente)</label><div class="stars">' + estrellas + '</div>' +
    '<label for="com">Comentario (opcional)</label><textarea id="com" maxlength="1000"></textarea>' +
    '<button class="btn" onclick="var s=document.querySelector(\'input[name=st]:checked\');if(!s){alert(\'Elige de 1 a 5 estrellas\');return}enviar({a:\'valorar\',estrellas:s.value,comentario:val(\'com\')})">Enviar valoración</button>';
}

function opcionesServicio_(lista) { return lista.map(function (c) { return '<option value="' + c + '">' + esc_(SERVICIOS[c]) + '</option>'; }).join(''); }
function formServicio_(id, accion, servicios, titulo, nota) {
  var plazos = Object.keys(PLAZOS_CLIENTE).map(function (k) { return '<option value="' + k + '">' + esc_(PLAZOS_CLIENTE[k].t) + '</option>'; }).join('');
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  return '<div id="' + id + '" class="panel opc hide"><p class="nota">' + esc_(nota) + '</p>' +
    '<label for="' + id + 's">Servicio</label><select id="' + id + 's">' + opcionesServicio_(servicios) + '</select>' +
    '<label for="' + id + 'd">¿Qué necesitas?</label><textarea id="' + id + 'd" maxlength="3000"></textarea>' +
    '<label for="' + id + 'p">¿Para cuándo?</label><select id="' + id + 'p" onchange="document.getElementById(\'' + id + 'fw\').classList.toggle(\'hide\',this.value!==\'OTRA_FECHA\')">' + plazos + '</select>' +
    '<div id="' + id + 'fw" class="hide"><label for="' + id + 'f">Fecha</label><input type="date" id="' + id + 'f" min="' + hoy + '"></div>' +
    '<button class="btn" onclick="if(!val(\'' + id + 'd\').trim()){alert(\'Describe el trabajo\');return}enviar({a:\'' + accion + '\',servicio:val(\'' + id + 's\'),descripcion:val(\'' + id + 'd\'),plazo:val(\'' + id + 'p\'),fecha:val(\'' + id + 'f\')})">' + esc_(titulo) + '</button></div>';
}

function paginaSeguimiento_(t, oc) {
  var sol = solicitud_(oc), estado = sol['Estado'], com = comisionDeOC_(oc);
  var p = sol['Profesional asignado (PRO)'] ? profesional_(sol['Profesional asignado (PRO)']) : null;
  var h = '';
  var grupo = serviciosDelGrupo_(sol);
  if (grupo.length > 1) {
    h += '<h2>Tus servicios</h2><ul class="servicios">' + grupo.map(function (s) {
      var actual = s['Código'] === oc;
      return '<li' + (actual ? ' class="actual"' : '') + '><b>' + esc_(s['Código']) + '</b> · ' + esc_(servicioTxt_(s)) + ' · ' + esc_(ESTADO_HUMANO[s['Estado']] || s['Estado']) +
        (actual ? ' <span class="nota">(lo estás viendo)</span>' : ' <button class="mini" onclick="enviar({a:\'abrir_servicio\',oc:\'' + esc_(s['Código']) + '\'})">Ver</button>') + '</li>';
    }).join('') + '</ul>';
  }
  h += resumenV16_(sol, com, 'cliente');
  h += estado === 'Cancelada' ? '<div class="err">Esta solicitud está cancelada.</div>' : lineaProgresoV16_(sol, com, 'cliente');

  var info = [['Servicio', servicioTxt_(sol)], ['Zona', sol['Zona']], ['Plazo solicitado', plazoTxt_(sol)]];
  if (p) info.push(['Profesional', datosProTxt_(p)], ['WhatsApp del profesional', limpio_(p['WhatsApp'])], ['Correo del profesional', p['Email']]);
  h += '<h2>Datos del servicio</h2>' + filas_(info);
  h += bloqueAcuerdo_(sol) + bloqueCierre_(sol);
  if (estado === 'En revisión' || incidenciaAbierta_(oc)) h += '<div class="ok"><b>Soporte está revisando este servicio.</b> Te contactaremos.</div>' + botonSoporteWA_(oc);

  // Solo los botones válidos para el estado actual
  var vencido = sol['Fecha estimada fin'] && new Date(sol['Fecha estimada fin']).getTime() <= Date.now();
  if (estado === 'Esperando decisión cliente') {
    h += '<h2>¿Qué prefieres?</h2><p>El profesional más próximo puede atenderte aproximadamente: <b>' + esc_(sol['Respaldo disponibilidad'] || '') + '</b>.</p>' +
      '<button class="btn" onclick="enviar({a:\'respaldo\',d:\'continuar\'})">Sí, continuar con este profesional</button>' +
      '<button class="btn sec" onclick="enviar({a:\'respaldo\',d:\'seguir\'})">Seguir buscando</button>' +
      '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar la solicitud?\'))enviar({a:\'respaldo\',d:\'cancelar\'})">Cancelar solicitud</button>';
  }
  if (estado === 'Sin profesional disponible') h += '<button class="btn" onclick="enviar({a:\'volver_a_buscar\'})">VOLVER A BUSCAR</button><p class="nota">Usamos los mismos datos: no tienes que rellenar nada otra vez.</p>';
  if ((estado === 'Trabajo en proceso' || estado === 'Archivado por inactividad') || (estado === 'Profesional asignado' && sol['Fecha registro acuerdo'])) {
    h += '<h2>' + (estado === 'Archivado por inactividad' ? '¿Cómo está el servicio? (se reabrirá el seguimiento)' : vencido && sol['Plantilla seguimiento'] !== 'actualizar_plazo' ? 'Llegó la fecha estimada: ¿cómo va?' : '¿Novedades del trabajo?') + '</h2>' +
      '<button class="btn" onclick="if(confirm(\'¿El trabajo ha terminado?\'))enviar({a:\'termino\'})">✔ El trabajo terminó</button>' +
      ((vencido && sol['Plantilla seguimiento'] !== 'actualizar_plazo') || estado === 'Archivado por inactividad' ? '<button class="btn sec" onclick="enviar({a:\'sigue\'})">Sigue en proceso</button>' : '');
  }
  if (estado === 'Finalización por confirmar') {
    h += '<h2>¿Confirmas el cierre?</h2>' +
      '<button class="btn" onclick="if(confirm(\'¿Confirmas que el trabajo terminó y el valor final?\'))enviar({a:\'fin_si\'})">✔ Sí, el trabajo terminó y confirmo</button>' +
      '<button class="btn sec" onclick="enviar({a:\'fin_aun_no\'})">Todavía no está terminado</button>';
  }
  if (ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(estado) >= 0 && sol['Cliente confirmó fin (fecha)']) {
    var ya = tabla_('Valoraciones').todas().some(function (v) { return v['Código OC'] === oc; });
    h += '<h2>Valoración</h2>' + (ya ? '<div class="ok">Gracias, ya recibimos tu valoración.</div>' : bloqueValorar_());
  }
  if (ESTADOS_ACTIVOS_SERVICIO.indexOf(estado) >= 0) h += formIncidencia_('pi');
  h += historialBasico_(oc);

  h += '<h2>Otras opciones</h2>';
  h += '<button class="btn sec" onclick="ver(\'pn\')">+ Añadir otro servicio</button>' +
    formServicio_('pn', 'nuevo_servicio', SERVICIOS_ACTIVOS.concat(['otro']), 'Añadir este servicio', 'Usaremos tus mismos datos de contacto. Cada servicio tiene su propio seguimiento.');
  if (p && estado !== 'En revisión') {
    var susServ = listaServicios_(p['Servicios (códigos)']).filter(function (c) { return SERVICIOS_ACTIVOS.indexOf(c) >= 0; });
    if (susServ.length) h += '<button class="btn sec" onclick="ver(\'pm\')">Solicitar este servicio al mismo profesional</button>' +
      formServicio_('pm', 'mismo_pro', susServ, 'Pedírselo a ' + p['Nombre'], 'Se lo pediremos a ' + p['Nombre'] + '; debe aceptarlo. Será un servicio nuevo e independiente. Si no puede, buscaremos otro profesional compatible.');
  }
  if (ESTADOS_CANCELABLES.indexOf(estado) >= 0) h += '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar esta solicitud?\'))enviar({a:\'cancelar\'})">Cancelar esta solicitud</button>';
  h += '<p class="nota"><a href="' + esc_(urlAyuda_('cliente')) + '" target="_blank" rel="noopener">Centro de ayuda y políticas</a></p>';
  return html_('Seguimiento · ' + oc, h, t);
}

/** Acciones del portal del cliente: siempre sobre la OC del token (o una de SU grupo, validada en el servidor). */
function accionSeguimiento_(oc, p) {
  var sol = solicitud_(oc);
  switch (p.a) {
    case 'respaldo':
      var of = tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === oc && o['Estado'] === 'Respaldo' && o['Código PRO'] === sol['Respaldo (PRO)']; })[0];
      if (!of) return { ok: false, msg: 'Esa opción ya no está disponible.' };
      return procesarDecisionRespaldo_(of['ID'], p.d);
    case 'volver_a_buscar': return volverABuscar_(oc);
    case 'termino': return clienteTerminado_(oc);
    case 'sigue': return clienteSigueEnProceso_(oc);
    case 'fin_si': return procesarFinCliente_(oc, 'si');
    case 'fin_aun_no': return procesarFinCliente_(oc, 'aun_no');
    case 'fin_problema': case 'incidencia': return reportarIncidencia_(oc, 'cliente', p.categoria || (p.grave ? 'Situación grave' : 'Otro'), p.texto);
    case 'valorar': return procesarValoracion_(oc, p.estrellas, p.comentario);
    case 'ayuda': return procesarComentarioCliente_(oc, 'ayuda', 'Otro', p.texto, p.grave === true);
    case 'nuevo_servicio': return anadirServicio_(oc, { servicio: p.servicio, descripcion: p.descripcion, plazo: p.plazo, fecha: p.fecha, otro: p.otro }, false);
    case 'mismo_pro': return anadirServicio_(oc, { servicio: p.servicio, descripcion: p.descripcion, plazo: p.plazo, fecha: p.fecha }, true);
    case 'abrir_servicio':
      var destino = serviciosDelGrupo_(sol).filter(function (s) { return s['Código'] === String(p.oc || ''); })[0];
      if (!destino) return { ok: false, msg: 'Ese servicio no está disponible.' };
      var tk = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
      tabla_('Tokens').agregar({ 'Hash': hash_(tk), 'Tipo': 'seguimiento', 'Código OC': destino['Código'], 'Creado': new Date(), 'Expira': new Date(Date.now() + 365 * 86400000) });
      return { ok: true, t: tk, msg: 'Abriendo ' + destino['Código'] + '…' };
    case 'cancelar':
      return conLock_(function () {
        var s = solicitud_(oc);
        if (s['Estado'] === 'Cancelada') return { ok: true, ya: true, msg: 'Esta solicitud ya estaba cancelada.' };
        if (ESTADOS_CANCELABLES.indexOf(s['Estado']) < 0) return { ok: false, msg: 'Esta solicitud ya tiene profesional. Si hay un problema, usa «Hay un problema».' };
        cancelarSolicitud_(s, 'Cancelada por el cliente');
        return { ok: true, msg: 'Hemos cancelado esta solicitud.' };
      });
  }
  return { ok: false, msg: 'Acción no válida.' };
}

/** Revoca todos los enlaces de seguimiento de una solicitud (ejecutar a mano si hiciera falta). */
function revocarSeguimiento(oc) {
  conLock_(function () {
    var tt = tabla_('Tokens');
    tt.todas().filter(function (r) { return r['Código OC'] === oc && r['Tipo'] === 'seguimiento'; })
      .forEach(function (r) { tt.poner(r._fila, { 'Resultado': 'Revocado', 'Expira': new Date() }); });
  });
}

function recordatoriosFinalizacion_() { motorSeguimiento_(); } // compatibilidad

/* ---------- procesador rápido (cada minuto; sale al instante si no hay nada) ---------- */
function marcarPendiente_() { PropertiesService.getScriptProperties().setProperty('PENDIENTE', String(Date.now())); }

function procesarPendientes() {
  var props = PropertiesService.getScriptProperties();
  var pendiente = !!props.getProperty('PENDIENTE'), vence = seguimientoVencido_();
  if (!pendiente && !vence) return;
  try {
    conLock_(function () {
      if (pendiente) props.deleteProperty('PENDIENTE');
      if (vence) motorSeguimiento_(); // fecha estimada / recordatorio programado: se atiende en el minuto
      procesarCola_();
      if (props.getProperty('METRICAS_PENDIENTES')) { props.deleteProperty('METRICAS_PENDIENTES'); recalcularMetricas_(); }
      tabla_('Solicitudes').todas().filter(function (s) { return s['Estado'] === 'Nueva'; })
        .forEach(function (s) { try { motor_(s['Código']); } catch (e) { errorSistema_('motor ' + s['Código'], e); } });
      procesarCola_();
    });
  } catch (err) { errorSistema_('procesarPendientes', err); }
  try { if (pendiente) actualizarPanel(); } catch (e) { }
}
/* ============================================================ COBRO DE COMISIONES CON WOMPI (V1.6)
 *
 * Una sola estructura para SANDBOX y PRODUCCIÓN (pestañas «Comisiones», «Pagos comisión», «Eventos Wompi»):
 *  - SANDBOX: solo si WOMPI_SANDBOX_ENABLED = TRUE y la solicitud Y el profesional son de PRUEBA (nombre con «PRUEBA»).
 *    Credenciales de pruebas (pub_test_ / test_integrity_ / test_events_) y tasa FICTICIA TEST_EXCHANGE_RATE.
 *  - PRODUCCIÓN: estructura preparada, DESACTIVADA. Solo actúa con COMMISSION_COLLECTION_ENABLED = TRUE, credenciales
 *    de producción (pub_prod_ / prod_integrity_ / prod_events_) y una tasa EUR→COP real y vigente (13 · tasaEurCop_).
 *    Nada de esto se activa sin autorización expresa de Steven.
 *  - Sin cobro activo (lo normal en el piloto): la comisión se calcula y registra como NO_HABILITADA (no bloquea).
 * Los secretos viven en Propiedades del script (nunca en el código ni en la hoja). La redirección del navegador
 * nunca cambia estados: solo el evento de Wompi verificado (checksum SHA-256, comparación en tiempo constante).
 */

var WOMPI = {
  CHECKOUT_URL: 'https://checkout.wompi.co/p/',
  MONEDA: 'COP',
  MINUTOS_REUSO_INTENTO: 60,
  AMBIENTES: {
    SANDBOX: { evento: 'test', cred: { pub: ['WOMPI_TEST_PUBLIC_KEY', 'pub_test_'], integridad: ['WOMPI_TEST_INTEGRITY_SECRET', 'test_integrity_'], eventos: ['WOMPI_TEST_EVENTS_SECRET', 'test_events_'] } },
    PRODUCCION: { evento: 'prod', cred: { pub: ['WOMPI_PROD_PUBLIC_KEY', 'pub_prod_'], integridad: ['WOMPI_PROD_INTEGRITY_SECRET', 'prod_integrity_'], eventos: ['WOMPI_PROD_EVENTS_SECRET', 'prod_events_'] } }
  }
};
/** Estados que significan «exigible y no pagada» → el profesional no recibe NUEVAS oportunidades. */
var ESTADOS_COMISION_BLOQUEAN = ['DUE', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'MANUAL_REVIEW'];

var CONFIG_WOMPI = [
  ['WOMPI_SANDBOX_ENABLED', 'FALSE', 'Pruebas de cobro con Wompi SANDBOX (sin dinero real). Solo afecta a solicitudes y profesionales de PRUEBA.'],
  ['TEST_EXCHANGE_RATE', '4500', 'SOLO SANDBOX: TASA FICTICIA EUR→COP. Nunca se usa en producción.'],
  ['SANDBOX_BLOQUEO_PRO', 'TRUE', 'SANDBOX: un profesional de PRUEBA con comisión exigible sin pagar no recibe NUEVAS oportunidades.'],
  ['SANDBOX_EMAIL_TEST', '', 'SANDBOX: si se rellena, los avisos de comisión de PRUEBA van a este correo en lugar del del profesional de prueba.'],
  ['WOMPI_URL_REDIRECCION', 'https://oficiocerca.pages.dev/', 'Página a la que vuelve el navegador tras pagar (solo informativa: no cambia estados).'],
  ['FX_MODO', 'SIN_DEFINIR', 'Tasa EUR→COP de PRODUCCIÓN: SIN_DEFINIR (bloquea el cobro) · MANUAL (FX_EUR_COP_MANUAL + FX_FECHA_MANUAL) · TRM_BCE (propuesta, pendiente de aprobación).'],
  ['FX_EUR_COP_MANUAL', '', 'Tasa EUR→COP introducida a mano (solo con FX_MODO = MANUAL).'],
  ['FX_FECHA_MANUAL', '', 'Fecha (AAAA-MM-DD) de la tasa manual.'],
  ['FX_MAX_DIAS', '3', 'Antigüedad máxima (días) de la tasa para poder cobrar.'],
  ['FX_FUENTE_APROBADA', 'NO', 'SI = Steven aprobó usar la fuente automática TRM_BCE.']
];

/* ---------- instalación (idempotente; no borra datos) ---------- */
function instalarWompi() {
  var tc = tabla_('Configuración'), existentes = tc.todas().map(function (r) { return String(r['Clave']); });
  CONFIG_WOMPI.forEach(function (r) { if (existentes.indexOf(r[0]) < 0) tc.agregar({ 'Clave': r[0], 'Valor': r[1], 'Descripción': r[2] }); });
  _cfg = null;
  Logger.log('Wompi: ' + JSON.stringify(diagnosticoWompi_()));
}
function instalarWompiSandbox() { instalarWompi(); } // compatibilidad

/** Diagnóstico sin revelar secretos: solo DISPONIBLE / FALTA / error. */
function diagnosticoWompi_() {
  var out = { WOMPI_SANDBOX_ENABLED: cfgBool_('WOMPI_SANDBOX_ENABLED'), COMMISSION_COLLECTION_ENABLED: cfgBool_('COMMISSION_COLLECTION_ENABLED'), FX_MODO: cfg_('FX_MODO') };
  Object.keys(WOMPI.AMBIENTES).forEach(function (a) {
    Object.keys(WOMPI.AMBIENTES[a].cred).forEach(function (k) {
      var prop = WOMPI.AMBIENTES[a].cred[k][0];
      try { credWompi_(a, k); out[prop] = 'DISPONIBLE'; } catch (e) { out[prop] = String(e.message || e).replace(/:.*/, ''); }
    });
  });
  return out;
}
function diagnosticoWompiSandbox() { Logger.log(JSON.stringify(diagnosticoWompi_())); }

/* ---------- guardas ---------- */
function sbxActivo_() { return cfgBool_('WOMPI_SANDBOX_ENABLED'); }
function esPrueba_(texto) { return /PRUEBA/i.test(String(texto || '')); }
function sbxEsPrueba_(texto) { return esPrueba_(texto); }

/** Ambiente de cobro de una solicitud: 'SANDBOX' · 'PRODUCCION' · '' (cobro no habilitado). */
function ambienteCobro_(sol, p) {
  if (sol && p && esPrueba_(sol['Nombre']) && esPrueba_(p['Nombre'])) return sbxActivo_() ? 'SANDBOX' : '';
  if (sol && p && (esPrueba_(sol['Nombre']) || esPrueba_(p['Nombre']))) return ''; // mezcla prueba/real: nunca se cobra
  return cfgBool_('COMMISSION_COLLECTION_ENABLED') ? 'PRODUCCION' : '';
}

/** Credencial del ambiente. Error si falta o si su prefijo no corresponde (nunca devuelve su valor en mensajes). */
function credWompi_(ambiente, tipo) {
  var a = WOMPI.AMBIENTES[ambiente];
  if (!a || !a.cred[tipo]) throw new Error('CREDENCIAL_DESCONOCIDA');
  var prop = a.cred[tipo][0], prefijo = a.cred[tipo][1];
  var v = String(PropertiesService.getScriptProperties().getProperty(prop) || '').trim();
  if (!v) throw new Error('FALTA: ' + prop);
  if (ambiente === 'SANDBOX' && /prod/i.test(v.slice(0, 16))) throw new Error('PRODUCCION_DETECTADA: ' + prop + ' contiene una credencial de producción. Sandbox detenido.');
  if (v.indexOf(prefijo) !== 0) throw new Error('PREFIJO_INVALIDO: ' + prop + ' debe empezar por ' + prefijo);
  return v;
}
function sbxCred_(tipo) { return credWompi_('SANDBOX', tipo); }

/* ---------- utilidades puras ---------- */
function eurACop_(eur, tasa) {
  tasa = Number(tasa);
  if (!(tasa > 0)) throw new Error('Tasa EUR→COP no disponible.');
  var cop = Math.round(Number(eur) * tasa);
  return { tasa: tasa, cop: cop, centavos: cop * 100 };
}
function sbxEurACop_(eur, tasa) { return eurACop_(eur, tasa); }

/** OC-<ID_SOLICITUD>-COM-<AAAAMMDDhhmmss>. Sin datos personales. */
function referenciaPago_(oc, fecha) {
  var id = String(oc || '').replace(/^OC-/i, '').replace(/[^0-9A-Za-z]/g, '');
  if (!id) throw new Error('Código OC no válido para la referencia');
  return 'OC-' + id + '-COM-' + Utilities.formatDate(fecha || new Date(), ZONA_HORARIA, 'yyyyMMddHHmmss');
}
function sbxReferencia_(oc, fecha) { return referenciaPago_(oc, fecha); }

/** Firma de integridad oficial: SHA256(<Referencia><Monto en centavos><Moneda><Secreto de integridad>). Solo servidor. */
function firmaIntegridad_(ref, centavos, moneda, secreto) { return hash_(String(ref) + String(centavos) + String(moneda) + String(secreto)); }
function sbxFirmaIntegridad_(ref, centavos, moneda, secreto) { return firmaIntegridad_(ref, centavos, moneda, secreto); }

function valorRuta_(obj, ruta) { return String(ruta || '').split('.').reduce(function (o, k) { return o === undefined || o === null ? undefined : o[k]; }, obj); }
function igualSeguro_(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length || !a.length) return false;
  var r = 0;
  for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function sbxIgual_(a, b) { return igualSeguro_(a, b); }
/** Checksum de eventos: SHA256(valores de signature.properties tomados de data + timestamp + secreto de eventos). */
function verificarEventoWompi_(ev, secreto) {
  if (!ev || !ev.data || !ev.signature || !Array.isArray(ev.signature.properties) || !ev.signature.checksum || ev.timestamp === undefined) return false;
  var cadena = ev.signature.properties.map(function (p) { var v = valorRuta_(ev.data, p); return v === undefined || v === null ? '' : String(v); }).join('') +
    String(ev.timestamp) + secreto;
  return igualSeguro_(hash_(cadena), String(ev.signature.checksum).toLowerCase());
}
function sbxVerificarEvento_(ev, secreto) { return verificarEventoWompi_(ev, secreto); }

/* ---------- comisiones y bloqueo ---------- */
function comisionDeOC_(oc) {
  var cs = tabla_('Comisiones').todas().filter(function (c) { return c['Código OC'] === oc && c['Estado'] !== 'ANULADA'; });
  return cs[cs.length - 1] || null;
}
function sbxComisionDe_(oc) { return comisionDeOC_(oc); }

/** Profesionales bloqueados para NUEVAS oportunidades: {PRO-XXXX: true}. Solo comisiones exigibles de un ambiente con cobro. */
function prosBloqueados_() {
  var out = {};
  try {
    var bloqueaSbx = sbxActivo_() && cfgBool_('SANDBOX_BLOQUEO_PRO');
    tabla_('Comisiones').todas().forEach(function (c) {
      if (ESTADOS_COMISION_BLOQUEAN.indexOf(c['Estado']) < 0) return;
      if (c['Ambiente'] === 'SANDBOX' && !bloqueaSbx) return;
      if (c['Ambiente'] === 'PRODUCCION' || c['Ambiente'] === 'SANDBOX') out[String(c['Código PRO'])] = true;
    });
  } catch (e) { errorSistema_('prosBloqueados', e); }
  return out;
}
function proBloqueado_(pro) { return !!prosBloqueados_()[String(pro)]; }
function sbxProsBloqueados_() { return prosBloqueados_(); }
function sbxProBloqueado_(pro) { return proBloqueado_(pro); }

/* ---------- intento de pago ---------- */
/** Tasa para un ambiente: SANDBOX = ficticia; PRODUCCION = tasaEurCop_() (lanza error si no hay una válida). */
function tasaPara_(ambiente) {
  if (ambiente === 'SANDBOX') return { tasa: cfgNum_('TEST_EXCHANGE_RATE', NaN), fuente: 'TEST_EXCHANGE_RATE (ficticia, solo pruebas)', fecha: new Date() };
  return tasaEurCop_();
}

/** Crea (o reutiliza si es reciente y sin transacción) un intento con referencia única. */
function crearIntentoPago_(oc, ahora) {
  return conLock_(function () {
    var c = comisionDeOC_(oc);
    if (!c) return { ok: false, msg: 'No hay ninguna comisión para ' + oc + '.' };
    var amb = c['Ambiente'];
    if (amb === 'SANDBOX' && !sbxActivo_()) return { ok: false, msg: 'Los pagos de prueba están desactivados.' };
    if (amb === 'PRODUCCION' && !cfgBool_('COMMISSION_COLLECTION_ENABLED')) return { ok: false, msg: 'El cobro de comisiones no está habilitado.' };
    if (amb !== 'SANDBOX' && amb !== 'PRODUCCION') return { ok: false, msg: 'Esta comisión no se cobra (cobro no habilitado en el piloto).' };
    if (c['Estado'] === 'PAID') return { ok: false, pagada: true, msg: 'Esta comisión ya está pagada.' };
    if (c['Estado'] === 'MANUAL_REVIEW') return { ok: false, msg: 'Esta comisión está en revisión. Te escribiremos.' };
    if (ESTADOS_COMISION_BLOQUEAN.indexOf(c['Estado']) < 0) return { ok: false, msg: 'Esta comisión todavía no es exigible.' };
    ahora = ahora || new Date();
    var tp = tabla_('Pagos comisión'), pagos = tp.todas();
    var vigente = pagos.filter(function (x) { return x['Referencia'] === c['Referencia vigente'] && x['Estado'] === 'CREADO' && !x['Transaction ID']; })[0];
    if (vigente && ahora.getTime() - new Date(vigente['Creado']).getTime() < WOMPI.MINUTOS_REUSO_INTENTO * 60000) return { ok: true, pago: vigente, reutilizado: true };
    var fx;
    try { fx = tasaPara_(amb); } catch (e) { return { ok: false, msg: 'Ahora no podemos calcular el importe en pesos. Inténtalo más tarde.', error: String(e.message || e) }; }
    var conv = eurACop_(c['Importe comisión (€)'], fx.tasa);
    var base = referenciaPago_(oc, ahora), ref = base, n = 1;
    var usadas = {}; pagos.forEach(function (x) { usadas[x['Referencia']] = 1; });
    while (usadas[ref]) { n++; ref = base + '-' + n; } // una referencia nunca se reutiliza
    var o = { 'Referencia': ref, 'Código OC': oc, 'Código PRO': c['Código PRO'], 'Comisión (€)': Number(c['Importe comisión (€)']),
      'Tasa EUR→COP': conv.tasa, 'Fuente tasa': fx.fuente, 'Fecha tasa': fx.fecha, 'Importe (COP)': conv.cop, 'Importe (centavos)': conv.centavos,
      'Moneda': WOMPI.MONEDA, 'Creado': ahora, 'Estado': 'CREADO', 'Ambiente': amb, 'Notas': amb === 'SANDBOX' ? 'PRUEBA: tasa ficticia, sin dinero real.' : '' };
    o._fila = tp.agregar(o);
    tabla_('Comisiones').poner(c._fila, { 'Referencia vigente': ref, 'Tasa EUR→COP': conv.tasa, 'Fuente tasa': fx.fuente, 'Fecha tasa': fx.fecha });
    registrar_(amb === 'SANDBOX' ? 'Sandbox' : 'Cobro', 'Intento de pago creado', oc, c['Código PRO'], ref + ' · ' + euros_(o['Comisión (€)']) + ' → ' + conv.cop + ' COP (' + fx.fuente + ')');
    return { ok: true, pago: o };
  });
}
function sbxCrearIntento_(oc, ahora) { return crearIntentoPago_(oc, ahora); }

/** Parámetros del Web Checkout de Wompi (firma calculada aquí; el secreto nunca sale del servidor). */
function checkoutWompi_(pago) {
  var amb = pago['Ambiente'];
  var pub = credWompi_(amb, 'pub'), integ = credWompi_(amb, 'integridad');
  var firma = firmaIntegridad_(pago['Referencia'], pago['Importe (centavos)'], WOMPI.MONEDA, integ);
  var params = { 'public-key': pub, 'currency': WOMPI.MONEDA, 'amount-in-cents': String(pago['Importe (centavos)']),
    'reference': pago['Referencia'], 'signature:integrity': firma, 'redirect-url': String(cfg_('WOMPI_URL_REDIRECCION') || cfg_('URL_WEB') || '') };
  var qs = Object.keys(params).filter(function (k) { return params[k]; }).map(function (k) { return encodeURIComponent(k).replace(/%3A/g, ':') + '=' + encodeURIComponent(params[k]); }).join('&');
  return { url: WOMPI.CHECKOUT_URL + '?' + qs, firma: firma };
}
function sbxCheckout_(pago) { return checkoutWompi_(pago); }

/** URL de la página de pago (?wpago=<token>), ligada a UNA comisión. */
function urlPagoComision_(oc, pro) {
  var t = crearToken_('pago_comision', oc, pro, '', Date.now() + 30 * 86400000);
  return String(cfg_('URL_WEB') || 'https://oficiocerca.pages.dev/').replace(/\/?$/, '/') + 'gestion/#' + t; // página propia (evita /macros/u/N con varias cuentas)
}

/** Página de pago (?wpago=<token>; ?wsbx= se mantiene por compatibilidad). */
function paginaPago_(t) {
  var tok = leerToken_(t);
  if (!tok || (tok['Tipo'] !== 'pago_comision' && tok['Tipo'] !== 'pago_sbx')) return html_('Enlace no válido', '<p>Este enlace no es válido.</p>');
  if (tok.caducado) return html_('Enlace caducado', '<p>Este enlace ya no está vigente. Abre el botón del correo más reciente o tu página de gestión del trabajo.</p>');
  var oc = tok['Código OC'], c = comisionDeOC_(oc);
  if (!c) return html_('Pago no disponible', '<p>No hay ninguna comisión pendiente para este trabajo.</p>');
  var sbx = c['Ambiente'] === 'SANDBOX';
  var aviso = sbx ? '<div class="err"><b>PRUEBA / SANDBOX</b> · Wompi en modo de pruebas. No se cobra dinero real. Usa solo los datos de prueba de Wompi.</div>' : '';
  if (c['Estado'] === 'PAID') return html_('Comisión pagada', aviso + '<div class="ok">Esta comisión ya consta como pagada. ¡Gracias!</div>');
  var r = crearIntentoPago_(oc);
  if (!r.ok) return html_('Pago no disponible', aviso + '<p>' + esc_(r.msg) + '</p>');
  var pg = r.pago, ck = checkoutWompi_(pg);
  return html_('Comisión OficioCerca · ' + oc, aviso + filas_([
    ['Concepto', 'Comisión de OficioCerca por el trabajo ' + oc + ' (la paga el profesional, no el cliente)'],
    ['Comisión', euros_(pg['Comisión (€)'])],
    ['Tasa EUR→COP aplicada', String(pg['Tasa EUR→COP']) + ' · ' + pg['Fuente tasa']],
    ['Importe a pagar', Number(pg['Importe (COP)']).toLocaleString('es-CO') + ' COP'],
    ['Referencia', pg['Referencia']]]) +
    '<a class="btn" target="_top" href="' + esc_(ck.url) + '">' + (sbx ? 'PAGAR COMISIÓN (SANDBOX)' : 'PAGAR COMISIÓN') + '</a>' +
    '<p class="nota">El pago se confirma cuando Wompi nos lo comunica (no al volver a esta página). Al confirmarse vuelves a recibir oportunidades automáticamente.</p>');
}
function sbxPaginaPago_(t) { return paginaPago_(t); }

/* ---------- webhook / URL de eventos ---------- */
var TRANSICION_WOMPI = { APPROVED: 'PAID', PENDING: 'PAYMENT_PENDING', DECLINED: 'PAYMENT_FAILED', ERROR: 'PAYMENT_FAILED', VOIDED: 'PAYMENT_FAILED' };

/** Procesa un evento de Wompi. Solo el evento verificado cambia estados. Idempotente (clave tx.id|status). */
function webhookWompi_(ev) {
  var te = tabla_('Eventos Wompi');
  var tx = (ev && ev.data && ev.data.transaction) || {};
  var base = { 'Recibido': new Date(), 'Evento': s_(ev && ev.event, 60), 'Ambiente': s_(ev && ev.environment, 20), 'Transaction ID': s_(tx.id, 80),
    'Referencia': s_(tx.reference, 80), 'Estado Wompi': s_(tx.status, 20), 'Timestamp': s_(ev && ev.timestamp, 20), 'Repeticiones': 0 };
  var amb = ev && ev.environment === 'test' ? 'SANDBOX' : ev && ev.environment === 'prod' ? 'PRODUCCION' : '';
  var habilitado = amb === 'SANDBOX' ? sbxActivo_() : amb === 'PRODUCCION' ? cfgBool_('COMMISSION_COLLECTION_ENABLED') : false;
  if (!habilitado) {
    te.agregar(Object.assign({}, base, { 'Clave': 'AMB-' + Date.now(), 'Firma válida': '—', 'Resultado': 'RECHAZADO: ambiente no habilitado (' + (ev && ev.environment) + ')' }));
    return { ok: false, error: 'ambiente' };
  }
  var secreto;
  try { secreto = credWompi_(amb, 'eventos'); } catch (e) { errorSistema_('webhookWompi', e); return { ok: false, error: 'configuracion' }; }
  if (!verificarEventoWompi_(ev, secreto)) {
    te.agregar(Object.assign({}, base, { 'Clave': 'FIRMA-' + Date.now(), 'Firma válida': 'NO', 'Resultado': 'RECHAZADO: firma no coincide (no se procesa)' }));
    registrar_('Cobro', 'Evento Wompi rechazado: firma inválida', '', '', tx.reference || '');
    return { ok: false, error: 'firma' };
  }
  if (ev.event !== 'transaction.updated') {
    te.agregar(Object.assign({}, base, { 'Clave': 'OTRO-' + hash_(JSON.stringify(ev.signature)).slice(0, 16), 'Firma válida': 'SÍ', 'Resultado': 'IGNORADO: tipo de evento' }));
    return { ok: true, ignorado: ev.event };
  }
  return conLock_(function () {
    var clave = tx.id + '|' + tx.status;
    var previo = te.todas().filter(function (r) { return r['Clave'] === clave; })[0];
    if (previo) { te.poner(previo._fila, { 'Repeticiones': Number(previo['Repeticiones'] || 0) + 1 }); return { ok: true, duplicado: true }; }
    var resultado = aplicarTransaccion_(tx, amb);
    te.agregar(Object.assign({}, base, { 'Clave': clave, 'Firma válida': 'SÍ', 'Resultado': resultado }));
    return { ok: true, resultado: resultado };
  });
}
function sbxWebhook_(ev) { return webhookWompi_(ev); }

function aplicarTransaccion_(tx, amb) {
  var tp = tabla_('Pagos comisión'), tc = tabla_('Comisiones');
  var pago = tp.buscar('Referencia', tx.reference);
  if (!pago) return 'MANUAL_REVIEW: referencia desconocida';
  if (pago['Ambiente'] !== amb) return 'RECHAZADO: el ambiente del evento no coincide con el del pago';
  var com = comisionDeOC_(pago['Código OC']);
  var ahora = new Date();
  if (Number(tx.amount_in_cents) !== Number(pago['Importe (centavos)']) || tx.currency !== WOMPI.MONEDA) {
    tp.poner(pago._fila, { 'Estado': 'MANUAL_REVIEW', 'Transaction ID': tx.id, 'Estado Wompi': tx.status, 'Fecha estado': ahora, 'Notas': 'Importe o moneda no coinciden con el intento' });
    if (com && com['Estado'] !== 'PAID') tc.poner(com._fila, { 'Estado': 'MANUAL_REVIEW', 'Notas': 'Importe/moneda del evento no coinciden (' + tx.reference + ')' });
    alertaAdmin_('wompi-importe-' + tx.id, 'Cobro', 'Wompi: importe no coincide ' + tx.reference, 'Revisar en «Pagos comisión».');
    return 'MANUAL_REVIEW: importe/moneda';
  }
  if (pago['Estado Wompi'] === 'APPROVED' && tx.status !== 'VOIDED') return 'IGNORADO: la transacción ya estaba aprobada';
  tp.poner(pago._fila, { 'Estado': tx.status, 'Transaction ID': tx.id, 'Estado Wompi': tx.status, 'Fecha estado': ahora });
  if (!com) return 'MANUAL_REVIEW: comisión no encontrada';
  var destino = TRANSICION_WOMPI[tx.status];
  if (!destino) return 'IGNORADO: estado ' + tx.status;
  if (com['Estado'] === 'PAID') {
    if (tx.status === 'VOIDED' && com['Transaction ID'] === tx.id) {
      tc.poner(com._fila, { 'Estado': 'MANUAL_REVIEW', 'Notas': 'Pago anulado (VOIDED) tras haberse marcado PAID' });
      return 'MANUAL_REVIEW: pago anulado';
    }
    if (tx.status === 'APPROVED' && com['Transaction ID'] !== tx.id) {
      tp.poner(pago._fila, { 'Estado': 'MANUAL_REVIEW', 'Notas': 'Segundo pago aprobado para una comisión ya pagada: revisar devolución' });
      alertaAdmin_('wompi-doble-' + tx.id, 'Cobro', 'Wompi: doble pago ' + com['Código OC'], 'Revisar en «Pagos comisión».');
      return 'MANUAL_REVIEW: doble pago';
    }
    return 'SIN CAMBIOS: comisión ya pagada';
  }
  var tipoReg = amb === 'SANDBOX' ? 'Sandbox' : 'Cobro';
  if (destino === 'PAID') {
    tc.poner(com._fila, { 'Estado': 'PAID', 'Transaction ID': tx.id, 'Referencia vigente': tx.reference, 'Importe pagado (COP)': pago['Importe (COP)'],
      'Moneda': tx.currency, 'Fecha pago': ahora, 'Tasa EUR→COP': pago['Tasa EUR→COP'], 'Fuente tasa': pago['Fuente tasa'], 'Fecha tasa': pago['Fecha tasa'] });
    registrar_(tipoReg, 'Comisión pagada (PAID) · profesional desbloqueado', com['Código OC'], com['Código PRO'], tx.reference + ' · ' + tx.id);
    alComisionPagada_(com['Código OC'], com['Código PRO']);
    return 'PROCESADO: PAID';
  }
  // Un intento anterior (no vigente) que falla no degrada un intento vigente en curso
  if (com['Referencia vigente'] && com['Referencia vigente'] !== tx.reference && destino !== 'PAYMENT_PENDING') return 'PROCESADO: intento no vigente (' + tx.status + ')';
  tc.poner(com._fila, { 'Estado': destino });
  registrar_(tipoReg, 'Comisión → ' + destino, com['Código OC'], com['Código PRO'], tx.reference + ' · ' + tx.status);
  if (destino === 'PAYMENT_FAILED') avisarPagoRechazado_(com['Código OC'], com['Código PRO'], tx.reference);
  return 'PROCESADO: ' + destino;
}
/* ============================================================ PRUEBAS E2E V1.6 (ejecución MANUAL desde el editor)
 * Crea registros marcados «PRUEBA SANDBOX» (nunca toca registros reales), recorre el flujo real del backend y deja
 * el resultado en el registro de ejecución. No cobra nada (Wompi SANDBOX, tasa ficticia). No revela secretos.
 * Correos: solo a direcciones controladas oficiocerca+…@gmail.com. Al terminar se borran con limpiarDatosDePrueba().
 */
function sbxE2E_nuevoPro_(etiqueta, email) {
  var pro = siguienteCodigo_('SEQ_PRO', 'PRO-'), ahora = new Date();
  tabla_('Profesionales').agregar({ 'Código': pro, 'Fecha': ahora, 'Estado': 'Activo', 'Nombre': 'PRUEBA SANDBOX Profesional ' + etiqueta,
    'Email': email || 'oficiocerca+sbxpro@gmail.com', 'Servicios (códigos)': 'electricidad, fontaneria', 'Servicios': 'Electricidad, Fontanería', 'Ciudad': 'Córdoba',
    'Distancia': 'Toda la ciudad', 'Zonas': 'PRUEBA', 'Con particulares': 'Sí', 'Con empresas': 'Sí', 'Prioridad': 'Normal',
    'Condiciones (versión)': condVigente_(), 'Condiciones aceptadas (fecha)': ahora, 'Origen': 'PRUEBA SANDBOX', 'Notas internas': 'PRUEBA SANDBOX V1.6' });
  registrarAceptacionCond_(pro, condVigente_(), 'PRUEBA SANDBOX');
  return pro;
}
function sbxE2E_nuevaSol_(etiqueta, pro, email) {
  var oc = siguienteCodigo_('SEQ_OC', 'OC-'), ahora = new Date();
  tabla_('Solicitudes').agregar({ 'Código': oc, 'Fecha': ahora, 'Estado': 'Profesional asignado', 'Tipo solicitante': 'Particular',
    'Nombre': 'PRUEBA SANDBOX Cliente ' + etiqueta, 'Email': email || 'oficiocerca+sbxcli@gmail.com', 'Ciudad': 'Córdoba', 'Zona': 'PRUEBA',
    'Servicio (código)': 'electricidad', 'Servicio': 'Electricidad', 'Descripción': 'PRUEBA SANDBOX V1.6 (no es un trabajo real)',
    'Plazo (código)': 'FLEXIBLE', 'Plazo': 'Flexible / sin fecha concreta', 'Origen': 'PRUEBA SANDBOX', 'Profesional asignado (PRO)': pro,
    'Fecha asignación': ahora, 'Contacto preferido (para el profesional)': 'Correo', 'Notas internas': 'PRUEBA SANDBOX V1.6' });
  return oc;
}

/** Caso completo hasta comisión exigible (DUE) + enlace de pago SANDBOX en el registro. */
function sbxE2E_preparar() {
  conLock_(function () {
    if (!sbxActivo_()) throw new Error('Activa WOMPI_SANDBOX_ENABLED = TRUE (sbxE2E_activar).');
    var pro = sbxE2E_nuevoPro_('A'), oc = sbxE2E_nuevaSol_('A', pro);
    var r1 = registrarAcuerdo_(oc, pro, 3000, 800, 7, 'dias', 'PRUEBA');
    var r2 = { ok: true };
    var r3 = marcarFinalizado_(oc, pro, 3200, 'si', 'PRUEBA: un punto de luz adicional', 800);
    var r4 = procesarFinCliente_(oc, 'si', '', false);
    var c = comisionDeOC_(oc);
    PropertiesService.getScriptProperties().setProperty('SBX_E2E_OC', oc);
    Logger.log(oc + ' / ' + pro + ' · MO inicial 3000 € → final 3200 € + materiales 800 € → comisión ' + c['Importe comisión (€)'] + ' € (10 %: ' + c['Tramo 10 % (€)'] + ' + 5 %: ' + c['Tramo 5 % (€)'] +
      ') · ' + c['Estado'] + ' · pasos ' + [r1.ok, r2.ok, r3.ok, r4.ok].join('/') + ' · bloqueado: ' + proBloqueado_(pro));
  });
  sbxE2E_checkout();
}

function sbxE2E_checkout(oc) {
  oc = oc || PropertiesService.getScriptProperties().getProperty('SBX_E2E_OC');
  var r = crearIntentoPago_(oc, new Date());
  if (!r.ok) { Logger.log(oc + ': ' + r.msg); return; }
  var ck = checkoutWompi_(r.pago);
  Logger.log('Referencia ' + r.pago['Referencia'] + ' · ' + r.pago['Comisión (€)'] + ' € × ' + r.pago['Tasa EUR→COP'] + ' (' + r.pago['Fuente tasa'] + ') = ' + r.pago['Importe (COP)'] + ' COP' + (r.reutilizado ? ' (reutilizado)' : ''));
  Logger.log('PAGINA_PAGO ' + urlPagoComision_(oc, r.pago['Código PRO']));
  Logger.log('CHECKOUT ' + ck.url);
}

/** Estado actual (sin secretos). */
function sbxE2E_estado() {
  var oc = PropertiesService.getScriptProperties().getProperty('SBX_E2E_OC'), c = comisionDeOC_(oc), s = solicitud_(oc);
  Logger.log('Solicitud ' + oc + ': ' + s['Estado'] + ' · comisión ' + JSON.stringify(c && { estado: c['Estado'], tx: c['Transaction ID'], ref: c['Referencia vigente'], cop: c['Importe pagado (COP)'], ambiente: c['Ambiente'] }));
  tabla_('Pagos comisión').todas().filter(function (p) { return p['Código OC'] === oc; }).forEach(function (p) {
    Logger.log('Pago ' + p['Referencia'] + ' · ' + p['Estado'] + ' · tx ' + p['Transaction ID'] + ' · ' + p['Importe (COP)'] + ' COP');
  });
  tabla_('Eventos Wompi').todas().slice(-12).forEach(function (e) {
    Logger.log('Evento ' + e['Evento'] + ' · ' + e['Ambiente'] + ' · ' + e['Referencia'] + ' · ' + e['Estado Wompi'] + ' · firma ' + e['Firma válida'] + ' · ' + e['Resultado'] + ' · rep ' + e['Repeticiones']);
  });
  if (c) Logger.log('Profesional ' + c['Código PRO'] + ' bloqueado para nuevas oportunidades: ' + (proBloqueado_(c['Código PRO']) ? 'SÍ' : 'NO'));
}

/** Activa SOLO el sandbox para la prueba (no toca COMMISSION_COLLECTION_ENABLED). */
function sbxE2E_activar() {
  cfgPoner_('WOMPI_SANDBOX_ENABLED', 'TRUE');
  diagnosticoWompiSandbox();
}
/** Desactiva el sandbox (estado por defecto). La capacidad se conserva: basta volver a ejecutar sbxE2E_activar. */
function sbxE2E_desactivar() { cfgPoner_('WOMPI_SANDBOX_ENABLED', 'FALSE'); diagnosticoWompiSandbox(); }

/** Enlaces de PRUEBA sin correo (útil si la cuota diaria de correo está agotada): seguimiento del cliente, oferta abierta y
 * gestión del profesional de cada solicitud PRUEBA de hoy. Tokens de 1 día. Nunca para solicitudes reales. */
function sbxE2E_enlaces() {
  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd'), web = String(cfg_('URL_WEB_PRUEBAS') || cfg_('URL_WEB')).replace(/\/?$/, '/');
  var tok = function (tipo, oc, pro, ref) { return crearToken_(tipo, oc, pro, ref || '', Date.now() + 86400000); };
  tabla_('Solicitudes').todas().forEach(function (s) {
    if (!esPrueba_(s['Nombre']) || fechaIso_(s['Fecha']) !== hoy) return;
    var oc = s['Código'];
    Logger.log(oc + ' · ' + s['Estado'] + ' · SEGUIMIENTO ' + web + 'seguimiento/#' + tok('seguimiento', oc, ''));
    tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === oc && o['Estado'] === 'Enviada'; }).forEach(function (o) {
      Logger.log(oc + ' · OFERTA a ' + o['Código PRO'] + ' ' + web + 'gestion/#' + tok('oferta', oc, o['Código PRO'], o['ID']));
    });
    if (s['Profesional asignado (PRO)']) Logger.log(oc + ' · GESTIÓN ' + s['Profesional asignado (PRO)'] + ' ' + web + 'gestion/#' + tok('gestion', oc, s['Profesional asignado (PRO)']));
  });
}
/* ============================================================ V1.6 · POLÍTICA DE COMISIÓN, TASA EUR→COP, CONDICIONES,
 * OBLIGACIÓN DE COMISIÓN, SERVICIOS ADICIONALES, RECORDATORIOS Y MIGRACIÓN */

/* ---------- 1. POLÍTICA DE COMISIÓN (ÚNICO LUGAR DONDE VIVE LA FÓRMULA) ----------
 * 10 % sobre los primeros 2.000 € de MANO DE OBRA + 5 % sobre el exceso. Sin tope. Materiales excluidos.
 * Ejemplos: 1.000 → 100 · 2.000 → 200 · 3.000 → 250 · 5.000 → 350 · 10.000 → 600. */
var POLITICA_COMISION = { version: 'COM-2026-10-V2', limiteTramo1: 2000, pctTramo1: 10, pctTramo2: 5,
  texto: '10 % sobre los primeros 2.000 € de mano de obra + 5 % sobre el exceso (sin tope, materiales excluidos)' };

function redondeo2_(n) { return Math.round((Number(n) + 1e-9) * 100) / 100; }

/** Comisión sobre la MANO DE OBRA (los materiales no entran nunca). Devuelve importe y desglose. */
function comisionV16_(manoObra) {
  var mo = Math.max(0, Number(manoObra) || 0), P = POLITICA_COMISION;
  var base1 = Math.min(mo, P.limiteTramo1), base2 = Math.max(mo - P.limiteTramo1, 0);
  var t1 = redondeo2_(base1 * P.pctTramo1 / 100), t2 = redondeo2_(base2 * P.pctTramo2 / 100);
  return { manoObra: mo, tramo1: t1, tramo2: t2, importe: redondeo2_(t1 + t2), politica: P.version, texto: P.texto };
}
/** Compatibilidad: comisionDe_(mo) → { pct (texto), importe }. */
function comisionDe_(manoObra) { var c = comisionV16_(manoObra); return { pct: '10 % / 5 %', importe: c.importe, desglose: c }; }

/* ---------- 2. TASA EUR→COP DE PRODUCCIÓN (capa configurable; nunca usa TEST_EXCHANGE_RATE) ----------
 * FX_MODO = SIN_DEFINIR → no hay tasa: el cobro real no puede arrancar.
 * FX_MODO = MANUAL      → FX_EUR_COP_MANUAL + FX_FECHA_MANUAL (máx. FX_MAX_DIAS de antigüedad).
 * FX_MODO = TRM_BCE     → PROPUESTA (pendiente de aprobación, FX_FUENTE_APROBADA = SI):
 *                         TRM oficial USD/COP (Superintendencia Financiera, datos.gov.co, conjunto 32sa-8pi3)
 *                         × tipo de referencia EUR/USD del Banco Central Europeo (API de datos del BCE). */
function tasaEurCop_() {
  var modo = String(cfg_('FX_MODO') || 'SIN_DEFINIR').toUpperCase(), maxDias = cfgNum_('FX_MAX_DIAS', 3);
  if (modo === 'MANUAL') {
    var t = cfgNum_('FX_EUR_COP_MANUAL', NaN), f = fechaIso_(cfg_('FX_FECHA_MANUAL'));
    if (!(t > 1000 && t < 20000)) throw new Error('FX: tasa manual no válida');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) throw new Error('FX: falta la fecha de la tasa manual');
    var edad = (Date.now() - new Date(f + 'T12:00:00Z').getTime()) / 86400000;
    if (edad > maxDias + 0.5) throw new Error('FX: la tasa manual tiene más de ' + maxDias + ' días');
    return { tasa: t, fuente: 'MANUAL (introducida por el administrador)', fecha: f };
  }
  if (modo === 'TRM_BCE') {
    if (!/^s[ií]$/i.test(String(cfg_('FX_FUENTE_APROBADA') || ''))) throw new Error('FX: la fuente TRM_BCE no está aprobada');
    return tasaTrmBce_();
  }
  throw new Error('FX: tasa de producción sin definir (FX_MODO = SIN_DEFINIR)');
}

/** Propuesta TRM × BCE (solo se usa si se aprueba). Cachea 6 h. */
function tasaTrmBce_() {
  var cache = CacheService.getScriptCache(), c = cache.get('FX_TRM_BCE');
  if (c) return JSON.parse(c);
  var trm = JSON.parse(UrlFetchApp.fetch('https://www.datos.gov.co/resource/32sa-8pi3.json?$order=vigenciadesde%20DESC&$limit=1').getContentText())[0];
  var bce = UrlFetchApp.fetch('https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?lastNObservations=1&format=csvdata').getContentText().trim().split('\n');
  var cab = bce[0].split(','), fila = bce[bce.length - 1].split(',');
  var usdPorEur = Number(fila[cab.indexOf('OBS_VALUE')]), fechaBce = fila[cab.indexOf('TIME_PERIOD')];
  var usdCop = Number(trm.valor);
  if (!(usdPorEur > 0.5 && usdPorEur < 2) || !(usdCop > 1000 && usdCop < 10000)) throw new Error('FX: datos de la fuente fuera de rango');
  var out = { tasa: Math.round(usdCop * usdPorEur * 100) / 100, fuente: 'TRM ' + String(trm.vigenciadesde).slice(0, 10) + ' × BCE EUR/USD ' + fechaBce, fecha: String(trm.vigenciadesde).slice(0, 10) };
  cache.put('FX_TRM_BCE', JSON.stringify(out), 21600);
  return out;
}

/* ---------- 3. OBLIGACIÓN DE COMISIÓN (nace SOLO cuando el cliente confirma el fin) ---------- */
/** moFinal = mano de obra FINAL confirmada (cierre del cliente o resolución de soporte). Nunca materiales. */
function crearObligacionComision_(sol, p, moFinal) {
  var oc = sol['Código'], pro = sol['Profesional asignado (PRO)'];
  var ya = comisionDeOC_(oc);
  if (ya) return { estado: ya['Estado'], importe: Number(ya['Importe comisión (€)']) }; // idempotente
  if (!(Number(moFinal) > 0)) {
    alertaAdmin_('sin-mo-' + oc, 'Excepción', 'Cierre confirmado sin mano de obra final · ' + oc, 'No se ha generado comisión. Revisa la solicitud.');
    return null;
  }
  var pres = { 'ID': sol['Presupuesto vigente'] || '', 'Materiales (€)': sol['Materiales finales (€)'] !== '' ? sol['Materiales finales (€)'] : sol['Materiales aceptados (€)'] };
  var c = comisionV16_(moFinal), amb = ambienteCobro_(sol, p), ahora = new Date();
  var estado = amb ? 'DUE' : 'NO_HABILITADA';
  if (c.importe <= 0) estado = 'NO_HABILITADA';
  tabla_('Comisiones').agregar({ 'Código OC': oc, 'Código PRO': pro, 'Profesional': p ? p['Nombre'] : '', 'Presupuesto': pres['ID'],
    'Mano de obra (€)': c.manoObra, 'Materiales (€)': Number(pres['Materiales (€)']) || 0, 'Porcentaje': c.texto, 'Política': c.politica,
    'Tramo 10 % (€)': c.tramo1, 'Tramo 5 % (€)': c.tramo2, 'Importe comisión (€)': c.importe, 'Fecha generación': ahora, 'Estado': estado,
    'Fecha exigible': estado === 'DUE' ? ahora : '', 'Ambiente': amb || 'NO_HABILITADO', 'Moneda': amb ? WOMPI.MONEDA : '',
    'Notas': amb ? '' : 'Cobro no habilitado en el piloto: solo cálculo y registro (no bloquea).' });
  registrar_(amb === 'SANDBOX' ? 'Sandbox' : 'Sistema', 'Comisión generada (' + estado + ')', oc, pro,
    'MO ' + euros_(c.manoObra) + ' → ' + euros_(c.importe) + ' (10 %: ' + euros_(c.tramo1) + ' + 5 %: ' + euros_(c.tramo2) + ')');
  if (estado === 'DUE' && p) {
    var destino = amb === 'SANDBOX' && emailOk_(cfg_('SANDBOX_EMAIL_TEST')) ? String(cfg_('SANDBOX_EMAIL_TEST')).trim() : p['Email'];
    encolarCorreo_('pro-comision-' + oc, 'comision_exigible', 'Profesional', destino, oc, pro, { token: { tipo: 'gestion', dias: 180 } }, true);
  }
  return { estado: estado, importe: c.importe };
}

/** Pago aprobado (evento verificado): cierre del servicio + aviso al profesional. */
function alComisionPagada_(oc, pro) {
  try {
    var sol = solicitud_(oc);
    if (sol['Estado'] === 'Comisión pendiente') actualizarSol_(sol, { 'Estado': 'Cerrado' });
    var p = profesional_(pro), c = comisionDeOC_(oc);
    var destino = c && c['Ambiente'] === 'SANDBOX' && emailOk_(cfg_('SANDBOX_EMAIL_TEST')) ? String(cfg_('SANDBOX_EMAIL_TEST')).trim() : p && p['Email'];
    if (p) encolarCorreo_('pro-pago-ok-' + oc, 'pago_aprobado_pro', 'Profesional', destino, oc, pro, { token: { tipo: 'gestion', dias: 180 } }, true);
  } catch (e) { errorSistema_('alComisionPagada', e); }
}
function avisarPagoRechazado_(oc, pro, ref) {
  try {
    var p = profesional_(pro), c = comisionDeOC_(oc);
    var destino = c && c['Ambiente'] === 'SANDBOX' && emailOk_(cfg_('SANDBOX_EMAIL_TEST')) ? String(cfg_('SANDBOX_EMAIL_TEST')).trim() : p && p['Email'];
    if (p) encolarCorreo_('pro-pago-ko-' + ref, 'pago_rechazado_pro', 'Profesional', destino, oc, pro, { token: { tipo: 'gestion', dias: 180 } }, true);
  } catch (e) { errorSistema_('avisarPagoRechazado', e); }
}

/* ---------- 4. CONDICIONES PARA PROFESIONALES (versionadas; nunca se sobrescribe la aceptación) ---------- */
function condVigente_() { return String(cfg_('PRO_COND_VERSION') || ''); }
function condAlDia_(p) { return String(p['Condiciones (versión)'] || '').trim() === condVigente_() && !!p['Condiciones aceptadas (fecha)']; }

function registrarAceptacionCond_(pro, version, origen) {
  tabla_('Aceptaciones condiciones').agregar({ 'Fecha': new Date(), 'Código PRO': pro, 'Versión': version, 'Origen': origen });
}

/** El profesional acepta la versión vigente desde su enlace (token 'condiciones'). */
function aceptarCondiciones_(pro) {
  return conLock_(function () {
    var p = profesional_(pro);
    if (!p) return { ok: false, msg: 'Profesional no encontrado.' };
    var v = condVigente_();
    if (condAlDia_(p)) return { ok: true, ya: true, msg: 'Ya habías aceptado la versión vigente (' + v + ').' };
    var antes = p['Condiciones (versión)'];
    tabla_('Profesionales').poner(p._fila, { 'Condiciones (versión)': v, 'Condiciones aceptadas (fecha)': new Date() });
    registrarAceptacionCond_(pro, v, 'Enlace de aceptación (antes: ' + (antes || '—') + ')');
    registrar_('Sistema', 'Condiciones aceptadas ' + v, '', pro, 'Antes: ' + (antes || '—'));
    return { ok: true, msg: 'Gracias. Has aceptado las condiciones ' + v + '. Ya puedes recibir nuevas oportunidades.' };
  });
}

/** Pide a los profesionales ACTIVOS con una versión anterior que acepten la vigente (ejecutar a mano; idempotente). */
function pedirAceptacionCondiciones() {
  var v = condVigente_(), n = 0;
  tabla_('Profesionales').todas().forEach(function (p) {
    if (p['Estado'] !== 'Activo' || condAlDia_(p) || !emailOk_(p['Email'])) return;
    encolarCorreo_('pro-cond-' + v + '-' + p['Código'], 'condiciones_pro', 'Profesional', p['Email'], '', p['Código'], { token: { tipo: 'condiciones', dias: 60 } }, true);
    n++;
  });
  Logger.log('Avisos de nuevas condiciones ' + v + ' en cola: ' + n);
}

/* ---------- 5. SERVICIOS ADICIONALES (cada servicio = su propia OC independiente) ---------- */
function grupoDe_(sol) { return String(sol['Grupo cliente'] || sol['Código']); }
function serviciosDelGrupo_(sol) {
  var g = grupoDe_(sol);
  return tabla_('Solicitudes').todas().filter(function (s) { return grupoDe_(s) === g; });
}

/** Nuevo servicio para el MISMO cliente (datos de contacto copiados del servidor, nunca del navegador). */
function anadirServicio_(ocBase, d, mismoPro) {
  return conLock_(function () {
    var base = solicitud_(ocBase);
    var servicio = normServicio_(d.servicio);
    if (!servicio) return { ok: false, msg: 'Elige el servicio.' };
    if (servicio === 'otro' && !String(d.otro || '').trim()) return { ok: false, msg: 'Indica qué servicio necesitas.' };
    if (!String(d.descripcion || '').trim()) return { ok: false, msg: 'Describe brevemente el trabajo.' };
    var plazo = PLAZOS_CLIENTE[d.plazo] ? d.plazo : 'FLEXIBLE';
    if (plazo === 'OTRA_FECHA' && diasHasta_(d.fecha) === null) return { ok: false, msg: 'Elige una fecha válida.' };
    var p = null;
    if (mismoPro) {
      p = profesional_(base['Profesional asignado (PRO)']);
      if (!p) return { ok: false, msg: 'Este servicio no tiene profesional asignado.' };
      if (p['Estado'] !== 'Activo' || !condAlDia_(p) || proBloqueado_(p['Código'])) return { ok: false, msg: 'Ahora mismo este profesional no puede recibir nuevas solicitudes. Puedes pedir el servicio con «Añadir otro servicio» y buscaremos otro profesional.' };
      if (listaServicios_(p['Servicios (códigos)']).indexOf(servicio) < 0) return { ok: false, msg: 'Este profesional no ofrece ese servicio. Usa «Añadir otro servicio».' };
    }
    // Doble clic: mismo grupo, servicio y descripción en 15 min → misma OC
    var hace = Date.now() - 15 * 60000;
    var previa = serviciosDelGrupo_(base).filter(function (s) { return s['Servicio (código)'] === servicio && String(s['Descripción']) === s_(d.descripcion, 3000) && new Date(s['Fecha']).getTime() > hace; })[0];
    if (previa) return { ok: true, ya: true, msg: 'Ese servicio ya estaba registrado (' + previa['Código'] + ').' };
    var code = siguienteCodigo_('SEQ_OC', 'OC-'), manual = SERVICIOS_ACTIVOS.indexOf(servicio) < 0 && !mismoPro;
    var copia = ['Tipo solicitante', 'Nombre', 'Empresa', 'WhatsApp', 'Teléfono alt.', 'Email', 'Ciudad', 'Código postal', 'Zona',
      'Contacto preferido (para el profesional)', 'Versión consentimiento', 'Consentimiento operativo'];
    var fila = { 'Código': code, 'Fecha': new Date(), 'Estado': manual ? 'Revisión manual' : 'Nueva', 'Servicio (código)': servicio, 'Servicio': SERVICIOS[servicio],
      'Servicio (otro)': s_(d.otro, 120), 'Descripción': s_(d.descripcion, 3000), 'Plazo (código)': plazo, 'Plazo': PLAZOS_CLIENTE[plazo].t,
      'Fecha deseada': plazo === 'OTRA_FECHA' ? "'" + String(d.fecha).slice(0, 10) : '', 'Nº fotos': 0, 'Consentimiento (fecha)': new Date(),
      'Origen': 'Seguimiento de ' + ocBase, 'Grupo cliente': grupoDe_(base), 'Origen servicio': mismoPro ? 'Mismo profesional (' + p['Código'] + ')' : 'Añadido por el cliente',
      'Requiere intervención': manual ? 'Otro servicio: revisar demanda' : '', 'Última actualización': new Date() };
    copia.forEach(function (k) { fila[k] = base[k]; });
    tabla_('Solicitudes').agregar(fila);
    if (!base['Grupo cliente']) tabla_('Solicitudes').poner(base._fila, { 'Grupo cliente': grupoDe_(base) });
    registrar_('Sistema', mismoPro ? 'Servicio pedido al mismo profesional' : 'Servicio añadido por el cliente', code, mismoPro ? p['Código'] : '', 'Desde ' + ocBase);
    encolarCorreo_('cli-confirmacion-' + code, 'confirmacion_cliente', 'Cliente', base['Email'], code, '', {}, true);
    if (mismoPro) {
      var nueva = solicitud_(code);
      ofrecer_(nueva, { pro: p, puntos: '', motivo: 'El cliente pidió este servicio al mismo profesional (' + ocBase + ')' });
    } else marcarPendiente_();
    return { ok: true, code: code, msg: 'Hemos registrado el nuevo servicio ' + code + '. ' + (mismoPro ? 'Se lo hemos pedido a tu profesional; si no puede, buscaremos otro compatible.' : 'Buscamos un profesional compatible y te avisaremos por correo.') };
  });
}

/* ---------- 6. SEGUIMIENTO AUTOMÁTICO (un único motor de avisos y recordatorios) ----------
 * Cada servicio tiene como mucho UNA acción pendiente: «Acción pendiente de» (cliente / profesional / ambos),
 * «Acción desde» (inicio del ciclo), «Plantilla seguimiento» y «Recordatorios enviados» (0–3).
 * Calendario (configurable): aviso 1 al inicio · aviso 2 a las SEG_RECORDATORIO_2_HORAS · último aviso a las
 * SEG_RECORDATORIO_3_HORAS · SEG_CIERRE_HORAS después: si NADIE respondió → «Archivado por inactividad»;
 * si faltaba una sola parte → «En revisión» (soporte avisado). Nunca se cierra, se cobra ni se valora solo.
 * Cualquier acción de las partes detiene el ciclo (pararAccion_). Los correos se recomponen al enviarse:
 * si la acción ya se hizo, no salen. El procesador de cada minuto solo trabaja cuando llega una fecha programada.
 */
var PLANTILLAS_SEGUIMIENTO = ['vencimiento', 'actualizar_plazo', 'confirmar_cierre', 'registrar_cierre', 'registrar_acuerdo'];

function horasSeg_() {
  return [0, cfgNum_('SEG_RECORDATORIO_2_HORAS', 48), cfgNum_('SEG_RECORDATORIO_3_HORAS', 120), cfgNum_('SEG_RECORDATORIO_3_HORAS', 120) + cfgNum_('SEG_CIERRE_HORAS', 48)];
}
function iniciarAccion_(sol, quien, plantilla, cuando) {
  var ahora = cuando ? new Date(cuando) : new Date();
  actualizarSol_(sol, { 'Acción pendiente de': quien, 'Acción desde': ahora, 'Plantilla seguimiento': plantilla, 'Recordatorios enviados': 0, 'Último aviso': '' });
  programarRevision_(ahora);
}
function pararAccion_(sol) {
  if (sol['Acción pendiente de'] || sol['Acción desde']) actualizarSol_(sol, { 'Acción pendiente de': '', 'Acción desde': '', 'Plantilla seguimiento': '', 'Recordatorios enviados': '', 'Último aviso': '' });
}
/** Próxima fecha en la que el motor tiene trabajo (Propiedad PROX_SEGUIMIENTO, en ms). */
function programarRevision_(fecha) {
  var props = PropertiesService.getScriptProperties(), t = new Date(fecha).getTime(), act = Number(props.getProperty('PROX_SEGUIMIENTO')) || Infinity;
  if (t < act) props.setProperty('PROX_SEGUIMIENTO', String(t));
}
function seguimientoVencido_() {
  var t = Number(PropertiesService.getScriptProperties().getProperty('PROX_SEGUIMIENTO'));
  return t > 0 && t <= Date.now();
}

function enviarSeguimiento_(sol, n) {
  var oc = sol['Código'], pro = sol['Profesional asignado (PRO)'], p = pro ? profesional_(pro) : null, quien = sol['Acción pendiente de'];
  var desde = new Date(sol['Acción desde']).getTime(), plantilla = sol['Plantilla seguimiento'];
  var datos = { plantilla: plantilla, n: n, desde: desde, ultimo: n === 2 };
  if (/cliente|ambos/.test(quien)) encolarCorreo_('seg-' + oc + '-' + desde + '-' + n + '-c', 'seguimiento', 'Cliente', sol['Email'], oc, pro, datos, true);
  if (/profesional|ambos/.test(quien) && p) encolarCorreo_('seg-' + oc + '-' + desde + '-' + n + '-p', 'seguimiento', 'Profesional', p['Email'], oc, pro,
    Object.assign({ token: { tipo: 'gestion', dias: 180 } }, datos), true);
}

/** Motor: vencimientos, recordatorios, archivo por inactividad y escalado a revisión manual. Idempotente. */
function motorSeguimiento_() {
  var ahora = Date.now(), H = horasSeg_(), prox = Infinity;
  var acuerdoMs = cfgNum_('SEG_ACUERDO_DIAS', 3) * 86400000;
  var hayPres = {};
  tabla_('Presupuestos').todas().forEach(function (r) { hayPres[r['Código OC']] = 1; });
  tabla_('Solicitudes').todas().forEach(function (s) {
    var est = s['Estado'], oc = s['Código'];
    if (!s['Acción pendiente de']) {
      // Nuevos ciclos: llega la fecha estimada · profesional asignado que aún no registró el acuerdo
      if (est === 'Trabajo en proceso' && s['Fecha estimada fin']) {
        var fin = new Date(s['Fecha estimada fin']).getTime();
        if (fin <= ahora) { iniciarAccion_(s, 'ambos', 'vencimiento', ahora); registrar_('Sistema', 'Llegó la fecha estimada de finalización', oc, s['Profesional asignado (PRO)'], fecha_(fin)); }
        else { prox = Math.min(prox, fin); return; }
      } else if (est === 'Profesional asignado' && !hayPres[oc] && s['Fecha asignación']) {
        var lim = new Date(s['Fecha asignación']).getTime() + acuerdoMs;
        if (lim <= ahora) iniciarAccion_(s, 'profesional', 'registrar_acuerdo', ahora);
        else { prox = Math.min(prox, lim); return; }
      } else return;
    }
    if (ESTADOS_ACTIVOS_SERVICIO.indexOf(est) < 0 || est === 'Archivado por inactividad') { pararAccion_(s); return; }
    var desde = new Date(s['Acción desde']).getTime(), n = Number(s['Recordatorios enviados']) || 0;
    if (n < 3) {
      var cuando = desde + H[n] * 3600000;
      if (cuando <= ahora) {
        enviarSeguimiento_(s, n);
        actualizarSol_(s, { 'Recordatorios enviados': n + 1, 'Último aviso': new Date(ahora) });
        n++;
        // Nunca se escala en la misma pasada en que sale un aviso: la parte siempre conserva su margen tras el último.
        prox = Math.min(prox, n < 3 ? desde + H[n] * 3600000 : Math.max(desde + H[3] * 3600000, ahora + (H[3] - H[2]) * 3600000));
        return;
      }
      prox = Math.min(prox, desde + H[n] * 3600000); return;
    }
    var ultAviso = s['Último aviso'] ? new Date(s['Último aviso']).getTime() : desde + H[2] * 3600000;
    var limite = Math.max(desde + H[3] * 3600000, ultAviso + (H[3] - H[2]) * 3600000);
    if (limite > ahora) { prox = Math.min(prox, limite); return; }
    // Agotados los avisos
    var quien = s['Acción pendiente de'];
    if (quien === 'ambos') {
      actualizarSol_(s, { 'Estado previo': est, 'Estado': 'Archivado por inactividad', 'Escalado por': 'ambos', 'Requiere intervención': '' });
      pararAccion_(s);
      registrar_('Sistema', 'Archivado por inactividad (cierre no confirmado)', oc, s['Profesional asignado (PRO)'], 'Nadie respondió a 3 avisos');
    } else {
      actualizarSol_(s, { 'Estado previo': est, 'Estado': 'En revisión', 'Escalado por': quien, 'Requiere intervención': 'Sin respuesta del ' + quien + ' tras 3 avisos' });
      pararAccion_(s);
      registrar_('Sistema', 'Escalado a revisión manual', oc, s['Profesional asignado (PRO)'], 'Sin respuesta del ' + quien);
      alertaAdmin_('esc-' + oc + '-' + desde, 'Revisión', 'Revisión manual · ' + oc + ' (sin respuesta del ' + quien + ')',
        'El servicio ' + oc + ' necesitaba una acción del ' + quien + ' y no hubo respuesta tras 3 avisos. Queda «En revisión». No se ha cerrado ni cobrado nada.');
    }
  });
  var props = PropertiesService.getScriptProperties();
  if (prox < Infinity) props.setProperty('PROX_SEGUIMIENTO', String(prox)); else props.deleteProperty('PROX_SEGUIMIENTO');
  // Valoración: UN aviso si el cliente confirmó el cierre hace > 24 h y no ha valorado
  var vals = {}; tabla_('Valoraciones').todas().forEach(function (v) { vals[v['Código OC']] = 1; });
  tabla_('Solicitudes').todas().forEach(function (s) {
    if (ESTADOS_TRAS_CONFIRMAR_FIN.indexOf(s['Estado']) < 0 || !s['Cliente confirmó fin (fecha)'] || vals[s['Código']]) return;
    if (ahora - new Date(s['Cliente confirmó fin (fecha)']).getTime() > 86400000) encolarCorreo_('cli-valorar-' + s['Código'], 'valorar_cliente', 'Cliente', s['Email'], s['Código'], s['Profesional asignado (PRO)'], {}, true);
  });
  // Comisión exigible: un recordatorio a los 3 días
  tabla_('Comisiones').todas().forEach(function (c) {
    if (c['Estado'] !== 'DUE' || !c['Fecha exigible'] || ahora - new Date(c['Fecha exigible']).getTime() < 3 * 86400000) return;
    var p = profesional_(c['Código PRO']);
    if (!p) return;
    var destino = c['Ambiente'] === 'SANDBOX' && emailOk_(cfg_('SANDBOX_EMAIL_TEST')) ? String(cfg_('SANDBOX_EMAIL_TEST')).trim() : p['Email'];
    encolarCorreo_('pro-rec-comision-' + c['Código OC'], 'recordatorio_comision', 'Profesional', destino, c['Código OC'], c['Código PRO'], { token: { tipo: 'gestion', dias: 180 } }, true);
  });
}
function recordatoriosV16_() { motorSeguimiento_(); } // compatibilidad

/* ---------- 7. INSTALACIÓN / MIGRACIÓN V1.6 (idempotente; no borra datos) ---------- */
var MIGRACION_ESTADOS_V16 = {
  'Presupuesto enviado': 'Acuerdo pendiente del cliente', 'Presupuesto no aceptado': 'Acuerdo no confirmado', 'Cliente aceptó': 'Acuerdo confirmado',
  'Finalizado': 'Cerrado', 'Valorada': 'Cerrado'
};
var MIGRACION_PRES_V16 = { 'Enviado al cliente': 'Pendiente del cliente', 'Aceptado': 'Confirmado', 'No aceptado': 'No confirmado' };
var MIGRACION_COM_V16 = { 'Generada': 'NO_HABILITADA', 'Pendiente de habilitación': 'NO_HABILITADA', 'Pendiente': 'DUE', 'Pagada': 'PAID', 'En revisión': 'MANUAL_REVIEW', 'Anulada': 'ANULADA' };

function instalarV16() {
  instalarV14();      // pestañas/cabeceras nuevas (Pagos comisión, Eventos Wompi, Aceptaciones condiciones) + configuración
  instalarWompi();    // claves de cobro (sandbox / producción desactivada / tasa)
  conLock_(function () {
    var ts = tabla_('Solicitudes');
    ts.todas().forEach(function (s) {
      var n = MIGRACION_ESTADOS_V16[s['Estado']];
      if (n) { ts.poner(s._fila, { 'Estado': n, 'Cliente confirmó fin (fecha)': /Finalizado|Valorada/.test(s['Estado']) ? (s['Finalizado (fecha)'] || new Date()) : s['Cliente confirmó fin (fecha)'] }); }
    });
    var tp = tabla_('Presupuestos');
    tp.todas().forEach(function (r) { var n = MIGRACION_PRES_V16[r['Estado']]; if (n) tp.poner(r._fila, { 'Estado': n }); });
    var tc = tabla_('Comisiones');
    tc.todas().forEach(function (r) { var n = MIGRACION_COM_V16[r['Estado']]; if (n) tc.poner(r._fila, { 'Estado': n, 'Ambiente': r['Ambiente'] || 'NO_HABILITADO' }); });
    var tcfg = tabla_('Configuración'), obs = tcfg.buscar('Clave', 'COMISION_MAXIMO_EUR');
    if (obs) tcfg.poner(obs._fila, { 'Valor': 'OBSOLETO', 'Descripción': 'Ya no se usa desde V1.6 (sin tope). Política: COMISION_POLITICA.' });
    var obs2 = tcfg.buscar('Clave', 'COMISION_PORCENTAJE');
    if (obs2) tcfg.poner(obs2._fila, { 'Valor': 'OBSOLETO', 'Descripción': 'Ya no se usa desde V1.6. Política: COMISION_POLITICA.' });
    _cfg = null;
    cfgPoner_('COMISION_POLITICA', POLITICA_COMISION.version);
  });
  Logger.log('V1.6 instalada. Condiciones vigentes: ' + condVigente_() + ' · política ' + POLITICA_COMISION.version);
}

/* ---------- 8. INSTALACIÓN / MIGRACIÓN V1.7 (idempotente; no borra datos) ---------- */
var MIGRACION_ESTADOS_V17 = { 'Acuerdo pendiente del cliente': 'Trabajo en proceso', 'Acuerdo no confirmado': 'Profesional asignado',
  'Acuerdo confirmado': 'Trabajo en proceso', 'Sin profesional compatible': 'Sin profesional disponible' };
function instalarV17() {
  instalarV16();
  conLock_(function () {
    var ts = tabla_('Solicitudes');
    ts.todas().forEach(function (s) { var n = MIGRACION_ESTADOS_V17[s['Estado']]; if (n) ts.poner(s._fila, { 'Estado': n }); });
    var tp = tabla_('Presupuestos');
    tp.todas().forEach(function (r) { if (['Pendiente del cliente', 'Confirmado', 'No confirmado'].indexOf(r['Estado']) >= 0) tp.poner(r._fila, { 'Estado': 'Registrado' }); });
    // Fechas con hora exacta visibles en la hoja (el valor guardado siempre incluye la hora)
    var sh = ts.sh;
    ['Fecha registro acuerdo', 'Fecha estimada fin', 'Acción desde', 'Último aviso', 'Fecha asignación'].forEach(function (c) {
      var i = ESQUEMA['Solicitudes'].indexOf(c);
      if (i >= 0 && sh && sh.getRange) { try { sh.getRange(2, i + 1, Math.max(1, sh.getMaxRows() - 1), 1).setNumberFormat('dd/MM/yyyy HH:mm'); } catch (e) { } }
    });
  });
  Logger.log('V1.7 instalada. Condiciones vigentes: ' + condVigente_() + ' · seguimiento: ' + JSON.stringify(horasSeg_()) + ' h');
}
