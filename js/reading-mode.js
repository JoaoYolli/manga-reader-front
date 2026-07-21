// reading-mode.js
// Modo de lectura "paginado": muestra una sola imagen del capítulo a la vez,
// como un manga real. Se activa solo si getReadingMode() === 'paginated'
// (ver settings.js); en modo 'scroll' (por defecto) no cambia nada del
// comportamiento actual.
//
// Navegación: clic en la mitad derecha de la imagen = página siguiente,
// clic en la mitad izquierda = página anterior. También se puede deslizar
// (swipe) hacia la izquierda para avanzar o hacia la derecha para retroceder.

const SWIPE_THRESHOLD_PX = 50;

let pageWrappers = [];
let currentPage = 0;
let touchStartX = null;

function applyReadingModeToChapter(wrappers) {
    pageWrappers = wrappers;
    currentPage = 0;

    const container = document.getElementById('chapter-images');
    if (!container) return;

    if (getReadingMode() !== 'paginated' || !wrappers.length) {
        wrappers.forEach(w => w.classList.remove('page-hidden'));
        container.classList.remove('paginated');
        return;
    }

    container.classList.add('paginated');
    bindPageTurnEvents(container);
    renderCurrentPage();
}

function renderCurrentPage() {
    pageWrappers.forEach((wrapper, i) => {
        wrapper.classList.toggle('page-hidden', i !== currentPage);
    });
}

function goToPage(delta) {
    if (getReadingMode() !== 'paginated' || !pageWrappers.length) return;
    const next = Math.max(0, Math.min(currentPage + delta, pageWrappers.length - 1));
    if (next === currentPage) return;
    currentPage = next;
    renderCurrentPage();
}

function isPaginatedMode() {
    return getReadingMode() === 'paginated';
}

// Los listeners se enganchan una sola vez sobre #chapter-images (el propio
// contenedor no se recrea entre capítulos, solo su contenido).
function bindPageTurnEvents(container) {
    if (container.dataset.pageTurnBound) return;
    container.dataset.pageTurnBound = 'true';

    container.addEventListener('click', e => {
        if (!isPaginatedMode()) return;
        // No interferir con el clic de "reintentar" de una imagen que falló al cargar
        if (e.target.closest('.chapter-image-error')) return;

        const rect = container.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        goToPage(clickX > rect.width / 2 ? 1 : -1);
    });

    container.addEventListener('touchstart', e => {
        if (!isPaginatedMode()) return;
        touchStartX = e.touches[0].clientX;
    }, { passive: true });

    container.addEventListener('touchend', e => {
        if (!isPaginatedMode() || touchStartX === null) return;
        const delta = e.changedTouches[0].clientX - touchStartX;
        touchStartX = null;
        if (Math.abs(delta) < SWIPE_THRESHOLD_PX) return;
        goToPage(delta < 0 ? 1 : -1);
    });
}
