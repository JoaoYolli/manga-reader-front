// download-manager.js
// Widget discreto (bolita flotante) para mostrar y gestionar descargas en curso.

const activeDownloads = new Map();
let downloadBallEl = null;
let downloadPanelEl = null;
let downloadListEl = null;

function injectDownloadManagerStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #download-ball {
            position: fixed;
            bottom: 1rem;
            left: 1rem;
            width: 3rem;
            height: 3rem;
            border-radius: 50%;
            background: #4a90e2;
            box-shadow: 0 2px 8px rgba(0,0,0,0.35);
            display: none;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 1.3rem;
            cursor: pointer;
            z-index: 3000;
            animation: download-ball-float 1.4s ease-in-out infinite;
        }
        #download-ball.visible { display: flex; }
        @keyframes download-ball-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        #download-panel {
            position: fixed;
            bottom: 4.75rem;
            left: 1rem;
            display: none;
            background: #fff;
            border-radius: 0.5rem;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            padding: 0.75rem;
            width: min(300px, calc(100vw - 2rem));
            max-height: 50vh;
            overflow-y: auto;
            z-index: 3000;
        }
        #download-panel h4 {
            margin: 0 0 0.5rem;
            font-size: 0.9rem;
            color: #333;
        }
        .download-item {
            margin-bottom: 0.6rem;
            font-size: 0.8rem;
            color: #333;
        }
        .download-item-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem;
        }
        .download-item-bar {
            background: #eee;
            border-radius: 4px;
            height: 6px;
            margin-top: 4px;
            overflow: hidden;
        }
        .download-item-fill {
            background: #4caf50;
            height: 100%;
            width: 0%;
            transition: width 0.2s ease;
        }
        .download-cancel-btn {
            border: none;
            background: transparent;
            color: #c0392b;
            cursor: pointer;
            font-size: 0.95rem;
            line-height: 1;
        }
        .download-empty {
            font-size: 0.8rem;
            color: #666;
            margin: 0;
        }
    `;
    document.head.appendChild(style);
}

function ensureDownloadManagerUI() {
    if (downloadBallEl) return;
    injectDownloadManagerStyles();

    downloadBallEl = document.createElement('div');
    downloadBallEl.id = 'download-ball';
    downloadBallEl.textContent = '⬇️';
    downloadBallEl.addEventListener('click', () => {
        downloadPanelEl.style.display = downloadPanelEl.style.display === 'block' ? 'none' : 'block';
    });
    if (window.isTvMode) makeTvFocusable(downloadBallEl);

    downloadPanelEl = document.createElement('div');
    downloadPanelEl.id = 'download-panel';

    const heading = document.createElement('h4');
    heading.textContent = 'Descargas en curso';

    downloadListEl = document.createElement('div');
    downloadListEl.id = 'download-list';

    downloadPanelEl.append(heading, downloadListEl);
    document.body.append(downloadBallEl, downloadPanelEl);
}

function renderDownloadManager() {
    ensureDownloadManagerUI();

    downloadBallEl.classList.toggle('visible', activeDownloads.size > 0);
    if (activeDownloads.size === 0) downloadPanelEl.style.display = 'none';

    downloadListEl.innerHTML = '';

    if (!activeDownloads.size) {
        const empty = document.createElement('p');
        empty.className = 'download-empty';
        empty.textContent = 'Sin descargas en curso.';
        downloadListEl.appendChild(empty);
        return;
    }

    activeDownloads.forEach((entry, id) => {
        const item = document.createElement('div');
        item.className = 'download-item';

        const row = document.createElement('div');
        row.className = 'download-item-row';

        const label = document.createElement('span');
        label.textContent = `${entry.label} (${entry.progress}%)`;

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'download-cancel-btn';
        cancelBtn.textContent = '✕';
        cancelBtn.title = 'Cancelar descarga';
        cancelBtn.addEventListener('click', () => cancelDownload(id));

        row.append(label, cancelBtn);

        const bar = document.createElement('div');
        bar.className = 'download-item-bar';
        const fill = document.createElement('div');
        fill.className = 'download-item-fill';
        fill.style.width = `${entry.progress}%`;
        bar.appendChild(fill);

        item.append(row, bar);
        downloadListEl.appendChild(item);
    });
}

// --- Sincronización con el Service Worker ---
// El SW es quien ejecuta la descarga de verdad (capa base) o quien delega en
// Background Fetch (capa de mejora, Chromium/Android) — esta capa de UI solo
// escucha sus mensajes y reconstruye el mismo Map de siempre, así que la
// misma bola/panel funciona igual en cualquier página que incluya este script.

let backgroundFetchPollStarted = false;

function generateDownloadId(mangaTitle, chapterNumber) {
    return `dl-${encodeURIComponent(mangaTitle)}-${chapterNumber}`;
}

async function getReadyRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    return navigator.serviceWorker.ready;
}

async function supportsBackgroundFetch() {
    if (!('BackgroundFetchManager' in window)) return false;
    const reg = await getReadyRegistration();
    return !!(reg && reg.backgroundFetch);
}

function handleSwMessage(event) {
    const data = event.data || {};

    switch (data.type) {
        case 'active-downloads':
            data.downloads.forEach(d => {
                activeDownloads.set(d.id, { label: d.label, progress: d.progress, isBackgroundFetch: false });
            });
            renderDownloadManager();
            break;
        case 'download-progress':
            activeDownloads.set(data.id, { label: data.label, progress: data.progress, isBackgroundFetch: false });
            renderDownloadManager();
            break;
        case 'download-complete':
            activeDownloads.delete(data.id);
            backgroundFetchCompletedUrls.delete(data.id);
            renderDownloadManager();
            requestPersistentStorage();
            break;
        case 'download-cancelled':
        case 'download-error':
            activeDownloads.delete(data.id);
            backgroundFetchCompletedUrls.delete(data.id);
            renderDownloadManager();
            break;
    }
}

// Con varias descargas a la vez, una vuelta de sondeo (consultas a
// IndexedDB + a Background Fetch por cada id) puede tardar más de los 2s
// del intervalo. Sin este guard, setInterval dispara la siguiente vuelta
// igual, y dos vueltas superpuestas se pisan escribiendo en activeDownloads
// en cualquier orden — eso es lo que dejaba el % "congelado" en un valor
// viejo. Con el guard, una vuelta lenta simplemente hace que la siguiente
// se salte, sin pisarse.
let pollInFlight = false;

// Progreso real de cada descarga por Background Fetch: cuenta imágenes ya
// terminadas, no bytes contra una estimación de tamaño. matchAll() siempre
// devuelve TODAS las peticiones (terminadas o no, confirmado en MDN), así
// que no sirve para contar por sí solo — pero cada registro expone
// responseReady, una promesa que se resuelve cuando esa imagen en concreto
// termina. Se marca por URL (no por referencia de objeto, que puede no ser
// estable entre sondeos) para no contar la misma imagen dos veces.
const backgroundFetchCompletedUrls = new Map(); // id -> Set<url>

async function trackBackgroundFetchProgress(id, bgRegistration, totalRequests) {
    let completedUrls = backgroundFetchCompletedUrls.get(id);
    if (!completedUrls) {
        completedUrls = new Set();
        backgroundFetchCompletedUrls.set(id, completedUrls);
    }

    const records = await bgRegistration.matchAll();
    records.forEach(record => {
        const url = record.request.url;
        if (completedUrls.has(url)) return;
        record.responseReady
            .then(() => completedUrls.add(url))
            .catch(() => completedUrls.add(url)); // contar igual, para no atascar el % si una imagen falla
    });

    return totalRequests ? Math.round((completedUrls.size / totalRequests) * 100) : 0;
}

async function pollBackgroundFetches() {
    if (pollInFlight) return;
    pollInFlight = true;

    try {
        const reg = await getReadyRegistration();
        if (!reg || !reg.backgroundFetch) return;

        const ids = await reg.backgroundFetch.getIds();

        const results = await Promise.all(ids.map(async id => {
            const [bgRegistration, job] = await Promise.all([
                reg.backgroundFetch.get(id),
                getDownloadJob(id)
            ]);
            return { id, bgRegistration, job };
        }));

        for (const [id, entry] of activeDownloads) {
            if (entry.isBackgroundFetch && !ids.includes(id)) {
                activeDownloads.delete(id);
                backgroundFetchCompletedUrls.delete(id);
            }
        }

        await Promise.all(results.map(async ({ id, bgRegistration, job }) => {
            if (!bgRegistration || !job) {
                // Ya no hay registro de trabajo (la descarga terminó y se
                // limpió, aunque el navegador todavía liste el id) — borrar
                // en vez de dejar una entrada fantasma con el último valor.
                activeDownloads.delete(id);
                backgroundFetchCompletedUrls.delete(id);
                return;
            }

            const totalRequests = job.imageProxyUrls.length + (job.thumbnailProxyUrl ? 1 : 0);
            const progress = await trackBackgroundFetchProgress(id, bgRegistration, totalRequests);
            activeDownloads.set(id, { label: job.label, progress, isBackgroundFetch: true });
        }));

        renderDownloadManager();
    } finally {
        pollInFlight = false;
    }
}

function initDownloadManagerSync() {
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('message', handleSwMessage);

    navigator.serviceWorker.ready.then(reg => {
        reg.active?.postMessage({ type: 'get-active-downloads' });
        pollBackgroundFetches();
        if (!backgroundFetchPollStarted) {
            backgroundFetchPollStarted = true;
            setInterval(pollBackgroundFetches, 2000);
        }
    });
}

initDownloadManagerSync();

// --- Iniciar / cancelar descargas ---

async function startChapterDownload({ mangaTitle, cid, chapterNumber, chapterTitle, imageUrls, thumbnailUrl, token, backendUrl }) {
    const id = generateDownloadId(mangaTitle, chapterNumber);
    const label = `${mangaTitle} - Cap. ${chapterNumber}`;
    const reg = await getReadyRegistration();

    if (await supportsBackgroundFetch()) {
        const toProxyUrl = url => `${backendUrl}/proxy?url=${encodeURIComponent(url)}&token=${encodeURIComponent(token)}`;
        const imageProxyUrls = imageUrls.map(toProxyUrl);
        const thumbnailProxyUrl = thumbnailUrl ? toProxyUrl(thumbnailUrl) : null;
        const requestUrls = thumbnailProxyUrl ? [...imageProxyUrls, thumbnailProxyUrl] : imageProxyUrls;

        await saveDownloadJob({ id, label, mangaTitle, cid, chapterNumber, chapterTitle, imageProxyUrls, thumbnailProxyUrl });

        activeDownloads.set(id, { label, progress: 0, isBackgroundFetch: true });
        renderDownloadManager();

        await reg.backgroundFetch.fetch(id, requestUrls, {
            title: label,
            icons: [{ src: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' }]
        });
    } else {
        activeDownloads.set(id, { label, progress: 0, isBackgroundFetch: false });
        renderDownloadManager();

        reg.active.postMessage({
            type: 'start-download',
            id, mangaTitle, cid, chapterNumber, chapterTitle,
            imageUrls, thumbnailUrl, token,
            proxyUrl: `${backendUrl}/proxy`
        });
    }

    return id;
}

async function cancelDownload(id) {
    const entry = activeDownloads.get(id);
    if (!entry) return;

    const reg = await getReadyRegistration();
    if (entry.isBackgroundFetch) {
        const bgRegistration = await reg?.backgroundFetch?.get(id);
        await bgRegistration?.abort();
        backgroundFetchCompletedUrls.delete(id);
    } else {
        reg?.active?.postMessage({ type: 'cancel-download', id });
    }

    activeDownloads.delete(id);
    renderDownloadManager();
}
