// tv-mode.js
// Detecta si la página se está viendo en una Smart TV (sin ratón/táctil, solo mando)
// y activa controles/estilos adaptados. Si no se detecta TV, no hace absolutamente nada.

window.isTvMode = window.matchMedia('(pointer: none)').matches ||
    /Tizen|webOS|GoogleTV|AndroidTV|SMART-TV|HbbTV|AFT|TV Bro|CrKey/i.test(navigator.userAgent);

if (window.isTvMode) {
    document.documentElement.classList.add('tv-mode');
}

// Hace operable con teclado/mando (Enter/Espacio) un elemento que ya reacciona a "click"
// (p. ej. una tarjeta <div> con addEventListener('click', ...)).
function makeTvFocusable(el) {
    if (!el) return;
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            el.click();
        }
    });
}

if (window.isTvMode) {
    document.addEventListener('DOMContentLoaded', () => {
        // El submenú "Descargar" del menú hamburguesa solo se abría con :hover;
        // en modo TV se abre/cierra con Enter sobre el propio enlace.
        document.querySelectorAll('.has-submenu > a').forEach(link => {
            link.addEventListener('click', e => {
                e.preventDefault();
                link.parentElement.classList.toggle('tv-open');
            });
        });
    });
}
