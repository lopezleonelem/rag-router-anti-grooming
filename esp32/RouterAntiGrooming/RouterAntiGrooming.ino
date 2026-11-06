/*
  =============================================================
   RAG - ROUTER ANTI GROOMING  (version MQTT / GitHub Pages)
  -------------------------------------------------------------
   - El ESP32 se conecta a una red Wi-Fi CON INTERNET (por ejemplo
     el hotspot del celular) y al broker MQTT publico de HiveMQ.
   - La pagina web (en GitHub Pages) manda los mensajes del chat al
     broker; el ESP32 los recibe, los analiza y publica el resultado.
   - Si un mensaje tiene una frase de riesgo: LED rojo + buzzer y
     aviso en el panel de los padres. Si todo esta bien: LED verde.
   - El boton "Visto" (fisico o en el panel) apaga la alarma.

   Conexiones:
     LED rojo     -> GPIO 25 (con resistencia de 220 ohm)
     LED verde    -> GPIO 26 (con resistencia de 220 ohm)
     LED amarillo -> GPIO 33 (con resistencia de 220 ohm)  [opcional]
     Buzzer       -> GPIO 27                               [opcional, buzzer ACTIVO]
     Boton Visto  -> GPIO 14 y GND                         [opcional]
     Todos los negativos -> GND

   Libreria necesaria: PubSubClient (de Nick O'Leary)
     Arduino IDE -> Herramientas -> Administrar bibliotecas -> buscar "PubSubClient"
  =============================================================
*/

#include <WiFi.h>
#include <PubSubClient.h>

// =============================================================
//  >>>>>>>>>>  CAMBIA ESTO  <<<<<<<<<<
// =============================================================
// Nombre y clave de la red Wi-Fi (tiene que tener internet).
// Para la presentacion lo mas seguro es el hotspot del celular.
const char* NOMBRE_RED = "NombreDeTuRed";
const char* CLAVE_RED  = "ClaveDeTuRed";

// Prefijo de los temas MQTT. TIENE QUE SER IGUAL al de js/config.js de la pagina.
const char* PREFIJO = "rag/rg-x7p2d";
// =============================================================

// ---------- Broker MQTT ----------
const char* BROKER = "broker.hivemq.com";
const int   PUERTO = 1883;   // MQTT por TCP (sin cifrar)

// ---------- Pines ----------
const int LED_ROJO     = 25;
const int LED_VERDE    = 26;
const int LED_AMARILLO = 33;
const int BUZZER       = 27;
const int BOTON_VISTO  = 14;

// ---------- Palabras clave por categoria ----------
// Se escriben en minuscula y sin tildes (el programa limpia el mensaje igual).
// Podes agregar o sacar frases: separalas con coma y entre comillas.
const char* SECRETO[]   = {"secreto", "no le digas", "no le cuentes", "no se lo digas", "entre nosotros", "borra el chat", "borra los mensajes"};
const char* FOTOS[]     = {"foto", "camara", "video", "mandame"};
const char* DATOS[]     = {"donde vivis", "direccion", "que escuela", "que colegio", "estas solo", "estas sola", "tus papas estan"};
const char* ENCUENTRO[] = {"encontrarnos", "veamonos", "nos vemos", "te paso a buscar", "te voy a buscar"};

// Largo maximo de cada mensaje (igual que en la pagina)
const int LARGO_MAXIMO = 200;

// ---------- Objetos de red ----------
WiFiClient   clienteWiFi;
PubSubClient mqtt(clienteWiFi);

// Nombres completos de los temas (se arman en setup con el PREFIJO)
String temaChat, temaResultado, temaEstado, temaVisto;
String idCliente;

// ---------- Estado del programa ----------
bool alarmaActiva = false;
unsigned long ultimoBeep = 0;
bool estadoBeep = false;
unsigned long amarilloHasta = 0;          // hasta cuando queda prendido el amarillo
unsigned long ultimoIntentoWiFi = 0;
unsigned long ultimoIntentoMQTT = 0;
unsigned long ultimoParpadeo = 0;
bool amarilloParpadeo = false;
bool wifiAvisado = false;

// Boton con antirrebote (sin delay)
bool ultimaLecturaBoton = HIGH;
unsigned long cambioBoton = 0;
bool botonEstable = HIGH;

// ================= Funciones de ayuda =================

// Pasa a minuscula y saca tildes para comparar mas facil
String limpiar(String t) {
  t.toLowerCase();
  t.replace("á", "a"); t.replace("é", "e"); t.replace("í", "i");
  t.replace("ó", "o"); t.replace("ú", "u"); t.replace("ü", "u");
  t.replace("Á", "a"); t.replace("É", "e"); t.replace("Í", "i");
  t.replace("Ó", "o"); t.replace("Ú", "u"); t.replace("Ü", "u");
  t.replace("ñ", "n"); t.replace("Ñ", "n");
  return t;
}

// Busca palabras de una lista dentro del mensaje
bool contiene(String msj, const char* lista[], int largo) {
  for (int i = 0; i < largo; i++) {
    if (msj.indexOf(lista[i]) >= 0) return true;
  }
  return false;
}

// Devuelve las categorias encontradas como lista JSON: ["Pide secreto","..."]
// Si el mensaje es seguro devuelve [] (lista vacia)
String analizar(String mensaje) {
  String m = limpiar(mensaje);
  String cat = "";
  if (contiene(m, SECRETO,   sizeof(SECRETO)   / sizeof(SECRETO[0])))   cat += "\"Pide secreto\",";
  if (contiene(m, FOTOS,     sizeof(FOTOS)     / sizeof(FOTOS[0])))     cat += "\"Pide fotos o cámara\",";
  if (contiene(m, DATOS,     sizeof(DATOS)     / sizeof(DATOS[0])))     cat += "\"Pide datos personales\",";
  if (contiene(m, ENCUENTRO, sizeof(ENCUENTRO) / sizeof(ENCUENTRO[0]))) cat += "\"Propone un encuentro\",";
  if (cat.endsWith(",")) cat.remove(cat.length() - 1);   // saca la ultima coma
  return "[" + cat + "]";
}

// Prepara un texto para meterlo dentro de un JSON (escapa comillas y barras).
// Asi nadie puede "romper" el JSON escribiendo comillas en el chat.
String escaparJSON(String t) {
  String r = "";
  for (unsigned int i = 0; i < t.length(); i++) {
    char c = t[i];
    if (c == '"')       r += "\\\"";
    else if (c == '\\') r += "\\\\";
    else if (c == '\n') r += "\\n";
    else if (c == '\r') r += "\\r";
    else if (c == '\t') r += "\\t";
    else if ((unsigned char)c < 0x20) r += ' ';   // otros caracteres de control
    else r += c;
  }
  return r;
}

// Lee el valor de texto de un campo del JSON. Ej: leerCampo(json, "texto")
// Es un lector simple (sin ArduinoJson): alcanza para los mensajes de la pagina.
String leerCampo(const String& json, const char* campo) {
  String clave = String("\"") + campo + "\"";
  int p = json.indexOf(clave);
  if (p < 0) return "";
  p = json.indexOf(':', p + clave.length());
  if (p < 0) return "";
  p = json.indexOf('"', p + 1);
  if (p < 0) return "";

  String valor = "";
  for (unsigned int i = p + 1; i < json.length(); i++) {
    char c = json[i];
    if (c == '"') break;                 // fin del texto
    if (c == '\\' && i + 1 < json.length()) {
      char s = json[++i];
      if (s == 'n' || s == 'r' || s == 't') valor += ' ';
      else if (s == 'u') { valor += ' '; i += 4; }   // á, etc: lo cambiamos por espacio
      else valor += s;                   // \" \\ \/
    } else {
      valor += c;
    }
  }
  return valor;
}

// Corta el texto a LARGO_MAXIMO bytes sin partir una letra con tilde a la mitad
String cortar(String t) {
  if ((int)t.length() <= LARGO_MAXIMO) return t;
  int fin = LARGO_MAXIMO;
  while (fin > 0 && ((unsigned char)t[fin] & 0xC0) == 0x80) fin--;   // byte de continuacion UTF-8
  return t.substring(0, fin);
}

// ================= LEDs y alarma =================

void ponerVerde() {
  alarmaActiva = false;
  digitalWrite(LED_ROJO, LOW);
  digitalWrite(BUZZER, LOW);
  digitalWrite(LED_VERDE, HIGH);
}

void ponerAlarma() {
  alarmaActiva = true;
  digitalWrite(LED_VERDE, LOW);
  digitalWrite(LED_ROJO, HIGH);
}

// Publica el estado (retenido: el broker lo guarda para quien se conecte despues)
void publicarEstado() {
  if (!mqtt.connected()) return;
  String json = String("{\"alarma\":") + (alarmaActiva ? "true" : "false") + ",\"online\":true}";
  mqtt.publish(temaEstado.c_str(), json.c_str(), true);
}

void apagarAlarma(const char* origen) {
  ponerVerde();
  publicarEstado();
  Serial.print("Alarma apagada (");
  Serial.print(origen);
  Serial.println("). Vuelve el verde.");
}

// ================= Mensajes que llegan del broker =================

void alRecibir(char* tema, byte* carga, unsigned int largo) {
  // Pasamos los bytes a un String
  String json = "";
  json.reserve(largo + 1);
  for (unsigned int i = 0; i < largo; i++) json += (char)carga[i];
  String nombreTema = String(tema);

  // --- Mensaje del chat ---
  if (nombreTema == temaChat) {
    String texto = leerCampo(json, "texto");
    String id = leerCampo(json, "id");
    texto.trim();
    if (texto.length() == 0) return;
    texto = cortar(texto);

    // LED amarillo: aviso de "mensaje nuevo" durante medio segundo
    digitalWrite(LED_AMARILLO, HIGH);
    amarilloHasta = millis() + 500;

    String categorias = analizar(texto);
    bool riesgo = categorias != "[]";

    Serial.print("Mensaje recibido: ");
    Serial.println(texto);

    // Respondemos con el resultado del analisis
    String resp = "{\"id\":\"" + escaparJSON(id) + "\",\"texto\":\"" + escaparJSON(texto) +
                  "\",\"riesgo\":" + (riesgo ? "true" : "false") + ",\"categorias\":" + categorias + "}";
    mqtt.publish(temaResultado.c_str(), resp.c_str());

    if (riesgo) {
      Serial.print("ALERTA DE GROOMING -> ");
      Serial.println(categorias);
      ponerAlarma();
      publicarEstado();
    } else {
      Serial.println("Mensaje normal, todo en orden.");
    }
    return;
  }

  // --- Los padres tocaron "Visto" en el panel ---
  if (nombreTema == temaVisto) {
    if (json.indexOf("visto") >= 0) apagarAlarma("desde el panel");
    return;
  }
}

// ================= Conexion (sin bloquear el loop) =================

void revisarWiFi() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!wifiAvisado) {
      Serial.print("Wi-Fi conectado. IP: ");
      Serial.println(WiFi.localIP());
      wifiAvisado = true;
    }
    return;
  }
  wifiAvisado = false;
  // Reintenta cada 10 segundos, sin frenar el resto del programa
  if (millis() - ultimoIntentoWiFi > 10000 || ultimoIntentoWiFi == 0) {
    ultimoIntentoWiFi = millis();
    Serial.print("Conectando al Wi-Fi \"");
    Serial.print(NOMBRE_RED);
    Serial.println("\"...");
    WiFi.disconnect();
    WiFi.begin(NOMBRE_RED, CLAVE_RED);
  }
}

void revisarMQTT() {
  if (WiFi.status() != WL_CONNECTED) return;
  if (mqtt.connected()) return;

  // Reintenta cada 5 segundos
  if (millis() - ultimoIntentoMQTT < 5000 && ultimoIntentoMQTT != 0) return;
  ultimoIntentoMQTT = millis();

  Serial.print("Conectando al broker ");
  Serial.print(BROKER);
  Serial.println("...");

  // Last Will (ultimo deseo): si el ESP32 se desconecta de golpe,
  // el broker publica esto solo en el tema de estado, retenido.
  const char* ultimoDeseo = "{\"online\":false}";
  if (mqtt.connect(idCliente.c_str(), temaEstado.c_str(), 0, true, ultimoDeseo)) {
    Serial.println("Conectado al broker MQTT.");
    mqtt.subscribe(temaChat.c_str());
    mqtt.subscribe(temaVisto.c_str());
    publicarEstado();   // avisa "estoy en linea"
    Serial.print("Escuchando en ");
    Serial.print(PREFIJO);
    Serial.println("/chat y /visto");
  } else {
    Serial.print("No se pudo conectar al broker (codigo ");
    Serial.print(mqtt.state());
    Serial.println("). Reintento en 5 segundos.");
  }
}

// ================= Programa principal =================

void setup() {
  Serial.begin(115200);
  delay(100);
  Serial.println();
  Serial.println("=== RAG - Router Anti Grooming ===");

  pinMode(LED_ROJO, OUTPUT);
  pinMode(LED_VERDE, OUTPUT);
  pinMode(LED_AMARILLO, OUTPUT);
  pinMode(BUZZER, OUTPUT);
  pinMode(BOTON_VISTO, INPUT_PULLUP);   // el boton va a GND, no necesita resistencia

  // Prueba de LEDs al arrancar
  digitalWrite(LED_ROJO, HIGH); digitalWrite(LED_VERDE, HIGH); digitalWrite(LED_AMARILLO, HIGH);
  delay(800);
  digitalWrite(LED_ROJO, LOW); digitalWrite(LED_AMARILLO, LOW);
  ponerVerde();

  // Armamos los nombres de los temas
  temaChat      = String(PREFIJO) + "/chat";
  temaResultado = String(PREFIJO) + "/resultado";
  temaEstado    = String(PREFIJO) + "/estado";
  temaVisto     = String(PREFIJO) + "/visto";

  // Wi-Fi en modo estacion (se conecta a una red que ya existe)
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);

  // ID de cliente unico: "rag-esp32-" + la MAC del ESP32
  String mac = WiFi.macAddress();
  mac.replace(":", "");
  idCliente = "rag-esp32-" + mac;
  Serial.print("ID de cliente MQTT: ");
  Serial.println(idCliente);

  mqtt.setServer(BROKER, PUERTO);
  mqtt.setCallback(alRecibir);
  mqtt.setBufferSize(1024);   // los mensajes con 200 letras y tildes no entran en los 256 bytes de fabrica
  mqtt.setKeepAlive(15);      // si se corta, el broker se da cuenta en ~20 segundos
  mqtt.setSocketTimeout(5);   // no esperar mas de 5 s cada intento de conexion

  revisarWiFi();
}

void loop() {
  revisarWiFi();
  revisarMQTT();
  mqtt.loop();   // atiende los mensajes que llegan

  bool conectado = (WiFi.status() == WL_CONNECTED) && mqtt.connected();

  // LED amarillo: parpadeo lento mientras se conecta
  if (!conectado) {
    if (millis() - ultimoParpadeo > 700) {
      ultimoParpadeo = millis();
      amarilloParpadeo = !amarilloParpadeo;
      digitalWrite(LED_AMARILLO, amarilloParpadeo ? HIGH : LOW);
    }
  } else if (amarilloParpadeo) {
    amarilloParpadeo = false;
    digitalWrite(LED_AMARILLO, LOW);
  }

  // Apagar el LED amarillo despues de medio segundo (aviso de mensaje)
  if (amarilloHasta > 0 && millis() > amarilloHasta) {
    digitalWrite(LED_AMARILLO, LOW);
    amarilloHasta = 0;
  }

  // Boton fisico "Visto" con antirrebote de 50 ms (sin delay)
  bool lectura = digitalRead(BOTON_VISTO);
  if (lectura != ultimaLecturaBoton) {
    cambioBoton = millis();
    ultimaLecturaBoton = lectura;
  }
  if (millis() - cambioBoton > 50 && lectura != botonEstable) {
    botonEstable = lectura;
    if (botonEstable == LOW && alarmaActiva) apagarAlarma("boton fisico");
  }

  // Buzzer intermitente mientras haya alarma
  if (alarmaActiva && millis() - ultimoBeep > 400) {
    ultimoBeep = millis();
    estadoBeep = !estadoBeep;
    digitalWrite(BUZZER, estadoBeep ? HIGH : LOW);
  }
}
