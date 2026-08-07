// offline-db.js
// Almacén IndexedDB para capítulos descargados y visibles en la sección Offline.

const OFFLINE_DB_NAME = 'mangaReaderOfflineDB';
const OFFLINE_DB_VERSION = 3;

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

            if (!db.objectStoreNames.contains('books')) {
                db.createObjectStore('books', { keyPath: 'id' });
            }
        };

        // Esta es una app multi-página (sin router propio): es fácil tener
        // varias pestañas/ventanas del mismo origen abiertas a la vez (p. ej.
        // una pestaña vieja dejada abierta desde antes de que existiera el
        // store 'books'). Si esa pestaña vieja sigue con una conexión abierta
        // en una versión anterior, esta apertura se queda "blocked" — sin
        // este manejador, la promesa no se resuelve NI se rechaza nunca, y
        // cualquier await sobre openOfflineDB() (p. ej. listOfflineBooks() en
        // libros.js) se cuelga para siempre, dejando la página en blanco
        // hasta que se refresca (lo que cierra la conexión vieja de la propia
        // pestaña y desbloquea la apertura). Se rechaza en vez de dejarlo
        // colgado, para que el código que llama pueda al menos degradar con
        // gracia en vez de quedarse esperando sin fin.
        req.onblocked = () => reject(new Error('IndexedDB bloqueada por otra pestaña con una versión antigua abierta'));

        req.onsuccess = () => {
            const db = req.result;
            // Si OTRA pestaña pide una versión más nueva más adelante, esta
            // conexión se cierra sola en vez de quedarse abierta bloqueando
            // esa apertura (el mismo problema que onblocked evita aquí, pero
            // visto desde el lado de la conexión que sería la culpable).
            db.onversionchange = () => {
                db.close();
                dbPromise = null;
            };
            resolve(db);
        };
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

// --- Libros electrónicos (EPUB/PDF) ---
// A diferencia de los capítulos de manga (muchas imágenes por descarga), un
// libro es un único fichero: se guarda entero como un Blob, sin necesidad de
// concurrencia ni de la maquinaria de Background Fetch de sw.js.

async function saveBookOffline({ id, title, format, fileBlob }) {
    const db = await openOfflineDB();
    const existing = await requestToPromise(tx(db, 'books', 'readonly').get(id));
    const record = {
        id,
        title,
        format,
        fileBlob,
        sizeBytes: fileBlob?.size || 0,
        downloadedAt: Date.now(),
        localProgress: existing?.localProgress || null
    };
    await requestToPromise(tx(db, 'books', 'readwrite').put(record));
}

async function getOfflineBook(id) {
    const db = await openOfflineDB();
    return requestToPromise(tx(db, 'books', 'readonly').get(id));
}

async function listOfflineBooks() {
    const db = await openOfflineDB();
    return requestToPromise(tx(db, 'books', 'readonly').getAll());
}

async function deleteOfflineBook(id) {
    const db = await openOfflineDB();
    await requestToPromise(tx(db, 'books', 'readwrite').delete(id));
}

// Progreso local del libro (buffer antes/además de sincronizarlo con el
// backend — ver book-reader.js). updatedAt permite comparar con el progreso
// del servidor y quedarse con el más reciente al abrir el lector.
async function saveLocalBookProgress(id, locator) {
    const db = await openOfflineDB();
    const store = tx(db, 'books', 'readwrite');
    const existing = await requestToPromise(store.get(id));
    if (!existing) return;
    existing.localProgress = { locator, updatedAt: new Date().toISOString() };
    await requestToPromise(store.put(existing));
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
