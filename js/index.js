// front.js

// Dirección del backend
const back = "http://localhost:3000";

let debounceTimer;
let currentToken = null;
let currentUser = null;

// Al cargar la página, validar token, usuario en cookies o pedir credenciales
document.addEventListener('DOMContentLoaded', async () => {
  const token = getCookie("token");
  const savedUser = getCookie("user");

  // Validar token
  if (!token || !(await validateToken(token))) {
    await handleInvalidToken();
    return;
  }
  currentToken = token;

  // Si existe usuario en cookies, usarlo, sino preguntar
  if (savedUser) {
    currentUser = savedUser;
  } else {
    await askForUser();
  }

  await fetchFavorites();
});

// --- Helpers para cookies ---
function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
  return null;
}

function setCookie(name, value, days = 7) {
  let expires = '';
  if (days) {
    const date = new Date();
    date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000);
    expires = `; expires=${date.toUTCString()}`;
  }
  document.cookie = `${name}=${value || ''}${expires}; path=/;`;
}

// --- Validación de token contra el backend ---
async function validateToken(token) {
  try {
    const res = await fetch(back + "/list_users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    return res.status === 200;
  } catch (err) {
    console.error("Error validando token:", err);
    return false;
  }
}

// --- Obtener y mostrar favoritos ---
async function fetchFavorites() {
  if (!currentUser) {
    console.error("Usuario no definido");
    return;
  }

  try {
    const res = await fetch(back + "/get_favorites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        token: currentToken, 
        username: currentUser 
      })
    });
    if (res.ok) {
      const data = await res.json();
      searchMangasFav(data.favorites);
    } else {
      console.error("Error al obtener favoritos:", res.statusText);
    }
  } catch (err) {
    console.error("Error al solicitar favoritos:", err);
  }
}

// --- Flujo si no hay token válido ---
async function handleInvalidToken() {
  let attempts = 3;
  const pwdModal = createModal("Ingresa la contraseña");
  document.body.appendChild(pwdModal);

  const submitBtn = pwdModal.querySelector("#submit-password");
  const pwdField = pwdModal.querySelector("#password-input");

  submitBtn.addEventListener("click", async () => {
    const password = pwdField.value;
    try {
      const res = await fetch(back + "/get_token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        const { token } = await res.json();
        setCookie('token', token);
        currentToken = token;
        pwdModal.remove();

        await askForUser();
        await fetchFavorites();
      } else {
        attempts--;
        alert(`Contraseña incorrecta. Quedan ${attempts} intentos.`);
        if (attempts <= 0) window.location.reload();
      }
    } catch (err) {
      console.error("Error al obtener token:", err);
    }
  });
}

// --- Pedir al usuario que seleccione su nombre o cree uno nuevo ---
async function askForUser() {
  let users = [];
  try {
    const res = await fetch(back + "/list_users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: currentToken })
    });
    if (!res.ok) throw new Error(res.statusText);
    const json = await res.json();
    users = Array.isArray(json.users) ? json.users : [];
  } catch (err) {
    console.error("No se pudo cargar la lista de usuarios:", err);
    alert("Error al obtener usuarios disponibles.");
    return;
  }

  // Construir modal con selección y opción de crear
  const userModal = createModal("Elige o crea tu usuario", users, true);
  document.body.appendChild(userModal);

  const select = userModal.querySelector("#user-select");
  const submit = userModal.querySelector("#submit-user");
  const createBtn = userModal.querySelector("#create-user");

  submit.addEventListener("click", () => {
    const sel = select.value;
    if (!sel) return alert("Debes elegir un usuario.");
    currentUser = sel;
    setCookie('user', sel);
    userModal.remove();
    fetchFavorites();
  });

  createBtn.addEventListener("click", async () => {
    const newUser = prompt("Ingresa el nombre del nuevo usuario:");
    if (!newUser) return;
    try {
      const res = await fetch(back + "/create_user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: currentToken, username: newUser })
      });
      if (res.ok) {
        currentUser = newUser;
        setCookie('user', newUser);
        userModal.remove();
        await fetchFavorites();
      } else if (res.status === 409) {
        alert("Usuario ya existe, elige otro nombre.");
      } else {
        alert("Error al crear usuario.");
      }
    } catch (err) {
      console.error("Error creando usuario:", err);
    }
  });
}

// --- Función genérica para crear modales de contraseña o selección ---
function createModal(title, options = null, allowCreate = false) {
  const modal = document.createElement("div");
  Object.assign(modal.style, {
    position: "fixed", top: 0, left: 0,
    width: "100%", height: "100%",
    backgroundColor: "rgba(0,0,0,0.7)",
    display: "flex", justifyContent: "center",
    alignItems: "center", zIndex: 1000
  });

  let inner = `
  <div style="
      background:#333; color:#fff; padding:20px;
      border-radius:8px; text-align:center; width:300px;
      box-shadow:0 4px 8px rgba(0,0,0,0.2);
  ">
    <h2 style="margin-bottom:20px; font-size:1.5rem;">
      ${title}
    </h2>`;

  if (options) {
    inner += `<select id="user-select" style="
        margin-bottom:10px; width:100%; padding:10px;
        border:none; border-radius:4px; font-size:1rem;
    "><option value="">-- Selecciona usuario --</option>` +
      options.map(u => `<option value="${u}">${u}</option>`).join("") +
      `</select>`;
  }

  if (options && allowCreate) {
    inner += `
    <button id="create-user" style="
      margin-bottom:10px; padding:10px 20px;
      border:none; border-radius:4px;
      background-color:#28a745; color:#fff;
      font-size:1rem; cursor:pointer;
    ">Crear usuario</button>`;
  }

  if (!options) {
    inner += `<input type="password" id="password-input"
      placeholder="Contraseña"
      style="margin-bottom:20px; width:100%; padding:10px;
             border:none; border-radius:4px; font-size:1rem;"
    />`;
  }

  inner += `
    <button id="${options ? 'submit-user' : 'submit-password'}" style="
      padding:10px 20px; border:none; border-radius:4px;
      background-color:#007bff; color:#fff; font-size:1rem;
      cursor:pointer;
    ">
      ${options ? 'Seleccionar' : 'Enviar'}
    </button>
  </div>`;

  modal.innerHTML = inner;
  return modal;
}

// --- Búsqueda principal de mangas ---
async function searchManga() {
    const q = document.getElementById("search-box").value;
    if (q.length < 3) return;
  
    const url = `https://jimov-api.vercel.app/manga/inmanga/filter?search=${encodeURIComponent(q)}&type=0`;
    const res = await fetch(url);
    const data = await res.json();
  
    if (data.results && data.results.length) {
      searchMangasNormal(data.results, "results");
    } else {
      document.getElementById("results").innerHTML = '<p>No se encontraron mangas.</p>';
    }
  }
  
  // --- Mostrar favoritos buscando cada manga ---
  async function searchMangasFav(mangas) {
    for (const manga of mangas) {
      const url = `https://jimov-api.vercel.app/manga/inmanga/filter?search=${encodeURIComponent(manga)}&type=0`;
      const res = await fetch(url);
      const data = await res.json();
      if (data.results && data.results.length) {
        searchMangas(data.results, "favorites", manga);
      }
    }
  }
  
  // --- Render de tarjetas de manga con restricion de favoritos ---
  function searchMangas(mangas, containerId, name) {
    const container = document.getElementById(containerId);
    if (containerId !== "favorites") container.innerHTML = '';
  
    mangas.forEach(manga => {
        if(name == manga.title){
      const card = document.createElement('div');
      card.classList.add('manga-card');
      card.setAttribute('data-url', 
        `pages/manga-detalle.html?id=${encodeURIComponent(manga.title)}&cid=${encodeURIComponent(manga.url.split('?cid=')[1])}`
      );
      card.addEventListener('click', () => {
        window.location.href = card.getAttribute('data-url');
      });
  
      const img = document.createElement('img');
      img.src = manga.thumbnail?.url || 'https://via.placeholder.com/150';
      card.appendChild(img);
  
      const title = document.createElement('h3');
      title.textContent = manga.title;
      card.appendChild(title);
  
      container.appendChild(card);
    }
    });
  }
  // --- Render de tarjetas de manga ---
  function searchMangasNormal(mangas, containerId, name) {
    const container = document.getElementById(containerId);
    if (containerId !== "favorites") container.innerHTML = '';
  
    mangas.forEach(manga => {
      const card = document.createElement('div');
      card.classList.add('manga-card');
      card.setAttribute('data-url', 
        `pages/manga-detalle.html?id=${encodeURIComponent(manga.title)}&cid=${encodeURIComponent(manga.url.split('?cid=')[1])}`
      );
      card.addEventListener('click', () => {
        window.location.href = card.getAttribute('data-url');
      });
  
      const img = document.createElement('img');
      img.src = manga.thumbnail?.url || 'https://via.placeholder.com/150';
      card.appendChild(img);
  
      const title = document.createElement('h3');
      title.textContent = manga.title;
      card.appendChild(title);
  
      container.appendChild(card);
    
    });
  }
  
  // --- Búsqueda con debounce ---
  function debouncedSearch() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(searchManga, 500);
  }
  
