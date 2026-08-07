// libros.js — biblioteca de libros electrónicos (EPUB/PDF)

const back = "https://manga-back.yolli.xyz";

function isAdminUser() {
  return localStorage.getItem('isAdmin') === 'true';
}

async function fetchBooksOnline() {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Sin sesión');

  const [booksRes, progressRes] = await Promise.all([
    fetch(`${back}/books?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(5000) }),
    fetch(`${back}/books/progress?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(5000) })
  ]);
  if (!booksRes.ok) throw new Error('No se pudo obtener la lista de libros');

  const booksData = await booksRes.json();
  const progressData = progressRes.ok ? await progressRes.json() : { progress: {} };
  return { books: booksData.books || [], progress: progressData.progress || {} };
}

function showLibrosOfflineBanner() {
  if (document.getElementById('libros-offline-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'libros-offline-banner';
  banner.className = 'status-banner';

  const text = document.createElement('span');
  text.textContent = 'Sin conexión: mostrando solo los libros descargados.';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'status-banner-close';
  closeBtn.setAttribute('aria-label', 'Cerrar aviso');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => banner.remove());

  banner.append(text, closeBtn);
  document.body.prepend(banner);
}

// --- Progreso pendiente de sincronizar ---------------------------------
// Si se leyó algún libro sin conexión, su progreso se quedó solo en
// localStorage (ver libro-lector.js) hasta que se volviera a abrir ESE
// libro en concreto con conexión — resolveStartingLocator() allí ya lo sube
// en ese caso. Esto cubre el otro caso: entrar a la biblioteca con conexión
// sin haber reabierto todavía cada libro leído offline uno a uno.

function loadLocalProgressFor(bookId) {
  try {
    return JSON.parse(localStorage.getItem(`bookProgress:${bookId}`));
  } catch {
    return null;
  }
}

async function pushProgressToServer(token, bookId, locator, percent) {
  try {
    const res = await fetch(`${back}/books/${encodeURIComponent(bookId)}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, locator, percent: percent ?? null }),
      signal: AbortSignal.timeout(5000)
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function syncPendingOfflineProgress(token, offlineBooks, serverProgress) {
  for (const book of offlineBooks) {
    const local = loadLocalProgressFor(book.id);
    if (!local) continue;
    const server = serverProgress[book.id];
    if (server && new Date(server.updatedAt) >= new Date(local.updatedAt)) continue;
    await pushProgressToServer(token, book.id, local.locator, local.percent);
  }
}

// --- Clasificación de la biblioteca: en progreso / sin leer / terminado --
// El progreso "efectivo" de un libro puede venir del servidor o quedarse
// solo en local (offline, todavía sin sincronizar) — se usa el más
// reciente de los dos, mismo criterio que ya aplica
// syncPendingOfflineProgress/resolveStartingLocator en libro-lector.js.

function getEffectiveProgress(bookId, serverProgress) {
  const local = loadLocalProgressFor(bookId);
  const server = serverProgress[bookId];
  if (local && (!server || new Date(local.updatedAt) > new Date(server.updatedAt))) return local;
  return server || null;
}

// percent puede faltar (progreso guardado antes de que existiera este
// campo, o un formato donde no se pudo calcular) — sin él, un libro con
// progreso se trata como "en progreso" sin más detalle, nunca como
// "terminado" por defecto (evita falsos terminados).
function classifyBook(progressEntry) {
  if (!progressEntry) return 'unread';
  if (typeof progressEntry.percent === 'number' && progressEntry.percent >= 100) return 'finished';
  return 'in-progress';
}

// --- Portada elegida por un admin (Open Library) ------------------------
// Solo un admin puede buscar/elegir; el resultado (coverUrl en /books) lo ve
// todo el mundo por igual. Si no hay ninguna elegida, cada tarjeta sigue
// usando la portada generada por canvas (book-cover.js) como hasta ahora.

async function searchBookCovers(token, id, query) {
  const res = await fetch(`${back}/admin/books/${encodeURIComponent(id)}/cover_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, query }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error('No se pudo buscar portadas');
  const data = await res.json();
  return data.results || [];
}

async function setBookCover(token, id, coverUrl) {
  const res = await fetch(`${back}/admin/books/${encodeURIComponent(id)}/cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, coverUrl }),
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error('No se pudo guardar la portada');
}

// Mantener pulsado sobre una miniatura la amplía a pantalla completa para
// verla bien antes de elegirla — mismo umbral (LONG_PRESS_MS) que el
// long-press de selección múltiple de offline-manga.js/manga-detalle.js.
// Soltar (o mover fuera) cierra la ampliación sin seleccionar nada; si el
// long-press llegó a disparar, se ignora el click posterior para no elegir
// esa portada sin querer justo al soltar.
const COVER_LONG_PRESS_MS = 500;

function showCoverZoom(src, alt) {
  const overlay = document.createElement('div');
  overlay.className = 'cover-zoom-overlay';
  const img = document.createElement('img');
  img.src = src;
  img.alt = alt || '';
  overlay.appendChild(img);
  document.body.appendChild(overlay);
  return () => overlay.remove();
}

function bindCoverLongPress(item, getZoomSrc, altText) {
  let pressTimer = null;
  let dismissZoom = null;
  let longPressFired = false;

  item.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button !== 0) return;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressFired = true;
      dismissZoom = showCoverZoom(getZoomSrc(), altText);
    }, COVER_LONG_PRESS_MS);
  });

  ['pointerup', 'pointerleave', 'pointercancel'].forEach(evt => {
    item.addEventListener(evt, () => {
      clearTimeout(pressTimer);
      if (dismissZoom) {
        dismissZoom();
        dismissZoom = null;
      }
    });
  });

  item.addEventListener('click', e => {
    if (longPressFired) {
      e.preventDefault();
      e.stopPropagation();
      longPressFired = false;
    }
  }, true);
}

function showCoverPickerModal(id, title, currentCoverUrl, onSaved) {
  const token = localStorage.getItem('token');

  const modal = document.createElement('div');
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-card cover-picker-card">
      <h2>Elegir portada</h2>
      <p>${title}</p>
      <div class="modal-error" id="cover-picker-error"></div>
      <input type="text" id="cover-picker-query" value="${title.replace(/"/g, '&quot;')}">
      <button id="cover-picker-search" class="btn-primary" type="button">Buscar</button>
      <p class="cover-picker-hint">Mantén pulsada una imagen para verla en grande antes de elegirla.</p>
      <div id="cover-picker-results" class="cover-picker-results"></div>
      <p class="cover-picker-manual-label">¿No la encuentras? Pega la URL de una imagen:</p>
      <div class="cover-picker-manual">
        <input type="text" id="cover-picker-url" placeholder="https://...">
        <img id="cover-picker-url-preview" class="cover-picker-url-preview" style="display:none;">
        <button id="cover-picker-use-url" class="btn-ghost" type="button">Usar esta imagen</button>
      </div>
      ${currentCoverUrl ? '<button id="cover-picker-clear" class="btn-ghost" type="button">Quitar portada elegida</button>' : ''}
      <button id="cover-picker-close" class="btn-ghost" type="button">Cerrar</button>
    </div>`;
  document.body.appendChild(modal);

  const errorEl = modal.querySelector('#cover-picker-error');
  const resultsEl = modal.querySelector('#cover-picker-results');
  const queryInput = modal.querySelector('#cover-picker-query');
  const urlInput = modal.querySelector('#cover-picker-url');
  const urlPreview = modal.querySelector('#cover-picker-url-preview');

  function close() {
    modal.remove();
  }

  function showError(msg) {
    errorEl.textContent = msg;
    errorEl.classList.add('visible');
  }

  async function pickResult(coverUrl) {
    try {
      await setBookCover(token, id, coverUrl);
      close();
      onSaved();
    } catch (err) {
      showError('No se pudo guardar la portada.');
    }
  }

  async function runSearch() {
    errorEl.classList.remove('visible');
    resultsEl.innerHTML = '<p class="cover-picker-status">Buscando…</p>';
    try {
      const results = await searchBookCovers(token, id, queryInput.value.trim());
      resultsEl.innerHTML = '';
      if (!results.length) {
        resultsEl.innerHTML = '<p class="cover-picker-status">Sin resultados. Puede que Open Library no tenga portada para este título — prueba con otra búsqueda (por ejemplo, solo el nombre de la serie, sin el número de volumen), o pega una URL de imagen abajo.</p>';
        return;
      }
      results.forEach(r => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'cover-picker-result';
        const img = document.createElement('img');
        img.src = r.thumbnail;
        img.alt = r.title || '';
        item.appendChild(img);
        item.title = [r.title, (r.authors || []).join(', ')].filter(Boolean).join(' — ');
        const fullSrc = r.fullImage || r.thumbnail;
        bindCoverLongPress(item, () => fullSrc, r.title);
        item.addEventListener('click', () => pickResult(fullSrc));
        resultsEl.appendChild(item);
      });
    } catch (err) {
      resultsEl.innerHTML = '';
      showError('No se pudo buscar portadas.');
    }
  }

  // Vista previa en vivo de la URL pegada a mano, para comprobar que carga
  // antes de guardarla — si la imagen falla, se oculta sin más (no hace
  // falta un mensaje de error propio, "Usar esta imagen" ya valida al usarla).
  let urlPreviewTimer = null;
  urlInput.addEventListener('input', () => {
    clearTimeout(urlPreviewTimer);
    urlPreviewTimer = setTimeout(() => {
      const url = urlInput.value.trim();
      if (!/^https:\/\//.test(url)) {
        urlPreview.style.display = 'none';
        return;
      }
      urlPreview.src = url;
      urlPreview.style.display = 'block';
    }, 400);
  });
  urlPreview.addEventListener('error', () => {
    urlPreview.style.display = 'none';
  });
  bindCoverLongPress(urlPreview, () => urlPreview.src, 'Vista previa');

  modal.querySelector('#cover-picker-use-url').addEventListener('click', () => {
    const url = urlInput.value.trim();
    if (!/^https:\/\//.test(url)) {
      showError('Pega una URL de imagen que empiece por https://');
      return;
    }
    pickResult(url);
  });

  modal.querySelector('#cover-picker-search').addEventListener('click', runSearch);
  modal.querySelector('#cover-picker-close').addEventListener('click', close);
  modal.querySelector('#cover-picker-clear')?.addEventListener('click', () => pickResult(null));
  modal.addEventListener('click', e => {
    if (e.target === modal) close();
  });

  runSearch();
}

// --- Tarjetas ------------------------------------------------------------

function renderBookCard({ id, title, format, coverUrl, downloaded, sizeBytes, status, percent, canManageCover, onDeleted, onCoverChanged }) {
  const card = document.createElement('div');
  card.classList.add('manga-card');
  card.addEventListener('click', () => {
    window.location.href = `libro-lector.html?id=${encodeURIComponent(id)}`;
  });
  if (window.isTvMode) makeTvFocusable(card);

  const img = document.createElement('img');
  img.src = coverUrl || generateBookCoverDataUrl(title);
  img.alt = title;
  card.appendChild(img);

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  card.appendChild(titleEl);

  const meta = document.createElement('p');
  meta.className = 'manga-card-meta mono';
  const bits = [(format || '').toUpperCase()];
  if (downloaded) bits.push(formatBytes(sizeBytes));
  if (status === 'finished') bits.push('Terminado');
  else if (status === 'in-progress') bits.push(typeof percent === 'number' ? `${percent}% leído` : 'En progreso');
  meta.textContent = bits.join(' · ');
  card.appendChild(meta);

  if (downloaded) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'book-delete-btn';
    deleteBtn.setAttribute('aria-label', 'Eliminar libro descargado');
    deleteBtn.innerHTML = '<span class="icon icon-trash"></span>';
    deleteBtn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`¿Eliminar "${title}" descargado (${formatBytes(sizeBytes)})? Sigue disponible para volver a descargarlo si hay conexión.`)) return;
      await deleteOfflineBook(id);
      onDeleted();
    });
    card.appendChild(deleteBtn);
  }

  if (canManageCover) {
    const coverBtn = document.createElement('button');
    coverBtn.className = 'book-cover-btn';
    coverBtn.setAttribute('aria-label', 'Elegir portada');
    coverBtn.title = 'Elegir portada';
    coverBtn.innerHTML = '<span class="icon icon-image"></span>';
    coverBtn.addEventListener('click', e => {
      e.stopPropagation();
      showCoverPickerModal(id, title, coverUrl, onCoverChanged);
    });
    card.appendChild(coverBtn);
  }

  return card;
}

async function renderLibrary() {
  const sections = {
    'in-progress': { section: document.getElementById('section-in-progress'), grid: document.getElementById('books-in-progress') },
    unread: { section: document.getElementById('section-unread'), grid: document.getElementById('books-unread') },
    finished: { section: document.getElementById('section-finished'), grid: document.getElementById('books-finished') }
  };
  const emptyMessage = document.getElementById('empty-message');
  const totalEl = document.getElementById('storage-total');
  Object.values(sections).forEach(({ section, grid }) => {
    grid.innerHTML = '';
    section.style.display = 'none';
  });
  emptyMessage.style.display = 'none';

  let offlineBooks = [];
  try {
    offlineBooks = await listOfflineBooks();
  } catch (err) {
    // openOfflineDB() puede rechazar si otra pestaña con una conexión más
    // antigua bloquea la apertura (ver offline-db.js) — sin este try/catch,
    // el error quedaba sin capturar dentro de este async function y la
    // biblioteca se quedaba en blanco (las rejillas ya se habían vaciado más
    // arriba) en vez de degradar mostrando al menos los libros online.
    console.warn('No se pudo leer los libros descargados:', err);
  }
  const offlineById = new Map(offlineBooks.map(b => [b.id, b]));

  if (totalEl) {
    if (offlineBooks.length) {
      const totalBytes = offlineBooks.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);
      totalEl.textContent = `${formatBytes(totalBytes)} descargados · ${offlineBooks.length} libro${offlineBooks.length === 1 ? '' : 's'}`;
    } else {
      totalEl.textContent = '';
    }
  }

  let onlineBooks = [];
  let progress = {};
  let hasOnline = false;
  let token = null;

  try {
    const result = await fetchBooksOnline();
    onlineBooks = result.books;
    progress = result.progress;
    hasOnline = true;
    token = localStorage.getItem('token');
  } catch (err) {
    console.warn('No se pudo cargar la biblioteca desde el servidor, se muestran solo los libros descargados:', err);
  }

  if (!hasOnline) {
    showLibrosOfflineBanner();
  } else if (token && offlineBooks.length) {
    syncPendingOfflineProgress(token, offlineBooks, progress).catch(err =>
      console.warn('No se pudo sincronizar el progreso pendiente:', err));
  }

  // Fusión: todo lo que hay online + los descargados que ya no estén en la
  // lista online (por si se quitaron de la carpeta pero siguen offline).
  const byId = new Map();
  onlineBooks.forEach(b => byId.set(b.id, b));
  offlineBooks.forEach(b => {
    if (!byId.has(b.id)) byId.set(b.id, { id: b.id, title: b.title, format: b.format });
  });

  const allBooks = Array.from(byId.values());

  if (!allBooks.length) {
    emptyMessage.style.display = 'block';
    return;
  }

  const canManageCovers = hasOnline && isAdminUser();

  // Clasificación: en progreso (con %, más reciente primero) / sin leer /
  // terminado (alfabético dentro de cada uno, salvo "en progreso").
  const classified = { 'in-progress': [], unread: [], finished: [] };
  allBooks.forEach(book => {
    const progressEntry = getEffectiveProgress(book.id, progress);
    classified[classifyBook(progressEntry)].push({ book, progressEntry });
  });

  classified['in-progress'].sort((a, b) =>
    new Date(b.progressEntry.updatedAt) - new Date(a.progressEntry.updatedAt));
  classified.unread.sort((a, b) => a.book.title.localeCompare(b.book.title));
  classified.finished.sort((a, b) => a.book.title.localeCompare(b.book.title));

  Object.entries(classified).forEach(([status, entries]) => {
    if (!entries.length) return;
    const { section, grid } = sections[status];
    section.style.display = 'block';
    entries.forEach(({ book, progressEntry }) => {
      const offlineRecord = offlineById.get(book.id);
      const card = renderBookCard({
        id: book.id,
        title: book.title,
        format: book.format,
        coverUrl: book.coverUrl,
        downloaded: !!offlineRecord,
        sizeBytes: offlineRecord?.sizeBytes,
        status,
        percent: progressEntry?.percent,
        canManageCover: canManageCovers,
        onDeleted: renderLibrary,
        onCoverChanged: renderLibrary
      });
      grid.appendChild(card);
    });
  });
}

document.addEventListener('DOMContentLoaded', renderLibrary);
