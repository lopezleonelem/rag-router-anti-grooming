// =============================================================
//  RAG — Panel de los padres
// -------------------------------------------------------------
//  - Escucha PREFIJO/resultado: si un mensaje tiene riesgo, lo agrega
//    a la lista y pone el estado en rojo.
//  - Escucha PREFIJO/estado (retenido): si hay alarma y si la maqueta
//    está en línea. Si el ESP32 se desconecta, el broker publica su
//    "último deseo" (Last Will): {"online": false}.
//  - El botón "Visto" publica en PREFIJO/visto para apagar la alarma.
// =============================================================

(function () {
  const CLAVE_HISTORIAL = "rag-historial-" + CONFIG.PREFIJO;
  const MAX_HISTORIAL = 50;

  const cajaEstado = document.getElementById("estado");
  const puntoMaqueta = document.getElementById("punto-maqueta");
  const textoMaqueta = document.getElementById("texto-maqueta");
  const puntoBroker = document.getElementById("punto-broker");
  const textoBroker = document.getElementById("texto-broker");
  const botonVisto = document.getElementById("visto");
  const listaAlertas = document.getElementById("alertas");
  const sinAlertas = document.getElementById("sin-alertas");
  const botonSonido = document.getElementById("sonido");
  const botonBorrar = document.getElementById("borrar");

  let conectadoAlBroker = false;
  let maquetaEnLinea = null;   // null = todavía no sabemos
  let alarma = false;
  let sonidoActivo = false;
  let audio = null;

  // ---------- Historial (se guarda en el celular) ----------
  let historial = [];
  try {
    historial = JSON.parse(localStorage.getItem(CLAVE_HISTORIAL)) || [];
    if (!Array.isArray(historial)) historial = [];
  } catch (e) { historial = []; }

  function guardarHistorial() {
    try { localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(historial)); } catch (e) {}
  }

  // ---------- Dibujar en pantalla ----------
  // Siempre con textContent (nunca innerHTML): si el mensaje trae código, no se ejecuta.
  function ponerTexto(elemento, principal, chico) {
    elemento.textContent = principal;
    if (chico) {
      const s = document.createElement("small");
      s.textContent = chico;
      elemento.appendChild(s);
    }
  }

  function dibujarEstado() {
    if (alarma) {
      cajaEstado.className = "estado-grande estado-alerta";
      ponerTexto(cajaEstado, "⚠ ALERTA DE GROOMING", "Revisá los mensajes sospechosos de abajo");
    } else if (maquetaEnLinea === false) {
      cajaEstado.className = "estado-grande estado-espera";
      ponerTexto(cajaEstado, "Maqueta desconectada", "El router no está conectado a internet");
    } else if (maquetaEnLinea === true) {
      cajaEstado.className = "estado-grande estado-ok";
      ponerTexto(cajaEstado, "Todo en orden", "El router está vigilando el chat");
    } else {
      cajaEstado.className = "estado-grande estado-espera";
      ponerTexto(cajaEstado, "Esperando a la maqueta…", conectadoAlBroker ? "Todavía no hay datos del router" : "Conectando con el router");
    }

    if (maquetaEnLinea === true) {
      puntoMaqueta.className = "punto punto-verde";
      textoMaqueta.textContent = "Maqueta en línea";
    } else if (maquetaEnLinea === false) {
      puntoMaqueta.className = "punto punto-rojo";
      textoMaqueta.textContent = "Maqueta desconectada";
    } else {
      puntoMaqueta.className = "punto punto-gris";
      textoMaqueta.textContent = "Buscando la maqueta…";
    }

    puntoBroker.className = "punto " + (conectadoAlBroker ? "punto-verde" : "punto-rojo");
    textoBroker.textContent = conectadoAlBroker ? "Conectado al broker" : "Sin conexión a internet";

    botonVisto.disabled = !(alarma && conectadoAlBroker);
  }

  function dibujarAlertas() {
    listaAlertas.textContent = "";
    sinAlertas.classList.toggle("oculto", historial.length > 0);

    // El más nuevo arriba
    for (let i = historial.length - 1; i >= 0; i--) {
      const a = historial[i];
      const li = document.createElement("li");
      li.className = "alerta-item";

      const cats = document.createElement("div");
      cats.className = "cats";
      (a.categorias.length ? a.categorias : ["Sospechoso"]).forEach(function (c) {
        const span = document.createElement("span");
        span.className = "cat";
        span.textContent = c;
        cats.appendChild(span);
      });

      const texto = document.createElement("div");
      texto.className = "texto";
      texto.textContent = "“" + a.texto + "”";

      const hora = document.createElement("div");
      hora.className = "hora";
      hora.textContent = "Recibido a las " + a.hora + (a.fecha ? " · " + a.fecha : "");

      li.appendChild(cats);
      li.appendChild(texto);
      li.appendChild(hora);
      listaAlertas.appendChild(li);
    }
  }

  // ---------- Sonido y vibración (opcional) ----------
  function avisarConSonido() {
    if (!sonidoActivo) return;
    if (navigator.vibrate) navigator.vibrate([300, 150, 300, 150, 300]);
    if (!audio) return;
    const ahora = audio.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audio.createOscillator();
      const vol = audio.createGain();
      osc.type = "square";
      osc.frequency.value = 880;
      vol.gain.value = 0.08;
      osc.connect(vol);
      vol.connect(audio.destination);
      osc.start(ahora + i * 0.35);
      osc.stop(ahora + i * 0.35 + 0.2);
    }
  }

  botonSonido.addEventListener("click", function () {
    sonidoActivo = !sonidoActivo;
    if (sonidoActivo) {
      // El navegador solo deja usar audio después de que la persona toca algo
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx && !audio) audio = new Ctx();
      if (audio && audio.state === "suspended") audio.resume();
      botonSonido.textContent = "🔕 Desactivar sonido y vibración";
      avisarConSonido();   // pitido de prueba
    } else {
      botonSonido.textContent = "🔔 Activar sonido y vibración";
    }
  });

  botonBorrar.addEventListener("click", function () {
    if (historial.length === 0) return;
    if (!confirm("¿Borrar la lista de mensajes sospechosos de este celular?")) return;
    historial = [];
    guardarHistorial();
    dibujarAlertas();
  });

  // ---------- MQTT ----------
  const conexion = conectarMQTT({
    temas: ["resultado", "estado"],

    alConectar: function () {
      conectadoAlBroker = true;
      dibujarEstado();
    },

    alDesconectar: function () {
      conectadoAlBroker = false;
      dibujarEstado();
    },

    alMensaje: function (nombre, datos) {
      if (nombre === "estado") {
        if (typeof datos.online === "boolean") maquetaEnLinea = datos.online;
        if (typeof datos.alarma === "boolean") alarma = datos.alarma;
        dibujarEstado();
      }

      if (nombre === "resultado" && datos.riesgo === true) {
        const id = String(datos.id || Date.now());
        if (historial.some(function (a) { return a.id === id; })) return;   // repetido

        const ahora = new Date();
        historial.push({
          id: id,
          texto: String(datos.texto || "").slice(0, CONFIG.LARGO_MAXIMO),
          categorias: Array.isArray(datos.categorias) ? datos.categorias.map(String) : [],
          hora: horaDelCelular(ahora),
          fecha: ahora.toLocaleDateString("es-AR")
        });
        if (historial.length > MAX_HISTORIAL) historial.shift();
        guardarHistorial();

        alarma = true;
        dibujarAlertas();
        dibujarEstado();
        avisarConSonido();
      }
    }
  });

  botonVisto.addEventListener("click", function () {
    if (conexion.publicar("visto", { accion: "visto" })) {
      // Lo ponemos en verde ya; el ESP32 lo confirma publicando el nuevo estado
      alarma = false;
      dibujarEstado();
    }
  });

  dibujarAlertas();
  dibujarEstado();
})();
