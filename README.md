# Manga Reader — Frontend

PWA en HTML/CSS/JavaScript vanilla (sin framework ni build step) para buscar, leer y descargar manga, con soporte offline completo y un lector adicional de libros electrónicos (EPUB/PDF). Consume el manga desde la API pública [jimov-api](https://jimov-api.vercel.app) (indexa InManga) y usa el [backend de Manga Reader](../manga-reader-back) para cuentas, favoritos, progreso, proxy de imágenes y notificaciones push.

## Stack

- HTML/CSS/JS sin build step — cada página `<script>`-incluye directamente los módulos que necesita, sin bundler ni transpilador.
- **Service Worker** (`sw.js`) para precache del app shell y descargas de capítulos en segundo plano.
- **IndexedDB** (`js/offline-db.js`) para el almacén offline de mangas, capítulos y libros.
- Librerías vendorizadas en `js/vendor/`: `epub.min.js` + `jszip.min.js` (lector EPUB), `pdf.min.js` + `pdf.worker.min.js` (lector PDF, PDF.js), `qrcode.js` (generación de QR para el login por TV).
- Google Fonts (Zilla Slab + JetBrains Mono), cargadas de forma no bloqueante (`media="print" onload`).

## Ejecutar

No requiere build. Cualquier servidor estático sirve:

```bash
npx http-server -p 8036
```

O con Docker (`Dockerfile` incluido, imagen `node:20-alpine` + `http-server`):

```bash
docker build -t manga-reader-front .
docker run -p 8036:8036 manga-reader-front
```

La URL del backend está hardcodeada como `const back = "https://..."` al principio de cada script que la necesita (`auth.js`, `index.js`, `manga-detalle.js`, `chapter.js`, `libros.js`, `libro-lector.js`) — para apuntar a otro backend (p. ej. local) hay que cambiarla ahí, en cada uno de esos ficheros.

## Estructura

```
index.html              Búsqueda + favoritos (página de entrada)
pages/
  manga-detalle.html     Ficha de un manga: sinopsis, lista de capítulos, favorito
  chapter.html           Lector de un capítulo (online)
  libros.html             Biblioteca de libros electrónicos
  libro-lector.html       Lector de EPUB/PDF
  offline.html            Grid de mangas descargados
  offline-manga.html      Capítulos descargados de un manga
  offline-chapter.html    Lector de un capítulo descargado
  pair.html               Confirmación de login por QR (lado móvil)
js/                       Un módulo por responsabilidad (ver abajo)
css/                      base.css + una hoja por página/sección + tv-mode.css + dark-theme.css
sw.js                     Service Worker: precache + descargas en background + push
manifest.json             Manifest de la PWA
downloads/                Instaladores empaquetados (Electron/Capacitor) enlazados desde el menú
```

### Módulos JS principales

| Fichero | Responsabilidad |
|---|---|
| `settings.js` | Preferencias en `localStorage` (tema, modo de lectura, modo de paso de página) |
| `tv-mode.js` | Detecta Smart TV (sin puntero) y activa estilos/navegación por mando |
| `auth.js` | Login/registro, cambio de contraseña forzoso, invitaciones, login por QR |
| `index.js` | Página de búsqueda: sesión, búsqueda de mangas, favoritos, modal de ajustes |
| `manga-detalle.js` | Ficha de manga: lista de capítulos, selección múltiple (long-press), marcar leído, descargar |
| `chapter.js` / `offline-chapter.js` | Lector de capítulo online / descargado |
| `chapter-image-loader.js` | Render de imágenes de capítulo con reintento si falla la carga |
| `reading-mode.js` | Modo de lectura paginado vs. scroll continuo, gestos swipe/edge-click |
| `reading-progress.js` | Guarda y restaura la posición de lectura dentro de un capítulo (solo local) |
| `offline-db.js` | Capa IndexedDB (mangas, capítulos, jobs de descarga, libros) |
| `download-manager.js` | Widget flotante de descargas activas; sincroniza con el Service Worker / Background Fetch, y expone una vía "genérica" para descargas orquestadas desde la propia página (p. ej. descarga de una colección de libros completa) |
| `service_worker_register.js` | Registro del SW + suscripción a notificaciones push |
| `offline.js` / `offline-manga.js` | Grids de contenido descargado (mangas / capítulos de un manga) |
| `libros.js` | Biblioteca de libros: navegación por colecciones anidadas, estante de "lecturas en curso", filtros (nombre/estado/colección), fusión online+offline, selector de portada (admin), rescan de la biblioteca (admin) |
| `libro-lector.js` | Lector EPUB (epub.js) y PDF (PDF.js) con progreso sincronizado con el backend |
| `book-cover.js` | Genera una portada placeholder por `<canvas>` a partir del título, cuando no hay una elegida |
| `pair.js` | Lado móvil del login por QR |
| `tv-chapter-nav.js` | Navegación por imágenes/páginas con las flechas del mando en modo TV |
| `reader-size-control.js` | Control de zoom de las imágenes del lector |

## Funcionalidades

- **Búsqueda y lectura de manga** vía jimov-api/InManga, con favoritos y capítulos marcados como leídos sincronizados al backend por cuenta.
- **Selección múltiple por pulsación larga** en la lista de capítulos, para marcar como leídos o descargar varios de una vez; además de un atajo "marcar leído hasta el capítulo N".
- **Modo de lectura**: scroll continuo (por defecto) o paginado (una imagen a la vez), con paso de página por *swipe* (arrastre/rueda horizontal) o clic en los bordes — configurable en Ajustes. La posición de lectura se recuerda por capítulo (solo local).
- **Descarga de capítulos para lectura offline**: el propio Service Worker ejecuta la descarga (sobrevive a navegar a otra página), con una capa de mejora vía **Background Fetch** (Chromium/Android) que además sobrevive a cerrar la app del todo. Las descargas de varios capítulos a la vez fuerzan la capa base, para no disparar el aviso nativo de "descarga de varios archivos" de Chrome.
- **PWA offline real**: el `sw.js` precachea el app-shell completo (CSS, JS, páginas offline-capables) en el `install`; cualquier navegación sin red cae a caché o, en última instancia, a `offline.html`. El backend/InManga nunca se cachean (siempre red primero cuando hay conexión).
- **Biblioteca de libros electrónicos (EPUB/PDF)**, organizada en colecciones (carpetas) que pueden contener más colecciones o libros, n niveles:
  - Navegación jerárquica con breadcrumb, o una lista plana de resultados de toda la biblioteca en cuanto se usa el buscador o cualquier filtro (por nombre, por etiqueta de estado — sin leer/en progreso/terminado — o por colección).
  - Un estante fijo de "lecturas en curso" arriba de la página, con todos los libros en progreso de cualquier colección, independiente de la navegación o los filtros activos.
  - Lector con progreso sincronizado con el backend (a diferencia del progreso de manga, que es solo local), descarga individual o de una colección completa para lectura offline, índice de capítulos/tabla de contenidos, ir a página (PDF).
  - Portada elegida por un admin (para un libro o para una colección entera) vía búsqueda en Open Library, o generada por `<canvas>` si no hay ninguna.
  - Un admin puede forzar un reescaneo de la biblioteca desde el menú (asíncrono, con aviso de cuándo fue la última actualización) tras reorganizar los ficheros en el servidor.
- **Notificaciones push** (Web Push/VAPID): nuevo capítulo de un favorito, disponibilidad de InManga.
- **Modo Smart TV**: detección automática (sin puntero, o user-agent de TV conocido), navegación 100% por mando (foco con Enter/Espacio, flechas para pasar de imagen/página), login por QR en vez de teclear usuario/contraseña.
- **Tema claro/oscuro**, sincronizado con el backend como preferencia de cuenta.
- **Instaladores de escritorio/móvil**: el menú enlaza directamente a un `.exe` (Electron) y un `.apk` (Capacitor) en `downloads/`.

## Autenticación (cliente)

Sesión basada en JWT guardado en `localStorage` (`token`, `user`, `isAdmin`). Cada página protegida valida el token contra `/validate_token` al cargar y redirige a `index.html` si no es válido. El login soporta usuario+contraseña o, en modo TV, emparejamiento por QR con un móvil ya logueado (`pair.html` + polling contra `/pair/status/:id`).

## Notas de seguridad relevantes en el código

- La sinopsis del manga (viene de una API de terceros sin sanear) se inyecta con `textContent`, nunca `innerHTML`, para evitar XSS si esa API alguna vez devolviera HTML/script.
- `/subscribe` (notificaciones push) exige sesión válida desde el lado del backend; el cliente manda el token guardado.
- El proxy de imágenes (`/proxy` del backend) siempre se llama con el token del usuario — nunca se piden imágenes directamente a InManga desde el navegador.

## Notas

- No hay tests automatizados ni CI configurados en este repo.
- Sin build step: los cambios en JS/CSS/HTML se sirven tal cual; no hay minificación ni bundling.
