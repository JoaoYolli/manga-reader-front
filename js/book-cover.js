// book-cover.js — portada generada a partir del título del libro (no se
// sube ni se extrae metadata real de EPUB/PDF). Puro <canvas>, sin red ni
// E/S de archivos, así que funciona igual online que offline y se recalcula
// al vuelo cada vez que se pinta una tarjeta.

function bookCoverHue(title) {
  let hash = 0;
  const str = title || '';
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

function renderBookCoverCanvas(canvas, title) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const hue = bookCoverHue(title);

  ctx.fillStyle = `hsl(${hue}, 42%, 90%)`;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = `hsl(${hue}, 55%, 32%)`;
  ctx.fillRect(0, 0, w, h * 0.12);

  ctx.fillStyle = `hsl(${hue}, 60%, 22%)`;
  ctx.font = `600 ${Math.round(w * 0.105)}px "Zilla Slab", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const words = (title || '').split(/\s+/).filter(Boolean);
  const maxWidth = w * 0.82;
  const lines = [];
  let line = '';
  words.forEach(word => {
    const test = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(test).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  });
  if (line) lines.push(line);

  const shownLines = lines.slice(0, 5);
  const lineHeight = w * 0.13;
  const startY = h / 2 - ((shownLines.length - 1) * lineHeight) / 2;
  shownLines.forEach((l, i) => {
    ctx.fillText(l, w / 2, startY + i * lineHeight);
  });
}

// Devuelve un data URL PNG listo para usar como src de <img>.
function generateBookCoverDataUrl(title, width = 300, height = 400) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  renderBookCoverCanvas(canvas, title);
  return canvas.toDataURL('image/png');
}
