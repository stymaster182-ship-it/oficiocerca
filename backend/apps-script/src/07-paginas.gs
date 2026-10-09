/* ============================================================ PÁGINAS DE LOS ENLACES (doGet ?t=TOKEN) */

function doGet(e) {
  var tp = e && e.parameter && (e.parameter.wpago || e.parameter.wsbx);
  if (tp) { try { return paginaPago_(String(tp)); } catch (err) { errorSistema_('paginaPago', err); return html_('Algo ha fallado', '<p>No hemos podido abrir la página de pago. Inténtalo de nuevo en unos minutos.</p>'); } }
  var t = e && e.parameter && e.parameter.t;
  if (!t) return json_({ ok: true, service: 'OficioCerca', status: 'online' });
  try { return pagina_(String(t)); }
  catch (err) { errorSistema_('doGet', err); return html_('Algo ha fallado', '<p>No hemos podido abrir esta página. Inténtalo de nuevo en unos minutos o escríbenos a <a href="mailto:oficiocerca@gmail.com">oficiocerca@gmail.com</a>.</p>'); }
}

var _modoJson = false;

/** Versión JSON de una página (la usa la página estática /gestion/ de la web). */
function paginaJson_(t) {
  _modoJson = true;
  try { var r = pagina_(String(t || '')); return { ok: true, titulo: r.titulo, cuerpo: r.cuerpo, script: r.script || '' }; }
  catch (err) { errorSistema_('paginaJson', err); return { ok: false, titulo: 'Algo ha fallado', cuerpo: '<p>No hemos podido abrir esta página. Inténtalo de nuevo en unos minutos.</p>' }; }
  finally { _modoJson = false; }
}

function html_(titulo, cuerpo, token, script) {
  if (_modoJson) return { titulo: titulo, cuerpo: cuerpo, script: script || '' };
  var css = 'body{margin:0;background:#F6F2EB;font-family:Arial,Helvetica,sans-serif;color:#0E1A2B;font-size:18px;line-height:1.5}' +
    '.top{background:#13253D;color:#fff;padding:16px 20px;font-weight:bold;font-size:21px;letter-spacing:.5px}.top b{color:#F2A65A}' +
    '.box{max-width:640px;margin:18px auto;background:#fff;border-radius:14px;padding:22px 20px;box-shadow:0 2px 10px rgba(0,0,0,.06)}' +
    'h1{font-size:24px;margin:0 0 14px;line-height:1.25}h2{font-size:20px;margin:22px 0 10px}' +
    'table{border-collapse:collapse;width:100%;margin:10px 0}td{border:1px solid #DED6C8;padding:9px;vertical-align:top}td:first-child{background:#F6F2EB;font-weight:bold;width:40%}' +
    '.btn{display:block;width:100%;box-sizing:border-box;border:0;border-radius:12px;padding:17px 16px;margin:12px 0;font-size:19px;font-weight:bold;cursor:pointer;background:#13253D;color:#fff;text-align:center}' +
    '.btn.sec{background:#fff;color:#13253D;border:2px solid #13253D}.btn.rojo{background:#fff;color:#A3262A;border:2px solid #A3262A}.btn:disabled{opacity:.55;cursor:wait}' +
    'label{display:block;font-weight:bold;margin:14px 0 6px}select,input,textarea{width:100%;box-sizing:border-box;font-size:18px;padding:13px;border:2px solid #8B95A3;border-radius:10px;background:#fff;color:#0E1A2B}' +
    'textarea{min-height:110px}.opc{border:2px solid #DED6C8;border-radius:12px;padding:6px 16px 10px;margin:14px 0}.nota{color:#586374;font-size:15px}' +
    '.ok{background:#E8F5EC;border-left:5px solid #2E7D4F;padding:14px;border-radius:8px}.err{background:#FDECEC;border-left:5px solid #A3262A;padding:14px;border-radius:8px}' +
    '.stars{display:flex;gap:6px;flex-wrap:wrap}.stars label{margin:0;flex:1;min-width:52px}.stars input{display:none}.stars span{display:block;text-align:center;border:2px solid #8B95A3;border-radius:10px;padding:12px 0;font-size:22px;cursor:pointer}' +
    '.stars input:checked+span{background:#13253D;color:#F2A65A;border-color:#13253D}.hide{display:none}' +
    '.prog{list-style:none;padding:0;margin:14px 0}.prog li{padding:8px 10px;border-left:4px solid #DED6C8;margin:4px 0}.prog .hecho{border-color:#2E7D4F}.prog .ahora{border-color:#F2A65A;font-weight:bold;background:#FFF4E5}.prog .pend{color:#8B95A3}a.btn{text-decoration:none}' +
    '.panel4{background:#F6F2EB;border-radius:12px;padding:10px 16px;margin:10px 0}.panel4 p{margin:6px 0}.servicios{padding-left:18px}.servicios li{margin:6px 0}.servicios .actual{font-weight:bold}' +
    '.mini{border:2px solid #13253D;background:#fff;color:#13253D;border-radius:8px;padding:4px 10px;font-weight:bold;cursor:pointer}details.hist{margin:10px 0}details.hist summary{cursor:pointer;font-weight:bold}.fila2{display:flex;gap:10px;align-items:center}.fila2>*{flex:1}';
  var js = '<script>var T=' + JSON.stringify(token || '') + ';' +
    'function enviar(p,btn){var bs=document.querySelectorAll("button");bs.forEach(function(b){b.disabled=true});' +
    'var m=document.getElementById("msg");m.className="";m.textContent="Enviando…";' +
    'google.script.run.withSuccessHandler(function(r){if(r&&r.ok){document.getElementById("zona").innerHTML="";m.className="ok";m.textContent=r.msg;' +
    'if(r.html){document.getElementById("zona").innerHTML=r.html}}else{m.className="err";m.textContent=(r&&r.msg)||"No se pudo guardar.";bs.forEach(function(b){b.disabled=false})}})' +
    '.withFailureHandler(function(){m.className="err";m.textContent="No hemos podido guardar tu respuesta. Revisa tu conexión e inténtalo de nuevo.";bs.forEach(function(b){b.disabled=false})})' +
    '.accion(T,p)}' +
    'function ver(id){document.querySelectorAll(".panel").forEach(function(x){x.classList.add("hide")});var e=document.getElementById(id);if(e){e.classList.remove("hide");e.scrollIntoView({behavior:"smooth"})}}' +
    'function val(id){var e=document.getElementById(id);return e?e.value:""}' + (script || '') + '</script>';
  var out = HtmlService.createHtmlOutput('<!doctype html><html lang="es"><head><meta charset="utf-8"><style>' + css + '</style></head><body>' +
    '<div class="top">OFICIO<b>CERCA</b></div><div class="box"><h1>' + esc_(titulo) + '</h1><div id="zona">' + cuerpo + '</div><p id="msg" role="status" aria-live="polite"></p>' +
    '<p class="nota">¿Dudas? Escríbenos a <a href="mailto:oficiocerca@gmail.com">oficiocerca@gmail.com</a></p></div>' + js + '</body></html>');
  out.setTitle('OficioCerca').addMetaTag('viewport', 'width=device-width, initial-scale=1');
  return out;
}

function filas_(f) { return '<table>' + f.map(function (x) { return '<tr><td>' + esc_(x[0]) + '</td><td>' + esc_(x[1]).replace(/\n/g, '<br>') + '</td></tr>'; }).join('') + '</table>'; }

function pagina_(t) {
  var tok = leerToken_(t);
  if (!tok) return html_('Enlace no válido', '<p>Este enlace no es válido o está incompleto. Abre el botón directamente desde el correo que te enviamos.</p>');
  var tipo = tok['Tipo'], oc = tok['Código OC'], pro = tok['Código PRO'];
  var sol = oc ? solicitud_(oc) : null;
  var unUso = ['oferta', 'respaldo'].indexOf(tipo) >= 0;
  if (unUso && tok['Usado']) return html_('Respuesta ya registrada', '<div class="ok">Ya habíamos registrado tu respuesta: ' + esc_(tok['Resultado'] || '') + '</div>');
  if (tok.caducado) return html_('Enlace caducado', '<p>Este enlace ya no está vigente' + (tipo === 'oferta' ? ': el plazo para responder a esta oportunidad terminó y la ofrecimos a otro profesional.' : '.') + '</p><p>Si necesitas algo, escríbenos.</p>');

  var hoy = Utilities.formatDate(new Date(), ZONA_HORARIA, 'yyyy-MM-dd');
  if (tipo === 'oferta') {
    var of = tabla_('Ofertas').buscar('ID', tok['Referencia']);
    if (!of || of['Estado'] !== 'Enviada') return html_('Oportunidad cerrada', '<p>Esta oportunidad ya no está abierta. ¡Gracias!</p>');
    var opts = Object.keys(DISP_PRO).filter(function (k) { return k !== 'OTRA_FECHA'; }).map(function (k) { return '<option value="' + k + '">' + esc_(DISP_PRO[k].t) + '</option>'; }).join('');
    return html_('Oportunidad ' + oc, filas_([['Servicio', servicioTxt_(sol)], ['Zona / barrio', sol['Zona'] + ' (Córdoba)'],
      ['Plazo que pide el cliente', plazoTxt_(sol)], ['Descripción', sol['Descripción']], ['Responde antes de', fecha_(of['Expira'])]]) +
      '<p class="nota">Aceptar significa: «Estoy interesado y tengo disponibilidad para contactar al cliente». Al aceptar recibirás su contacto: eso inicia el trabajo en OficioCerca. Precio y condiciones los acordáis directamente. Recibir o rechazar oportunidades no tiene coste.</p>' +
      '<button class="btn" onclick="ver(\'pa\')">✔ PUEDO ATENDERLO</button>' +
      '<div id="pa" class="panel opc hide"><label for="disp">¿Cuándo podrías empezar?</label><select id="disp">' + opts + '</select>' +
      '<button class="btn" onclick="enviar({a:\'si\',disp:val(\'disp\')})">Confirmar: puedo atenderlo</button></div>' +
      '<button class="btn sec" onclick="ver(\'pb\')">🕒 PUEDO HACERLO, PERO MÁS ADELANTE</button>' +
      '<div id="pb" class="panel opc hide"><label for="fecha">¿A partir de qué fecha aproximada?</label><input type="date" id="fecha" min="' + hoy + '">' +
      '<button class="btn sec" onclick="if(!val(\'fecha\')){alert(\'Elige una fecha\');return}enviar({a:\'mas_adelante\',fecha:val(\'fecha\')})">Confirmar fecha</button></div>' +
      '<button class="btn rojo" onclick="ver(\'pc\')">✖ NO PUEDO / NO ME INTERESA</button>' +
      '<div id="pc" class="panel opc hide"><label for="nota">Motivo (opcional)</label><input id="nota" maxlength="200">' +
      '<button class="btn rojo" onclick="enviar({a:\'no\',nota:val(\'nota\')})">Confirmar: no puedo</button></div>', t);
  }
  if (tipo === 'respaldo') {
    var ofr = tabla_('Ofertas').buscar('ID', tok['Referencia']);
    if (sol['Estado'] !== 'Esperando decisión cliente') return html_('Solicitud ' + oc, '<p>Estado actual de tu solicitud: <b>' + esc_(sol['Estado']) + '</b>.</p>');
    return html_('Disponibilidad para tu solicitud ' + oc, '<p>Pediste: <b>' + esc_(plazoTxt_(sol)) + '</b>. La opción más próxima que encontramos puede atenderte aproximadamente: <b>' + esc_(ofr ? ofr['Disponibilidad'] : '') + '</b>.</p>' +
      '<button class="btn" onclick="enviar({a:\'continuar\'})">Sí, continuar con este profesional</button>' +
      '<button class="btn sec" onclick="enviar({a:\'seguir\'})">Seguir buscando</button>' +
      '<button class="btn rojo" onclick="if(confirm(\'¿Seguro que quieres cancelar la solicitud?\'))enviar({a:\'cancelar\'})">Cancelar solicitud</button>' +
      '<p class="nota">Hasta que elijas, no compartimos tus datos de contacto con ningún profesional.</p>', t);
  }
  if (tipo === 'presupuesto' || tipo === 'fin' || tipo === 'cliente') {
    // Enlaces de V1.5: llevan ahora al seguimiento de ese servicio (mismas acciones, solo las válidas)
    return paginaSeguimiento_(t, oc);
  }
  if (tipo === 'seguimiento') return paginaSeguimiento_(t, oc);
  if (tipo === 'valorar') {
    var ya = tabla_('Valoraciones').todas().some(function (v) { return v['Código OC'] === oc; });
    var estrellas = [1, 2, 3, 4, 5].map(function (n) { return '<label><input type="radio" name="st" value="' + n + '"><span>' + n + '★</span></label>'; }).join('');
    var cats = CATEGORIAS_INCIDENCIA.filter(function (c) { return c !== 'Valoración baja'; }).map(function (c) { return '<option>' + esc_(c) + '</option>'; }).join('');
    return html_('Valora el servicio · ' + oc, (ya ? '<div class="ok">Ya recibimos tu valoración. ¡Gracias!</div>' :
      '<label>¿Cómo valoras el servicio? (1 = muy mal · 5 = excelente)</label><div class="stars">' + estrellas + '</div>' +
      '<label for="com">Comentario (opcional)</label><textarea id="com" maxlength="1000"></textarea>' +
      '<button class="btn" onclick="var s=document.querySelector(\'input[name=st]:checked\');if(!s){alert(\'Elige de 1 a 5 estrellas\');return}enviar({a:\'valorar\',estrellas:s.value,comentario:val(\'com\')})">Enviar valoración</button>') +
      '<h2>¿Algo más?</h2>' +
      '<button class="btn rojo" onclick="ver(\'pq\')">Tuve un problema</button>' +
      '<button class="btn sec" onclick="ver(\'ps\')">Quiero ayudaros a mejorar</button>' +
      '<div id="pq" class="panel opc hide"><label for="cat">Tipo de problema</label><select id="cat">' + cats + '</select><label for="tq">Cuéntanos</label><textarea id="tq" maxlength="1500"></textarea>' +
      '<label><input type="checkbox" id="gq" style="width:auto"> Es grave (seguridad, fraude, acoso o uso indebido de datos)</label>' +
      '<button class="btn rojo" onclick="if(!val(\'tq\').trim()){alert(\'Escribe qué ha pasado\');return}enviar({a:\'problema\',categoria:val(\'cat\'),texto:val(\'tq\'),grave:document.getElementById(\'gq\').checked})">Enviar</button></div>' +
      '<div id="ps" class="panel opc hide"><label for="ts">Tu sugerencia</label><textarea id="ts" maxlength="1500"></textarea>' +
      '<button class="btn sec" onclick="if(!val(\'ts\').trim()){alert(\'Escribe tu sugerencia\');return}enviar({a:\'sugerencia\',texto:val(\'ts\')})">Enviar sugerencia</button></div>', t);
  }
  if (tipo === 'gestion') return paginaGestion_(t, oc, pro);
  if (tipo === 'pago_comision' || tipo === 'pago_sbx') return paginaPago_(t);
  if (tipo === 'condiciones') {
    var pc = profesional_(pro), urlCond = String(cfg_('URL_WEB') || 'https://oficiocerca.pages.dev/').replace(/\/?$/, '/') + 'condiciones-profesionales/';
    if (!pc) return html_('Enlace no válido', '<p>Profesional no encontrado.</p>');
    if (condAlDia_(pc)) return html_('Condiciones aceptadas', '<div class="ok">Ya aceptaste la versión vigente (' + esc_(condVigente_()) + '). No tienes que hacer nada más.</div>');
    return html_('Nuevas condiciones ' + condVigente_(), '<div class="panel4"><p><b>Precio y acuerdo:</b> los negocias directamente con el cliente, fuera de OficioCerca. Después registras aquí el acuerdo alcanzado (mano de obra y duración estimada).</p>' +
      '<p><b>Seguimiento:</b> recibir el contacto inicia el trabajo en OficioCerca; mantenerlo actualizado hasta el cierre forma parte del proceso. Si no se actualiza de forma reiterada, puede influir en tu prioridad para nuevas oportunidades.</p>' +
      '<p><b>Comisión:</b> 10 % de los primeros 2.000 € de mano de obra y 5 % del exceso, sin tope, sobre la mano de obra FINAL confirmada por el cliente. Los materiales nunca cuentan. Registrarte, recibir o rechazar oportunidades: sin coste.</p>' +
      '<p><b>Incidencias y comisión pendiente:</b> una incidencia no te bloquea automáticamente. Una comisión exigible sin pagar impide recibir NUEVAS oportunidades hasta pagarla, sin borrar tu cuenta, tu historial ni tus trabajos.</p></div>' +
      '<p><a href="' + esc_(urlCond) + '" target="_blank" rel="noopener">Leer las condiciones completas</a></p>' +
      '<button class="btn" onclick="enviar({a:\'aceptar\'})">✔ He leído y acepto las condiciones ' + esc_(condVigente_()) + '</button>', t);
  }
  return html_('Enlace no válido', '<p>Tipo de enlace desconocido.</p>');
}

/** Única función llamada desde las páginas (google.script.run). Revalida el token en cada llamada. */
function accion(t, p) {
  try {
    p = p || {};
    var tok = leerToken_(t);
    if (!tok) return { ok: false, msg: 'Enlace no válido.' };
    if (tok.caducado) return { ok: false, msg: 'Este enlace ha caducado.' };
    var tipo = tok['Tipo'], oc = tok['Código OC'], pro = tok['Código PRO'], r;
    var unUso = ['oferta', 'respaldo'].indexOf(tipo) >= 0;
    if (unUso && tok['Usado']) return { ok: true, ya: true, msg: 'Ya habíamos registrado tu respuesta: ' + tok['Resultado'] };
    switch (tipo) {
      case 'oferta': r = procesarRespuestaOferta_(tok['Referencia'], p.a, p.disp, p.fecha, p.nota); break;
      case 'respaldo': r = procesarDecisionRespaldo_(tok['Referencia'], p.a); break;
      case 'presupuesto': case 'fin': case 'cliente': r = accionSeguimiento_(oc, p); break;
      case 'condiciones': if (p.a === 'aceptar') r = aceptarCondiciones_(pro); break;
      case 'valorar':
        if (p.a === 'valorar') r = procesarValoracion_(oc, p.estrellas, p.comentario);
        else if (p.a === 'problema') r = procesarComentarioCliente_(oc, 'problema', p.categoria, p.texto, p.grave === true);
        else if (p.a === 'sugerencia') r = procesarComentarioCliente_(oc, 'sugerencia', 'Sugerencia para OficioCerca', p.texto, false);
        break;
      case 'gestion': r = accionGestion_(oc, pro, p); break;
      case 'seguimiento': r = accionSeguimiento_(oc, p); break;
    }
    if (!r) return { ok: false, msg: 'Acción no válida.' };
    if (r.ok && unUso && !r.noConsume) marcarToken_(tok, r.msg);
    if (r.ok) marcarPendiente_(); // el panel y la cola se actualizan en segundo plano (respuesta más rápida)
    return { ok: !!r.ok, msg: r.msg, t: r.t || undefined, url: r.url || undefined };
  } catch (err) {
    errorSistema_('accion', err);
    return { ok: false, msg: 'Ha ocurrido un error. Inténtalo de nuevo en unos minutos.' };
  }
}

/* ---------- espacio del PROFESIONAL para un trabajo (token 'gestion') ---------- */
function paginaGestion_(t, oc, pro) {
  var sol = solicitud_(oc), estado = sol['Estado'], com = comisionDeOC_(oc);
  if (sol['Profesional asignado (PRO)'] !== pro) return html_('Trabajo ' + oc, '<p>Este trabajo ya no está asignado a ti.</p>');
  var p = profesional_(pro);
  var h = resumenV16_(sol, com, 'pro') + lineaProgresoV16_(sol, com, 'pro');
  var estPro = { 'Profesional asignado': 'Contacto habilitado · falta registrar el acuerdo alcanzado', 'Finalización por confirmar': 'Cierre registrado · pendiente de la confirmación del cliente',
    'Comisión pendiente': 'Terminado · comisión pendiente', 'Cierre pendiente del profesional': 'El cliente indica que terminó · registra el valor final' }[estado];
  h += '<h2>Datos del trabajo</h2>' + filas_([['Servicio', servicioTxt_(sol)], ['Cliente', sol['Nombre']], ['WhatsApp del cliente', limpio_(sol['WhatsApp'])],
    ['Correo del cliente', sol['Email']], ['Zona', sol['Zona']], ['Estado', estPro || ESTADO_HUMANO[estado] || estado]]);
  h += bloqueAcuerdo_(sol, 'Acuerdo registrado').replace('<p class="nota">Lo acordasteis directamente entre vosotros. Si algo no coincide con lo hablado, usa «Hay un problema».</p>', '') + bloqueCierre_(sol);
  if (estado === 'En revisión' || incidenciaAbierta_(oc)) h += '<div class="ok"><b>Soporte está revisando este trabajo.</b> Se han detenido el cierre y el cobro automáticos.</div>' + botonSoporteWA_(oc);
  var unidades = '<option value="horas">horas</option><option value="dias" selected>días</option><option value="semanas">semanas</option>';
  if (estado === 'Profesional asignado' || (estado === 'Trabajo en proceso' && !sol['Fecha registro acuerdo'])) {
    h += '<div class="ok">Recibir el contacto inicia el trabajo en OficioCerca. Después de hablar con el cliente y llegar a un acuerdo, vuelve aquí para registrar el valor acordado y la duración estimada. Mantener actualizado el seguimiento hasta el cierre forma parte del proceso.</div>' +
      '<h2>REGISTRAR ACUERDO ALCANZADO</h2><div id="pa" class="panel opc">' +
      '<label for="mo">Mano de obra acordada (€) *</label><input id="mo" inputmode="decimal" placeholder="Ej.: 350">' +
      '<label>Duración estimada del trabajo *</label><div class="fila2"><input id="dn" type="number" min="1" max="365" inputmode="numeric" placeholder="Ej.: 7"><select id="du">' + unidades + '</select></div>' +
      '<label for="mat">Materiales estimados — opcional / informativo</label><input id="mat" inputmode="decimal" placeholder="0">' +
      '<p class="nota">Los materiales no generan comisión de OficioCerca.</p>' +
      '<label for="obs">Nota (opcional)</label><textarea id="obs" maxlength="1000" placeholder="Lo que incluye, cómo os organizáis…"></textarea>' +
      '<button class="btn" onclick="if(!val(\'mo\').trim()){alert(\'Indica la mano de obra acordada\');return}if(!val(\'dn\').trim()){alert(\'Indica la duración estimada\');return}enviar({a:\'acuerdo\',mo:val(\'mo\'),mat:val(\'mat\'),dn:val(\'dn\'),du:val(\'du\'),nota:val(\'obs\')})">Registrar acuerdo alcanzado</button></div>';
  }
  var cierre = '<label for="mf">Valor FINAL de la mano de obra (€) *</label><input id="mf" inputmode="decimal" value="' + esc_(sol['Mano de obra inicial (€)'] === '' ? '' : String(sol['Mano de obra inicial (€)']).replace('.', ',')) + '">' +
    '<label>¿Hubo trabajos adicionales?</label><div class="fila2"><label><input type="radio" name="ad" value="no" checked style="width:auto"> No</label><label><input type="radio" name="ad" value="si" style="width:auto"> Sí</label></div>' +
    '<label for="mm">Si el valor final cambia frente al inicial, explica brevemente por qué</label><textarea id="mm" maxlength="500"></textarea>' +
    '<label for="mtf">Materiales finales — opcional / informativo (no generan comisión)</label><input id="mtf" inputmode="decimal">' +
    '<button class="btn" onclick="if(!val(\'mf\').trim()){alert(\'Indica el valor final de la mano de obra\');return}if(confirm(\'¿Marcar el trabajo como terminado? El cliente deberá confirmarlo.\'))enviar({a:\'finalizado\',mo:val(\'mf\'),adicionales:(document.querySelector(\'input[name=ad]:checked\')||{}).value,motivo:val(\'mm\'),mat:val(\'mtf\')})">Enviar cierre al cliente</button>';
  if (['Trabajo en proceso', 'Archivado por inactividad'].indexOf(estado) >= 0 && sol['Fecha registro acuerdo']) {
    h += '<h2>' + (estado === 'Archivado por inactividad' ? 'Indica el estado para reabrir el seguimiento' : '¿Cómo va el trabajo?') + '</h2>' +
      '<button class="btn" onclick="ver(\'pf\')">✔ MARCAR TRABAJO COMO TERMINADO</button><div id="pf" class="panel opc hide">' + cierre + '</div>' +
      '<button class="btn sec" onclick="ver(\'pp\')">Sigue en proceso · actualizar plazo</button><div id="pp" class="panel opc hide">' +
      '<label>¿Cuánto tiempo más necesitas? *</label><div class="fila2"><input id="pn2" type="number" min="1" max="365" inputmode="numeric"><select id="pu2">' + unidades + '</select></div>' +
      '<label for="pno">Nota (opcional)</label><input id="pno" maxlength="200">' +
      '<button class="btn sec" onclick="if(!val(\'pn2\').trim()){alert(\'Indica el nuevo plazo\');return}enviar({a:\'plazo\',dn:val(\'pn2\'),du:val(\'pu2\'),nota:val(\'pno\')})">Actualizar plazo</button></div>';
  }
  if (estado === 'Cierre pendiente del profesional') h += '<h2>Registra el valor final para completar el cierre</h2><div class="panel opc">' + cierre + '</div>';
  if (com && ['ANULADA'].indexOf(com['Estado']) < 0) {
    var filas = [['Mano de obra final confirmada', euros_(com['Mano de obra (€)'])], ['Materiales (no cuentan)', euros_(com['Materiales (€)'])],
      ['10 % de los primeros 2.000 €', euros_(com['Tramo 10 % (€)'])], ['5 % del exceso', euros_(com['Tramo 5 % (€)'])], ['Comisión', euros_(com['Importe comisión (€)'])]];
    var estTxt = { NO_HABILITADA: 'Calculada · en el piloto no se cobra', DUE: 'Pendiente de pago', PAYMENT_PENDING: 'Pago en proceso', PAID: 'Pagada', PAYMENT_FAILED: 'Pago no completado', MANUAL_REVIEW: 'En revisión', EN_REVISION: 'Congelada por una incidencia' }[com['Estado']] || com['Estado'];
    filas.push(['Estado', estTxt + (com['Ambiente'] === 'SANDBOX' ? ' (PRUEBA / SANDBOX)' : '')]);
    if (com['Estado'] === 'PAID') filas.push(['Referencia de pago', com['Referencia vigente']]);
    h += '<h2>Comisión de OficioCerca</h2>' + filas_(filas);
    if (['DUE', 'PAYMENT_FAILED'].indexOf(com['Estado']) >= 0) h += '<button class="btn" onclick="enviar({a:\'pagar\'})">' + (com['Ambiente'] === 'SANDBOX' ? 'PAGAR COMISIÓN (SANDBOX)' : 'PAGAR COMISIÓN') + '</button>' +
      '<p class="nota">Mientras esté pendiente no recibirás nuevas oportunidades. Tu cuenta, tu historial y tus trabajos en curso no cambian.</p>';
  }
  if (ESTADOS_ACTIVOS_SERVICIO.indexOf(estado) >= 0) h += formIncidencia_('pi');
  if (p) h += bloqueReputacion_(p);
  h += historialBasico_(oc);
  h += '<p class="nota">Comisión: ' + esc_(POLITICA_COMISION.texto) + ', sobre la mano de obra final confirmada por el cliente. <a href="' + esc_(urlAyuda_('profesional')) + '" target="_blank" rel="noopener">Centro de ayuda y políticas</a></p>';
  return html_('Trabajo ' + oc + ' · ' + servicioTxt_(sol), h, t);
}

/** «TU REPUTACIÓN EN OFICIOCERCA» (datos agregados; sin detalles de incidencias). */
function bloqueReputacion_(p) {
  var f = [['Valoración promedio', Number(p['Nº valoraciones']) ? String(p['Valoración media']).replace('.', ',') + ' / 5' : 'Aún sin valoraciones'],
    ['Trabajos cerrados', String(Number(p['Completados']) || 0)], ['Valoraciones recibidas', String(Number(p['Nº valoraciones']) || 0)]];
  if (p['Tasa respuesta (%)'] !== '' && p['Tasa respuesta (%)'] !== undefined) f.push(['Respuesta a oportunidades', p['Tasa respuesta (%)'] + ' %']);
  if (p['Cumplimiento seguimiento (%)'] !== '' && p['Cumplimiento seguimiento (%)'] !== undefined) f.push(['Seguimiento al día', p['Cumplimiento seguimiento (%)'] + ' %']);
  return '<details class="hist"><summary>Tu reputación en OficioCerca</summary>' + filas_(f) +
    '<p class="nota">Las buenas valoraciones, el cumplimiento del seguimiento y una buena respuesta pueden ayudarte a ser tenido en cuenta con mayor prioridad para futuras oportunidades. Primero cuentan siempre el servicio, la zona y la disponibilidad.</p></details>';
}

function accionGestion_(oc, pro, p) {
  switch (p.a) {
    case 'acuerdo': case 'presupuesto': return registrarAcuerdo_(oc, pro, p.mo, p.mat, p.dn, p.du, p.nota !== undefined ? p.nota : p.obs);
    case 'plazo': return actualizarPlazo_(oc, pro, p.dn, p.du, p.nota);
    case 'finalizado': return marcarFinalizado_(oc, pro, p.mo, p.adicionales, p.motivo, p.mat);
    case 'incidencia': return reportarIncidencia_(oc, 'profesional', p.categoria, p.texto);
    case 'pagar':
      var sol = solicitud_(oc);
      if (sol['Profesional asignado (PRO)'] !== pro) return { ok: false, msg: 'Este trabajo no está asignado a ti.' };
      var c = comisionDeOC_(oc);
      if (!c || ['DUE', 'PAYMENT_FAILED'].indexOf(c['Estado']) < 0) return { ok: false, msg: 'No hay ninguna comisión pendiente de pago.' };
      return { ok: true, url: urlPagoComision_(oc, pro), msg: 'Abriendo la página de pago…' };
  }
  return { ok: false, msg: 'Acción no válida.' };
}
