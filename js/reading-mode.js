// reading-mode.js
// Modo de lectura "paginado": muestra una sola imagen del capítulo a la vez,
// como un manga real. Se activa solo si getReadingMode() === 'paginated'
// (ver settings.js); en modo 'scroll' (por defecto) no cambia nada del
// comportamiento actual.
//
// Cómo se pasa de página es configurable (ver getPageTurnMode() en
// settings.js, elegido en el modal de Ajustes):
// - 'swipe' (por defecto): deslizar/arrastrar hacia la izquierda avanza,
//   hacia la derecha retrocede. Se usan Pointer Events (no touch*) para que
//   funcione igual con el dedo que arrastrando con el ratón en PC. Clic
//   (sin arrastre) en cualquier parte de la pantalla alterna la cabecera/pie.
// - 'edge-click': clic en el borde izquierdo/derecho de la pantalla
//   (EDGE_ZONE_FRACTION de cada lado) pasa de página; el centro sigue
//   alternando la cabecera/pie igual que en modo swipe. El deslizamiento
//   queda desactivado en este modo — es una elección excluyente, no ambas
//   a la vez.

const SWIPE_THRESHOLD_PX = 50;
const EDGE_ZONE_FRACTION = 0.3;

let pageWrappers = [];
let currentPage = 0;
let pointerStartX = null;
let pointerStartY = null;
let justSwiped = false;
let pageChangeCallback = null;

// reading-progress.js se engancha aquí para guardar la página actual cada
// vez que cambia, sin que reading-mode.js necesite saber nada de cómo (ni
// de si) se persiste esa posición.
function setPageChangeCallback(cb) {
    pageChangeCallback = cb;
}

// Salta directamente a una página (a diferencia de goToPage, que se mueve
// por delta). Usado por reading-progress.js para restaurar la posición
// guardada al reabrir un capítulo.
function setPage(n) {
    if (!pageWrappers.length) return;
    currentPage = Math.max(0, Math.min(n, pageWrappers.length - 1));
    renderCurrentPage();
}

function applyReadingModeToChapter(wrappers) {
    pageWrappers = wrappers;
    currentPage = 0;

    const container = document.getElementById('chapter-images');
    if (!container) return;

    // El deslizamiento para pasar de página solo tiene sentido sobre el
    // propio contenedor de imágenes (ver bindSwipeToTurnPage); el toggle de
    // cabecera/pie al clicar se engancha una sola vez a nivel de documento
    // (ver bindGlobalChromeToggle), para que funcione en cualquier punto de
    // la pantalla y no solo encima de una imagen.
    bindSwipeToTurnPage(container);

    if (getReadingMode() !== 'paginated' || !wrappers.length) {
        wrappers.forEach(w => w.classList.remove('page-hidden'));
        container.classList.remove('paginated');
        return;
    }

    container.classList.add('paginated');
    renderCurrentPage();
}

function renderCurrentPage() {
    pageWrappers.forEach((wrapper, i) => {
        wrapper.classList.toggle('page-hidden', i !== currentPage);
    });
    if (pageChangeCallback) pageChangeCallback(currentPage, pageWrappers.length);
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

// --- Cabecera/pie: ocultos por defecto, aparecen con una animación suave al
// tocar/clicar la pantalla (mismo patrón que el lector de libros). ---

let chromeVisible = false;

function setReaderChromeVisible(visible) {
    chromeVisible = visible;
    document.querySelectorAll('.reader-chrome').forEach(el => el.classList.toggle('visible', visible));
}

function toggleReaderChrome() {
    setReaderChromeVisible(!chromeVisible);
}

// Clic en cualquier parte de la pantalla (documento entero, no solo sobre
// las imágenes) alterna la cabecera/pie — salvo que el clic haya sido sobre
// la propia cabecera/pie (un control, un botón: no tiene sentido ocultarlos
// justo cuando se está interactuando con ellos), justo después de un
// deslizamiento real (ver bindSwipeToTurnPage), o —en modo 'edge-click'—
// sobre uno de los bordes de las imágenes, que pasan de página en vez de
// alternar la interfaz.
function bindGlobalChromeToggle() {
    document.addEventListener('click', e => {
        if (e.target.closest('.reader-chrome')) return;
        // No interferir con el clic de "reintentar" de una imagen que falló al cargar
        if (e.target.closest('.chapter-image-error')) return;
        if (justSwiped) {
            justSwiped = false;
            return;
        }

        if (isPaginatedMode() && getPageTurnMode() === 'edge-click') {
            const container = document.getElementById('chapter-images');
            if (container && container.contains(e.target)) {
                const rect = container.getBoundingClientRect();
                const relX = (e.clientX - rect.left) / rect.width;
                if (relX < EDGE_ZONE_FRACTION) { goToPage(-1); return; }
                if (relX > 1 - EDGE_ZONE_FRACTION) { goToPage(1); return; }
                // zona central: sigue el flujo normal de abajo (alternar cabecera/pie)
            }
        }

        toggleReaderChrome();
    });
}
bindGlobalChromeToggle();

// Se engancha una sola vez sobre #chapter-images (el propio contenedor no se
// recrea entre capítulos, solo su contenido). Pointer Events en vez de
// touchstart/touchend: se disparan igual con el dedo que con el ratón, así
// que el mismo código sirve para táctil y para arrastrar con el ratón en PC.
function bindSwipeToTurnPage(container) {
    if (container.dataset.pageTurnBound) return;
    container.dataset.pageTurnBound = 'true';

    container.addEventListener('pointerdown', e => {
        if (!isPaginatedMode() || getPageTurnMode() !== 'swipe') return;
        pointerStartX = e.clientX;
        pointerStartY = e.clientY;
        // Sin esto, un arrastre rápido con el ratón que termine con el
        // cursor fuera de #chapter-images (facilísimo: la imagen puede ser
        // más alta que la ventana, o el arrastre se pasa del ancho del
        // contenedor) hace que el pointerup no llegue a este listener en
        // absoluto — el navegador lo entrega al elemento que quede debajo
        // del cursor al soltar, no al que empezó el gesto. En táctil esto no
        // pasa porque el navegador ya "captura" el dedo al elemento inicial
        // por su cuenta; con ratón hay que pedirlo explícitamente. Sin este
        // fix el swipe con ratón solo funcionaba si por casualidad se
        // soltaba dentro del contenedor — de ahí que "casi nunca" se pillara.
        try { container.setPointerCapture(e.pointerId); } catch { /* pointer ya no activo, ignorar */ }
    });

    container.addEventListener('pointerup', e => {
        if (!isPaginatedMode() || pointerStartX === null) return;
        const dx = e.clientX - pointerStartX;
        const dy = e.clientY - pointerStartY;
        pointerStartX = null;
        try { container.releasePointerCapture(e.pointerId); } catch { /* ya liberado, ignorar */ }
        if (Math.abs(dx) < SWIPE_THRESHOLD_PX || Math.abs(dx) <= Math.abs(dy)) return;
        justSwiped = true;
        goToPage(dx < 0 ? 1 : -1);
    });

    // Deslizar con dos dedos en un trackpad no genera eventos de puntero en
    // absoluto (ni touch ni mouse) — el navegador lo entrega como eventos
    // 'wheel' con deltaX. Se acumula el desplazamiento horizontal de la
    // ráfaga de eventos que compone un solo gesto (se resetea tras 150ms sin
    // nuevos eventos) y, al cruzar el umbral, se pasa de página y se ignora
    // el resto de esa ráfaga (evita pasar varias páginas de golpe por la
    // inercia del propio trackpad tras el gesto).
    let wheelAccumX = 0;
    let wheelResetTimer = null;
    let wheelCooldown = false;

    container.addEventListener('wheel', e => {
        if (!isPaginatedMode() || getPageTurnMode() !== 'swipe') return;
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // scroll vertical normal, no interferir
        e.preventDefault();
        if (wheelCooldown) return;

        wheelAccumX += e.deltaX;
        clearTimeout(wheelResetTimer);
        wheelResetTimer = setTimeout(() => { wheelAccumX = 0; }, 150);

        if (Math.abs(wheelAccumX) < SWIPE_THRESHOLD_PX) return;
        goToPage(wheelAccumX < 0 ? -1 : 1);
        wheelAccumX = 0;
        wheelCooldown = true;
        setTimeout(() => { wheelCooldown = false; }, 600);
    }, { passive: false });
}
