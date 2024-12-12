let mangaData = null;
let currentChapter = null;

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

async function getChapterDetails() {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get('manga');
    const mangaCid = params.get('cid');
    const chapterNumber = params.get('chapter');

    if (!mangaTitle || !mangaCid || !chapterNumber) return;

    const mangaDetailsUrl = `https://jimov-api.vercel.app/manga/inmanga/title/${encodeURIComponent(mangaTitle)}?cid=${mangaCid}`;
    const response = await fetch(mangaDetailsUrl);
    mangaData = await response.json();

    if (mangaData && mangaData.chapters) {
        currentChapter = mangaData.chapters.find(ch => ch.number == chapterNumber);

        if (currentChapter) {
            document.getElementById("chapter-title").textContent = `Capítulo ${currentChapter.number}: ${mangaTitle}`;
            const chapterUrl = `https://jimov-api.vercel.app${currentChapter.url}`;
            const chapterResponse = await fetch(chapterUrl);
            const chapterData = await chapterResponse.json();

            if (chapterData && chapterData.images) {
                const imagesContainer = document.getElementById("chapter-images");
                imagesContainer.innerHTML = "";
                chapterData.images.forEach(image => {
                    const img = document.createElement('img');
                    img.src = image.url;
                    img.alt = image.name || `Imagen del capítulo ${currentChapter.number}`;
                    imagesContainer.appendChild(img);
                });
            }

            populateChapterSelector();
            showNavigationButtons();
        }
    }
}

function populateChapterSelector() {
    const select = document.getElementById('chapter-select');
    select.innerHTML = "";
    mangaData.chapters.forEach(chapter => {
        const option = document.createElement('option');
        option.value = chapter.number;
        option.textContent = `Capítulo ${chapter.number}`;
        select.appendChild(option);
    });
    document.getElementById('chapter-select').value = currentChapter.number;
}

function loadChapterFromSelector() {
    const selectedChapterNumber = document.getElementById('chapter-select').value;
    if (selectedChapterNumber) {
        const selectedChapter = mangaData.chapters.find(ch => ch.number == selectedChapterNumber);
        if (selectedChapter) {
            window.location.href = `chapter.html?manga=${encodeURIComponent(mangaData.title)}&cid=${mangaData.id}&chapter=${selectedChapter.number}`;
        }
    }
}

function showNavigationButtons() {
    const prevButton = document.getElementById('prev-chapter');
    const nextButton = document.getElementById('next-chapter');
    const navigationContainer = document.getElementById('navigation-buttons');

    const currentChapterIndex = mangaData.chapters.findIndex(ch => ch.number === currentChapter.number);

    if (currentChapterIndex > 0) {
        prevButton.style.display = "inline-block";
    } else {
        prevButton.style.display = "none";
    }

    if (currentChapterIndex < mangaData.chapters.length - 1) {
        nextButton.style.display = "inline-block";
    } else {
        nextButton.style.display = "none";
    }

    navigationContainer.style.display = "block";
}

function navigateChapter(direction) {
    const currentChapterIndex = mangaData.chapters.findIndex(ch => ch.number === currentChapter.number);
    const nextChapterIndex = currentChapterIndex + direction;

    if (nextChapterIndex >= 0 && nextChapterIndex < mangaData.chapters.length) {
        const nextChapter = mangaData.chapters[nextChapterIndex];
        // Enviar solicitud POST para agregar el capítulo como leído
        if (direction === 1) {
            markChapterAsRead(currentChapterIndex + 1);
        }
        // Navegar al siguiente capítulo
        window.location.href = `chapter.html?manga=${encodeURIComponent(mangaData.title)}&cid=${mangaData.id}&chapter=${nextChapter.number}`;
    }
}

async function markChapterAsRead(chapterNumber) {
    const token = getCookie("token");
    const mangaTitle = new URLSearchParams(window.location.search).get("manga");

    const response = await fetch(back + "add_finished", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            token: token,
            mangaName: mangaTitle,
            chapterNumber: chapterNumber
        })
    });

    if (response.status === 200) {
        console.log("Capítulo marcado como leído");
    } else {
        console.error("Error al marcar capítulo como leído");
    }
}

function redirectToMangaDetail() {
    const params = new URLSearchParams(window.location.search);
    const mangaTitle = params.get('manga');
    const mangaCid = params.get('cid');

    if (mangaTitle && mangaCid) {
        window.location.href = `manga-detalle.html?id=${encodeURIComponent(mangaTitle)}&cid=${mangaCid}`;
    } else {
        alert("No se pudo determinar el manga actual.");
    }
}

window.onload = async function () {
    await checkToken();
    await getChapterDetails();
};
