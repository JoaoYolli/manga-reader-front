// tv-chapter-nav.js
// En modo TV, permite pasar de una imagen del capítulo a la siguiente/anterior
// con las flechas del mando (arriba/abajo o izquierda/derecha), ya que en TV
// no se puede hacer scroll con rueda de ratón ni gesto táctil.

if (window.isTvMode) {
    (function () {
        let wrappers = [];
        let currentIndex = 0;

        function refreshWrappers() {
            wrappers = Array.from(document.querySelectorAll('#chapter-images .chapter-image-wrapper'));
            currentIndex = 0;
        }

        function goToImage(index) {
            if (!wrappers.length) return;
            currentIndex = Math.max(0, Math.min(index, wrappers.length - 1));
            wrappers[currentIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
        }

        function isFormControl(el) {
            return el && ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName);
        }

        document.addEventListener('keydown', e => {
            // No interferir si el foco está en el selector de capítulo u otro control de formulario
            if (isFormControl(document.activeElement)) return;

            const isNext = e.key === 'ArrowDown' || e.key === 'ArrowRight';
            const isPrev = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
            if (!isNext && !isPrev) return;

            e.preventDefault();

            // En modo de lectura paginado, las flechas pasan de página
            // (ver reading-mode.js); en modo scroll, hacen scroll a la imagen.
            if (typeof isPaginatedMode === 'function' && isPaginatedMode()) {
                goToPage(isNext ? 1 : -1);
            } else {
                goToImage(currentIndex + (isNext ? 1 : -1));
            }
        });

        document.addEventListener('DOMContentLoaded', () => {
            refreshWrappers();

            const imagesContainer = document.getElementById('chapter-images');
            if (!imagesContainer) return;

            // Las imágenes se inyectan de forma asíncrona (fetch de la API / lectura
            // de IndexedDB); cada vez que cambie la lista, recalculamos y volvemos
            // a empezar por la primera imagen del capítulo nuevo.
            const observer = new MutationObserver(refreshWrappers);
            observer.observe(imagesContainer, { childList: true });
        });
    })();
}
