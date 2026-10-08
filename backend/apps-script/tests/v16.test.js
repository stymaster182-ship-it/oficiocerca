/* Pruebas OFFLINE V1.6 (node backend/apps-script/tests/v16.test.js): flujo completo, comisión 10 %/5 %, acuerdo, seguimiento,
 * varios servicios, correos, recordatorios, Wompi (sandbox y guardas de producción), bloqueo y activadores.
 * Ejecuta el Code.gs real con simuladores de Apps Script en memoria. Sin red, sin Wompi, sin dinero.
 * Los "secretos" de aquí son FALSOS y generados al vuelo: no son credenciales de Wompi. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');

function crearEntorno() {
  const sheets = {}, props = {}, enviados = [], triggers = [];
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
        insertCheckboxes() { return this; }
      };
    },
    setFrozenRows() { }, setTabColor() { }
  };
  const ss = { getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = new Sheet(n)), deleteSheet() { } };
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
    CacheService: { getScriptCache: () => ({ get: () => null, put() { } }) },
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
  E.ctx.tabla_('Profesionales').agregar(Object.assign({ 'Código': code, Fecha: new Date(Date.now() - nPro * 1000), Estado: 'Activo', Nombre: nombre || 'PRUEBA Profesional', Email: 'pro' + code + '@example.com',
    'Servicios (códigos)': 'electricidad, fontaneria', Servicios: 'Electricidad, Fontanería', 'Condiciones (versión)': E.ctx.condVigente_(), 'Condiciones aceptadas (fecha)': new Date(),
    'Con particulares': 'Sí', 'Con empresas': 'Sí', Ciudad: 'Córdoba', Distancia: 'Toda la ciudad', Zonas: 'Centro', WhatsApp: "'600111222", Prioridad: 'Normal' }, extra || {}));
  return code;
}
function postWeb(E, o) { return JSON.parse(E.ctx.doPost({ postData: { contents: JSON.stringify(o) } }).s); }
function solicitudWeb(E, nombre, oficio) {
  return postWeb(E, { tipo: 'solicitud', tipoSolicitante: 'Particular', nombre: nombre || 'PRUEBA Cliente', whatsapp: '600' + Math.floor(Math.random() * 1e6),
    email: 'cli' + Math.floor(Math.random() * 1e6) + '@example.com', zona: 'Centro', oficio: oficio || 'electricidad', descripcion: 'Trabajo ' + Math.random(), plazo: 'FLEXIBLE', consentOperativo: 'si', contactoPreferido: 'WhatsApp' });
}
const tokenDe = (html, ruta) => { const m = new RegExp(ruta + '/#([a-f0-9]{64})').exec(html); return m && m[1]; };
const correosA = (E, to) => E.enviados.filter(m => m.to === to);
function ultimoToken(E, to, ruta) { const ms = correosA(E, to); for (let i = ms.length - 1; i >= 0; i--) { const t = tokenDe(ms[i].htmlBody, ruta); if (t) return t; } return null; }
function accionWeb(E, t, p) { return postWeb(E, { tipo: 'accion', t, p }); }
function pagina(E, t) { return postWeb(E, { tipo: 'pagina', t }); }
function tick(E) { E.ctx.procesarPendientes(); E.ctx.procesarCola_(); }

/** Flujo completo por la WEB hasta «Finalización por confirmar». Devuelve todo lo necesario. */
function hastaFin(E, mo, mat, nombres, fecha) {
  nombres = nombres || {};
  const pro = nuevoPro(E, nombres.pro);
  const r = solicitudWeb(E, nombres.cli); assert.ok(r.ok, JSON.stringify(r));
  const oc = r.code, sol = E.ctx.solicitud_(oc); E.ctx.props = E.props;
  tick(E);
  const pEmail = E.ctx.profesional_(pro)['Email'];
  const tOferta = ultimoToken(E, pEmail, 'gestion'); assert.ok(tOferta, 'token de oferta');
  assert.ok(accionWeb(E, tOferta, { a: 'si', disp: 'MANANA' }).ok);
  tick(E);
  const tGestion = ultimoToken(E, pEmail, 'gestion'); assert.notStrictEqual(tGestion, tOferta);
  const tSeg = ultimoToken(E, sol['Email'], 'seguimiento'); assert.ok(tSeg, 'token de seguimiento');
  assert.ok(accionWeb(E, tGestion, { a: 'acuerdo', mo, mat, fecha: fecha || '', nota: 'nota' }).ok);
  tick(E);
  assert.ok(accionWeb(E, tSeg, { a: 'acuerdo', d: 'confirmar' }).ok);
  tick(E);
  assert.ok(accionWeb(E, tGestion, { a: 'finalizado' }).ok);
  tick(E);
  return { pro, oc, email: sol['Email'], pEmail, tGestion, tSeg };
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

/* ===================================================== CASOS */
let E, F;
caso('1–7. Solicitud normal → profesional encontrado → acuerdo → cliente confirma → trabajo en proceso → profesional termina → cliente confirma (cobro NO habilitado: sin bloqueo)', () => {
  E = crearEntorno();
  const hoy = E.ctx.Utilities.formatDate(new Date(), 'Europe/Madrid', 'yyyy-MM-dd');
  F = hastaFin(E, 1500, 300, { pro: 'Juan Real', cli: 'Ana Real' }, hoy);
  const sol = () => E.ctx.solicitud_(F.oc);
  assert.strictEqual(sol()['Estado'], 'Finalización por confirmar');
  assert.ok(E.ctx.tabla_('Registro').todas().some(r => r['Código OC'] === F.oc && r['Acción'] === 'Cliente confirma el acuerdo'));
  assert.strictEqual(E.ctx.comisionDeOC_(F.oc), null, 'la comisión NO nace antes de la confirmación del cliente');
  const r = accionWeb(E, F.tSeg, { a: 'fin_si' }); assert.ok(r.ok);
  assert.strictEqual(sol()['Estado'], 'Cerrado');
  const c = E.ctx.comisionDeOC_(F.oc);
  assert.strictEqual(c['Estado'], 'NO_HABILITADA'); assert.strictEqual(c['Importe comisión (€)'], 150);
  assert.ok(!E.ctx.proBloqueado_(F.pro), 'sin cobro habilitado no se bloquea');
});

caso('5. «Trabajo en proceso» al llegar la fecha acordada (acuerdo con fecha futura)', () => {
  const E2 = crearEntorno();
  const fut = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  const pro = nuevoPro(E2), r = solicitudWeb(E2); tick(E2);
  const pe = E2.ctx.profesional_(pro)['Email'];
  accionWeb(E2, ultimoToken(E2, pe, 'gestion'), { a: 'si', disp: 'HOY' }); tick(E2);
  const tg = ultimoToken(E2, pe, 'gestion'), ts = ultimoToken(E2, E2.ctx.solicitud_(r.code)['Email'], 'seguimiento');
  accionWeb(E2, tg, { a: 'acuerdo', mo: 100, mat: 0, fecha: fut }); accionWeb(E2, ts, { a: 'acuerdo', d: 'confirmar' });
  assert.strictEqual(E2.ctx.solicitud_(r.code)['Estado'], 'Acuerdo confirmado');
  E2.ctx.tabla_('Solicitudes').poner(E2.ctx.solicitud_(r.code)._fila, { 'Fecha acordada': '2020-01-01' });
  E2.ctx.recordatoriosV16_();
  assert.strictEqual(E2.ctx.solicitud_(r.code)['Estado'], 'Trabajo en proceso');
});

caso('Cliente: ve servicio, profesional, mano de obra, materiales, fecha y nota; NUNCA la comisión; solo botones válidos', () => {
  const E2 = crearEntorno();
  const pro = nuevoPro(E2), r = solicitudWeb(E2); tick(E2);
  const pe = E2.ctx.profesional_(pro)['Email'];
  accionWeb(E2, ultimoToken(E2, pe, 'gestion'), { a: 'si', disp: 'HOY' }); tick(E2);
  const tg = ultimoToken(E2, pe, 'gestion'), ts = ultimoToken(E2, E2.ctx.solicitud_(r.code)['Email'], 'seguimiento');
  let pg = pagina(E2, ts).cuerpo;
  assert.ok(!/Confirmar acuerdo/.test(pg), 'sin acuerdo no hay botón de confirmar');
  accionWeb(E2, tg, { a: 'acuerdo', mo: 2500, mat: 700, fecha: '2030-05-04', nota: 'Incluye boletín' }); tick(E2);
  pg = pagina(E2, ts).cuerpo;
  ['2500,00 €', '700,00 €', '3200,00 €', '04/05/2030', 'Incluye boletín', 'Confirmar acuerdo', 'No estoy de acuerdo', '¿Dónde estoy?', '¿Qué está pasando?', '¿Qué hago ahora?', '¿Qué pasa después?'].forEach(t => assert.ok(pg.includes(t), 'falta ' + t));
  assert.ok(!/omisi/i.test(pg), 'el cliente no ve la comisión');
  assert.ok(!/Sí, el trabajo terminó/.test(pg), 'no se ofrece cerrar antes de tiempo');
  const correo = correosA(E2, E2.ctx.solicitud_(r.code)['Email']).filter(m => /acuerdo/i.test(m.subject))[0];
  assert.ok(correo && !/omisi/i.test(correo.htmlBody) && /REVISAR Y CONFIRMAR EL ACUERDO/.test(correo.htmlBody));
  const pp = pagina(E2, tg).cuerpo;
  assert.ok(/Comisión de OficioCerca: 10 % sobre los primeros 2.000 €/.test(pp));
});

caso('16. Cambio de acuerdo: nueva versión, reconfirmación obligatoria e historial', () => {
  const E2 = crearEntorno();
  const pro = nuevoPro(E2), r = solicitudWeb(E2); tick(E2);
  const pe = E2.ctx.profesional_(pro)['Email'];
  accionWeb(E2, ultimoToken(E2, pe, 'gestion'), { a: 'si', disp: 'HOY' }); tick(E2);
  const tg = ultimoToken(E2, pe, 'gestion'), ts = ultimoToken(E2, E2.ctx.solicitud_(r.code)['Email'], 'seguimiento');
  accionWeb(E2, tg, { a: 'acuerdo', mo: 1000, mat: 0 }); accionWeb(E2, ts, { a: 'acuerdo', d: 'confirmar' });
  assert.strictEqual(E2.ctx.solicitud_(r.code)['Estado'], 'Acuerdo confirmado');
  assert.ok(accionWeb(E2, tg, { a: 'acuerdo', mo: 1400, mat: 50 }).ok);
  const s = E2.ctx.solicitud_(r.code);
  assert.strictEqual(s['Estado'], 'Acuerdo pendiente del cliente');
  assert.strictEqual(s['Versión acuerdo'], 2);
  const vs = E2.ctx.tabla_('Presupuestos').todas().filter(x => x['Código OC'] === r.code);
  assert.strictEqual(JSON.stringify(vs.map(v => v['Estado'])), JSON.stringify(['Sustituido', 'Pendiente del cliente']));
  assert.ok(vs.every(v => v['Política comisión'] === 'COM-2026-10-V2' && v['Registrado por'] === pro));
  assert.ok(!accionWeb(E2, tg, { a: 'finalizado' }).ok, 'sin reconfirmar no se puede terminar');
  accionWeb(E2, ts, { a: 'acuerdo', d: 'confirmar' });
  const v2 = E2.ctx.tabla_('Presupuestos').todas().filter(x => x['Código OC'] === r.code)[1];
  assert.strictEqual(v2['Estado'], 'Confirmado'); assert.ok(v2['Confirmado por'] && v2['Respuesta cliente (fecha)']);
  assert.ok(/Historial del acuerdo \(2 versiones\)/.test(pagina(E2, ts).cuerpo));
  // «No estoy de acuerdo»
  accionWeb(E2, tg, { a: 'acuerdo', mo: 9999, mat: 0 }); assert.ok(accionWeb(E2, ts, { a: 'acuerdo', d: 'no_de_acuerdo' }).ok);
  assert.strictEqual(E2.ctx.solicitud_(r.code)['Estado'], 'Acuerdo no confirmado');
});

caso('13–15. Fórmula única: 10 % hasta 2.000 €, 5 % del exceso, sin tope, materiales excluidos', () => {
  const c = crearEntorno().ctx;
  [[1000, 100], [2000, 200], [3000, 250], [5000, 350], [10000, 600], [0, 0], [1999.99, 200], [2000.01, 200], [350.5, 35.05], [100000, 5100]]
    .forEach(([mo, esp]) => assert.strictEqual(c.comisionV16_(mo).importe, esp, mo + ' → ' + esp));
  const d = c.comisionV16_(3000); assert.strictEqual(d.tramo1, 200); assert.strictEqual(d.tramo2, 50);
  assert.strictEqual(c.comisionDe_(5000).importe, 350);
  const src = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  assert.ok(!/COMISION_MAXIMO_EUR'\s*,\s*200/.test(src) && !/Math\.min\([^)]*max\)/.test(src), 'no queda el tope de 200 €');
});

let ES, FS, pagoS;
caso('8. Comisión (PRUEBA + sandbox): nace al confirmar el cliente, DUE, correo con botón de pago; materiales excluidos', () => {
  ES = crearEntorno(); activarSandbox(ES);
  FS = hastaFin(ES, 3000, 5000, { pro: 'PRUEBA SANDBOX Pro', cli: 'PRUEBA SANDBOX Cli' });
  assert.strictEqual(ES.ctx.comisionDeOC_(FS.oc), null);
  accionWeb(ES, FS.tSeg, { a: 'fin_aun_no' });
  assert.strictEqual(ES.ctx.comisionDeOC_(FS.oc), null, '«Todavía no» no genera comisión');
  accionWeb(ES, FS.tGestion, { a: 'finalizado' });
  accionWeb(ES, FS.tSeg, { a: 'fin_problema', texto: 'algo', grave: false });
  assert.strictEqual(ES.ctx.comisionDeOC_(FS.oc), null, '«Hay un problema» no genera comisión');
  accionWeb(ES, FS.tSeg, { a: 'fin_si' }); tick(ES);
  const c = ES.ctx.comisionDeOC_(FS.oc);
  assert.strictEqual(c['Estado'], 'DUE'); assert.strictEqual(c['Ambiente'], 'SANDBOX');
  assert.strictEqual(c['Importe comisión (€)'], 250); assert.strictEqual(c['Materiales (€)'], 5000);
  assert.strictEqual(ES.ctx.solicitud_(FS.oc)['Estado'], 'Comisión pendiente');
  const m = correosA(ES, FS.pEmail).filter(x => /Comisión pendiente/.test(x.subject))[0];
  assert.ok(m && /PRUEBA \/ SANDBOX/.test(m.subject) && /PAGAR COMISIÓN \(SANDBOX\)/.test(m.htmlBody) && /wpago=[a-f0-9]{64}/.test(m.htmlBody));
  const tok = /wpago=([a-f0-9]{64})/.exec(m.htmlBody)[1];
  const page = ES.ctx.doGet({ parameter: { wpago: tok } }).h;
  ['PRUEBA / SANDBOX', '250,00 €', '1.125.000 COP', 'TEST_EXCHANGE_RATE (ficticia', 'checkout.wompi.co/p/?public-key=pub_test_'].forEach(t => assert.ok(page.includes(t), 'falta en página: ' + t));
  assert.ok(!page.includes(ES.S.integ));
  pagoS = ES.ctx.tabla_('Pagos comisión').todas().slice(-1)[0];
  assert.strictEqual(pagoS['Importe (centavos)'], 112500000);
  const esperada = crypto.createHash('sha256').update(pagoS['Referencia'] + '112500000COP' + ES.S.integ).digest('hex');
  assert.ok(page.includes('signature:integrity=' + esperada));
});

caso('11. Bloqueo: sin NUEVAS oportunidades (tampoco «mismo profesional»), cuenta, historial y trabajos intactos', () => {
  assert.ok(ES.ctx.proBloqueado_(FS.pro));
  const r = solicitudWeb(ES, 'PRUEBA Otro'); tick(ES);
  assert.ok(!ES.ctx.tabla_('Ofertas').todas().some(o => o['Código OC'] === r.code && o['Código PRO'] === FS.pro));
  const mp = accionWeb(ES, FS.tSeg, { a: 'mismo_pro', servicio: 'electricidad', descripcion: 'otro', plazo: 'FLEXIBLE' });
  assert.ok(!mp.ok && /no puede recibir nuevas solicitudes/.test(mp.msg));
  assert.strictEqual(ES.ctx.profesional_(FS.pro)['Estado'], 'Activo');
  assert.ok(/Comisión de OficioCerca/.test(pagina(ES, FS.tGestion).cuerpo), 'sigue accediendo a su trabajo');
});

caso('22. Firma falsa → rechazada (401 en el relé), sin cambios', () => {
  const r = postWeb(ES, evento(ES, txDe(pagoS, 'APPROVED'), { secreto: 'test_events_OTRO' }));
  assert.strictEqual(r.error, 'firma'); assert.strictEqual(ES.ctx.comisionDeOC_(FS.oc)['Estado'], 'DUE');
  const r2 = postWeb(ES, evento(ES, txDe(pagoS, 'APPROVED'), { env: 'prod' }));
  assert.strictEqual(r2.error, 'ambiente', 'producción deshabilitada');
});

caso('9. Pago rechazado (DECLINED) → PAYMENT_FAILED, sigue bloqueado, aviso al profesional', () => {
  const r = postWeb(ES, evento(ES, txDe(pagoS, 'DECLINED')));
  assert.strictEqual(r.resultado, 'PROCESADO: PAYMENT_FAILED');
  assert.ok(ES.ctx.proBloqueado_(FS.pro)); tick(ES);
  assert.ok(correosA(ES, FS.pEmail).some(m => /no se completó/.test(m.subject)));
});

let txOk;
caso('10 + 12. Pago posterior aprobado → PAID, servicio cerrado, profesional desbloqueado automáticamente', () => {
  const ip = ES.ctx.crearIntentoPago_(FS.oc, new Date(Date.now() + 2 * 3600e3)); assert.ok(ip.ok && !ip.reutilizado);
  txOk = txDe(ip.pago, 'APPROVED', '15113-OK-1');
  const r = postWeb(ES, evento(ES, txOk));
  assert.strictEqual(r.resultado, 'PROCESADO: PAID');
  const c = ES.ctx.comisionDeOC_(FS.oc);
  assert.strictEqual(c['Estado'], 'PAID'); assert.strictEqual(c['Transaction ID'], '15113-OK-1'); assert.ok(c['Tasa EUR→COP'] && c['Fuente tasa'] && c['Fecha tasa']);
  assert.strictEqual(ES.ctx.solicitud_(FS.oc)['Estado'], 'Cerrado');
  assert.ok(!ES.ctx.proBloqueado_(FS.pro));
  const r2 = solicitudWeb(ES, 'PRUEBA Nueva'); tick(ES);
  assert.ok(ES.ctx.candidatos_(ES.ctx.solicitud_(r2.code), []).some(x => x.pro['Código'] === FS.pro) || ES.ctx.tabla_('Ofertas').todas().some(o => o['Código OC'] === r2.code && o['Código PRO'] === FS.pro));
  tick(ES); assert.ok(correosA(ES, FS.pEmail).some(m => /Pago recibido/.test(m.subject)));
});

caso('21. Evento duplicado → idempotente (sin doble efecto, se cuentan repeticiones)', () => {
  const r = postWeb(ES, evento(ES, txOk)), r2 = postWeb(ES, evento(ES, txOk, { ts: Math.floor(Date.now() / 1000) + 7 }));
  assert.ok(r.duplicado && r2.duplicado);
  const ev = ES.ctx.tabla_('Eventos Wompi').todas().filter(e => e['Clave'] === '15113-OK-1|APPROVED');
  assert.strictEqual(ev.length, 1); assert.strictEqual(ev[0]['Repeticiones'], 2);
  assert.strictEqual(ES.ctx.tabla_('Comisiones').todas().filter(c => c['Código OC'] === FS.oc).length, 1);
});

caso('Producción preparada pero DESACTIVADA: sin COMMISSION_COLLECTION_ENABLED no hay cobro; sin tasa real no hay intento; TEST_EXCHANGE_RATE nunca en producción', () => {
  const E2 = crearEntorno();
  assert.strictEqual(E2.ctx.cfgBool_('COMMISSION_COLLECTION_ENABLED'), false);
  const f = hastaFin(E2, 1000, 0, { pro: 'Real Pro', cli: 'Real Cli' }); accionWeb(E2, f.tSeg, { a: 'fin_si' });
  assert.strictEqual(E2.ctx.comisionDeOC_(f.oc)['Estado'], 'NO_HABILITADA');
  assert.ok(!E2.ctx.crearIntentoPago_(f.oc).ok);
  assert.throws(() => E2.ctx.tasaEurCop_(), /SIN_DEFINIR/);
  cfg(E2, 'FX_MODO', 'TRM_BCE'); assert.throws(() => E2.ctx.tasaEurCop_(), /no está aprobada/);
  cfg(E2, 'FX_MODO', 'MANUAL'); cfg(E2, 'FX_EUR_COP_MANUAL', '4700'); cfg(E2, 'FX_FECHA_MANUAL', '2020-01-01');
  assert.throws(() => E2.ctx.tasaEurCop_(), /más de/);
  cfg(E2, 'FX_FECHA_MANUAL', new Date().toISOString().slice(0, 10));
  assert.strictEqual(E2.ctx.tasaEurCop_().tasa, 4700);
  assert.strictEqual(E2.ctx.tasaPara_('PRODUCCION').fuente.indexOf('TEST'), -1);
  E2.props.WOMPI_PROD_PUBLIC_KEY = 'pub_test_x'; assert.throws(() => E2.ctx.credWompi_('PRODUCCION', 'pub'), /PREFIJO_INVALIDO/);
  E2.props.WOMPI_TEST_PUBLIC_KEY = 'pub_prod_x'; assert.throws(() => E2.ctx.credWompi_('SANDBOX', 'pub'), /PRODUCCION_DETECTADA/);
});

caso('Datos REALES nunca entran en sandbox aunque esté activo; mezcla prueba/real nunca se cobra', () => {
  const E2 = crearEntorno(); activarSandbox(E2);
  const f = hastaFin(E2, 1000, 0, { pro: 'Juan Real', cli: 'Ana Real' }); accionWeb(E2, f.tSeg, { a: 'fin_si' });
  assert.strictEqual(E2.ctx.comisionDeOC_(f.oc)['Ambiente'], 'NO_HABILITADO');
  const f2 = hastaFin(E2, 1000, 0, { pro: 'PRUEBA Pro', cli: 'Ana Real 2' }); accionWeb(E2, f2.tSeg, { a: 'fin_si' });
  assert.strictEqual(E2.ctx.comisionDeOC_(f2.oc)['Estado'], 'NO_HABILITADA');
});

let EM, FM;
caso('17 + 18. Varios servicios: cada uno con su OC, profesional, estado, acuerdo y comisión; dos profesionales distintos', () => {
  EM = crearEntorno();
  FM = hastaFin(EM, 800, 0);
  const proFont = nuevoPro(EM, 'Fontanero', { 'Servicios (códigos)': 'fontaneria', Servicios: 'Fontanería' });
  EM.ctx.tabla_('Profesionales').poner(EM.ctx.profesional_(FM.pro)._fila, { 'Servicios (códigos)': 'electricidad', Servicios: 'Electricidad' });
  const r = accionWeb(EM, FM.tSeg, { a: 'nuevo_servicio', servicio: 'fontaneria', descripcion: 'Fuga en el baño', plazo: 'ESTA_SEMANA' });
  assert.ok(r.ok, r.msg); tick(EM);
  const s1 = EM.ctx.solicitud_(FM.oc), grupo = EM.ctx.serviciosDelGrupo_(s1);
  assert.strictEqual(grupo.length, 2);
  const s2 = grupo.filter(s => s['Código'] !== FM.oc)[0];
  assert.strictEqual(s2['Email'], s1['Email']); assert.strictEqual(s2['Grupo cliente'], FM.oc);
  assert.strictEqual(s2['Estado'], 'Esperando respuesta profesional');
  const of = EM.ctx.tabla_('Ofertas').todas().filter(o => o['Código OC'] === s2['Código'])[0];
  assert.strictEqual(of['Código PRO'], proFont, 'otro profesional (fontanería)');
  assert.strictEqual(EM.ctx.solicitud_(FM.oc)['Estado'], 'Finalización por confirmar', 'el primer servicio no cambia');
  assert.ok(correosA(EM, s1['Email']).some(m => m.subject.includes('Hemos recibido tu solicitud ' + s2['Código'])));
  const pg = pagina(EM, FM.tSeg).cuerpo;
  assert.ok(pg.includes('Tus servicios') && pg.includes(s2['Código']));
});

caso('19. Mismo profesional en dos servicios: debe aceptarlo; servicio nuevo e independiente', () => {
  const r = accionWeb(EM, FM.tSeg, { a: 'mismo_pro', servicio: 'electricidad', descripcion: 'Otro enchufe', plazo: 'FLEXIBLE' });
  assert.ok(r.ok, r.msg);
  const nueva = EM.ctx.serviciosDelGrupo_(EM.ctx.solicitud_(FM.oc)).slice(-1)[0];
  assert.strictEqual(nueva['Estado'], 'Esperando respuesta profesional');
  assert.ok(/Mismo profesional/.test(nueva['Origen servicio']));
  const of = EM.ctx.tabla_('Ofertas').todas().filter(o => o['Código OC'] === nueva['Código'])[0];
  assert.strictEqual(of['Código PRO'], FM.pro);
  const tof = ultimoToken(EM, FM.pEmail, 'gestion');
  assert.ok(accionWeb(EM, tof, { a: 'si', disp: 'HOY' }).ok);
  assert.strictEqual(EM.ctx.solicitud_(nueva['Código'])['Profesional asignado (PRO)'], FM.pro);
  assert.strictEqual(EM.ctx.solicitud_(nueva['Código'])['Presupuesto vigente'], '');
  accionWeb(EM, FM.tSeg, { a: 'fin_si' });
  assert.strictEqual(EM.ctx.tabla_('Comisiones').todas().filter(c => c['Código PRO'] === FM.pro).length, 1, 'cada servicio con su propia comisión');
});

caso('20. El cliente vuelve días después con su enlace; nunca ve solicitudes ajenas', () => {
  const pg = pagina(EM, FM.tSeg);
  assert.ok(pg.titulo.includes(FM.oc));
  const otro = hastaFin(EM, 100, 0);
  const pOtro = pagina(EM, otro.tSeg).cuerpo;
  assert.ok(!pOtro.includes(FM.oc) && !pOtro.includes('Tus servicios'));
  const r = accionWeb(EM, otro.tSeg, { a: 'abrir_servicio', oc: FM.oc });
  assert.ok(!r.ok, 'no puede abrir un servicio de otro cliente');
  const grupo = EM.ctx.serviciosDelGrupo_(EM.ctx.solicitud_(FM.oc));
  const r2 = accionWeb(EM, FM.tSeg, { a: 'abrir_servicio', oc: grupo[1]['Código'] });
  assert.ok(r2.ok && /^[a-f0-9]{64}$/.test(r2.t));
  assert.ok(pagina(EM, r2.t).titulo.includes(grupo[1]['Código']));
  assert.ok(!pagina(EM, 'f'.repeat(64)).ok || /no válido/i.test(pagina(EM, 'f'.repeat(64)).titulo));
});

caso('23. Correos: el cliente recibe solo los 4 avisos (con botón directo); el profesional solo cuando debe actuar', () => {
  const asuntosCli = correosA(E, F.email).map(m => m.subject);
  assert.ok(asuntosCli.length <= 4, asuntosCli.join(' | '));
  ['Hemos recibido tu solicitud', 'Tienes un profesional disponible', 'Confirma el acuerdo', '¿Ha terminado el trabajo?'].forEach(t => assert.ok(asuntosCli.some(a => a.includes(t)), 'falta ' + t));
  correosA(E, F.email).forEach(m => assert.ok(/seguimiento\/#[a-f0-9]{64}/.test(m.htmlBody), 'botón directo en ' + m.subject));
  const asuntosPro = correosA(E, F.pEmail).map(m => m.subject);
  assert.ok(asuntosPro.every(a => /oportunidad|Cliente asignado|confirmó el acuerdo/.test(a)), asuntosPro.join(' | '));
  correosA(E, F.pEmail).forEach(m => assert.ok(/gestion\/#[a-f0-9]{64}/.test(m.htmlBody), 'botón en ' + m.subject));
  assert.ok(!E.enviados.some(m => /Valora el servicio|Buen trabajo|ya está cubierta/.test(m.subject)), 'correos retirados');
});

caso('24. Recordatorios: como máximo UNO y se cancela si la acción ya se hizo', () => {
  const E2 = crearEntorno();
  const pro = nuevoPro(E2), r = solicitudWeb(E2); tick(E2);
  const pe = E2.ctx.profesional_(pro)['Email'], ce = E2.ctx.solicitud_(r.code)['Email'];
  accionWeb(E2, ultimoToken(E2, pe, 'gestion'), { a: 'si', disp: 'HOY' }); tick(E2);
  const tg = ultimoToken(E2, pe, 'gestion');
  const sol = E2.ctx.solicitud_(r.code);
  E2.ctx.tabla_('Solicitudes').poner(sol._fila, { 'Fecha asignación': new Date(Date.now() - 4 * 86400e3) });
  E2.ctx.recordatoriosV16_(); E2.ctx.recordatoriosV16_(); tick(E2);
  assert.strictEqual(correosA(E2, pe).filter(m => /Recordatorio: registra el acuerdo/.test(m.subject)).length, 1);
  accionWeb(E2, tg, { a: 'acuerdo', mo: 100, mat: 0 }); tick(E2);
  const pr = E2.ctx.tabla_('Presupuestos').todas().slice(-1)[0];
  E2.ctx.tabla_('Presupuestos').poner(pr._fila, { 'Fecha': new Date(Date.now() - 3 * 86400e3) });
  // la acción se hace ANTES de que salga el recordatorio → no se envía
  E2.ctx.recordatoriosV16_();
  accionWeb(E2, ultimoToken(E2, ce, 'seguimiento'), { a: 'acuerdo', d: 'confirmar' });
  tick(E2);
  assert.strictEqual(correosA(E2, ce).filter(m => /Recordatorio/.test(m.subject)).length, 0);
  assert.ok(E2.ctx.tabla_('Historial envíos').todas().some(h => h['Tipo'] === 'recordatorio_acuerdo' && h['Estado'] === 'Omitido'));
});

caso('25. Activadores: se recrean una sola vez cada uno (sin duplicados) aunque se ejecute varias veces', () => {
  const E2 = crearEntorno();
  E2.ctx.repararActivadoresV16(); E2.ctx.repararActivadoresV16();
  const n = {}; E2.triggers.forEach(t => { n[t.getHandlerFunction()] = (n[t.getHandlerFunction()] || 0) + 1; });
  assert.deepStrictEqual(n, { procesarPendientes: 1, cicloAutomatico: 1, alEditar: 1, alAbrir: 1, resumenDiario: 1 });
});

caso('Condiciones V3: versión registrada por profesional; con versión anterior no recibe nuevas oportunidades hasta aceptar', () => {
  const E2 = crearEntorno();
  assert.strictEqual(E2.ctx.condVigente_(), 'PRO-COND-2026-10-V3');
  const viejo = nuevoPro(E2, 'Viejo', { 'Condiciones (versión)': 'PRO-COND-2026-10-V2' });
  const r = solicitudWeb(E2); tick(E2);
  assert.ok(!E2.ctx.tabla_('Ofertas').todas().some(o => o['Código PRO'] === viejo));
  E2.ctx.pedirAceptacionCondiciones(); tick(E2);
  const pe = E2.ctx.profesional_(viejo)['Email'], m = correosA(E2, pe).filter(x => /Nuevas condiciones/.test(x.subject))[0];
  assert.ok(m && /10 % de los primeros 2.000 €/.test(m.htmlBody));
  const t = tokenDe(m.htmlBody, 'gestion');
  assert.ok(/He leído y acepto/.test(pagina(E2, t).cuerpo));
  assert.ok(accionWeb(E2, t, { a: 'aceptar' }).ok);
  assert.strictEqual(E2.ctx.profesional_(viejo)['Condiciones (versión)'], 'PRO-COND-2026-10-V3');
  assert.ok(E2.ctx.tabla_('Aceptaciones condiciones').todas().some(a => a['Código PRO'] === viejo && a['Versión'] === 'PRO-COND-2026-10-V3'));
  const reg = postWeb(E2, { tipo: 'profesional', nombre: 'Nuevo', whatsapp: '600', email: 'n@example.com', experiencia: '5', ciudad: 'Córdoba', codigoPostal: '14001', zonas: 'Centro',
    distancia: 'Toda la ciudad', disponibilidad: 'Esta semana', conParticulares: 'Sí', conEmpresas: 'Sí', servicios: ['electricidad'], consentCondiciones: 'si', condVersion: 'PRO-COND-2026-10-V3' });
  assert.ok(reg.ok && E2.ctx.tabla_('Aceptaciones condiciones').todas().some(a => a['Código PRO'] === reg.code && a['Origen'] === 'Formulario de registro'));
});

caso('Migración V1.6 de estados antiguos (idempotente)', () => {
  const E2 = crearEntorno(), c = E2.ctx;
  c.tabla_('Solicitudes').agregar({ 'Código': 'OC-9001', Estado: 'Cliente aceptó', Nombre: 'x' });
  c.tabla_('Solicitudes').agregar({ 'Código': 'OC-9002', Estado: 'Valorada', Nombre: 'x', 'Finalizado (fecha)': new Date() });
  c.tabla_('Presupuestos').agregar({ ID: 'P-OC-9001-v1', Estado: 'Aceptado' });
  c.tabla_('Comisiones').agregar({ 'Código OC': 'OC-9001', Estado: 'Pendiente de habilitación' });
  c.instalarV14 = () => { }; c.instalarV16();
  assert.strictEqual(c.solicitud_('OC-9001')['Estado'], 'Acuerdo confirmado');
  assert.strictEqual(c.solicitud_('OC-9002')['Estado'], 'Cerrado');
  assert.strictEqual(c.tabla_('Presupuestos').todas()[0]['Estado'], 'Confirmado');
  assert.strictEqual(c.tabla_('Comisiones').todas()[0]['Estado'], 'NO_HABILITADA');
});

caso('Solicitud siempre guardada (aunque falle el correo) y doble envío sin duplicar', () => {
  const E2 = crearEntorno();
  E2.ctx.MailApp.sendEmail = () => { throw new Error('caída simulada'); };
  const d = { tipo: 'solicitud', tipoSolicitante: 'Particular', nombre: 'X', whatsapp: '600123123', email: 'x@example.com', zona: 'Centro', oficio: 'electricidad', descripcion: 'Igual', plazo: 'FLEXIBLE', consentOperativo: 'si' };
  const a = postWeb(E2, d), b = postWeb(E2, d);
  assert.ok(a.ok && b.ok && a.code === b.code && b.duplicada);
  tick(E2);
  assert.strictEqual(E2.ctx.tabla_('Solicitudes').todas().length, 1);
});

/* ===================================================== RESUMEN */
resultados.forEach(r => console.log(r[0] + ' · ' + r[1]));
const err = resultados.filter(r => r[0] !== 'OK').length;
console.log('\n' + (resultados.length - err) + '/' + resultados.length + ' casos OK' + (err ? ' · ' + err + ' con ERROR' : ' · TODO OK'));
process.exit(err ? 1 : 0);
