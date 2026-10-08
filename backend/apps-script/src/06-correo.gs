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
  var reserva = esAlerta ? 0 : cfgNum_('CUOTA_RESERVA', 3);
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
  th.todas().filter(function (r) { return r['Estado'] === 'Pendiente por cuota' || r['Estado'] === 'En cola'; }).forEach(function (r) { enviarFila_(r._fila); });
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
  var r = tabla_('Tokens').buscar('Hash', hash_(t));
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
 * Cliente: SOLO 4 tipos de aviso (1 solicitud recibida · 2 profesional/contacto disponible · 3 acuerdo pendiente ·
 * 4 finalización pendiente + valoración), con su botón directo al seguimiento de ESE servicio. Un recordatorio como máximo.
 * Profesional: solo cuando debe actuar (oportunidad, cliente asignado, acuerdo, trabajo/cierre, comisión, pago). */
var CORREOS_RETIRADOS_V16 = ['solicitud_cubierta', 'presupuesto_cliente', 'presupuesto_aceptado_pro', 'presupuesto_rechazado_pro', 'presupuesto_hablar_pro',
  'valorar_cliente', 'buen_trabajo_pro', 'comision_exigible_sbx'];

function datosProTxt_(p) { return p ? p['Nombre'] + (p['Empresa / autónomo'] ? ' · ' + p['Empresa / autónomo'] : '') : ''; }
function fechaAcordadaTxt_(v) { var f = fechaIso_(v); return /^\d{4}-\d{2}-\d{2}$/.test(f) ? f.split('-').reverse().join('/') : 'Sin fecha concreta'; }
function prefijoPrueba_(c) { return c && c['Ambiente'] === 'SANDBOX' ? '[PRUEBA / SANDBOX] ' : ''; }

/** Compone un correo a partir de los datos ACTUALES de la hoja. Devuelve null si ya no aplica (acción hecha → no se envía). */
function componer_(tipo, oc, pro, d) {
  if (CORREOS_RETIRADOS_V16.indexOf(tipo) >= 0) return null;
  var sol = oc ? solicitud_(oc) : null, p = pro ? profesional_(pro) : null;
  var A = '[OficioCerca] ', AP = '[OficioCerca Profesionales] ', asunto, titulo, saludo, b = [], adj = [], btnSeg = '';
  var com = oc ? comisionDeOC_(oc) : null;
  switch (tipo) {
    /* ---------------- CLIENTE (4 avisos) ---------------- */
    case 'confirmacion_cliente': // 1
      asunto = A + 'Hemos recibido tu solicitud ' + oc;
      titulo = 'Hemos recibido tu solicitud ' + oc; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(tabla_html_([['Código', oc], ['Servicio', servicioTxt_(sol)], ['Zona', sol['Zona']], ['Plazo solicitado', plazoTxt_(sol)],
        ['Resumen', String(sol['Descripción']).slice(0, 400) + (String(sol['Descripción']).length > 400 ? '…' : '')]]));
      b.push(p_('Qué pasa ahora: buscamos un profesional compatible con tu trabajo, zona y plazo y le enviamos la información sin tus datos de contacto. Te avisaremos por correo cuando haya un profesional disponible.'));
      b.push(p_('Guarda este correo: el botón te lleva a tu página privada de seguimiento (sin cuenta ni contraseña). Desde ahí puedes ver el estado, añadir otro servicio, pedir ayuda o cancelar. No ofrecemos servicio de urgencias 24 horas.'));
      btnSeg = 'VER MI SOLICITUD';
      break;
    case 'asignado_cliente': // 2
      if (!p) return null;
      asunto = A + 'Tienes un profesional disponible · ' + oc;
      titulo = 'Hemos encontrado un profesional para tu solicitud'; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(tabla_html_([['Solicitud', oc + ' · ' + servicioTxt_(sol)], ['Profesional', datosProTxt_(p)], ['Disponibilidad indicada', d.disp || sol['Disponibilidad profesional']],
        ['WhatsApp del profesional', limpio_(p['WhatsApp'])], ['Correo del profesional', p['Email']]]));
      b.push(p_('Qué pasa ahora: el profesional te contactará (' + sol['Contacto preferido (para el profesional)'] + ') para valorar el trabajo. Cuando os pongáis de acuerdo, registrará el acuerdo y te pediremos que lo confirmes. El pago del trabajo se acuerda directamente con el profesional.'));
      btnSeg = 'VER MI SOLICITUD';
      break;
    case 'respaldo_cliente': // 2 (variante: solo hay disponibilidad posterior)
      var of = tabla_('Ofertas').buscar('ID', d.token.ref);
      if (!of || sol['Estado'] !== 'Esperando decisión cliente') return null;
      asunto = A + 'Hay un profesional disponible más adelante · ' + oc;
      titulo = 'Necesitamos tu decisión'; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(p_('Pediste: ' + plazoTxt_(sol) + '. El profesional más próximo puede atenderte aproximadamente: ' + of['Disponibilidad'] + '.'));
      b.push(p_('Elige: continuar con este profesional, seguir buscando o cancelar. Hasta que respondas no compartimos tus datos de contacto con nadie.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'ELEGIR UNA OPCIÓN') + '</div>');
      break;
    case 'acuerdo_cliente': // 3
    case 'recordatorio_acuerdo':
      var pr = tabla_('Presupuestos').buscar('ID', d.presupuesto);
      if (!pr || pr['Estado'] !== 'Pendiente del cliente' || sol['Presupuesto vigente'] !== pr['ID']) return null;
      var rec = tipo === 'recordatorio_acuerdo';
      asunto = A + (rec ? 'Recordatorio: ' : '') + (d.cambio ? 'El acuerdo ha cambiado: confírmalo · ' : 'Confirma el acuerdo con tu profesional · ') + oc;
      titulo = d.cambio ? 'El profesional ha modificado el acuerdo' : 'Confirma el acuerdo con tu profesional'; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(tabla_html_([['Servicio', oc + ' · ' + servicioTxt_(sol)], ['Profesional', datosProTxt_(p)], ['Mano de obra', euros_(pr['Mano de obra (€)'])],
        ['Materiales', euros_(pr['Materiales (€)'])], ['Total', euros_(pr['Total (€)'])], ['Fecha acordada', fechaAcordadaTxt_(pr['Fecha acordada'])], ['Nota', pr['Observaciones'] || '—']]));
      b.push(p_('Revisa que coincide con lo que hablasteis y pulsa «Confirmar acuerdo» o «No estoy de acuerdo». Confirmar es gratuito para ti. El pago del trabajo se hace directamente al profesional.'));
      btnSeg = 'REVISAR Y CONFIRMAR EL ACUERDO';
      break;
    case 'fin_cliente': // 4
    case 'recordatorio_fin':
      if (sol['Estado'] !== 'Finalización por confirmar') return null;
      asunto = A + (tipo === 'recordatorio_fin' ? 'Recordatorio: ' : '') + '¿Ha terminado el trabajo? · ' + oc;
      titulo = 'El profesional indica que el trabajo ha terminado'; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(p_('¿Puedes confirmarlo? Solo cerramos el servicio ' + oc + ' (' + servicioTxt_(sol) + ') cuando tú lo confirmas. Opciones: «Sí, terminó» · «Todavía no» · «Hay un problema». Después podrás valorar el servicio en la misma página.'));
      btnSeg = 'CONFIRMAR Y VALORAR';
      break;

    /* ---------------- PROFESIONAL (solo cuando debe actuar) ---------------- */
    case 'oferta_profesional':
      if (!p) return null;
      asunto = AP + 'Nueva oportunidad ' + oc + ' · ' + servicioTxt_(sol) + ' · ' + sol['Zona'];
      titulo = 'Nueva oportunidad de trabajo · ' + oc; saludo = 'Hola ' + p['Nombre'] + ',';
      adj = fotos_(sol['Carpeta fotos (ID)']);
      b.push(p_(/mismo profesional/i.test(sol['Origen servicio'] || '') ? 'Un cliente con el que ya trabajaste te pide otro servicio. Revisa la ficha y dinos si puedes atenderlo.' :
        'Tenemos un trabajo compatible con tu oficio y zona. Revisa la ficha (sin datos del cliente) y dinos si puedes atenderlo. Recibir la oportunidad es gratis.'));
      b.push(tabla_html_([['Solicitud', oc], ['Servicio', servicioTxt_(sol)], ['Zona / barrio', sol['Zona'] + ' (Córdoba)'],
        ['Plazo que pide el cliente', plazoTxt_(sol)], ['Cliente', sol['Tipo solicitante'] || 'Particular'],
        ['Fotos', adj.length ? adj.length + ' adjunta(s) a este correo' : 'Sin fotos'], ['Descripción', sol['Descripción']]]));
      b.push('<div style="text-align:center;margin:18px 0">' + boton_(d.url, 'RESPONDER A ESTA OPORTUNIDAD') + '</div>');
      b.push(p_('Responde antes del ' + fecha_(d.expira) + '; después la ofreceremos a otro profesional. Rechazarla no tiene ningún coste. Esta ficha es confidencial.'));
      break;
    case 'contacto_profesional':
      if (!p) return null;
      asunto = AP + 'Cliente asignado: datos de contacto · ' + oc;
      titulo = 'Te hemos asignado la solicitud ' + oc; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(tabla_html_([['Solicitud', oc], ['Servicio', servicioTxt_(sol)], ['Cliente', sol['Nombre'] + (sol['Tipo solicitante'] && sol['Tipo solicitante'] !== 'Particular' ? ' (' + sol['Tipo solicitante'] + ')' : '')], ['Empresa', sol['Empresa'] || '—'], ['WhatsApp', limpio_(sol['WhatsApp'])]]
        .concat(limpio_(sol['Teléfono alt.']) ? [['Teléfono alternativo', limpio_(sol['Teléfono alt.'])]] : []).concat([['Correo', sol['Email']], ['Prefiere que le contactes por', sol['Contacto preferido (para el profesional)']],
        ['Zona', sol['Zona']], ['Código postal', limpio_(sol['Código postal']) || '—'], ['Tu disponibilidad indicada', sol['Disponibilidad profesional']]])));
      b.push(destacado_('Qué haces ahora: contacta con el cliente. Cuando acordéis precio y fecha, pulsa «Ya hablé con el cliente / Registrar acuerdo».'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'GESTIONAR ESTE TRABAJO') + '</div>');
      b.push(p_('El cliente ve tu nombre, empresa, WhatsApp y correo para comunicarse contigo. Usa sus datos solo para este servicio.'));
      break;
    case 'recordatorio_acuerdo_pro':
      if (!p || sol['Estado'] !== 'Profesional asignado' || sol['Profesional asignado (PRO)'] !== pro) return null;
      asunto = AP + 'Recordatorio: registra el acuerdo · ' + oc;
      titulo = '¿Ya hablaste con el cliente?'; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(p_('Cuando acordéis mano de obra, materiales y fecha para ' + oc + ' (' + servicioTxt_(sol) + '), regístralo para que el cliente lo confirme. Si no vas a hacer el trabajo, avísanos desde la misma página.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'REGISTRAR ACUERDO') + '</div>');
      break;
    case 'acuerdo_confirmado_pro':
      if (!p) return null;
      asunto = AP + 'El cliente confirmó el acuerdo · ' + oc;
      titulo = 'Acuerdo confirmado por el cliente'; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(p_('El cliente ha confirmado el acuerdo de ' + oc + '. Cuando termines el trabajo, pulsa «Trabajo terminado»: el cliente lo confirmará.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'GESTIONAR ESTE TRABAJO') + '</div>');
      break;
    case 'acuerdo_no_confirmado_pro':
      if (!p || sol['Estado'] !== 'Acuerdo no confirmado') return null;
      asunto = AP + 'El cliente no está de acuerdo · ' + oc;
      titulo = 'El cliente no ha confirmado el acuerdo'; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(p_('Habla con el cliente. Si llegáis a otro acuerdo, regístralo de nuevo: el cliente tendrá que confirmarlo.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'REGISTRAR NUEVO ACUERDO') + '</div>');
      break;
    case 'aun_no_pro':
      if (!p) return null;
      asunto = AP + 'El cliente indica que el trabajo aún no ha terminado · ' + oc;
      titulo = 'El cliente indica que aún no ha terminado'; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(p_('Cuando el trabajo esté terminado, vuelve a indicarlo:'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'TRABAJO TERMINADO') + '</div>');
      break;
    case 'comision_exigible':
    case 'recordatorio_comision':
      if (!p || !com || ESTADOS_COMISION_BLOQUEAN.indexOf(com['Estado']) < 0 || com['Estado'] === 'MANUAL_REVIEW') return null;
      asunto = AP + prefijoPrueba_(com) + (tipo === 'recordatorio_comision' ? 'Recordatorio: ' : '') + 'Comisión pendiente · ' + oc;
      titulo = prefijoPrueba_(com) + 'El cliente confirmó el trabajo: comisión pendiente'; saludo = 'Hola ' + p['Nombre'] + ',';
      if (com['Ambiente'] === 'SANDBOX') b.push(destacado_('PRUEBA / SANDBOX: correo de prueba. No se cobra dinero real.'));
      b.push(tabla_html_([['Trabajo', oc + ' · ' + servicioTxt_(sol)], ['Mano de obra confirmada', euros_(com['Mano de obra (€)'])], ['Materiales (no cuentan)', euros_(com['Materiales (€)'])],
        ['10 % de los primeros 2.000 €', euros_(com['Tramo 10 % (€)'])], ['5 % del exceso', euros_(com['Tramo 5 % (€)'])], ['Comisión', euros_(com['Importe comisión (€)'])]]));
      b.push('<div style="text-align:center">' + boton_(urlPagoComision_(oc, pro), com['Ambiente'] === 'SANDBOX' ? 'PAGAR COMISIÓN (SANDBOX)' : 'PAGAR COMISIÓN', com['Ambiente'] === 'SANDBOX' ? '#7B1FA2' : '') + '</div>');
      b.push(p_('Mientras esté pendiente no recibirás NUEVAS oportunidades. Tu cuenta, tu historial y tus trabajos en curso no cambian. Al confirmarse el pago vuelves a recibirlas automáticamente.'));
      break;
    case 'pago_aprobado_pro':
      if (!p || !com || com['Estado'] !== 'PAID') return null;
      asunto = AP + prefijoPrueba_(com) + 'Pago recibido · ' + oc;
      titulo = 'Pago de la comisión confirmado'; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(p_('Hemos recibido el pago de la comisión de ' + oc + ' (' + euros_(com['Importe comisión (€)']) + ', referencia ' + com['Referencia vigente'] + '). El servicio queda cerrado y vuelves a recibir oportunidades.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'VER EL TRABAJO') + '</div>');
      break;
    case 'pago_rechazado_pro':
      if (!p || !com || com['Estado'] !== 'PAYMENT_FAILED') return null;
      asunto = AP + prefijoPrueba_(com) + 'El pago no se completó · ' + oc;
      titulo = 'El pago de la comisión no se completó'; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(p_('Wompi no aprobó el pago de la comisión de ' + oc + '. No se ha cobrado nada. Puedes intentarlo de nuevo:'));
      b.push('<div style="text-align:center">' + boton_(urlPagoComision_(oc, pro), 'INTENTAR DE NUEVO') + '</div>');
      break;
    case 'condiciones_pro':
      if (!p || condAlDia_(p)) return null;
      asunto = AP + 'Nuevas condiciones ' + condVigente_() + ': acéptalas para seguir recibiendo oportunidades';
      titulo = 'Hemos actualizado las condiciones'; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(p_('Novedades: la comisión pasa a ser el 10 % de los primeros 2.000 € de mano de obra y el 5 % del exceso, sin tope y sin contar materiales. Solo se genera cuando el cliente confirma que el trabajo terminó. Registrarte, recibir oportunidades, rechazarlas o no cerrar un acuerdo no tiene coste.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'LEER Y ACEPTAR LAS CONDICIONES') + '</div>');
      b.push(p_('Tus trabajos e historial no cambian. Hasta que las aceptes no recibirás nuevas oportunidades.'));
      break;
    case 'registro_profesional':
      if (!p) return null;
      asunto = AP + 'Hemos recibido tu registro ' + pro;
      titulo = 'Registro recibido · ' + pro; saludo = 'Hola ' + p['Nombre'] + ',';
      b.push(tabla_html_([['Código', pro], ['Tipo de proveedor', p['Tipo de proveedor'] || '—'], ['Servicios', p['Servicios'] + (p['Servicio otro'] ? ' (' + p['Servicio otro'] + ')' : '')], ['Condiciones aceptadas', p['Condiciones (versión)']]]));
      b.push(p_('Revisaremos tus datos. Cuando tu alta quede activa te avisaremos y empezarás a recibir oportunidades compatibles con tus servicios y tu zona.'));
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
  if (btnSeg && d.urlSeg) b.push('<div style="text-align:center;margin:18px 0">' + boton_(d.urlSeg, btnSeg) + '</div>');
  else if (d.urlSeg) b.push('<div style="text-align:center;margin-top:18px">' + boton_(d.urlSeg, 'VER MI SOLICITUD', '#1C3352') + '</div>');
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
