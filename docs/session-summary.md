# Bitácora de sesiones

> **Se actualiza al cerrar cada funcionalidad importante**, junto con `docs/roadmap.md`
> y, si hubo una decisión de arquitectura o diseño relevante, `docs/decisions.md`.
>
> A diferencia del proyecto hermano `app informes` (que no es un repo git), **este
> proyecto sí tiene historial de git** desde el 17/07/2026 — las fechas de abajo son
> las reales de `git log`, no `mtime` del filesystem. El trabajo previo a esa fecha
> (armado inicial del prototipo vanilla JS) no tiene commits propios porque el repo se
> inicializó recién cuando se decidió publicarlo.

---

## Sesión 1 — Robustez de datos + diseño Modernist + publicación (17/07/2026)

**Disparador**: la app ya existía como prototipo vanilla JS (`index.html`/`app.js`/
`styles.css`/`sw.js`) con paleta verde/lima, guardando todo en `localStorage` como
base64. El usuario pidió primero una etapa de mejoras de robustez, y en la misma
jornada trajo un diseño hecho en "Claude Design" para aplicar a la app real, y luego
pidió publicarla para uso real (no sólo local).

**Se hizo**:
- Migración de almacenamiento de `localStorage` a **IndexedDB**, con las fotos como
  `Blob` (no base64) y migración automática y silenciosa de los datos viejos al
  primer arranque (`migrateFromLocalStorage()` en `app.js`).
- Edición de nombre/carpeta/nota de una foto ya guardada, y borrado de carpetas
  (reasigna sus fotos a "General").
- Manejo de errores básico (`showError()`) en lectura de imagen y operaciones de
  IndexedDB, en vez de fallar en silencio.
- Íconos PWA reales (192/512/512-maskable) generados con un script Node propio sin
  dependencias (`scripts/generate-icons.js`, PNG codificado a mano con `zlib` de la
  stdlib) — no había ImageMagick/Inkscape disponibles y el proyecto no tiene
  `package.json`.
- **Bug encontrado y corregido**: en `styles.css`, `.details-form{display:flex}`
  empataba en especificidad con la regla nativa `[hidden]{display:none}` y ganaba por
  orden de cascada — el atributo `hidden` no ocultaba nada. Se agregó
  `.details-form[hidden]{display:none}`.
- Aplicación del diseño "Modernist" traído por el usuario (prototipo exportado como
  `.dc.html` + design system de referencia): paleta roja (`--accent:#ec3013`) sobre
  fondo crudo (`--bg:#f3f2f2`), tipografía Archivo, esquinas rectas en todo
  (`--radius:0` de facto, sin `border-radius` en ningún componente), dividers de 2px,
  fotos en escala de grises (`filter:grayscale(1) contrast(1.08)`, elección
  intencional), íconos SVG inline estilo feather en vez de glifos de texto/emoji. Se
  implementó de paso el filtro de carpeta funcional (el botón "Todas las carpetas" no
  hacía nada hasta ese momento) porque ya venía resuelto en el diseño de referencia.
- **Publicación real**: se inicializó git (no existía hasta este punto), se armó
  `.github/workflows/deploy.yml` (GitHub Actions → GitHub Pages, sin necesitar `gh`
  CLI), y se activó Pages en el repo `eze183/releva-foto`. Primer despliegue falló
  (`configure-pages` corrió antes de que el usuario activara Pages en la config del
  repo); se resolvió re-corriendo el workflow manualmente
  (`workflow_dispatch`, ya habilitado). Quedó publicada en
  `https://eze183.github.io/releva-foto/`.

**Resultado**: app usable de verdad, con HTTPS real (necesario para PWA instalable e
IndexedDB robusto), verificada en el teléfono del usuario ("funciona bien").

---

## Sesión 2 — Exportar el relevamiento a `.zip` (21/07/2026)

**Disparador**: el usuario preguntó dónde quedan guardadas las fotos y cómo sacarlas
a una PC — no había ninguna forma de exportar. Pidió poder exportar todo de una, o
por partes.

**Se hizo**:
- Exportación a `.zip` con **JSZip vendorizado localmente** (`vendor/jszip.min.js`,
  ~95KB, MIT) en vez de por CDN, y cargado de forma diferida (inyectando un
  `<script>` recién al tocar "Exportar") — la app es offline-first, no puede depender
  de bajar una librería del CDN en el momento.
- El `.zip` trae una subcarpeta por carpeta exportada (con las fotos ya "quemadas",
  sin volver a renderizar nada) más un `registro.csv` (nombre/carpeta/nota/fecha, con
  BOM UTF-8 para que Excel abra bien los acentos).
- `navigator.share` con archivos si el navegador lo soporta (panel nativo del
  teléfono); si no, descarga directa con `<a download>` (caso típico: PC de
  escritorio).
- Primera versión: el scope de exportación se decidía por el filtro de navegación
  (`state.activeFolder`) — "todas las carpetas" exportaba todo, filtrar por una
  exportaba sólo esa. El usuario probó y pidió poder **combinar varias carpetas a la
  vez**, algo que un filtro de selección única no permite.
- Se separó el scope de exportación del filtro de navegación: un diálogo nuevo
  (`#exportDialog`) con un checkbox por carpeta (todas tildadas por defecto, así un
  solo toque sigue exportando todo) reemplazó la dependencia del filtro.
- Bump de `sw.js` de v4 a v5 (aprendizaje de esta sesión: **si `sw.js` no cambia de
  contenido, el navegador no revisa actualizaciones** — hay que bumpear la constante
  `CACHE` en cada cambio de assets, si no los que ya instalaron la PWA no reciben
  nada).

**Resultado**: exportación completa y funcional, con selección granular por carpeta.

---

## Sesión 3 — Navegación por carpetas, cámara in-app, offline completo (22/07/2026)

**Disparador**: tres pedidos del usuario en la misma jornada: (1) que la pantalla
principal muestre carpetas en vez de fotos sueltas, entrando a una para verlas; (2)
un bug real — usando la cámara del teléfono (Android), de 4 intentos sólo 1 guardaba
la foto; (3) poder crear carpetas desde la pantalla principal.

**Se hizo**:
- **Navegación por carpetas**: la pantalla principal (`galleryView`) pasó de listar
  fotos a listar tarjetas de carpeta con su conteo (`renderFolderGrid()`); se agregó
  `folderView` (nueva vista) para ver las fotos de una carpeta puntual. Se sacó el
  filtro de carpeta (ya no hace falta, la navegación lo reemplaza). `state.activeFolder`
  se resignificó de "filtro activo" a "carpeta que se está mirando ahora", y se
  aprovechó para precargar esa carpeta al agregar una foto nueva desde adentro
  (`openCapture(state.activeFolder)`) y para volver al lugar correcto al guardar,
  editar o borrar una foto. De paso se corrigió un bug preexistente en `showView()`:
  el resaltado del bottom-nav marcaba "Agregar" como activo incluso en
  `detailView`/`editorView`.
- **Cámara dentro de la app** (el fix del bug reportado): el método anterior
  (`<input type="file" capture>`) abre la cámara nativa de Android como app aparte;
  el sistema mata Chrome en segundo plano por presión de memoria, y al volver la
  página se recarga de cero, perdiendo la foto — de ahí el "1 de cada 4". Se
  reemplazó por una cámara **in-app** con `getUserMedia` (overlay con `<video>` en
  vivo + botón de disparo), que nunca sale de la página. Cae al `<input capture>`
  original si `getUserMedia` no está disponible o el permiso es denegado. De paso, la
  foto pendiente pasó de guardarse como data URL base64 a **Blob directo** (más
  liviano en memoria).
- **Fuente offline**: la tipografía "Archivo" se traía de Google Fonts vía `<link>`,
  no cacheado por el service worker — sin conexión caía a la fuente del sistema (no
  rompía nada, pero cambiaba el look). Se vendorizaron los 3 `.woff2` necesarios
  (`vendor/fonts/`, cubren los pesos 400-800 con un único archivo variable por rango
  unicode) igual que se hizo con JSZip.
- **Crear carpeta desde la pantalla principal**: antes sólo se podía crear una
  carpeta desde el formulario de agregar foto. Se agregó el mismo botón (reusa el
  diálogo `#folderDialog` ya existente) en la lista de carpetas.
- Cuatro bumps de `sw.js` en esta sesión (v6 a v9), uno por cada cambio de assets.

**Resultado**: navegación jerárquica por carpetas, bug de pérdida de fotos en Android
resuelto de raíz (no un parche), y la app funciona 100% offline desde la primera
carga (excepto la primerísima visita, que necesita red para que el service worker
precachee todo).

---

## Sesión 4 — Zoom de cámara, subcarpetas anidadas y ajustes de carpetas (24/07/2026)

**Disparador**: el usuario probó la app real en el celular y reportó cinco pedidos en
la misma jornada: (1) no se podía hacer zoom en la cámara; (2) no se podían renombrar
carpetas; (3) las fotos se veían en blanco y negro dentro de la app (pero bien al
exportar); (4) quería borrar carpetas desde la pantalla principal manteniendo
presionado; (5) quería un botón de seleccionar/deseleccionar todo en exportar.
Se implementaron los cinco. Al probarlos, el usuario reportó dos problemas nuevos: el
botón de disparo se movía fuera de pantalla al hacer zoom, y pidió poder agrupar
varias carpetas dentro de otra.

**Se hizo**:
- **Fotos a color**: se sacó el filtro `grayscale(1) contrast(1.08)` que aplicaba el
  diseño Modernist a las fotos (preview, grilla, detalle) — era una elección de
  diseño intencional de la sesión 1, pero el usuario prefirió verlas a color en la
  app (igual que se ven al exportar, donde nunca se aplicó el filtro).
- **Renombrar y borrar carpetas**: botón ✎ junto a cada carpeta (excepto "General",
  que se mantiene protegida a pedido explícito del usuario — ver `docs/decisions.md`)
  en el diálogo de carpetas.
- **Zoom de cámara — dos iteraciones**:
  1. Primera versión: zoom por hardware (`videoTrack.applyConstraints({zoom})`)
     controlado con gesto de pinch sobre el `<video>`.
  2. El usuario reportó que el botón de disparo se movía fuera de pantalla al hacer
     zoom. Causa real: `touch-action:manipulation` en el CSS del video permite el
     pinch-zoom **nativo del navegador** (zoom de toda la página) en paralelo al
     zoom por JS — no era un bug de la lógica de zoom, sino que el gesto nativo
     escalaba visualmente toda la superposición de cámara, botón incluido. Se
     corrigió con `touch-action:none` en el video y el overlay completo, más
     `preventDefault()` en los handlers de touch (no-pasivos) como refuerzo.
- **Subcarpetas anidadas**: a pedido del usuario, "mover carpetas dentro de otras" se
  resolvió como jerarquía real (no como fusión de fotos) — las carpetas pasaron de
  lista plana (`["General", "Manzana Test"]`) a lista de objetos
  `{name, parent}`, con migración automática y silenciosa desde el formato viejo
  (tanto en IndexedDB como en la ruta de import desde `localStorage`). Se agregó:
  - Navegación con "subir un nivel" (no directo a home) desde una carpeta anidada.
  - Botón "Crear subcarpeta" dentro de una carpeta, que precarga esa carpeta como
    contenedora.
  - Modo de selección múltiple de carpetas (mantener presionada una entra en el
    modo, tocar otras suma/saca de la selección), con una barra de acciones fija
    abajo: "Mover a...", "Eliminar", "Cancelar".
  - Al mover, el diálogo de destino excluye las carpetas seleccionadas y todos sus
    descendientes (evita crear ciclos, ej. mover "Barrio Norte" dentro de su propia
    subcarpeta "Manzana 3").
  - Al borrar una carpeta con subcarpetas, estas se **promueven un nivel** (pasan a
    ser hijas del padre de la carpeta borrada) en vez de perderse o also borrarse en
    cascada — sus fotos no se tocan. Las fotos directas de la carpeta borrada sí
    pasan a "General", como ya funcionaba antes.
  - "General" queda exenta de selección múltiple, mover y renombrar/borrar — sigue
    siendo la única carpeta protegida (decisión reafirmada explícitamente por el
    usuario en esta sesión, ver `docs/decisions.md`).
- Cuatro bumps de `sw.js` en esta sesión (v10 a v13).

**Resultado**: los cinco pedidos originales resueltos, más una jerarquía de carpetas
real que no existía antes, verificados en el Browser pane (creación de subcarpetas,
navegación multinivel, mover con exclusión de ciclos, borrado con promoción de
hijos, migración desde datos con formato viejo) sin errores de consola.
