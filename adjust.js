/**
 * Output adjustments and empty-pixel helpers.
 * Pure functions stay free of the DOM so node tests can import them.
 * adjustCanvas uses WebGL when it can, and the same math on the CPU otherwise.
 */

export function whiteBalanceGains(average) {
  const r = Number(average.r);
  const g = Number(average.g);
  const b = Number(average.b);
  const gray = (r + g + b) / 3;
  return [channelGain(gray, r), channelGain(gray, g), channelGain(gray, b)];
}

function channelGain(gray, value) {
  if (!(value > 1)) return 1;
  const gain = gray / value;
  if (gain < 0.2) return 0.2;
  if (gain > 5) return 5;
  return gain;
}

export function clarityAmount(slider) {
  const value = Number(slider);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(30, value) / 50;
}

/** White-balance then a light unsharp mask. Alpha is copied unchanged. */
export function applyAdjustmentsBuffer(src, width, height, gains, clarity) {
  const amount = clarityAmount(clarity);
  const gr = gains[0];
  const gg = gains[1];
  const gb = gains[2];
  const balanced = new Float32Array(width * height * 3);
  for (let p = 0, o = 0; p < src.length; p += 4, o += 3) {
    balanced[o] = src[p] * gr;
    balanced[o + 1] = src[p + 1] * gg;
    balanced[o + 2] = src[p + 2] * gb;
  }
  const out = new Uint8ClampedArray(src.length);
  const radius = 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 3;
      let r = balanced[o];
      let g = balanced[o + 1];
      let b = balanced[o + 2];
      if (amount > 0) {
        let br = 0;
        let bg = 0;
        let bb = 0;
        let n = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const yy = Math.min(height - 1, Math.max(0, y + dy));
          for (let dx = -radius; dx <= radius; dx++) {
            const xx = Math.min(width - 1, Math.max(0, x + dx));
            const bo = (yy * width + xx) * 3;
            br += balanced[bo];
            bg += balanced[bo + 1];
            bb += balanced[bo + 2];
            n++;
          }
        }
        r += amount * (r - br / n);
        g += amount * (g - bg / n);
        b += amount * (b - bb / n);
      }
      const i = (y * width + x) * 4;
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = src[i + 3];
    }
  }
  return out;
}

export function patchAverage(src, width, height, x, y, radius = 3) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    const yy = y + dy;
    if (yy < 0 || yy >= height) continue;
    for (let dx = -radius; dx <= radius; dx++) {
      const xx = x + dx;
      if (xx < 0 || xx >= width) continue;
      const i = (yy * width + xx) * 4;
      if (src[i + 3] < 16) continue;
      r += src[i];
      g += src[i + 1];
      b += src[i + 2];
      n++;
    }
  }
  if (!n) return { r: 0, g: 0, b: 0 };
  return { r: r / n, g: g / n, b: b / n };
}

/** Opaque white where the warp has image, black where it is empty. */
export function buildMask(src, width, height) {
  const mask = new Uint8ClampedArray(width * height * 4);
  let hasEmpty = false;
  for (let i = 0, p = 0; i < src.length; i += 4, p += 4) {
    const filled = src[i + 3] > 16;
    if (!filled) hasEmpty = true;
    const value = filled ? 255 : 0;
    mask[p] = value;
    mask[p + 1] = value;
    mask[p + 2] = value;
    mask[p + 3] = 255;
  }
  return { mask, hasEmpty };
}

/** Composite straight alpha over white. JPEG has no alpha. */
export function compositeOnWhite(src) {
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const alpha = src[i + 3] / 255;
    out[i] = src[i] * alpha + 255 * (1 - alpha);
    out[i + 1] = src[i + 1] * alpha + 255 * (1 - alpha);
    out[i + 2] = src[i + 2] * alpha + 255 * (1 - alpha);
    out[i + 3] = 255;
  }
  return out;
}

export function adjustCanvas(source, options = {}) {
  const gains = options.gains || [1, 1, 1];
  const clarity = Number(options.clarity) || 0;
  if (isNeutral(gains, clarity)) return source;
  if (typeof document === "undefined") {
    throw new Error("adjustCanvas needs a browser.");
  }
  try {
    const gpu = adjustWebGL(source, gains, clarity);
    if (gpu) return gpu;
  } catch {
    /* CPU path below matches the tested buffer math. */
  }
  return adjustCPU(source, gains, clarity);
}

function isNeutral(gains, clarity) {
  return clarityAmount(clarity) === 0
    && Math.abs(gains[0] - 1) < 1e-4
    && Math.abs(gains[1] - 1) < 1e-4
    && Math.abs(gains[2] - 1) < 1e-4;
}

function adjustCPU(source, gains, clarity) {
  const width = source.width;
  const height = source.height;
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const ctx = scratch.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0);
  const image = ctx.getImageData(0, 0, width, height);
  image.data.set(applyAdjustmentsBuffer(image.data, width, height, gains, clarity));
  ctx.putImageData(image, 0, 0);
  return scratch;
}

let adjustState = null;

function adjustWebGL(source, gains, clarity) {
  const state = getAdjustGL();
  if (!state) return null;
  const { gl, canvas } = state;
  const width = source.width;
  const height = source.height;
  if (width < 1 || height < 1) return null;
  const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
  if (width > maxTex || height > maxTex) return null;
  canvas.width = width;
  canvas.height = height;
  gl.viewport(0, 0, width, height);
  gl.disable(gl.BLEND);
  gl.useProgram(state.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
  gl.enableVertexAttribArray(state.loc.pos);
  gl.vertexAttribPointer(state.loc.pos, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, state.texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.uniform1i(state.loc.tex, 0);
  gl.uniform3f(state.loc.gain, gains[0], gains[1], gains[2]);
  gl.uniform1f(state.loc.amount, clarityAmount(clarity));
  gl.uniform2f(state.loc.texel, 1 / width, 1 / height);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  const out = document.createElement("canvas");
  out.width = width;
  out.height = height;
  out.getContext("2d").drawImage(canvas, 0, 0);
  return out;
}

function getAdjustGL() {
  if (adjustState && !adjustState.gl.isContextLost()) return adjustState;
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl", {
    alpha: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    antialias: false,
    depth: false,
    stencil: false,
  });
  if (!gl) return null;
  const program = buildProgram(gl);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  adjustState = {
    gl,
    canvas,
    program,
    buffer,
    texture: gl.createTexture(),
    loc: {
      pos: gl.getAttribLocation(program, "a_pos"),
      tex: gl.getUniformLocation(program, "u_tex"),
      gain: gl.getUniformLocation(program, "u_gain"),
      amount: gl.getUniformLocation(program, "u_amount"),
      texel: gl.getUniformLocation(program, "u_texel"),
    },
  };
  return adjustState;
}

function buildProgram(gl) {
  const vert = compile(gl, gl.VERTEX_SHADER, `
    attribute vec2 a_pos;
    varying vec2 v_uv;
    void main() {
      v_uv = a_pos;
      gl_Position = vec4(a_pos * 2.0 - 1.0, 0.0, 1.0);
    }
  `);
  const frag = compile(gl, gl.FRAGMENT_SHADER, `
    precision mediump float;
    varying vec2 v_uv;
    uniform sampler2D u_tex;
    uniform vec3 u_gain;
    uniform float u_amount;
    uniform vec2 u_texel;
    void main() {
      vec4 c = texture2D(u_tex, v_uv);
      vec3 color = c.rgb * u_gain;
      vec3 blur = vec3(0.0);
      for (int j = -1; j <= 1; j++) {
        for (int i = -1; i <= 1; i++) {
          blur += texture2D(u_tex, v_uv + vec2(float(i), float(j)) * u_texel).rgb * u_gain;
        }
      }
      blur /= 9.0;
      vec3 sharp = clamp(color + u_amount * (color - blur), 0.0, 1.0);
      gl_FragColor = vec4(sharp, c.a);
    }
  `);
  const program = gl.createProgram();
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Adjust shader failed");
  }
  return program;
}

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || "Shader compile failed";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}
