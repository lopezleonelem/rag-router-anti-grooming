// =============================================================
//  RAG — Chat del chico ("tablet del chico")
// -------------------------------------------------------------
//  - Al enviar, publica el mensaje en PREFIJO/chat.
//  - El ESP32 lo analiza y responde en PREFIJO/resultado.
//  - El chico NO ve la alerta (la alerta es para los padres):
//    acá el mensaje solo pasa de "enviando" a "✓".
//  - Si otro celular escribe en el mismo chat, se ve del lado izquierdo
//    (sirve para la demo: un celular hace de "desconocido").
// =============================================================

(function () {
  const lista = document.getElementById("lista");
  const vacio = document.getElementById("vacio");
  const formulario = document.getElementById("formulario");
  const entrada = document.getElementById("texto");
  const botonEnviar = document.getElementById("enviar");
  const contador = document.getElementById("contador");
  const indicadorPunto = document.getElementById("indicador-punto");
  const indicadorTexto = document.getElementById("indicador-texto");

  let conectadoAlBroker = false;
  let maquetaEnLinea = false;

  // Guardamos las burbujas por id para poder actualizarlas después
  const burbujas = {};
  // Ids de los mensajes que mandó ESTE celular
  const misIds = new Set();

  function actualizarIndicador() {
    if (conectadoAlBroker && maquetaEnLinea) {
      indicadorPunto.className = "punto punto-verde";
      indicadorTexto.textContent = "Conectado";
    } else {
      indicadorPunto.className = "punto punto-rojo";
      indicadorTexto.textContent = "Sin conexión con la maqueta";
    }
    botonEnviar.disabled = !conectadoAlBroker;
  }

  function nuevoId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // Crea una burbuja de chat. OJO: usamos textContent (nunca innerHTML)
  // para que si alguien escribe código HTML, se muestre como texto y no se ejecute.
  function agregarBurbuja(id, texto, esMia) {
    if (burbujas[id]) return burbujas[id];
    vacio.classList.add("oculto");

    const burbuja = document.createElement("div");
    burbuja.className = "burbuja " + (esMia ? "mia" : "otra");

    const cuerpo = document.createElement("span");
    cuerpo.textContent = texto;

    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = horaDelCelular() + (esMia ? " · enviando…" : "");

    burbuja.appendChild(cuerpo);
    burbuja.appendChild(meta);
    lista.appendChild(burbuja);
    lista.scrollTop = lista.scrollHeight;

    burbujas[id] = { meta: meta, hora: horaDelCelular(), esMia: esMia };
    return burbujas[id];
  }

  const conexion = conectarMQTT({
    temas: ["chat", "resultado", "estado"],

    alConectar: function () {
      conectadoAlBroker = true;
      actualizarIndicador();
    },

    alDesconectar: function () {
      conectadoAlBroker = false;
      actualizarIndicador();
    },

    alMensaje: function (nombre, datos) {
      if (nombre === "chat") {
        // Un mensaje de otro dispositivo (los míos ya están en pantalla)
        if (typeof datos.texto !== "string" || !datos.id) return;
        const id = String(datos.id);
        if (misIds.has(id)) {
          const b = burbujas[id];
          if (b) b.meta.textContent = b.hora + " · enviado";
          return;
        }
        agregarBurbuja(id, datos.texto.slice(0, CONFIG.LARGO_MAXIMO), false);
      }

      if (nombre === "resultado") {
        // El router ya revisó el mensaje. Solo marcamos "✓" (sin mostrar la alerta).
        const b = burbujas[String(datos.id)];
        if (b && b.esMia) b.meta.textContent = b.hora + " · ✓";
      }

      if (nombre === "estado") {
        maquetaEnLinea = datos.online === true;
        actualizarIndicador();
      }
    }
  });

  formulario.addEventListener("submit", function (evento) {
    evento.preventDefault();
    const texto = entrada.value.trim().slice(0, CONFIG.LARGO_MAXIMO);
    if (texto === "") return;

    const id = nuevoId();
    misIds.add(id);
    agregarBurbuja(id, texto, true);

    const ok = conexion.publicar("chat", { texto: texto, id: id });
    if (!ok) {
      burbujas[id].meta.textContent = burbujas[id].hora + " · no se pudo enviar";
    }

    entrada.value = "";
    contador.textContent = "0 / " + CONFIG.LARGO_MAXIMO;
    entrada.focus();
  });

  entrada.addEventListener("input", function () {
    contador.textContent = entrada.value.length + " / " + CONFIG.LARGO_MAXIMO;
  });

  actualizarIndicador();
})();
