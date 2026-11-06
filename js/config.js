// =============================================================
//  RAG — Router Anti Grooming
//  Configuración de la página web
// -------------------------------------------------------------
//  Este es el ÚNICO lugar donde se cambian el PREFIJO y el broker.
//  IMPORTANTE: el PREFIJO tiene que ser EXACTAMENTE igual al que
//  está en el sketch del ESP32 (RouterAntiGrooming.ino).
// =============================================================

const CONFIG = {
  // Prefijo único de los temas MQTT. Sirve para que nuestros mensajes
  // no se mezclen con los de otras personas que usan el mismo broker público.
  // Si lo cambiás acá, cambialo también en el ESP32.
  PREFIJO: "rag/rg-x7p2d",

  // Broker MQTT público de HiveMQ, por WebSocket seguro (wss = con TLS).
  // Tiene que ser wss:// porque GitHub Pages es HTTPS.
  BROKER_URL: "wss://broker.hivemq.com:8884/mqtt",

  // Largo máximo de cada mensaje del chat.
  LARGO_MAXIMO: 200
};

// Arma el nombre completo de un tema. Ejemplo: tema("chat") -> "rag/rg-x7p2d/chat"
function tema(nombre) {
  return CONFIG.PREFIJO + "/" + nombre;
}
