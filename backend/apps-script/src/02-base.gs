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
