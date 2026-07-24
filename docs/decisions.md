# Decisiones de diseño

Registro de decisiones ya tomadas y su razonamiento. El objetivo es que una sesión
futura no las reabra sin saber por qué se tomaron así.

---

## 1. Cámara dentro de la app (`getUserMedia`), no el `<input capture>` nativo

**Decisión**: capturar fotos con `navigator.mediaDevices.getUserMedia` (overlay con
`<video>` en vivo + botón de disparo, `app.js` `openCamera()`/`capturePhoto()`), en vez
de `<input type="file" capture="environment">`. Se cae al `<input capture>` original
sólo si `getUserMedia` no está disponible o el usuario niega el permiso.

**Por qué**: en Android, `<input capture>` abre la cámara nativa como una app
separada. Mientras está abierta, el navegador queda en segundo plano y **Android lo
mata por presión de memoria**; al volver, la página se recarga de cero y se pierde
todo el estado (incluida la foto recién tomada). El usuario reportó exactamente este
síntoma: "de 4 intentos, funciona 1 solo, la foto no queda guardada". No es un bug de
la lógica de guardado — es que el método de captura elegido no puede ser confiable en
ese sistema operativo. La única forma de eliminar el problema de raíz es no cambiar de
app nunca: `getUserMedia` mantiene todo en el mismo contexto de página.

**Trade-off aceptado**: la resolución de captura queda atada al stream de video (se
pide `ideal: 2560×1440`), no a los 12+ MP del sensor. Para documentar patologías y
anotarlas en pantalla es más que suficiente, y de hecho reduce el peso en
almacenamiento. Si alguna vez hace falta el máximo detalle del sensor, "Galería" +
la cámara nativa del teléfono siguen disponibles como alternativa manual.

**Dónde vive**: `app.js` — `openCamera()`, `capturePhoto()`, `closeCamera()`,
`flipCamera()`, overlay `#cameraOverlay` en `index.html`.

**Implicación para el futuro**: si se agrega cualquier otro flujo que necesite salir
de la página hacia una app nativa (compartir, elegir ubicación, etc.), evaluar primero
si Android puede matar el proceso mientras tanto y qué estado se perdería.

---

## 2. Vendorizar dependencias como archivos estáticos, nunca por CDN

**Decisión**: tanto JSZip (`vendor/jszip.min.js`) como la tipografía Archivo
(`vendor/fonts/*.woff2`) se descargan una vez y se commitean como archivos del
proyecto, cargados localmente y precacheados por el service worker — no se cargan
desde `cdn.jsdelivr.net` ni `fonts.googleapis.com` en tiempo de ejecución.

**Por qué**: la app está pensada para uso **offline en el campo** (PWA con service
worker, ver decisión #5). Si "Exportar" dependiera de bajar JSZip de un CDN en el
momento, o la tipografía de Google Fonts, ambos fallarían sin señal — exactamente la
situación de uso real que la app tiene que soportar. Vendorizar es el único enfoque
consistente con "offline-first" cuando no hay build tool que resuelva esto por code
splitting (ver decisión #4).

**Cómo se generan/actualizan**: JSZip se bajó tal cual (MIT, sin modificar) de
`cdn.jsdelivr.net/npm/jszip@3.10.1`. La fuente se bajó pidiendo el CSS de Google Fonts
con un User-Agent moderno (para que devuelva `.woff2`) y extrayendo las 3 URLs de
`fonts.gstatic.com` que aparecen en la respuesta — Archivo se sirve como fuente
variable, así que los pesos 400/600/800 comparten el mismo archivo por rango unicode
(`vendor/fonts/archivo.css` documenta el comando exacto para regenerarlo).

**Implicación para el futuro**: cualquier librería nueva de peso similar (otro
formato de exportación, otra fuente) debería seguir este mismo patrón — descargarla
una vez, commitearla, sumarla a la lista de precache de `sw.js`, y cargarla de forma
diferida si sólo se usa en un flujo puntual (ver decisión #3).

---

## 3. Import diferido de librerías pesadas (mismo patrón que `app informes`)

**Decisión**: JSZip no se carga en el `<script>` principal — se inyecta un
`<script src="vendor/jszip.min.js">` dinámicamente recién cuando el usuario toca
"Exportar" (`loadJSZip()` en `app.js`, cachea la promesa para no cargarlo dos veces).

**Por qué**: mantiene liviana la carga inicial de la app para el flujo común (sacar
fotos, marcarlas, navegarlas), que es lo que se usa constantemente en el campo. Es el
mismo criterio que ya sigue el proyecto hermano `app informes` para `jspdf`/`docx`/
`heic2any` — cargar bajo demanda lo que sólo se usa en un flujo puntual.

**Dónde vive**: `app.js`, función `loadJSZip()`.

---

## 4. Sin build tool, sin `package.json`, HTML/CSS/JS vanilla

**Decisión** (preexistente, documentada acá porque condicionó varias decisiones
posteriores): el proyecto no tiene Vite/webpack/npm — es HTML/CSS/JS servido tal cual,
con `test-server.js` (un servidor HTTP de Node de ~15 líneas, sin dependencias) para
desarrollo local.

**Por qué**: simplicidad — no hace falta paso de build para una PWA de esta escala, y
evita la superficie de mantenimiento de un toolchain (versiones de Node, lockfiles,
etc.) para una app que un solo desarrollador mantiene de forma intermitente.

**Implicación para el futuro**: esta decisión es la razón por la que los íconos PWA se
generaron con un script Node casero en vez de una librería de imágenes (no hay forma
limpia de agregar una dependencia npm sólo para eso sin introducir un
`package.json`/`node_modules`), y por la que las librerías pesadas se vendorizan como
archivos sueltos en vez de resolverse con code-splitting real (ver decisión #2). Si el
proyecto creciera mucho más, valdría la pena reconsiderar sumar un build mínimo (por
ejemplo, esbuild sin configuración) — pero no antes de que la falta de eso empiece a
doler de verdad.

---

## 5. GitHub Pages + GitHub Actions para publicar (repo público)

**Decisión**: la app se publica en `https://eze183.github.io/releva-foto/` vía un
workflow de GitHub Actions (`.github/workflows/deploy.yml`) que sube el contenido del
repo como Pages en cada push a `master`, en vez de Netlify/Vercel u otro hosting.

**Por qué**: el usuario ya tenía cuenta de GitHub, es gratis, da HTTPS automático
(necesario para que el service worker y `getUserMedia` funcionen — ambos requieren
contexto seguro), y no requiere una cuenta nueva en otro servicio. Se usó el modo
"GitHub Actions" como fuente de Pages (no "Deploy from a branch") para tener control
explícito del workflow.

**Trade-off aceptado**: GitHub Pages gratis requiere que el repo sea **público** — el
código fuente es visible para cualquiera. Esto es aceptable porque ninguna foto ni
dato del usuario se sube nunca al repo ni a ningún servidor: todo vive en IndexedDB
del navegador de cada dispositivo (ver decisión #6). Lo único público es el código.

**Dónde vive**: `.github/workflows/deploy.yml`.

---

## 6. Todo local: IndexedDB, sin backend, sin sincronización

**Decisión** (preexistente, reafirmada en estas sesiones): las fotos y sus metadatos
viven exclusivamente en **IndexedDB del navegador de cada dispositivo**
(`DB_NAME = "releva-foto"`, stores `photos` y `meta`). No hay ningún servidor propio,
ni llamada de red que suba contenido del usuario.

**Por qué**: privacidad — las fotos de un relevamiento pueden ser sensibles
(viviendas, datos de un organismo como el IPAV en el proyecto hermano). "Exportar"
(zip) es la única vía de sacar los datos, y es explícita y manual (el usuario decide
cuándo y a dónde).

**Implicación para el futuro**: esto es lo que hace que los datos **no se transfieran
solos** entre dispositivos (ej. entre el teléfono y una PC, o entre `localhost` y
`eze183.github.io`, que son orígenes distintos con storage distinto). Cualquier pedido
futuro de "sincronizar entre dispositivos" requeriría una conversación explícita sobre
si se rompe esta garantía de privacidad, no es algo para agregar de pasada.

---

## 7. Convención: bumpear la versión de caché del service worker en cada cambio de assets

**Decisión**: `sw.js` tiene una constante `CACHE = "releva-foto-vN"`; cada vez que
cambia el contenido de `index.html`/`app.js`/`styles.css`/cualquier archivo
precacheado, hay que incrementar `N`.

**Por qué**: se aprendió por un bug real en la sesión del 21/07 — el service worker
sólo revisa si hay una versión nueva cuando el **contenido de `sw.js` mismo** cambia
(comparación byte a byte). Si se edita `app.js` pero no `sw.js`, el navegador nunca se
entera de que hay que reinstalar el service worker, y quienes ya tienen la PWA
instalada siguen viendo la versión vieja indefinidamente (la lógica `activate` que
borra cachés viejos nunca llega a correr). `sw.js` ya tiene `skipWaiting()` +
`clients.claim()` desde la etapa de robustez inicial, así que una vez que el bump
dispara el update, alcanza con recargar (no hace falta cerrar la app del todo) — pero
sin el bump, no se dispara nada.

**Implicación para el futuro**: cualquier cambio a index.html/app.js/styles.css/
assets nuevos **tiene que ir acompañado de un bump de `CACHE`** en el mismo commit. Es
fácil de olvidar porque no rompe nada en desarrollo local (donde uno limpia el
service worker a mano) — el síntoma sólo aparece en producción, para usuarios que ya
tenían la app instalada.

---

## 8. Especificidad CSS de `[hidden]` vs. clases de layout

**Decisión/hallazgo**: cualquier elemento que se oculta con el atributo `hidden` y
además tiene una clase que define `display` (ej. `.details-form{display:flex}`)
necesita una regla explícita `.esa-clase[hidden]{display:none}` — si no, la clase le
gana a la regla nativa `[hidden]{display:none}` por orden de cascada (misma
especificidad, la hoja de estilos del proyecto carga después que la del user-agent).

**Por qué se documenta**: ya causó un bug real (el formulario de edición de una foto
no se ocultaba nunca, sesión del 17/07) hasta que se agregó la regla `[hidden]`
explícita para `.details-form`.

**Implicación para el futuro**: si se agrega un nuevo bloque que se muestra/oculta con
`hidden` y tiene una clase con `display` propio, replicar el mismo patrón
(`.esa-clase[hidden]{display:none}`) desde el principio.

---

## 9. `touch-action:manipulation` no bloquea el pinch-zoom nativo del navegador

**Decisión/hallazgo**: la superposición de cámara (`#cameraOverlay`) y el `<video>`
usan `touch-action:none`, no `manipulation`, reforzado con `preventDefault()` en los
listeners de touch (registrados como no-pasivos).

**Por qué se documenta**: el usuario reportó que, al hacer zoom con dos dedos en la
cámara, el botón de disparo se movía fuera de pantalla y no se podía tocar. La causa
no era la lógica de zoom por hardware (`MediaStreamTrack.applyConstraints`), que
funcionaba bien — era que `touch-action:manipulation` (usado en la primera versión)
**permite** el pinch-zoom nativo del navegador (sólo bloquea el double-tap-zoom), así
que el gesto disparaba dos zooms en simultáneo: el nuestro (por hardware) y el del
navegador (escalando visualmente toda la página, botón de disparo incluido). Cambiar
a `touch-action:none` bloquea el gesto nativo del todo y deja el zoom exclusivamente
en manos del código de la app.

**Implicación para el futuro**: cualquier gesto multitáctil propio (pinch, swipe)
sobre un elemento de pantalla completa necesita `touch-action:none` explícito, no
`manipulation` — este último es para gestos de un solo dedo (tap, pan) donde sólo se
quiere sacar el delay del double-tap-zoom.

---

## 10. La carpeta "General" es la única carpeta protegida (no se puede borrar, mover
     ni renombrar)

**Decisión**: reafirmada explícitamente por el usuario en la sesión 4, cuando notó
que no se podía borrar "General" y preguntó si era un bug. No lo es — es la carpeta
de respaldo donde caen las fotos de cualquier carpeta que se elimine (ver
implementación en `removeFolderByName()`, `app.js`). Si se pudiera borrar también,
haría falta definir un nuevo destino de respaldo, lo cual el usuario decidió no
necesitar.

**Por qué**: sin una carpeta de respaldo garantizada, borrar una carpeta con fotos
requeriría siempre pedirle al usuario un destino en el momento, complicando el flujo
más común (borrar una carpeta vacía o ya vaciada a mano).

**Implicación para el futuro**: "General" queda exenta de las tres operaciones nuevas
de la sesión 4 (selección múltiple para mover, renombrar, borrar). Si en el futuro se
pide poder borrarla, hay que definir explícitamente a dónde van sus fotos y las de
futuras carpetas eliminadas — no es un cambio menor.
