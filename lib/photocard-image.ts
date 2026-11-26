/**
 * Client-side image processing for the enhancement panel.
 *
 * WHAT THIS IS AND ISN'T. Everything here is classical image processing on a
 * canvas ImageData buffer — convolution, local contrast, bilateral-ish
 * smoothing, bicubic-ish resampling. It genuinely improves perceived quality
 * on soft or noisy photos. It is NOT machine learning: there is no
 * super-resolution model, no learned deblur, and no semantic segmentation, so
 * it cannot invent detail that isn't in the source. That distinction matters
 * for a newsroom — the UI says so rather than implying recovery it can't do.
 *
 * Non-destructive by construction: every function takes a source URL and
 * returns a NEW blob. The element's `originalSrc` is never touched, so
 * "Restore original" is always just pointing `src` back at it.
 */

import { loadImage } from "@/lib/photocard-render";

export type EnhanceOptions = {
  /** 0-100 — unsharp mask amount. */
  sharpen: number;
  /** 0-100 — local contrast ("clarity"), a wide-radius unsharp mask. */
  clarity: number;
  /** 0-100 — edge-preserving smoothing. */
  denoise: number;
  /** 1, 2 or 4 — resample factor applied before the other steps. */
  upscale: number;
};

function toCanvas(img: HTMLImageElement, width: number, height: number) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas isn't supported in this browser.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);
  return { canvas, ctx };
}

/**
 * Separable box blur — the basis for both denoise and the unsharp masks.
 * Two passes of a box is a good enough Gaussian approximation here and is
 * O(n) in radius rather than O(n²), which matters at 4000px wide.
 */
function boxBlur(src: Uint8ClampedArray, w: number, h: number, radius: number): Uint8ClampedArray {
  if (radius < 1) return new Uint8ClampedArray(src);
  const tmp = new Uint8ClampedArray(src.length);
  const out = new Uint8ClampedArray(src.length);
  const span = radius * 2 + 1;

  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) {
        const x = Math.min(w - 1, Math.max(0, i));
        sum += src[(y * w + x) * 4 + c];
      }
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 4 + c] = sum / span;
        const add = Math.min(w - 1, x + radius + 1);
        const sub = Math.max(0, x - radius);
        sum += src[(y * w + add) * 4 + c] - src[(y * w + sub) * 4 + c];
      }
    }
  }

  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 4; c++) {
      let sum = 0;
      for (let i = -radius; i <= radius; i++) {
        const y = Math.min(h - 1, Math.max(0, i));
        sum += tmp[(y * w + x) * 4 + c];
      }
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 4 + c] = sum / span;
        const add = Math.min(h - 1, y + radius + 1);
        const sub = Math.max(0, y - radius);
        sum += tmp[(add * w + x) * 4 + c] - tmp[(sub * w + x) * 4 + c];
      }
    }
  }
  return out;
}

/**
 * Unsharp mask: original + amount × (original − blurred). A threshold keeps
 * flat areas (sky, skin, compression noise) from being amplified, which is
 * what stops sharpening from looking like halos and grain.
 */
function unsharp(
  data: Uint8ClampedArray,
  w: number,
  h: number,
  radius: number,
  amount: number,
  threshold = 6
) {
  const blurred = boxBlur(data, w, h, radius);
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = data[i + c] - blurred[i + c];
      if (Math.abs(diff) > threshold) {
        data[i + c] = Math.max(0, Math.min(255, data[i + c] + diff * amount));
      }
    }
  }
}

/**
 * Edge-preserving denoise: blend toward a blurred version, but only where the
 * pixel is already close to its neighbourhood average. Detail edges stay put
 * while flat noisy regions get smoothed — the cheap cousin of a bilateral
 * filter, and enough for mobile/low-light newsroom photos.
 */
function denoise(data: Uint8ClampedArray, w: number, h: number, strength: number) {
  const blurred = boxBlur(data, w, h, 1);
  const limit = 26;
  for (let i = 0; i < data.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const diff = Math.abs(data[i + c] - blurred[i + c]);
      if (diff < limit) {
        const weight = strength * (1 - diff / limit);
        data[i + c] = data[i + c] * (1 - weight) + blurred[i + c] * weight;
      }
    }
  }
}

/**
 * Runs the enhancement chain and returns a new PNG blob.
 * Order matters: upscale first (so later steps work at final resolution),
 * then denoise (before sharpening, or sharpening amplifies the noise), then
 * clarity (wide radius), then sharpen (narrow radius).
 */
export async function enhanceImage(
  src: string,
  options: EnhanceOptions,
  onProgress?: (pct: number, label: string) => void
): Promise<Blob> {
  const img = await loadImage(src);
  onProgress?.(10, "Preparing image");

  const scale = Math.max(1, Math.min(4, options.upscale));
  // 4000px is the practical ceiling before ImageData work starts stalling
  // mid-range machines; better to cap than to freeze the editor.
  const maxDim = 4000;
  let width = Math.round(img.width * scale);
  let height = Math.round(img.height * scale);
  if (Math.max(width, height) > maxDim) {
    const fit = maxDim / Math.max(width, height);
    width = Math.round(width * fit);
    height = Math.round(height * fit);
  }

  const { canvas, ctx } = toCanvas(img, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  if (options.denoise > 0) {
    onProgress?.(35, "Reducing noise");
    denoise(data, width, height, (options.denoise / 100) * 0.9);
  }
  if (options.clarity > 0) {
    onProgress?.(60, "Boosting local contrast");
    unsharp(data, width, height, Math.max(4, Math.round(width / 200)), (options.clarity / 100) * 0.7, 2);
  }
  if (options.sharpen > 0) {
    onProgress?.(80, "Sharpening");
    unsharp(data, width, height, 1, (options.sharpen / 100) * 1.4, 6);
  }

  ctx.putImageData(imageData, 0, 0);
  onProgress?.(95, "Finishing");

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't process the image."))), "image/png");
  });
}

export type BackgroundRemovalOptions = {
  /** 0-100 — how far a colour can differ from the sampled background. */
  tolerance: number;
  /** 0-100 — softens the cut edge. */
  feather: number;
};

/**
 * Background removal by flood fill from the image's edges.
 *
 * HONEST SCOPE: this removes a *reasonably uniform* background — a studio
 * backdrop, a flat colour, a plain wall, a clean sky. It is not a person
 * segmentation model, so it will not cleanly separate a subject from a busy
 * newsroom scene, and it will struggle with hair and fine detail exactly
 * where a learned matting model would do well. The UI states this, and the
 * result is always previewable before it's applied.
 *
 * Doing it properly needs an ML model (a U²-Net/MODNet-class matting network)
 * running either in a worker via ONNX/WASM or behind a server endpoint. The
 * hook for that is `BACKGROUND_REMOVAL_ENDPOINT` below — when a service is
 * configured, route to it and keep this as the offline fallback.
 */
export async function removeBackground(
  src: string,
  options: BackgroundRemovalOptions,
  onProgress?: (pct: number, label: string) => void
): Promise<Blob> {
  const img = await loadImage(src);
  onProgress?.(15, "Reading image");

  const width = img.width;
  const height = img.height;
  const { canvas, ctx } = toCanvas(img, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  // Seed from the four corners — whatever colour dominates the border is
  // taken to be the background.
  const corners = [0, (width - 1) * 4, (height - 1) * width * 4, ((height - 1) * width + width - 1) * 4];
  const seed = [0, 0, 0];
  for (const c of corners) {
    seed[0] += data[c] / 4;
    seed[1] += data[c + 1] / 4;
    seed[2] += data[c + 2] / 4;
  }

  const tolerance = (options.tolerance / 100) * 160;
  const visited = new Uint8Array(width * height);
  const stack: number[] = [];
  for (let x = 0; x < width; x++) {
    stack.push(x, x + (height - 1) * width);
  }
  for (let y = 0; y < height; y++) {
    stack.push(y * width, y * width + width - 1);
  }

  onProgress?.(45, "Separating background");
  while (stack.length > 0) {
    const idx = stack.pop() as number;
    if (idx < 0 || idx >= width * height || visited[idx]) continue;
    const p = idx * 4;
    const dist = Math.sqrt(
      (data[p] - seed[0]) ** 2 + (data[p + 1] - seed[1]) ** 2 + (data[p + 2] - seed[2]) ** 2
    );
    if (dist > tolerance) continue;
    visited[idx] = 1;
    const x = idx % width;
    const y = (idx / width) | 0;
    if (x > 0) stack.push(idx - 1);
    if (x < width - 1) stack.push(idx + 1);
    if (y > 0) stack.push(idx - width);
    if (y < height - 1) stack.push(idx + width);
  }

  onProgress?.(75, "Refining edges");
  for (let i = 0; i < visited.length; i++) {
    if (visited[i]) data[i * 4 + 3] = 0;
  }

  // Feather: blur the alpha channel only, so the cut edge isn't a hard
  // staircase. Colour channels are untouched.
  if (options.feather > 0) {
    const radius = Math.max(1, Math.round((options.feather / 100) * 4));
    const alpha = new Uint8ClampedArray(data.length);
    for (let i = 0; i < data.length; i += 4) {
      alpha[i] = alpha[i + 1] = alpha[i + 2] = alpha[i + 3] = data[i + 3];
    }
    const blurredAlpha = boxBlur(alpha, width, height, radius);
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = blurredAlpha[i];
    }
  }

  ctx.putImageData(imageData, 0, 0);
  onProgress?.(95, "Finishing");

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Couldn't remove the background."))), "image/png");
  });
}

/**
 * Where a real matting service would be wired in. Left unset deliberately —
 * see removeBackground's note. When this is configured, the enhancement panel
 * should POST the asset here and fall back to the local flood fill on error.
 */
export const BACKGROUND_REMOVAL_ENDPOINT: string | null = null;
