// chapter-image-loader.js
// Renderiza las imágenes de un capítulo mostrando un aviso grande y reintentable
// en el lugar de cualquier imagen que falle al cargar. Compartido por el lector
// online (chapter.js) y el offline (offline-chapter.js).

function renderChapterImage(container, src, altText) {
    const wrapper = document.createElement('div');
    wrapper.className = 'chapter-image-wrapper';
    mountChapterImage(wrapper, src, altText);
    container.appendChild(wrapper);
    return wrapper;
}

// Renderiza todas las imágenes de un capítulo de una vez y aplica el modo de
// lectura (scroll continuo o paginado, ver reading-mode.js) sobre el resultado.
// mapFn(item, index) debe devolver { src, alt } para cada elemento de `items`.
function renderChapterImages(container, items, mapFn) {
    container.innerHTML = '';
    const wrappers = items.map((item, i) => {
        const { src, alt } = mapFn(item, i);
        return renderChapterImage(container, src, alt);
    });
    if (typeof applyReadingModeToChapter === 'function') {
        applyReadingModeToChapter(wrappers);
    }
    return wrappers;
}

function mountChapterImage(wrapper, src, altText) {
    wrapper.innerHTML = '';
    const img = document.createElement('img');
    img.src = src;
    img.alt = altText;
    img.addEventListener('error', () => showChapterImageError(wrapper, src, altText), { once: true });
    wrapper.appendChild(img);
}

function showChapterImageError(wrapper, src, altText) {
    wrapper.innerHTML = '';
    const error = document.createElement('div');
    error.className = 'chapter-image-error';
    error.textContent = 'Imagen no cargada (toca para reintentar)';
    error.addEventListener('click', () => mountChapterImage(wrapper, src, altText));
    wrapper.appendChild(error);
}
