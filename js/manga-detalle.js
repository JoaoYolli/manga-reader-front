// detail.js

// Dirección del backend
const back = "https://manga-back.yolli.xyz";

let currentToken = null;
let currentUser = null;
let currentMangaThumbnailUrl = null;

// --- Helpers para localStorage ---
function getToken() {
    return localStorage.getItem("token");
}

function getUser() {
    return localStorage.getItem("user");
}

// --- Validar token ---
async function checkToken() {
    const token = getToken();
    if (!token) {
        window.location.href = "../index.html";
        return false;
    }
    currentToken = token;

    try {
        const res = await fetch(back + "/validate_token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
        });
        if (res.status !== 200) {
            window.location.href = "../index.html";
            return false;
        }
        currentUser = getUser();
        if (!currentUser) console.error("Usuario no definido en localStorage.");
        return true;
    } catch (err) {
        console.error("Error validando token:", err);
        window.location.href = "../index.html";
        return false;
    }
}

// --- Obtener detalles del manga desde la API externa ---
async function getMangaDetails() {
    const params = new URLSearchParams(window.location.search);
    const title = params.get('id');
    const cid = params.get('cid');
    if (!title || !cid) return;

    const url = `https://jimov-api.vercel.app/manga/inmanga/name/${encodeURIComponent(title)}?cid=${cid}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data) {
            if (data.thumbnail?.url) {
                currentMangaThumbnailUrl = data.thumbnail.url;
                document.body.style.backgroundImage = `url(${data.thumbnail.url})`;
            }
            document.getElementById("manga-title").textContent = data.name;
            // textContent, no innerHTML: la sinopsis viene de la API de
            // terceros (jimov-api/InManga) sin sanear — si alguna vez trae
            // HTML/script, con innerHTML se ejecutaría en la app y podría
            // robar el token de localStorage de quien la esté viendo.
            const detailsEl = document.getElementById("manga-details");
            detailsEl.innerHTML = "";
            const synopsisEl = document.createElement("p");
            synopsisEl.className = "manga-synopsis";
            synopsisEl.textContent = data.synopsis || "";
            detailsEl.appendChild(synopsisEl);
            renderChapters(data.chapters, title, cid);
        }
    } catch (err) {
        console.error("Error obteniendo detalles del manga:", err);
    }
}

// --- Renderizar lista de capítulos ---
let currentChapters = [];
let currentMangaTitle = null;
let currentMangaCid = null;

function renderChapters(chapters, title, cid) {
    const container = document.getElementById("chapters-list");
    currentChapters = chapters;
    currentMangaTitle = title;
    currentMangaCid = cid;

    // Limpiar lista sin eliminar controles
    Array.from(container.children).forEach(child => {
        if (!child.classList.contains('mark-up-to')) container.removeChild(child);
    });

    // Ordenar capítulos por número
    const sorted = [...chapters].sort((a, b) => Number(a.num) - Number(b.num));
    const maxNum = sorted.length ? Number(sorted.at(-1).num) : 0;

    // Configurar input de "marcar hasta"
    const input = document.getElementById('mark-up-to-input');
    input.max = maxNum;

    document.getElementById('mark-up-to-btn').onclick = async () => {
        const val = Number(input.value);
        if (isNaN(val) || val < 1 || val > maxNum) {
            return alert(`Introduce un número válido entre 1 y ${maxNum}`);
        }

        const confirm = await showConfirmationModal(`¿Estás seguro de marcar como leídos los capítulos del 1 al ${val}?`);
        if (!confirm) return;

        for (let i = 1; i <= val; i++) {
            await markChapterAsRead(i);
        }
        getFinishedChapters();
    };

    // Renderizar cada capítulo
    sorted.forEach(ch => {
        const chapterNum = Number(ch.num);

        const item = document.createElement('div');
        item.classList.add('chapter');
        item.setAttribute('data-chapter-number', ch.num);

        const link = document.createElement('a');
        link.href = `chapter.html?manga=${encodeURIComponent(title)}&cid=${cid}&chapter=${ch.num}`;

        const numChip = document.createElement('span');
        numChip.className = 'chip mono chapter-num-chip';
        numChip.textContent = `Cap. ${ch.num}`;

        const titleText = document.createElement('span');
        titleText.className = 'chapter-title-text';
        titleText.textContent = ch.name || `Capítulo ${ch.num}`;

        link.append(numChip, titleText);

        const btn = document.createElement('button');
        btn.classList.add('download-btn');
        btn.setAttribute('aria-label', 'Descargar capítulo');
        btn.innerHTML = '<span class="icon icon-download"></span><span class="icon icon-check"></span>';
        // Se asocia el botón a su id de descarga siempre al renderizarlo, no
        // solo al hacer click: si la descarga sigue en curso de una carga de
        // página anterior, el botón nuevo tiene que poder recibir igual el
        // aviso de 'download-complete' cuando termine.
        chapterButtonsById.set(generateDownloadId(title, ch.num), btn);
        btn.addEventListener('click', async e => {
            e.preventDefault();
            if (btn.classList.contains('downloaded')) {
                const overwrite = await showConfirmationModal('Este capítulo ya está descargado. ¿Quieres volver a descargarlo?');
                if (!overwrite) return;
            }
            downloadChapter(ch.num, title, cid, ch.name, `https://jimov-api.vercel.app${ch.url}`);
        });

        item.append(link, btn);
        container.appendChild(item);

        bindChapterSelection(item, link, chapterNum);
    });
}

// --- Selección múltiple por pulsación larga ---
// No sustituye a "marcar leído hasta N" (arriba): esa sigue sirviendo para
// tandas grandes desde el 1. Esto es para elegir capítulos sueltos o un
// rango pequeño a mano, tanto para marcar como leídos como para descargar
// varios de una vez.
const LONG_PRESS_MS = 500;
let selectionMode = false;
const selectedChapters = new Set(); // números de capítulo
let selectionToolbarEl = null;

function getChapterItemEls() {
    return Array.from(document.getElementById('chapters-list').getElementsByClassName('chapter'));
}

function bindChapterSelection(item, link, chapterNum) {
    let pressTimer = null;

    item.addEventListener('pointerdown', e => {
        if (e.target.closest('.download-btn')) return;
        if (e.button !== undefined && e.button !== 0) return;
        clearTimeout(pressTimer);
        item.classList.add('pressing');
        pressTimer = setTimeout(() => {
            item.classList.remove('pressing');
            item.dataset.longPressFired = 'true';
            if (!selectionMode) enterSelectionMode();
            toggleSelection(chapterNum, item);
            if (navigator.vibrate) navigator.vibrate(15);
        }, LONG_PRESS_MS);
    });

    ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt => {
        item.addEventListener(evt, () => {
            clearTimeout(pressTimer);
            item.classList.remove('pressing');
        });
    });

    item.addEventListener('contextmenu', e => {
        if (selectionMode) e.preventDefault();
    });

    link.addEventListener('click', e => {
        if (selectionMode) {
            e.preventDefault();
            toggleSelection(chapterNum, item);
            return;
        }
        if (item.dataset.longPressFired === 'true') {
            // El click que el navegador dispara justo después del long-press
            // no debe navegar al capítulo.
            e.preventDefault();
            delete item.dataset.longPressFired;
        }
    });

    item.addEventListener('click', e => {
        if (!selectionMode) return;
        if (e.target.closest('a') || e.target.closest('.download-btn')) return;
        toggleSelection(chapterNum, item);
    });
}

function toggleSelection(chapterNum, item) {
    if (selectedChapters.has(chapterNum)) {
        selectedChapters.delete(chapterNum);
        item.classList.remove('selected');
    } else {
        selectedChapters.add(chapterNum);
        item.classList.add('selected');
    }
    if (selectedChapters.size === 0) exitSelectionMode();
    else updateSelectionToolbar();
}

function enterSelectionMode() {
    selectionMode = true;
    document.getElementById('chapters-list').classList.add('selection-mode');
    ensureSelectionToolbar();
    updateSelectionToolbar();
}

function exitSelectionMode() {
    selectionMode = false;
    selectedChapters.clear();
    document.getElementById('chapters-list').classList.remove('selection-mode');
    getChapterItemEls().forEach(item => item.classList.remove('selected'));
    if (selectionToolbarEl) {
        selectionToolbarEl.remove();
        selectionToolbarEl = null;
    }
}

function updateSelectionToolbar() {
    if (!selectionToolbarEl) return;
    const count = selectedChapters.size;
    selectionToolbarEl.querySelector('.selection-toolbar-count').textContent =
        `${count} seleccionado${count === 1 ? '' : 's'}`;
}

function ensureSelectionToolbar() {
    if (selectionToolbarEl) return selectionToolbarEl;

    const bar = document.createElement('div');
    bar.className = 'selection-toolbar';
    bar.innerHTML = `
        <span class="selection-toolbar-count mono"></span>
        <div class="selection-toolbar-actions">
            <button id="selection-select-all" class="btn-ghost btn-sm" type="button">Todos</button>
            <button id="selection-mark-read" class="btn-sm" type="button"><span class="icon icon-check"></span>Marcar leídos</button>
            <button id="selection-download" class="btn-sm" type="button"><span class="icon icon-download"></span>Descargar</button>
            <button id="selection-cancel" class="btn-ghost btn-icon" type="button" aria-label="Cancelar selección"><span class="icon icon-close"></span></button>
        </div>`;
    document.body.appendChild(bar);

    bar.querySelector('#selection-select-all').addEventListener('click', () => {
        const items = getChapterItemEls();
        const allSelected = selectedChapters.size === items.length;
        items.forEach(item => {
            const num = Number(item.getAttribute('data-chapter-number'));
            if (allSelected) {
                selectedChapters.delete(num);
                item.classList.remove('selected');
            } else if (!selectedChapters.has(num)) {
                selectedChapters.add(num);
                item.classList.add('selected');
            }
        });
        if (selectedChapters.size === 0) exitSelectionMode();
        else updateSelectionToolbar();
    });

    bar.querySelector('#selection-mark-read').addEventListener('click', async () => {
        const nums = Array.from(selectedChapters);
        if (!nums.length) return;
        const confirmed = await showConfirmationModal(`¿Marcar como leídos ${nums.length} capítulo${nums.length === 1 ? '' : 's'} seleccionado${nums.length === 1 ? '' : 's'}?`);
        if (!confirmed) return;
        for (const num of nums) {
            await markChapterAsRead(num);
        }
        getFinishedChapters();
        exitSelectionMode();
    });

    bar.querySelector('#selection-download').addEventListener('click', () => {
        const nums = Array.from(selectedChapters);
        if (!nums.length || !currentMangaTitle) return;
        nums.forEach(num => {
            const ch = currentChapters.find(c => Number(c.num) === num);
            if (!ch) return;
            const existingBtn = chapterButtonsById.get(generateDownloadId(currentMangaTitle, num));
            if (existingBtn && existingBtn.classList.contains('downloaded')) return; // ya descargado, no repetir
            // forceBaseLayer=true: varias descargas de un solo clic no pueden ir
            // por Background Fetch sin que Chrome muestre el aviso de "varios
            // archivos" (ver comentario en startChapterDownload).
            downloadChapter(ch.num, currentMangaTitle, currentMangaCid, ch.name, `https://jimov-api.vercel.app${ch.url}`, true);
        });
        exitSelectionMode();
    });

    bar.querySelector('#selection-cancel').addEventListener('click', () => exitSelectionMode());

    selectionToolbarEl = bar;
    return bar;
}

// --- Descargar capítulo para lectura offline ---
// El fetch de las imágenes y el guardado en IndexedDB los hace el Service
// Worker (o Background Fetch en Chromium/Android) vía download-manager.js,
// no esta página — así la descarga sigue aunque se navegue a otra página de
// la PWA. Aquí solo se arma la lista de imágenes y se marca el botón como
// descargado cuando llega el aviso de finalización.
const chapterButtonsById = new Map(); // downloadId -> <button>

if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', event => {
        const data = event.data || {};
        if (data.type !== 'download-complete') return;
        const btn = chapterButtonsById.get(data.id);
        if (btn) btn.classList.add('downloaded');
    });
}

async function downloadChapter(chapterNumber, mangaTitle, cid, chapterTitle, url, forceBaseLayer = false) {
    try {
        const res = await fetch(url);
        const data = await res.json();
        const images = data.images || [];
        if (!images.length) {
            console.error("No hay imágenes");
            return;
        }

        const mangaMeta = await getOfflineManga(mangaTitle);
        const needsThumbnail = !mangaMeta?.thumbnail && currentMangaThumbnailUrl;

        await startChapterDownload({
            mangaTitle, cid, chapterNumber, chapterTitle,
            imageUrls: images.map(img => img.url),
            thumbnailUrl: needsThumbnail ? currentMangaThumbnailUrl : null,
            token: currentToken,
            backendUrl: back,
            forceBaseLayer
        });
    } catch (err) {
        console.error("Error descargando capítulo:", err);
    }
}

// --- Favoritos ---
async function getFavorites() {
    if (!currentUser) return [];
    try {
        const res = await fetch(back + "/get_favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: currentToken, username: currentUser })
        });
        if (res.ok) {
            const data = await res.json();
            return data.favorites || [];
        }
    } catch (err) {
        console.error("Error al obtener favoritos:", err);
    }
    return [];
}

async function toggleFavorite(mangaName, isFavorite) {
    if (!currentUser) return;
    const url = isFavorite ? back + "/add_fav" : back + "/remove_fav";
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: currentToken, username: currentUser, mangaName })
        });
        if (!res.ok) console.error("Error al cambiar favorito:", res.statusText);
    } catch (err) {
        console.error("Error al cambiar favorito:", err);
    }
}

async function initializeFavoriteCheckbox() {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get("id");
    if (!mangaTitle) return;

    const favorites = await getFavorites();
    const checkbox = document.getElementById("favorite-checkbox");
    checkbox.checked = favorites.includes(mangaTitle);
    checkbox.addEventListener("change", () => toggleFavorite(mangaTitle, checkbox.checked));
}

// --- Capítulos terminados ---
async function getFinishedChapters() {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get('id');
    if (!mangaTitle) return;

    try {
        const res = await fetch(back + "/get_finished", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: currentToken, username: currentUser, mangaName: mangaTitle })
        });
        if (res.ok) {
            const { finishedChapters = [] } = await res.json();
            const finishedArray = finishedChapters.map(n => parseInt(n, 10));
            markChaptersAsRead(finishedArray);
        }
    } catch (err) {
        console.error("Error al obtener capítulos terminados:", err);
    }
}

// --- Capítulos descargados offline ---
async function markChaptersOffline() {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get('id');
    if (!mangaTitle) return;

    const offlineChapters = await listOfflineChapters(mangaTitle);
    const offlineSet = new Set(offlineChapters.map(ch => ch.chapterNumber));

    const list = document.getElementById("chapters-list");
    Array.from(list.getElementsByClassName('chapter')).forEach(item => {
        const num = parseInt(item.getAttribute('data-chapter-number'), 10);
        if (offlineSet.has(num)) {
            item.querySelector('.download-btn')?.classList.add('downloaded');
        }
    });
}

function markChaptersAsRead(finishedArray) {
    const list = document.getElementById("chapters-list");
    Array.from(list.getElementsByClassName('chapter')).forEach(item => {
        const num = parseInt(item.getAttribute('data-chapter-number'), 10);
        if (finishedArray.includes(num)) item.classList.add('read');
    });
}

function hideReaden() {
    const list = document.getElementById("chapters-list");
    Array.from(list.getElementsByClassName('read')).forEach(item => {
        item.style.display = 'none'; // Oculta el elemento
    });
}

// Nueva función para volver a mostrar los capítulos leídos
function showReaden() {
    const list = document.getElementById("chapters-list");
    Array.from(list.getElementsByClassName('read')).forEach(item => {
        item.style.display = ''; // Restablece el display por defecto
    });
}

async function markChapterAsRead(chapterNumber) {
    try {
        const res = await fetch(back + "/add_finished", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token: currentToken,
                username: currentUser,
                mangaName: new URLSearchParams(window.location.search).get('id'),
                chapterNumber
            })
        });
        if (!res.ok) console.error("Error marcando capítulo leído:", res.statusText);
    } catch (err) {
        console.error("Error marcando capítulo leído:", err);
    }
}

// --- Modal de confirmación ---
function showConfirmationModal(message) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML =
            `<div class="modal-card">
                <p style="color:var(--color-ink);">${message}</p>
                <div style="display:flex; gap:0.5rem;">
                    <button id="confirm-yes" class="btn-primary">Sí</button>
                    <button id="confirm-no" class="btn-ghost">No</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        modal.querySelector('#confirm-yes').addEventListener('click', () => {
            resolve(true);
            document.body.removeChild(modal);
        });
        modal.querySelector('#confirm-no').addEventListener('click', () => {
            resolve(false);
            document.body.removeChild(modal);
        });
    });
}

// --- Inicialización al cargar la página ---
window.onload = async function () {
    if (!(await checkToken())) return;
    await getMangaDetails();
    await getFinishedChapters();
    await markChaptersOffline();
    await initializeFavoriteCheckbox();
    document.getElementById('toggle-read').addEventListener('change', async function () {
        if (this.checked) {
            showReaden();
        }
        else {
            hideReaden();
        }
    });
};
