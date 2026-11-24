// Straighten 2 — direction from 4 points + free Qwen
const $ = (id) => document.getElementById(id);
const uploadArea = $('uploadArea');
const fileInput = $('fileInput');
const browseBtn = $('browseBtn');
const controlPanel = $('controlPanel');
const canvas = $('mainCanvas');
const ctx = canvas.getContext('2d');
const straightenBtn = $('straightenBtn');
const loadingOverlay = $('loadingOverlay');
const errorToast = $('errorToast');
const statusLine = $('statusLine');
const resultImage = $('resultImage');
const resultPlaceholder = $('resultPlaceholder');

let currentImage = null;
let points = [];
let currentPointIndex = 0;

function showError(msg) {
  errorToast.textContent = msg;
  errorToast.classList.add('visible');
  setTimeout(() => errorToast.classList.remove('visible'), 5000);
}

function setStatus(text) { statusLine.textContent = text; }

browseBtn.onclick = () => fileInput.click();
uploadArea.onclick = () => fileInput.click();

fileInput.onchange = (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      currentImage = img;
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      controlPanel.classList.remove('hidden');
      points = [];
      currentPointIndex = 0;
      setStatus('Click 4 corners of the frontal wall (TL → TR → BR → BL)');
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
};

canvas.onclick = (e) => {
  if (!currentImage || currentPointIndex >= 4) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const x = (e.clientX - rect.left) * scaleX;
  const y = (e.clientY - rect.top) * scaleY;
  points.push({ x, y });
  currentPointIndex++;
  redraw();
  if (currentPointIndex === 4) setStatus('4 points set. Click “Выпрямить стену (AI)”');
};

function redraw() {
  if (!currentImage) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
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
  // Order: 0=TL, 1=TR, 2=BR, 3=BL
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

$('resetBtn').onclick = () => {
  points = [];
  currentPointIndex = 0;
  redraw();
  setStatus('Points cleared');
};

$('replaceBtn').onclick = () => fileInput.click();

$('resetCornersBtn').onclick = () => {
  points = [];
  currentPointIndex = 0;
  redraw();
};

straightenBtn.onclick = async () => {
  if (!currentImage || points.length < 4) {
    showError('Please place 4 points first');
    return;
  }
  const dir = getDirection(points, currentImage.width, currentImage.height);
  const prompt = buildPrompt(dir);
  setStatus(`Direction: ${dir.horizontal}/${dir.vertical} → sending`);

  loadingOverlay.classList.remove('hidden');
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
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
      resultPlaceholder.style.display = 'none';
      setStatus('Done');
    } else {
      throw new Error('No output from Qwen');
    }
  } catch (err) {
    showError(err.message || 'Qwen request failed');
    setStatus('Error');
  } finally {
    loadingOverlay.classList.add('hidden');
  }
};

$('rerunBtn').onclick = () => straightenBtn.click();

$('downloadBtn').onclick = () => {
  if (!resultImage.src) return;
  const a = document.createElement('a');
  a.href = resultImage.src;
  a.download = 'straighten-result.jpg';
  a.click();
};