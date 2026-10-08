/**
 * OficioCerca — backend V1.6 (Google Apps Script, cuenta oficiocerca@gmail.com).
 *
 * Flujo: solicitud web (se guarda siempre) → matching por reglas → oferta SECUENCIAL → profesional asignado
 *  (contacto habilitado) → «Ya hablé con el cliente / Registrar acuerdo» (mano de obra, materiales, fecha, nota)
 *  → el cliente confirma el acuerdo → trabajo en proceso → «Trabajo terminado» → el cliente confirma (doble cierre)
 *  → SOLO entonces nace la comisión (10 % de los primeros 2.000 € de mano de obra + 5 % del exceso, sin tope,
 *  materiales excluidos) → cobro con Wompi únicamente si está habilitado (en el piloto NO) → cerrado.
 *  «El correo avisa. La plataforma registra.»
 *
 * Puesta en marcha / actualización: ver backend/README.md (función instalarV16, idempotente).
 * El código no contiene secretos: los IDs y credenciales se guardan en Propiedades del script.
 */

var VERSION_BACKEND = 'V1.6';
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
  ['CUOTA_RESERVA', '3', 'Correos que se reservan para alertas al administrador.'],
  ['PRO_COND_VERSION', 'PRO-COND-2026-10-V3', 'Versión vigente de las condiciones para profesionales.'],
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
  'Nueva', 'Revisión manual', 'Buscando profesional', 'Esperando respuesta profesional',
  'Esperando decisión cliente', 'Sin profesional compatible', 'Profesional asignado', 'Acuerdo pendiente del cliente',
  'Acuerdo no confirmado', 'Acuerdo confirmado', 'Trabajo en proceso', 'Finalización por confirmar', 'Comisión pendiente', 'Cerrado', 'Cancelada'
];
var ESTADOS_PROFESIONAL = ['Pendiente de revisar', 'Activo', 'En revisión', 'Pausado', 'Baja'];
var ESTADOS_OFERTA = ['Enviada', 'Seleccionada', 'Respaldo', 'Rechazada', 'Sin respuesta', 'Cerrada'];
var ESTADOS_PRESUPUESTO = ['Pendiente del cliente', 'Sustituido', 'Confirmado', 'No confirmado'];
/** Comisiones (códigos técnicos): NO_HABILITADA = calculada pero el cobro no está activo (no bloquea). */
var ESTADOS_COMISION = ['NO_HABILITADA', 'DUE', 'PAYMENT_PENDING', 'PAID', 'PAYMENT_FAILED', 'MANUAL_REVIEW', 'ANULADA'];
var ESTADOS_INCIDENCIA = ['Abierta', 'En revisión', 'Verificada', 'Descartada', 'Cerrada'];
var CATEGORIAS_INCIDENCIA = ['Problema con el profesional', 'Problema con el trabajo', 'Comunicación', 'Sugerencia para OficioCerca', 'Valoración baja', 'Otro'];

var ESQUEMA = {
  'Solicitudes': ['Código', 'Fecha', 'Estado', 'Requiere intervención', 'Tipo solicitante', 'Nombre', 'Empresa', 'WhatsApp',
    'Teléfono alt.', 'Email', 'Ciudad', 'Código postal', 'Zona', 'Servicio (código)', 'Servicio', 'Servicio (otro)',
    'Tipo de trabajo (legacy)', 'Descripción', 'Plazo (código)', 'Plazo', 'Fecha deseada', 'Contacto preferido (para el profesional)',
    'Nº fotos', 'Carpeta fotos (ID)', 'Consent. contacto (legacy)', 'Consent. compartir (legacy)', 'Consent. privacidad (legacy)', 'Versión consentimiento',
    'Origen', 'Ofrecer a (PRO manual)', 'Profesional asignado (PRO)', 'Fecha asignación', 'Disponibilidad profesional',
    'Respaldo (PRO)', 'Respaldo disponibilidad', 'Decisión cliente', 'Contacto enviado (fecha)', 'Presupuesto vigente',
    'Mano de obra aceptada (€)', 'Total aceptado (€)', 'Comisión (€)', 'Fecha aceptación', 'Finalizado (fecha)',
    'Valoración (1-5)', 'Motivo cierre', 'Última actualización', 'Notas internas', 'Consentimiento operativo', 'Consentimiento (fecha)',
    'Grupo cliente', 'Origen servicio', 'Fecha acordada', 'Materiales aceptados (€)', 'Versión acuerdo', 'Cliente confirmó fin (fecha)'],
  'Profesionales': ['Código', 'Fecha', 'Estado', 'Nombre', 'Empresa / autónomo', 'Servicios (códigos)', 'Servicios',
    'Servicio otro', 'Especialidades', 'WhatsApp', 'Teléfono', 'Email', 'Ciudad', 'Código postal', 'Zonas', 'Distancia',
    'Experiencia', 'Disponibilidad habitual', 'Con particulares', 'Con empresas', 'Descripción', 'Consent. contacto (legacy)',
    'Consent. privacidad (legacy)', 'Condiciones (versión)', 'Condiciones aceptadas (fecha)', 'Origen', 'Prioridad',
    'Ofertas recibidas', 'Respuestas', 'Aceptadas', 'Asignaciones', 'Completados', 'Tiempo medio respuesta (h)',
    'Valoración media', 'Nº valoraciones', 'Incidencias verificadas', 'Comisiones pendientes', 'Última oferta', 'Notas internas', 'Tipo de proveedor'],
  'Ofertas': ['ID', 'Fecha envío', 'Código OC', 'Código PRO', 'Profesional', 'Servicio', 'Puntuación', 'Motivo ranking',
    'Estado', 'Respuesta', 'Disponibilidad (código)', 'Disponibilidad', 'Días hasta disponibilidad', 'Fecha respuesta',
    'Expira', 'Notas'],
  'Presupuestos': ['ID', 'Fecha', 'Código OC', 'Código PRO', 'Versión', 'Mano de obra (€)', 'Materiales (€)', 'Total (€)',
    'Observaciones', 'Estado', 'Respuesta cliente (fecha)', 'Notas', 'Fecha acordada', 'Registrado por', 'Confirmado por', 'Política comisión'],
  'Comisiones': ['Código OC', 'Código PRO', 'Profesional', 'Presupuesto', 'Mano de obra (€)', 'Porcentaje', 'Importe comisión (€)',
    'Fecha generación', 'Estado', 'Fecha pago', 'Notas', 'Materiales (€)', 'Política', 'Tramo 10 % (€)', 'Tramo 5 % (€)', 'Fecha exigible',
    'Referencia vigente', 'Transaction ID', 'Importe pagado (COP)', 'Tasa EUR→COP', 'Fuente tasa', 'Fecha tasa', 'Moneda', 'Ambiente'],
  'Pagos comisión': ['Referencia', 'Código OC', 'Código PRO', 'Comisión (€)', 'Tasa EUR→COP', 'Fuente tasa', 'Fecha tasa', 'Importe (COP)',
    'Importe (centavos)', 'Moneda', 'Creado', 'Estado', 'Transaction ID', 'Estado Wompi', 'Fecha estado', 'Ambiente', 'Notas'],
  'Eventos Wompi': ['Clave', 'Recibido', 'Evento', 'Ambiente', 'Transaction ID', 'Referencia', 'Estado Wompi', 'Firma válida', 'Resultado', 'Repeticiones', 'Timestamp'],
  'Aceptaciones condiciones': ['Fecha', 'Código PRO', 'Versión', 'Origen', 'Notas'],
  'Incidencias': ['ID', 'Fecha', 'Tipo', 'Código OC', 'Código PRO', 'Origen', 'Categoría', 'Gravedad', 'Descripción', 'Estado',
    'Pausa preventiva', 'Acción tomada', 'Administrador', 'Fecha resolución', 'Notas'],
  'Valoraciones': ['Fecha', 'Código OC', 'Código PRO', 'Estrellas', 'Comentario', 'Publicable', 'Notas'],
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
  'Profesionales': { 'Estado': ESTADOS_PROFESIONAL, 'Prioridad': ['Normal', 'Baja'], 'Tipo de proveedor': TIPOS_PROVEEDOR },
  'Ofertas': { 'Estado': ESTADOS_OFERTA },
  'Presupuestos': { 'Estado': ESTADOS_PRESUPUESTO },
  'Comisiones': { 'Estado': ESTADOS_COMISION },
  'Incidencias': { 'Estado': ESTADOS_INCIDENCIA, 'Gravedad': ['Normal', 'Grave'], 'Categoría': CATEGORIAS_INCIDENCIA }
};
