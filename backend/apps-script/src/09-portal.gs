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
