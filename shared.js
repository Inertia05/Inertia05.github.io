// =============================================================
// shared.js — mask_composer / align_replace_mask_tool 公共模块
// =============================================================

// ----- Utility -----
function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function setCanvasSize(canvas, w, h) {
  canvas.width = w;
  canvas.height = h;
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
}

function setWrapSize(wrap, w, h) {
  wrap.style.width = w + 'px';
  wrap.style.height = h + 'px';
}

function downloadCanvas(canvas, filename) {
  const a = document.createElement('a');
  a.href = canvas.toDataURL('image/png');
  a.download = filename;
  a.click();
}

function screenToWorld(clientX, clientY, container, view) {
  const rect = container.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.x) / view.scale,
    y: (clientY - rect.top - view.y) / view.scale
  };
}

function pointInsideRect(p, w, h) {
  return p.x >= 0 && p.y >= 0 && p.x <= w && p.y <= h;
}

// ----- View transform helpers -----
function applyViewTransform(wrap, view) {
  wrap.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
}

function fitView(view, containerEl, contentW, contentH) {
  view.scale = Math.min(containerEl.clientWidth / contentW, containerEl.clientHeight / contentH);
  if (!isFinite(view.scale) || view.scale <= 0) view.scale = 1;
  view.x = (containerEl.clientWidth - contentW * view.scale) / 2;
  view.y = (containerEl.clientHeight - contentH * view.scale) / 2;
}

function actualView(view, containerEl, contentW, contentH) {
  view.scale = 1;
  view.x = Math.max(0, (containerEl.clientWidth - contentW) / 2);
  view.y = Math.max(0, (containerEl.clientHeight - contentH) / 2);
}

function zoomAtPoint(view, clientX, clientY, containerEl, delta, minScale, maxScale) {
  const rect = containerEl.getBoundingClientRect();
  const mx = clientX - rect.left;
  const my = clientY - rect.top;
  const oldScale = view.scale;
  const factor = delta < 0 ? 1.1 : 1 / 1.1;
  view.scale = clamp(view.scale * factor, minScale || 0.05, maxScale || 16);
  const worldX = (mx - view.x) / oldScale;
  const worldY = (my - view.y) / oldScale;
  view.x = mx - worldX * view.scale;
  view.y = my - worldY * view.scale;
}

// ----- Mask painting -----
function paintMaskLine(ctx, p0, p1, tool, brushSize) {
  const color = tool === 'brush' ? 'rgba(255,255,255,1)' : 'rgba(0,0,0,1)';
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = brushSize;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(p1.x, p1.y, brushSize / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawBrushCursor(ctx, canvasW, canvasH, point, tool, brushSize) {
  ctx.clearRect(0, 0, canvasW, canvasH);
  ctx.beginPath();
  ctx.arc(point.x, point.y, brushSize / 2, 0, Math.PI * 2);
  ctx.strokeStyle = tool === 'brush' ? 'rgba(0,255,255,0.95)' : 'rgba(255,180,0,0.95)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ----- Mask operations -----
function clearMaskData(ctx, w, h, fillTrue) {
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const val = fillTrue ? 255 : 0;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = val;
    d[i + 1] = val;
    d[i + 2] = val;
    d[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function pushMaskUndo(undoStack, ctx, w, h, maxUndo) {
  const snapshot = ctx.getImageData(0, 0, w, h);
  undoStack.push(snapshot);
  if (undoStack.length > (maxUndo || 20)) undoStack.shift();
}

function popMaskUndo(undoStack, ctx) {
  if (!undoStack.length) return false;
  const snap = undoStack.pop();
  ctx.putImageData(snap, 0, 0);
  return true;
}

function exportMaskPNG(maskCtx, w, h, filename) {
  const src = maskCtx.getImageData(0, 0, w, h);
  const outCanvas = document.createElement('canvas');
  outCanvas.width = w;
  outCanvas.height = h;
  const ctx = outCanvas.getContext('2d');
  const out = ctx.createImageData(w, h);
  const S = src.data, D = out.data;
  for (let i = 0; i < D.length; i += 4) {
    const v = S[i] >= 128 ? 255 : 0;
    D[i] = v; D[i + 1] = v; D[i + 2] = v; D[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  downloadCanvas(outCanvas, filename || 'mask.png');
}

// ----- Mask red tint overlay -----
function drawMaskTintOverlay(targetCtx, maskCtx, w, h, opacity) {
  if (opacity <= 0) return;
  const mData = maskCtx.getImageData(0, 0, w, h);
  const overlay = new ImageData(w, h);
  const M = mData.data, O = overlay.data;
  for (let i = 0; i < O.length; i += 4) {
    if (M[i] >= 128) {
      O[i] = 255;
      O[i + 1] = 40;
      O[i + 2] = 40;
      O[i + 3] = Math.round(255 * opacity);
    }
  }
  const temp = document.createElement('canvas');
  temp.width = w;
  temp.height = h;
  temp.getContext('2d').putImageData(overlay, 0, 0);
  targetCtx.drawImage(temp, 0, 0);
}

// ----- Composite (mask-based A/B merge) -----
function compositeImageData(aData, bData, maskData, w, h) {
  const out = new ImageData(w, h);
  const A = aData.data, B = bData.data, M = maskData.data, O = out.data;
  for (let i = 0; i < O.length; i += 4) {
    const takeA = M[i] >= 128;
    O[i]     = takeA ? A[i]     : B[i];
    O[i + 1] = takeA ? A[i + 1] : B[i + 1];
    O[i + 2] = takeA ? A[i + 2] : B[i + 2];
    O[i + 3] = takeA ? A[i + 3] : B[i + 3];
  }
  return out;
}

// ----- TGA decoder -----
function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

function decodeTGA(arrayBuffer) {
  const dv = new DataView(arrayBuffer);
  const bytes = new Uint8Array(arrayBuffer);
  if (bytes.length < 18) throw new Error('Invalid TGA file.');

  const idLength = dv.getUint8(0);
  const colorMapType = dv.getUint8(1);
  const imageType = dv.getUint8(2);
  const colorMapOrigin = dv.getUint16(3, true);
  const colorMapLength = dv.getUint16(5, true);
  const colorMapDepth = dv.getUint8(7);
  const width = dv.getUint16(12, true);
  const height = dv.getUint16(14, true);
  const pixelDepth = dv.getUint8(16);
  const imageDescriptor = dv.getUint8(17);

  if (!width || !height) throw new Error('Invalid TGA dimensions.');
  if (![1, 2, 9, 10].includes(imageType)) throw new Error('Unsupported TGA type.');
  if (![8, 24, 32].includes(pixelDepth)) throw new Error('Unsupported TGA bit depth.');

  let offset = 18 + idLength;

  let palette = null;
  if (colorMapType === 1) {
    const entryBytes = Math.ceil(colorMapDepth / 8);
    palette = [];
    for (let i = 0; i < colorMapLength; i++) {
      const base = offset + i * entryBytes;
      const b = bytes[base] ?? 0;
      const g = bytes[base + 1] ?? 0;
      const r = bytes[base + 2] ?? 0;
      const a = entryBytes >= 4 ? (bytes[base + 3] ?? 255) : 255;
      palette.push([r, g, b, a]);
    }
    offset += colorMapLength * Math.ceil(colorMapDepth / 8);
  }

  const out = new Uint8ClampedArray(width * height * 4);
  const topOrigin = !!(imageDescriptor & 0x20);

  function writePixel(pixelIndex, rgba) {
    const y = Math.floor(pixelIndex / width);
    const x = pixelIndex % width;
    const row = topOrigin ? y : (height - 1 - y);
    const di = (row * width + x) * 4;
    out[di] = rgba[0];
    out[di + 1] = rgba[1];
    out[di + 2] = rgba[2];
    out[di + 3] = rgba[3];
  }
  function readTrueColor(pos) {
    const b = bytes[pos] ?? 0;
    const g = bytes[pos + 1] ?? 0;
    const r = bytes[pos + 2] ?? 0;
    const a = pixelDepth === 32 ? (bytes[pos + 3] ?? 255) : 255;
    return [r, g, b, a];
  }
  function readIndexed(pos) {
    const idx = bytes[pos] - colorMapOrigin;
    return palette?.[idx] ?? [0, 0, 0, 255];
  }

  const pixelBytes = pixelDepth === 8 ? 1 : Math.ceil(pixelDepth / 8);
  const readPixel = colorMapType === 1 ? readIndexed : readTrueColor;
  let pixelIndex = 0;

  if (imageType === 1 || imageType === 2) {
    while (pixelIndex < width * height) {
      writePixel(pixelIndex++, readPixel(offset));
      offset += pixelBytes;
    }
  } else {
    while (pixelIndex < width * height && offset < bytes.length) {
      const header = bytes[offset++];
      const count = (header & 0x7f) + 1;
      if (header & 0x80) {
        const rgba = readPixel(offset);
        offset += pixelBytes;
        for (let i = 0; i < count && pixelIndex < width * height; i++) writePixel(pixelIndex++, rgba);
      } else {
        for (let i = 0; i < count && pixelIndex < width * height; i++) {
          writePixel(pixelIndex++, readPixel(offset));
          offset += pixelBytes;
        }
      }
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(out, width, height), 0, 0);
  return canvas;
}

async function readImageFile(file) {
  const lower = file.name.toLowerCase();
  if (lower.endsWith('.tga') || lower.endsWith('.targa')) {
    const buffer = await readFileAsArrayBuffer(file);
    const canvas = decodeTGA(buffer);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const url = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = reject;
    img.src = url;
  });
}

async function readImageFromURL(url) {
  const resp = await fetch(url);
  const buffer = await resp.arrayBuffer();
  const lower = url.toLowerCase();
  if (lower.endsWith('.tga') || lower.endsWith('.targa')) {
    const canvas = decodeTGA(buffer);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const blobUrl = URL.createObjectURL(blob);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = blobUrl;
      });
    } finally {
      URL.revokeObjectURL(blobUrl);
    }
  }
  const blob = new Blob([buffer]);
  const blobUrl = URL.createObjectURL(blob);
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(blobUrl); resolve(img); };
    img.onerror = reject;
    img.src = blobUrl;
  });
}

// ----- Border fill utilities -----
function extractChannelBinary(imageData, w, h, channel, threshold) {
  const pri = { R: 0, G: 1, B: 2 }[channel] || 0;
  const others = [0, 1, 2].filter(c => c !== pri);
  const d = imageData.data;
  const out = new Uint8Array(w * h);
  const lowMax = 255 - threshold;
  for (let i = 0; i < w * h; i++) {
    const base = i * 4;
    out[i] = (d[base + pri] >= threshold && d[base + others[0]] <= lowMax && d[base + others[1]] <= lowMax) ? 1 : 0;
  }
  return out;
}

function checkBorderClosed(borderData, w, h, minAreaRatio) {
  const visited = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (borderData[i]) visited[i] = 2;
  }
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  for (let x = 0; x < w; x++) {
    if (!visited[x]) { visited[x] = 1; queue[tail++] = x; }
    const bi = (h - 1) * w + x;
    if (!visited[bi]) { visited[bi] = 1; queue[tail++] = bi; }
  }
  for (let y = 0; y < h; y++) {
    const li = y * w;
    if (!visited[li]) { visited[li] = 1; queue[tail++] = li; }
    const ri = y * w + w - 1;
    if (!visited[ri]) { visited[ri] = 1; queue[tail++] = ri; }
  }
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w, y = (idx - x) / w;
    if (x > 0             && !visited[idx - 1])     { visited[idx - 1] = 1;     queue[tail++] = idx - 1; }
    if (x < w - 1         && !visited[idx + 1])     { visited[idx + 1] = 1;     queue[tail++] = idx + 1; }
    if (y > 0             && !visited[idx - w])     { visited[idx - w] = 1;     queue[tail++] = idx - w; }
    if (y < h - 1         && !visited[idx + w])     { visited[idx + w] = 1;     queue[tail++] = idx + w; }
    if (x > 0 && y > 0     && !visited[idx-w-1])   { visited[idx-w-1] = 1;     queue[tail++] = idx-w-1; }
    if (x < w-1 && y > 0   && !visited[idx-w+1])   { visited[idx-w+1] = 1;     queue[tail++] = idx-w+1; }
    if (x > 0 && y < h-1   && !visited[idx+w-1])   { visited[idx+w-1] = 1;     queue[tail++] = idx+w-1; }
    if (x < w-1 && y < h-1 && !visited[idx+w+1])   { visited[idx+w+1] = 1;     queue[tail++] = idx+w+1; }
  }
  // interior = pixels not reachable from edges and not border
  const interior = new Uint8Array(w * h);
  let interiorCount = 0;
  for (let i = 0; i < w * h; i++) {
    if (visited[i] === 0) { interior[i] = 1; interiorCount++; }
  }
  const minPixels = Math.floor(w * h * (minAreaRatio || 0.01));
  return { closed: interiorCount >= minPixels, interiorCount, interior };
}

function floodFillBinary(barrier, w, h, startX, startY, existing) {
  const sx = Math.floor(startX), sy = Math.floor(startY);
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return existing || new Uint8Array(w * h);
  const startIdx = sy * w + sx;
  if (barrier[startIdx]) return existing || new Uint8Array(w * h);
  const filled = existing || new Uint8Array(w * h);
  if (filled[startIdx]) return filled;
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0;
  filled[startIdx] = 1;
  queue[tail++] = startIdx;
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % w, y = (idx - x) / w;
    if (x > 0     && !filled[idx - 1] && !barrier[idx - 1]) { filled[idx - 1] = 1; queue[tail++] = idx - 1; }
    if (x < w - 1 && !filled[idx + 1] && !barrier[idx + 1]) { filled[idx + 1] = 1; queue[tail++] = idx + 1; }
    if (y > 0     && !filled[idx - w] && !barrier[idx - w]) { filled[idx - w] = 1; queue[tail++] = idx - w; }
    if (y < h - 1 && !filled[idx + w] && !barrier[idx + w]) { filled[idx + w] = 1; queue[tail++] = idx + w; }
  }
  return filled;
}

function hexToRgb(hex) {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function drawBorderOverlay(targetCtx, borderData, fillData, interiorData, w, h, colors) {
  const bc = colors && colors.border ? hexToRgb(colors.border) : [0, 255, 0];
  const fc = colors && colors.fill ? hexToRgb(colors.fill) : [80, 140, 255];
  const ic = colors && colors.interior ? hexToRgb(colors.interior) : [255, 220, 0];
  const overlay = new ImageData(w, h);
  const O = overlay.data;
  for (let i = 0; i < w * h; i++) {
    const pi = i * 4;
    if (borderData[i]) {
      O[pi] = bc[0]; O[pi+1] = bc[1]; O[pi+2] = bc[2]; O[pi+3] = 180;
    } else if (fillData && fillData[i]) {
      O[pi] = fc[0]; O[pi+1] = fc[1]; O[pi+2] = fc[2]; O[pi+3] = 130;
    } else if (interiorData && interiorData[i]) {
      O[pi] = ic[0]; O[pi+1] = ic[1]; O[pi+2] = ic[2]; O[pi+3] = 180;
    }
  }
  const temp = document.createElement('canvas');
  temp.width = w; temp.height = h;
  temp.getContext('2d').putImageData(overlay, 0, 0);
  targetCtx.drawImage(temp, 0, 0);
}

// ----- Morphological dilate / erode for binary arrays -----
function morphDilate(binaryData, w, h, radius) {
  if (radius <= 0) return new Uint8Array(binaryData);
  const out = new Uint8Array(w * h);
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  // Build circular kernel offsets
  const offsets = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) offsets.push({ dx, dy });
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (binaryData[y * w + x]) {
        for (const { dx, dy } of offsets) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
            out[ny * w + nx] = 1;
          }
        }
      }
    }
  }
  return out;
}

function morphErode(binaryData, w, h, radius) {
  if (radius <= 0) return new Uint8Array(binaryData);
  const out = new Uint8Array(w * h);
  const r = Math.ceil(radius);
  const r2 = radius * radius;
  const offsets = [];
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy <= r2) offsets.push({ dx, dy });
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!binaryData[y * w + x]) continue;
      let allSet = true;
      for (const { dx, dy } of offsets) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= w || ny < 0 || ny >= h || !binaryData[ny * w + nx]) {
          allSet = false;
          break;
        }
      }
      if (allSet) out[y * w + x] = 1;
    }
  }
  return out;
}

function mergeBinaryToMask(maskCtx, binaryData, w, h) {
  const maskImg = maskCtx.getImageData(0, 0, w, h);
  const M = maskImg.data;
  for (let i = 0; i < w * h; i++) {
    if (binaryData[i]) {
      const pi = i * 4;
      M[pi] = 255; M[pi + 1] = 255; M[pi + 2] = 255;
    }
  }
  maskCtx.putImageData(maskImg, 0, 0);
}

// ----- Drag & drop helpers -----
function setupDropZone(dropZoneEl, viewerEl, accentColor, onDrop) {
  const borderDefault = dropZoneEl.style.borderColor || '#555';
  ['dragenter', 'dragover'].forEach(ev => {
    dropZoneEl.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      dropZoneEl.style.borderColor = accentColor || '#4da3ff';
    });
    if (viewerEl) viewerEl.addEventListener(ev, e => e.preventDefault());
  });
  ['dragleave', 'drop'].forEach(ev => {
    dropZoneEl.addEventListener(ev, e => {
      e.preventDefault();
      e.stopPropagation();
      dropZoneEl.style.borderColor = borderDefault;
    });
    if (viewerEl) viewerEl.addEventListener(ev, e => e.preventDefault());
  });
  dropZoneEl.addEventListener('drop', async e => {
    const files = [...e.dataTransfer.files].filter(f =>
      /\.(png|jpg|jpeg|webp|bmp|tga|targa)$/i.test(f.name)
    );
    if (files.length) await onDrop(files);
  });
}

// ----- Pan interaction helper -----
function setupPanZoom(opts) {
  // opts: { viewerEl, getView, getContentSize, applyTransform, minScale, maxScale }
  const { viewerEl, getView, applyTransform } = opts;
  const minScale = opts.minScale || 0.05;
  const maxScale = opts.maxScale || 16;

  viewerEl.addEventListener('wheel', e => {
    e.preventDefault();
    const view = getView();
    zoomAtPoint(view, e.clientX, e.clientY, viewerEl, e.deltaY, minScale, maxScale);
    applyTransform();
  }, { passive: false });

  viewerEl.addEventListener('contextmenu', e => e.preventDefault());
}
