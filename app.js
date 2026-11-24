// Minimal app.js for Straighten 2 — wires original UI + free Qwen direction logic
const $ = (id) => document.getElementById(id);

const fileInput = $('file-input');
const browseBtn = $('browse');
const dropzone = $('dropzone');
const workspace = $('workspace');
const sourceCanvas = $('source-canvas');
const previewCanvas = $('preview-canvas');
const previewEmpty = $('preview-empty');
const qwenRun = $('qwen-run');
const qwenStatus = $('qwen-status');
const resultImage = document.createElement('img');
resultImage.style.maxWidth = '100%';
resultImage.style.display = 'none';
previewCanvas.parentElement.appendChild(resultImage);

let currentImage = null;
let points = [];
let currentPointIndex = 0;

function setStatus(text) {
  if (qwenStatus) qwenStatus.textContent = text;
}

browseBtn.onclick = () => fileInput.click();
dropzone.onclick = (e) => {
  if (e.target === dropzone || e.target.closest('.drop-inner')) fileInput.click();
};

fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      sourceCanvas.width = img.width;
      sourceCanvas.height = img.height;
      const ctx = sourceCanvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      dropzone.hidden = true;
      workspace.hidden = false;
      points = [];
      currentPointIndex = 0;
      setStatus('Click 4 corners of the frontal wall (TL → TR → BR → BL)');
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
};

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
  if (currentPointIndex === 4) setStatus('4 points set. Click “Выпрямить стену (AI)”');
};

function redraw() {
  if (!currentImage) return;
  const ctx = sourceCanvas.getContext('2d');
  ctx.clearRect(0, 0, sourceCanvas.width, sourceCanvas.height);
  ctx.drawImage(currentImage, 0, 0);
  points.forEach((p, i) => {
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = '14px sans-serif';
    ctx.fillText(i + 1, p.x + 12, p.y - 8);
  });
}

function getDirection(points, imgWidth, imgHeight) {
  if (points.length < 4) return { horizontal: 'none', vertical: 'none' };
  const centerX = (points[0].x + points[1].x + points[2].x + points[3].x) / 4;
  const centerY = (points[0].y + points[1].y + points[2].y + points[3].y) / 4;
  const imgCenterX = imgWidth / 2;
  const imgCenterY = imgHeight / 2;
  const horizontal = centerX < imgCenterX - 30 ? 'left' : centerX > imgCenterX + 30 ? 'right' : 'none';
  const vertical = centerY < imgCenterY - 30 ? 'up' : centerY > imgCenterY + 30 ? 'down' : 'none';
  return { horizontal, vertical };
}

function buildPrompt(dir) {
  let rotate = '';
  if (dir.horizontal === 'left') rotate = 'to the left';
  else if (dir.horizontal === 'right') rotate = 'to the right';
  let tilt = '';
  if (dir.vertical === 'up') tilt = ' and look up';
  else if (dir.vertical === 'down') tilt = ' and look down';
  let action = 'Rotate the camera';
  if (rotate) action += ` ${rotate}`;
  if (tilt) action += tilt;
  if (!rotate && !tilt) action = 'Make the wall';
  return `${action} until the wall is perfectly frontal, centered and perpendicular. Keep all existing walls, doors and windows exactly as they are. No new objects.`;
}

qwenRun.onclick = async () => {
  if (!currentImage || points.length < 4) {
    setStatus('Please place 4 points first');
    return;
  }
  const dir = getDirection(points, currentImage.width, currentImage.height);
  const prompt = buildPrompt(dir);
  setStatus(`Direction: ${dir.horizontal}/${dir.vertical} → sending to Qwen...`);

  try {
    // Clean image without markers
    const cleanCanvas = document.createElement('canvas');
    cleanCanvas.width = currentImage.width;
    cleanCanvas.height = currentImage.height;
    cleanCanvas.getContext('2d').drawImage(currentImage, 0, 0);
    const dataUrl = cleanCanvas.toDataURL('image/jpeg', 0.9);

    const res = await fetch('/.netlify/functions/qwen-frontal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, prompt })
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    if (data.output) {
      resultImage.src = data.output;
      resultImage.style.display = 'block';
      previewEmpty.style.display = 'none';
      previewCanvas.style.display = 'none';
      setStatus('Done');
    } else {
      throw new Error('No output from Qwen');
    }
  } catch (err) {
    setStatus('Error: ' + (err.message || 'Qwen request failed'));
  }
};

// Basic stubs for other buttons so they don't error
const resetBtn = $('reset');
if (resetBtn) resetBtn.onclick = () => {
  points = [];
  currentPointIndex = 0;
  redraw();
  setStatus('Points cleared');
};

const replaceBtn = $('replace');
if (replaceBtn) replaceBtn.onclick = () => fileInput.click();
