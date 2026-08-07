// settings.js
// Preferencias del usuario persistidas en localStorage y aplicadas en todas
// las páginas: tema claro/oscuro y modo de lectura de capítulos.

function getSetting(key, fallback) {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value;
}

function setSetting(key, value) {
    localStorage.setItem(key, value);
}

function getReadingMode() {
    return getSetting('readingMode', 'scroll');
}

// Cómo se pasa de página al leer manga en modo paginado o un libro:
// 'swipe' (por defecto) — deslizar/arrastrar, clic en cualquier parte
// alterna la cabecera/pie.
// 'edge-click' — clic en los bordes izquierdo/derecho de la pantalla pasa de
// página, el centro sigue alternando la cabecera/pie.
function getPageTurnMode() {
    return getSetting('pageTurnMode', 'swipe');
}

function applyTheme(theme) {
    document.documentElement.classList.toggle('dark-theme', theme === 'dark');
}

// Se aplica de inmediato al cargar el script (antes de pintar la página),
// para evitar un parpadeo de tema claro antes de pasar a oscuro.
applyTheme(getSetting('theme', 'light'));
