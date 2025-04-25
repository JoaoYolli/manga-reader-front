// chapter.js (capítulo)

// Dirección del backend
const back = "http://localhost:3000";

let mangaData = null;
let currentChapter = null;
let currentToken = null;
let currentUser = null;

// --- Helpers para cookies ---
function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
    return null;
}

// --- Validar token mediante lista de usuarios ---
async function checkToken() {
    const token = getCookie("token");
    if (!token) {
        window.location.href = "../index.html";
        return false;
    }
    currentToken = token;

    try {
        const res = await fetch(back + "/list_users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
        });
        if (res.status !== 200) {
            window.location.href = "../index.html";
            return false;
        }
        currentUser = getCookie("user");
        if (!currentUser) console.error("Usuario no definido en cookies.");
        return true;
    } catch (err) {
        console.error("Error validando token:", err);
        window.location.href = "../index.html";
        return false;
    }
}

// --- Obtener datos y renderizar capítulo ---
async function getChapterDetails() {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get('manga');
    const mangaCid = params.get('cid');
    const chapterNumber = params.get('chapter');

    if (!mangaTitle || !mangaCid || !chapterNumber) return;

    // Obtener metadata del manga
    const detailsUrl = `https://jimov-api.vercel.app/manga/inmanga/title/${encodeURIComponent(mangaTitle)}?cid=${mangaCid}`;
    const metaRes = await fetch(detailsUrl);
    mangaData = await metaRes.json();

    // Encontrar capítulo actual
    currentChapter = mangaData.chapters.find(ch => ch.number == chapterNumber);
    if (!currentChapter) return;

    document.getElementById("chapter-title").textContent = `Capítulo ${currentChapter.number}: ${mangaTitle}`;

    // Obtener imágenes del capítulo
    const chapterUrl = `https://jimov-api.vercel.app${currentChapter.url}`;
    const chapRes = await fetch(chapterUrl);
    const chapData = await chapRes.json();
    if (chapData.images) {
        const imagesContainer = document.getElementById("chapter-images");
        imagesContainer.innerHTML = "";
        chapData.images.forEach(imgObj => {
            const img = document.createElement('img');
            img.src = imgObj.url;
            img.alt = imgObj.name || `Imagen capítulo ${currentChapter.number}`;
            imagesContainer.appendChild(img);
        });
    }

    populateChapterSelector();
    showNavigationButtons();
}

// --- Selector de capítulos ---
function populateChapterSelector() {
    const select = document.getElementById('chapter-select');

    // 1. Ordenamos numéricamente los capítulos
    mangaData.chapters.sort((a, b) => Number(a.number) - Number(b.number));

    // 2. Vaciamos el selector y lo rellenamos en orden
    select.innerHTML = '';
    mangaData.chapters.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.number;
        opt.textContent = `Capítulo ${ch.number}`;
        select.appendChild(opt);
    });

    // 3. Seleccionamos el capítulo actual
    select.value = currentChapter.number;

    // 4. Manejador para cambiar de capítulo
    select.addEventListener('change', () => {
        const num = select.value;
        const title = encodeURIComponent(mangaData.title);
        const cid   = mangaData.id;
        window.location.href = 
          `chapter.html?manga=${title}&cid=${cid}&chapter=${num}`;
    });
}


// --- Botones de navegación ---
function showNavigationButtons() {
    const prevBtn = document.getElementById('prev-chapter');
    const nextBtn = document.getElementById('next-chapter');
    const idx = mangaData.chapters.findIndex(ch => ch.number === currentChapter.number);

    if (idx > 0) prevBtn.style.display = 'inline-block'; else prevBtn.style.display = 'none';
    if (idx < mangaData.chapters.length - 1) nextBtn.style.display = 'inline-block'; else nextBtn.style.display = 'none';

    prevBtn.onclick = () => navigateChapter(-1);
    nextBtn.onclick = () => navigateChapter(1);
    document.getElementById('navigation-buttons').style.display = 'block';
}

// --- Navegar entre capítulos y marcar leído ---
async function navigateChapter(direction) {
    // 1. Normalizar números y, opcionalmente, usar array ordenado
    const chapters = mangaData.chapters
      .map(ch => ({ ...ch, number: Number(ch.number) }))
      .sort((a, b) => a.number - b.number);
  
    // 2. Buscar el índice del capítulo actual (comparación numérica)
    const idx = chapters.findIndex(
      ch => ch.number === Number(currentChapter.number)
    );
    const nextIdx = idx + direction;
  
    // 3. Limitar navegación dentro de rango
    if (nextIdx < 0 || nextIdx >= chapters.length) return;
  
    const nextCh = chapters[nextIdx];
  
    // 4. Si avanzamos, marcar el capítulo actual como leído
    if (direction === 1) {
      await markChapterAsRead(Number(currentChapter.number));
    }
  
    // 5. Redirigir al siguiente capítulo
    window.location.href = 
      `chapter.html?manga=${encodeURIComponent(mangaData.title)
      }&cid=${mangaData.id
      }&chapter=${nextCh.number}`;
  }
  

// --- Marcar capítulo como leído en el backend ---
async function markChapterAsRead(chapterNumber) {
    try {
        const res = await fetch(back + "/add_finished", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token: currentToken,
                username: currentUser,
                mangaName: new URLSearchParams(window.location.search).get('manga'),
                chapterNumber: chapterNumber
            })
        });
        if (!res.ok) console.error("Error marcando capítulo leído:", res.statusText);
    } catch (err) {
        console.error("Error marcando capítulo leído:", err);
    }
}

// --- Redireccionar al detalle de manga ---
function redirectToMangaDetail() {
    const params = new URLSearchParams(window.location.search);
    const m = params.get('manga');
    const c = params.get('cid');
    if (m && c) window.location.href = `manga-detalle.html?id=${encodeURIComponent(m)}&cid=${c}`;
}

// --- Inicialización al cargar la página ---
window.onload = async function() {
    if (!(await checkToken())) return;
    await getChapterDetails();
};
