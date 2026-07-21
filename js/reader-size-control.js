// reader-size-control.js
// Control de tamaño de imagen para las páginas de lectura (online y offline).
// Solo visible en pantallas anchas (ver #image-size-control en chapter.css);
// mantiene la relación de aspecto porque únicamente ajusta el ancho.

const READER_SCALE_STORAGE_KEY = 'readerImgScale';

function applyReaderImageScale(percent) {
    document.documentElement.style.setProperty('--reader-img-scale', `${percent}%`);
}

document.addEventListener('DOMContentLoaded', () => {
    const range = document.getElementById('image-size-range');
    if (!range) return;

    const saved = localStorage.getItem(READER_SCALE_STORAGE_KEY) || '100';
    range.value = saved;
    applyReaderImageScale(saved);

    range.addEventListener('input', () => {
        applyReaderImageScale(range.value);
        localStorage.setItem(READER_SCALE_STORAGE_KEY, range.value);
    });
});
