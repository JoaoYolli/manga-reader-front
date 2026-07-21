// offline-manga.js — lista de capítulos descargados de un manga

function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return { mangaTitle: params.get('manga'), cid: params.get('cid') };
}

async function renderOfflineChapters() {
    const { mangaTitle } = getQueryParams();
    if (!mangaTitle) return;

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

    chapters.forEach(ch => {
        const item = document.createElement('div');
        item.classList.add('chapter');
        item.setAttribute('data-chapter-number', ch.chapterNumber);

        const link = document.createElement('a');
        link.href = `offline-chapter.html?manga=${encodeURIComponent(mangaTitle)}&chapter=${ch.chapterNumber}`;
        link.textContent = ch.chapterTitle || `Capítulo ${ch.chapterNumber}`;

        const deleteBtn = document.createElement('button');
        deleteBtn.classList.add('delete-btn');
        deleteBtn.addEventListener('click', async e => {
            e.preventDefault();
            if (!confirm(`¿Eliminar el capítulo ${ch.chapterNumber} descargado?`)) return;
            await deleteOfflineChapter(mangaTitle, ch.chapterNumber);
            renderOfflineChapters();
        });

        item.append(link, deleteBtn);
        container.appendChild(item);
    });
}

document.addEventListener('DOMContentLoaded', renderOfflineChapters);
