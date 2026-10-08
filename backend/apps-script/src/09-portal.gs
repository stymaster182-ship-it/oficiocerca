/* ============================================================ V1.6 · SEGUIMIENTO (cliente sin cuenta) Y RUTA VISUAL
 * - Enlace privado por correo (/seguimiento/#TOKEN): aleatorio (64 hex), solo se guarda su SHA-256, ligado a UNA solicitud,
 *   válido 365 días y revocable. El navegador nunca elige la solicitud: el servidor la toma del token.
 * - Varios servicios del mismo cliente: cada uno es una OC independiente; se agrupan por «Grupo cliente» (creado SOLO
 *   en el servidor desde el seguimiento del propio cliente). Nunca se muestran solicitudes de otras personas.
 * - El cliente NO ve la comisión. Sin tokens en WhatsApp ni en textos públicos.
 */

var PASOS_V16 = ['Solicitud enviada', 'Profesional encontrado', 'Contacto habilitado', 'Acuerdo pendiente', 'Acuerdo confirmado',
  'Trabajo en proceso', 'Profesional indica finalización', 'Cliente confirma', 'Comisión pendiente', 'Comisión pagada', 'Cerrado'];
var PASOS_SOLO_PRO = [8, 9]; // el cliente no ve la comisión

var ESTADO_HUMANO = {
  'Nueva': 'Buscando un profesional compatible', 'Buscando profesional': 'Buscando un profesional compatible',
  'Esperando respuesta profesional': 'Buscando un profesional compatible', 'Revisión manual': 'Estamos revisando tu solicitud',
  'Esperando decisión cliente': 'Necesitamos tu decisión', 'Sin profesional compatible': 'Seguimos buscando un profesional disponible',
  'Profesional asignado': 'Profesional encontrado · contacto habilitado', 'Acuerdo pendiente del cliente': 'Acuerdo pendiente de tu confirmación',
  'Acuerdo no confirmado': 'Acuerdo no confirmado', 'Acuerdo confirmado': 'Acuerdo confirmado', 'Trabajo en proceso': 'Trabajo en proceso',
  'Finalización por confirmar': 'El profesional indica que terminó · pendiente de tu confirmación',
  'Comisión pendiente': 'Trabajo terminado', 'Cerrado': 'Trabajo terminado · servicio cerrado', 'Cancelada': 'Solicitud cancelada'
};
var ESTADOS_CANCELABLES = ['Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional', 'Esperando decisión cliente', 'Sin profesional compatible'];

/** Índice del paso ACTUAL (los anteriores están hechos). 11 = todo hecho. */
function pasoActualV16_(sol, com) {
  var e = sol['Estado'];
  if (ESTADOS_CANCELABLES.indexOf(e) >= 0) return 1;
  return ({ 'Profesional asignado': 3, 'Acuerdo pendiente del cliente': 3, 'Acuerdo no confirmado': 3, 'Acuerdo confirmado': 5, 'Trabajo en proceso': 5,
    'Finalización por confirmar': 7, 'Comisión pendiente': 8, 'Cerrado': 11 })[e] || 0;
}

function lineaProgresoV16_(sol, com, vista) {
  var actual = pasoActualV16_(sol, com), sinCobro = !com || com['Estado'] === 'NO_HABILITADA';
  if (sol['Estado'] === 'Comisión pendiente' && com && com['Estado'] === 'PAYMENT_PENDING') actual = 9;
  return '<ol class="prog">' + PASOS_V16.map(function (txt, i) {
    if (vista === 'cliente' && PASOS_SOLO_PRO.indexOf(i) >= 0) return '';
    var na = PASOS_SOLO_PRO.indexOf(i) >= 0 && sinCobro && actual > 7;
    var cls = na ? 'pend' : i < actual ? 'hecho' : i === actual ? 'ahora' : 'pend';
    var ico = na ? '–' : i < actual ? '✓' : i === actual ? '◉' : '○';
    if (na) txt += ' (no aplica: cobro no habilitado en el piloto)';
    if (i === 5 && sol['Estado'] === 'Acuerdo confirmado' && fechaIso_(sol['Fecha acordada'])) txt += ' · previsto el ' + fechaAcordadaTxt_(sol['Fecha acordada']);
    return '<li class="' + cls + '"><span aria-hidden="true">' + ico + '</span> ' + esc_(txt) + '</li>';
  }).join('') + '</ol>';
}

/** Las cuatro preguntas de cada pantalla: ¿dónde estoy? ¿qué pasa? ¿qué hago? ¿qué sigue? */
function resumenV16_(sol, com, vista) {
  var e = sol['Estado'], cli = vista === 'cliente';
  var R = function (pasa, haces, sigue) { return { pasa: pasa, haces: haces, sigue: sigue }; };
  var m = {
    busca: cli ? R('Estamos buscando un profesional compatible con tu trabajo, zona y plazo.', 'Nada por ahora. Te avisaremos por correo.', 'Cuando un profesional pueda atenderte, verás aquí sus datos de contacto.')
      : R('Búsqueda de profesional en curso.', '—', '—'),
    decide: R('Solo hay disponibilidad posterior a la que pediste.', 'Elige una opción más abajo.', 'Según elijas, asignamos al profesional o seguimos buscando.'),
    asignado: cli ? R('Ya tienes profesional. Vais a hablar para valorar el trabajo.', 'Habla con el profesional (sus datos están más abajo).', 'Cuando acordéis precio y fecha, el profesional lo registrará y te pediremos que lo confirmes.')
      : R('Tienes el contacto del cliente.', 'Habla con el cliente y pulsa «Ya hablé con el cliente / Registrar acuerdo».', 'El cliente confirmará el acuerdo.'),
    pendCli: cli ? R('El profesional ha registrado el acuerdo.', 'Revisa el acuerdo y pulsa «Confirmar acuerdo» o «No estoy de acuerdo».', 'Con tu confirmación empieza el trabajo en la fecha acordada.')
      : R('Has registrado el acuerdo. Falta que el cliente lo confirme.', 'Nada, salvo que necesites modificarlo.', 'Te avisaremos cuando el cliente lo confirme.'),
    noConf: cli ? R('Indicaste que no estás de acuerdo.', 'Habla con el profesional si queréis llegar a otro acuerdo.', 'Si registra uno nuevo, te pediremos que lo confirmes.')
      : R('El cliente no está de acuerdo con lo registrado.', 'Habla con el cliente y registra un nuevo acuerdo si llegáis a uno.', 'El cliente tendrá que confirmarlo.'),
    conf: cli ? R('Acuerdo confirmado.', 'Nada. El profesional hará el trabajo en la fecha acordada.', 'Cuando termine, te pediremos que lo confirmes.')
      : R('El cliente confirmó el acuerdo.', 'Haz el trabajo y, al terminar, pulsa «Trabajo terminado».', 'El cliente confirmará que terminó.'),
    fin: cli ? R('El profesional indica que el trabajo ha terminado.', 'Confirma si terminó: «Sí», «Todavía no» o «Hay un problema».', 'Si confirmas, cerramos el servicio y podrás valorarlo.')
      : R('Has indicado que terminaste. Falta la confirmación del cliente.', 'Nada por ahora.', 'Cuando el cliente confirme, se cerrará el servicio (y, si aplica, se generará la comisión).'),
    comPend: cli ? R('Confirmaste que el trabajo terminó. ¡Gracias!', 'Si quieres, valora el servicio.', 'Nada más: tu servicio está terminado.')
      : R('El cliente confirmó el trabajo. La comisión está pendiente de pago.', 'Paga la comisión con el botón «Pagar comisión».', 'Al confirmarse el pago el servicio se cierra y vuelves a recibir oportunidades.'),
    cerrado: cli ? R('Servicio terminado y cerrado.', 'Si quieres, valora el servicio o pide otro.', 'Nada más.')
      : R('Servicio cerrado.', 'Nada.', 'Seguirás recibiendo oportunidades compatibles.'),
    cancel: R('Esta solicitud está cancelada.', 'Si lo necesitas, pide un servicio nuevo.', 'Nada más.')
  };
  var k = ESTADOS_CANCELABLES.indexOf(e) >= 0 ? (e === 'Esperando decisión cliente' ? 'decide' : 'busca') :
    ({ 'Profesional asignado': 'asignado', 'Acuerdo pendiente del cliente': 'pendCli', 'Acuerdo no confirmado': 'noConf', 'Acuerdo confirmado': 'conf', 'Trabajo en proceso': 'conf',
      'Finalización por confirmar': 'fin', 'Comisión pendiente': 'comPend', 'Cerrado': 'cerrado', 'Cancelada': 'cancel' })[e] || 'busca';
  var r = m[k];
  if (!cli && k === 'comPend' && com && com['Estado'] === 'PAYMENT_PENDING') r = R('Wompi está procesando tu pago.', 'Nada: espera la confirmación.', 'Al aprobarse, el servicio se cierra y vuelves a recibir oportunidades.');
  if (!cli && k === 'comPend' && com && com['Estado'] === 'MANUAL_REVIEW') r = R('El pago de la comisión está en revisión.', 'Nada: te escribiremos.', '—');
  return '<div class="panel4"><p><b>¿Dónde estoy?</b> ' + esc_((cli ? 'Seguimiento de tu servicio ' : 'Trabajo ') + sol['Código'] + ' · ' + servicioTxt_(sol)) + '</p>' +
    '<p><b>¿Qué está pasando?</b> ' + esc_(r.pasa) + '</p><p><b>¿Qué hago ahora?</b> ' + esc_(r.haces) + '</p><p><b>¿Qué pasa después?</b> ' + esc_(r.sigue) + '</p></div>';
}

function incidenciaAbierta_(oc) {
  return tabla_('Incidencias').todas().some(function (i) { return i['Código OC'] === oc && i['Tipo'] === 'Incidencia' && (i['Estado'] === 'Abierta' || i['Estado'] === 'En revisión'); });
}

function historialAcuerdo_(oc, vista) {
  var vs = tabla_('Presupuestos').todas().filter(function (r) { return r['Código OC'] === oc; });
  if (vs.length < 2) return '';
  return '<details class="hist"><summary>Historial del acuerdo (' + vs.length + ' versiones)</summary>' + filas_(vs.map(function (r) {
    return ['Versión ' + r['Versión'] + ' · ' + dia_(r['Fecha']), euros_(r['Total (€)']) + ' (mano de obra ' + euros_(r['Mano de obra (€)']) + ' + materiales ' + euros_(r['Materiales (€)']) + ') · ' +
      fechaAcordadaTxt_(r['Fecha acordada']) + ' · ' + r['Estado'] + (r['Respuesta cliente (fecha)'] ? ' (' + fecha_(r['Respuesta cliente (fecha)']) + ')' : '')];
  })) + '</details>';
}

function bloqueAcuerdoCliente_(pres) {
  if (!pres) return '';
  var est = pres['Estado'] === 'Pendiente del cliente' ? 'Pendiente de tu confirmación' : pres['Estado'];
  return '<h2>Acuerdo con el profesional</h2>' + filas_([['Mano de obra', euros_(pres['Mano de obra (€)'])], ['Materiales', euros_(pres['Materiales (€)'])],
    ['Total', euros_(pres['Total (€)'])], ['Fecha acordada', fechaAcordadaTxt_(pres['Fecha acordada'])], ['Nota', pres['Observaciones'] || '—'],
    ['Versión', String(pres['Versión'])], ['Estado', est]]);
}

function bloqueFin_(prefijo) {
  var a = prefijo || '';
  return '<button class="btn" onclick="enviar({a:\'' + a + 'si\'})">✔ Sí, el trabajo terminó</button>' +
    '<button class="btn sec" onclick="enviar({a:\'' + a + 'aun_no\'})">Todavía no ha terminado</button>' +
    '<button class="btn rojo" onclick="ver(\'pp\')">Hay un problema</button>' +
    '<div id="pp" class="panel opc hide"><label for="txt">Cuéntanos qué ha pasado</label><textarea id="txt" maxlength="1500"></textarea>' +
    '<label><input type="checkbox" id="grave" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de mis datos)</label>' +
    '<button class="btn rojo" onclick="if(!val(\'txt\').trim()){alert(\'Describe el problema\');return}enviar({a:\'' + a + 'problema\',texto:val(\'txt\'),grave:document.getElementById(\'grave\').checked})">Enviar problema</button></div>';
}

function bloqueValorar_() {
  var estrellas = [1, 2, 3, 4, 5].map(function (n) { return '<label><input type="radio" name="st" value="' + n + '"><span>' + n + '★</span></label>'; }).join('');
  return '<label>¿Cómo valoras el servicio? (1 = muy mal · 5 = excelente)</label><div class="stars">' + estrellas + '</div>' +
    '<label for="com">Comentario (opcional)</label><textarea id="com" maxlength="1000"></textarea>' +
    '<button class="btn" onclick="var s=document.querySelector(\'input[name=st]:checked\');if(!s){alert(\'Elige de 1 a 5 estrellas\');return}enviar({a:\'valorar\',estrellas:s.value,comentario:val(\'com\')})">Enviar valoración</button>';
}

function opcionesServicio_(lista) {
  return lista.map(function (c) { return '<option value="' + c + '">' + esc_(SERVICIOS[c]) + '</option>'; }).join('');
}
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
  if (p) {
    info.push(['Profesional', datosProTxt_(p)]);
    if (sol['Disponibilidad profesional']) info.push(['Disponibilidad indicada', sol['Disponibilidad profesional']]);
    info.push(['WhatsApp del profesional', limpio_(p['WhatsApp'])], ['Correo del profesional', p['Email']]);
  }
  h += '<h2>Datos del servicio</h2>' + filas_(info);

  var pres = sol['Presupuesto vigente'] ? tabla_('Presupuestos').buscar('ID', sol['Presupuesto vigente']) : null;
  h += bloqueAcuerdoCliente_(pres) + historialAcuerdo_(oc, 'cliente');
  if (incidenciaAbierta_(oc)) h += '<div class="ok"><b>Estamos revisando tu incidencia.</b> Una persona de OficioCerca te escribirá.</div>';

  // Solo los botones válidos para el estado actual
  if (estado === 'Esperando decisión cliente') {
    h += '<h2>¿Qué prefieres?</h2><p>El profesional más próximo puede atenderte aproximadamente: <b>' + esc_(sol['Respaldo disponibilidad'] || '') + '</b>.</p>' +
      '<button class="btn" onclick="enviar({a:\'respaldo\',d:\'continuar\'})">Sí, continuar con este profesional</button>' +
      '<button class="btn sec" onclick="enviar({a:\'respaldo\',d:\'seguir\'})">Seguir buscando</button>' +
      '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar la solicitud?\'))enviar({a:\'respaldo\',d:\'cancelar\'})">Cancelar solicitud</button>';
  }
  if (estado === 'Acuerdo pendiente del cliente' && pres && pres['Estado'] === 'Pendiente del cliente') {
    h += '<h2>¿Confirmas el acuerdo?</h2>' +
      '<button class="btn" onclick="enviar({a:\'acuerdo\',d:\'confirmar\'})">✔ Confirmar acuerdo</button>' +
      '<button class="btn rojo" onclick="if(confirm(\'¿No estás de acuerdo con lo registrado?\'))enviar({a:\'acuerdo\',d:\'no_de_acuerdo\'})">No estoy de acuerdo</button>' +
      '<p class="nota">Confirmar es gratuito para ti. El pago del trabajo se hace directamente al profesional.</p>';
  }
  if (estado === 'Finalización por confirmar') h += '<h2>¿Ha terminado el trabajo?</h2>' + bloqueFin_('fin_');
  if (sol['Cliente confirmó fin (fecha)']) {
    var ya = tabla_('Valoraciones').todas().some(function (v) { return v['Código OC'] === oc; });
    h += '<h2>Valoración</h2>' + (ya ? '<div class="ok">Gracias, ya recibimos tu valoración.</div>' : bloqueValorar_());
  }

  h += '<h2>Otras opciones</h2>';
  h += '<button class="btn sec" onclick="ver(\'pn\')">+ Añadir otro servicio</button>' +
    formServicio_('pn', 'nuevo_servicio', SERVICIOS_ACTIVOS.concat(['otro']), 'Añadir este servicio', 'Usaremos tus mismos datos de contacto. Cada servicio tiene su propio seguimiento.');
  if (p) {
    var susServ = listaServicios_(p['Servicios (códigos)']).filter(function (c) { return SERVICIOS_ACTIVOS.indexOf(c) >= 0; });
    if (susServ.length) h += '<button class="btn sec" onclick="ver(\'pm\')">Solicitar este servicio al mismo profesional</button>' +
      formServicio_('pm', 'mismo_pro', susServ, 'Pedírselo a ' + p['Nombre'], 'Se lo pediremos a ' + p['Nombre'] + '; debe aceptarlo. Será un servicio nuevo e independiente. Si no puede, buscaremos otro profesional compatible.');
  }
  h += '<button class="btn sec" onclick="ver(\'ph\')">Necesito ayuda</button>' +
    '<div id="ph" class="panel opc hide"><label for="th">¿En qué te ayudamos?</label><textarea id="th" maxlength="1500"></textarea>' +
    '<label><input type="checkbox" id="gh" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de mis datos)</label>' +
    '<button class="btn sec" onclick="if(!val(\'th\').trim()){alert(\'Escribe tu consulta\');return}enviar({a:\'ayuda\',texto:val(\'th\'),grave:document.getElementById(\'gh\').checked})">Enviar</button></div>' +
    (ESTADOS_CANCELABLES.indexOf(estado) >= 0 ? '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar esta solicitud?\'))enviar({a:\'cancelar\'})">Cancelar esta solicitud</button>' : '');
  return html_('Seguimiento · ' + oc, h, t);
}

/** Acciones del portal: siempre sobre la OC del token (o una de SU grupo, validada en el servidor). */
function accionSeguimiento_(oc, p) {
  var sol = solicitud_(oc);
  switch (p.a) {
    case 'respaldo':
      var of = tabla_('Ofertas').todas().filter(function (o) { return o['Código OC'] === oc && o['Estado'] === 'Respaldo' && o['Código PRO'] === sol['Respaldo (PRO)']; })[0];
      if (!of) return { ok: false, msg: 'Esa opción ya no está disponible.' };
      return procesarDecisionRespaldo_(of['ID'], p.d);
    case 'acuerdo':
    case 'presupuesto':
      if (!sol['Presupuesto vigente']) return { ok: false, msg: 'No hay ningún acuerdo pendiente.' };
      return procesarRespuestaPresupuesto_(sol['Presupuesto vigente'], p.d);
    case 'fin_si': return procesarFinCliente_(oc, 'si');
    case 'fin_aun_no': return procesarFinCliente_(oc, 'aun_no');
    case 'fin_problema': return procesarFinCliente_(oc, 'problema', p.texto, p.grave === true);
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
        if (ESTADOS_CANCELABLES.indexOf(s['Estado']) < 0) return { ok: false, msg: 'Esta solicitud ya tiene profesional asignado. Si quieres cancelarla, usa «Necesito ayuda».' };
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

/** Compatibilidad: los recordatorios viven ahora en recordatoriosV16_ (máx. uno por acción). */
function recordatoriosFinalizacion_() { recordatoriosV16_(); }

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
      procesarCola_();
    });
  } catch (err) { errorSistema_('procesarPendientes', err); }
  try { actualizarPanel(); } catch (e) { }
}
