// reader-size-control.js
// Control de tamaño de imagen (desplegable de porcentajes) para las páginas
// de lectura (online y offline). Solo visible en pantallas anchas (ver
// #image-size-control en chapter.css); mantiene la relación de aspecto
// porque únicamente ajusta el ancho.

const READER_SCALE_STORAGE_KEY = 'readerImgScale';

function applyReaderImageScale(percent) {
    document.documentElement.style.setProperty('--reader-img-scale', `${percent}%`);
}

document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('image-size-range');
    if (!select) return;

    const saved = localStorage.getItem(READER_SCALE_STORAGE_KEY) || '100';
    select.value = saved;
    applyReaderImageScale(saved);

    select.addEventListener('change', () => {
        applyReaderImageScale(select.value);
        localStorage.setItem(READER_SCALE_STORAGE_KEY, select.value);
    });
});
