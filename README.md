# RAG — Router Anti Grooming

Proyecto escolar de Informática (domótica, redes y ciberseguridad).

**RAG** es una maqueta de una casa con un "router inteligente" (un ESP32) que revisa los mensajes que recibe un chico en el chat de un juego. Si detecta una frase típica de grooming, prende una alarma (LED rojo y buzzer) en el cuarto de los padres y les avisa en un panel web. Si todo está bien, queda el LED verde.

La página web está publicada en **GitHub Pages** y se comunica con el ESP32 a través de un **broker MQTT** público.

---

## Cómo se conectan las partes

```
 Celular / tablet                                    Maqueta (casa)
 (página en GitHub Pages)                            (ESP32 con Wi-Fi)
 ┌──────────────────┐                               ┌──────────────────┐
 │ chat.html        │                               │ analiza mensajes │
 │ padres.html      │                               │ LED rojo / verde │
 └────────┬─────────┘                               │ buzzer, botón    │
          │                                         └────────┬─────────┘
          │  MQTT seguro (wss, puerto 8884)                  │  MQTT (TCP, puerto 1883)
          │                                                  │
          └──────────────►  broker.hivemq.com  ◄─────────────┘
                         (reparte los mensajes)
```

**¿Por qué hace falta el broker?** Una página de GitHub Pages no puede hablarle directo al ESP32:

1. GitHub Pages usa HTTPS y el ESP32 sirve HTTP en una IP local. El navegador bloquea esa mezcla (contenido mixto / acceso a redes privadas).
2. Si el celular estuviera conectado a la red propia del ESP32, no tendría internet para cargar la página.

Con MQTT, los dos se conectan a internet y se mandan mensajes por **temas** (modelo publicar/suscribir).

### Temas MQTT

| Tema | Quién publica | Quién escucha | Contenido (JSON) |
|---|---|---|---|
| `PREFIJO/chat` | Chat del chico | ESP32 y chat | `{"texto": "...", "id": "..."}` |
| `PREFIJO/resultado` | ESP32 | Chat y panel | `{"id": "...", "texto": "...", "riesgo": true, "categorias": ["Pide secreto"]}` |
| `PREFIJO/estado` | ESP32 (retenido) | Panel | `{"alarma": false, "online": true}` |
| `PREFIJO/visto` | Panel | ESP32 | `{"accion": "visto"}` |

El ESP32 es el que analiza (es el "router" que vigila la red). La página solo envía y muestra.

---

## Archivos

```
index.html          Portada: qué es RAG + botones a las dos páginas
chat.html           "Tablet del chico": chat de un juego
padres.html         Panel de los padres
css/estilo.css      Estilos (rojo #C8102E y azul #1F3B57)
js/config.js        PREFIJO y URL del broker (ÚNICO lugar para cambiarlos)
js/mqtt-conexion.js Conexión con el broker (la usan chat y padres)
js/chat.js          Lógica del chat
js/padres.js        Lógica del panel
esp32/RouterAntiGrooming/RouterAntiGrooming.ino   Programa del ESP32
```

---

## 1. Cambiar el PREFIJO (opcional)

El prefijo hace que nuestros mensajes no se mezclen con los de otras personas que usan el mismo broker público. Viene puesto `rag/rg-x7p2d`.

Si lo querés cambiar, **tiene que quedar igual en los dos lugares**:

1. En `js/config.js`, la línea `PREFIJO: "rag/rg-x7p2d",`
2. En `esp32/RouterAntiGrooming/RouterAntiGrooming.ino`, la línea `const char* PREFIJO = "rag/rg-x7p2d";`

Usá solo letras minúsculas, números, `-` y `/`.

## 2. Cambiar el Wi-Fi del ESP32

Al principio del sketch, en el bloque `CAMBIA ESTO`:

```cpp
const char* NOMBRE_RED = "NombreDeTuRed";
const char* CLAVE_RED  = "ClaveDeTuRed";
```

La red **tiene que tener internet**. Para la presentación lo más seguro es el **hotspot del celular** (las redes de los colegios a veces bloquean los puertos 1883 u 8884). El ESP32 solo funciona en redes de **2,4 GHz**.

---

## 3. Publicar la página en GitHub Pages

1. Entrá a [github.com](https://github.com) y creá un repositorio nuevo (por ejemplo `rag-router-anti-grooming`), **público**, sin README.
2. Subí todos los archivos de este proyecto (desde la terminal con `git push`, o arrastrándolos en *Add file → Upload files*).
3. En el repositorio, andá a **Settings → Pages**.
4. En *Build and deployment*, elegí **Source: Deploy from a branch**.
5. En *Branch* elegí **main** y la carpeta **/ (root)**. Tocá **Save**.
6. Esperá 1 o 2 minutos y recargá la página de Settings → Pages: arriba aparece el link, algo como `https://TU-USUARIO.github.io/rag-router-anti-grooming/`.

Cada vez que subas cambios, GitHub Pages se actualiza solo en un par de minutos.

---

## 4. Preparar el Arduino IDE y subir el sketch

1. **Instalar el soporte para ESP32** (si nunca lo hiciste):
   1. *Archivo → Preferencias → Gestor de URLs adicionales de tarjetas*, pegá:
      `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
   2. *Herramientas → Placa → Gestor de tarjetas*, buscá **esp32** (de Espressif) e instalalo.
2. **Instalar PubSubClient**:
   1. *Herramientas → Administrar bibliotecas…*
   2. Buscá **PubSubClient** y elegí la de **Nick O'Leary**. Tocá *Instalar*.
3. Abrí `esp32/RouterAntiGrooming/RouterAntiGrooming.ino`.
4. Cambiá el nombre y la clave del Wi-Fi (paso 2).
5. Elegí la placa: *Herramientas → Placa → esp32 → ESP32 Dev Module* (o la que tengas).
6. Elegí el puerto: *Herramientas → Puerto* (el COM que aparece al enchufar el ESP32).
7. Tocá **Subir** (la flecha →).
8. Abrí el *Monitor Serie* a **115200** baudios. Tenés que ver:
   ```
   Conectando al Wi-Fi "..."...
   Wi-Fi conectado. IP: ...
   Conectando al broker broker.hivemq.com...
   Conectado al broker MQTT.
   ```

Mientras se conecta, el **LED amarillo** parpadea lento. Cuando queda conectado, se apaga.

### Conexiones

| Componente | Pin | Comportamiento |
|---|---|---|
| LED rojo (+ resistencia 220 Ω) | GPIO 25 | Prendido mientras haya alarma |
| LED verde (+ resistencia 220 Ω) | GPIO 26 | Prendido cuando no hay alarma |
| LED amarillo (opcional) | GPIO 33 | Parpadea 0,5 s con cada mensaje; parpadeo lento mientras se conecta |
| Buzzer activo (opcional) | GPIO 27 | Intermitente (400 ms) mientras haya alarma |
| Botón "Visto" (opcional) | GPIO 14 a GND | Apaga la alarma |

Para editar las frases que se detectan, cambiá las listas `SECRETO`, `FOTOS`, `DATOS` y `ENCUENTRO` al principio del sketch (en minúscula y sin tildes).

---

## 5. Cómo probarlo (con la maqueta)

1. Abrí la página publicada desde el celular (con internet) y entrá al **Panel de los padres**: tiene que decir **"Maqueta en línea"**.
2. En otro celular o pestaña, abrí el **Chat** y mandá `hola, jugamos una partida?` → el LED verde sigue prendido y el panel no muestra alerta.
3. Mandá `no le cuentes a tus papás` → LED rojo y buzzer en la maqueta, y en el panel aparece la alerta con la categoría **"Pide secreto"**.
4. Tocá **"Visto — apagar alarma"** en el panel (o el botón físico) → vuelve el verde en la maqueta y en el panel.
5. Desenchufá el ESP32 → en menos de un minuto el panel muestra **"Maqueta desconectada"**.

> Tip para la presentación: si abrís el chat en **dos** celulares, lo que escribe uno aparece en el otro. Así uno puede hacer de "desconocido" y el otro de "chico".

---

## 6. Cómo probar la página SIN el ESP32

Podés simular la maqueta con el cliente web de HiveMQ:

1. Abrí la página en tu compu o celular (puede ser la de GitHub Pages, o `index.html` abierta directo con doble clic).
2. En otra pestaña, entrá a **https://www.hivemq.com/demos/websocket-client/**
3. Completá:
   - **Host:** `broker.hivemq.com`
   - **Port:** `8884`
   - **SSL:** tildado
   - Tocá **Connect**.
4. **Simular que la maqueta está en línea:** en *Publish*, poné
   - Topic: `rag/rg-x7p2d/estado`
   - Message: `{"alarma": false, "online": true}`
   - Tildá **Retain** y tocá **Publish**.

   → El panel tiene que decir **"Maqueta en línea"** y **"Todo en orden"**.
5. **Simular una alerta:** publicá (sin Retain)
   - Topic: `rag/rg-x7p2d/resultado`
   - Message: `{"id": "prueba1", "texto": "no le cuentes a tus papás", "riesgo": true, "categorias": ["Pide secreto"]}`

   → El panel se pone en rojo: **"⚠ ALERTA DE GROOMING"** y aparece el mensaje en la lista.
6. **Ver lo que manda la página:** en *Subscriptions* tocá *Add New Topic Subscription* y poné `rag/rg-x7p2d/#` (el `#` significa "todos los temas"). Ahora, si escribís en el chat o tocás "Visto" en el panel, vas a ver los mensajes llegar.
7. **Simular la desconexión:** publicá en `rag/rg-x7p2d/estado` el mensaje `{"online": false}` con **Retain** → el panel muestra **"Maqueta desconectada"**.

> Si cambiaste el PREFIJO, usá el tuyo en vez de `rag/rg-x7p2d`.

---

## Ciberseguridad

- **Conexión cifrada:** la página usa `wss://` (WebSocket con TLS) para hablar con el broker.
- **Sin inyección de código:** los textos se muestran siempre con `textContent`, nunca con `innerHTML`. Si alguien escribe `<script>…`, se ve como texto y no se ejecuta. El ESP32 además escapa las comillas al armar el JSON.
- **Límite de 200 caracteres** por mensaje, en la página y en el ESP32.
- **Last Will (último deseo):** el ESP32 le deja al broker un mensaje `{"online": false}` para que lo publique solo si se corta la conexión. Así el panel sabe si la maqueta está apagada.

### Limitaciones

- El broker `broker.hivemq.com` es **público y abierto**: cualquiera que conozca el nombre del tema podría leer o mandar mensajes. Para una demo escolar es aceptable porque **no se usan datos reales**. En un producto real se usaría un **broker privado con usuario y contraseña** (y TLS también del lado del ESP32).
- El ESP32 se conecta por el puerto 1883, que no está cifrado.
- La detección busca palabras exactas: puede tener falsos positivos ("nos vemos en la partida") y no detecta frases que no estén en las listas. Es una maqueta educativa, no reemplaza el diálogo ni el acompañamiento de los adultos.
- Si la red del colegio bloquea los puertos 1883 u 8884, usá el hotspot del celular.
