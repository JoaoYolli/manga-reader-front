// offline-db.js
// Almacén IndexedDB para capítulos descargados y visibles en la sección Offline.

const OFFLINE_DB_NAME = 'mangaReaderOfflineDB';
const OFFLINE_DB_VERSION = 2;

let dbPromise = null;

function openOfflineDB() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

        req.onupgradeneeded = () => {
            const db = req.result;

            if (!db.objectStoreNames.contains('mangas')) {
                db.createObjectStore('mangas', { keyPath: 'mangaTitle' });
            }

            if (!db.objectStoreNames.contains('chapters')) {
                const chapters = db.createObjectStore('chapters', { keyPath: ['mangaTitle', 'chapterNumber'] });
                chapters.createIndex('byManga', 'mangaTitle', { unique: false });
            }

            if (!db.objectStoreNames.contains('jobs')) {
                db.createObjectStore('jobs', { keyPath: 'id' });
            }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });

    return dbPromise;
}

function tx(db, storeName, mode) {
    return db.transaction(storeName, mode).objectStore(storeName);
}

function requestToPromise(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

// --- Mangas (metadata + carátula) ---

async function saveMangaMeta({ mangaTitle, cid, thumbnail }) {
    const db = await openOfflineDB();
    const existing = await requestToPromise(tx(db, 'mangas', 'readonly').get(mangaTitle));

    const record = {
        mangaTitle,
        cid,
        thumbnail: thumbnail || existing?.thumbnail || null,
        lastDownloadedAt: Date.now()
    };

    await requestToPromise(tx(db, 'mangas', 'readwrite').put(record));
}

async function getOfflineManga(mangaTitle) {
    const db = await openOfflineDB();
    return requestToPromise(tx(db, 'mangas', 'readonly').get(mangaTitle));
}

async function listOfflineMangas() {
    const db = await openOfflineDB();
    const mangas = await requestToPromise(tx(db, 'mangas', 'readonly').getAll());

    // Reutiliza listOfflineChapters (no listOfflineChapters+count por separado)
    // para que el tamaño en bytes de cada manga salga del mismo cálculo — y
    // del mismo relleno automático para capítulos descargados antes de que
    // existiera sizeBytes — que ya usa la sección offline-manga.html.
    const withStats = await Promise.all(mangas.map(async manga => {
        const chapters = await listOfflineChapters(manga.mangaTitle);
        const sizeBytes = chapters.reduce((sum, ch) => sum + (ch.sizeBytes || 0), 0);
        return { ...manga, chapterCount: chapters.length, sizeBytes };
    }));

    return withStats.filter(m => m.chapterCount > 0);
}

// --- Capítulos ---

function chapterPagesSizeBytes(pages) {
    return (pages || []).reduce((sum, blob) => sum + (blob?.size || 0), 0);
}

async function saveChapterOffline({ mangaTitle, cid, chapterNumber, chapterTitle, pages }) {
    const db = await openOfflineDB();
    const record = {
        mangaTitle,
        chapterNumber: Number(chapterNumber),
        cid,
        chapterTitle,
        downloadedAt: Date.now(),
        pageCount: pages.length,
        sizeBytes: chapterPagesSizeBytes(pages),
        pages
    };
    await requestToPromise(tx(db, 'chapters', 'readwrite').put(record));
}

async function getOfflineChapter(mangaTitle, chapterNumber) {
    const db = await openOfflineDB();
    return requestToPromise(tx(db, 'chapters', 'readonly').get([mangaTitle, Number(chapterNumber)]));
}

async function isChapterOffline(mangaTitle, chapterNumber) {
    const db = await openOfflineDB();
    const key = await requestToPromise(tx(db, 'chapters', 'readonly').getKey([mangaTitle, Number(chapterNumber)]));
    return key !== undefined;
}

async function listOfflineChapters(mangaTitle) {
    const db = await openOfflineDB();
    const index = tx(db, 'chapters', 'readonly').index('byManga');
    const chapters = await requestToPromise(index.getAll(IDBKeyRange.only(mangaTitle)));

    // Capítulos descargados antes de que se empezara a guardar sizeBytes no
    // lo tienen todavía: se calcula aquí a partir de sus blobs (ya están en
    // memoria, getAll() los trae igual) y se rellena una sola vez para no
    // tener que recalcularlo cada vez que se abra esta lista.
    const toBackfill = [];
    const results = chapters.map(({ pages, ...rest }) => {
        if (typeof rest.sizeBytes === 'number') return rest;
        const sizeBytes = chapterPagesSizeBytes(pages);
        toBackfill.push({ ...rest, pages, sizeBytes });
        return { ...rest, sizeBytes };
    });

    if (toBackfill.length) {
        const writeStore = tx(db, 'chapters', 'readwrite');
        await Promise.all(toBackfill.map(record => requestToPromise(writeStore.put(record))));
    }

    return results.sort((a, b) => a.chapterNumber - b.chapterNumber);
}

async function deleteOfflineChapter(mangaTitle, chapterNumber) {
    const db = await openOfflineDB();
    await requestToPromise(tx(db, 'chapters', 'readwrite').delete([mangaTitle, Number(chapterNumber)]));
}

async function deleteOfflineManga(mangaTitle) {
    const db = await openOfflineDB();
    const index = tx(db, 'chapters', 'readonly').index('byManga');
    const keys = await requestToPromise(index.getAllKeys(IDBKeyRange.only(mangaTitle)));

    const chapterStore = tx(db, 'chapters', 'readwrite');
    await Promise.all(keys.map(key => requestToPromise(chapterStore.delete(key))));
    await requestToPromise(tx(db, 'mangas', 'readwrite').delete(mangaTitle));
}

// --- Jobs de descarga en curso (metadata para la capa Background Fetch;
// Background Fetch solo expone id + progreso, no manga/capítulo, así que
// este store es lo que permite reconstruir la UI en cualquier pestaña) ---

async function saveDownloadJob(job) {
    const db = await openOfflineDB();
    await requestToPromise(tx(db, 'jobs', 'readwrite').put(job));
}

async function getDownloadJob(id) {
    const db = await openOfflineDB();
    return requestToPromise(tx(db, 'jobs', 'readonly').get(id));
}

async function deleteDownloadJob(id) {
    const db = await openOfflineDB();
    await requestToPromise(tx(db, 'jobs', 'readwrite').delete(id));
}

// --- Formato ---

function formatBytes(bytes) {
    if (!bytes) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    let value = bytes;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
        value /= 1024;
        i++;
    }
    return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// --- Persistencia ---

async function requestPersistentStorage() {
    if (!(navigator.storage && navigator.storage.persist)) return false;
    try {
        return await navigator.storage.persist();
    } catch (err) {
        console.warn('No se pudo solicitar almacenamiento persistente:', err);
        return false;
    }
}
