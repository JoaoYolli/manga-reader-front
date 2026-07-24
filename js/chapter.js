// chapter.js (capítulo)

// Dirección del backend
const back = "https://manga-back.yolli.xyz";

let mangaData = null;
let currentChapter = null;
let currentToken = null;
let currentUser = null;

// --- Helpers para almacenamiento local ---
function getStoredItem(key) {
    return localStorage.getItem(key);
}

function setStoredItem(key, value) {
    localStorage.setItem(key, value);
}

function removeStoredItem(key) {
    localStorage.removeItem(key);
}

// --- Validar token ---
async function checkToken() {
    const token = getStoredItem("token");
    if (!token) {
        window.location.href = "../index.html";
        return false;
    }
    currentToken = token;

    try {
        const res = await fetch(back + "/validate_token", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token })
        });
        if (res.status !== 200) {
            window.location.href = "../index.html";
            return false;
        }
        currentUser = getStoredItem("user");
        if (!currentUser) console.error("Usuario no definido en almacenamiento.");
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
    const detailsUrl = `https://jimov-api.vercel.app/manga/inmanga/name/${encodeURIComponent(mangaTitle)}?cid=${mangaCid}`;
    const metaRes = await fetch(detailsUrl);
    mangaData = await metaRes.json();

    // Encontrar capítulo actual
    currentChapter = mangaData.chapters.find(ch => ch.num == chapterNumber);
    if (!currentChapter) return;

    document.getElementById("chapter-title").textContent =
        `Capítulo ${currentChapter.num}: ${mangaTitle}`;

    // Obtener imágenes del capítulo
    const chapterUrl = `https://jimov-api.vercel.app${currentChapter.url}`;
    const chapRes = await fetch(chapterUrl);
    const chapData = await chapRes.json();
    if (chapData.images) {
        const imagesContainer = document.getElementById("chapter-images");
        renderChapterImages(imagesContainer, chapData.images, imgObj => ({
            src: imgObj.url,
            alt: imgObj.name || `Imagen capítulo ${currentChapter.num}`
        }));
    }

    populateChapterSelector();
    showNavigationButtons();
}

// --- Selector de capítulos ---
function populateChapterSelector() {
    const select = document.getElementById('chapter-select');

    // 1. Ordenamos numéricamente los capítulos
    mangaData.chapters.sort((a, b) => Number(a.num) - Number(b.num));

    // 2. Vaciamos el selector y lo rellenamos en orden
    select.innerHTML = '';
    mangaData.chapters.forEach(ch => {
        const opt = document.createElement('option');
        opt.value = ch.num;
        opt.textContent = `Capítulo ${ch.num}`;
        select.appendChild(opt);
    });

    // 3. Seleccionamos el capítulo actual
    select.value = currentChapter.num;

    // 4. Manejador para cambiar de capítulo
    select.addEventListener('change', () => {
        const num = select.value;
        const title = encodeURIComponent(mangaData.name);
        const cid = mangaData.id;
        window.location.href =
            `chapter.html?manga=${title}&cid=${cid}&chapter=${num}`;
    });
}

// --- Botones de navegación ---
function showNavigationButtons() {
    const prevBtn = document.getElementById('prev-chapter');
    const nextBtn = document.getElementById('next-chapter');
    const readBtn = document.getElementById('readen-chapter');
    const chapters = mangaData.chapters.map(ch => ({
        ...ch,
        number: Number(ch.num)
    })).sort((a, b) => a.number - b.number);
    const idx = chapters.findIndex(ch => ch.number === Number(currentChapter.num));

    if (idx > 0) { prevBtn.style.display = 'inline-block'; }
    else { prevBtn.style.display = 'none'; }

    if (idx < chapters.length - 1) { nextBtn.style.display = 'inline-block'; readBtn.style.display = 'none'; }
    else { nextBtn.style.display = 'none'; readBtn.style.display = 'inline-block';}

    prevBtn.onclick = () => navigateChapter(-1);
    nextBtn.onclick = () => navigateChapter(1);
    document.getElementById('navigation-buttons').style.display = 'block';
}

// --- Navegar entre capítulos y marcar leído ---
async function navigateChapter(direction) {
    const chapters = mangaData.chapters
        .map(ch => ({ ...ch, number: Number(ch.num) }))
        .sort((a, b) => a.number - b.number);

    const idx = chapters.findIndex(
        ch => ch.number === Number(currentChapter.num)
    );
    const nextIdx = idx + direction;

    if (nextIdx < 0 || nextIdx >= chapters.length) return;

    const nextCh = chapters[nextIdx];

    if (direction === 1) {
        await markChapterAsRead(Number(currentChapter.num));
    }

    window.location.href =
        `chapter.html?manga=${encodeURIComponent(mangaData.name)
        }&cid=${mangaData.id
        }&chapter=${nextCh.number}`;
}

// --- Marcar capítulo como leído en el backend ---
async function markChapterAsRead(chapterNumber) {
    if(chapterNumber === -256){
        chapterNumber = currentChapter.num;
    }
    try {
        const res = await fetch(back + "/add_finished", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token: currentToken,
                username: currentUser,
                mangaName: new URLSearchParams(window.location.search).get('manga'),
                chapterNumber
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
    if (m && c) {
        window.location.href =
            `manga-detalle.html?id=${encodeURIComponent(m)}&cid=${c}`;
    }
}

// --- Inicialización al cargar la página ---
window.onload = async function () {
    if (!(await checkToken())) return;
    await getChapterDetails();
};
