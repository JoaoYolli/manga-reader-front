// detail.js

// Dirección del backend
const back = "https://manga-back.yolli.xyz";

let currentToken = null;
let currentUser = null;
let currentMangaThumbnailUrl = null;

// --- Helpers para localStorage ---
function getToken() {
    return localStorage.getItem("token");
}

function getUser() {
    return localStorage.getItem("user");
}

// --- Validar token ---
async function checkToken() {
    const token = getToken();
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
        currentUser = getUser();
        if (!currentUser) console.error("Usuario no definido en localStorage.");
        return true;
    } catch (err) {
        console.error("Error validando token:", err);
        window.location.href = "../index.html";
        return false;
    }
}

// --- Obtener detalles del manga desde la API externa ---
async function getMangaDetails() {
    const params = new URLSearchParams(window.location.search);
    const title = params.get('id');
    const cid = params.get('cid');
    if (!title || !cid) return;

    const url = `https://jimov-api.vercel.app/manga/inmanga/name/${encodeURIComponent(title)}?cid=${cid}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data) {
            if (data.thumbnail?.url) {
                currentMangaThumbnailUrl = data.thumbnail.url;
                document.body.style.backgroundImage = `url(${data.thumbnail.url})`;
            }
            document.getElementById("manga-title").textContent = data.name;
            document.getElementById("manga-details").innerHTML = `<p>${data.synopsis}</p>`;
            renderChapters(data.chapters, title, cid);
        }
    } catch (err) {
        console.error("Error obteniendo detalles del manga:", err);
    }
}

// --- Renderizar lista de capítulos ---
function renderChapters(chapters, title, cid) {
    const container = document.getElementById("chapters-list");

    // Limpiar lista sin eliminar controles
    Array.from(container.children).forEach(child => {
        if (!child.classList.contains('mark-up-to')) container.removeChild(child);
    });

    // Ordenar capítulos por número
    const sorted = [...chapters].sort((a, b) => Number(a.num) - Number(b.num));
    const maxNum = sorted.length ? Number(sorted.at(-1).num) : 0;

    // Configurar input de "marcar hasta"
    const input = document.getElementById('mark-up-to-input');
    input.max = maxNum;

    document.getElementById('mark-up-to-btn').onclick = async () => {
        const val = Number(input.value);
        if (isNaN(val) || val < 1 || val > maxNum) {
            return alert(`Introduce un número válido entre 1 y ${maxNum}`);
        }

        const confirm = await showConfirmationModal(`¿Estás seguro de marcar como leídos los capítulos del 1 al ${val}?`);
        if (!confirm) return;

        for (let i = 1; i <= val; i++) {
            await markChapterAsRead(i);
        }
        getFinishedChapters();
    };

    // Renderizar cada capítulo
    sorted.forEach(ch => {
        const item = document.createElement('div');
        item.classList.add('chapter');
        item.setAttribute('data-chapter-number', ch.num);

        const link = document.createElement('a');
        link.href = `chapter.html?manga=${encodeURIComponent(title)}&cid=${cid}&chapter=${ch.num}`;
        link.textContent = ch.name || `Capítulo ${ch.num}`;

        const btn = document.createElement('button');
        btn.textContent = 'A';
        btn.classList.add('download-btn');
        btn.addEventListener('click', async e => {
            e.preventDefault();
            if (btn.classList.contains('downloaded')) {
                const overwrite = await showConfirmationModal('Este capítulo ya está descargado. ¿Quieres volver a descargarlo?');
                if (!overwrite) return;
            }
            downloadChapter(ch.num, title, cid, ch.name, `https://jimov-api.vercel.app${ch.url}`, btn);
        });

        item.append(link, btn);
        container.appendChild(item);
    });
}

// --- Descargar capítulo para lectura offline ---
async function downloadChapter(chapterNumber, mangaTitle, cid, chapterTitle, url, btn) {
    const proxy = back + "/proxy";
    const download = createDownload(`${mangaTitle} - Cap. ${chapterNumber}`);

    try {
        const res = await fetch(url, { signal: download.signal });
        const data = await res.json();
        const images = data.images || [];
        if (!images.length) {
            console.error("No hay imágenes");
            return;
        }

        const pages = [];
        for (let i = 0; i < images.length; i++) {
            pages.push(await fetchProxyImage(images[i].url, proxy, download.signal));
            download.setProgress(Math.round(((i + 1) / images.length) * 100));
        }

        await saveChapterOffline({ mangaTitle, cid, chapterNumber, chapterTitle, pages });

        const mangaMeta = await getOfflineManga(mangaTitle);
        if (!mangaMeta?.thumbnail && currentMangaThumbnailUrl) {
            const thumbnail = await fetchProxyImage(currentMangaThumbnailUrl, proxy, download.signal);
            await saveMangaMeta({ mangaTitle, cid, thumbnail });
        } else {
            await saveMangaMeta({ mangaTitle, cid });
        }

        await requestPersistentStorage();

        if (btn) btn.classList.add('downloaded');
    } catch (err) {
        if (err.name === 'AbortError') {
            console.log('Descarga cancelada:', mangaTitle, chapterNumber);
        } else {
            console.error("Error descargando capítulo:", err);
        }
    } finally {
        download.finish();
    }
}

async function fetchProxyImage(url, proxy, signal) {
    const res = await fetch(proxy, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken, url }),
        signal
    });
    return res.blob();
}

// --- Favoritos ---
async function getFavorites() {
    if (!currentUser) return [];
    try {
        const res = await fetch(back + "/get_favorites", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: currentToken, username: currentUser })
        });
        if (res.ok) {
            const data = await res.json();
            return data.favorites || [];
        }
    } catch (err) {
        console.error("Error al obtener favoritos:", err);
    }
    return [];
}

async function toggleFavorite(mangaName, isFavorite) {
    if (!currentUser) return;
    const url = isFavorite ? back + "/add_fav" : back + "/remove_fav";
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: currentToken, username: currentUser, mangaName })
        });
        if (!res.ok) console.error("Error al cambiar favorito:", res.statusText);
    } catch (err) {
        console.error("Error al cambiar favorito:", err);
    }
}

async function initializeFavoriteCheckbox() {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get("id");
    if (!mangaTitle) return;

    const favorites = await getFavorites();
    const checkbox = document.getElementById("favorite-checkbox");
    checkbox.checked = favorites.includes(mangaTitle);
    checkbox.addEventListener("change", () => toggleFavorite(mangaTitle, checkbox.checked));
}

// --- Capítulos terminados ---
async function getFinishedChapters() {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get('id');
    if (!mangaTitle) return;

    try {
        const res = await fetch(back + "/get_finished", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: currentToken, username: currentUser, mangaName: mangaTitle })
        });
        if (res.ok) {
            const { finishedChapters = [] } = await res.json();
            const finishedArray = finishedChapters.map(n => parseInt(n, 10));
            markChaptersAsRead(finishedArray);
        }
    } catch (err) {
        console.error("Error al obtener capítulos terminados:", err);
    }
}

// --- Capítulos descargados offline ---
async function markChaptersOffline() {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get('id');
    if (!mangaTitle) return;

    const offlineChapters = await listOfflineChapters(mangaTitle);
    const offlineSet = new Set(offlineChapters.map(ch => ch.chapterNumber));

    const list = document.getElementById("chapters-list");
    Array.from(list.getElementsByClassName('chapter')).forEach(item => {
        const num = parseInt(item.getAttribute('data-chapter-number'), 10);
        if (offlineSet.has(num)) {
            item.querySelector('.download-btn')?.classList.add('downloaded');
        }
    });
}

function markChaptersAsRead(finishedArray) {
    const list = document.getElementById("chapters-list");
    Array.from(list.getElementsByClassName('chapter')).forEach(item => {
        const num = parseInt(item.getAttribute('data-chapter-number'), 10);
        if (finishedArray.includes(num)) item.classList.add('read');
    });
}

function hideReaden() {
    const list = document.getElementById("chapters-list");
    Array.from(list.getElementsByClassName('read')).forEach(item => {
        item.style.display = 'none'; // Oculta el elemento
    });
}

// Nueva función para volver a mostrar los capítulos leídos
function showReaden() {
    const list = document.getElementById("chapters-list");
    Array.from(list.getElementsByClassName('read')).forEach(item => {
        item.style.display = ''; // Restablece el display por defecto
    });
}

async function markChapterAsRead(chapterNumber) {
    try {
        const res = await fetch(back + "/add_finished", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                token: currentToken,
                username: currentUser,
                mangaName: new URLSearchParams(window.location.search).get('id'),
                chapterNumber
            })
        });
        if (!res.ok) console.error("Error marcando capítulo leído:", res.statusText);
    } catch (err) {
        console.error("Error marcando capítulo leído:", err);
    }
}

// --- Modal de confirmación ---
function showConfirmationModal(message) {
    return new Promise((resolve) => {
        const modal = document.createElement('div');
        modal.classList.add('custom-modal');
        modal.innerHTML =
            `<div class="custom-modal-content">
                <p>${message}</p>
                <div class="custom-modal-buttons">
                    <button id="confirm-yes">Sí</button>
                    <button id="confirm-no">No</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        modal.style.display = 'block';
        modal.querySelector('#confirm-yes').addEventListener('click', () => {
            resolve(true);
            document.body.removeChild(modal);
        });
        modal.querySelector('#confirm-no').addEventListener('click', () => {
            resolve(false);
            document.body.removeChild(modal);
        });
    });
}

// --- Inicialización al cargar la página ---
window.onload = async function () {
    if (!(await checkToken())) return;
    await getMangaDetails();
    await getFinishedChapters();
    await markChaptersOffline();
    await initializeFavoriteCheckbox();
    document.getElementById('toggle-read').addEventListener('change', async function () {
        if (this.checked) {
            showReaden();
        }
        else {
            hideReaden();
        }
    });
};
