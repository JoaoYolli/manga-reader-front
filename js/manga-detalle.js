// Definir la variable 'back' globalmente
const back = "http://10.100.110.212:3000/";

function getCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop().split(';').shift();
}

async function checkToken() {
    const token = getCookie("token");
    if (!token) {
        window.location.href = "../index.html";
        return;
    }

    const response = await fetch(back + "validate_token", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ token })
    });

    if (response.status !== 200) {
        window.location.href = "../index.html";
    }
}

async function getFavorites(token) {
    const response = await fetch(back + "get_favorites", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ token })
    });

    if (response.ok) {
        const data = await response.json();
        return data.favorites || [];
    } else {
        console.error("Error al obtener favoritos");
        return [];
    }
}

async function toggleFavorite(mangaName, isFavorite) {
    const token = getCookie("token");
    const url = isFavorite
        ? back + "add_fav"
        : back + "remove_fav";

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ token, mangaName })
    });

    if (!response.ok) {
        console.error("Error al cambiar el estado de favorito");
    }
}

async function initializeFavoriteCheckbox() {
    const token = getCookie("token");
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get("id");

    if (!mangaTitle) return;

    const favorites = await getFavorites(token);
    const isFavorite = favorites.includes(mangaTitle);

    const checkbox = document.getElementById("favorite-checkbox");
    checkbox.checked = isFavorite;

    checkbox.addEventListener("change", () => {
        toggleFavorite(mangaTitle, checkbox.checked);
    });
}

async function getFinishedChapters(token) {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get('id');

    const response = await fetch(back + "get_finished", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ token, mangaName: mangaTitle })
    });

    if (response.status === 200) {
        const data = await response.json();
        if (data && data.finishedChapters) {
            const finishedChaptersArray = data.finishedChapters.map(chapter => parseInt(chapter));
            markChaptersAsRead(finishedChaptersArray);
        }
    }
}

function markChaptersAsRead(finishedChaptersArray) {
    const chaptersList = document.getElementById("chapters-list");
    const chapterItems = chaptersList.getElementsByClassName('chapter');

    Array.from(chapterItems).forEach(item => {
        const chapterNumber = parseInt(item.getAttribute('data-chapter-number'));
        if (finishedChaptersArray.includes(chapterNumber)) {
            item.classList.add('read');
        }
    });
}

async function getMangaDetails() {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get('id');
    const mangaCid = params.get('cid');

    if (!mangaTitle || !mangaCid) return;

    const url = `https://jimov-api.vercel.app/manga/inmanga/title/${encodeURIComponent(mangaTitle)}?cid=${mangaCid}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data) {
        if (data.thumbnail && data.thumbnail.url) {
            document.body.style.backgroundImage = `url(${data.thumbnail.url})`;
        }

        document.getElementById("manga-title").textContent = data.title;
        document.getElementById("manga-details").innerHTML = `<p>${data.description}</p>`;

        const chaptersList = document.getElementById("chapters-list");
        chaptersList.innerHTML = '<h2>Capítulos</h2>';

        data.chapters.forEach(chapter => {
            const chapterItem = document.createElement('div');
            chapterItem.classList.add('chapter');
            chapterItem.setAttribute('data-chapter-number', chapter.number);

            const chapterTitle = chapter.title || `Capítulo ${chapter.number}`;
            const chapterUrl = `chapter.html?manga=${encodeURIComponent(mangaTitle)}&cid=${mangaCid}&chapter=${chapter.number}`;

            // Crear el enlace al capítulo
            const chapterLink = document.createElement('a');
            chapterLink.href = chapterUrl;
            chapterLink.textContent = chapterTitle;

            // Crear el botón de descarga
            const downloadButton = document.createElement('button');
            downloadButton.textContent = 'A';
            downloadButton.classList.add('download-btn');
            downloadButton.addEventListener('click', (e) => {
                e.preventDefault();
                downloadChapter(chapter.number, mangaTitle, ("https://jimov-api.vercel.app" + chapter.url));
            });

            // Añadir los elementos al capítulo
            chapterItem.appendChild(chapterLink);
            chapterItem.appendChild(downloadButton);

            chaptersList.appendChild(chapterItem);
        });
    }
}

// Función principal para descargar el capítulo
async function downloadChapter(chapterNumber, mangaTitle, url) {
    const { jsPDF } = window.jspdf;

    // URL del servicio Proxy
    const proxyUrl = back + "proxy";

    // Hacemos la petición para obtener las imágenes del capítulo
    const response = await fetch(url);
    const data = await response.json();

    if (!data.images || data.images.length === 0) {
        console.error("No se encontraron imágenes para este capítulo.");
        return;
    }

    const imageUrls = data.images.map(image => image.url);

    // Crear el archivo PDF
    const pdf = new jsPDF('p', 'mm', 'a4');
    const pageWidth = 210;
    const pageHeight = 297;
    let currentY = 0;

    // Crear un contenedor para el indicador de progreso
    const progressContainer = document.createElement("div");
    progressContainer.style.position = "fixed";
    progressContainer.style.top = "50%";
    progressContainer.style.left = "50%";
    progressContainer.style.transform = "translate(-50%, -50%)";
    progressContainer.style.backgroundColor = "rgba(0, 0, 0, 0.7)";
    progressContainer.style.color = "white";
    progressContainer.style.padding = "20px";
    progressContainer.style.borderRadius = "10px";
    progressContainer.style.textAlign = "center";
    progressContainer.style.fontSize = "18px";
    progressContainer.style.zIndex = "9999";

    const progressText = document.createElement("p");
    progressText.innerText = "Recogiendo las paginas...";
    progressContainer.appendChild(progressText);

    const progressBar = document.createElement("div");
    progressBar.style.width = "100%";
    progressBar.style.height = "10px";
    progressBar.style.backgroundColor = "#ccc";
    progressBar.style.borderRadius = "5px";
    progressContainer.appendChild(progressBar);

    const progressFill = document.createElement("div");
    progressFill.style.height = "100%";
    progressFill.style.width = "0%";
    progressFill.style.backgroundColor = "#4caf50";
    progressFill.style.borderRadius = "5px";
    progressBar.appendChild(progressFill);

    document.body.appendChild(progressContainer);

    // Función para obtener las imágenes a través del proxy
    const fetchImage = async (url) => {
        const response = await fetch(proxyUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                token: getCookie("token"),
                url: url
            })
        });

        if (!response.ok) {
            throw new Error(`Error al obtener la imagen: ${response.statusText}`);
        }

        const arrayBuffer = await response.arrayBuffer();
        const base64String = btoa(
            new Uint8Array(arrayBuffer)
                .reduce((data, byte) => data + String.fromCharCode(byte), '')
        );
        return `data:image/jpeg;base64,${base64String}`;
    };

    // Función para obtener las dimensiones de la imagen
    const getImageDimensions = (base64Image) => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => {
                const width = img.naturalWidth;
                const height = img.naturalHeight;
                resolve({ width, height });
            };
            img.onerror = (error) => {
                reject("Error al cargar la imagen: " + error);
            };
            img.src = base64Image;
        });
    };

    // Función para procesar imágenes sin bloquear el hilo principal
    const processImages = async () => {
        // Procesamos las imágenes una por una
        for (let i = 0; i < imageUrls.length; i++) {
            const base64 = await fetchImage(imageUrls[i]);

            const { width, height } = await getImageDimensions(base64);

            const scale = Math.min(pageWidth / width, pageHeight / height);
            const imgWidth = width * scale;
            const imgHeight = height * scale;

            // Verificar si la imagen cabe en la página actual
            if (currentY + imgHeight > pageHeight) {
                pdf.addPage();
                currentY = 0;
            }

            // Añadir la imagen al PDF
            pdf.addImage(base64, 'JPEG', 0, currentY, imgWidth, imgHeight);
            currentY += imgHeight;

            // Actualizar la barra de progreso
            const progressPercentage = ((i + 1) / imageUrls.length) * 100;
            progressFill.style.width = progressPercentage + "%";

            // Esperar un poco para evitar bloquear la interfaz
            await new Promise(resolve => setTimeout(resolve, 10)); // Pequeña pausa para no bloquear el hilo principal
        }

        // Descargar el PDF generado con el nombre adecuado
        const pdfFileName = `${mangaTitle.replace(/\s+/g, '-')}-Capitulo-${chapterNumber}.pdf`;
        pdf.save(pdfFileName);

        // Eliminar el indicador de progreso cuando se termine
        document.body.removeChild(progressContainer);
    };

    // Ejecutamos el procesamiento de imágenes
    await processImages();
}



window.onload = async function () {
    await checkToken();
    await getMangaDetails();
    await getFinishedChapters(getCookie("token"));
    await initializeFavoriteCheckbox();
};
