// detail.js

// Dirección del backend
const back = "https://manga-back.yolli.xyz";

let currentToken = null;
let currentUser = null;

// --- Helpers para localStorage ---
function getToken() {
    return localStorage.getItem("token");
}

function getUser() {
    return localStorage.getItem("user");
}

// --- Validar token mediante lista de usuarios ---
async function checkToken() {
    const token = getToken();
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

    const url = `https://jimov-api.vercel.app/manga/inmanga/title/${encodeURIComponent(title)}?cid=${cid}`;
    try {
        const res = await fetch(url);
        const data = await res.json();
        if (data) {
            if (data.thumbnail?.url) document.body.style.backgroundImage = `url(${data.thumbnail.url})`;
            document.getElementById("manga-title").textContent = data.title;
            document.getElementById("manga-details").innerHTML = `<p>${data.description}</p>`;
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
    const sorted = [...chapters].sort((a, b) => Number(a.number) - Number(b.number));
    const maxNum = sorted.length ? Number(sorted.at(-1).number) : 0;

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
        item.setAttribute('data-chapter-number', ch.number);

        const link = document.createElement('a');
        link.href = `chapter.html?manga=${encodeURIComponent(title)}&cid=${cid}&chapter=${ch.number}`;
        link.textContent = ch.title || `Capítulo ${ch.number}`;

        const btn = document.createElement('button');
        btn.textContent = 'A';
        btn.classList.add('download-btn');
        btn.addEventListener('click', e => {
            e.preventDefault();
            downloadChapter(ch.number, title, `https://jimov-api.vercel.app${ch.url}`);
        });

        item.append(link, btn);
        container.appendChild(item);
    });
}

// --- Descargar capítulo como PDF ---
async function downloadChapter(chapterNumber, mangaTitle, url) {
    const { jsPDF } = window.jspdf;
    const proxy = back + "/proxy";

    try {
        const res = await fetch(url);
        const data = await res.json();
        const images = data.images || [];
        if (!images.length) return console.error("No hay imágenes");

        const pdf = new jsPDF('p', 'mm', 'a4');
        const [pw, ph] = [210, 297];
        let y = 0;
        const progress = createProgress();
        document.body.append(progress.container);

        for (let i = 0; i < images.length; i++) {
            const b64 = await fetchProxyImage(images[i].url, proxy);
            const dims = await getImageDimensions(b64);
            const scale = Math.min(pw / dims.width, ph / dims.height);
            if (y + dims.height * scale > ph) {
                pdf.addPage();
                y = 0;
            }
            pdf.addImage(b64, 'JPEG', 0, y, dims.width * scale, dims.height * scale);
            y += dims.height * scale;
            progress.fill.style.width = `${((i + 1) / images.length) * 100}%`;
            await new Promise(r => setTimeout(r, 10));
        }

        pdf.save(`${mangaTitle.replace(/\s+/g, '-')}-Cap-${chapterNumber}.pdf`);
        progress.container.remove();
    } catch (err) {
        console.error("Error descargando capítulo:", err);
    }
}

function createProgress() {
    const c = document.createElement('div');
    Object.assign(c.style, {
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%,-50%)',
        background: 'rgba(0,0,0,0.7)',
        padding: '20px',
        borderRadius: '10px',
        color: '#fff',
        textAlign: 'center',
        zIndex: 9999
    });
    const p = document.createElement('p');
    p.innerText = 'Recogiendo páginas...';
    const bar = document.createElement('div');
    Object.assign(bar.style, {
        width: '100%',
        height: '10px',
        background: '#ccc',
        borderRadius: '5px',
        marginTop: '10px'
    });
    const fill = document.createElement('div');
    Object.assign(fill.style, {
        height: '100%',
        width: '0%',
        background: '#4caf50',
        borderRadius: '5px'
    });
    bar.append(fill);
    c.append(p, bar);
    return { container: c, fill };
}

async function fetchProxyImage(url, proxy) {
    const res = await fetch(proxy, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: currentToken, url })
    });
    const buf = await res.arrayBuffer();
    const b64 = btoa(new Uint8Array(buf).reduce((s, b) => s + String.fromCharCode(b), ''));
    return `data:image/jpeg;base64,${b64}`;
}

function getImageDimensions(b64) {
    return new Promise((res, rej) => {
        const img = new Image();
        img.onload = () => res({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = e => rej(e);
        img.src = b64;
    });
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

function markChaptersAsRead(finishedArray) {
    const list = document.getElementById("chapters-list");
    Array.from(list.getElementsByClassName('chapter')).forEach(item => {
        const num = parseInt(item.getAttribute('data-chapter-number'), 10);
        if (finishedArray.includes(num)) item.classList.add('read');
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
    await initializeFavoriteCheckbox();
};
