// Estado de sesión
let debounceTimer;
let currentToken = null;
let currentUser = null;

function updateInviteMenuVisibility() {
  document.getElementById('invite-menu-item').style.display =
    localStorage.getItem('isAdmin') === 'true' ? 'block' : 'none';
}

// --- Comprobación de conectividad con el backend ---
async function isBackendReachable() {
  if (!navigator.onLine) return false;
  try {
    const res = await fetch(back + "/vapidPublicKey", { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch (err) {
    return false;
  }
}

// --- Comprobación de disponibilidad de InManga (fuente de los mangas) ---
// Distinto de isBackendReachable(): esto consulta el estado que el backend
// ya mantiene (chequeo propio cada 10 min), no dispara una prueba nueva
// contra InManga por cada carga de página. No bloquea el resto de la app —
// login, biblioteca offline y ajustes siguen funcionando igual si está caída.
async function checkMangaSourceStatus() {
  try {
    const res = await fetch(back + "/manga_source_status", { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return;
    const data = await res.json();
    if (data.available === false) showMangaSourceBanner();
  } catch (err) {
    console.error("Error comprobando disponibilidad de InManga:", err);
  }
}

function showMangaSourceBanner() {
  if (document.getElementById('manga-source-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'manga-source-banner';
  banner.className = 'status-banner';

  const text = document.createElement('span');
  text.textContent = '⚠ InManga no está disponible temporalmente. La búsqueda y lectura pueden fallar hasta que vuelva.';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'status-banner-close';
  closeBtn.setAttribute('aria-label', 'Cerrar aviso');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => banner.remove());

  banner.append(text, closeBtn);
  document.body.prepend(banner);
}

// Al cargar la página
document.addEventListener('DOMContentLoaded', async () => {
  if (!(await isBackendReachable())) {
    window.location.replace('pages/offline.html');
    return;
  }

  checkMangaSourceStatus();

  const token = localStorage.getItem("token");
  const savedUser = localStorage.getItem("user");
  const burger = document.getElementById('burger');
  const menu = document.getElementById('menu');
  const cerrarSesion = document.getElementById('cerrar-sesion');

  if (window.isTvMode) makeTvFocusable(burger);

  cerrarSesion.addEventListener('click', () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('isAdmin');
    window.location.reload();
  });

  burger.addEventListener('click', () => {
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  });

  document.getElementById('open-settings').addEventListener('click', e => {
    e.preventDefault();
    openSettingsModal();
  });

  document.getElementById('open-invite').addEventListener('click', e => {
    e.preventDefault();
    showInviteCodeModal(currentToken);
  });

  document.addEventListener('click', (e) => {
    if (!burger.contains(e.target) && !menu.contains(e.target)) {
      menu.style.display = 'none';
    }
  });

  if (token && (await validateToken(token))) {
    currentToken = token;
    currentUser = savedUser;
    updateInviteMenuVisibility();
    await fetchFavorites();
    await askPermission();
    return;
  }

  login();
});

// --- Login: por QR en Smart TV, por usuario+contraseña en el resto ---
function login() {
  const onSuccess = async (data) => {
    currentToken = data.token;
    currentUser = data.username;
    updateInviteMenuVisibility();
    await fetchFavorites();
    await askPermission();
  };

  if (window.isTvMode) {
    showQrLoginScreen(onSuccess);
  } else {
    showLoginForm(onSuccess);
  }
}

// --- Validación de token ---
async function validateToken(token) {
  try {
    const res = await fetch(back + "/validate_token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    if (res.status !== 200) return false;
    const data = await res.json();
    localStorage.setItem('isAdmin', data.isAdmin ? 'true' : 'false');
    return true;
  } catch (err) {
    console.error("Error validando token:", err);
    return false;
  }
}

// --- Obtener favoritos ---
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

// --- Modal de Ajustes (tema y modo de lectura) ---
function openSettingsModal() {
  const modal = document.createElement("div");
  Object.assign(modal.style, {
    position: "fixed", top: 0, left: 0,
    width: "100%", height: "100%",
    backgroundColor: "rgba(0,0,0,0.7)",
    display: "flex", justifyContent: "center",
    alignItems: "center", zIndex: 1000
  });

  const currentTheme = getSetting('theme', 'light');
  const currentMode = getReadingMode();

  modal.innerHTML = `
  <div style="
    background:#333; color:#fff; padding:20px;
    border-radius:8px; text-align:center; width:320px;
    box-shadow:0 4px 8px rgba(0,0,0,0.2);
  ">
    <h2 style="margin-bottom:20px; font-size:1.5rem;">Ajustes</h2>

    <div style="text-align:left; margin-bottom:16px;">
      <p style="margin-bottom:6px; font-weight:bold;">Tema</p>
      <label style="display:block; margin-bottom:4px;">
        <input type="radio" name="settings-theme" value="light" ${currentTheme === 'light' ? 'checked' : ''}> Claro
      </label>
      <label style="display:block;">
        <input type="radio" name="settings-theme" value="dark" ${currentTheme === 'dark' ? 'checked' : ''}> Oscuro
      </label>
    </div>

    <div style="text-align:left; margin-bottom:20px;">
      <p style="margin-bottom:6px; font-weight:bold;">Modo de lectura</p>
      <label style="display:block; margin-bottom:4px;">
        <input type="radio" name="settings-reading-mode" value="scroll" ${currentMode === 'scroll' ? 'checked' : ''}> Scroll continuo
      </label>
      <label style="display:block;">
        <input type="radio" name="settings-reading-mode" value="paginated" ${currentMode === 'paginated' ? 'checked' : ''}> Paginado (una imagen a la vez)
      </label>
    </div>

    <button id="close-settings" style="padding:10px 20px; border:none; border-radius:4px; background-color:#007bff; color:#fff; font-size:1rem; cursor:pointer;">Cerrar</button>
  </div>`;

  document.body.appendChild(modal);

  modal.querySelectorAll('input[name="settings-theme"]').forEach(input => {
    input.addEventListener('change', () => {
      setSetting('theme', input.value);
      applyTheme(input.value);
      if (currentToken) apiSetPreferences(currentToken, { theme: input.value });
    });
  });

  modal.querySelectorAll('input[name="settings-reading-mode"]').forEach(input => {
    input.addEventListener('change', () => {
      setSetting('readingMode', input.value);
      if (currentToken) apiSetPreferences(currentToken, { readingMode: input.value });
    });
  });

  modal.querySelector('#close-settings').addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => {
    if (e.target === modal) modal.remove();
  });
}

// --- Búsqueda de mangas ---
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

async function searchMangasFav(mangas) {
  const container = document.getElementById("favorites");
  container.innerHTML = '';
  for (const manga of mangas) {
    const url = `https://jimov-api.vercel.app/manga/inmanga/filter?search=${encodeURIComponent(manga)}&type=0`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.results && data.results.length) {
      searchMangas(data.results, "favorites", manga);
    }
  }
}

function searchMangas(mangas, containerId, name) {
  const container = document.getElementById(containerId);
  if (containerId !== "favorites") container.innerHTML = '';

  mangas.forEach(manga => {
    if (name == manga.name) {
      const card = document.createElement('div');
      card.classList.add('manga-card');
      card.setAttribute('data-url',
        `pages/manga-detalle.html?id=${encodeURIComponent(manga.name)}&cid=${encodeURIComponent(manga.url.split('?cid=')[1])}`
      );
      card.addEventListener('click', () => {
        window.location.href = card.getAttribute('data-url');
      });
      if (window.isTvMode) makeTvFocusable(card);

      const img = document.createElement('img');
      img.src = manga.thumbnail?.url || 'https://via.placeholder.com/150';
      card.appendChild(img);

      const title = document.createElement('h3');
      title.textContent = manga.name;
      card.appendChild(title);

      container.appendChild(card);
    }
  });
}

function searchMangasNormal(mangas, containerId) {
  const container = document.getElementById(containerId);
  if (containerId !== "favorites") container.innerHTML = '';

  mangas.forEach(manga => {
    const card = document.createElement('div');
    card.classList.add('manga-card');
    card.setAttribute('data-url',
      `pages/manga-detalle.html?id=${encodeURIComponent(manga.name)}&cid=${encodeURIComponent(manga.url.split('?cid=')[1])}`
    );
    card.addEventListener('click', () => {
      window.location.href = card.getAttribute('data-url');
    });
    if (window.isTvMode) makeTvFocusable(card);

    const img = document.createElement('img');
    img.src = manga.thumbnail?.url || 'https://via.placeholder.com/150';
    card.appendChild(img);

    const title = document.createElement('h3');
    title.textContent = manga.name;
    card.appendChild(title);

    container.appendChild(card);
  });
}

// --- Debounced search ---
function debouncedSearch() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(searchManga, 500);
}
