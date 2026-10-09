/* Pruebas OFFLINE V1.7 (node backend/apps-script/tests/v17.test.js): flujo completo, comisión 10 %/5 %, acuerdo, seguimiento,
 * varios servicios, correos, recordatorios, Wompi (sandbox y guardas de producción), bloqueo y activadores.
 * Ejecuta el Code.gs real con simuladores de Apps Script en memoria. Sin red, sin Wompi, sin dinero.
 * Los "secretos" de aquí son FALSOS y generados al vuelo: no son credenciales de Wompi. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');

function crearEntorno() {
  const sheets = {}, props = {}, enviados = [], triggers = [], cache = {};
  const fakeSecret = p => p + crypto.randomBytes(16).toString('hex');
  const S = { evento: fakeSecret('test_events_FAKE'), integ: fakeSecret('test_integrity_FAKE') };
  function Sheet(name) {
    this.name = name; this.rows = [];
  }
  Sheet.prototype = {
    getLastRow() { return this.rows.length; },
    appendRow(r) { this.rows.push(r.slice()); },
    getRange(r, c, nr, nc) {
      const sh = this; nr = nr || 1; nc = nc || 1;
      return {
        getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = sh.rows[r - 1 + i] || []; const x = []; for (let j = 0; j < nc; j++) x.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); o.push(x); } return o; },
        setValue(v) { while (sh.rows.length < r) sh.rows.push([]); sh.rows[r - 1][c - 1] = v; return this; },
        setValues(vs) { vs.forEach((row, i) => row.forEach((v, j) => { while (sh.rows.length < r + i) sh.rows.push([]); sh.rows[r - 1 + i][c - 1 + j] = v; })); return this; },
        insertCheckboxes() { return this; },
        createTextFinder(txt) { const rng = this; let mE = false; return { matchEntireCell(v) { mE = v; return this; }, findNext() {
          for (let i = 0; i < nr; i++) { const v = String((sh.rows[r - 1 + i] || [])[c - 1] ?? ''); if (mE ? v === txt : v.includes(txt)) return { getRow: () => r + i }; } return null; } }; }
      };
    },
    setFrozenRows() { }, setTabColor() { }, getSheetId() { return 123; }
  };
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), deleteSheet() { }, getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST/edit' };
  function fmt(d, tz, pat) {
    const p = {}; new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
      .formatToParts(new Date(d)).forEach(x => p[x.type] = x.value);
    if (p.hour === '24') p.hour = '00';
    return pat.replace('yyyy', p.year).replace('MM', p.month).replace('dd', p.day).replace('HH', p.hour).replace('mm', p.minute).replace('ss', p.second);
  }
  const ctx = {
    console: { log() { }, error() { } }, Logger: { log() { } }, JSON, Math, Date, Number, String, Array, Object, RegExp, Error, isNaN, parseInt, parseFloat, encodeURIComponent,
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); }, deleteProperty: k => { delete props[k]; }, getProperties: () => Object.assign({}, props) }) },
    SpreadsheetApp: { openById: () => ss, flush() { } },
    LockService: { getScriptLock: () => ({ waitLock() { }, releaseLock() { } }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (a, s) => Array.from(crypto.createHash('sha256').update(String(s), 'utf8').digest()).map(b => (b > 127 ? b - 256 : b)),
      formatDate: fmt, getUuid: () => crypto.randomUUID()
    },
    MailApp: { getRemainingDailyQuota: () => 100, sendEmail: o => enviados.push(o) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: s => ({ s, setMimeType() { return this; } }) },
    HtmlService: { createHtmlOutput: h => ({ h, setTitle() { return this; }, addMetaTag() { return this; } }) },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }), getProjectTriggers: () => triggers.slice(),
      deleteTrigger: t => { const i = triggers.indexOf(t); if (i >= 0) triggers.splice(i, 1); },
      newTrigger: f => { const b = { forSpreadsheet: () => b, onEdit: () => b, onOpen: () => b, timeBased: () => b, everyMinutes: () => b, atHour: () => b, nearMinute: () => b, everyDays: () => b, inTimezone: () => b,
        create: () => { const t = { getHandlerFunction: () => f, getEventType: () => 'X' }; triggers.push(t); return t; } }; return b; }
    },
    Session: { getEffectiveUser: () => ({ getEmail: () => 'oficiocerca@gmail.com' }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put(k, v) { cache[k] = v; } }) },
    UrlFetchApp: { fetch: () => { throw new Error('sin red en las pruebas'); } },
    DriveApp: {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  props.SPREADSHEET_ID = 'TEST';
  Object.keys(ctx.ESQUEMA).forEach(n => { if (!sheets[n]) { sheets[n] = new Sheet(n); sheets[n].appendRow(ctx.ESQUEMA[n]); } });
  ctx.CONFIG_DEFECTO.forEach(r => ctx.tabla_('Configuración').agregar({ Clave: r[0], Valor: r[1], 'Descripción': r[2] }));
  ctx.instalarWompi();
  ctx.cfgPoner_('URL_APP', 'https://script.google.com/macros/s/TEST/exec');
  return { ctx, sheets, props, enviados, S, triggers };
}



/* ===================================================== AYUDAS */
const cfg = (E, k, v) => E.ctx.cfgPoner_(k, v);
function activarSandbox(E) {
  cfg(E, 'WOMPI_SANDBOX_ENABLED', 'TRUE');
  E.props.WOMPI_TEST_PUBLIC_KEY = 'pub_test_FAKEPUBLICKEY000';
  E.props.WOMPI_TEST_INTEGRITY_SECRET = E.S.integ;
  E.props.WOMPI_TEST_EVENTS_SECRET = E.S.evento;
}
let nPro = 0;
function nuevoPro(E, nombre, extra) {
  const code = E.ctx.siguienteCodigo_('SEQ_PRO', 'PRO-'); nPro++;
  E.ctx.tabla_('Profesionales').agregar(Object.assign({ 'Código': code, Fecha: new Date(Date.now() - nPro * 1000), Estado: 'Activo', Nombre: nombre || 'PRUEBA Profesional', Email: 'pro' + code + nPro + '@example.com',
    'Servicios (códigos)': 'electricidad, fontaneria', Servicios: 'Electricidad, Fontanería', 'Condiciones (versión)': E.ctx.condVigente_(), 'Condiciones aceptadas (fecha)': new Date(),
    'Con particulares': 'Sí', 'Con empresas': 'Sí', Ciudad: 'Córdoba', Distancia: 'Toda la ciudad', Zonas: 'Centro', WhatsApp: "'600111222", Prioridad: 'Normal' }, extra || {}));
  return code;
}
function postWeb(E, o) { return JSON.parse(E.ctx.doPost({ postData: { contents: JSON.stringify(o) } }).s); }
let nSol = 0;
function solicitudWeb(E, nombre, oficio, zona) {
  nSol++;
  return postWeb(E, { tipo: 'solicitud', tipoSolicitante: 'Particular', nombre: nombre || 'PRUEBA Cliente', whatsapp: '6' + String(10000000 + nSol),
    email: 'cli' + nSol + '@example.com', zona: zona || 'Centro', oficio: oficio || 'electricidad', descripcion: 'Trabajo ' + nSol, plazo: 'FLEXIBLE', consentOperativo: 'si', contactoPreferido: 'WhatsApp' });
}
const tokenDe = (html, ruta) => { const m = new RegExp(ruta + '/#([a-f0-9]{64})').exec(html); return m && m[1]; };
const correosA = (E, to) => E.enviados.filter(m => m.to === to);
function ultimoToken(E, to, ruta) { const ms = correosA(E, to); for (let i = ms.length - 1; i >= 0; i--) { const t = tokenDe(ms[i].htmlBody, ruta); if (t) return t; } return null; }
function accionWeb(E, t, p) { return postWeb(E, { tipo: 'accion', t, p }); }
function pagina(E, t) { return postWeb(E, { tipo: 'pagina', t }); }
function tick(E) { E.ctx.procesarPendientes(); E.ctx.procesarCola_(); }
const sol = (E, oc) => E.ctx.solicitud_(oc);
function setSol(E, oc, o) { const s = sol(E, oc); E.ctx.tabla_('Solicitudes').poner(s._fila, o); E.ctx.tabla_('Solicitudes')._cache = null; }
const H = 3600000;

/** Hasta «Profesional asignado» por la web. */
function hastaAsignado(E, nombres) {
  nombres = nombres || {};
  const pro = nuevoPro(E, nombres.pro, nombres.extra), r = solicitudWeb(E, nombres.cli);
  assert.ok(r.ok, JSON.stringify(r));
  const oc = r.code; tick(E);
  const pEmail = E.ctx.profesional_(pro)['Email'];
  const tOferta = ultimoToken(E, pEmail, 'gestion'); assert.ok(tOferta, 'token de oferta');
  assert.ok(accionWeb(E, tOferta, { a: 'si', disp: 'MANANA' }).ok);
  tick(E);
  const tG = ultimoToken(E, pEmail, 'gestion'), email = sol(E, oc)['Email'], tS = ultimoToken(E, email, 'seguimiento');
  assert.ok(tG && tG !== tOferta && tS);
  return { pro, oc, email, pEmail, tG, tS };
}
function conAcuerdo(E, mo, dn, du, nombres) {
  const F = hastaAsignado(E, nombres);
  const r = accionWeb(E, F.tG, { a: 'acuerdo', mo, mat: '', dn: dn || 7, du: du || 'dias' }); assert.ok(r.ok, r.msg);
  return F;
}
function evento(E, tx, opts) {
  opts = opts || {};
  const ev = { event: 'transaction.updated', data: { transaction: tx }, environment: opts.env || 'test', timestamp: opts.ts || Math.floor(Date.now() / 1000),
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'] } };
  const cadena = ev.signature.properties.map(p => p.split('.').reduce((o, k) => o[k], ev.data)).join('') + ev.timestamp + (opts.secreto || E.S.evento);
  ev.signature.checksum = crypto.createHash('sha256').update(cadena).digest('hex');
  return ev;
}
function txDe(pago, status, id) { return { id: id || ('15113-' + crypto.randomBytes(4).toString('hex')), status, reference: pago['Referencia'], amount_in_cents: pago['Importe (centavos)'], currency: 'COP' }; }

const resultados = [];
function caso(nombre, fn) { try { fn(); resultados.push(['OK', nombre]); } catch (e) { resultados.push(['ERROR', nombre + ' → ' + (e && e.stack || e)]); } }

/* ===================================================== CASOS V1.7 */
let E, F;
caso('1. El profesional recibe el contacto con el mensaje de inicio del trabajo y un botón', () => {
  E = crearEntorno(); F = hastaAsignado(E);
  const m = correosA(E, F.pEmail).filter(x => /Cliente asignado/.test(x.subject))[0];
  assert.ok(m && /Recibir el contacto inicia el trabajo en OficioCerca/.test(m.htmlBody) && /GESTIONAR ESTE TRABAJO/.test(m.htmlBody));
  const mc = correosA(E, F.email).filter(x => /Ya encontramos un profesional/.test(x.subject))[0];
  assert.ok(mc && /VER MI SEGUIMIENTO/.test(mc.htmlBody) && /directamente entre vosotros/.test(mc.htmlBody));
  assert.ok(/REGISTRAR ACUERDO ALCANZADO/.test(pagina(E, F.tG).cuerpo));
});
caso('2. La cotización ocurre fuera: OficioCerca no pide al cliente aceptar ni negociar nada', () => {
  const pg = pagina(E, F.tS).cuerpo;
  assert.ok(!/cotizaci|presupuesto|Confirmar acuerdo|negoci/i.test(pg.replace(/El precio y las condiciones los acordáis/, '')), 'sin lenguaje de cotización para el cliente');
  assert.ok(/acordáis entre vosotros/.test(pg));
});
caso('3–7. Acuerdo inicial: mano de obra y duración obligatorias, materiales opcionales, fin estimado = registro + duración', () => {
  assert.ok(!accionWeb(E, F.tG, { a: 'acuerdo', mo: '', dn: 7, du: 'dias' }).ok, 'MO obligatoria');
  assert.ok(!accionWeb(E, F.tG, { a: 'acuerdo', mo: 1500, dn: '', du: 'dias' }).ok, 'duración obligatoria');
  const n0 = E.enviados.length, antes = Date.now();
  const r = accionWeb(E, F.tG, { a: 'acuerdo', mo: 1500, mat: '', dn: 7, du: 'dias' });
  assert.ok(r.ok, r.msg);
  const s = sol(E, F.oc), fin = new Date(s['Fecha estimada fin']).getTime(), reg = new Date(s['Fecha registro acuerdo']).getTime();
  assert.strictEqual(s['Estado'], 'Trabajo en proceso');
  assert.strictEqual(fin - reg, 7 * 86400000, 'exactamente 7 días');
  assert.ok(reg >= antes - 1000);
  assert.strictEqual(Number(s['Mano de obra inicial (€)']), 1500);
  assert.strictEqual(s['Duración estimada'], '7 días');
  tick(E);
  assert.ok(!E.enviados.slice(n0).some(m => m.to === F.email), 'el cliente NO recibe un correo para negociar');
  assert.ok(/Los materiales no generan comisión/.test(pagina(E, hastaAsignado(E).tG).cuerpo));
  assert.ok(/Mano de obra acordada/.test(pagina(E, F.tS).cuerpo), 'el acuerdo es visible en el seguimiento');
  assert.strictEqual(E.ctx.duracion_(36, 'horas').ms, 36 * H);
  assert.strictEqual(E.ctx.duracion_(2, 'semanas').ms, 14 * 86400000);
});
caso('8. El seguimiento llega al vencimiento (el procesador de cada minuto lo detecta)', () => {
  setSol(E, F.oc, { 'Fecha estimada fin': new Date(Date.now() - 60000) });
  E.props.PROX_SEGUIMIENTO = String(Date.now() - 60000);
  const n0 = E.enviados.length;
  E.ctx.procesarPendientes();
  const nuevos = E.enviados.slice(n0);
  assert.ok(nuevos.some(m => m.to === F.email && /Indica el estado del servicio/.test(m.subject)), 'cliente');
  assert.ok(nuevos.some(m => m.to === F.pEmail && /Indica el estado del servicio/.test(m.subject)), 'profesional');
  assert.strictEqual(sol(E, F.oc)['Acción pendiente de'], 'ambos');
  E.ctx.procesarPendientes(); E.ctx.motorSeguimiento_();
  assert.strictEqual(E.enviados.slice(n0).filter(m => /Indica el estado/.test(m.subject)).length, 2, 'sin duplicados');
});
caso('9. El profesional actualiza el plazo: nueva fecha, historial conservado, se detienen los avisos', () => {
  const r = accionWeb(E, F.tG, { a: 'plazo', dn: 3, du: 'dias', nota: 'falta material' });
  assert.ok(r.ok, r.msg);
  const s = sol(E, F.oc);
  assert.strictEqual(s['Acción pendiente de'], '');
  assert.ok(new Date(s['Fecha estimada fin']).getTime() > Date.now() + 2.9 * 86400000);
  assert.ok(/Acuerdo registrado/.test(s['Historial plazos']) && /Plazo actualizado/.test(s['Historial plazos']));
});
caso('10. El cliente indica «Sigue en proceso» → se pide al profesional que actualice el plazo', () => {
  setSol(E, F.oc, { 'Fecha estimada fin': new Date(Date.now() - 1000) });
  const n0 = E.enviados.length;
  assert.ok(accionWeb(E, F.tS, { a: 'sigue' }).ok);
  tick(E);
  assert.ok(E.enviados.slice(n0).some(m => m.to === F.pEmail && /Actualiza el plazo/.test(m.subject)));
  assert.ok(!E.enviados.slice(n0).some(m => m.to === F.email), 'no se insiste al cliente');
  assert.strictEqual(sol(E, F.oc)['Acción pendiente de'], 'profesional');
  const pc = pagina(E, F.tS).cuerpo;
  assert.ok(/Indicaste que el trabajo sigue en proceso/.test(pc) && !/a:\\'sigue\\'/.test(pc), 'el cliente ve que espera al profesional y no repite');
  assert.ok(/Registra la nueva duración estimada/.test(pagina(E, F.tG).cuerpo));
});
caso('11–12 + 17–18. Cierre por el profesional con adicionales (motivo obligatorio) → el cliente confirma → comisión sobre el valor FINAL', () => {
  assert.ok(!accionWeb(E, F.tG, { a: 'finalizado', mo: 2600, adicionales: 'si', motivo: '' }).ok, 'motivo obligatorio si cambia');
  assert.ok(accionWeb(E, F.tG, { a: 'finalizado', mo: 2600, adicionales: 'si', motivo: 'Cambio de dos enchufes extra', mat: 300 }).ok);
  const s = sol(E, F.oc);
  assert.strictEqual(s['Estado'], 'Finalización por confirmar');
  assert.strictEqual(s['Trabajos adicionales'], 'Sí');
  tick(E);
  assert.ok(correosA(E, F.email).some(m => /Confirma el cierre/.test(m.subject)));
  const pg = pagina(E, F.tS).cuerpo;
  ['1500,00 €', '2600,00 €', 'Cambio de dos enchufes extra', 'Sí, el trabajo terminó y confirmo', 'Todavía no está terminado', 'HAY UN PROBLEMA'].forEach(t => assert.ok(pg.includes(t), 'falta ' + t));
  assert.ok(!/omisi/i.test(pg), 'el cliente no ve la comisión');
  assert.ok(accionWeb(E, F.tS, { a: 'fin_si' }).ok);
  const c = E.ctx.comisionDeOC_(F.oc);
  assert.strictEqual(c['Importe comisión (€)'], 230, '10 % de 2000 + 5 % de 600');
  assert.strictEqual(c['Mano de obra (€)'], 2600);
  assert.strictEqual(sol(E, F.oc)['Estado'], 'Cerrado');
});
caso('32 + 34. Reseña válida tras el cierre (trabajo verificado) y aviso corto al profesional; reputación visible', () => {
  assert.ok(accionWeb(E, F.tS, { a: 'valorar', estrellas: 5, comentario: 'Muy bien' }).ok);
  const v = E.ctx.tabla_('Valoraciones').todas()[0];
  assert.strictEqual(v['Trabajo verificado'], 'Sí');
  tick(E);
  assert.ok(correosA(E, F.pEmail).some(m => /Recibiste una nueva valoración de 5 estrellas en/.test(m.body)));
  const pg = pagina(E, F.tG).cuerpo;
  assert.ok(/Tu reputación en OficioCerca/.test(pg) && /5 \/ 5/.test(pg));
});
caso('13–14. Cliente: «Todavía no» vuelve a proceso; «Hay un problema» → En revisión (cierre y cobro detenidos)', () => {
  const E2 = crearEntorno(), G = conAcuerdo(E2, 800);
  accionWeb(E2, G.tG, { a: 'finalizado', mo: 800 });
  assert.ok(accionWeb(E2, G.tS, { a: 'fin_aun_no' }).ok);
  assert.strictEqual(sol(E2, G.oc)['Estado'], 'Trabajo en proceso');
  assert.strictEqual(sol(E2, G.oc)['Acción pendiente de'], 'profesional');
  accionWeb(E2, G.tG, { a: 'finalizado', mo: 800 });
  const r = accionWeb(E2, G.tS, { a: 'incidencia', categoria: 'Problema de calidad', texto: 'Quedó mal' });
  assert.ok(r.ok);
  const s = sol(E2, G.oc);
  assert.strictEqual(s['Estado'], 'En revisión'); assert.strictEqual(s['Acción pendiente de'], '');
  assert.strictEqual(E2.ctx.comisionDeOC_(G.oc), null, 'no hay cobro');
  assert.ok(!accionWeb(E2, G.tS, { a: 'valorar', estrellas: 1 }).ok, 'sin reseña mientras está en revisión');
});
caso('15–16. Cierre iniciado por el cliente → el profesional registra el valor final → el cliente confirma', () => {
  const E2 = crearEntorno(), G = conAcuerdo(E2, 1000);
  const n0 = E2.enviados.length;
  assert.ok(accionWeb(E2, G.tS, { a: 'termino' }).ok);
  assert.strictEqual(sol(E2, G.oc)['Estado'], 'Cierre pendiente del profesional');
  tick(E2);
  assert.ok(E2.enviados.slice(n0).some(m => m.to === G.pEmail && /Registra el valor final/.test(m.subject)));
  assert.strictEqual(E2.ctx.comisionDeOC_(G.oc), null, 'sin comisión antes del valor final y la confirmación');
  assert.ok(accionWeb(E2, G.tG, { a: 'finalizado', mo: 1000 }).ok);
  assert.strictEqual(sol(E2, G.oc)['Cierre iniciado por'], 'Cliente');
  assert.ok(accionWeb(E2, G.tS, { a: 'fin_si' }).ok);
  assert.strictEqual(E2.ctx.comisionDeOC_(G.oc)['Importe comisión (€)'], 100);
});
caso('19–22. Incidencias: grave con aviso interno «⚠ Nueva incidencia», trabajo parcial (comisión sobre lo reconocido) y cancelación (comisión 0)', () => {
  const E2 = crearEntorno(), G = conAcuerdo(E2, 3000);
  const n0 = E2.enviados.length;
  assert.ok(accionWeb(E2, G.tG, { a: 'incidencia', categoria: 'Situación grave', texto: 'El cliente me amenazó' }).ok, 'también el profesional');
  tick(E2);
  const inc = E2.ctx.tabla_('Incidencias').todas()[0];
  assert.strictEqual(inc['Gravedad'], 'Grave'); assert.strictEqual(inc['Reportado por'], 'Profesional'); assert.strictEqual(inc['Cliente'], sol(E2, G.oc)['Nombre']);
  const a = E2.enviados.slice(n0).filter(m => m.to === 'oficiocerca@gmail.com')[0];
  assert.ok(a && a.subject === '⚠ Nueva incidencia — ' + G.oc && /REVISAR INCIDENCIA/.test(a.htmlBody));
  assert.ok(E2.enviados.slice(n0).some(m => m.to === G.email && /Incidencia registrada/.test(m.subject)), 'la otra parte queda avisada');
  // parcial
  const ti = E2.ctx.tabla_('Incidencias');
  assert.ok(/rellena antes/.test(E2.ctx.resolverIncidencia_(inc['ID'], 'RESUELTO — TRABAJO PARCIAL', 'admin')));
  ti.poner(inc._fila, { 'Mano de obra reconocida (€)': 1200 });
  E2.ctx.resolverIncidencia_(inc['ID'], 'RESUELTO — TRABAJO PARCIAL', 'admin');
  assert.strictEqual(E2.ctx.comisionDeOC_(G.oc)['Importe comisión (€)'], 120);
  assert.strictEqual(sol(E2, G.oc)['Estado'], 'Cerrado');
  assert.ok(accionWeb(E2, G.tS, { a: 'valorar', estrellas: 3 }).ok, 'trabajo parcial reconocido: reseña permitida');
  // cancelación
  const G2 = conAcuerdo(E2, 500);
  accionWeb(E2, G2.tS, { a: 'incidencia', categoria: 'No se pudo contactar', texto: 'Nunca vino' });
  const inc2 = E2.ctx.tabla_('Incidencias').todas().slice(-1)[0];
  E2.ctx.resolverIncidencia_(inc2['ID'], 'CANCELADO — NO HUBO TRABAJO', 'admin');
  assert.strictEqual(sol(E2, G2.oc)['Estado'], 'Cancelada');
  assert.strictEqual(E2.ctx.comisionDeOC_(G2.oc), null);
  // sin acuerdo: sigue en revisión, sin comisión
  const G3 = conAcuerdo(E2, 900);
  accionWeb(E2, G3.tS, { a: 'incidencia', categoria: 'Desacuerdo económico', texto: 'No acordamos eso' });
  const inc3 = E2.ctx.tabla_('Incidencias').todas().slice(-1)[0];
  assert.strictEqual(inc3['Gravedad'], 'Alta');
  E2.ctx.resolverIncidencia_(inc3['ID'], 'SIN ACUERDO / REVISIÓN MANUAL', 'admin');
  assert.strictEqual(sol(E2, G3.oc)['Estado'], 'En revisión'); assert.strictEqual(E2.ctx.comisionDeOC_(G3.oc), null);
  // otro: se reanuda
  E2.ctx.resolverIncidencia_(inc3['ID'], 'OTRO', 'admin');
  assert.strictEqual(sol(E2, G3.oc)['Estado'], 'Trabajo en proceso');
  assert.strictEqual(E2.ctx.profesional_(G.pro)['Estado'], 'Activo', 'una queja no bloquea al profesional');
});
caso('23. Soporte por WhatsApp: botón sin número visible, sin token y con el código de la solicitud', () => {
  const E2 = crearEntorno(), G = conAcuerdo(E2, 400);
  accionWeb(E2, G.tS, { a: 'incidencia', categoria: 'Retraso', texto: 'Tarde' });
  const pg = pagina(E2, G.tS).cuerpo;
  const btn = /<a[^>]*data-wa-soporte="([^"]+)"[^>]*>([^<]*)<\/a>/.exec(pg);
  assert.ok(btn && btn[1] === G.oc && /HABLAR CON SOPORTE POR WHATSAPP/.test(btn[2]));
  assert.ok(!/wa\.me|\b57\d{8,}/.test(pg), 'sin número en el HTML del backend');
  const web = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'seguimiento', 'index.html'), 'utf8');
  assert.ok(/Ya registré una incidencia en OficioCerca/.test(web) && /data-wa-soporte/.test(web));
});
caso('24–29. Ambos inactivos: T0 → +48 h → último aviso (+5 días) → archivo a las 48 h → reapertura', () => {
  const E2 = crearEntorno(), G = conAcuerdo(E2, 700);
  const ag = (h) => { setSol(E2, G.oc, { 'Acción desde': new Date(Date.now() - h * H), 'Último aviso': '' }); E2.ctx.motorSeguimiento_(); E2.ctx.procesarCola_(); };
  setSol(E2, G.oc, { 'Fecha estimada fin': new Date(Date.now() - 1000) });
  const n0 = E2.enviados.length;
  E2.ctx.motorSeguimiento_(); E2.ctx.procesarCola_();
  const cuenta = () => E2.enviados.slice(n0).filter(m => /Indica el estado/.test(m.subject)).length;
  assert.strictEqual(cuenta(), 2, 'T0 a ambos');
  ag(47); assert.strictEqual(cuenta(), 2, 'nada antes de 48 h');
  ag(48.1); assert.strictEqual(cuenta(), 4, 'T+48h');
  ag(119); assert.strictEqual(cuenta(), 4);
  ag(120.1); assert.strictEqual(cuenta(), 6, 'último aviso');
  const ult = E2.enviados.slice(n0).filter(m => /Último recordatorio/.test(m.subject));
  assert.ok(ult.length === 2 && /quedará archivado por inactividad/.test(ult[0].body));
  ag(167); assert.strictEqual(sol(E2, G.oc)['Estado'], 'Trabajo en proceso');
  ag(168.1);
  const s = sol(E2, G.oc);
  assert.strictEqual(s['Estado'], 'Archivado por inactividad');
  assert.strictEqual(E2.ctx.comisionDeOC_(G.oc), null); assert.ok(!s['Cliente confirmó fin (fecha)']);
  assert.ok(!accionWeb(E2, G.tS, { a: 'valorar', estrellas: 5 }).ok, 'sin reseña en archivados');
  assert.ok(/reabrirá el seguimiento/.test(pagina(E2, G.tS).cuerpo));
  assert.ok(accionWeb(E2, G.tS, { a: 'termino' }).ok, 'reapertura');
  assert.strictEqual(sol(E2, G.oc)['Estado'], 'Cierre pendiente del profesional');
  assert.ok(E2.ctx.tabla_('Registro').todas().some(r => r['Acción'] === 'Servicio reabierto'));
});
caso('30–31. Solo una parte responde: recordatorios solo al que falta y, agotados, revisión manual con aviso a soporte', () => {
  const E2 = crearEntorno(), G = conAcuerdo(E2, 700);
  accionWeb(E2, G.tG, { a: 'finalizado', mo: 700 });
  const n0 = E2.enviados.length;
  const ag = (h) => { setSol(E2, G.oc, { 'Acción desde': new Date(Date.now() - h * H), 'Último aviso': '' }); E2.ctx.motorSeguimiento_(); E2.ctx.procesarCola_(); };
  E2.ctx.motorSeguimiento_(); E2.ctx.procesarCola_(); ag(49); ag(121); ag(169);
  const nuevos = E2.enviados.slice(n0);
  assert.ok(nuevos.filter(m => m.to === G.email && /cierre/i.test(m.subject)).length >= 2);
  assert.ok(!nuevos.some(m => m.to === G.pEmail && /Recordatorio|Último/.test(m.subject)), 'no se insiste al que ya respondió');
  assert.ok(nuevos.some(m => /pasará a revisión manual/.test(m.body)));
  const s = sol(E2, G.oc);
  assert.strictEqual(s['Estado'], 'En revisión'); assert.strictEqual(s['Escalado por'], 'cliente');
  assert.ok(nuevos.some(m => m.to === 'oficiocerca@gmail.com' && /Revisión manual/.test(m.subject)));
  assert.strictEqual(E2.ctx.comisionDeOC_(G.oc), null, 'nunca se cierra solo');
});
caso('33. No hay reseña sin cierre ni en simples contactos', () => {
  const E2 = crearEntorno(), G = hastaAsignado(E2);
  assert.ok(!accionWeb(E2, G.tS, { a: 'valorar', estrellas: 5 }).ok);
  assert.ok(!/Valoración/.test(pagina(E2, G.tS).cuerpo.replace(/Valoración recibida/g, '')));
});
caso('35–36. Reputación como señal secundaria: el nuevo sin reseñas recibe oportunidades; la zona pesa más que las estrellas', () => {
  const E2 = crearEntorno();
  const veterano = nuevoPro(E2, 'Veterano', { 'Valoración media': 5, 'Nº valoraciones': 4, 'Ofertas recibidas': 10, 'Tasa respuesta (%)': 90 });
  for (let i = 0; i < 3; i++) E2.ctx.tabla_('Ofertas').agregar({ ID: 'X' + i, 'Fecha envío': new Date(), 'Código OC': 'OC-X' + i, 'Código PRO': veterano, Estado: 'Cerrada' });
  const nuevo = nuevoPro(E2, 'Nuevo');
  const r = solicitudWeb(E2); tick(E2);
  const of = E2.ctx.tabla_('Ofertas').todas().filter(o => o['Código OC'] === r.code)[0];
  assert.strictEqual(of['Código PRO'], nuevo, 'el nuevo entra en rotación');
  const E3 = crearEntorno();
  nuevoPro(E3, 'Estrella lejana', { 'Valoración media': 5, 'Nº valoraciones': 6, 'Ofertas recibidas': 9, Zonas: 'Otra zona' });
  const cerca = nuevoPro(E3, 'Cercano sin reseñas', { 'Ofertas recibidas': 9, Zonas: 'Centro' });
  const c = E3.ctx.candidatos_(Object.assign({}, { 'Servicio (código)': 'electricidad', 'Tipo solicitante': 'Particular', Zona: 'Centro', 'Plazo (código)': 'FLEXIBLE' }), []);
  assert.strictEqual(c[0].pro['Código'], cerca);
  cfg(E3, 'REP_PESO_VALORACION', '0');
  assert.strictEqual(E3.ctx.puntosReputacion_({ 'Nº valoraciones': 5, 'Valoración media': 5, 'Ofertas recibidas': 9 }).puntos, 0, 'peso configurable');
});
caso('37–38. Sin profesional disponible: UN correo y «Volver a buscar» sin rellenar nada (nueva ronda)', () => {
  const E2 = crearEntorno();
  const unico = nuevoPro(E2, 'Único');
  const r = solicitudWeb(E2); tick(E2);
  const tOf = ultimoToken(E2, E2.ctx.profesional_(unico)['Email'], 'gestion');
  accionWeb(E2, tOf, { a: 'no' }); tick(E2);
  assert.strictEqual(sol(E2, r.code)['Estado'], 'Sin profesional disponible');
  E2.ctx.revisarOfertas_(); E2.ctx.revisarOfertas_(); tick(E2);
  const email = sol(E2, r.code)['Email'];
  assert.strictEqual(correosA(E2, email).filter(m => /Aún no hay profesional/.test(m.subject)).length, 1, 'un solo correo');
  const tS = ultimoToken(E2, email, 'seguimiento');
  assert.ok(/VOLVER A BUSCAR/.test(pagina(E2, tS).cuerpo));
  assert.ok(accionWeb(E2, tS, { a: 'volver_a_buscar' }).ok);
  assert.strictEqual(sol(E2, r.code)['Ronda búsqueda'], 2);
  assert.strictEqual(sol(E2, r.code)['Estado'], 'Esperando respuesta profesional', 'se vuelve a ofrecer en la nueva ronda');
  tick(E2);
  const pEm = E2.ctx.profesional_(unico)['Email'];
  assert.strictEqual(correosA(E2, pEm).filter(m => /Nueva oportunidad/.test(m.subject)).length, 2, 'la nueva ronda envía una oportunidad nueva');
  const tOf2 = ultimoToken(E2, pEm, 'gestion');
  assert.ok(tOf2 !== tOf && /PUEDO ATENDERLO/.test(pagina(E2, tOf2).cuerpo), 'el enlace de la nueva ronda está abierto');
  assert.ok(accionWeb(E2, tOf2, { a: 'si', disp: 'MANANA' }).ok); tick(E2);
  assert.strictEqual(sol(E2, r.code)['Estado'], 'Profesional asignado');
  assert.strictEqual(E2.ctx.tabla_('Solicitudes').todas().length, 1, 'misma solicitud');
});
caso('39–40. Cuota baja: salen primero los críticos, el resto espera en cola y sale cuando vuelve la cuota', () => {
  const E2 = crearEntorno();
  let q = 10; E2.ctx.MailApp.getRemainingDailyQuota = () => q;
  const pb = nuevoPro(E2, 'Cuota');
  E2.ctx.encolarCorreo_('baja-1', 'alta_activada', 'Profesional', 'p@example.com', '', pb, {}, true);
  E2.ctx.encolarCorreo_('admin-x', 'alerta_admin', 'Administrador', 'oficiocerca@gmail.com', '', '', { categoria: 'X', asunto: 'Y', texto: 'Z' }, true);
  E2.ctx.procesarCola_();
  const h = () => E2.ctx.tabla_('Historial envíos').todas();
  assert.strictEqual(h().filter(r => r.Clave === 'admin-x')[0].Estado, 'Enviado');
  assert.strictEqual(h().filter(r => r.Clave === 'baja-1')[0].Estado, 'Pendiente por cuota', 'baja prioridad espera');
  q = 0; E2.ctx.procesarCola_();
  assert.strictEqual(h().filter(r => r.Clave === 'baja-1')[0].Estado, 'Pendiente por cuota', 'nunca se pierde');
  q = 80; E2.ctx.procesarCola_();
  assert.strictEqual(h().filter(r => r.Clave === 'baja-1')[0].Estado, 'Enviado');
  assert.ok(E2.enviados.every(m => typeof m.to === 'string' && !/,/.test(m.to)), 'un destinatario por correo');
});
caso('44. Acceso cruzado rechazado y enlaces inválidos', () => {
  const E2 = crearEntorno(), A = hastaAsignado(E2), B = hastaAsignado(E2);
  assert.ok(!accionWeb(E2, A.tS, { a: 'abrir_servicio', oc: B.oc }).ok);
  assert.ok(!pagina(E2, A.tS).cuerpo.includes(B.oc));
  assert.ok(/no válido/i.test(pagina(E2, 'a'.repeat(64)).titulo));
  assert.ok(/no válido/i.test(pagina(E2, '<script>').titulo));
  // el profesional A no puede actuar sobre el trabajo de B con su token
  accionWeb(E2, A.tG, { a: 'acuerdo', mo: 100, dn: 1, du: 'dias' });
  assert.strictEqual(sol(E2, B.oc)['Estado'], 'Profesional asignado');
  // XSS: un comentario con HTML se muestra escapado
  accionWeb(E2, A.tS, { a: 'incidencia', categoria: 'Otro', texto: '<img src=x onerror=alert(1)>' });
  assert.ok(!/<img src=x/.test(pagina(E2, A.tS).cuerpo));
});
caso('Comisión: fórmula única y ejemplos (10 % hasta 2.000 € + 5 % del exceso, sin tope, materiales excluidos)', () => {
  const c = crearEntorno().ctx;
  [[1000, 100], [2000, 200], [3000, 250], [5000, 350], [10000, 600], [2600, 230]].forEach(([mo, esp]) => assert.strictEqual(c.comisionV16_(mo).importe, esp));
});
caso('Múltiples servicios y mismo profesional siguen funcionando (independientes)', () => {
  const E2 = crearEntorno(), G = conAcuerdo(E2, 500);
  assert.ok(accionWeb(E2, G.tS, { a: 'nuevo_servicio', servicio: 'fontaneria', descripcion: 'Fuga', plazo: 'FLEXIBLE' }).ok);
  assert.ok(accionWeb(E2, G.tS, { a: 'mismo_pro', servicio: 'electricidad', descripcion: 'Lámpara', plazo: 'FLEXIBLE' }).ok);
  const grupo = E2.ctx.serviciosDelGrupo_(sol(E2, G.oc));
  assert.strictEqual(grupo.length, 3);
  assert.strictEqual(sol(E2, G.oc)['Estado'], 'Trabajo en proceso', 'el primero no cambia');
});
caso('Recordatorio para registrar el acuerdo si el profesional no lo hace', () => {
  const E2 = crearEntorno(), G = hastaAsignado(E2);
  setSol(E2, G.oc, { 'Fecha asignación': new Date(Date.now() - 4 * 86400000) });
  const n0 = E2.enviados.length;
  E2.ctx.motorSeguimiento_(); E2.ctx.procesarCola_();
  assert.ok(E2.enviados.slice(n0).some(m => m.to === G.pEmail && /Registra el acuerdo/.test(m.subject)));
  assert.ok(!E2.enviados.slice(n0).some(m => m.to === G.email));
});
caso('Condiciones V4: con V3 no recibe nuevas oportunidades hasta aceptar; registro guarda la versión', () => {
  const E2 = crearEntorno();
  assert.strictEqual(E2.ctx.condVigente_(), 'PRO-COND-2026-10-V4');
  const viejo = nuevoPro(E2, 'Viejo', { 'Condiciones (versión)': 'PRO-COND-2026-10-V3' });
  solicitudWeb(E2); tick(E2);
  assert.ok(!E2.ctx.tabla_('Ofertas').todas().some(o => o['Código PRO'] === viejo));
  E2.ctx.pedirAceptacionCondiciones(); tick(E2);
  const t = ultimoToken(E2, E2.ctx.profesional_(viejo)['Email'], 'gestion');
  assert.ok(/Precio y acuerdo/.test(pagina(E2, t).cuerpo));
  assert.ok(accionWeb(E2, t, { a: 'aceptar' }).ok);
  assert.ok(E2.ctx.tabla_('Aceptaciones condiciones').todas().some(a => a['Código PRO'] === viejo && a['Versión'] === 'PRO-COND-2026-10-V4'));
});
caso('Correos cortos: el cliente solo recibe avisos relevantes; nunca «seguimos buscando»', () => {
  E.enviados.filter(m => m.to === F.email).forEach(m => {
    assert.ok(m.body.length < 900, 'corto: ' + m.subject + ' (' + m.body.length + ')');
    assert.ok(/seguimiento\/#[a-f0-9]{64}/.test(m.htmlBody), 'botón en ' + m.subject);
  });
  assert.ok(!E.enviados.some(m => /seguimos buscando/i.test(m.subject)));
});
caso('Solicitud siempre guardada aunque falle el correo; doble envío sin duplicar; límite de frecuencia', () => {
  const E2 = crearEntorno();
  E2.ctx.MailApp.sendEmail = () => { throw new Error('caída simulada'); };
  const d = { tipo: 'solicitud', tipoSolicitante: 'Particular', nombre: 'X', whatsapp: '600123123', email: 'x@example.com', zona: 'Centro', oficio: 'electricidad', descripcion: 'Igual', plazo: 'FLEXIBLE', consentOperativo: 'si' };
  const a = postWeb(E2, d), b = postWeb(E2, d);
  assert.ok(a.ok && b.ok && a.code === b.code);
  for (let i = 0; i < 6; i++) postWeb(E2, Object.assign({}, d, { descripcion: 'otra ' + i }));
  assert.ok(!postWeb(E2, Object.assign({}, d, { descripcion: 'otra más' })).ok, 'límite de frecuencia');
  tick(E2);
});
caso('Activadores: uno de cada, sin duplicados', () => {
  const E2 = crearEntorno();
  E2.ctx.repararActivadoresV16(); E2.ctx.repararActivadoresV16();
  const n = {}; E2.triggers.forEach(t => { n[t.getHandlerFunction()] = (n[t.getHandlerFunction()] || 0) + 1; });
  const ord = o => JSON.stringify(Object.keys(o).sort().map(k => [k, o[k]]));
  assert.strictEqual(ord(n), ord({ procesarPendientes: 1, cicloAutomatico: 1, alEditar: 1, alAbrir: 1, resumenDiario: 1 }));
});

/* ===================================================== 45. WOMPI (SANDBOX) SIGUE PASANDO CON EL NUEVO CIERRE */
let ES, FS, pagoS, txOk;
caso('45a. Comisión exigible (PRUEBA + sandbox) tras el cierre confirmado; bloqueo de nuevas oportunidades', () => {
  ES = crearEntorno(); activarSandbox(ES);
  FS = conAcuerdo(ES, 3000, 7, 'dias', { pro: 'PRUEBA SANDBOX Pro', cli: 'PRUEBA SANDBOX Cli' });
  accionWeb(ES, FS.tG, { a: 'finalizado', mo: 3000, mat: 5000 });
  accionWeb(ES, FS.tS, { a: 'fin_si' }); tick(ES);
  const c = ES.ctx.comisionDeOC_(FS.oc);
  assert.strictEqual(c['Estado'], 'DUE'); assert.strictEqual(c['Importe comisión (€)'], 250);
  assert.ok(ES.ctx.proBloqueado_(FS.pro));
  const m = correosA(ES, FS.pEmail).filter(x => /Comisión pendiente/.test(x.subject))[0];
  const tok = /gestion\/#([a-f0-9]{64})"[^>]*>PAGAR/.exec(m.htmlBody)[1];
  const page = pagina(ES, tok).cuerpo;
  assert.ok(page.includes('1.125.000 COP') && !page.includes(ES.S.integ));
  pagoS = ES.ctx.tabla_('Pagos comisión').todas().slice(-1)[0];
});
caso('45b. Firma falsa rechazada; DECLINED → PAYMENT_FAILED; APPROVED → PAID y desbloqueo; evento duplicado idempotente', () => {
  assert.strictEqual(postWeb(ES, evento(ES, txDe(pagoS, 'APPROVED'), { secreto: 'test_events_OTRO' })).error, 'firma');
  assert.strictEqual(postWeb(ES, evento(ES, txDe(pagoS, 'DECLINED'))).resultado, 'PROCESADO: PAYMENT_FAILED');
  assert.ok(ES.ctx.proBloqueado_(FS.pro));
  const ip = ES.ctx.crearIntentoPago_(FS.oc, new Date(Date.now() + 2 * H));
  txOk = txDe(ip.pago, 'APPROVED', '15113-OK-17');
  assert.strictEqual(postWeb(ES, evento(ES, txOk)).resultado, 'PROCESADO: PAID');
  assert.ok(!ES.ctx.proBloqueado_(FS.pro));
  assert.strictEqual(sol(ES, FS.oc)['Estado'], 'Cerrado');
  assert.ok(postWeb(ES, evento(ES, txOk)).duplicado);
  assert.strictEqual(postWeb(ES, evento(ES, txOk, { env: 'prod' })).error, 'ambiente');
});
caso('45c. Incidencia tras el cierre congela la comisión (no bloquea) y producción sigue desactivada', () => {
  const E2 = crearEntorno(); activarSandbox(E2);
  const G = conAcuerdo(E2, 1000, 2, 'dias', { pro: 'PRUEBA P', cli: 'PRUEBA C' });
  accionWeb(E2, G.tG, { a: 'finalizado', mo: 1000 }); accionWeb(E2, G.tS, { a: 'fin_si' });
  assert.ok(E2.ctx.proBloqueado_(G.pro));
  accionWeb(E2, G.tS, { a: 'incidencia', categoria: 'Daños', texto: 'Rompió una baldosa' });
  assert.strictEqual(E2.ctx.comisionDeOC_(G.oc)['Estado'], 'EN_REVISION');
  assert.ok(!E2.ctx.proBloqueado_(G.pro), 'una incidencia no bloquea automáticamente');
  assert.strictEqual(E2.ctx.cfgBool_('COMMISSION_COLLECTION_ENABLED'), false);
  assert.throws(() => E2.ctx.tasaEurCop_(), /SIN_DEFINIR/);
});

/* ===================================================== RESUMEN */
resultados.forEach(r => console.log(r[0] + ' · ' + r[1]));
const err = resultados.filter(r => r[0] !== 'OK').length;
console.log('\n' + (resultados.length - err) + '/' + resultados.length + ' casos OK' + (err ? ' · ' + err + ' con ERROR' : ' · TODO OK'));
process.exit(err ? 1 : 0);
