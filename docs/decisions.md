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

---

## 11. El texto del editor de marcado es un objeto vectorial, no píxeles horneados

**Decisión**: en `app.js`, `state.textAnnotations` guarda cada texto agregado en el
editor de marcado como `{id, x, y, text, color, font}`, separado del historial de
formas (`state.history`, que sigue siendo pixel-based para flecha/recuadro/trazo).
Cada render (`fullRedraw()`) restaura la última captura de `state.history` y después
dibuja todos los textos encima (`renderTextLayer()`). El texto sólo se "hornea" en
píxeles definitivos al tocar "Listo" (`canvas.toDataURL()`), momento en el que deja de
ser editable — hasta ahí, es un objeto que se puede mover (arrastrar) o borrar
(mantener presionado) de forma independiente.

**Por qué**: el diseño anterior dibujaba el texto directo sobre los píxeles del canvas
con `context.fillText()`, empujándolo al mismo `state.history` que flechas/recuadros/
trazos. Eso causaba dos bugs reales reportados por el usuario: (1) no se podía borrar
sólo el texto sin deshacer también cualquier cambio posterior (compartía el mismo
stack de "Deshacer"), y (2) no había forma de re-seleccionar/mover un texto ya
colocado, porque una vez horneado en píxeles deja de ser una entidad distinguible del
resto del dibujo.

**Implicación para el futuro**: cualquier otra herramienta de marcado que necesite ser
editable después de agregada (por ejemplo, si se pidiera poder mover una flecha ya
dibujada) tendría que seguir el mismo patrón — vivir como objeto en una lista aparte,
no bakearse directo en `state.history`. Mezclar ambos enfoques en la misma capa
reintroduce el mismo problema que motivó este cambio.

---

## 12. Herramientas de marcado de un solo uso (se desactivan solas tras cada marca)

**Decisión**: en el editor de marcado, seleccionar una herramienta (flecha, recuadro,
trazo, texto) permite agregar **una sola marca**; después, `state.tool` vuelve a
`null` automáticamente (`deactivateTool()`) y hay que volver a tocar el botón de la
herramienta para usarla de nuevo. El editor arranca sin ninguna herramienta
preseleccionada (antes "Flecha" quedaba activa por defecto).

**Por qué**: el usuario reportó el problema de fondo detrás de los bugs de texto de
la decisión #11 — con cualquier herramienta seleccionada, tocar la foto simplemente
para mirarla de cerca (sin intención de dibujar) agregaba una forma no deseada. La
solución fue una idea del propio usuario, validada como correcta: en vez de intentar
distinguir "toco para navegar" de "toco para dibujar" con heurísticas de gesto, hacer
que cada intención de dibujar sea un acto explícito y de un solo uso elimina la
ambigüedad de raíz.

**Implicación para el futuro**: cualquier herramienta nueva que se agregue al editor
debe seguir el mismo patrón (llamar `deactivateTool()` después de completar su acción),
no asumir que puede quedar "armada" indefinidamente esperando el próximo toque.

---

## 13. Zoom táctil implementado a mano (cámara y foto en detalle), no con el gesto
     nativo del navegador

**Decisión**: tanto el zoom de la cámara in-app como el zoom de la foto en la vista
de detalle (`app.js`, `setupCameraZoom()`/`initCameraZoomGestures()` y
`setupPhotoZoom()`) manejan el gesto de pellizco a mano con `touchstart`/`touchmove`
propios, en vez de depender de que el navegador haga zoom nativo de la página.

**Por qué**: el pinch-zoom nativo del navegador (zoom de viewport) queda
**deshabilitado por Chrome cuando la PWA corre instalada en modo `standalone`**
(display mode del manifest) — es una restricción deliberada de la plataforma para dar
sensación de "app nativa", no algo que se pueda re-habilitar desde el manifest o el
meta viewport. Como la app está pensada para instalarse (ver decisión de PWA
instalable en `docs/roadmap.md`), cualquier necesidad de zoom táctil tiene que
resolverse con JavaScript propio.

**Trade-off aceptado en la cámara**: cuando el sensor no expone zoom óptico/digital
por hardware (`MediaStreamTrack.getCapabilities().zoom` ausente), se usa zoom digital
por software (`transform:scale()` sobre el `<video>`, recortado con `overflow:hidden`
en un contenedor) — sacrifica nitidez al ampliar (es sólo escalar los píxeles ya
capturados por el sensor a esa resolución), pero es preferible a que el pinch no haga
nada.

**Bug real encontrado y corregido en el camino**: `setupCameraZoom()` originalmente
registraba los listeners de `touchstart`/`touchmove` en el `<video>` en **cada
apertura de cámara**, sin sacar los anteriores — como el elemento `<video>` es
persistente en el DOM (no se recrea), abrir la cámara más de una vez (por ejemplo con
"Cambiar cámara", que cierra y reabre) hacía que los listeners se acumularan, y el
zoom terminaba multiplicándose de forma errática entre gestos de distintas
aperturas. Se corrigió separando el registro de listeners (una sola vez, al cargar la
app, en `initCameraZoomGestures()`) de la configuración por apertura (`setupCameraZoom()`
sólo actualiza un objeto compartido `cameraZoomInfo` con el track y los límites
vigentes). Se detectó recién al testear explícitamente el escenario de abrir la
cámara dos veces seguidas en la misma sesión — señal de que ese caso de prueba vale la
pena repetir con cualquier función que registre listeners sobre elementos DOM
persistentes reusados entre aperturas (cámara, editor de marcado, etc.).

**Implicación para el futuro**: cualquier función que adjunte listeners a un elemento
del DOM que persiste entre múltiples "sesiones" de uso (se abre y cierra varias veces
sin recrearse) debe registrar esos listeners una única vez, no en cada apertura —
patrón a repetir si se agrega, por ejemplo, zoom al editor de marcado.

---

## 14. Todas las formas del editor de marcado son objetos editables, salvo el trazo
     libre

**Decisión**: en `app.js`, flecha, recuadro y texto viven juntos en
`state.annotations` como objetos (`{id, type, ...campos propios}`), no como píxeles
horneados en `state.history`. Comparten un único sistema de selección
(`state.selectedAnnotationId`), manijas (`annotationHandles()`/`drawHandles()`) e
interacción táctil (tocar selecciona, arrastrar el cuerpo mueve, arrastrar una manija
ajusta, mantener presionado sin mover borra con confirmación). El trazo libre queda
deliberadamente afuera de este sistema — sigue siendo pixel-based en `state.history`,
sin selección ni manijas.

**Por qué**: extiende la decisión #11 (texto como objeto vectorial) a flecha y
recuadro, a pedido explícito del usuario ("todos los elementos... deben poder
moverse y ajustarse"). No se incluyó el trazo libre porque no se pidió — un trazo a
mano alzada es una secuencia de puntos, no una forma con parámetros simples
(posición/tamaño) que tenga sentido ajustar con manijas; convertirlo en editable
requeriría guardar todo el path como lista de puntos y decidir qué significa
"redimensionar" un garabato, que es un problema bastante distinto y no se pidió.

**Consecuencia importante**: como flecha/recuadro/texto ya no pasan por
`state.history`, el botón **"Deshacer" quedó acotado a revertir sólo el trazo
libre**. Esto es un cambio de comportamiento respecto a antes de la sesión 5 (cuando
"Deshacer" sí revertía cualquier forma, porque todo compartía el mismo historial de
píxeles) — se le avisó explícitamente al usuario en el resumen de la sesión 6 para
que no lo confunda con un bug.

**Trade-off aceptado**: no hay undo/redo real para mover, redimensionar o borrar una
anotación — sólo existe el estado actual y "eliminar" (mantener presionado). Si en el
futuro se pide poder deshacer un movimiento o un borrado accidental, hay que sumar un
historial de operaciones sobre `state.annotations` (distinto del historial de píxeles
que ya existe para el trazo libre) — no es una extensión trivial del sistema actual.

**Dónde vive**: `app.js`, desde `const canvas = ...` hasta los listeners
`pointerdown`/`pointermove`/`pointerup`/`pointercancel` del canvas del editor.

---

## 15. La cámara no se cierra al disparar (modo ráfaga) y la foto se guarda sola

**Decisión**: cada disparo guarda la foto directo en IndexedDB con un nombre
automático (`"<Carpeta> - 001"`) y deja la cámara abierta. No hay formulario de
detalles antes de guardar: nombre, nota y marcado son posteriores y opcionales,
desde el detalle de la foto. Se eliminó la vista `captureView`.

**Por qué**: el usuario reportó que el relevamiento se volvía lento porque había que
tocar "Guardar" foto por foto — el ciclo real era disparar → cerrar cámara →
completar formulario → guardar → reabrir cámara, 4 toques extra por foto. En el campo
la operación dominante es sacar muchas fotos seguidas del mismo sitio; los metadatos
son la excepción, no la regla, y por lo tanto no pueden estar en el camino crítico.

**Trade-off aceptado**: las fotos quedan con nombre genérico hasta que alguien las
renombre. Es reversible en cualquier momento (botón "Datos" en el detalle) y el
número correlativo por carpeta ya alcanza para ubicarlas al exportar.

**Dónde vive**: `app.js` — `openCameraFor()`, `capturePhoto()`, `savePhotoBlob()`,
`renderBurst()`, `finishCamera()`.

---

## 16. Las carpetas tienen id propio; el nombre dejó de ser la clave primaria

**Decisión**: `state.folders` guarda `{id, name, parentId}` y cada foto guarda
`folderId`. La carpeta "General" tiene el id fijo `"general"` (constante `ROOT_ID`).
La migración desde el formato anterior corre una sola vez al abrir la app
(`migrateFolderShape()`, `migratePhotoFolders()`, `backfillSequences()`).

**Por qué**: con el nombre como clave, "Vivienda 1" sólo podía existir una vez en toda
la app — imposible tener la misma numeración de viviendas en dos manzanas distintas,
que es exactamente la forma de un relevamiento. Además renombrar obligaba a reescribir
cada foto de la carpeta en IndexedDB.

**Consecuencia**: la unicidad de nombre ahora se valida **entre hermanas**, no
globalmente. Renombrar es instantáneo y no toca las fotos (por eso una foto llamada
"Baño - 001" conserva su nombre si después se renombra la carpeta — el nombre de la
foto es un dato propio, no una vista del nombre de la carpeta).

**Implicación para el futuro**: cualquier lógica nueva que identifique una carpeta
tiene que usar el id. Buscar por nombre sólo es válido para mostrar o para el
buscador.

---

## 17. Sin desplegable de jerarquía: el padre lo define el contexto

**Decisión**: crear una carpeta pide **un solo campo, el nombre**. El padre sale de
dónde se tocó el botón: desde el home es de nivel principal, desde adentro de una
carpeta es subcarpeta de esa. Renombrar/mover/eliminar viven en un menú **⋮ en cada
tarjeta de carpeta**. Se eliminó el diálogo de gestión `#folderDialog`.

**Por qué**: el usuario reportó que el `<select>` de carpeta padre "no funciona del
todo bien o no es cómodo". El problema de fondo no era el widget sino que pedía una
respuesta que la app ya tenía: si estás parado dentro de "Manzana 3" y tocás "Nueva
subcarpeta", el padre no es ambiguo. Además la jerarquía sangrada con espacios
ideográficos dentro de un `<option>` es ilegible en un teléfono. Sumado a eso, las
operaciones de carpeta estaban repartidas en dos mecanismos distintos (renombrar y
borrar en un diálogo, mover con long-press y barra inferior) — el menú ⋮ las junta
en un solo lugar descubrible, y el long-press queda sólo para operaciones en lote.

**Cambio de comportamiento respecto a la decisión #10**: borrar una carpeta ahora
manda sus fotos a la **carpeta de arriba** (su padre), no a "General". Con jerarquía
real es lo que espera cualquiera, y "General" sigue siendo el respaldo cuando la
carpeta borrada era de nivel principal. "General" sigue protegida (no se puede
renombrar, mover ni borrar).

---

## 18. Las marcas se guardan junto a la foto, sobre el original intacto

**Decisión**: al guardar el marcado, la foto conserva `originalBlob` (la imagen sin
marcas, guardada la primera vez que se marca) y `marks` (la lista de anotaciones como
objetos). `blob` pasa a ser la versión horneada, que es la que se muestra y se
exporta. Volver a "Marcar" reabre el editor sobre el original con todas las marcas
como objetos editables. El trazo libre también es un objeto ahora
(`{type:"draw", points:[…]}`), así que `state.history`/`getImageData` desaparecieron
por completo y "Deshacer" volvió a aplicar a todas las formas.

**Por qué**: hasta la sesión 6 el marcado sólo existía antes de guardar y era
destructivo — una vez horneado no se podía corregir una flecha mal puesta, y cada
pasada por el editor reescalaba la foto (a 1200×900) y la re-encodaba en JPEG,
perdiendo justo el detalle que se necesita para documentar una patología. Guardar el
original + las marcas resuelve las dos cosas de una: re-edición infinita y una sola
generación de pérdida JPEG por foto, sin importar cuántas veces se la marque.

**Trade-off aceptado**: una foto marcada ocupa aproximadamente el doble (original +
horneada). Sólo las fotos marcadas, que en un relevamiento son minoría.

**Nota**: esto reemplaza el mecanismo de historial pixel-based descrito en las
decisiones #11 y #14 — el criterio de "todo lo editable vive como objeto" que esas
decisiones establecían ahora se aplica a **todas** las herramientas, sin excepción.

---

## 19. No hay carpeta por defecto; borrar una carpeta borra lo que tiene adentro

**Decisión**: se eliminó la carpeta "General" como concepto. Una instalación nueva
arranca **sin ninguna carpeta** (pantalla vacía con "Creá una carpeta para empezar"),
todas las carpetas son iguales — se pueden renombrar, mover y eliminar sin excepción —
y **eliminar una carpeta borra también sus subcarpetas y sus fotos**, con un aviso que
dice exactamente cuánto se pierde ("Se borran también 1 subcarpeta y 34 fotos. No se
puede deshacer.").

**Por qué**: reemplaza y revierte las decisiones #10 y la parte final de #17. El
usuario lo dijo directo: "no necesito que haya una carpeta por defecto. además no se
puede eliminar y es molesto". "General" existía sólo para ser el destino de respaldo
de las fotos de una carpeta eliminada — era una carpeta que existía para resolver un
problema del código, no del relevamiento, y el costo era una excepción permanente en
la UI (un ítem que no se puede tocar, con acciones grises en su propio menú).

Sacar el respaldo obliga a definir qué pasa al borrar. Se eligió "borrar se lleva
todo" en vez de "las fotos suben al padre" porque es lo que hace cualquier gestor de
archivos y no tiene sorpresas: con el comportamiento anterior, borrar una carpeta hacía
aparecer 30 fotos mezcladas en la carpeta de arriba, que es un resultado que nadie
pidió. La vía no destructiva sigue existiendo y es explícita: mover las fotos a otra
carpeta antes (selección múltiple → "Mover a...").

**Red de seguridad**: `rescueOrphanPhotos()` corre al abrir la app y, si encuentra
fotos apuntando a una carpeta inexistente (dato viejo, migración a medias), crea una
carpeta "Fotos sueltas" y las mete ahí. Sólo se crea si de verdad hace falta — una
instalación sana nunca la ve.

**Para instalaciones existentes**: su carpeta "General" **no se borra sola**; queda
como una carpeta común más, con sus fotos intactas, y el usuario decide si la elimina
o la renombra. Borrar datos del usuario en una migración no es algo que la app pueda
decidir por su cuenta.

**Implicación para el futuro**: no queda ninguna entidad protegida en la app. Si
alguna vez se agrega una (una papelera, una carpeta de sistema), tiene que justificar
por qué el usuario no puede tocarla — la lección de esta decisión es que una excepción
permanente en la UI se paga en cada uso.

---

## 20. Notas: texto libre en dos niveles (carpeta y foto), no campos estructurados

**Decisión**: hay dos notas, ambas de **texto libre**:
- **Nota de carpeta** (`folder.note`): el contexto que vale para todo el conjunto y no
  pertenece a ninguna foto — cuándo se hizo, quién estaba, cómo se accede, qué quedó
  pendiente. Se ve como un bloque fijo arriba de la vista de carpeta y como una línea
  en la tarjeta de la carpeta. Se edita tocando el bloque o desde el menú ⋮.
- **Nota de foto** (`photo.note`, ya existía): la observación puntual de esa foto.

Se descartaron los campos estructurados (patología / severidad / ambiente) y las
etiquetas con lista predefinida.

**Por qué**: el usuario delegó explícitamente el formato ("no sé el formato de las
mismas, eso te lo dejo a vos"). Un relevamiento no tiene un esquema conocido de
antemano — cada obra trae observaciones que no estaban en la lista, y un formulario
fijo obliga a elegir "otro" y escribir igual, con un paso extra. El texto libre no
pierde nada: la búsqueda ya indexa nota de foto y de carpeta, y el CSV exportado las
lleva como columnas propias, así que filtrar y ordenar se hace afuera, en la planilla,
donde el usuario ya tiene todas las herramientas.

**El problema real no era el formato, era el acceso y la visibilidad**, y ahí se
concentró el trabajo:
- **Indicador en la grilla**: las fotos con nota muestran una marca sobre la miniatura
  y la nota como subtítulo. Una nota que hay que abrir para saber que existe no sirve
  cuando estás barriendo 40 fotos.
- **Notas rápidas** (`frequentNotes()`): al editar la nota de una foto aparecen chips
  con las notas que el propio usuario ya escribió, ordenadas por frecuencia de uso.
  En un relevamiento la misma observación se repite decenas de veces ("humedad en
  cielorraso") y tipearla cada vez en un teclado de teléfono es el verdadero costo.
  Es el beneficio de las etiquetas sin el costo de mantener una lista: la lista se
  construye sola con el uso y no hay ninguna pantalla de administración.
- **Un toque para editar**: la nota en la vista de detalle es el propio botón que abre
  la edición, con el foco puesto en el campo. Cuando está vacía dice "Agregar una
  nota" en color de acento, así el lugar vacío invita en vez de quedar mudo.

**Exportación**: la nota de carpeta va como columna en `registro.csv` **y** como
`_nota.txt` dentro de su carpeta en el zip — al descomprimir queda a la vista sin
tener que abrir la planilla.

**Implicación para el futuro**: si alguna vez se pide filtrar o agrupar por tipo de
patología dentro de la app, el camino es derivar las categorías de las notas rápidas
que ya se usan (son, de hecho, etiquetas emergentes), no agregar un campo nuevo que
obligue a reclasificar todo lo ya cargado.

---

## 21. Selector de lente trasero: sólo aparece si el teléfono distingue sus cámaras
     por etiqueta

**Decisión**: `openCameraFor()` intenta abrir la cámara con el `deviceId` guardado en
`localStorage` (`releva-foto-lens-device`) cuando existe; si ese dispositivo ya no es
válido, cae de nuevo a `facingMode` sin romper la apertura. Después de abrir, se
listan las cámaras con `enumerateDevices()` y se filtran las que tienen etiqueta de
cámara trasera (`/back|rear|trasera/i`, excluyendo `/front|user|frontal|selfie/i`). El
botón de lente (grupo de controles, a la izquierda del flip) sólo aparece si hay **dos
o más** cámaras traseras distinguibles por nombre; si no, se oculta y la cámara se
comporta exactamente igual que antes.

**Por qué**: el usuario preguntó por usar el gran angular. La Web API no tiene un
control de "zoom óptico" ni una forma de pedir "el lente gran angular" por constraint
— cada lente físico (normal, ultra angular, teleobjetivo) se expone como una cámara
separada en `enumerateDevices()`, y la única pista de cuál es cuál es el `label`, que
en Android Chrome suele incluir "facing back"/"facing front" pero **no está
garantizado** — algunos teléfonos devuelven etiquetas genéricas ("Camera 0",
"Camera 1") sin distinguir. Mostrar un selector con nombres genéricos sería peor que
no mostrarlo: el usuario no tendría forma de saber cuál es cuál, y probaría a ciegas.
Por eso el selector se autolimita a aparecer sólo cuando el propio teléfono da una
pista utilizable.

**Trade-off aceptado**: en teléfonos con etiquetas genéricas, no hay forma de elegir
lente desde la app aunque el hardware lo soporte. No hay alternativa mejor sin acceso
a APIs nativas (fuera del alcance de una PWA).

**Verificación pendiente del usuario**: esto se probó con cámaras mockeadas en el
Browser pane (no hay forma de verificar contra hardware real desde este entorno). Hay
que confirmar en el teléfono si Chrome expone las etiquetas de sus lentes traseros con
suficiente claridad como para que el selector aparezca y sea útil.

**Dónde vive**: `app.js` — `requestCameraStream()`, `refreshLensPicker()`,
`openLensPicker()`, `selectLens()`; botón `#cameraLens`, diálogo `#lensDialog`.

---

## 22. La foto en la vista de detalle se ve completa (`contain`), no recortada
     (`cover`)

**Decisión**: `.detail-image` pasa de `object-fit:cover` a `object-fit:contain`. El
recuadro (`.detail-image-wrap`) crece de 38vh a 48vh para aprovechar mejor el espacio
ahora que puede quedar con franjas vacías a los costados o arriba/abajo (rellenas con
`--surface`, el mismo fondo del recuadro).

**Por qué**: el usuario reportó que al abrir una foto guardada la veía "a un 80%
aprox". La causa era `cover`: recorta la imagen para llenar el recuadro por completo,
así que cualquier foto cuya relación de aspecto no coincidiera exactamente con la del
recuadro perdía una porción — permanentemente, sin forma de verla completa salvo que
la relación de aspecto calzara por casualidad. El pellizco para zoom (decisión #9)
sólo amplía, nunca reduce por debajo de 1x, así que no había ninguna vía para
recuperar el contenido recortado.

**Complejidad aceptada — el pellizco necesitó recalcularse**: con `cover`, la imagen
rellena el 100% del recuadro sin excepción, así que el pellizco/paneo podía asumir que
el `<img>` y el recuadro eran geométricamente lo mismo. Con `contain` eso deja de ser
cierto: el contenido real de la foto ocupa un sub-rectángulo del `<img>` (el resto son
franjas transparentes por el centrado que aplica `object-fit`). Como la transformación
CSS (`scale`+`translate`) sigue actuando sobre el `<img>` entero —franjas incluidas—
`clampPhotoZoom()` necesitaba saber dónde caen los bordes *reales* de la foto para no
dejar panear indefinidamente hacia una franja vacía. Se agregó
`computePhotoContentBox()`, que calcula ese sub-rectángulo (ancho, alto y desplazamiento
respecto al recuadro) a partir de `naturalWidth`/`naturalHeight` de la imagen ya
cargada, y se recalcula en cada gesto (`touchstart`) para no depender de que el
`onload` de la imagen ya haya disparado en el momento exacto en que el usuario empieza
a pellizcar.

**Verificado con dos casos extremos** (foto panorámica 1600×500 y foto vertical
500×1600) en el Browser pane: la foto se ve completa por defecto en ambos casos, con
franjas en el eje correspondiente; el pellizco a la escala máxima (4x) cubre
correctamente el recuadro sin dejar panear hacia la franja vacía en ninguno de los dos
ejes.

**Dónde vive**: `styles.css` — `.detail-image-wrap`, `.detail-image`. `app.js` —
`computePhotoContentBox()`, `clampAxis()`, `clampPhotoZoom()`.

---

## 23. La vista de detalle es un visor de pantalla completa, no una página con la
     foto arriba

**Decisión**: `#detailView` pasa a ser una superposición `position:fixed;inset:0`
(igual que `#cameraOverlay`) con fondo negro, foto a pantalla completa
(`object-fit:contain`, ocupa el 100% del viewport) y dos barras flotantes con
degradé (no fondo sólido) para los controles: arriba, volver + eliminar; abajo,
carpeta/nombre/nota + fecha + "Marcar"/"Datos". La edición de nombre y nota se movió
de un formulario inline (que se mostraba/ocultaba dentro de la página) a un
`<dialog id="photoEditDialog">`, siguiendo el mismo patrón que `folderNoteDialog`.

**Por qué**: el usuario pidió que tocar una foto la abra a pantalla completa, "tal
cual funciona la app nativa o carpeta de fotos de Android". La vista anterior
(decisión #22 arregló que la foto se viera completa, pero seguía confinada a un
recuadro de 48vh dentro de una página con cabecera, botones y texto ocupando el resto
de la pantalla) — el problema no era sólo el recorte, era que la foto nunca ocupaba
más que una fracción de la pantalla.

**Por qué barras con degradé y no fondo sólido**: un fondo sólido le resta espacio
visible a la foto (exactamente el problema que se estaba resolviendo). El degradé deja
la foto genuinamente a pantalla completa y mantiene el texto legible sobre cualquier
color de foto gracias al negro que se intensifica hacia los bordes.

**Por qué el formulario de edición pasó a diálogo**: con la foto ocupando toda la
pantalla, ya no hay un lugar natural donde "abrir" un formulario inline sin tapar la
imagen — antes ese espacio existía porque la foto sólo ocupaba 48vh. Moverlo a
`<dialog>` (que ya es el patrón establecido para crear/editar en esta app) resuelve
esto sin inventar un mecanismo nuevo.

**Implementación notable**: `#detailView.active{position:fixed;...}` usa selector por
ID para ganarle en especificidad a la regla genérica `.view.active{display:block}` —
sin esto, la regla genérica pisaría el `display:flex` necesario para el layout de
barras arriba/abajo. `position:fixed` funciona sin importar el anidamiento en el DOM
porque nada en la cadena de padres (`.app-shell`, `<body>`) tiene `transform`, que es
lo único que reancla `fixed` a un ancestro en vez de al viewport.

**Consecuencia para el zoom por pellizco**: `computePhotoContentBox()` y
`clampPhotoZoom()` (decisión #22) siguen funcionando sin cambios — ya leían el
tamaño real de `#detailImageWrap` con `getBoundingClientRect()` en cada gesto, así que
automáticamente empezaron a operar sobre el viewport completo en vez del recuadro de
48vh, sin tocar una sola línea de esa lógica.

**Dónde vive**: `index.html` — sección `#detailView`, diálogo `#photoEditDialog`.
`styles.css` — bloque `#detailView.active`, `.detail-topbar`, `.detail-bottombar`,
`.detail-pill-btn`. `app.js` — `openDetail()`, `openPhotoEdit()`, handlers de
`#editButton`/`#detailNote`/`#editCancel`/`#editForm`.

---

## 24. El botón/gesto "Atrás" de Android navega dentro de la app, no la cierra

**Decisión**: se implementó un sistema general con la History API (`pushState`/
`popstate`) para que cualquier pantalla "superpuesta" (visor de foto, cámara, editor
de marcado, un diálogo, una subcarpeta) deje una entrada en el historial del
navegador. Un único listener de `popstate` cierra lo que corresponda según qué esté
abierto en ese momento — sin importar si el gesto vino del sistema (Android) o de un
botón propio de la app (la X, "Cancelar", subir de carpeta), porque **todos** esos
botones pasan por la misma función (`requestBack()`) en vez de cerrar directo.

**Por qué**: el usuario reportó que, al ver una foto, tocar la flecha de retroceso de
Android (en su teléfono aparece abajo a la derecha) lo sacaba de la app entera en vez
de volver a la carpeta — "toco la flecha... por instinto o costumbre... y me saca de
la app, lo cual es molesto". La causa raíz: la app nunca usaba la History API, así
que ninguna de sus pantallas internas dejaba rastro en el historial del navegador. El
botón/gesto atrás de Android simplemente hace `history.back()` a nivel de sistema —
sin ninguna entrada propia que consumir, no tiene nada para deshacer y cierra la PWA.

**Alcance cubierto**: visor de foto (el caso reportado), cámara, editor de marcado,
navegación entre subcarpetas, y los ~9 `<dialog>` de la app. **No cubre** el modo de
selección múltiple (mantener presionada una carpeta/foto) — tiene varias vías de
salida no ligadas a un botón único (deseleccionar el último ítem, mover/eliminar en
lote) que hubiesen requerido auditar cada una por separado; queda para una sesión
aparte si se pide.

**Cómo se resolvió sin duplicar cierres** (el problema real de esta implementación):
cada pantalla puede cerrarse por dos vías — el gesto del sistema o un botón propio —
y ambas tienen que producir el mismo resultado exactamente una vez, no dos. La regla
adoptada: **el cierre real vive en un solo lugar** (`closeTopLayer()`, que inspecciona
el DOM en el momento — qué diálogo está abierto, si la cámara está visible, qué vista
está activa — y ejecuta la acción de cierre correspondiente). Los botones propios ya
no cierran nada directamente: llaman a `requestBack()`, que hace `history.back()` y
deja que el `popstate` resultante dispare `closeTopLayer()`. Así, gesto del sistema y
botón propio terminan en el mismo camino, sin lógica duplicada.

**El único caso que rompía esta regla — y el bug real que apareció al probarlo**: los
`<dialog>` nativos se cierran solos (botón "Cancelar" con `value="cancel"`, tecla
Escape) sin pasar por ningún JS propio. Se los detecta de forma genérica con un
`MutationObserver` sobre el atributo `open` de cada diálogo (así no hace falta tocar
cada `showModal()`/`close()` individual de los ~9 diálogos). La primera versión hacía
que ese observer llamara a `requestBack()` al detectar el cierre — pero eso dispara
`closeTopLayer()` de nuevo, que ya no encuentra el diálogo (recién se cerró) y pasa a
cerrar **la capa de abajo por error** (por ejemplo, la cámara o la carpeta), sin que
el usuario lo haya pedido. Encontrado probando "cerrar un diálogo con su Cancelar
nativo, después mirar qué pasa" en el Browser pane. Se corrigió separando dos casos:
si `closeTopLayer()` fue quien cerró el diálogo (gesto del sistema), un flag
(`closingDialogFromHistory`) le dice al observer que no haga nada más; si el diálogo
se cerró por su cuenta (botón propio), el observer sólo sincroniza el contador hacia
atrás (`suppressNextPop` + `history.back()`) sin pedir un cierre adicional.

**"Registros" (barra inferior) puede saltar varios niveles a la vez**: a diferencia
de los demás botones (que cierran exactamente un nivel), tocar "Registros" desde
varias carpetas anidadas o desde el editor de marcado tiene que volver directo al
inicio. `history.go(-N)` consume todas esas entradas de una vez — comprobado que
dispara un único evento `popstate` al llegar (no uno por cada nivel intermedio) — así
que `goHome()` resincroniza el contador de inmediato y usa el mismo flag
`suppressNextPop` para que ese único `popstate` no dispare un cierre adicional.

**Verificado en el Browser pane** simulando el botón atrás con `history.back()` (que
dispara el mismo evento `popstate` que usa el gesto/botón real de Android en una PWA
instalada — mecanismo estándar de la plataforma, no específico de este código):
- Dos niveles de subcarpeta → dos "atrás" del sistema → sube exactamente un nivel
  cada uno.
- Foto abierta dos carpetas adentro → un "atrás" → vuelve a la carpeta (el caso que
  reportó el usuario), no cierra la app.
- Cámara abierta → cambiar de lente/cámara (reopen) no suma profundidad → un "atrás"
  → cierra la cámara y vuelve a la carpeta.
- Editor de marcado → un "atrás" → vuelve al detalle de la foto → otro "atrás" →
  vuelve a la carpeta.
- Diálogo cerrado con su botón "Cancelar" nativo vs. cerrado con el gesto del sistema
  → ambos caminos dejan el contador exactamente igual, sin cerrar nada de más.
- "Registros" desde tres niveles de profundidad → un único evento `popstate`, sin
  historial fantasma (confirmado: un "atrás" posterior en el home ya sale de la app,
  como corresponde en la pantalla raíz).

**Pendiente de confirmar por el usuario**: el mecanismo (`pushState`/`popstate`) es
el estándar de la plataforma para este problema y se probó exhaustivamente disparando
los mismos eventos que el sistema real dispara, pero la app no puede simular el gesto
físico de Android ni el botón de navegación on-screen desde este entorno — falta que
el usuario confirme en su teléfono.

**Dónde vive**: `app.js`, bloque final antes de `init()` — `pushBackLayer()`,
`requestBack()`, `closeTopLayer()`, el listener de `popstate`, y los
`MutationObserver` por diálogo. Integrado en `openCameraFor()`, `flipCamera()`,
`selectLens()`, `openDetail()`, `openEditorForPhoto()`, `goHome()`, y los botones que
antes cerraban vistas directamente.

---

## 25. Exportar una carpeta se lleva sus subcarpetas; la barra de selección es un
     "contextual action mode"

**Decisión (exportación)**: exportar una carpeta incluye **todo su contenido
anidado**, no sólo sus fotos directas. Se agregó por tres vías:
- Menú ⋮ de la carpeta → "Exportar (con subcarpetas)", que arma el zip sin pasar por
  el diálogo (camino directo, un toque).
- Barra de selección múltiple → acción "Exportar" (varias carpetas a la vez).
- En el diálogo de exportación, tildar una carpeta **arrastra a todas sus
  subcarpetas** (`change` delegado que cascadea sobre `descendantIds()`), y cada línea
  ahora dice cuántas fotos propias tiene y cuántas suma en subcarpetas
  ("1 + 3 en subcarpetas").

**Por qué**: el usuario reportó que tenía que exportar "una por una". La causa: el
diálogo listaba las carpetas en jerarquía pero los checkboxes eran independientes, y
`confirmExport` filtraba por `photo.folderId ∈ seleccionadas` — coincidencia exacta,
sin descendientes. Tildar "Manzana 3" bajaba sólo sus fotos directas y las de
"Manzana 3 / Vivienda 1" quedaban afuera, sin ningún aviso de que faltaban. Peor: la
jerarquía visible en la lista sugería lo contrario.

**Se mantuvo la coincidencia exacta en `confirmExport`** (no se cascadea al momento de
exportar) **a propósito**: el cascadeo ocurre al tildar, así que lo que se exporta es
siempre exactamente lo que el usuario ve tildado. Si el cascadeo pasara al momento de
exportar, destildar una subcarpeta puntual mientras el padre queda tildado sería
imposible — y ese caso (bajar una manzana entera menos un baño) es legítimo.

---

**Decisión (barra de selección)**: la barra que aparece al mantener presionada una
carpeta o foto pasó de una fila de enlaces de texto a un panel de dos filas, siguiendo
el "contextual action mode" de Android: arriba, botón de cerrar (✕) + cuántos ítems
hay seleccionados + "Seleccionar todo"/"Quitar todo"; abajo, las acciones como
íconos con etiqueta, repartidos en el ancho (mismo lenguaje visual que la barra de la
cámara y la navegación inferior).

**Por qué**: el usuario lo describió como "muy simple y no se ve muy desarrollado".
Además de lo visual, faltaban dos cosas funcionales que el patrón nativo sí tiene:
seleccionar todo de una (antes había que tocar cada ítem) y salir con el gesto atrás.

**"Todo" se lee del DOM, no del modelo** (`visibleFolderIds()`/`visiblePhotoIds()`
consultan `.view.active`): así "Seleccionar todo" siempre coincide con lo que el
usuario tiene en pantalla — las carpetas del nivel abierto, o los resultados de la
búsqueda si está filtrando — sin duplicar en otra función la lógica de qué se está
mostrando.

**El modo selección es ahora una capa del historial** (completa la decisión #24, que
lo había dejado explícitamente afuera): entrar empuja una entrada, y `closeTopLayer()`
lo cierra **antes** que la pantalla de abajo, así el gesto atrás sale de la selección
en vez de salir de la carpeta. Salir por cualquier otra vía (✕, "Quitar todo",
terminar un borrado/movimiento/exportación) consume esa entrada con el mismo par de
banderas que ya usaban los diálogos (`closingSelectionFromHistory` para "vino del
historial, no toques nada más" / `suppressNextPop` para "consumí la entrada sin
disparar otro cierre"). `goHome()` limpia el estado de selección a mano porque su
`history.go(-N)` se lleva esa capa junto con todas las demás de un solo salto.

**Nota sobre las pruebas**: los `.click()` sintéticos sin `pointerdown` previo dejan
activa la bandera `longPressTriggered` y hacen que el siguiente toque se trague — es
un artefacto del arnés, no un bug (un toque real siempre dispara `pointerdown`
primero, que la resetea). Ya había pasado en la sesión 7; las pruebas de selección
múltiple tienen que simular el toque completo.

**Dónde vive**: `index.html` — `#folderSelectBar`/`#photoSelectBar` (nueva
estructura), acción `export` en `#folderActionsDialog`. `styles.css` — bloque
`.select-bar`. `app.js` — `visibleFolderIds()`, `visiblePhotoIds()`,
`syncSelectionExit()`, `photosUnder()`, `runExport()`, `exportFolders()`, el
listener `change` de `#exportFolderList`, y los cambios en `toggleFolderSelection()`,
`togglePhotoSelection()`, `exitFolderSelectMode()`, `exitPhotoSelectMode()`,
`closeTopLayer()` y `goHome()`.
