// =============================================================
//  RAG — Conexión con el broker MQTT (compartida por chat y padres)
// -------------------------------------------------------------
//  Usa la librería MQTT.js, que se carga desde el CDN en cada página.
//  Modelo publicar/suscribir: la página no le habla directo al ESP32;
//  los dos se conectan al broker y se mandan mensajes por "temas".
// =============================================================

/**
 * Conecta con el broker y se suscribe a los temas pedidos.
 * opciones = {
 *   temas:        ["chat", "resultado"],   // nombres cortos (sin prefijo)
 *   alMensaje:    function (nombreTema, datos) {},  // datos ya es un objeto
 *   alConectar:   function () {},
 *   alDesconectar:function () {}
 * }
 * Devuelve un objeto con publicar(nombreTema, objeto, retener).
 */
function conectarMQTT(opciones) {
  // ID de cliente al azar, para que dos celulares no se pisen entre sí
  const idCliente = "rag-web-" + Math.random().toString(16).slice(2, 10);

  const cliente = mqtt.connect(CONFIG.BROKER_URL, {
    clientId: idCliente,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 3000,   // si se corta, reintenta cada 3 segundos
    connectTimeout: 10000
  });

  cliente.on("connect", function () {
    const lista = (opciones.temas || []).map(tema);
    if (lista.length > 0) cliente.subscribe(lista, { qos: 0 });
    if (opciones.alConectar) opciones.alConectar();
  });

  function avisarCorte() {
    if (opciones.alDesconectar) opciones.alDesconectar();
  }
  cliente.on("close", avisarCorte);
  cliente.on("offline", avisarCorte);
  cliente.on("error", function (err) {
    console.warn("Error MQTT:", err && err.message);
  });

  cliente.on("message", function (temaCompleto, carga) {
    // Le sacamos el prefijo para quedarnos con el nombre corto
    const nombre = temaCompleto.slice(CONFIG.PREFIJO.length + 1);
    let datos;
    try {
      datos = JSON.parse(carga.toString());
    } catch (e) {
      console.warn("Llegó un mensaje que no es JSON en", temaCompleto);
      return;   // ignoramos lo que no entendemos
    }
    if (datos === null || typeof datos !== "object") return;
    if (opciones.alMensaje) opciones.alMensaje(nombre, datos);
  });

  return {
    publicar: function (nombreTema, objeto, retener) {
      if (!cliente.connected) return false;
      cliente.publish(tema(nombreTema), JSON.stringify(objeto), { qos: 0, retain: !!retener });
      return true;
    },
    conectado: function () {
      return cliente.connected;
    }
  };
}

// Hora del celular en formato 14:05:09
function horaDelCelular(fecha) {
  const d = fecha || new Date();
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
