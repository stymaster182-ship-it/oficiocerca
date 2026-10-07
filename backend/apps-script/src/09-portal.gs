/* ============================================================ V1.5 · PORTAL PRIVADO DE SEGUIMIENTO (/seguimiento/#TOKEN)
 * - Un enlace por correo, aleatorio (64 hex), solo se guarda su SHA-256; ligado a UNA solicitud (OC).
 * - Válido 365 días y revocable (Tokens → Resultado = «Revocado», o revocarSeguimiento('OC-0001')).
 * - El navegador nunca envía el código OC: el servidor lo toma del token. No hay forma de ver otra OC.
 * - Lenguaje humano: no se muestran códigos PRO, IDs internos, comisiones ni estados técnicos.
 */

var PASOS_SEGUIMIENTO = ['Solicitud recibida', 'Buscando profesional', 'Profesional encontrado', 'Contacto realizado',
  'Presupuesto recibido', 'Presupuesto aceptado', 'Trabajo en curso', 'Trabajo finalizado', 'Valoración'];

var ESTADO_HUMANO = {
  'Nueva': 'Buscando un profesional compatible',
  'Buscando profesional': 'Buscando un profesional compatible',
  'Esperando respuesta profesional': 'Buscando un profesional compatible',
  'Revisión manual': 'Estamos revisando tu solicitud',
  'Esperando decisión cliente': 'Necesitamos tu decisión sobre la disponibilidad',
  'Sin profesional compatible': 'Seguimos buscando un profesional disponible',
  'Profesional asignado': 'Profesional encontrado · pendiente de presupuesto',
  'Presupuesto enviado': 'Presupuesto recibido · pendiente de tu respuesta',
  'Presupuesto no aceptado': 'Presupuesto no aceptado',
  'Cliente aceptó': 'Presupuesto aceptado · trabajo en curso',
  'Finalización por confirmar': 'Finalización declarada por el profesional · pendiente de tu confirmación',
  'Finalizado': 'Trabajo finalizado',
  'Valorada': 'Trabajo finalizado y valorado',
  'Cancelada': 'Solicitud cancelada'
};

function pasoActual_(estado) {
  return ({
    'Nueva': 1, 'Buscando profesional': 1, 'Esperando respuesta profesional': 1, 'Revisión manual': 1, 'Esperando decisión cliente': 1,
    'Sin profesional compatible': 1, 'Profesional asignado': 4, 'Presupuesto enviado': 5, 'Presupuesto no aceptado': 4,
    'Cliente aceptó': 6, 'Finalización por confirmar': 7, 'Finalizado': 8, 'Valorada': 9
  })[estado] || 0;
}

function lineaProgreso_(estado) {
  var actual = pasoActual_(estado);
  return '<ol class="prog">' + PASOS_SEGUIMIENTO.map(function (p, i) {
    var cls = i < actual ? 'hecho' : i === actual ? 'ahora' : 'pend';
    var ico = i < actual ? '✓' : i === actual ? '◉' : '○';
    var txt = p;
    if (i === 7 && estado === 'Finalización por confirmar') txt = 'Trabajo finalizado · pendiente de tu confirmación';
    return '<li class="' + cls + '"><span aria-hidden="true">' + ico + '</span> ' + esc_(txt) + '</li>';
  }).join('') + '</ol>';
}

function incidenciaAbierta_(oc) {
  return tabla_('Incidencias').todas().some(function (i) { return i['Código OC'] === oc && i['Tipo'] === 'Incidencia' && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); });
}

function bloqueFin_(prefijo) {
  var a = prefijo || '';
  return '<p>El profesional ha indicado que el trabajo ha terminado.</p>' +
    '<button class="btn" onclick="enviar({a:\'' + a + 'si\'})">✔ Sí, el trabajo terminó correctamente</button>' +
    '<button class="btn rojo" onclick="ver(\'pp\')">Terminó, pero tengo un problema</button>' +
    '<div id="pp" class="panel opc hide"><label for="txt">Cuéntanos qué ha pasado</label><textarea id="txt" maxlength="1500"></textarea>' +
    '<label><input type="checkbox" id="grave" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de mis datos)</label>' +
    '<button class="btn rojo" onclick="if(!val(\'txt\').trim()){alert(\'Describe el problema\');return}enviar({a:\'' + a + 'problema\',texto:val(\'txt\'),grave:document.getElementById(\'grave\').checked})">Enviar problema</button></div>' +
    '<button class="btn sec" onclick="enviar({a:\'' + a + 'aun_no\'})">El trabajo todavía no ha terminado</button>';
}

function bloqueValorar_(oc) {
  var estrellas = [1, 2, 3, 4, 5].map(function (n) { return '<label><input type="radio" name="st" value="' + n + '"><span>' + n + '★</span></label>'; }).join('');
  return '<label>¿Cómo valoras el servicio? (1 = muy mal · 5 = excelente)</label><div class="stars">' + estrellas + '</div>' +
    '<label for="com">Comentario (opcional)</label><textarea id="com" maxlength="1000"></textarea>' +
    '<button class="btn" onclick="var s=document.querySelector(\'input[name=st]:checked\');if(!s){alert(\'Elige de 1 a 5 estrellas\');return}enviar({a:\'valorar\',estrellas:s.value,comentario:val(\'com\')})">Enviar valoración</button>';
}

function paginaSeguimiento_(t, oc) {
  var sol = solicitud_(oc), estado = sol['Estado'];
  var p = sol['Profesional asignado (PRO)'] ? profesional_(sol['Profesional asignado (PRO)']) : null;
  var urlWeb = String(cfg_('URL_WEB') || 'https://oficiocerca.pages.dev/').replace(/\/?$/, '/');
  var h = '<p class="estado-humano"><b>Estado:</b> ' + esc_(ESTADO_HUMANO[estado] || 'En curso') + '</p>';
  if (estado === 'Cancelada') h += '<div class="err">Esta solicitud está cancelada.</div>';
  else h += lineaProgreso_(estado);

  var info = [['Código', oc], ['Servicio', servicioTxt_(sol)], ['Zona', sol['Zona']], ['Plazo solicitado', plazoTxt_(sol)]];
  if (p) {
    info.push(['Profesional', p['Nombre']]);
    if (p['Empresa / autónomo']) info.push(['Empresa', p['Empresa / autónomo']]);
    if (p['Tipo de proveedor']) info.push(['Tipo de proveedor', p['Tipo de proveedor']]);
    if (sol['Disponibilidad profesional']) info.push(['Disponibilidad ofrecida', sol['Disponibilidad profesional']]);
    info.push(['WhatsApp del profesional', limpio_(p['WhatsApp'])], ['Correo del profesional', p['Email']]);
  }
  h += '<h2>Tu solicitud</h2>' + filas_(info);

  // Presupuesto vigente / aceptado
  var pres = sol['Presupuesto vigente'] ? tabla_('Presupuestos').buscar('ID', sol['Presupuesto vigente']) : null;
  if (pres) {
    var estPres = pres['Estado'] === 'Enviado al cliente' ? 'Pendiente de tu respuesta' : pres['Estado'] === 'Aceptado' ? 'PRESUPUESTO ACEPTADO' : pres['Estado'];
    h += '<h2>Presupuesto</h2>' + filas_([['Mano de obra', euros_(pres['Mano de obra (€)'])], ['Materiales', euros_(pres['Materiales (€)'])],
      ['Total', euros_(pres['Total (€)'])], ['Observaciones', pres['Observaciones'] || '—'], ['Estado', estPres]]);
  }

  var abierta = incidenciaAbierta_(oc);
  if (abierta) h += '<div class="ok"><b>Estamos revisando tu incidencia.</b> Una persona de OficioCerca te escribirá.</div>';

  // Acciones según el momento
  if (estado === 'Esperando decisión cliente') {
    h += '<h2>¿Qué prefieres?</h2><p>La opción más próxima que encontramos puede atenderte aproximadamente: <b>' + esc_(sol['Respaldo disponibilidad'] || '') + '</b>.</p>' +
      '<button class="btn" onclick="enviar({a:\'respaldo\',d:\'continuar\'})">Sí, continuar con este profesional</button>' +
      '<button class="btn sec" onclick="enviar({a:\'respaldo\',d:\'seguir\'})">Seguir buscando</button>' +
      '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar la solicitud?\'))enviar({a:\'respaldo\',d:\'cancelar\'})">Cancelar solicitud</button>';
  }
  if (estado === 'Presupuesto enviado' && pres && pres['Estado'] === 'Enviado al cliente') {
    h += '<h2>¿Aceptas el presupuesto?</h2>' +
      '<button class="btn" onclick="if(confirm(\'¿Aceptas este presupuesto?\'))enviar({a:\'presupuesto\',d:\'aceptar\'})">✔ Aceptar presupuesto</button>' +
      '<button class="btn sec" onclick="enviar({a:\'presupuesto\',d:\'hablar\'})">Necesito hablar con el profesional</button>' +
      '<button class="btn rojo" onclick="if(confirm(\'¿No aceptas este presupuesto?\'))enviar({a:\'presupuesto\',d:\'rechazar\'})">No aceptar</button>';
  }
  if (estado === 'Finalización por confirmar') h += '<h2>¿Ha terminado el trabajo?</h2>' + bloqueFin_('fin_');
  if (estado === 'Finalizado' || estado === 'Valorada') {
    var ya = tabla_('Valoraciones').todas().some(function (v) { return v['Código OC'] === oc; });
    h += '<h2>Valoración</h2>' + (ya ? '<div class="ok">Gracias, ya recibimos tu valoración.</div>' : bloqueValorar_(oc));
  }

  // Siempre: otro servicio, ayuda y (si procede) cancelar
  var cancelable = ['Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional', 'Esperando decisión cliente', 'Sin profesional compatible'].indexOf(estado) >= 0;
  h += '<a class="btn otro" href="' + esc_(urlWeb) + 'solicitar/">+ SOLICITAR OTRO SERVICIO</a>' +
    '<button class="btn sec" onclick="ver(\'ph\')">Necesito ayuda</button>' +
    '<div id="ph" class="panel opc hide"><label for="th">¿En qué te ayudamos?</label><textarea id="th" maxlength="1500"></textarea>' +
    '<label><input type="checkbox" id="gh" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de mis datos)</label>' +
    '<button class="btn sec" onclick="if(!val(\'th\').trim()){alert(\'Escribe tu consulta\');return}enviar({a:\'ayuda\',texto:val(\'th\'),grave:document.getElementById(\'gh\').checked})">Enviar</button></div>' +
    (cancelable ? '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar tu solicitud?\'))enviar({a:\'cancelar\'})">Cancelar mi solicitud</button>' : '');
  return html_('¿Cómo va mi trabajo? · ' + oc, h, t);
}

/** Acciones del portal: siempre sobre la OC del token (nunca sobre una OC enviada por el navegador). */
function accionSeguimiento_(oc, p) {
  var sol = solicitud_(oc), r;
  switch (p.a) {
    case 'respaldo':
      var of = tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === oc && o['Estado'] === 'Respaldo' && o['Código PRO'] === sol['Respaldo (PRO)']; })[0];
      if (!of) return { ok: false, msg: 'Esa opción ya no está disponible.' };
      return procesarDecisionRespaldo_(of['ID'], p.d);
    case 'presupuesto':
      if (!sol['Presupuesto vigente']) return { ok: false, msg: 'No hay ningún presupuesto pendiente.' };
      return procesarRespuestaPresupuesto_(sol['Presupuesto vigente'], p.d);
    case 'fin_si': return procesarFinCliente_(oc, 'si');
    case 'fin_aun_no': return procesarFinCliente_(oc, 'aun_no');
    case 'fin_problema': return procesarFinCliente_(oc, 'problema', p.texto, p.grave === true);
    case 'valorar': return procesarValoracion_(oc, p.estrellas, p.comentario);
    case 'ayuda': return procesarComentarioCliente_(oc, 'ayuda', 'Otro', p.texto, p.grave === true);
    case 'cancelar':
      return conLock_(function () {
        var s = solicitud_(oc);
        if (s['Estado'] === 'Cancelada') return { ok: true, ya: true, msg: 'Tu solicitud ya estaba cancelada.' };
        if (['Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional', 'Esperando decisión cliente', 'Sin profesional compatible'].indexOf(s['Estado']) < 0)
          return { ok: false, msg: 'Tu solicitud ya tiene profesional asignado. Si quieres cancelarla, usa «Necesito ayuda».' };
        cancelarSolicitud_(s, 'Cancelada por el cliente');
        return { ok: true, msg: 'Hemos cancelado tu solicitud.' };
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

/* ---------- recordatorios de finalización (sin saturar: máx. 2) ---------- */
function recordatoriosFinalizacion_() {
  var reg = tabla_('Registro').todas(), hist = tabla_('Historial envíos').todas();
  tabla_('Solicitudes').todas().filter(function (s) { return s['Estado'] === 'Finalización por confirmar'; }).forEach(function (s) {
    var oc = s['Código'];
    var marcas = reg.filter(function (r) { return r['Código OC'] === oc && r['Acción'] === 'Profesional indica trabajo finalizado'; });
    if (!marcas.length) return;
    var desde = new Date(marcas[marcas.length - 1]['Fecha']).getTime();
    var dias = (Date.now() - desde) / 86400000;
    var enviados = hist.filter(function (h) { return h['Código OC'] === oc && h['Tipo'] === 'recordatorio_fin' && new Date(h['Fecha']).getTime() > desde; }).length;
    if ((enviados === 0 && dias >= 3) || (enviados === 1 && dias >= 7)) {
      encolarCorreo_('cli-rec-fin-' + oc + '-' + desde + '-' + (enviados + 1), 'recordatorio_fin', 'Cliente', s['Email'], oc, s['Profesional asignado (PRO)'], {});
    }
  });
}

/* ---------- procesador rápido (cada minuto; sale al instante si no hay nada) ---------- */
function marcarPendiente_() { PropertiesService.getScriptProperties().setProperty('PENDIENTE', String(Date.now())); }

function procesarPendientes() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('PENDIENTE')) return;
  try {
    conLock_(function () {
      props.deleteProperty('PENDIENTE');
      procesarCola_();
      tabla_('Solicitudes').todas().filter(function (s) { return s['Estado'] === 'Nueva'; })
        .forEach(function (s) { try { motor_(s['Código']); } catch (e) { errorSistema_('motor ' + s['Código'], e); } });
    });
  } catch (err) { errorSistema_('procesarPendientes', err); }
  try { actualizarPanel(); } catch (e) { }
}
