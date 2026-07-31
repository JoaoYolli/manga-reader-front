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
            background: var(--color-card, #fbf7ec);
            border: 2px solid var(--color-ink, #211d16);
            box-shadow: var(--stamp-shadow, 3px 3px 0 #c2b184);
            display: none;
            align-items: center;
            justify-content: center;
            color: var(--color-accent, #b8442f);
            cursor: pointer;
            z-index: 3000;
            animation: download-ball-float 1.4s ease-in-out infinite;
            transition: transform 110ms ease, box-shadow 110ms ease;
        }
        #download-ball .icon { width: 1.3rem; height: 1.3rem; }
        #download-ball.visible { display: flex; }
        #download-ball:active {
            transform: translate(3px, 3px);
            box-shadow: 0 0 0 var(--color-border-strong, #c2b184);
        }
        @keyframes download-ball-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        #download-panel {
            position: fixed;
            bottom: 4.75rem;
            left: 1rem;
            display: none;
            background: var(--color-card, #fbf7ec);
            color: var(--color-ink, #211d16);
            border: 1px solid var(--color-border-strong, #c2b184);
            border-radius: var(--radius-lg, 7px);
            box-shadow: 4px 4px 0 var(--color-border-strong, #c2b184);
            padding: 0.75rem;
            width: min(300px, calc(100vw - 2rem));
            max-height: 50vh;
            overflow-y: auto;
            z-index: 3000;
        }
        #download-panel h4 {
            margin: 0 0 0.5rem;
            font-family: var(--font-mono, monospace);
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: var(--color-ink-soft, #6b6151);
        }
        .download-item {
            margin-bottom: 0.6rem;
            font-size: 0.8rem;
            color: var(--color-ink, #211d16);
        }
        .download-item-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem;
        }
        .download-item-bar {
            background: var(--color-bg-alt, #ece2c9);
            border-radius: 4px;
            height: 6px;
            margin-top: 4px;
            overflow: hidden;
        }
        .download-item-fill {
            background: var(--color-accent, #b8442f);
            height: 100%;
            width: 0%;
            transition: width 0.2s ease;
        }
        .download-cancel-btn {
            border: none;
            background: transparent;
            box-shadow: none;
            color: var(--color-danger, #a53228);
            cursor: pointer;
            padding: 0.2rem;
            line-height: 1;
            transition: transform 110ms ease;
        }
        .download-cancel-btn:hover { color: var(--color-danger, #a53228); border-color: transparent; }
        .download-cancel-btn:active { transform: scale(0.85); box-shadow: none; }
        .download-cancel-btn .icon { width: 0.85rem; height: 0.85rem; }
        .download-empty {
            font-size: 0.8rem;
            color: var(--color-ink-soft, #6b6151);
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
    downloadBallEl.innerHTML = '<span class="icon icon-download"></span>';
    downloadBallEl.setAttribute('aria-label', 'Descargas en curso');
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
        cancelBtn.innerHTML = '<span class="icon icon-close"></span>';
        cancelBtn.title = 'Cancelar descarga';
        cancelBtn.setAttribute('aria-label', 'Cancelar descarga');
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

// forceBaseLayer salta la capa de mejora (Background Fetch) aunque el
// navegador la soporte. registration.backgroundFetch.fetch() exige
// activación de usuario "transient" (un clic reciente) y, si el navegador
// la detecta disparada varias veces sin un clic individual por cada una,
// Chrome la trata como "descarga automática de varios archivos" y muestra
// un aviso de permiso — nunca pasaba porque cada descarga salía de un clic
// individual. Para "descargar varios capítulos seleccionados" (un solo
// clic dispara N descargas) no hay forma de usar Background Fetch sin
// toparse con eso, así que esas van siempre por la capa base: un fetch()
// normal dentro del Service Worker, que no pasa por la UI de Descargas del
// navegador y por tanto no dispara ese aviso. Se pierde solo la ventaja de
// sobrevivir al cierre total de la app (sigue sobreviviendo a navegar
// dentro de la PWA, que es lo que importa aquí).
async function startChapterDownload({ mangaTitle, cid, chapterNumber, chapterTitle, imageUrls, thumbnailUrl, token, backendUrl, forceBaseLayer = false }) {
    const id = generateDownloadId(mangaTitle, chapterNumber);
    const label = `${mangaTitle} - Cap. ${chapterNumber}`;
    const reg = await getReadyRegistration();

    if (!forceBaseLayer && await supportsBackgroundFetch()) {
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
