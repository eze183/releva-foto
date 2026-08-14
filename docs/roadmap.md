# Roadmap

> **Este archivo se actualiza al cerrar cada funcionalidad importante.** Ver
> `docs/session-summary.md` para la bitácora cronológica de qué se hizo en cada
> sesión. Este archivo es el estado *actual* — resume qué está hecho, qué falta y qué
> ideas quedaron abiertas sin comprometerse a implementarlas.

_Última actualización: sesión del 10/08/2026 (rediseño del flujo — cámara en ráfaga,
marcado diferido, carpetas con id propio y menú ⋮, buscador)._

## Estado actual — qué está implementado y verificado

- [x] **Cámara en modo ráfaga**: la cámara no se cierra al disparar. Cada foto se
      guarda sola en la carpeta activa con nombre automático (`"<Carpeta> - 001"`),
      con flash, contador y tira de miniaturas en la superposición. No hay formulario
      antes de guardar — el ritmo de captura es un toque por foto.
- [x] Cámara **dentro de la app** (`getUserMedia`, `<video>` en vivo + disparo), con
      fallback al `<input capture>` nativo si no hay soporte o se niega el permiso.
      Resuelve el bug de pérdida de fotos en Android (ver `docs/decisions.md`).
- [x] Importar **varias** fotos de la galería del teléfono a la vez, con progreso
      ("Importando 3 de 24..."), orden por fecha de captura para que la numeración
      quede cronológica, y descarte de lo que no sea imagen.
- [x] Marcado sobre la foto con canvas: flecha, recuadro, texto y trazo libre. **Las
      cuatro herramientas son objetos editables** — tocarlos los selecciona (aparecen
      manijas), arrastrar el cuerpo los mueve, arrastrar una manija los ajusta
      (flecha: longitud/dirección de cada extremo; recuadro: tamaño desde cualquier
      esquina; texto: tamaño de letra; el trazo libre se mueve pero no se
      redimensiona), mantener presionado sin mover borra con confirmación.
      "Deshacer" quita la última marca agregada, sea del tipo que sea. Cada
      herramienta es de un solo uso — se desactiva sola después de agregar una marca.
- [x] **Marcar una foto ya guardada, cuantas veces haga falta**: la foto conserva el
      original sin marcas (`originalBlob`) y la lista de marcas (`marks`), así que
      volver a "Marcar" reabre el editor con todo editable y sin acumular pérdida de
      calidad JPEG.
- [x] Almacenamiento en **IndexedDB** (fotos como `Blob`), con migración automática
      desde `localStorage` y desde el formato anterior de carpetas por nombre.
- [x] Editar nombre y nota de una foto guardada; moverla de carpeta desde la
      selección múltiple.
- [x] **Notas en dos niveles, texto libre**: nota de carpeta (contexto de todo el
      conjunto, bloque fijo arriba de la vista de carpeta y línea en su tarjeta) y
      nota de foto. Las fotos con nota se distinguen en la grilla (marca sobre la
      miniatura + la nota como subtítulo), la nota del detalle es el botón que abre su
      propia edición, y al editar aparecen **notas rápidas**: chips con lo que el
      usuario ya escribió, ordenados por frecuencia, para repetir con un toque.
      Ambas notas entran en el buscador y en la exportación (columnas del CSV, y la
      nota de carpeta también como `_nota.txt` dentro de su carpeta en el zip).
- [x] **Carpetas con id propio** (`{id, name, parentId}`): se puede repetir el mismo
      nombre en padres distintos ("Vivienda 1" en dos manzanas) y renombrar es
      instantáneo. La unicidad se valida entre carpetas hermanas.
- [x] **Crear carpeta sin desplegable de jerarquía**: un solo campo, el nombre. El
      padre lo define desde dónde se creó (home = nivel principal, dentro de una
      carpeta = subcarpeta de esa).
- [x] **Menú ⋮ en cada tarjeta de carpeta**: renombrar, crear subcarpeta, mover y
      eliminar en un solo lugar. **No hay carpeta por defecto ni carpetas
      protegidas**: la app arranca vacía y toda carpeta se puede renombrar, mover y
      eliminar. Eliminar se lleva sus subcarpetas y sus fotos, con un aviso que dice
      exactamente cuánto se pierde (para conservarlas hay que moverlas antes).
- [x] **Subcarpetas anidadas**: las carpetas forman una jerarquía real (no una lista
      plana), con navegación "subir un nivel" y modo de selección múltiple
      (mantener presionada una carpeta) para mover varias a la vez dentro de otra,
      con protección contra ciclos (no se puede mover una carpeta dentro de sí misma
      o de su propia subcarpeta).
- [x] **Buscador** en la pantalla principal por nombre de carpeta, nombre de foto y
      nota, con la ruta completa de cada resultado.
- [x] Navegación por carpetas: la pantalla principal lista carpetas de nivel
      principal (con conteo recursivo incluyendo subcarpetas), hay que entrar a una
      para ver sus subcarpetas y fotos.
- [x] Cámara con zoom táctil (pinch): usa el zoom de hardware del sensor cuando el
      dispositivo lo soporta (`MediaStreamTrack.applyConstraints`), con fallback a
      zoom digital (`transform:scale()` sobre el video) cuando no. El zoom digital
      **se refleja en la foto guardada** (el frame se recorta al capturar).
- [x] **Selector de lente trasero** (gran angular / normal / teleobjetivo): aparece
      sólo si el teléfono expone sus cámaras traseras con etiquetas distinguibles
      (`enumerateDevices()`). La elección se recuerda entre sesiones y si el lente
      guardado deja de existir, cae de nuevo al comportamiento por defecto sin
      romper la apertura de la cámara. **Falta confirmar en un teléfono real** si
      Chrome expone las etiquetas con claridad suficiente (no se pudo probar contra
      hardware desde este entorno, sólo con cámaras mockeadas).
- [x] **Visor de foto a pantalla completa**, como la galería nativa de Android: tocar
      una foto la abre ocupando el 100% del viewport, fondo negro, controles en
      barras flotantes con degradé arriba (volver, eliminar) y abajo
      (carpeta/nombre/nota/fecha, Marcar, Datos). La foto **se ve completa**
      (`object-fit:contain`), no recortada. Editar nombre/nota es un diálogo aparte.
      Zoom táctil: pellizco para ampliar, arrastre de un dedo para paneo, doble tap
      para alternar 1x/2.5x — el clamp de paneo calcula los bordes reales de la foto
      dentro del recuadro para no dejar panear hacia una franja vacía. Implementado a
      mano porque el pinch-zoom nativo de la página queda deshabilitado al correr la
      app instalada como PWA (ver `docs/decisions.md`).
- [x] Selección múltiple de fotos dentro de una carpeta (mantener presionada una):
      mover, copiar o eliminar varias a la vez.
- [x] Exportar a `.zip` (JSZip vendorizado, sin CDN) con selección de qué carpetas
      incluir (checkboxes, todas tildadas por defecto) — respeta la **jerarquía real
      de subcarpetas** en las rutas del zip y agrega un `registro.csv`. Comparte vía `navigator.share` si está disponible, si
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

- [ ] Ritmo real de la ráfaga en el teléfono: cada disparo escribe un `Blob` en
      IndexedDB antes de habilitar el siguiente. En el Browser pane no se pudo medir
      el tiempo real (la pestaña oculta limita los timers a 1s), así que falta
      confirmar en el teléfono que se pueden encadenar disparos sin sentir espera.
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

- [ ] Cambiar/reordenar el orden de las carpetas en la pantalla principal (hoy siguen
      el orden de creación).
- [ ] Renumerar/renombrar en lote las fotos de una carpeta (hoy renombrar la carpeta
      no toca el nombre de las fotos que ya tenía — ver decisión #16).
- [ ] Recuperar el espacio de `originalBlob` de fotos marcadas hace mucho ("aplanar"
      una foto para liberar el original a costa de perder la re-edición).
- [ ] Deshacer un movimiento o un borrado de anotación (hoy "Deshacer" sólo quita la
      última marca agregada, no revierte un ajuste).
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
