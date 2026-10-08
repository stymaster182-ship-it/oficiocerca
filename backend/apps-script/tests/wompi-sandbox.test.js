/* Pruebas OFFLINE del módulo Wompi SANDBOX (node backend/apps-script/tests/wompi-sandbox.test.js).
 * Ejecuta el Code.gs real con simuladores de Apps Script en memoria. Sin red, sin Wompi, sin dinero.
 * Los "secretos" de aquí son FALSOS y generados al vuelo: no son credenciales de Wompi. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), crypto = require('crypto'), assert = require('assert');

function crearEntorno() {
  const sheets = {}, props = {}, enviados = [];
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
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
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
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }), getProjectTriggers: () => [] },
    DriveApp: {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  props.SPREADSHEET_ID = 'TEST';
  Object.keys(ctx.ESQUEMA).forEach(n => { if (!sheets[n]) { sheets[n] = new Sheet(n); sheets[n].appendRow(ctx.ESQUEMA[n]); } });
  ctx.CONFIG_DEFECTO.forEach(r => ctx.tabla_('Configuración').agregar({ Clave: r[0], Valor: r[1], 'Descripción': r[2] }));
  ctx.instalarWompiSandbox();
  return { ctx, sheets, props, enviados, S };
}

function cfg(E, k, v) { E.ctx.cfgPoner_(k, v); }
function activarSandbox(E) {
  cfg(E, 'WOMPI_SANDBOX_ENABLED', 'TRUE'); cfg(E, 'SANDBOX_EMAIL_TEST', 'pruebas.sandbox@example.com');
  E.props.WOMPI_TEST_PUBLIC_KEY = 'pub_test_FAKEPUBLICKEY000';
  E.props.WOMPI_TEST_INTEGRITY_SECRET = E.S.integ;
  E.props.WOMPI_TEST_EVENTS_SECRET = E.S.evento;
}
let nPro = 0, nOc = 0;
function nuevoPro(E, nombre) {
  const code = 'PRO-' + String(++nPro).padStart(4, '0');
  E.ctx.tabla_('Profesionales').agregar({ 'Código': code, Fecha: new Date(), Estado: 'Activo', Nombre: nombre || 'PRUEBA Profesional', Email: 'pro' + nPro + '@example.com',
    'Servicios (códigos)': 'electricidad', 'Condiciones (versión)': 'PRO-COND-2026-10-V2', 'Condiciones aceptadas (fecha)': new Date(),
    'Con particulares': 'Sí', 'Con empresas': 'Sí', Ciudad: 'Córdoba', Distancia: 'Toda la ciudad', Zonas: 'Centro' });
  return code;
}
function nuevaSol(E, pro, nombre) {
  const oc = 'OC-' + String(++nOc).padStart(4, '0');
  E.ctx.tabla_('Solicitudes').agregar({ 'Código': oc, Fecha: new Date(), Estado: pro ? 'Profesional asignado' : 'Buscando profesional', Nombre: nombre || 'PRUEBA Cliente',
    Email: 'cliente' + nOc + '@example.com', 'Tipo solicitante': 'Particular', Ciudad: 'Córdoba', Zona: 'Centro', 'Servicio (código)': 'electricidad',
    Servicio: 'Electricidad', 'Plazo (código)': 'FLEXIBLE', Plazo: 'Flexible', 'Profesional asignado (PRO)': pro || '' });
  return oc;
}
/** Flujo completo hasta que el cliente confirma el fin. */
function hastaDue(E, mo, mat, nombres) {
  const pro = nuevoPro(E, nombres && nombres.pro), oc = nuevaSol(E, pro, nombres && nombres.cli), c = E.ctx;
  assert.ok(c.registrarPresupuesto_(oc, pro, mo, mat, '').ok);
  const presId = c.solicitud_(oc)['Presupuesto vigente'];
  assert.ok(c.procesarRespuestaPresupuesto_(presId, 'aceptar').ok);
  return { pro, oc };
}
function finalizar(E, oc, pro, decision) {
  assert.ok(E.ctx.marcarFinalizado_(oc, pro).ok);
  return E.ctx.procesarFinCliente_(oc, decision || 'si', '', false);
}
const com = (E, oc) => E.ctx.sbxComisionDe_(oc);
function evento(E, tx, opts) {
  opts = opts || {};
  const ev = { event: 'transaction.updated', data: { transaction: tx }, environment: opts.env || 'test', timestamp: opts.ts || Math.floor(Date.now() / 1000),
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'] } };
  const cadena = ev.signature.properties.map(p => p.split('.').reduce((o, k) => o[k], ev.data)).join('') + ev.timestamp + (opts.secreto || E.S.evento);
  ev.signature.checksum = crypto.createHash('sha256').update(cadena).digest('hex');
  return ev;
}
function postEvento(E, ev) { return JSON.parse(E.ctx.doPost({ postData: { contents: JSON.stringify(ev) } }).s); }
function tx(pago, status, id) { return { id: id || ('15113-' + crypto.randomBytes(4).toString('hex')), status, reference: pago['Referencia'], amount_in_cents: pago['Importe (centavos)'], currency: 'COP' }; }

const resultados = [];
function caso(nombre, fn) {
  try { fn(); resultados.push(['OK', nombre]); } catch (e) { resultados.push(['ERROR', nombre + ' → ' + (e && e.stack || e)]); }
}

/* ===================================================== CASOS */
caso('0. Sandbox desactivado por defecto: flujo actual sin cambios y sin filas sandbox', () => {
  const E = crearEntorno();
  const { oc, pro } = hastaDue(E, 1000, 300);
  const r = finalizar(E, oc, pro);
  assert.ok(r.ok);
  assert.strictEqual(com(E, oc), null);
  assert.strictEqual(E.ctx.tabla_('Comisiones').todas()[0]['Estado'], 'Pendiente de habilitación'); // producción intacta
  assert.strictEqual(E.ctx.cfgBool_('COMMISSION_COLLECTION_ENABLED'), false);
  assert.deepStrictEqual(Object.keys(E.ctx.sbxProsBloqueados_()), []);
});

caso('0b. Datos REALES (sin «PRUEBA») nunca entran en sandbox aunque esté activo', () => {
  const E = crearEntorno(); activarSandbox(E);
  const { oc, pro } = hastaDue(E, 1000, 0, { pro: 'Juan Real', cli: 'Ana Real' });
  finalizar(E, oc, pro);
  assert.strictEqual(com(E, oc), null);
});

caso('0c. Credencial de producción detectada → se detiene', () => {
  const E = crearEntorno(); activarSandbox(E);
  E.props.WOMPI_TEST_INTEGRITY_SECRET = 'prod_integrity_XXXX';
  assert.throws(() => E.ctx.sbxCred_('integridad'), /PRODUCCION_DETECTADA/);
  E.props.WOMPI_TEST_PUBLIC_KEY = 'pub_prod_XXXX';
  assert.throws(() => E.ctx.sbxCred_('pub'), /PRODUCCION_DETECTADA/);
});

caso('Doble cierre: NOT_DUE al aceptar; «Todavía no» y «Hay un problema» NO la hacen exigible; solo «Sí»', () => {
  const E = crearEntorno(); activarSandbox(E);
  const { oc, pro } = hastaDue(E, 500, 100);
  assert.strictEqual(com(E, oc)['Estado'], 'NOT_DUE');
  E.ctx.marcarFinalizado_(oc, pro); // solo el profesional
  assert.strictEqual(com(E, oc)['Estado'], 'NOT_DUE');
  E.ctx.procesarFinCliente_(oc, 'aun_no');
  assert.strictEqual(com(E, oc)['Estado'], 'NOT_DUE');
  E.ctx.marcarFinalizado_(oc, pro);
  E.ctx.procesarFinCliente_(oc, 'problema', 'algo', false);
  assert.strictEqual(com(E, oc)['Estado'], 'NOT_DUE');
  E.ctx.procesarFinCliente_(oc, 'si');
  assert.strictEqual(com(E, oc)['Estado'], 'DUE');
});

let E1, base;
caso('Checkout de pruebas + firma de integridad + referencia + conversión EUR→COP + email PRUEBA/SANDBOX', () => {
  E1 = crearEntorno(); activarSandbox(E1);
  const { oc, pro } = hastaDue(E1, 1000, 400);
  finalizar(E1, oc, pro);
  base = { oc, pro };
  const r = E1.ctx.sbxCrearIntento_(oc);
  assert.ok(r.ok);
  const pg = r.pago;
  assert.match(pg['Referencia'], /^OC-0\d{3}-COM-\d{14}$/);
  assert.strictEqual(pg['Comisión (€)'], 100);
  assert.strictEqual(pg['TEST_EXCHANGE_RATE (ficticia)'], 4500);
  assert.strictEqual(pg['Importe (COP)'], 450000);
  assert.strictEqual(pg['Importe (centavos)'], 45000000);
  const ck = E1.ctx.sbxCheckout_(pg);
  const esperada = crypto.createHash('sha256').update(pg['Referencia'] + '45000000' + 'COP' + E1.S.integ).digest('hex');
  assert.strictEqual(ck.firma, esperada);
  assert.ok(ck.url.startsWith('https://checkout.wompi.co/p/?public-key=pub_test_'));
  assert.ok(ck.url.includes('signature:integrity=' + esperada));
  assert.ok(!ck.url.includes(E1.S.integ), 'el secreto no debe salir en la URL');
  // email
  E1.ctx.procesarCola_();
  const m = E1.enviados.filter(x => /SANDBOX/.test(x.subject))[0];
  assert.ok(m, 'correo sandbox enviado');
  assert.strictEqual(m.to, 'pruebas.sandbox@example.com');
  ['PRUEBA / SANDBOX', 'OC-', '1000,00 €', '400,00 €', '10 %', '100,00 €', '450.000 COP', 'PAGAR COMISIÓN (SANDBOX)', 'DUE'].forEach(t => assert.ok(m.body.includes(t) || m.htmlBody.includes(t), 'falta en correo: ' + t));
  // página de pago
  const tok = /wsbx=([a-f0-9]{64})/.exec(m.htmlBody)[1];
  const page = E1.ctx.doGet({ parameter: { wsbx: tok } }).h;
  ['PRUEBA / SANDBOX', 'Comisión OficioCerca', '100,00 €', '450.000 COP', oc, 'PAGAR COMISIÓN (SANDBOX)', 'TEST_EXCHANGE_RATE'].forEach(t => assert.ok(page.includes(t), 'falta en página: ' + t));
  assert.ok(!page.includes(E1.S.integ));
});

caso('G. Referencia repetida: nunca se reutiliza una referencia ya usada', () => {
  const pagos = E1.ctx.tabla_('Pagos Sandbox').todas(), ref = pagos[0]['Referencia'];
  E1.ctx.tabla_('Pagos Sandbox').poner(pagos[0]._fila, { 'Creado': new Date(Date.now() - 2 * 3600e3) }); // intento viejo
  // forzamos la misma marca de tiempo que la referencia existente
  const ts = ref.slice(-14), fecha = new Date(Date.UTC(+ts.slice(0, 4), +ts.slice(4, 6) - 1, +ts.slice(6, 8), +ts.slice(8, 10) - 2, +ts.slice(10, 12), +ts.slice(12, 14)));
  const r = E1.ctx.sbxCrearIntento_(base.oc, fecha);
  assert.ok(r.ok && !r.reutilizado);
  assert.notStrictEqual(r.pago['Referencia'], ref);
  assert.strictEqual(r.pago['Referencia'], ref + '-2'); // colisión real detectada
  const refs = E1.ctx.tabla_('Pagos Sandbox').todas().map(p => p['Referencia']);
  assert.strictEqual(new Set(refs).size, refs.length);
});

caso('H. Profesional con comisión pendiente NO recibe nuevas oportunidades (trabajos actuales intactos)', () => {
  const nueva = nuevaSol(E1, '');
  const cands = E1.ctx.candidatos_(E1.ctx.solicitud_(nueva), []).map(c => c.pro['Código']);
  assert.ok(!cands.includes(base.pro));
  assert.strictEqual(E1.ctx.solicitud_(base.oc)['Estado'], 'Finalizado'); // no se alteró
  assert.strictEqual(E1.ctx.profesional_(base.pro)['Estado'], 'Activo'); // no se pausó ni borró
});

caso('F. Webhook con firma incorrecta → rechazado, sin cambios', () => {
  const pg = E1.ctx.tabla_('Pagos Sandbox').todas().slice(-1)[0];
  const r = postEvento(E1, evento(E1, tx(pg, 'APPROVED'), { secreto: 'test_events_OTRO' }));
  assert.strictEqual(r.error, 'firma');
  assert.strictEqual(com(E1, base.oc)['Estado'], 'DUE');
});

caso('Evento con ambiente distinto de test → rechazado', () => {
  const pg = E1.ctx.tabla_('Pagos Sandbox').todas().slice(-1)[0];
  const r = postEvento(E1, evento(E1, tx(pg, 'APPROVED'), { env: 'prod' }));
  assert.strictEqual(r.error, 'ambiente');
  assert.strictEqual(com(E1, base.oc)['Estado'], 'DUE');
});

caso('B. Pago DECLINED → PAYMENT_FAILED (sigue bloqueado)', () => {
  const pg = E1.ctx.tabla_('Pagos Sandbox').todas().slice(-1)[0];
  const r = postEvento(E1, evento(E1, tx(pg, 'DECLINED')));
  assert.strictEqual(r.resultado, 'PROCESADO: PAYMENT_FAILED');
  assert.strictEqual(com(E1, base.oc)['Estado'], 'PAYMENT_FAILED');
  assert.ok(E1.ctx.sbxProBloqueado_(base.pro));
});

caso('D. Pago ERROR → PAYMENT_FAILED', () => {
  const r = E1.ctx.sbxCrearIntento_(base.oc, new Date(Date.now() + 5000));
  const pr = postEvento(E1, evento(E1, tx(r.pago, 'ERROR')));
  assert.strictEqual(pr.resultado, 'PROCESADO: PAYMENT_FAILED');
});

let tAprob;
caso('C. Pago PENDING → PAYMENT_PENDING', () => {
  const r = E1.ctx.sbxCrearIntento_(base.oc, new Date(Date.now() + 10000));
  tAprob = tx(r.pago, 'PENDING', '15113-APROBADA-1');
  const pr = postEvento(E1, evento(E1, tAprob));
  assert.strictEqual(pr.resultado, 'PROCESADO: PAYMENT_PENDING');
  assert.strictEqual(com(E1, base.oc)['Estado'], 'PAYMENT_PENDING');
});

caso('A + I. Pago APPROVED → PAID con datos guardados y profesional rehabilitado', () => {
  const pr = postEvento(E1, evento(E1, Object.assign({}, tAprob, { status: 'APPROVED' })));
  assert.strictEqual(pr.resultado, 'PROCESADO: PAID');
  const c = com(E1, base.oc);
  assert.strictEqual(c['Estado'], 'PAID');
  assert.strictEqual(c['Transaction ID'], '15113-APROBADA-1');
  assert.strictEqual(c['Referencia vigente'], tAprob.reference);
  assert.strictEqual(c['Importe pagado (COP)'], 450000);
  assert.strictEqual(c['Moneda'], 'COP');
  assert.ok(c['Fecha pago'] instanceof Date);
  assert.strictEqual(c['Ambiente'], 'SANDBOX');
  assert.ok(!E1.ctx.sbxProBloqueado_(base.pro));
  const nueva = nuevaSol(E1, '');
  assert.ok(E1.ctx.candidatos_(E1.ctx.solicitud_(nueva), []).map(x => x.pro['Código']).includes(base.pro));
});

caso('E. Evento duplicado → idempotente (sin duplicar pagos, comisiones ni registros)', () => {
  const ev = evento(E1, Object.assign({}, tAprob, { status: 'APPROVED' }));
  const antes = E1.ctx.tabla_('Eventos Wompi').todas().length, regAntes = E1.ctx.tabla_('Registro').todas().length;
  const r1 = postEvento(E1, ev), r2 = postEvento(E1, ev);
  assert.ok(r1.duplicado && r2.duplicado);
  assert.strictEqual(E1.ctx.tabla_('Eventos Wompi').todas().length, antes);
  assert.strictEqual(E1.ctx.tabla_('Registro').todas().length, regAntes);
  assert.strictEqual(E1.ctx.tabla_('Comisiones Sandbox').todas().length, 1);
  assert.strictEqual(com(E1, base.oc)['Estado'], 'PAID');
  const fila = E1.ctx.tabla_('Eventos Wompi').todas().filter(e => e['Clave'] === tAprob.id + '|APPROVED')[0];
  assert.strictEqual(fila['Repeticiones'], 2);
  // un DECLINED tardío de otro intento no despaga
  assert.strictEqual(E1.ctx.sbxCrearIntento_(base.oc).pagada, true);
});

caso('Importe manipulado → MANUAL_REVIEW', () => {
  const E = crearEntorno(); activarSandbox(E);
  const { oc, pro } = hastaDue(E, 300, 0); finalizar(E, oc, pro);
  const pg = E.ctx.sbxCrearIntento_(oc).pago;
  const r = postEvento(E, evento(E, Object.assign(tx(pg, 'APPROVED'), { amount_in_cents: 100 })));
  assert.strictEqual(r.resultado, 'MANUAL_REVIEW: importe/moneda');
  assert.strictEqual(com(E, oc)['Estado'], 'MANUAL_REVIEW');
});

caso('VOIDED tras PAID → MANUAL_REVIEW', () => {
  const E = crearEntorno(); activarSandbox(E);
  const { oc, pro } = hastaDue(E, 300, 0); finalizar(E, oc, pro);
  const pg = E.ctx.sbxCrearIntento_(oc).pago, t = tx(pg, 'APPROVED', 'TX-V');
  postEvento(E, evento(E, t));
  const r = postEvento(E, evento(E, Object.assign({}, t, { status: 'VOIDED' })));
  assert.strictEqual(r.resultado, 'MANUAL_REVIEW: pago anulado');
});

caso('J. Materiales NO entran en el 10 %', () => {
  const E = crearEntorno(); activarSandbox(E);
  const { oc } = hastaDue(E, 800, 5000);
  const c = com(E, oc);
  assert.strictEqual(c['Comisión (€)'], 80);
  assert.strictEqual(c['Materiales (€)'], 5000);
  assert.strictEqual(c['Tope aplicado'], 'No');
});

caso('K. Comisión superior a 200 € → tope 200 €', () => {
  const E = crearEntorno(); activarSandbox(E);
  const { oc } = hastaDue(E, 3500, 1000);
  const c = com(E, oc);
  assert.strictEqual(c['Comisión sin tope (€)'], 350);
  assert.strictEqual(c['Comisión (€)'], 200);
  assert.strictEqual(c['Tope aplicado'], 'Sí');
  assert.strictEqual(E.ctx.sbxEurACop_(200, 4500).centavos, 90000000);
});

caso('Sin TEST_EXCHANGE_RATE → no inventa tasa', () => {
  assert.throws(() => crearEntorno().ctx.sbxEurACop_(10, NaN), /TEST_EXCHANGE_RATE/);
});

let fallos = 0;
resultados.forEach(r => { if (r[0] !== 'OK') fallos++; console.log(r[0].padEnd(6) + r[1]); });
console.log('\n' + (resultados.length - fallos) + '/' + resultados.length + ' casos OK');
process.exit(fallos ? 1 : 0);
