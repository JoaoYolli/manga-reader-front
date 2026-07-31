// offline-manga.js — lista de capítulos descargados de un manga

function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return { mangaTitle: params.get('manga'), cid: params.get('cid') };
}

let currentMangaTitle = null;

async function renderOfflineChapters() {
    const { mangaTitle } = getQueryParams();
    if (!mangaTitle) return;
    currentMangaTitle = mangaTitle;

    const manga = await getOfflineManga(mangaTitle);
    if (manga?.thumbnail) {
        document.body.style.backgroundImage = `url(${URL.createObjectURL(manga.thumbnail)})`;
    }
    document.getElementById('manga-title').textContent = mangaTitle;

    const container = document.getElementById('chapters-list');
    Array.from(container.getElementsByClassName('chapter')).forEach(el => el.remove());

    const chapters = await listOfflineChapters(mangaTitle);

    if (!chapters.length) {
        window.location.href = 'offline.html';
        return;
    }

    const totalEl = document.getElementById('manga-storage-total');
    if (totalEl) {
        const totalBytes = chapters.reduce((sum, ch) => sum + (ch.sizeBytes || 0), 0);
        totalEl.textContent = `${formatBytes(totalBytes)} en ${chapters.length} capítulo${chapters.length === 1 ? '' : 's'}`;
    }

    chapters.forEach(ch => {
        const item = document.createElement('div');
        item.classList.add('chapter');
        item.setAttribute('data-chapter-number', ch.chapterNumber);

        const link = document.createElement('a');
        link.href = `offline-chapter.html?manga=${encodeURIComponent(mangaTitle)}&chapter=${ch.chapterNumber}`;

        const numChip = document.createElement('span');
        numChip.className = 'chip mono chapter-num-chip';
        numChip.textContent = `Cap. ${ch.chapterNumber}`;

        const titleText = document.createElement('span');
        titleText.className = 'chapter-title-text';
        titleText.textContent = ch.chapterTitle || `Capítulo ${ch.chapterNumber}`;

        link.append(numChip, titleText);

        const size = document.createElement('span');
        size.classList.add('chapter-size', 'mono');
        size.textContent = formatBytes(ch.sizeBytes);

        const deleteBtn = document.createElement('button');
        deleteBtn.classList.add('delete-btn');
        deleteBtn.setAttribute('aria-label', 'Eliminar capítulo descargado');
        deleteBtn.innerHTML = '<span class="icon icon-trash"></span>';
        deleteBtn.addEventListener('click', async e => {
            e.preventDefault();
            if (!confirm(`¿Eliminar el capítulo ${ch.chapterNumber} descargado (${formatBytes(ch.sizeBytes)})?`)) return;
            await deleteOfflineChapter(mangaTitle, ch.chapterNumber);
            renderOfflineChapters();
        });

        item.append(link, size, deleteBtn);
        container.appendChild(item);

        bindChapterSelection(item, link, ch.chapterNumber);
    });
}

document.addEventListener('DOMContentLoaded', renderOfflineChapters);

// --- Selección múltiple por pulsación larga (borrar en tandas) ---
// Mismo patrón que en manga-detalle.js (misma barra flotante y CSS de
// selección), adaptado para borrar en vez de marcar leído/descargar.
// Seleccionar "Todos" + Eliminar cubre también "borrar el manga entero de
// una vez" — al quedar 0 capítulos, renderOfflineChapters() ya redirige
// sola a offline.html.
const LONG_PRESS_MS = 500;
let selectionMode = false;
const selectedChapters = new Set();
let selectionToolbarEl = null;

function getChapterItemEls() {
    return Array.from(document.getElementById('chapters-list').getElementsByClassName('chapter'));
}

function bindChapterSelection(item, link, chapterNumber) {
    let pressTimer = null;

    item.addEventListener('pointerdown', e => {
        if (e.target.closest('.delete-btn')) return;
        if (e.button !== undefined && e.button !== 0) return;
        clearTimeout(pressTimer);
        item.classList.add('pressing');
        pressTimer = setTimeout(() => {
            item.classList.remove('pressing');
            item.dataset.longPressFired = 'true';
            if (!selectionMode) enterSelectionMode();
            toggleSelection(chapterNumber, item);
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
            toggleSelection(chapterNumber, item);
            return;
        }
        if (item.dataset.longPressFired === 'true') {
            e.preventDefault();
            delete item.dataset.longPressFired;
        }
    });

    item.addEventListener('click', e => {
        if (!selectionMode) return;
        if (e.target.closest('a') || e.target.closest('.delete-btn')) return;
        toggleSelection(chapterNumber, item);
    });
}

function toggleSelection(chapterNumber, item) {
    if (selectedChapters.has(chapterNumber)) {
        selectedChapters.delete(chapterNumber);
        item.classList.remove('selected');
    } else {
        selectedChapters.add(chapterNumber);
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
            <button id="selection-delete" class="btn-sm" type="button"><span class="icon icon-trash"></span>Eliminar</button>
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

    bar.querySelector('#selection-delete').addEventListener('click', async () => {
        const nums = Array.from(selectedChapters);
        if (!nums.length || !currentMangaTitle) return;

        const confirmed = confirm(`¿Eliminar ${nums.length} capítulo${nums.length === 1 ? '' : 's'} descargado${nums.length === 1 ? '' : 's'}?`);
        if (!confirmed) return;

        for (const num of nums) {
            await deleteOfflineChapter(currentMangaTitle, num);
        }
        exitSelectionMode();
        renderOfflineChapters();
    });

    bar.querySelector('#selection-cancel').addEventListener('click', () => exitSelectionMode());

    selectionToolbarEl = bar;
    return bar;
}
