// libro-lector.js — lector de EPUB/PDF con progreso sincronizado con el
// backend (a diferencia de reading-progress.js del manga, que se queda
// deliberadamente solo en localStorage — aquí el usuario pidió poder
// retomar el libro desde cualquier dispositivo).

const back = "https://manga-back.yolli.xyz";

const SUPPORTED_BOOK_FORMATS = ["epub", "pdf"];

const params = new URLSearchParams(window.location.search);
const bookId = params.get("id");
const bookFormat = (bookId || "").split(".").pop().toLowerCase();

let currentFormat = null;
let epubBook = null;
let epubRendition = null;
let pdfDoc = null;
let currentPdfPage = 1;
let pdfTotalPages = 1;

// --- Cabecera/pie: ocultos por defecto, aparecen con una animación suave al
// tocar/clicar la pantalla (igual que la mayoría de lectores de ebooks: el
// gesto de deslizar queda libre para pasar de página, ver más abajo). ---

let chromeVisible = false;

function setChromeVisible(visible) {
    chromeVisible = visible;
    document.querySelector("header").classList.toggle("visible", visible);
    document.getElementById("reader-nav").classList.toggle("visible", visible);
}

function toggleChrome() {
    setChromeVisible(!chromeVisible);
}

// --- Gesto compartido por EPUB y PDF, según getPageTurnMode() (ver
// settings.js, elegido en el modal de Ajustes):
// - 'swipe' (por defecto): deslizar pasa de página; un toque/clic que NO fue
//   un deslizamiento alterna la cabecera/pie.
// - 'edge-click': tocar/clicar el borde izquierdo/derecho pasa de página, el
//   centro sigue alternando la cabecera/pie. El deslizamiento se desactiva
//   en este modo (elección excluyente, igual que en el manga).
// Se expone como un objeto de handlers en vez de atarse directamente a
// addEventListener porque el EPUB no recibe los eventos por el DOM normal
// (el contenido vive dentro de un <iframe> propio) — epub.js los reenvía a
// través de rendition.on(), que tiene una forma de suscripción distinta a
// la de un elemento del DOM.
const SWIPE_THRESHOLD_PX = 50;
const EDGE_ZONE_FRACTION = 0.3;

function createSwipeTapHandler({ onPrev, onNext, onTap, getRelativeX }) {
    let startX = null;
    let startY = null;
    let justSwiped = false;

    return {
        touchstart(e) {
            if (getPageTurnMode() !== 'swipe') return;
            const t = e.touches ? e.touches[0] : e;
            startX = t.clientX;
            startY = t.clientY;
            justSwiped = false;
        },
        touchend(e) {
            if (startX === null) return;
            const t = e.changedTouches ? e.changedTouches[0] : e;
            const dx = t.clientX - startX;
            const dy = t.clientY - startY;
            startX = null;
            if (Math.abs(dx) >= SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy)) {
                justSwiped = true;
                if (dx < 0) onNext(); else onPrev();
            }
        },
        click(e) {
            // Tras un swipe real, el navegador puede disparar igualmente un
            // click sintético al soltar — se ignora esa vez para no alternar
            // la cabecera/pie justo cuando la intención era pasar de página.
            if (justSwiped) {
                justSwiped = false;
                return;
            }
            if (getPageTurnMode() === 'edge-click' && getRelativeX) {
                const relX = getRelativeX(e);
                if (relX !== null) {
                    if (relX < EDGE_ZONE_FRACTION) { onPrev(); return; }
                    if (relX > 1 - EDGE_ZONE_FRACTION) { onNext(); return; }
                }
            }
            onTap();
        }
    };
}

function titleFromId(id) {
    const withoutExt = (id || "").replace(/\.[^.]+$/, "");
    return withoutExt.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

// --- Progreso: buffer local (localStorage, funciona sin red) + best-effort
// hacia el backend cuando hay conexión. ---

function progressKey() {
    return `bookProgress:${bookId}`;
}

function saveLocatorLocal(locator, percent) {
    const entry = { locator, percent: percent ?? null, updatedAt: new Date().toISOString() };
    try {
        localStorage.setItem(progressKey(), JSON.stringify(entry));
    } catch (err) {
        console.warn("No se pudo guardar el progreso local:", err);
    }
    return entry;
}

function loadLocatorLocal() {
    try {
        return JSON.parse(localStorage.getItem(progressKey()));
    } catch {
        return null;
    }
}

async function pushProgressToServer(locator, percent) {
    const token = localStorage.getItem("token");
    if (!token) return false;
    try {
        const res = await fetch(`${back}/books/${encodeURIComponent(bookId)}/progress`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, locator, percent: percent ?? null }),
            signal: AbortSignal.timeout(5000)
        });
        return res.ok;
    } catch {
        return false;
    }
}

// Los cambios de posición son eventos discretos (pasar de página), no un
// scroll continuo, así que se guardan de inmediato sin debounce — mismo
// razonamiento que reading-progress.js aplica a su modo paginado. percent
// (0-100) es lo que permite a la biblioteca (libros.js) clasificar el libro
// entre "en progreso"/"terminado" sin tener que abrirlo — ver
// calculateEpubPercent/calculatePdfPercent más abajo.
function onLocatorChange(locator, percent) {
    saveLocatorLocal(locator, percent);
    if (navigator.onLine) pushProgressToServer(locator, percent);
    saveLocalBookProgress(bookId, locator).catch(() => {});
}

window.addEventListener("online", () => {
    const local = loadLocatorLocal();
    if (local) pushProgressToServer(local.locator, local.percent);
});

// Al abrir el lector: compara el progreso local con el del servidor (si hay
// red) y usa el más reciente — resuelve "leí offline en el móvil y luego
// seguí leyendo online en el portátil".
async function resolveStartingLocator(token) {
    const local = loadLocatorLocal();
    if (!token || !navigator.onLine) return local?.locator || null;

    try {
        const res = await fetch(`${back}/books/progress?token=${encodeURIComponent(token)}`, {
            signal: AbortSignal.timeout(5000)
        });
        if (!res.ok) return local?.locator || null;
        const data = await res.json();
        const server = (data.progress || {})[bookId];

        if (!server) {
            // El servidor no tiene progreso todavía: si hay uno local (se
            // leyó offline antes de haber podido sincronizar nunca), se sube
            // ahora que hay conexión.
            if (local) pushProgressToServer(local.locator, local.percent);
            return local?.locator || null;
        }

        if (!local || new Date(server.updatedAt) > new Date(local.updatedAt)) {
            saveLocatorLocal(server.locator, server.percent);
            return server.locator;
        }

        // El progreso local es más reciente que el del servidor — se leyó
        // offline y no se había podido subir todavía (el listener de
        // 'online' solo cubre el caso de seguir con la página abierta al
        // recuperar conexión, no el de cerrarla y volver más tarde). Se sube
        // ahora que se sabe, con certeza, que hay conexión.
        pushProgressToServer(local.locator, local.percent);
        return local.locator;
    } catch {
        return local?.locator || null;
    }
}

// --- Carga del fichero: primero IndexedDB (offline), si no hay, red. ---

async function loadBookBytes() {
    const offline = await getOfflineBook(bookId);
    if (offline?.fileBlob) {
        return { blob: offline.fileBlob, source: "offline" };
    }
    const token = localStorage.getItem("token");
    const res = await fetch(`${back}/books/${encodeURIComponent(bookId)}/file?token=${encodeURIComponent(token || "")}`, {
        signal: AbortSignal.timeout(20000)
    });
    if (!res.ok) throw new Error("No se pudo descargar el libro");
    return { blob: await res.blob(), source: "network" };
}

// --- EPUB ---

// Un EPUB reflowable no tiene "página" real sin generar locations (una
// operación pesada, recorre todo el contenido) — se aproxima el progreso
// por sección del spine en su lugar (más grueso: un capítulo largo cuenta
// igual que uno corto, pero es gratis y ya lo expone epub.js sin más
// trabajo). location.start.index es el índice de la sección actual dentro
// del spine que entrega el evento 'relocated'.
function calculateEpubPercent(location) {
    const spineItems = epubBook?.spine?.spineItems;
    const index = location?.start?.index;
    if (!spineItems || typeof index !== "number") return null;
    // Algunos EPUB marcan secciones como "linear:false" (p. ej. un índice de
    // contenido al final del fichero, distinto de la tabla de capítulos que
    // sí se lee en orden) — next()/prev() nunca las visita durante una
    // lectura normal, así que contarlas en el total impedía llegar nunca al
    // 100% aunque el usuario hubiera terminado todo el contenido real
    // (confirmado con un EPUB real: la última sección lineal daba 98%, la
    // última sección del spine — el índice, no-lineal — nunca se visitaba).
    // Se cuenta solo cuántas secciones lineales hay hasta la actual
    // (inclusive) sobre el total de secciones lineales del libro.
    const linearItems = spineItems.filter(item => item.linear !== false);
    if (!linearItems.length) return null;
    const passedLinear = spineItems.slice(0, index + 1).filter(item => item.linear !== false).length;
    return Math.round((passedLinear / linearItems.length) * 100);
}

async function initEpubReader(arrayBuffer, startLocator) {
    const book = ePub(arrayBuffer);
    epubBook = book;
    const viewerEl = document.getElementById("epub-viewer");

    // Hay que mostrar el contenedor ANTES de renderTo(): epub.js mide su
    // tamaño de forma síncrona para fijar el alto del <iframe> interno. Con
    // el contenedor todavía en display:none (o pasándole '100%' y dejando
    // que se resuelva contra una cadena de flex:1, que el navegador no
    // siempre trata como una altura "definida" para porcentajes) esa medida
    // sale 0 y el iframe queda con height:0 — el libro "carga" pero no se ve
    // nada, aunque el contenido interno esté bien. Midiendo en píxeles
    // reales tras mostrar el contenedor se evita depender de ese cálculo.
    viewerEl.style.display = "block";

    // epub.js renderiza cada capítulo dentro de un <iframe sandbox>. Por
    // defecto no lleva "allow-scripts" (bloquea scripts del propio EPUB por
    // seguridad) — pero aquí los libros los copia el propio owner a mano
    // (mismo modelo de confianza que el resto de la app), así que se activa
    // para evitar bloqueos si algún capítulo trae un script.
    epubRendition = book.renderTo("epub-viewer", {
        width: viewerEl.clientWidth,
        height: viewerEl.clientHeight,
        allowScriptedContent: true
    });

    // El EPUB trae su propio CSS (normalmente texto negro sobre fondo
    // blanco/transparente) que epub.js aplica dentro del iframe tal cual —
    // el tema oscuro de la app no lo toca porque no es su DOM. Sin esto, en
    // modo oscuro el fondo del visor es oscuro pero el texto del libro sigue
    // negro y queda ilegible. themes.override fuerza estas dos propiedades
    // con prioridad alta sobre el CSS propio del libro, en todas las
    // páginas ya renderizadas y en las que se rendericen después.
    const dark = document.documentElement.classList.contains("dark-theme");
    epubRendition.themes.override("color", dark ? "#ece3d2" : "#211d16", true);
    epubRendition.themes.override("background", dark ? "#2a2319" : "#fbf7ec", true);

    await epubRendition.display(startLocator || undefined);
    epubRendition.on("relocated", location => {
        onLocatorChange(location.start.cfi, calculateEpubPercent(location));
    });

    window.addEventListener("resize", () => {
        epubRendition.resize(viewerEl.clientWidth, viewerEl.clientHeight);
    });

    const gestureHandler = createSwipeTapHandler({
        onPrev: () => epubRendition.prev(),
        onNext: () => epubRendition.next(),
        onTap: toggleChrome,
        // El clic dentro del EPUB llega vía epub.js reenviando el evento
        // original desde dentro del <iframe> — su clientX ya es relativo al
        // propio iframe, que ocupa exactamente viewerEl.clientWidth.
        getRelativeX: e => (typeof e.clientX === "number" ? e.clientX / viewerEl.clientWidth : null)
    });
    epubRendition.on("touchstart", gestureHandler.touchstart);
    epubRendition.on("touchend", gestureHandler.touchend);
    epubRendition.on("click", gestureHandler.click);
}

// --- PDF ---

function clampPdfPage(n) {
    return Math.min(Math.max(1, n), pdfTotalPages || 1);
}

function updatePageIndicator() {
    if (currentFormat !== "pdf") return;
    document.getElementById("page-indicator").textContent = `${currentPdfPage} / ${pdfTotalPages}`;
}

async function renderPdfPage(num) {
    const page = await pdfDoc.getPage(num);
    const canvas = document.getElementById("pdf-canvas");
    const ctx = canvas.getContext("2d");
    const containerWidth = document.getElementById("pdf-viewer").clientWidth || 800;
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale });
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: ctx, viewport }).promise;
    currentPdfPage = num;
    updatePageIndicator();
    const percent = pdfTotalPages ? Math.round((num / pdfTotalPages) * 100) : null;
    onLocatorChange(String(num), percent);
}

async function initPdfReader(arrayBuffer, startLocator) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = "/js/vendor/pdf.worker.min.js";
    const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
    pdfDoc = await loadingTask.promise;
    pdfTotalPages = pdfDoc.numPages;
    const startPage = clampPdfPage(parseInt(startLocator, 10) || 1);
    const pdfViewerEl = document.getElementById("pdf-viewer");
    pdfViewerEl.style.display = "flex";
    await renderPdfPage(startPage);

    // Un PDF es una imagen rasterizada (el canvas), no HTML con su propio
    // CSS como el EPUB — no se puede "recolorear" el texto, así que en modo
    // oscuro se invierte con un filtro CSS (ver .dark-theme #pdf-canvas en
    // libro-lector.css), el truco habitual de los lectores de PDF para un
    // pseudo-modo-oscuro sin tener que re-renderizar la página.
    const gestureHandler = createSwipeTapHandler({
        onPrev: () => renderPdfPage(clampPdfPage(currentPdfPage - 1)),
        onNext: () => renderPdfPage(clampPdfPage(currentPdfPage + 1)),
        onTap: toggleChrome,
        getRelativeX: e => {
            const rect = pdfViewerEl.getBoundingClientRect();
            return rect.width ? (e.clientX - rect.left) / rect.width : null;
        }
    });
    pdfViewerEl.addEventListener("touchstart", gestureHandler.touchstart, { passive: true });
    pdfViewerEl.addEventListener("touchend", gestureHandler.touchend, { passive: true });
    pdfViewerEl.addEventListener("click", gestureHandler.click);
}

// --- Navegación por índice / ir a página (accesibilidad) ---------------
// EPUB: índice real del propio libro (book.navigation.toc, lo pone el autor
// del EPUB) — no hay "número de página" fiable en un libro reflowable sin
// generar locations (una operación pesada, recorre todo el contenido), así
// que aquí solo se ofrece saltar por capítulo.
// PDF: índice si el propio archivo lo trae (pdfDoc.getOutline(), no todos
// los PDF lo tienen) más un campo para ir directamente a un número de
// página, que en PDF sí es un concepto real y barato de usar.

async function resolvePdfDestPageNumber(dest) {
    try {
        let explicitDest = dest;
        if (typeof dest === "string") {
            explicitDest = await pdfDoc.getDestination(dest);
        }
        if (!explicitDest || !explicitDest[0]) return null;
        const pageIndex = await pdfDoc.getPageIndex(explicitDest[0]);
        return pageIndex + 1;
    } catch {
        return null;
    }
}

function renderNavList(items, depth, onPick) {
    const ul = document.createElement("ul");
    ul.className = "book-nav-list";
    items.forEach(item => {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "book-nav-item";
        btn.style.paddingLeft = `${depth}rem`;
        btn.textContent = item.label;
        btn.addEventListener("click", () => {
            item.onSelect().then(onPick).catch(err => {
                console.error("No se pudo navegar a ese punto del libro:", err);
                onPick();
            });
        });
        li.appendChild(btn);
        if (item.children && item.children.length) {
            li.appendChild(renderNavList(item.children, depth + 1, onPick));
        }
        ul.appendChild(li);
    });
    return ul;
}

// El href del índice (nav.xhtml del propio EPUB) a veces no incluye la
// misma carpeta intermedia que el spine real (p. ej. el índice apunta a
// "Capitulo1-1.xhtml" pero el fichero real del spine es
// "Text/Capitulo1-1.xhtml") — confirmado con un EPUB real: epubRendition
// .display() con el href tal cual del índice falla con "No Section Found".
// Se resuelve buscando en el spine un href exacto o que termine en
// "/<href del índice>", que es robusto sin importar la carpeta real.
function resolveEpubHref(href) {
    const clean = (href || "").split("#")[0];
    const spineItems = epubBook.spine.spineItems || [];
    const match = spineItems.find(i => i.href === clean) ||
        spineItems.find(i => i.href.endsWith("/" + clean));
    return match ? match.href : href;
}

function epubTocToNavItems(tocItems) {
    return tocItems.map(item => ({
        label: (item.label || "").trim() || item.href,
        onSelect: async () => { await epubRendition.display(resolveEpubHref(item.href)); },
        children: item.subitems && item.subitems.length ? epubTocToNavItems(item.subitems) : []
    }));
}

function pdfOutlineToNavItems(outlineItems) {
    return outlineItems.map(item => ({
        label: item.title || "(sin título)",
        onSelect: async () => {
            const pageNum = await resolvePdfDestPageNumber(item.dest);
            if (pageNum) renderPdfPage(clampPdfPage(pageNum));
        },
        children: item.items && item.items.length ? pdfOutlineToNavItems(item.items) : []
    }));
}

async function showBookNavigationModal() {
    const modal = document.createElement("div");
    modal.className = "modal-overlay";
    modal.innerHTML = `
    <div class="modal-card book-nav-card">
      <h2>Navegar</h2>
      ${currentFormat === "pdf" ? `
      <div class="book-nav-goto-page">
        <input type="number" id="book-nav-page-input" min="1" max="${pdfTotalPages}" placeholder="Página (1-${pdfTotalPages})">
        <button id="book-nav-page-go" class="btn-primary" type="button">Ir</button>
      </div>` : ""}
      <div id="book-nav-toc"><p class="book-nav-status">Cargando índice…</p></div>
      <button class="btn-ghost" id="book-nav-close" type="button">Cerrar</button>
    </div>`;
    document.body.appendChild(modal);

    function close() {
        modal.remove();
    }
    modal.querySelector("#book-nav-close").addEventListener("click", close);
    modal.addEventListener("click", e => {
        if (e.target === modal) close();
    });

    if (currentFormat === "pdf") {
        const goBtn = modal.querySelector("#book-nav-page-go");
        const pageInput = modal.querySelector("#book-nav-page-input");
        goBtn.addEventListener("click", () => {
            const n = clampPdfPage(parseInt(pageInput.value, 10) || 1);
            renderPdfPage(n);
            close();
        });
        pageInput.addEventListener("keydown", e => {
            if (e.key === "Enter") goBtn.click();
        });
    }

    const tocEl = modal.querySelector("#book-nav-toc");

    try {
        let navItems = [];
        if (currentFormat === "epub" && epubBook) {
            await epubBook.ready;
            navItems = epubTocToNavItems(epubBook.navigation.toc || []);
        } else if (currentFormat === "pdf" && pdfDoc) {
            const outline = await pdfDoc.getOutline();
            navItems = outline ? pdfOutlineToNavItems(outline) : [];
        }

        tocEl.innerHTML = "";
        if (!navItems.length) {
            tocEl.innerHTML = `<p class="book-nav-status">${currentFormat === "pdf" ? "Este PDF no tiene índice." : "Este libro no trae índice de capítulos."}</p>`;
        } else {
            tocEl.appendChild(renderNavList(navItems, 0, close));
        }
    } catch (err) {
        console.error("No se pudo cargar el índice del libro:", err);
        tocEl.innerHTML = '<p class="book-nav-status">No se pudo cargar el índice.</p>';
    }
}

// Flechas del teclado para pasar de página — accesibilidad estándar de
// cualquier lector de ebooks, no depende de a qué modo de pasar página esté
// puesto (swipe/edge-click son gestos de puntero, esto es aparte). No hace
// nada mientras el libro no ha cargado (currentFormat sigue a null) ni si
// el foco está en un campo de formulario (p. ej. escribiendo un número de
// página en el modal de arriba).
document.addEventListener("keydown", e => {
    const tag = document.activeElement?.tagName;
    if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
    if (e.key === "ArrowLeft") {
        if (currentFormat === "epub" && epubRendition) epubRendition.prev();
        else if (currentFormat === "pdf") renderPdfPage(clampPdfPage(currentPdfPage - 1));
    } else if (e.key === "ArrowRight") {
        if (currentFormat === "epub" && epubRendition) epubRendition.next();
        else if (currentFormat === "pdf") renderPdfPage(clampPdfPage(currentPdfPage + 1));
    }
});

document.getElementById("book-nav-btn")?.addEventListener("click", showBookNavigationModal);

// --- Navegación ---

document.getElementById("prev-page-btn")?.addEventListener("click", () => {
    if (currentFormat === "epub" && epubRendition) epubRendition.prev();
    else if (currentFormat === "pdf") renderPdfPage(clampPdfPage(currentPdfPage - 1));
});

document.getElementById("next-page-btn")?.addEventListener("click", () => {
    if (currentFormat === "epub" && epubRendition) epubRendition.next();
    else if (currentFormat === "pdf") renderPdfPage(clampPdfPage(currentPdfPage + 1));
});

// --- Descarga para lectura offline (fetch único, sin la maquinaria de
// Background Fetch/SW de los capítulos de manga — un libro es un solo
// fichero, no docenas de imágenes). ---

// Aviso breve arriba de la pantalla (mismo patrón que .resume-toast de
// reading-progress.js) — el botón de descarga es solo un icono, y antes el
// único cambio visible al terminar era el atributo title (un tooltip que
// solo se ve pasando el ratón por encima, invisible en táctil): sin esto,
// una descarga que funciona perfectamente parece no hacer nada.
function showDownloadToast(message) {
    let toast = document.getElementById("download-toast");
    if (!toast) {
        toast = document.createElement("div");
        toast.id = "download-toast";
        toast.className = "download-toast";
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(showDownloadToast._timer);
    showDownloadToast._timer = setTimeout(() => toast.classList.remove("visible"), 3000);
}

function setupDownloadButton(title, alreadyFetchedBlob) {
    const btn = document.getElementById("download-book-btn");
    if (!btn) return;
    const icon = btn.querySelector(".icon");

    function setDownloadedState() {
        icon.classList.remove("icon-download", "spinning");
        icon.classList.add("icon-check");
        btn.disabled = true;
        btn.title = "Ya descargado para leer sin conexión";
    }

    getOfflineBook(bookId).then(existing => {
        if (existing) setDownloadedState();
    });

    btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.title = "Descargando…";
        icon.classList.add("spinning");
        try {
            let blob = alreadyFetchedBlob;
            if (!blob) {
                const token = localStorage.getItem("token");
                const res = await fetch(`${back}/books/${encodeURIComponent(bookId)}/file?token=${encodeURIComponent(token || "")}`);
                if (!res.ok) throw new Error("No se pudo descargar el libro");
                blob = await res.blob();
            }
            await saveBookOffline({ id: bookId, title, format: currentFormat, fileBlob: blob });
            setDownloadedState();
            showDownloadToast("Libro descargado para leer sin conexión");
        } catch (err) {
            console.error("No se pudo descargar el libro para lectura offline:", err);
            icon.classList.remove("spinning");
            btn.disabled = false;
            btn.title = "Descargar para leer sin conexión";
            showDownloadToast("No se pudo descargar el libro");
        }
    });
}

// --- Arranque ---

async function initReader() {
    const statusEl = document.getElementById("reader-status");
    const titleEl = document.getElementById("book-title");
    const title = titleFromId(bookId);
    titleEl.textContent = title;
    document.title = title;

    if (!bookId || !SUPPORTED_BOOK_FORMATS.includes(bookFormat)) {
        statusEl.textContent = "Libro no válido.";
        return;
    }

    let blobInfo;
    try {
        blobInfo = await loadBookBytes();
    } catch (err) {
        statusEl.textContent = "Este libro no está descargado y no hay conexión para obtenerlo.";
        return;
    }

    currentFormat = bookFormat;
    const token = localStorage.getItem("token");
    const startLocator = await resolveStartingLocator(token);
    const arrayBuffer = await blobInfo.blob.arrayBuffer();

    statusEl.style.display = "none";

    try {
        if (bookFormat === "epub") {
            await initEpubReader(arrayBuffer, startLocator);
        } else if (bookFormat === "pdf") {
            await initPdfReader(arrayBuffer, startLocator);
        }
    } catch (err) {
        console.error("Error renderizando el libro:", err);
        statusEl.style.display = "block";
        statusEl.textContent = "No se pudo abrir el libro.";
        return;
    }

    setupDownloadButton(title, blobInfo.blob);

    const navBtn = document.getElementById("book-nav-btn");
    if (navBtn) navBtn.style.display = "";
}

document.addEventListener("DOMContentLoaded", initReader);
