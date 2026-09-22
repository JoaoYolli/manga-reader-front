// libros.js — biblioteca de libros electrónicos (EPUB/PDF), organizada en
// colecciones (carpetas) que pueden contener más colecciones o libros, n
// niveles. El id de cualquier nodo (libro o colección) es su ruta relativa
// completa dentro de la carpeta de libros del servidor (p. ej.
// "ColeccionA/Sub/Libro1.epub"), no solo su nombre de archivo.

const back = "https://manga-back.yolli.xyz";

function isAdminUser() {
  return localStorage.getItem('isAdmin') === 'true';
}

// --- Estado de la vista, reflejado en la URL (?path=&q=&tag=&collection=) -
// `path`: colección que se está navegando (vacío = raíz).
// `q`/`tag`/`collection`: filtros. En cuanto alguno está activo, la vista
// cambia de navegación jerárquica a una lista plana con resultados de todo
// el árbol (ver isFiltering/renderLibrary).

function getViewState() {
  const params = new URLSearchParams(window.location.search);
  return {
    path: params.get('path') || '',
    q: params.get('q') || '',
    tag: params.get('tag') || 'all',
    collection: params.get('collection') || ''
  };
}

function setViewState(patch) {
  const next = { ...getViewState(), ...patch };
  const params = new URLSearchParams();
  if (next.path) params.set('path', next.path);
  if (next.q) params.set('q', next.q);
  if (next.tag && next.tag !== 'all') params.set('tag', next.tag);
  if (next.collection) params.set('collection', next.collection);
  const query = params.toString();
  history.replaceState(null, '', query ? `${location.pathname}?${query}` : location.pathname);
}

function isFiltering(state) {
  return !!(state.q.trim() || state.tag !== 'all' || state.collection);
}

// --- Carga de la biblioteca (árbol + progreso) --------------------------

async function fetchLibrary() {
  const token = localStorage.getItem('token');
  if (!token) throw new Error('Sin sesión');

  const [treeRes, progressRes] = await Promise.all([
    fetch(`${back}/books?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) }),
    fetch(`${back}/books/progress?token=${encodeURIComponent(token)}`, { signal: AbortSignal.timeout(8000) })
  ]);
  if (!treeRes.ok) throw new Error('No se pudo obtener la biblioteca');

  const treeData = await treeRes.json();
  const progressData = progressRes.ok ? await progressRes.json() : { progress: {} };
  return {
    tree: treeData.tree || [],
    lastScannedAt: treeData.lastScannedAt || null,
    scanning: !!treeData.scanning,
    progress: progressData.progress || {}
  };
}

async function triggerRescan(token) {
  const res = await fetch(`${back}/admin/books/rescan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token }),
    signal: AbortSignal.timeout(5000)
  });
  return res.ok;
}

function showLibrosOfflineBanner() {
  if (document.getElementById('libros-offline-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'libros-offline-banner';
  banner.className = 'status-banner';

  const text = document.createElement('span');
  text.textContent = 'Sin conexión: mostrando solo los libros descargados, sin colecciones.';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'status-banner-close';
  closeBtn.setAttribute('aria-label', 'Cerrar aviso');
  closeBtn.textContent = '✕';
  closeBtn.addEventListener('click', () => banner.remove());

  banner.append(text, closeBtn);
  document.body.prepend(banner);
}

// --- Progreso pendiente de sincronizar (igual que antes) ----------------

function loadLocalProgressFor(bookId) {
  try {
    return JSON.parse(localStorage.getItem(`bookProgress:${bookId}`));
  } catch {
    return null;
  }
}

async function pushProgressToServer(token, bookId, locator, percent) {
  try {
    const res = await fetch(`${back}/books/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, id: bookId, locator, percent: percent ?? null }),
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

// --- Clasificación: sin leer / en progreso / terminado -------------------
// Sustituye a las antiguas secciones fijas — ahora es una etiqueta sobre
// cada tarjeta (ver renderStatusBadge) y un criterio de filtro más.

function getEffectiveProgress(bookId, serverProgress) {
  const local = loadLocalProgressFor(bookId);
  const server = serverProgress[bookId];
  if (local && (!server || new Date(local.updatedAt) > new Date(server.updatedAt))) return local;
  return server || null;
}

function classifyBook(progressEntry) {
  if (!progressEntry) return 'unread';
  if (typeof progressEntry.percent === 'number' && progressEntry.percent >= 100) return 'finished';
  return 'in-progress';
}

const STATUS_LABELS = { unread: 'Sin leer', 'in-progress': 'En progreso', finished: 'Terminado' };

function renderStatusBadge(status, percent) {
  const badge = document.createElement('span');
  badge.className = `book-status-badge status-${status}`;
  badge.textContent = status === 'in-progress' && typeof percent === 'number'
    ? `${STATUS_LABELS[status]} ${percent}%`
    : STATUS_LABELS[status];
  return badge;
}

// --- Árbol: helpers de navegación ----------------------------------------

function findCollectionChildren(tree, collectionId) {
  if (!collectionId) return { node: null, children: tree };
  function search(nodes) {
    for (const node of nodes) {
      if (node.type !== 'collection') continue;
      if (node.id === collectionId) return node;
      const found = search(node.children);
      if (found) return found;
    }
    return null;
  }
  const node = search(tree);
  return { node, children: node ? node.children : [] };
}

function buildBreadcrumb(tree, collectionId) {
  if (!collectionId) return [];
  const segments = collectionId.split('/');
  const crumbs = [];
  let idAcc = '';
  let children = tree;
  for (const seg of segments) {
    idAcc = idAcc ? `${idAcc}/${seg}` : seg;
    const node = children.find(n => n.type === 'collection' && n.id === idAcc);
    crumbs.push({ id: idAcc, name: node ? node.name : seg });
    children = node ? node.children : [];
  }
  return crumbs;
}

function flattenBooks(nodes, collectionPath = [], out = []) {
  nodes.forEach(node => {
    if (node.type === 'book') {
      out.push({ node, collectionPath });
    } else {
      flattenBooks(node.children, [...collectionPath, node], out);
    }
  });
  return out;
}

function flattenCollections(nodes, out = []) {
  nodes.forEach(node => {
    if (node.type !== 'collection') return;
    out.push(node);
    flattenCollections(node.children, out);
  });
  return out;
}

function collectBookDescendants(collectionNode, out = []) {
  collectionNode.children.forEach(child => {
    if (child.type === 'book') out.push(child);
    else collectBookDescendants(child, out);
  });
  return out;
}

// --- Portada elegida por un admin (Open Library) — igual para libros y
// colecciones, el backend identifica el nodo por su id (ruta) sin más ------

async function searchBookCovers(token, id, query) {
  const res = await fetch(`${back}/admin/books/cover_search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, id, query }),
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error('No se pudo buscar portadas');
  const data = await res.json();
  return data.results || [];
}

async function setBookCover(token, id, coverUrl) {
  const res = await fetch(`${back}/admin/books/cover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, id, coverUrl }),
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error('No se pudo guardar la portada');
}

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
        resultsEl.innerHTML = '<p class="cover-picker-status">Sin resultados. Puede que Open Library no tenga portada para este título — prueba con otra búsqueda, o pega una URL de imagen abajo.</p>';
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

// --- Descarga de una colección completa (recursiva) ----------------------
// A diferencia de un libro suelto (un fetch por click), aquí se orquesta un
// lote de descargas desde la propia página, con concurrencia limitada (mismo
// patrón que sw.js usa para las imágenes de un capítulo), reutilizando el
// mismo widget flotante de descargas vía la vía "genérica" de
// download-manager.js.

async function downloadCollection(collectionNode) {
  const books = collectBookDescendants(collectionNode);
  if (!books.length) {
    alert('Esta colección no tiene libros para descargar.');
    return;
  }

  const token = localStorage.getItem('token');
  const jobId = `collection-dl-${encodeURIComponent(collectionNode.id)}`;
  const controller = new AbortController();
  registerGenericDownload(jobId, `Colección: ${collectionNode.name}`, controller);

  const CONCURRENCY = 3;
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (nextIndex < books.length) {
      const i = nextIndex++;
      const book = books[i];
      try {
        const existing = await getOfflineBook(book.id);
        if (!existing) {
          const res = await fetch(`${back}/books/file?id=${encodeURIComponent(book.id)}&token=${encodeURIComponent(token)}`, { signal: controller.signal });
          if (!res.ok) throw new Error(`No se pudo descargar ${book.id}`);
          const blob = await res.blob();
          await saveBookOffline({ id: book.id, title: book.title, format: book.format, fileBlob: blob });
        }
      } catch (err) {
        if (controller.signal.aborted) throw err;
        console.error('No se pudo descargar', book.id, err);
      }
      completed++;
      updateGenericDownloadProgress(jobId, Math.round((completed / books.length) * 100));
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, books.length) }, worker));
  } catch (err) {
    if (!controller.signal.aborted) console.error('Error descargando la colección:', err);
  } finally {
    finishGenericDownload(jobId);
  }
}

// --- Tarjetas --------------------------------------------------------------

function renderBookCard({ id, title, format, coverUrl, downloaded, sizeBytes, status, percent, collectionLabel, canManageCover, onDeleted, onCoverChanged }) {
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

  card.appendChild(renderStatusBadge(status, percent));

  const titleEl = document.createElement('h3');
  titleEl.textContent = title;
  card.appendChild(titleEl);

  const meta = document.createElement('p');
  meta.className = 'manga-card-meta mono';
  const bits = [(format || '').toUpperCase()];
  if (downloaded) bits.push(formatBytes(sizeBytes));
  if (collectionLabel) bits.push(collectionLabel);
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

function renderCollectionCard(node, { canManageCover, onNavigate, onCoverChanged }) {
  const bookCount = collectBookDescendants(node).length;

  const card = document.createElement('div');
  card.classList.add('manga-card', 'collection-card');
  card.addEventListener('click', () => onNavigate(node.id));
  if (window.isTvMode) makeTvFocusable(card);

  const img = document.createElement('img');
  img.src = node.coverUrl || generateBookCoverDataUrl(node.name);
  img.alt = node.name;
  card.appendChild(img);

  const titleEl = document.createElement('h3');
  titleEl.textContent = node.name;
  card.appendChild(titleEl);

  const meta = document.createElement('p');
  meta.className = 'manga-card-meta mono';
  meta.textContent = `${bookCount} libro${bookCount === 1 ? '' : 's'}`;
  card.appendChild(meta);

  const downloadBtn = document.createElement('button');
  downloadBtn.className = 'collection-download-btn';
  downloadBtn.setAttribute('aria-label', 'Descargar colección completa');
  downloadBtn.title = 'Descargar toda la colección para leer sin conexión';
  downloadBtn.innerHTML = '<span class="icon icon-download"></span>';
  downloadBtn.addEventListener('click', e => {
    e.stopPropagation();
    downloadCollection(node);
  });
  card.appendChild(downloadBtn);

  if (canManageCover) {
    const coverBtn = document.createElement('button');
    coverBtn.className = 'book-cover-btn';
    coverBtn.setAttribute('aria-label', 'Elegir portada de la colección');
    coverBtn.title = 'Elegir portada';
    coverBtn.innerHTML = '<span class="icon icon-image"></span>';
    coverBtn.addEventListener('click', e => {
      e.stopPropagation();
      showCoverPickerModal(node.id, node.name, node.coverUrl, onCoverChanged);
    });
    card.appendChild(coverBtn);
  }

  return card;
}

// --- Orquestación de la carga + render ------------------------------------

let libraryData = { tree: [], progress: {}, lastScannedAt: null, scanning: false, hasOnline: false };
let offlineBooksById = new Map();

function formatRelativeTime(iso) {
  if (!iso) return null;
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'hace un momento';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return `hace ${days} día${days === 1 ? '' : 's'}`;
}

function bookEntryToCardProps(entry, { collectionLabel }) {
  const { node } = entry;
  const offlineRecord = offlineBooksById.get(node.id);
  const progressEntry = getEffectiveProgress(node.id, libraryData.progress);
  return {
    id: node.id,
    title: node.title,
    format: node.format,
    coverUrl: node.coverUrl,
    downloaded: !!offlineRecord,
    sizeBytes: offlineRecord?.sizeBytes,
    status: classifyBook(progressEntry),
    percent: progressEntry?.percent,
    collectionLabel
  };
}

async function loadLibraryData() {
  let offlineBooks = [];
  try {
    offlineBooks = await listOfflineBooks();
  } catch (err) {
    console.warn('No se pudo leer los libros descargados:', err);
  }
  offlineBooksById = new Map(offlineBooks.map(b => [b.id, b]));

  try {
    const result = await fetchLibrary();
    libraryData = { ...result, hasOnline: true };
    const token = localStorage.getItem('token');
    if (token && offlineBooks.length) {
      syncPendingOfflineProgress(token, offlineBooks, result.progress).catch(err =>
        console.warn('No se pudo sincronizar el progreso pendiente:', err));
    }
  } catch (err) {
    console.warn('No se pudo cargar la biblioteca desde el servidor, se muestran solo los libros descargados:', err);
    libraryData = { tree: [], progress: {}, lastScannedAt: null, scanning: false, hasOnline: false };
  }
}

function renderStorageTotals() {
  const totalEl = document.getElementById('storage-total');
  const offlineBooks = Array.from(offlineBooksById.values());
  if (!offlineBooks.length) {
    totalEl.textContent = '';
    return;
  }
  const totalBytes = offlineBooks.reduce((sum, b) => sum + (b.sizeBytes || 0), 0);
  totalEl.textContent = `${formatBytes(totalBytes)} descargados · ${offlineBooks.length} libro${offlineBooks.length === 1 ? '' : 's'}`;
}

function renderScanStatus() {
  const el = document.getElementById('library-scan-status');
  if (!libraryData.hasOnline) {
    el.textContent = '';
    return;
  }
  if (libraryData.scanning) {
    el.textContent = 'Actualizando la biblioteca…';
    return;
  }
  const rel = formatRelativeTime(libraryData.lastScannedAt);
  el.textContent = rel ? `Biblioteca actualizada ${rel}` : '';
}

function renderInProgressShelf() {
  const section = document.getElementById('in-progress-shelf');
  const grid = document.getElementById('books-in-progress');
  grid.innerHTML = '';

  const entries = flattenBooks(libraryData.tree)
    .map(entry => ({ entry, progressEntry: getEffectiveProgress(entry.node.id, libraryData.progress) }))
    .filter(({ progressEntry }) => classifyBook(progressEntry) === 'in-progress');

  if (!entries.length) {
    section.style.display = 'none';
    return;
  }

  entries.sort((a, b) => new Date(b.progressEntry.updatedAt) - new Date(a.progressEntry.updatedAt));
  section.style.display = 'block';

  entries.forEach(({ entry }) => {
    const collectionLabel = entry.collectionPath.map(c => c.name).join(' / ') || null;
    const card = renderBookCard({
      ...bookEntryToCardProps(entry, { collectionLabel }),
      canManageCover: false,
      onDeleted: renderLibraryView,
      onCoverChanged: renderLibraryView
    });
    grid.appendChild(card);
  });
}

function renderCollectionFilterOptions() {
  const select = document.getElementById('library-collection-filter');
  const current = select.value;
  select.innerHTML = '<option value="">Todas las colecciones</option>';
  flattenCollections(libraryData.tree).forEach(col => {
    const depth = col.id.split('/').length - 1;
    const opt = document.createElement('option');
    opt.value = col.id;
    opt.textContent = `${'— '.repeat(depth)}${col.name}`;
    select.appendChild(opt);
  });
  select.value = current;
}

function renderBreadcrumb(state) {
  const nav = document.getElementById('library-breadcrumb');
  nav.innerHTML = '';
  if (isFiltering(state) || !libraryData.hasOnline) {
    nav.style.display = 'none';
    return;
  }
  nav.style.display = 'flex';

  const homeBtn = document.createElement('button');
  homeBtn.type = 'button';
  homeBtn.textContent = 'Biblioteca';
  homeBtn.addEventListener('click', () => { setViewState({ path: '' }); renderLibraryView(); });
  nav.appendChild(homeBtn);

  const crumbs = buildBreadcrumb(libraryData.tree, state.path);
  crumbs.forEach((crumb, i) => {
    const sep = document.createElement('span');
    sep.className = 'breadcrumb-sep';
    sep.textContent = '›';
    nav.appendChild(sep);

    if (i === crumbs.length - 1) {
      const current = document.createElement('span');
      current.className = 'breadcrumb-current';
      current.textContent = crumb.name;
      nav.appendChild(current);
    } else {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = crumb.name;
      btn.addEventListener('click', () => { setViewState({ path: crumb.id }); renderLibraryView(); });
      nav.appendChild(btn);
    }
  });
}

function renderHierarchyGrid(state) {
  const grid = document.getElementById('library-grid');
  const emptyMessage = document.getElementById('empty-message');
  grid.innerHTML = '';

  if (!libraryData.hasOnline) {
    // Sin conexión: no se conoce el árbol real, se listan los libros
    // descargados en plano, sin navegación por colecciones.
    const offlineBooks = Array.from(offlineBooksById.values());
    if (!offlineBooks.length) {
      emptyMessage.style.display = 'block';
      return;
    }
    emptyMessage.style.display = 'none';
    offlineBooks.forEach(book => {
      const collectionLabel = book.id.includes('/') ? book.id.split('/').slice(0, -1).join(' / ') : null;
      const progressEntry = getEffectiveProgress(book.id, {});
      const card = renderBookCard({
        id: book.id,
        title: book.title,
        format: book.format,
        coverUrl: null,
        downloaded: true,
        sizeBytes: book.sizeBytes,
        status: classifyBook(progressEntry),
        percent: progressEntry?.percent,
        collectionLabel,
        canManageCover: false,
        onDeleted: renderLibraryView,
        onCoverChanged: renderLibraryView
      });
      grid.appendChild(card);
    });
    return;
  }

  const { children } = findCollectionChildren(libraryData.tree, state.path);
  if (!children.length) {
    emptyMessage.style.display = 'block';
    return;
  }
  emptyMessage.style.display = 'none';

  const canManageCovers = isAdminUser();

  children.forEach(node => {
    if (node.type === 'collection') {
      grid.appendChild(renderCollectionCard(node, {
        canManageCover: canManageCovers,
        onNavigate: id => { setViewState({ path: id }); renderLibraryView(); },
        onCoverChanged: renderLibraryView
      }));
    } else {
      grid.appendChild(renderBookCard({
        ...bookEntryToCardProps({ node }, { collectionLabel: null }),
        canManageCover: canManageCovers,
        onDeleted: renderLibraryView,
        onCoverChanged: renderLibraryView
      }));
    }
  });
}

function renderFilteredGrid(state) {
  const grid = document.getElementById('library-grid');
  const emptyMessage = document.getElementById('empty-message');
  grid.innerHTML = '';

  const q = state.q.trim().toLowerCase();
  const canManageCovers = libraryData.hasOnline && isAdminUser();

  const results = flattenBooks(libraryData.tree).filter(entry => {
    if (q && !entry.node.title.toLowerCase().includes(q)) return false;
    if (state.collection && !entry.collectionPath.some(c => c.id === state.collection)) return false;
    if (state.tag !== 'all') {
      const progressEntry = getEffectiveProgress(entry.node.id, libraryData.progress);
      if (classifyBook(progressEntry) !== state.tag) return false;
    }
    return true;
  });

  results.sort((a, b) => a.node.title.localeCompare(b.node.title));

  if (!results.length) {
    emptyMessage.style.display = 'block';
    return;
  }
  emptyMessage.style.display = 'none';

  results.forEach(entry => {
    const collectionLabel = entry.collectionPath.map(c => c.name).join(' / ') || null;
    grid.appendChild(renderBookCard({
      ...bookEntryToCardProps(entry, { collectionLabel }),
      canManageCover: canManageCovers,
      onDeleted: renderLibraryView,
      onCoverChanged: renderLibraryView
    }));
  });
}

async function renderLibraryView() {
  const state = getViewState();

  renderStorageTotals();
  renderScanStatus();
  renderInProgressShelf();
  renderCollectionFilterOptions();
  renderBreadcrumb(state);

  document.getElementById('library-search').value = state.q;
  document.querySelectorAll('.chip-filter').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tag === state.tag);
  });
  document.getElementById('library-collection-filter').value = state.collection;

  if (!libraryData.hasOnline) {
    showLibrosOfflineBanner();
  }

  if (isFiltering(state)) {
    renderFilteredGrid(state);
  } else {
    renderHierarchyGrid(state);
  }
}

async function renderLibrary() {
  await loadLibraryData();
  await renderLibraryView();
}

// --- Rescan (solo admin), asíncrono con polling ---------------------------

let rescanPolling = false;

function pollRescan() {
  if (rescanPolling) return;
  rescanPolling = true;

  const check = async () => {
    try {
      const { tree, lastScannedAt, scanning, progress } = await fetchLibrary();
      libraryData = { tree, lastScannedAt, scanning, progress, hasOnline: true };
      renderScanStatus();
      if (scanning) {
        setTimeout(check, 2000);
        return;
      }
    } catch (err) {
      console.warn('No se pudo comprobar el estado del rescan:', err);
    }
    rescanPolling = false;
    renderLibraryView();
  };

  check();
}

function initMenu() {
  const burger = document.getElementById('burger');
  const menu = document.getElementById('menu');
  if (window.isTvMode) makeTvFocusable(burger);

  burger.addEventListener('click', () => {
    menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
  });
  document.addEventListener('click', e => {
    if (!burger.contains(e.target) && !menu.contains(e.target)) {
      menu.style.display = 'none';
    }
  });

  const rescanItem = document.getElementById('rescan-menu-item');
  const rescanLink = document.getElementById('rescan-library');
  if (isAdminUser()) {
    rescanItem.style.display = 'block';
    if (window.isTvMode) makeTvFocusable(rescanLink);
    rescanLink.addEventListener('click', async e => {
      e.preventDefault();
      menu.style.display = 'none';
      const token = localStorage.getItem('token');
      const ok = await triggerRescan(token);
      if (!ok) {
        alert('No se pudo iniciar la actualización de la biblioteca.');
        return;
      }
      libraryData.scanning = true;
      renderScanStatus();
      pollRescan();
    });
  }
}

function initFilters() {
  let searchDebounce = null;
  document.getElementById('library-search').addEventListener('input', e => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      setViewState({ q: e.target.value });
      renderLibraryView();
    }, 300);
  });

  document.querySelectorAll('.chip-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      setViewState({ tag: btn.dataset.tag });
      renderLibraryView();
    });
  });

  document.getElementById('library-collection-filter').addEventListener('change', e => {
    setViewState({ collection: e.target.value });
    renderLibraryView();
  });
}

window.addEventListener('popstate', renderLibraryView);

document.addEventListener('DOMContentLoaded', () => {
  initMenu();
  initFilters();
  renderLibrary();
});
