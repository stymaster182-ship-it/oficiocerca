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
      b.push(p_('En el seguimiento puedes ver cómo va tu solicitud, pedir ayuda o cancelarla.'));
      break;
    case 'oferta_profesional':
      if (!p) return null;
      asunto = AP + 'Nueva oportunidad ' + oc + ' · ' + servicioTxt_(sol) + ' · ' + sol['Zona'];
      titulo = 'Nueva oportunidad de trabajo · ' + oc; saludo = 'Hola ' + p['Nombre'] + ',';
      adj = fotos_(sol['Carpeta fotos (ID)']);
      b.push(p_('Tenemos un trabajo compatible con tu oficio y zona. Revisa la ficha (no incluye datos del cliente) y dinos si puedes atenderlo.'));
      b.push(tabla_html_([['Solicitud', oc], ['Servicio', servicioTxt_(sol)], ['Zona / barrio', sol['Zona'] + ' (Córdoba)'],
        ['Plazo que pide el cliente', plazoTxt_(sol)], ['Cliente', sol['Tipo solicitante'] || 'Particular'],
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
      b.push(tabla_html_([['Solicitud', oc], ['Servicio', servicioTxt_(sol)], ['Cliente', sol['Nombre'] + (sol['Tipo solicitante'] && sol['Tipo solicitante'] !== 'Particular' ? ' (' + sol['Tipo solicitante'] + ')' : '')], ['Empresa', sol['Empresa'] || '—'], ['WhatsApp', limpio_(sol['WhatsApp'])]]
        .concat(limpio_(sol['Teléfono alt.']) ? [['Teléfono alternativo', limpio_(sol['Teléfono alt.'])]] : []).concat([['Correo', sol['Email']], ['Prefiere que le contactes por', sol['Contacto preferido (para el profesional)']],
        ['Zona', sol['Zona']], ['Código postal', limpio_(sol['Código postal']) || '—'], ['Tu disponibilidad indicada', sol['Disponibilidad profesional']]])));
      b.push(p_('Como indican las condiciones para profesionales, el cliente verá en su seguimiento tu nombre, tu empresa (si la hay), tu WhatsApp y tu correo para poder comunicarse contigo.'));
      b.push(destacado_('Cuando tengas el presupuesto, regístralo aquí: el cliente lo recibirá para aceptarlo o no.'));
      b.push('<div style="text-align:center">' + boton_(d.url, 'REGISTRAR PRESUPUESTO / GESTIONAR TRABAJO') + '</div>');
      b.push(p_('Indica la mano de obra y, aparte, los materiales. Tú fijas tu precio y acuerdas el pago directamente con el cliente. Datos personales: úsalos solo para esta solicitud.'));
      break;
    case 'asignado_cliente':
      if (!p) return null;
      asunto = A + 'Hemos encontrado un profesional · ' + oc;
      titulo = 'Hemos encontrado un profesional que puede atender tu solicitud'; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(tabla_html_([['Solicitud', oc], ['Profesional', p['Nombre'] + (p['Empresa / autónomo'] ? ' · ' + p['Empresa / autónomo'] : '')], ['Disponibilidad indicada', d.disp || sol['Disponibilidad profesional']],
        ['WhatsApp del profesional', limpio_(p['WhatsApp'])], ['Correo del profesional', p['Email']]]));
      b.push(p_('Siguiente paso: el profesional te contactará (' + sol['Contacto preferido (para el profesional)'] + ', como preferiste) para valorar el trabajo y prepararte un presupuesto. El presupuesto te llegará también por este correo para que lo aceptes o no. Tú decides.'));
      b.push(p_('El pago del trabajo se acuerda directamente con el profesional.'));
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
      b.push(p_('Opciones: «Sí, el trabajo terminó correctamente» · «Terminó, pero tengo un problema» · «El trabajo todavía no ha terminado».'));
      break;
    case 'recordatorio_fin':
      if (sol['Estado'] !== 'Finalización por confirmar') return null;
      asunto = A + 'Recordatorio: ¿ha terminado el trabajo? · ' + oc;
      titulo = 'Recordatorio: confirma si el trabajo ha terminado'; saludo = 'Hola ' + sol['Nombre'] + ',';
      b.push(p_('El profesional indicó que el trabajo de tu solicitud ' + oc + ' ha terminado. Cuando puedas, confírmalo desde tu seguimiento. Mientras no respondas, la solicitud sigue abierta: no damos nada por finalizado sin tu confirmación.'));
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
      b.push(tabla_html_([['Código', pro], ['Tipo de proveedor', p['Tipo de proveedor'] || '—'], ['Servicios', p['Servicios'] + (p['Servicio otro'] ? ' (' + p['Servicio otro'] + ')' : '')], ['Condiciones aceptadas', p['Condiciones (versión)']]]));
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
    case 'comision_exigible_sbx':
      return sbxComponerCorreo_(oc, pro, d); // PRUEBA / SANDBOX
    case 'resumen_diario':
      return { asunto: '[OficioCerca · Resumen diario] ' + d.fecha, html: plantilla_('Resumen diario · ' + d.fecha, '', [d.html], 'Un único resumen al día'), texto: texto_(d.html) };
    default:
      throw new Error('Plantilla desconocida: ' + tipo);
  }
  if (d.urlSeg) b.push('<div style="text-align:center;margin-top:18px">' + boton_(d.urlSeg, 'VER SEGUIMIENTO DE MI SOLICITUD', '#1C3352') + '</div>');
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
