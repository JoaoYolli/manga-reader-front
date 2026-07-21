// download-manager.js
// Widget discreto (bolita flotante) para mostrar y gestionar descargas en curso.

const activeDownloads = new Map();
let downloadBallEl = null;
let downloadPanelEl = null;
let downloadListEl = null;

function injectDownloadManagerStyles() {
    const style = document.createElement('style');
    style.textContent = `
        #download-ball {
            position: fixed;
            bottom: 1rem;
            left: 1rem;
            width: 3rem;
            height: 3rem;
            border-radius: 50%;
            background: #4a90e2;
            box-shadow: 0 2px 8px rgba(0,0,0,0.35);
            display: none;
            align-items: center;
            justify-content: center;
            color: #fff;
            font-size: 1.3rem;
            cursor: pointer;
            z-index: 3000;
            animation: download-ball-float 1.4s ease-in-out infinite;
        }
        #download-ball.visible { display: flex; }
        @keyframes download-ball-float {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-10px); }
        }
        #download-panel {
            position: fixed;
            bottom: 4.75rem;
            left: 1rem;
            display: none;
            background: #fff;
            border-radius: 0.5rem;
            box-shadow: 0 4px 16px rgba(0,0,0,0.3);
            padding: 0.75rem;
            width: min(300px, calc(100vw - 2rem));
            max-height: 50vh;
            overflow-y: auto;
            z-index: 3000;
        }
        #download-panel h4 {
            margin: 0 0 0.5rem;
            font-size: 0.9rem;
            color: #333;
        }
        .download-item {
            margin-bottom: 0.6rem;
            font-size: 0.8rem;
            color: #333;
        }
        .download-item-row {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 0.5rem;
        }
        .download-item-bar {
            background: #eee;
            border-radius: 4px;
            height: 6px;
            margin-top: 4px;
            overflow: hidden;
        }
        .download-item-fill {
            background: #4caf50;
            height: 100%;
            width: 0%;
            transition: width 0.2s ease;
        }
        .download-cancel-btn {
            border: none;
            background: transparent;
            color: #c0392b;
            cursor: pointer;
            font-size: 0.95rem;
            line-height: 1;
        }
        .download-empty {
            font-size: 0.8rem;
            color: #666;
            margin: 0;
        }
    `;
    document.head.appendChild(style);
}

function ensureDownloadManagerUI() {
    if (downloadBallEl) return;
    injectDownloadManagerStyles();

    downloadBallEl = document.createElement('div');
    downloadBallEl.id = 'download-ball';
    downloadBallEl.textContent = '⬇️';
    downloadBallEl.addEventListener('click', () => {
        downloadPanelEl.style.display = downloadPanelEl.style.display === 'block' ? 'none' : 'block';
    });
    if (window.isTvMode) makeTvFocusable(downloadBallEl);

    downloadPanelEl = document.createElement('div');
    downloadPanelEl.id = 'download-panel';

    const heading = document.createElement('h4');
    heading.textContent = 'Descargas en curso';

    downloadListEl = document.createElement('div');
    downloadListEl.id = 'download-list';

    downloadPanelEl.append(heading, downloadListEl);
    document.body.append(downloadBallEl, downloadPanelEl);
}

function renderDownloadManager() {
    ensureDownloadManagerUI();

    downloadBallEl.classList.toggle('visible', activeDownloads.size > 0);
    if (activeDownloads.size === 0) downloadPanelEl.style.display = 'none';

    downloadListEl.innerHTML = '';

    if (!activeDownloads.size) {
        const empty = document.createElement('p');
        empty.className = 'download-empty';
        empty.textContent = 'Sin descargas en curso.';
        downloadListEl.appendChild(empty);
        return;
    }

    activeDownloads.forEach((entry, id) => {
        const item = document.createElement('div');
        item.className = 'download-item';

        const row = document.createElement('div');
        row.className = 'download-item-row';

        const label = document.createElement('span');
        label.textContent = `${entry.label} (${entry.progress}%)`;

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'download-cancel-btn';
        cancelBtn.textContent = '✕';
        cancelBtn.title = 'Cancelar descarga';
        cancelBtn.addEventListener('click', () => cancelDownload(id));

        row.append(label, cancelBtn);

        const bar = document.createElement('div');
        bar.className = 'download-item-bar';
        const fill = document.createElement('div');
        fill.className = 'download-item-fill';
        fill.style.width = `${entry.progress}%`;
        bar.appendChild(fill);

        item.append(row, bar);
        downloadListEl.appendChild(item);
    });
}

function createDownload(label) {
    const id = crypto.randomUUID();
    const controller = new AbortController();
    activeDownloads.set(id, { label, progress: 0, controller });
    renderDownloadManager();

    return {
        signal: controller.signal,
        setProgress(pct) {
            const entry = activeDownloads.get(id);
            if (entry) {
                entry.progress = pct;
                renderDownloadManager();
            }
        },
        finish() {
            activeDownloads.delete(id);
            renderDownloadManager();
        }
    };
}

function cancelDownload(id) {
    const entry = activeDownloads.get(id);
    if (!entry) return;
    entry.controller.abort();
    activeDownloads.delete(id);
    renderDownloadManager();
}
