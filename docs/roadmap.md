# Roadmap

> **Este archivo se actualiza al cerrar cada funcionalidad importante.** Ver
> `docs/session-summary.md` para la bitácora cronológica de qué se hizo en cada
> sesión. Este archivo es el estado *actual* — resume qué está hecho, qué falta y qué
> ideas quedaron abiertas sin comprometerse a implementarlas.

_Última actualización: sesión del 24/07/2026 (zoom de cámara, fotos a color,
subcarpetas anidadas, mover/borrar/renombrar carpetas)._

## Estado actual — qué está implementado y verificado

- [x] Registro fotográfico con nombre automático ("Foto vivienda n°X, manzana Y"),
      nota, carpeta y fecha.
- [x] Cámara **dentro de la app** (`getUserMedia`, `<video>` en vivo + disparo), con
      fallback al `<input capture>` nativo si no hay soporte o se niega el permiso.
      Resuelve el bug de pérdida de fotos en Android (ver `docs/decisions.md`).
- [x] Selección desde galería del teléfono (`<input type="file">`).
- [x] Marcado sobre la foto con canvas: flecha, recuadro, texto, trazo libre,
      deshacer, selector de color (5 colores).
- [x] Almacenamiento en **IndexedDB** (fotos como `Blob`), con migración automática
      desde la versión anterior en `localStorage`.
- [x] Editar nombre/carpeta/nota de una foto ya guardada.
- [x] Crear carpetas desde el formulario de agregar foto, la pantalla principal **y**
      desde dentro de otra carpeta (como subcarpeta); renombrar y borrar carpetas
      (excepto "General", protegida a propósito); borrar una carpeta reasigna sus
      fotos directas a "General" y promueve sus subcarpetas un nivel.
- [x] **Subcarpetas anidadas**: las carpetas forman una jerarquía real (no una lista
      plana), con navegación "subir un nivel" y modo de selección múltiple
      (mantener presionada una carpeta) para mover varias a la vez dentro de otra,
      con protección contra ciclos (no se puede mover una carpeta dentro de sí misma
      o de su propia subcarpeta).
- [x] Navegación por carpetas: la pantalla principal lista carpetas de nivel
      principal (con conteo recursivo incluyendo subcarpetas), hay que entrar a una
      para ver sus subcarpetas y fotos. Agregar una foto desde adentro de una
      carpeta precarga esa carpeta en el formulario.
- [x] Cámara con zoom táctil (pinch), usando el zoom de hardware del sensor cuando el
      dispositivo lo soporta (`MediaStreamTrack.applyConstraints`).
- [x] Exportar a `.zip` (JSZip vendorizado, sin CDN) con selección de qué carpetas
      incluir (checkboxes, todas tildadas por defecto) — organiza por subcarpeta y
      agrega un `registro.csv`. Comparte vía `navigator.share` si está disponible, si
      no descarga directo.
- [x] PWA instalable: manifest con íconos propios (generados con
      `scripts/generate-icons.js`, sin dependencias), service worker con
      precache + `skipWaiting`/`clients.claim()` para que las actualizaciones no
      requieran cerrar la app del todo (sólo un reload).
- [x] Funciona **100% offline** una vez visitada la primera vez: JSZip y la tipografía
      Archivo están vendorizados y precacheados, no dependen de CDN/Google Fonts en
      tiempo de uso.
- [x] Publicada en GitHub Pages (`https://eze183.github.io/releva-foto/`), con deploy
      automático vía GitHub Actions en cada push a `master`.
- [x] Diseño "Modernist" (acento rojo, esquinas rectas, tipografía Archivo) aplicado
      a toda la UI. Las fotos se ven a color (el filtro de escala de grises de la
      sesión 1 se sacó a pedido del usuario en la sesión 4).

## Pendiente de confirmar por el usuario

- [ ] Uso real en el campo con la cámara in-app: se verificó con un `getUserMedia`
      mockeado (canvas → `captureStream()`) en el Browser pane, y el usuario confirmó
      que el fix resuelve el síntoma reportado, pero falta una sesión larga de uso
      real (muchas fotos seguidas, distintos teléfonos Android) para confirmar que no
      queda ningún caso borde de pérdida de fotos.
- [ ] Confirmar que la resolución de captura in-app (ideal 2560×1440, la del stream de
      video, no la del sensor completo) es suficiente para el detalle que necesita el
      usuario al hacer zoom en una patología — es una elección del desarrollador, no
      medida contra una foto real del usuario en uso.
- [ ] La verificación del precache offline (`cache.addAll` del service worker) tuvo un
      comportamiento inconsistente en el Browser pane de la última sesión (ver nota en
      `docs/decisions.md`) — el código y el listado de archivos están verificados por
      otras vías, pero no está de más que el usuario confirme una vez en su teléfono
      que la app abre en modo avión después de haberla usado con conexión.

## Ideas mencionadas pero no implementadas

- [ ] Búsqueda por texto (nombre, vivienda, manzana, nota) — no se pidió todavía, sólo
      se mencionó como posible mejora futura al principio del proyecto.
- [ ] Re-anotar una foto ya guardada (hoy sólo se puede editar nombre/carpeta/nota de
      una foto guardada, no volver a abrir el editor de marcado sobre ella).
- [ ] Cambiar/reordenar el orden de las carpetas en la pantalla principal (hoy siguen
      el orden de creación).
- [ ] Exportar directamente a PDF además de `.zip` (el proyecto hermano `app informes`
      ya tiene un motor de maquetado A4 con `jsPDF` que podría servir de referencia si
      esto se llegara a pedir).
- [ ] Cualquier forma de sincronizar entre dispositivos — no se pidió y rompería la
      promesa de "todo local" que tiene la app hoy (sin backend).

## Limitaciones conocidas (no son bugs, son decisiones o restricciones del entorno)

- No hay tests automatizados. La verificación se hace manualmente en el Browser pane
  (mockeando `getUserMedia`, IndexedDB, service worker) y, para los cambios visuales o
  de hardware real (cámara física, instalación de PWA), en el teléfono del usuario.
- No hay build ni `package.json`: es HTML/CSS/JS vanilla a propósito, servido tal cual
  por `test-server.js` en desarrollo y por GitHub Pages en producción. Cualquier
  librería pesada (JSZip, la fuente Archivo) se vendoriza como archivo estático en vez
  de agregar una dependencia npm.
- El repo es público en GitHub (`eze183/releva-foto`) porque GitHub Pages gratis lo
  requiere — el código fuente es visible, pero ninguna foto del usuario se sube nunca
  a ningún lado (vive sólo en IndexedDB del navegador de cada dispositivo).
