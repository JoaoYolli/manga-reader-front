// sw.js

// offline-db.js no toca window/document, es portable tal cual dentro del SW.
importScripts('/js/offline-db.js');

// --- App shell: precache para que la PWA cargue sin conexión -----------
// Antes de esto el SW no cacheaba nada (ni siquiera index.html), así que
// sin red el navegador no podía ni descargar el documento y la lógica de
// redirect a offline.html (en index.js) nunca llegaba a ejecutarse. Ver
// el "Anexo A" del plan para la clasificación completa por página.
const APP_SHELL_CACHE = 'app-shell-v1';

const APP_SHELL_URLS = [
  // Comunes a casi todas las páginas
  '/css/base.css',
  '/css/tv-mode.css',
  '/css/dark-theme.css',
  '/js/settings.js',
  '/js/tv-mode.js',
  '/img/logo.ico',
  '/img/apple-touch-icon.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/manifest.json',

  // Categoría A: ya 100% offline-capables hoy
  '/pages/offline.html',
  '/css/index.css',
  '/js/offline-db.js',
  '/js/download-manager.js',
  '/js/offline.js',

  '/pages/offline-manga.html',
  '/css/manga-detalle.css',
  '/js/offline-manga.js',
  '/img/home.png',

  '/pages/offline-chapter.html',
  '/css/chapter.css',
  '/js/reading-mode.js',
  '/js/reading-progress.js',
  '/js/tv-chapter-nav.js',
  '/js/reader-size-control.js',
  '/js/chapter-image-loader.js',
  '/js/offline-chapter.js',
  '/img/manga.png',

  // Categoría B: dependen del backend/InManga para su contenido, pero su
  // shell debe cargar igual para que su propia lógica de fallback corra.
  '/',
  '/index.html',
  '/js/vendor/qrcode.js',
  '/js/auth.js',
  '/js/service_worker_register.js',
  '/js/index.js',

  '/pages/manga-detalle.html',
  '/js/manga-detalle.js',

  '/pages/chapter.html',
  '/js/chapter.js',

  '/pages/pair.html',
  '/js/pair.js',

  // Categoría C: sección de libros (EPUB/PDF), offline-capable desde el
  // primer día por requisito explícito del usuario.
  '/pages/libros.html',
  '/css/libros.css',
  '/css/libro-lector.css',
  '/js/book-cover.js',
  '/js/libros.js',

  '/pages/libro-lector.html',
  '/js/libro-lector.js',

  // Las librerías vendorizadas del lector (epub.js/pdf.js/jszip, varios
  // cientos de KB en total) se dejan FUERA del precache forzado a propósito
  // — precachearlas en el 'install' compite por el límite de conexiones
  // concurrentes del navegador hacia este mismo origen justo con la carga
  // normal de la página que disparó el primer registro del SW, lo que podía
  // dejar esa primera visita con scripts críticos (p. ej. libros.js)
  // tardando mucho en llegar o sin llegar a tiempo. Se cachean igual, solo
  // que de forma perezosa: la estrategia cache-first-con-relleno del 'fetch'
  // handler de más abajo las guarda la primera vez que el lector las pide de
  // verdad (al abrir un libro), que es el momento en que además hacen falta.
];

const LAZY_VENDOR_URLS = [
  '/js/vendor/jszip.min.js',
  '/js/vendor/epub.min.js',
  '/js/vendor/pdf.min.js',
  '/js/vendor/pdf.worker.min.js',
];

self.addEventListener('install', event => {
  console.log('[SW] Instalado');
  event.waitUntil(
    caches.open(APP_SHELL_CACHE)
      .then(cache => cache.addAll(APP_SHELL_URLS))
      .catch(err => console.error('[SW] Fallo precacheando el app shell:', err))
  );
  self.skipWaiting(); // Opcional: activa inmediatamente
});

self.addEventListener('activate', event => {
  console.log('[SW] Activado');
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key.startsWith('app-shell-') && key !== APP_SHELL_CACHE)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim(); // Toma el control inmediato

  // Precache de las librerías pesadas del lector, deliberadamente aparte del
  // 'install' de arriba (ver comentario en LAZY_VENDOR_URLS) y con un
  // pequeño retraso: así no compiten por conexiones con la carga de la
  // página que disparó este registro, pero igualmente quedan cacheadas al
  // poco rato sin depender de que el usuario abra un libro primero.
  event.waitUntil(
    new Promise(resolve => setTimeout(resolve, 5000))
      .then(() => caches.open(APP_SHELL_CACHE))
      .then(cache => cache.addAll(LAZY_VENDOR_URLS))
      .catch(err => console.warn('[SW] Fallo precacheando librerías del lector (no crítico):', err))
  );
});

// --- fetch: sirve el app shell cacheado cuando no hay red --------------
// Navegaciones: red primero (para no servir contenido desactualizado
// mientras hay conexión), con fallback a caché y, si tampoco hay entrada
// cacheada para esa URL exacta, fallback final a offline.html — así
// cualquier navegación sin red termina en la librería offline en vez del
// error nativo del navegador.
// Resto de peticiones same-origin: cache-first con relleno en segundo
// plano (stale-while-revalidate simple).
// Todo lo demás (backend, /proxy, Background Fetch, Google Fonts) pasa
// sin tocar — el SW no debe interceptar esas peticiones.
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return; // deja pasar cross-origin (backend, fonts, etc.)
  if (request.method !== 'GET') return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(APP_SHELL_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(async () => {
          // ignoreSearch: true es imprescindible aquí — páginas como
          // offline-manga.html?manga=..., offline-chapter.html?manga=...&
          // chapter=... o libro-lector.html?id=... se precachean SIN query
          // string (una sola vez, la URL "base"), pero se navega a ellas
          // siempre CON query string. Sin ignoreSearch, una coincidencia
          // exacta de URL nunca encuentra esa entrada — cae siempre al
          // fallback de offline.html, y desde ahí no hay forma de entrar a
          // ningún capítulo descargado ni libro estando sin conexión, por
          // más que su "shell" sí esté cacheado. El documento navegado
          // conserva su URL real (con query string) aunque el cuerpo servido
          // sea el de la entrada cacheada sin query — el propio JS de la
          // página sigue leyendo location.search con normalidad.
          const cached = await caches.match(request, { ignoreSearch: true });
          if (cached) return cached;
          return caches.match('/pages/offline.html');
        })
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      const networkFetch = fetch(request)
        .then(response => {
          const copy = response.clone();
          caches.open(APP_SHELL_CACHE).then(cache => cache.put(request, copy));
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});

self.addEventListener('push', event => {
  console.log('[SW] Evento push recibido:', event);
  let data = { title: 'Notificación', body: 'Tienes un mensaje nuevo.' };
  if (event.data) {
    try {
      data = event.data.json();
    } catch (e) {
      console.warn('Push con formato no-JSON');
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/img/icon.png',
    badge: data.badge || '/img/badge.png',
    data: data.url || '/'
  };

    event.waitUntil(
      self.registration.showNotification(data.title, options)
    );
});

self.addEventListener('notificationclick', event => {
  console.log('[SW] Notificación clicada');
  event.notification.close();

  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientsArr => {
      for (let client of clientsArr) {
        if (client.url === event.notification.data && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow(event.notification.data);
    })
  );
});

// --- Descarga de capítulos: capa base ---------------------------------
// El propio Service Worker ejecuta el fetch de las imágenes (en vez de la
// página), para que la descarga no dependa de que una pestaña concreta
// siga viva: sobrevive a navegar a otra página de la PWA porque el SW no
// está atado a ninguna ventana. Se usa en cualquier navegador (incluido
// iOS Safari); solo se corta si se cierra/suspende la app del todo, que es
// una limitación de plataforma sin workaround posible desde JS.

const activeDownloads = new Map(); // id -> { controller, label, progress }

async function broadcastToClients(message) {
  const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  allClients.forEach(client => client.postMessage(message));
}

async function fetchProxyBlob(proxyUrl, token, url, signal) {
  // Timeout defensivo: si el fetch se queda colgado (red/backend/proxy sin
  // responder), sin esto el bucle entero se queda parado para siempre sin
  // ningún error visible — con esto, a los 30s se aborta y se ve como un
  // 'download-error' en vez de un progreso congelado indefinidamente.
  const timeoutSignal = AbortSignal.timeout(30000);
  const combinedSignal = ('any' in AbortSignal) ? AbortSignal.any([signal, timeoutSignal]) : signal;
  const res = await fetch(proxyUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, url }),
    signal: combinedSignal
  });
  return res.blob();
}

// Descarga varias imágenes a la vez (en vez de una por una) para aprovechar
// las conexiones en paralelo que el navegador ya permite hacia el backend;
// conserva el orden de páginas (results[i] por índice, no por orden de
// llegada) y reporta progreso por cada una que termine, sea cual sea el
// orden real en que respondan.
async function fetchImagesConcurrently(imageUrls, proxyUrl, token, signal, onProgress) {
  const CONCURRENCY = 6;
  const results = new Array(imageUrls.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < imageUrls.length) {
      const i = nextIndex++;
      results[i] = await fetchProxyBlob(proxyUrl, token, imageUrls[i], signal);
      completed++;
      onProgress(completed, imageUrls.length);
    }
  }

  const workers = Array.from({ length: Math.min(CONCURRENCY, imageUrls.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function runDownload({ id, mangaTitle, cid, chapterNumber, chapterTitle, imageUrls, thumbnailUrl, token, proxyUrl }) {
  const controller = new AbortController();
  const label = `${mangaTitle} - Cap. ${chapterNumber}`;
  activeDownloads.set(id, { controller, label, progress: 0 });
  broadcastToClients({ type: 'download-progress', id, label, progress: 0 });

  try {
    const pages = await fetchImagesConcurrently(imageUrls, proxyUrl, token, controller.signal, (completed, total) => {
      const progress = Math.round((completed / total) * 100);
      activeDownloads.get(id).progress = progress;
      broadcastToClients({ type: 'download-progress', id, label, progress });
    });

    await saveChapterOffline({ mangaTitle, cid, chapterNumber, chapterTitle, pages });

    const mangaMeta = await getOfflineManga(mangaTitle);
    if (!mangaMeta?.thumbnail && thumbnailUrl) {
      const thumbnail = await fetchProxyBlob(proxyUrl, token, thumbnailUrl, controller.signal);
      await saveMangaMeta({ mangaTitle, cid, thumbnail });
    } else {
      await saveMangaMeta({ mangaTitle, cid });
    }

    broadcastToClients({ type: 'download-complete', id });
  } catch (err) {
    if (err.name === 'AbortError') {
      broadcastToClients({ type: 'download-cancelled', id });
    } else {
      console.error('[SW] Error descargando capítulo:', err);
      broadcastToClients({ type: 'download-error', id });
    }
  } finally {
    activeDownloads.delete(id);
  }
}

self.addEventListener('message', event => {
  const data = event.data || {};

  if (data.type === 'start-download') {
    event.waitUntil(runDownload(data));
  } else if (data.type === 'cancel-download') {
    const entry = activeDownloads.get(data.id);
    if (entry) entry.controller.abort();
  } else if (data.type === 'get-active-downloads') {
    const downloads = Array.from(activeDownloads.entries()).map(([id, entry]) => ({
      id, label: entry.label, progress: entry.progress
    }));
    if (event.source) event.source.postMessage({ type: 'active-downloads', downloads });
  }
});

// --- Descarga de capítulos: capa de mejora (Background Fetch) ---------
// Solo Chromium/Android soportan esto. La transferencia la gestiona el
// propio navegador (no esta instancia del SW), así que sobrevive a cerrar
// la PWA del todo o a que el sistema mate el proceso. El registro de la
// descarga lo hace la página (registration.backgroundFetch.fetch(...));
// el SW solo reacciona cuando termina.

self.addEventListener('backgroundfetchsuccess', event => {
  const registration = event.registration;
  event.waitUntil((async () => {
    const job = await getDownloadJob(registration.id);
    if (!job) return;

    const records = await registration.matchAll();
    const blobByUrl = new Map();
    await Promise.all(records.map(async record => {
      const response = await record.responseReady;
      blobByUrl.set(record.request.url, await response.blob());
    }));

    const pages = job.imageProxyUrls.map(url => blobByUrl.get(url));

    await saveChapterOffline({
      mangaTitle: job.mangaTitle,
      cid: job.cid,
      chapterNumber: job.chapterNumber,
      chapterTitle: job.chapterTitle,
      pages
    });

    if (job.thumbnailProxyUrl && blobByUrl.has(job.thumbnailProxyUrl)) {
      await saveMangaMeta({ mangaTitle: job.mangaTitle, cid: job.cid, thumbnail: blobByUrl.get(job.thumbnailProxyUrl) });
    } else {
      await saveMangaMeta({ mangaTitle: job.mangaTitle, cid: job.cid });
    }

    await deleteDownloadJob(registration.id);
    await broadcastToClients({ type: 'download-complete', id: registration.id });
  })());
});

self.addEventListener('backgroundfetchfail', event => {
  const registration = event.registration;
  event.waitUntil((async () => {
    await deleteDownloadJob(registration.id);
    await broadcastToClients({ type: 'download-error', id: registration.id });
  })());
});

self.addEventListener('backgroundfetchabort', event => {
  const registration = event.registration;
  event.waitUntil((async () => {
    await deleteDownloadJob(registration.id);
    await broadcastToClients({ type: 'download-cancelled', id: registration.id });
  })());
});
