// reading-progress.js
// Guarda y restaura por dónde iba el usuario leyendo un capítulo (página en
// modo paginado, punto de scroll en modo scroll continuo) — distinto de
// "capítulo leído" (add_finished), que es a nivel de capítulo entero.
//
// Solo local (localStorage), sin sincronizar con el backend: la posición
// cambia en cada scroll/paso de página, y sincronizar algo tan granular
// tendría el mismo riesgo de condición de carrera que ya se evitó
// deliberadamente para el tamaño de imagen del lector (ver CLAUDE.md).
//
// Compartido por chapter.js y offline-chapter.js. Depende de reading-mode.js
// (isPaginatedMode, setPage, setPageChangeCallback) — debe cargarse después.

const READ_PROGRESS_PREFIX = 'readProgress:';
const SAVE_DEBOUNCE_MS = 800;
const RESUME_TOAST_MS = 2200;

function progressKey(mangaTitle, chapterNumber) {
    return `${READ_PROGRESS_PREFIX}${mangaTitle}::${chapterNumber}`;
}

function loadChapterProgress(mangaTitle, chapterNumber) {
    try {
        const raw = localStorage.getItem(progressKey(mangaTitle, chapterNumber));
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function saveChapterProgressNow(mangaTitle, chapterNumber, progress) {
    try {
        localStorage.setItem(progressKey(mangaTitle, chapterNumber), JSON.stringify(progress));
    } catch {
        // localStorage lleno o no disponible (privado/incógnito): no es crítico, se ignora.
    }
}

let saveDebounceTimer = null;
function scheduleSaveProgress(mangaTitle, chapterNumber, progress) {
    clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => saveChapterProgressNow(mangaTitle, chapterNumber, progress), SAVE_DEBOUNCE_MS);
}

function showResumeToast(message) {
    const toast = document.createElement('div');
    toast.className = 'resume-toast';
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('visible'));
    setTimeout(() => {
        toast.classList.remove('visible');
        setTimeout(() => toast.remove(), 300);
    }, RESUME_TOAST_MS);
}

function scrollRatio() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
}

function restoreScrollRatio(ratio) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (max > 0) window.scrollTo(0, Math.round(max * ratio));
}

function waitForImagesToLoad(container) {
    const imgs = Array.from(container.querySelectorAll('img'));
    return Promise.all(imgs.map(img => img.complete
        ? Promise.resolve()
        : new Promise(resolve => {
            img.addEventListener('load', resolve, { once: true });
            img.addEventListener('error', resolve, { once: true });
        })));
}

// Se llama justo después de renderizar las imágenes de un capítulo (tras
// renderChapterImages, que ya habrá invocado applyReadingModeToChapter).
function initReadingProgress(mangaTitle, chapterNumber) {
    clearTimeout(saveDebounceTimer);
    const saved = loadChapterProgress(mangaTitle, chapterNumber);
    const container = document.getElementById('chapter-images');

    if (typeof isPaginatedMode === 'function' && isPaginatedMode()) {
        if (saved && saved.mode === 'paginated' && saved.page > 0) {
            setPage(saved.page);
            showResumeToast(`Retomado en la página ${saved.page + 1}`);
        }
        setPageChangeCallback(page => {
            saveChapterProgressNow(mangaTitle, chapterNumber, { mode: 'paginated', page });
        });
        return;
    }

    // Modo scroll continuo
    let lastRatio = 0;
    const onScroll = () => {
        lastRatio = scrollRatio();
        scheduleSaveProgress(mangaTitle, chapterNumber, { mode: 'scroll', scrollRatio: lastRatio });
    };
    window.addEventListener('scroll', onScroll, { passive: true });

    // Guardado inmediato (sin esperar el debounce) al salir de la página,
    // para no perder la posición si el usuario navega justo tras hacer scroll.
    const flushOnLeave = () => saveChapterProgressNow(mangaTitle, chapterNumber, { mode: 'scroll', scrollRatio: lastRatio });
    window.addEventListener('pagehide', flushOnLeave);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') flushOnLeave();
    });

    if (saved && saved.mode === 'scroll' && saved.scrollRatio > 0.02) {
        // Restauración en dos fases: una aproximada ya (por si las imágenes
        // tardan), y otra exacta cuando todas las imágenes del capítulo
        // hayan terminado de cargar (su altura real cambia el scrollHeight).
        requestAnimationFrame(() => restoreScrollRatio(saved.scrollRatio));
        if (container) {
            waitForImagesToLoad(container).then(() => restoreScrollRatio(saved.scrollRatio));
        }
        showResumeToast('Retomando donde lo dejaste…');
    }
}
