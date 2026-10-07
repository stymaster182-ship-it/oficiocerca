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
  ENDPOINT: "https://script.google.com/macros/s/AKfycbyjOjHiDWHdLwXx23eMkHZi7z2PYbTRiuqYYQvfe7HGRdnPfWqNO9MlhB-pl0_BrCHZ/exec",
  WHATSAPP: "",
  CONTACT_EMAIL: "oficiocerca@gmail.com",
  SITE_URL: "https://oficiocerca.pages.dev/",
  MAX_PHOTOS: 5,
  PHOTO_MAX_SIDE: 1600,
  PHOTO_QUALITY: 0.78
};
