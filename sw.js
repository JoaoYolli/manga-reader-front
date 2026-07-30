// sw.js

// offline-db.js no toca window/document, es portable tal cual dentro del SW.
importScripts('/js/offline-db.js');

self.addEventListener('install', event => {
  console.log('[SW] Instalado');
  self.skipWaiting(); // Opcional: activa inmediatamente
});

self.addEventListener('activate', event => {
  console.log('[SW] Activado');
  self.clients.claim(); // Toma el control inmediato
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
