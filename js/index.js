// Definir la variable 'back' globalmente
const back = "http://10.100.110.212:3000/";

let debounceTimer;

document.addEventListener('DOMContentLoaded', async () => {
    const token = getCookie("token");

    if (!token || !(await validateToken(token))) {
        handleInvalidToken();
    } else {
        await fetchFavorites(token);
    }
});

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

async function validateToken(token) {
    try {
        const response = await fetch(back + "validate_token", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ token }),
        });
        return response.status === 200;
    } catch (error) {
        console.error("Error validando token:", error);
        return false;
    }
}

async function fetchFavorites(token) {
    try {
        const response = await fetch(back + "get_favorites", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ token }),
        });

        if (response.ok) {
            const data = await response.json();
            searchMangasFav(data.favorites);
        } else {
            console.error("Error al obtener favoritos:", response.statusText);
        }
    } catch (error) {
        console.error("Error al solicitar favoritos:", error);
    }
}

async function handleInvalidToken() {
    let attempts = 3;

    const modal = createModal();
    document.body.appendChild(modal);

    const submitButton = modal.querySelector("#submit-password");
    const passwordField = modal.querySelector("#password-input");

    submitButton.addEventListener("click", async () => {
        const password = passwordField.value;

        try {
            const response = await fetch(back + "get_token", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ password }),
            });

            if (response.status === 200) {
                const data = await response.json();
                document.cookie = `token=${data.token}; path=/;`;
                modal.remove();
                await fetchFavorites(data.token);
            } else {
                attempts--;
                if (attempts > 0) {
                    alert(`Contraseña incorrecta. Te quedan ${attempts} intentos.`);
                } else {
                    alert("Has excedido el número de intentos. Serás redirigido.");
                    window.location.href = "https://www.google.com";
                }
            }
        } catch (error) {
            console.error("Error al obtener token:", error);
        }
    });
}

function createModal() {
    const modal = document.createElement("div");
    modal.id = "password-modal";
    modal.style.position = "fixed";
    modal.style.top = "0";
    modal.style.left = "0";
    modal.style.width = "100%";
    modal.style.height = "100%";
    modal.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    modal.style.display = "flex";
    modal.style.justifyContent = "center";
    modal.style.alignItems = "center";
    modal.style.zIndex = "1000";

    modal.innerHTML = `
        <div style="background: #333; color: #fff; padding: 20px; border-radius: 8px; text-align: center; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2); width: 300px;">
            <h2 style="margin-bottom: 20px; font-size: 1.5rem;">Ingresa la contraseña</h2>
            <input 
                type="password" 
                id="password-input" 
                placeholder="Contraseña" 
                style="margin-bottom: 20px; width: 80%; padding: 10px; border: none; border-radius: 4px; font-size: 1rem;" 
            />
            <button 
                id="submit-password" 
                style="padding: 10px 20px; border: none; border-radius: 4px; background-color: #007bff; color: white; font-size: 1rem; cursor: pointer;">
                Enviar
            </button>
        </div>
    `;

    return modal;
}

async function searchManga() {
    const searchQuery = document.getElementById("search-box").value;

    if (searchQuery.length < 3) return;

    const url = `https://jimov-api.vercel.app/manga/inmanga/filter?search=${encodeURIComponent(searchQuery)}&type=0`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.results && data.results.length > 0) {
        searchMangas(data.results, "results");
    } else {
        document.getElementById("results").innerHTML = '<p>No se encontraron mangas.</p>';
    }
}

async function searchMangasFav(mangas) {
    mangas.forEach(async manga => {

        const url = `https://jimov-api.vercel.app/manga/inmanga/filter?search=${manga}&type=0`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.results && data.results.length > 0) {
            searchMangas(data.results, "favorites");
        }
    })
}

function searchMangas(mangas, containerId) {
    const container = document.getElementById(containerId);
    if (containerId !== "favorites") {
        container.innerHTML = '';
    }

    mangas.forEach(manga => {
        const mangaCard = document.createElement('div');
        mangaCard.classList.add('manga-card');
        mangaCard.setAttribute('data-url', `pages/manga-detalle.html?id=${encodeURIComponent(manga.title)}&cid=${encodeURIComponent(manga.url.split('?cid=')[1])}`);

        mangaCard.addEventListener('click', () => {
            window.location.href = mangaCard.getAttribute('data-url');
        });

        const img = document.createElement('img');
        img.src = manga.thumbnail ? manga.thumbnail.url : 'https://via.placeholder.com/150';
        mangaCard.appendChild(img);

        const title = document.createElement('h3');
        title.textContent = manga.title;
        mangaCard.appendChild(title);

        container.appendChild(mangaCard);
    });
}

function debouncedSearch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(searchManga, 500);
}