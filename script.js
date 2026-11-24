// Straighten 2 — basic client logic
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
  loadingOverlay.classList.remove('hidden');
  setStatus('Sending to Qwen...');
  try {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
    const res = await fetch('/.netlify/functions/qwen-frontal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image: dataUrl,
        prompt: 'Rotate the camera until the wall marked by the four points is perfectly frontal, centered and perpendicular. Keep all existing walls, doors and windows exactly as they are. No new objects.'
      })
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