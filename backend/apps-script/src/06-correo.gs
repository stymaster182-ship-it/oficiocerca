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
