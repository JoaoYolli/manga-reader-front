// offline.js — grid de mangas descargados

document.addEventListener('DOMContentLoaded', async () => {
  const mangas = await listOfflineMangas();
  const container = document.getElementById('favorites');
  const emptyMessage = document.getElementById('empty-message');

  if (!mangas.length) {
    emptyMessage.style.display = 'block';
    return;
  }

  mangas.forEach(manga => {
    const card = document.createElement('div');
    card.classList.add('manga-card');
    card.addEventListener('click', () => {
      window.location.href = `offline-manga.html?manga=${encodeURIComponent(manga.mangaTitle)}&cid=${encodeURIComponent(manga.cid)}`;
    });

    const img = document.createElement('img');
    img.src = manga.thumbnail ? URL.createObjectURL(manga.thumbnail) : 'https://via.placeholder.com/150';
    card.appendChild(img);

    const title = document.createElement('h3');
    title.textContent = manga.mangaTitle;
    card.appendChild(title);

    container.appendChild(card);
  });
});
