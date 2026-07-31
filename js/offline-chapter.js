// offline-chapter.js — lector de capítulos descargados

let offlineChapters = [];
let currentMangaTitle = null;
let currentChapterNumber = null;

function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
        mangaTitle: params.get('manga'),
        chapterNumber: params.get('chapter')
    };
}

async function loadChapter() {
    const { mangaTitle, chapterNumber } = getQueryParams();
    if (!mangaTitle || !chapterNumber) return;

    currentMangaTitle = mangaTitle;
    currentChapterNumber = Number(chapterNumber);

    offlineChapters = await listOfflineChapters(mangaTitle);
    if (!offlineChapters.length) {
        window.location.href = 'offline.html';
        return;
    }

    const chapter = await getOfflineChapter(mangaTitle, currentChapterNumber);
    if (!chapter) {
        window.location.href = `offline-manga.html?manga=${encodeURIComponent(mangaTitle)}`;
        return;
    }

    document.getElementById('chapter-title').textContent =
        chapter.chapterTitle || `Capítulo ${chapter.chapterNumber}: ${mangaTitle}`;

    const imagesContainer = document.getElementById('chapter-images');
    renderChapterImages(imagesContainer, chapter.pages, (blob, i) => ({
        src: URL.createObjectURL(blob),
        alt: `Página ${i + 1}`
    }));
    if (typeof initReadingProgress === 'function') {
        initReadingProgress(mangaTitle, chapter.chapterNumber);
    }

    populateChapterSelector();
    showNavigationButtons();
}

function populateChapterSelector() {
    const select = document.getElementById('chapter-select');
    select.innerHTML = '';
    offlineChapters.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.chapterNumber;
        opt.textContent = ch.chapterTitle || `Capítulo ${ch.chapterNumber}`;
        select.appendChild(opt);
    });
    select.value = currentChapterNumber;
}

function loadChapterFromSelector() {
    const select = document.getElementById('chapter-select');
    window.location.href = `offline-chapter.html?manga=${encodeURIComponent(currentMangaTitle)}&chapter=${select.value}`;
}

function showNavigationButtons() {
    const prevBtn = document.getElementById('prev-chapter');
    const nextBtn = document.getElementById('next-chapter');
    const idx = offlineChapters.findIndex(ch => ch.chapterNumber === currentChapterNumber);

    prevBtn.style.display = idx > 0 ? 'inline-block' : 'none';
    nextBtn.style.display = idx < offlineChapters.length - 1 ? 'inline-block' : 'none';

    prevBtn.onclick = () => navigateChapter(-1);
    nextBtn.onclick = () => navigateChapter(1);
    document.getElementById('navigation-buttons').style.display = 'block';
}

function navigateChapter(direction) {
    const idx = offlineChapters.findIndex(ch => ch.chapterNumber === currentChapterNumber);
    const nextIdx = idx + direction;
    if (nextIdx < 0 || nextIdx >= offlineChapters.length) return;

    const nextCh = offlineChapters[nextIdx];
    window.location.href = `offline-chapter.html?manga=${encodeURIComponent(currentMangaTitle)}&chapter=${nextCh.chapterNumber}`;
}

function redirectToOfflineManga() {
    if (currentMangaTitle) {
        window.location.href = `offline-manga.html?manga=${encodeURIComponent(currentMangaTitle)}`;
    }
}

window.onload = loadChapter;
