/**
 * Corner picker. Classic mode takes four corners in fixed order:
 * top-left, top-right, bottom-left, bottom-right.
 * Box mode adds the four near corners of the room, and those clicks
 * may land slightly outside the photo on the padded canvas.
 * Corners stay draggable. A loupe follows the pointer while aiming or dragging.
 */

const PROMPTS = [
  "Click the top-left corner",
  "Click the top-right corner",
  "Click the bottom-left corner",
  "Click the bottom-right corner",
  "Drag any corner to adjust",
];

const LOOP_PROMPTS = [
  "1. Top left",
  "2. Top right",
  "3. Bottom right",
  "4. Bottom left",
  "Drag any corner to adjust",
];

const BACK_PROMPTS = [
  "Back wall: click the top-left corner",
  "Back wall: click the top-right corner",
  "Back wall: click the bottom-left corner",
  "Back wall: click the bottom-right corner",
];

const NEAR_PROMPTS = [
  "Near ceiling, left — where the left wall meets the ceiling at the front of the room",
  "Near ceiling, right — where the right wall meets the ceiling",
  "Near floor, left — where the left wall meets the floor",
  "Near floor, right — where the right wall meets the floor",
  "Drag any corner. A click on a depth edge is enough; it snaps to the corner.",
];

const POINT_COLORS = ["#9c3d2e", "#234838", "#3a5274", "#8a5a28"];
const NEAR_COLORS = ["#1d4e63", "#2a6f8f", "#3d8ea8", "#67b0c4"];
const PAD = 0.18;

export function createPointPicker(canvas, { loupe, onChange }) {
  const loupeCanvas = loupe.querySelector("canvas");
  const ctx = canvas.getContext("2d");
  const loupeCtx = loupeCanvas.getContext("2d");

  let image = null;
  let fit = null;
  let points = [];
  let nearPoints = [];
  let guide = null;
  let marker = null;
  let markerMode = false;
  let roomMode = false;
  let enabled = true;
  let loopOrder = false;
  let undoStack = [];
  let dragIndex = -1;
  let dragList = null;
  let dragMoved = false;
  let placing = false;
  let activePointer = null;

  const parent = canvas.parentElement;
  const observer = new ResizeObserver(() => draw());
  observer.observe(parent);

  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove, { passive: false });
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());

  function setImage(bitmap, width, height) {
    image = { bitmap, width, height };
    points = [];
    nearPoints = [];
    guide = null;
    marker = null;
    undoStack = [];
    dragIndex = -1;
    dragList = null;
    placing = false;
    draw();
    emit(false);
  }

  function undo() {
    if (dragIndex >= 0 || undoStack.length === 0) return false;
    const previous = undoStack.pop();
    points = previous.points;
    nearPoints = previous.near;
    marker = previous.marker;
    guide = null;
    draw();
    emit(false);
    return true;
  }

  function reset() {
    if (points.length === 0 && nearPoints.length === 0 && !marker && undoStack.length === 0) return;
    snapshot();
    points = [];
    nearPoints = [];
    marker = null;
    guide = null;
    dragIndex = -1;
    dragList = null;
    placing = false;
    draw();
    emit(false);
  }

  function snapshot() {
    undoStack.push({
      points: points.map((p) => ({ x: p.x, y: p.y })),
      near: nearPoints.map((p) => ({ x: p.x, y: p.y })),
      marker: marker ? { x: marker.x, y: marker.y } : null,
    });
    if (undoStack.length > 40) undoStack.shift();
  }

  function setRoomMode(on) {
    roomMode = Boolean(on);
    if (roomMode) markerMode = false;
    if (!roomMode) {
      nearPoints = [];
      guide = null;
    }
    draw();
    emit(false);
  }

  function setMarkerMode(on) {
    markerMode = Boolean(on);
    if (markerMode) {
      roomMode = false;
      nearPoints = [];
      guide = null;
      points = [];
    }
    draw();
    emit(false);
  }

  function setLoopOrder(on) {
    const next = Boolean(on);
    if (next !== loopOrder) {
      points = [];
      undoStack = [];
    }
    loopOrder = next;
    draw();
    emit(false);
  }

  function setEnabled(on) {
    enabled = Boolean(on);
    if (!enabled) {
      points = [];
      nearPoints = [];
      marker = null;
      markerMode = false;
      roomMode = false;
    }
    draw();
    emit(false);
  }

  function setMarker(point) {
    marker = point ? { x: point.x, y: point.y } : null;
    draw();
    emit(false);
  }

  function setGuide(next) {
    guide = next && next.length === 8 ? next.map((point) => ({ x: point.x, y: point.y })) : null;
    draw();
  }

  function emit(dragging) {
    onChange({
      points: points.map((p) => ({ x: p.x, y: p.y })),
      dragging,
      canUndo: undoStack.length > 0,
      near: nearPoints.map((p) => ({ x: p.x, y: p.y })),
      marker: marker ? { x: marker.x, y: marker.y } : null,
      markerMode,
      roomMode,
      loopOrder,
      prompt: roomPrompt(),
    });
  }

  function roomPrompt() {
    if (!enabled) return "The sliders preview a camera move. Qwen receives the original photo.";
    if (markerMode) {
      return marker
        ? "Click again to move the marker, then make the wall frontal."
        : "Click the wall that should face the camera.";
    }
    if (!roomMode) {
      const prompts = loopOrder ? LOOP_PROMPTS : PROMPTS;
      return prompts[Math.min(points.length, prompts.length - 1)];
    }
    if (points.length < 4) return BACK_PROMPTS[points.length];
    return NEAR_PROMPTS[Math.min(nearPoints.length, NEAR_PROMPTS.length - 1)];
  }

  function draw() {
    const rect = parent.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(2, Math.round(rect.width * dpr));
    const ch = Math.max(2, Math.round(rect.height * dpr));
    if (cw < 4 || ch < 4) return;
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    ctx.clearRect(0, 0, cw, ch);
    if (!image) return;

    fit = contain(cw, ch, image.width, image.height);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image.bitmap, fit.x, fit.y, fit.w, fit.h);
    if (roomMode) {
      ctx.strokeStyle = "rgba(28, 25, 20, 0.28)";
      ctx.lineWidth = dpr;
      ctx.strokeRect(fit.x, fit.y, fit.w, fit.h);
    }

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    if (guide) {
      strokeGroup(guide, [
        [0, 1], [1, 3], [3, 2], [2, 0],
        [4, 5], [5, 7], [7, 6], [6, 4],
        [0, 4], [1, 5], [2, 6], [3, 7],
      ], "#a15c12", dpr);
    }
    strokeGroup(points, loopOrder ? [[0, 1], [1, 2], [2, 3], [3, 0]] : [[0, 1], [1, 3], [3, 2], [2, 0]], "#1c1914", dpr);
    strokeGroup(nearPoints, [[0, 1], [2, 3]], "#1d4e63", dpr);
    for (let i = 0; i < nearPoints.length && i < points.length; i++) {
      strokeGroup([points[i], nearPoints[i]], [[0, 1]], "#1d4e63", dpr);
    }
    drawDots(points, POINT_COLORS, dpr);
    drawDots(nearPoints, NEAR_COLORS, dpr);
    if (marker) drawMarker(dpr);
  }

  function strokeGroup(group, edges, color, dpr) {
    for (const [a, b] of edges) {
      if (!group[a] || !group[b]) continue;
      const p = toCanvas(group[a]);
      const q = toCanvas(group[b]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(q.x, q.y);
      ctx.strokeStyle = "rgba(255, 250, 244, 0.92)";
      ctx.lineWidth = 5 * dpr;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.75 * dpr;
      ctx.stroke();
    }
  }

  function drawDots(group, colors, dpr) {
    for (let i = 0; i < group.length; i++) {
      const p = toCanvas(group[i]);
      const radius = 8 * dpr;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fillStyle = colors[i % colors.length];
      ctx.fill();
      ctx.lineWidth = 2 * dpr;
      ctx.strokeStyle = "#fffaf4";
      ctx.stroke();
      ctx.fillStyle = "#fffaf4";
      ctx.font = `600 ${11 * dpr}px Outfit, "Avenir Next", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(i + 1), p.x, p.y + 0.5 * dpr);
    }
  }

  function drawMarker(dpr) {
    const p = toCanvas(marker);
    const radius = Math.max(10 * dpr, 0.02 * Math.min(fit.w, fit.h));
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#ff0000";
    ctx.fill();
    ctx.lineWidth = Math.max(1.5 * dpr, radius * 0.08);
    ctx.strokeStyle = "#ffffff";
    ctx.stroke();
  }

  function contain(cw, ch, iw, ih) {
    const pad = roomMode ? PAD : 0;
    const scale = Math.min(cw / (iw * (1 + 2 * pad)), ch / (ih * (1 + 2 * pad)));
    const w = iw * scale;
    const h = ih * scale;
    return { x: (cw - w) / 2, y: (ch - h) / 2, w, h, scale };
  }

  function toCanvas(p) {
    return { x: fit.x + p.x * fit.scale, y: fit.y + p.y * fit.scale };
  }

  function eventToImage(event, clampToPhoto) {
    if (!fit || !image) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    const cx = (event.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (event.clientY - rect.top) * (canvas.height / rect.height);
    let x = (cx - fit.x) / fit.scale;
    let y = (cy - fit.y) / fit.scale;
    const box = clickLimits();
    const outside = x < box.minX || y < box.minY || x > box.maxX || y > box.maxY;
    if (outside && !clampToPhoto) return null;
    if (clampToPhoto) {
      x = Math.min(box.maxX, Math.max(box.minX, x));
      y = Math.min(box.maxY, Math.max(box.minY, y));
    }
    return { x, y };
  }

  function clickLimits() {
    if (!roomMode) return { minX: 0, minY: 0, maxX: image.width, maxY: image.height };
    return {
      minX: -image.width * PAD,
      minY: -image.height * PAD,
      maxX: image.width * (1 + PAD),
      maxY: image.height * (1 + PAD),
    };
  }

  function hitTest(imgPt, pointerType) {
    const rect = canvas.getBoundingClientRect();
    const screenPerImage = fit.scale * (rect.width / canvas.width);
    if (!(screenPerImage > 0)) return -1;
    const slop = (pointerType === "touch" ? 32 : 16) / screenPerImage;
    let best = null;
    let bestDist = slop;
    if (markerMode && marker) {
      const dist = Math.hypot(marker.x - imgPt.x, marker.y - imgPt.y);
      if (dist <= bestDist) return { list: "marker", index: 0 };
    }
    for (const list of [points, nearPoints]) {
      for (let i = 0; i < list.length; i++) {
        const dist = Math.hypot(list[i].x - imgPt.x, list[i].y - imgPt.y);
        if (dist <= bestDist) {
          bestDist = dist;
          best = { list, index: i };
        }
      }
    }
    return best;
  }

  function canPlace() {
    if (markerMode) return true;
    if (points.length < 4) return true;
    return roomMode && nearPoints.length < 4;
  }

  function placePoint(imgPt) {
    if (markerMode) {
      marker = imgPt;
      return;
    }
    if (points.length < 4) points.push(imgPt);
    else nearPoints.push(imgPt);
  }

  function onPointerDown(event) {
    if (!enabled || !image || (activePointer !== null && event.pointerId !== activePointer)) return;
    const imgPt = eventToImage(event, false);
    if (!imgPt) return;
    event.preventDefault();
    activePointer = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const hit = hitTest(imgPt, event.pointerType);
    if (hit) {
      snapshot();
      dragList = hit.list;
      dragIndex = hit.index;
      dragMoved = false;
      showLoupe(event, hit.list === "marker" ? marker : hit.list[hit.index]);
      return;
    }
    if (canPlace()) {
      placing = true;
      showLoupe(event, imgPt);
    }
  }

  function onPointerMove(event) {
    if (!image) return;
    if (activePointer !== null && event.pointerId !== activePointer) return;
    if (dragIndex >= 0) {
      const imgPt = eventToImage(event, true);
      if (!imgPt) return;
      event.preventDefault();
      if (dragList === "marker") marker = imgPt;
      else dragList[dragIndex] = imgPt;
      dragMoved = true;
      draw();
      showLoupe(event, imgPt);
      emit(true);
      return;
    }
    if (placing) {
      const imgPt = eventToImage(event, true);
      if (imgPt) showLoupe(event, imgPt);
      return;
    }
  }

  function onPointerUp(event) {
    if (activePointer !== null && event.pointerId !== activePointer) return;
    if (dragIndex >= 0) {
      if (!dragMoved) undoStack.pop();
      dragIndex = -1;
      dragList = null;
      emit(false);
    } else if (placing && canPlace()) {
      const imgPt = eventToImage(event, true);
      if (imgPt) {
        snapshot();
        placePoint(imgPt);
        draw();
      }
      emit(false);
    }
    placing = false;
    activePointer = null;
    hideLoupe();
  }

  function onPointerLeave(event) {
    if (dragIndex >= 0 || placing) return;
    if (event.pointerType === "touch") return;
    hideLoupe();
  }

  function showLoupe(event, imgPt) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 168;
    const zoom = 5;
    const px = Math.round(size * dpr);
    if (loupeCanvas.width !== px) {
      loupeCanvas.width = px;
      loupeCanvas.height = px;
    }
    const sw = px / zoom;
    loupeCtx.imageSmoothingEnabled = false;
    loupeCtx.fillStyle = "#1e1b17";
    loupeCtx.fillRect(0, 0, px, px);
    loupeCtx.drawImage(
      image.bitmap,
      imgPt.x - sw / 2,
      imgPt.y - sw / 2,
      sw,
      sw,
      0,
      0,
      px,
      px,
    );
    loupeCtx.strokeStyle = "rgba(20, 16, 12, 0.85)";
    loupeCtx.lineWidth = dpr;
    loupeCtx.beginPath();
    loupeCtx.moveTo(px / 2, 0);
    loupeCtx.lineTo(px / 2, px);
    loupeCtx.moveTo(0, px / 2);
    loupeCtx.lineTo(px, px / 2);
    loupeCtx.stroke();
    loupeCtx.strokeStyle = "rgba(255, 250, 244, 0.9)";
    loupeCtx.lineWidth = 1;
    const gap = 8 * dpr;
    loupeCtx.beginPath();
    loupeCtx.moveTo(px / 2, px / 2 - gap);
    loupeCtx.lineTo(px / 2, px / 2 + gap);
    loupeCtx.moveTo(px / 2 - gap, px / 2);
    loupeCtx.lineTo(px / 2 + gap, px / 2);
    loupeCtx.stroke();

    const margin = 16;
    const box = size;
    let left = event.clientX + 28;
    let top = event.clientY - box - 28;
    if (left + box > window.innerWidth - margin) left = event.clientX - box - 28;
    if (top < margin) top = event.clientY + 28;
    if (left < margin) left = margin;
    loupe.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
    loupe.hidden = false;
  }

  function hideLoupe() {
    loupe.hidden = true;
  }

  return {
    setImage,
    undo,
    reset,
    setRoomMode,
    setMarkerMode,
    setMarker,
    setEnabled,
    setLoopOrder,
    setGuide,
    redraw: draw,
    hideLoupe,
  };
}
