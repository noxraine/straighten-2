// app.js — Straighten 2: aspect-ratio fix + post-processing + client polling
const $ = (id) => document.getElementById(id);

console.log('app.js loaded');

const fileInput = $('file-input');
const browseBtn = $('browse');
const dropzone = $('dropzone');
const workspace = $('workspace');
const sourceCanvas = $('source-canvas');
const previewCanvas = $('preview-canvas');
const previewEmpty = $('preview-empty');
const qwenRun = $('qwen-run');
const qwenStatus = $('qwen-status');
const downloadBtn = $('download');

if (!browseBtn || !fileInput) {
  console.error('Critical elements missing');
}

const resultImage = document.createElement('img');
resultImage.style.maxWidth = '100%';
resultImage.style.maxHeight = '100%';
resultImage.style.display = 'none';
resultImage.style.position = 'absolute';
resultImage.style.inset = '0';
resultImage.style.margin = 'auto';
resultImage.style.objectFit = 'contain';
if (previewCanvas && previewCanvas.parentElement) {
  previewCanvas.parentElement.appendChild(resultImage);
}

let currentImage = null;
let points = [];
let currentPointIndex = 0;
let finalResultDataUrl = null;

function setStatus(text) {
  if (qwenStatus) qwenStatus.textContent = text;
  console.log('Status:', text);
}

if (browseBtn) {
  browseBtn.onclick = () => fileInput.click();
}

if (dropzone) {
  dropzone.onclick = (e) => {
    if (e.target === dropzone || e.target.closest('.drop-inner')) {
      fileInput.click();
    }
  };
}

if (fileInput) {
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        currentImage = img;
        dropzone.hidden = true;
        workspace.hidden = false;
        points = [];
        currentPointIndex = 0;
        fitSourceCanvas();
        redraw();
        setStatus('Click 4 corners of the frontal wall (TL → TR → BR → BL). Vertical lines must already be vertical.');
        if (downloadBtn) downloadBtn.disabled = true;
        finalResultDataUrl = null;
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
}

function fitSourceCanvas() {
  if (!currentImage || !sourceCanvas) return;
  const frame = sourceCanvas.parentElement;
  if (!frame) return;
  const frameW = frame.clientWidth;
  const frameH = frame.clientHeight;
  const imgW = currentImage.width;
  const imgH = currentImage.height;
  if (frameW < 10 || frameH < 10 || imgW < 1 || imgH < 1) return;

  const scale = Math.min(frameW / imgW, frameH / imgH);
  const drawW = Math.round(imgW * scale);
  const drawH = Math.round(imgH * scale);

  sourceCanvas.style.width = drawW + 'px';
  sourceCanvas.style.height = drawH + 'px';
  sourceCanvas.style.left = Math.round((frameW - drawW) / 2) + 'px';
  sourceCanvas.style.top = Math.round((frameH - drawH) / 2) + 'px';
  sourceCanvas.style.position = 'absolute';

  sourceCanvas.width = imgW;
  sourceCanvas.height = imgH;
}

window.addEventListener('resize', () => {
  if (currentImage) {
    fitSourceCanvas();
    redraw();
  }
});

if (sourceCanvas) {
  sourceCanvas.onclick = (e) => {
    if (!currentImage || currentPointIndex >= 4) return;
    const rect = sourceCanvas.getBoundingClientRect();
    const scaleX = sourceCanvas.width / rect.width;
    const scaleY = sourceCanvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;
    points.push({ x, y });
    currentPointIndex++;
    redraw();
    if (currentPointIndex === 4) setStatus('4 points set. Click “Выпрямить стену (AI)”. Only left/right rotation (verticals must already be vertical).');
  };
}

function redraw() {
  if (!currentImage || !sourceCanvas) return;
  const ctx = sourceCanvas.getContext('2d');
  ctx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  ctx.drawImage(currentImage, 0, 0);
  points.forEach((p, i) => {
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(p.x, p.y, Math.max(6, sourceCanvas.width / 120), 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `${Math.max(12, sourceCanvas.width / 60)}px sans-serif`;
    ctx.fillText(i + 1, p.x + 12, p.y - 8);
  });
}

function getDirection(points, imgWidth) {
  if (points.length < 4) return { horizontal: 'none' };
  const centerX = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
  const imgCenterX = imgWidth / 2;
  const horizontal = centerX < imgCenterX - 30 ? 'left' : centerX > imgCenterX + 30 ? 'right' : 'none';
  return { horizontal };
}

function buildPrompt(dir) {
  let rotate = '';
  if (dir.horizontal === 'left') rotate = 'to the left';
  else if (dir.horizontal === 'right') rotate = 'to the right';

  let action;
  if (rotate) {
    action = `Rotate the camera ${rotate}`;
  } else {
    action = 'Make the marked wall';
  }

  return `${action} until the marked wall is perfectly frontal, centered and perpendicular.

CRITICAL: This must remain the EXACT same room from a different angle.
- Do NOT remove, add, or relocate any objects, furniture, doors, windows or radiators.
- Do NOT swap left and right walls.
- Keep all textures, materials, colors and lighting direction exactly as they are.
- Vertical lines stay vertical.
- No new objects.`
    .replace(/\s+/g, ' ').trim();
}

// ---------- Post-processing helpers ----------
function imageToCanvas(img) {
  const c = document.createElement('canvas');
  c.width = img.width;
  c.height = img.height;
  c.getContext('2d').drawImage(img, 0, 0);
  return c;
}

function maxCrop(canvas, threshold = 12) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = data[i + 3];
      const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
      if (a > 30 && lum > threshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < minX) return canvas;
  const cropW = maxX - minX + 1;
  const cropH = maxY - minY + 1;
  if (cropW === w && cropH === h) return canvas;
  const cropped = document.createElement('canvas');
  cropped.width = cropW;
  cropped.height = cropH;
  cropped.getContext('2d').drawImage(canvas, minX, minY, cropW, cropH, 0, 0, cropW, cropH);
  return cropped;
}

function autoWhiteBalance(canvas) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const data = imgData.data;
  let rSum = 0, gSum = 0, bSum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] > 128) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
      n++;
    }
  }
  if (n === 0) return canvas;
  const avgR = rSum / n;
  const avgG = gSum / n;
  const avgB = bSum / n;
  const avg = (avgR + avgG + avgB) / 3;
  const gr = Math.max(0.5, Math.min(2, avg / (avgR || 1)));
  const gg = Math.max(0.5, Math.min(2, avg / (avgG || 1)));
  const gb = Math.max(0.5, Math.min(2, avg / (avgB || 1)));

  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, data[i] * gr));
    data[i + 1] = Math.min(255, Math.max(0, data[i + 1] * gg));
    data[i + 2] = Math.min(255, Math.max(0, data[i + 2] * gb));
  }
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function applyClarity(canvas, amount = 0.45) {
  if (amount <= 0) return canvas;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const imgData = ctx.getImageData(0, 0, w, h);
  const src = imgData.data;
  const out = new Uint8ClampedArray(src.length);
  const radius = 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r = src[i], g = src[i + 1], b = src[i + 2];
      let br = 0, bg = 0, bb = 0, n = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        const yy = Math.min(h - 1, Math.max(0, y + dy));
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = Math.min(w - 1, Math.max(0, x + dx));
          const bi = (yy * w + xx) * 4;
          br += src[bi];
          bg += src[bi + 1];
          bb += src[bi + 2];
          n++;
        }
      }
      r = Math.min(255, Math.max(0, r + amount * (r - br / n)));
      g = Math.min(255, Math.max(0, g + amount * (g - bg / n)));
      b = Math.min(255, Math.max(0, b + amount * (b - bb / n)));
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = src[i + 3];
    }
  }
  imgData.data.set(out);
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

function hasSignificantEmpty(canvas, threshold = 18, ratio = 0.04) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  const data = ctx.getImageData(0, 0, w, h).data;
  let empty = 0;
  const total = w * h;
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (data[i + 3] < 40 || lum < threshold) empty++;
  }
  return empty / total > ratio;
}

function createInpaintMask(canvas, threshold = 18) {
  const w = canvas.width;
  const h = canvas.height;
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext('2d');
  const srcData = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const mData = mctx.createImageData(w, h);
  for (let i = 0; i < srcData.length; i += 4) {
    const lum = (srcData[i] + srcData[i + 1] + srcData[i + 2]) / 3;
    const isEmpty = srcData[i + 3] < 40 || lum < threshold;
    const v = isEmpty ? 255 : 0;
    mData.data[i] = v;
    mData.data[i + 1] = v;
    mData.data[i + 2] = v;
    mData.data[i + 3] = 255;
  }
  mctx.putImageData(mData, 0, 0);
  return mask.toDataURL('image/png');
}

async function tryLamaInpaint(canvas) {
  if (!hasSignificantEmpty(canvas)) return canvas;
  setStatus('Empty corners detected → LaMa inpainting...');
  try {
    const imageDataUrl = canvas.toDataURL('image/png');
    const maskDataUrl = createInpaintMask(canvas);
    const res = await fetch('/.netlify/functions/lama-inpaint', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl, mask: maskDataUrl })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (!data.output) return canvas;
    return await new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(imageToCanvas(img));
      img.onerror = () => resolve(canvas);
      img.src = data.output;
    });
  } catch (err) {
    console.warn('LaMa failed, continuing without:', err);
    setStatus('LaMa skipped (error), continuing with client processing');
    return canvas;
  }
}

async function processResult(img) {
  let canvas = imageToCanvas(img);
  canvas = await tryLamaInpaint(canvas);
  canvas = maxCrop(canvas);
  canvas = autoWhiteBalance(canvas);
  canvas = applyClarity(canvas, 0.42);
  return canvas;
}

async function pollQwen(getUrl, id) {
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 2500));
    setStatus(`Qwen processing... (${i + 1})`);
    const res = await fetch('/.netlify/functions/qwen-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ getUrl, id })
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(t || 'Status check failed');
    }
    const data = await res.json();
    if (data.status === 'succeeded') return data.output;
    if (data.status === 'failed') throw new Error(data.error || 'Prediction failed');
  }
  throw new Error('Qwen timed out on client');
}

// ---------- Qwen run ----------
if (qwenRun) {
  qwenRun.onclick = async () => {
    if (!currentImage || points.length < 4) {
      setStatus('Please place 4 points first');
      return;
    }
    const dir = getDirection(points, currentImage.width);
    const prompt = buildPrompt(dir);
    setStatus(`Direction: ${dir.horizontal} only → creating prediction...`);

    try {
      const cleanCanvas = document.createElement('canvas');
      cleanCanvas.width = currentImage.width;
      cleanCanvas.height = currentImage.height;
      cleanCanvas.getContext('2d').drawImage(currentImage, 0, 0);
      const dataUrl = cleanCanvas.toDataURL('image/jpeg', 0.92);

      const res = await fetch('/.netlify/functions/qwen-frontal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl, prompt })
      });
      if (!res.ok) throw new Error(await res.text());
      const startData = await res.json();

      let output = startData.output;
      if (!output) {
        output = await pollQwen(startData.getUrl, startData.id);
      }
      if (!output) throw new Error('No output from Qwen');

      setStatus('Qwen done → post-processing...');
      const resultImg = new Image();
      resultImg.crossOrigin = 'anonymous';
      resultImg.onload = async () => {
        try {
          const processed = await processResult(resultImg);
          finalResultDataUrl = processed.toDataURL('image/jpeg', 0.92);
          resultImage.src = finalResultDataUrl;
          resultImage.style.display = 'block';
          if (previewEmpty) previewEmpty.style.display = 'none';
          if (previewCanvas) previewCanvas.style.display = 'none';
          if (downloadBtn) downloadBtn.disabled = false;
          setStatus('Done — max crop + WB + clarity');
        } catch (e) {
          console.error(e);
          resultImage.src = output;
          resultImage.style.display = 'block';
          setStatus('Processed with fallback');
        }
      };
      resultImg.onerror = () => {
        resultImage.src = output;
        resultImage.style.display = 'block';
        setStatus('Result loaded (processing skipped)');
      };
      resultImg.src = output;
    } catch (err) {
      setStatus('Error: ' + (err.message || 'Qwen request failed'));
    }
  };
}

const resetBtn = $('reset');
if (resetBtn) resetBtn.onclick = () => {
  points = [];
  currentPointIndex = 0;
  redraw();
  setStatus('Points cleared');
};

const replaceBtn = $('replace');
if (replaceBtn) replaceBtn.onclick = () => fileInput.click();

if (downloadBtn) {
  downloadBtn.onclick = () => {
    if (!finalResultDataUrl) return;
    const a = document.createElement('a');
    a.href = finalResultDataUrl;
    a.download = 'straighten-2-result.jpg';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };
}
