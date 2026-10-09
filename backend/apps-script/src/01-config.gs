/**
 * OficioCerca — backend V1.7 (Google Apps Script, cuenta oficiocerca@gmail.com).
 *
 * Flujo: solicitud web (se guarda siempre) → matching por reglas → oferta SECUENCIAL → profesional asignado
 *  (contacto habilitado: «recibir el contacto inicia el trabajo en OficioCerca») → hablan, visitan y acuerdan FUERA
 *  → el profesional registra el ACUERDO ALCANZADO (mano de obra inicial + duración; materiales opcionales) → trabajo
 *  en proceso con fecha estimada de fin → seguimiento al vencer (terminado / sigue / problema) → cierre: el profesional
 *  registra el valor FINAL y el cliente confirma → SOLO entonces nace la comisión (10 % de los primeros 2.000 € de mano
 *  de obra final + 5 % del exceso, sin tope, materiales excluidos) → cobro con Wompi únicamente si está habilitado
 *  (en el piloto NO) → cerrado → valoración. Incidencias → «En revisión» (sin cierre, cobro ni reseña automáticos).
 *  Sin respuesta → archivado por inactividad (ambos) o revisión manual (una parte).
 *  «El correo avisa. La plataforma registra.»
 *
 * Puesta en marcha / actualización: ver backend/README.md (función instalarV15 → instalarV17, idempotente).
 * El código no contiene secretos: los IDs y credenciales se guardan en Propiedades del script.
 */

var VERSION_BACKEND = 'V1.7';
var ZONA_HORARIA = 'Europe/Madrid';

/** Valores por defecto de la pestaña «Configuración» (editables allí, salvo los de solo lectura). */
var CONFIG_DEFECTO = [
  ['COMMISSION_COLLECTION_ENABLED', 'FALSE', 'Cobro real de comisiones. FALSE = solo se calculan y registran (no se cobra nada). No activar sin titular, fiscalidad y revisión legal.'],
  ['COMISION_POLITICA', 'COM-2026-10-V2', 'Solo lectura. Política vigente: 10 % de los primeros 2.000 € de mano de obra + 5 % del exceso, sin tope, materiales excluidos (fórmula única en 12-v16.gs → comisionV16_).'],
  ['ADMIN_EMAIL', 'oficiocerca@gmail.com', 'Recibe SOLO alertas (errores, incidencias, excepciones) y el resumen diario.'],
  ['RESUMEN_DIARIO', 'SI', 'SI = un único correo resumen cada mañana al administrador.'],
  ['URL_WEB', 'https://oficiocerca.pages.dev/', 'Web pública.'],
  ['URL_APP', '', 'URL /exec de esta aplicación web (enlaces de los correos). Se rellena al desplegar.'],
  ['HORAS_RESPUESTA_URGENTE', '4', 'Horas para responder a una oportunidad cuando el cliente pide «Hoy o mañana».'],
  ['HORAS_RESPUESTA_NORMAL', '24', 'Horas para responder a una oportunidad en el resto de casos.'],
  ['DIAS_VALIDEZ_ENLACES', '30', 'Días de validez de los enlaces enviados a clientes (presupuesto, finalización…).'],
  ['CUOTA_RESERVA', '3', 'Correos que se reservan SOLO para alertas al administrador.'],
  ['CUOTA_RESERVA_BAJA', '15', 'Por debajo de esta cuota solo salen correos de prioridad alta; los demás esperan en cola (nunca se pierden).'],
  ['SEG_RECORDATORIO_2_HORAS', '48', 'Seguimiento: horas desde el primer aviso hasta el segundo.'],
  ['SEG_RECORDATORIO_3_HORAS', '120', 'Seguimiento: horas desde el primer aviso hasta el último recordatorio (5 días).'],
  ['SEG_CIERRE_HORAS', '48', 'Seguimiento: horas tras el último recordatorio para archivar (nadie respondió) o pasar a revisión (faltó una parte).'],
  ['SEG_ACUERDO_DIAS', '3', 'Días desde la asignación hasta recordar al profesional que registre el acuerdo alcanzado.'],
  ['REP_PESO_VALORACION', '1', 'Prioridad: peso de la valoración media (señal secundaria; 0 = no influye).'],
  ['REP_PESO_RESPUESTA', '1', 'Prioridad: peso de la tasa de respuesta a oportunidades (0 = no influye).'],
  ['REP_PESO_SEGUIMIENTO', '1', 'Prioridad: peso del cumplimiento del seguimiento (0 = no influye).'],
  ['PRO_COND_VERSION', 'PRO-COND-2026-10-V4', 'Versión vigente de las condiciones para profesionales.'],
  ['CONSENT_VERSION', 'C4-2026-10', 'Versión vigente del consentimiento de clientes.'],
  ['Cuota correo disponible', '', 'Solo lectura: MailApp.getRemainingDailyQuota() en la última comprobación.'],
  ['Última comprobación', '', 'Solo lectura.'],
  ['Correos pendientes', '', 'Solo lectura: en cola por cuota.'],
  ['Envíos fallidos', '', 'Solo lectura.'],
  ['Versión backend', VERSION_BACKEND, 'Solo lectura.']
];

/** Servicios normalizados (el matching usa SOLO estos códigos, nunca texto libre). */
var SERVICIOS = {
  electricidad: 'Electricidad',
  fontaneria: 'Fontanería',
  albanileria: 'Albañilería y pequeñas reformas', // LEGACY: inactiva en el piloto (no pública, sin matching)
  pintura: 'Pintura',
  carpinteria: 'Carpintería y ebanistería',
  marmoleria: 'Marmolería',
  otro: 'Otro servicio'
};

/** Servicios ACTIVOS del piloto (matching automático). «otro» y los legacy van a revisión manual. */
var SERVICIOS_ACTIVOS = ['electricidad', 'fontaneria', 'marmoleria', 'carpinteria', 'pintura'];
var TIPOS_SOLICITANTE = ['Particular', 'Empresa', 'Contratista'];
var TIPOS_PROVEEDOR = ['Profesional independiente / autónomo', 'Contratista', 'Empresa'];
/** «¿Cómo ejerces tu actividad?» (registro desde V1.7 pre-piloto). Los profesionales antiguos quedan en blanco. */
var FORMAS_EJERCICIO = ['Profesional independiente', 'Autónomo', 'Empresa / sociedad'];
/** Confianza (SOLO uso interno, no se muestra al público ni afecta al reparto): se marca a mano cuando se haga la comprobación real. */
var REVISIONES_CONFIANZA = ['Pendiente', 'Revisada', 'No aplica'];

/** Plazo pedido por el cliente → días máximos (null = flexible). */
var PLAZOS_CLIENTE = {
  HOY_MANANA: { t: 'Hoy o mañana', d: 1 },
  DOS_TRES_DIAS: { t: 'En 2–3 días', d: 3 },
  ESTA_SEMANA: { t: 'Esta semana', d: 7 },
  UNA_DOS_SEMANAS: { t: 'En 1–2 semanas', d: 14 },
  FLEXIBLE: { t: 'Flexible / sin fecha concreta', d: null },
  OTRA_FECHA: { t: 'Otra fecha', d: 'fecha' }
};

/** Disponibilidad que indica el profesional al responder → días hasta poder atender. */
var DISP_PRO = {
  HOY: { t: 'Hoy', d: 0 },
  MANANA: { t: 'Mañana', d: 1 },
  DOS_TRES_DIAS: { t: 'En 2–3 días', d: 3 },
  ESTA_SEMANA: { t: 'Esta semana', d: 7 },
  UNA_DOS_SEMANAS: { t: 'En 1–2 semanas', d: 14 },
  OTRA_FECHA: { t: 'Otra fecha', d: 'fecha' }
};

var ESTADOS_SOLICITUD = [
  'Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional', 'Esperando decisión cliente',
  'Sin profesional disponible', 'Profesional asignado', 'Trabajo en proceso', 'Cierre pendiente del profesional',
  'Finalización por confirmar', 'Comisión pendiente', 'Cerrado', 'En revisión', 'Archivado por inactividad', 'Cancelada'
];
var ESTADOS_PROFESIONAL = ['Pendiente de revisar', 'Activo', 'En revisión', 'Pausado', 'Baja'];
var ESTADOS_OFERTA = ['Enviada', 'Seleccionada', 'Respaldo', 'Rechazada', 'Sin respuesta', 'Cerrada'];
var ESTADOS_PRESUPUESTO = ['Registrado', 'Sustituido'];
/** Comisiones (códigos técnicos): NO_HABILITADA = calculada sin cobro (no bloquea) · EN_REVISION = congelada por incidencia (no bloquea). */
var ESTADOS_COMISION = ['NO_HABILITADA', 'DUE', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED', 'MANUAL_REVIEW', 'EN_REVISION', 'ANULADA'];
var ESTADOS_INCIDENCIA = ['Abierta', 'En revisión', 'Resuelta', 'Descartada', 'Cerrada'];
var CATEGORIAS_INCIDENCIA = ['No se pudo contactar', 'Retraso', 'Trabajo abandonado', 'Trabajo parcial', 'Desacuerdo económico',
  'Problema de calidad', 'Daños', 'Materiales / bienes', 'Falta de comunicación', 'Otro', 'Situación grave'];
var RESULTADOS_INCIDENCIA = ['RESUELTO — TRABAJO COMPLETO', 'RESUELTO — TRABAJO PARCIAL', 'CANCELADO — NO HUBO TRABAJO',
  'SIN ACUERDO / REVISIÓN MANUAL', 'OTRO'];
var UNIDADES_DURACION = { horas: 3600000, dias: 86400000, semanas: 604800000 };

var ESQUEMA = {
  'Solicitudes': ['Código', 'Fecha', 'Estado', 'Requiere intervención', 'Tipo solicitante', 'Nombre', 'Empresa', 'WhatsApp',
    'Teléfono alt.', 'Email', 'Ciudad', 'Código postal', 'Zona', 'Servicio (código)', 'Servicio', 'Servicio (otro)',
    'Tipo de trabajo (legacy)', 'Descripción', 'Plazo (código)', 'Plazo', 'Fecha deseada', 'Contacto preferido (para el profesional)',
    'Nº fotos', 'Carpeta fotos (ID)', 'Consent. contacto (legacy)', 'Consent. compartir (legacy)', 'Consent. privacidad (legacy)', 'Versión consentimiento',
    'Origen', 'Ofrecer a (PRO manual)', 'Profesional asignado (PRO)', 'Fecha asignación', 'Disponibilidad profesional',
    'Respaldo (PRO)', 'Respaldo disponibilidad', 'Decisión cliente', 'Contacto enviado (fecha)', 'Presupuesto vigente',
    'Mano de obra aceptada (€)', 'Total aceptado (€)', 'Comisión (€)', 'Fecha aceptación', 'Finalizado (fecha)',
    'Valoración (1-5)', 'Motivo cierre', 'Última actualización', 'Notas internas', 'Consentimiento operativo', 'Consentimiento (fecha)',
    'Grupo cliente', 'Origen servicio', 'Fecha acordada', 'Materiales aceptados (€)', 'Versión acuerdo', 'Cliente confirmó fin (fecha)',
    'Fecha registro acuerdo', 'Duración estimada', 'Fecha estimada fin', 'Mano de obra inicial (€)', 'Mano de obra final (€)',
    'Materiales finales (€)', 'Trabajos adicionales', 'Motivo cambio valor', 'Cierre iniciado por', 'Acción pendiente de', 'Acción desde',
    'Plantilla seguimiento', 'Recordatorios enviados', 'Último aviso', 'Estado previo', 'Escalado por', 'Ronda búsqueda', 'Historial plazos'],
  'Profesionales': ['Código', 'Fecha', 'Estado', 'Nombre', 'Empresa / autónomo', 'Servicios (códigos)', 'Servicios',
    'Servicio otro', 'Especialidades', 'WhatsApp', 'Teléfono', 'Email', 'Ciudad', 'Código postal', 'Zonas', 'Distancia',
    'Experiencia', 'Disponibilidad habitual', 'Con particulares', 'Con empresas', 'Descripción', 'Consent. contacto (legacy)',
    'Consent. privacidad (legacy)', 'Condiciones (versión)', 'Condiciones aceptadas (fecha)', 'Origen', 'Prioridad',
    'Ofertas recibidas', 'Respuestas', 'Aceptadas', 'Asignaciones', 'Completados', 'Tiempo medio respuesta (h)',
    'Valoración media', 'Nº valoraciones', 'Incidencias verificadas', 'Comisiones pendientes', 'Última oferta', 'Notas internas', 'Tipo de proveedor',
    'Tasa respuesta (%)', 'Cumplimiento seguimiento (%)', 'Forma de ejercicio', 'Identidad revisada', 'Documentación revisada',
    'Revisión confianza (fecha)', 'Revisión confianza (por)'],
  'Ofertas': ['ID', 'Fecha envío', 'Código OC', 'Código PRO', 'Profesional', 'Servicio', 'Puntuación', 'Motivo ranking',
    'Estado', 'Respuesta', 'Disponibilidad (código)', 'Disponibilidad', 'Días hasta disponibilidad', 'Fecha respuesta',
    'Expira', 'Notas', 'Ronda'],
  'Presupuestos': ['ID', 'Fecha', 'Código OC', 'Código PRO', 'Versión', 'Mano de obra (€)', 'Materiales (€)', 'Total (€)',
    'Observaciones', 'Estado', 'Respuesta cliente (fecha)', 'Notas', 'Fecha acordada', 'Registrado por', 'Confirmado por', 'Política comisión',
    'Duración (cantidad)', 'Duración (unidad)', 'Fecha estimada fin'],
  'Comisiones': ['Código OC', 'Código PRO', 'Profesional', 'Presupuesto', 'Mano de obra (€)', 'Porcentaje', 'Importe comisión (€)',
    'Fecha generación', 'Estado', 'Fecha pago', 'Notas', 'Materiales (€)', 'Política', 'Tramo 10 % (€)', 'Tramo 5 % (€)', 'Fecha exigible',
    'Referencia vigente', 'Transaction ID', 'Importe pagado (COP)', 'Tasa EUR→COP', 'Fuente tasa', 'Fecha tasa', 'Moneda', 'Ambiente'],
  'Pagos comisión': ['Referencia', 'Código OC', 'Código PRO', 'Comisión (€)', 'Tasa EUR→COP', 'Fuente tasa', 'Fecha tasa', 'Importe (COP)',
    'Importe (centavos)', 'Moneda', 'Creado', 'Estado', 'Transaction ID', 'Estado Wompi', 'Fecha estado', 'Ambiente', 'Notas'],
  'Eventos Wompi': ['Clave', 'Recibido', 'Evento', 'Ambiente', 'Transaction ID', 'Referencia', 'Estado Wompi', 'Firma válida', 'Resultado', 'Repeticiones', 'Timestamp'],
  'Aceptaciones condiciones': ['Fecha', 'Código PRO', 'Versión', 'Origen', 'Notas'],
  'Incidencias': ['ID', 'Fecha', 'Tipo', 'Código OC', 'Código PRO', 'Origen', 'Categoría', 'Gravedad', 'Descripción', 'Estado',
    'Pausa preventiva', 'Acción tomada', 'Administrador', 'Fecha resolución', 'Notas', 'Servicio', 'Cliente', 'Reportado por',
    'Resultado', 'Mano de obra reconocida (€)', 'Estado previo servicio'],
  'Valoraciones': ['Fecha', 'Código OC', 'Código PRO', 'Estrellas', 'Comentario', 'Publicable', 'Notas', 'Trabajo verificado'],
  'Historial envíos': ['ID', 'Fecha', 'Clave', 'Tipo', 'Destinatario', 'Correo', 'Código OC', 'Código PRO', 'Asunto',
    'Estado', 'Intentos', 'Fecha envío', 'Nº adjuntos', 'Último error', 'Datos'],
  'Registro': ['Fecha', 'Tipo', 'Acción', 'Código OC', 'Código PRO', 'Detalle', 'Usuario'],
  'Tokens': ['Hash', 'Tipo', 'Código OC', 'Código PRO', 'Referencia', 'Creado', 'Expira', 'Usado', 'Resultado'],
  'Configuración': ['Clave', 'Valor', 'Descripción']
};

/** Orden de pestañas: PANEL primero. */
var ORDEN_PESTANAS = ['PANEL', 'Solicitudes', 'Profesionales', 'Ofertas', 'Presupuestos', 'Comisiones', 'Pagos comisión', 'Eventos Wompi',
  'Incidencias', 'Valoraciones', 'Aceptaciones condiciones', 'Historial envíos', 'Registro', 'Configuración', 'Tokens'];

var DESPLEGABLES = {
  'Solicitudes': { 'Estado': ESTADOS_SOLICITUD },
  'Profesionales': { 'Estado': ESTADOS_PROFESIONAL, 'Prioridad': ['Normal', 'Baja'], 'Tipo de proveedor': TIPOS_PROVEEDOR, 'Forma de ejercicio': FORMAS_EJERCICIO,
    'Identidad revisada': REVISIONES_CONFIANZA, 'Documentación revisada': REVISIONES_CONFIANZA },
  'Ofertas': { 'Estado': ESTADOS_OFERTA },
  'Presupuestos': { 'Estado': ESTADOS_PRESUPUESTO },
  'Comisiones': { 'Estado': ESTADOS_COMISION },
  'Incidencias': { 'Estado': ESTADOS_INCIDENCIA, 'Gravedad': ['Normal', 'Alta', 'Grave'], 'Resultado': RESULTADOS_INCIDENCIA }
};
