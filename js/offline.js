// offline.js — grid de mangas descargados

document.addEventListener('DOMContentLoaded', async () => {
  const mangas = await listOfflineMangas();
  const container = document.getElementById('favorites');
  const emptyMessage = document.getElementById('empty-message');
  const totalEl = document.getElementById('storage-total');

  if (!mangas.length) {
    emptyMessage.style.display = 'block';
    return;
  }

  const totalBytes = mangas.reduce((sum, m) => sum + (m.sizeBytes || 0), 0);
  const totalChapters = mangas.reduce((sum, m) => sum + (m.chapterCount || 0), 0);
  if (totalEl) {
    totalEl.textContent =
      `${formatBytes(totalBytes)} en total · ${mangas.length} manga${mangas.length === 1 ? '' : 's'} · ${totalChapters} capítulo${totalChapters === 1 ? '' : 's'}`;
  }

  mangas.forEach(manga => {
    const card = document.createElement('div');
    card.classList.add('manga-card');
    card.addEventListener('click', () => {
      window.location.href = `offline-manga.html?manga=${encodeURIComponent(manga.mangaTitle)}&cid=${encodeURIComponent(manga.cid)}`;
    });
    if (window.isTvMode) makeTvFocusable(card);

    const img = document.createElement('img');
    img.src = manga.thumbnail ? URL.createObjectURL(manga.thumbnail) : 'https://via.placeholder.com/150';
    card.appendChild(img);

    const title = document.createElement('h3');
    title.textContent = manga.mangaTitle;
    card.appendChild(title);

    const meta = document.createElement('p');
    meta.className = 'manga-card-meta mono';
    meta.textContent = `${manga.chapterCount} cap. · ${formatBytes(manga.sizeBytes)}`;
    card.appendChild(meta);

    container.appendChild(card);
  });
});
