// offline-db.js
// Almacén IndexedDB para capítulos descargados y visibles en la sección Offline.

const OFFLINE_DB_NAME = 'mangaReaderOfflineDB';
const OFFLINE_DB_VERSION = 1;

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

    const withCounts = await Promise.all(mangas.map(async manga => {
        const index = tx(db, 'chapters', 'readonly').index('byManga');
        const chapterCount = await requestToPromise(index.count(IDBKeyRange.only(manga.mangaTitle)));
        return { ...manga, chapterCount };
    }));

    return withCounts.filter(m => m.chapterCount > 0);
}

// --- Capítulos ---

async function saveChapterOffline({ mangaTitle, cid, chapterNumber, chapterTitle, pages }) {
    const db = await openOfflineDB();
    const record = {
        mangaTitle,
        chapterNumber: Number(chapterNumber),
        cid,
        chapterTitle,
        downloadedAt: Date.now(),
        pageCount: pages.length,
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
    return chapters
        .map(({ pages, ...rest }) => rest)
        .sort((a, b) => a.chapterNumber - b.chapterNumber);
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
