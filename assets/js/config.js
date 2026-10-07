/*
 * OficioCerca — configuración pública del sitio.
 * Aquí NO van claves privadas: todo lo de este archivo es visible en GitHub.
 *
 * ENDPOINT: URL pública del Web App de Google Apps Script (termina en /exec).
 *   Mientras esté vacío, los formularios muestran un aviso honesto y NO simulan envíos.
 * WHATSAPP: número de WhatsApp Business español en formato internacional sin "+" ni espacios
 *   (ej. "34600000000"). Vacío = no se muestra ningún botón de WhatsApp.
 */
window.OC_CONFIG = {
  ENDPOINT: "",
  WHATSAPP: "",
  CONTACT_EMAIL: "",
  SITE_URL: "https://stymaster182-ship-it.github.io/oficiocerca/",
  MAX_PHOTOS: 5,
  PHOTO_MAX_SIDE: 1600,
  PHOTO_QUALITY: 0.78
};
