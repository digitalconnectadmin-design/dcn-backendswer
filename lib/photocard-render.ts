/**
 * Canvas renderer — the export half of the document model.
 *
 * The DOM renderers (photocard-renderer.tsx, studio-canvas.tsx) and this file
 * draw the same PhotocardDocument two different ways: CSS for the live,
 * re-render-on-every-keystroke previews, and canvas here for the flattened
 * PNG/JPG the article desk actually publishes. Any element property added to
 * one has to be handled in both or the preview and the export drift apart.
 *
 * Browser-only — it touches Image, document and canvas, so it must never be
 * imported into a server component.
 */

import {
  cssFilter,
  hexToRgba,
  resolveImageSrc,
  resolveTextContent,
  type PhotocardData,
  type PhotocardDocument,
  type PhotocardElement,
  type PhotocardFit,
  type PhotocardImageElement,
  type PhotocardShapeElement,
  type PhotocardTextElement,
} from "@/lib/photocard";

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Needed so toBlob() isn't blocked by a tainted canvas. UploadThing's CDN
    // sends permissive CORS; a pasted URL from a host that doesn't will fail
    // here with a readable message instead of exporting blank.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(
        new Error(
          "Couldn't load an image for export — upload it here instead of pasting a link from another site."
        )
      );
    img.src = src;
  });
}

/** Source rect for drawing `img` into a w×h box under the given fit mode. */
function fitRect(img: HTMLImageElement, w: number, h: number, fit: PhotocardFit) {
  if (fit === "fill") {
    return { sx: 0, sy: 0, sw: img.width, sh: img.height, dx: 0, dy: 0, dw: w, dh: h };
  }
  const imgRatio = img.width / img.height;
  const boxRatio = w / h;
  if (fit === "contain") {
    const dw = imgRatio > boxRatio ? w : h * imgRatio;
    const dh = imgRatio > boxRatio ? w / imgRatio : h;
    return {
      sx: 0, sy: 0, sw: img.width, sh: img.height,
      dx: (w - dw) / 2, dy: (h - dh) / 2, dw, dh,
    };
  }
  // cover
  let sw = img.width;
  let sh = img.height;
  let sx = 0;
  let sy = 0;
  if (imgRatio > boxRatio) {
    sw = img.height * boxRatio;
    sx = (img.width - sw) / 2;
  } else {
    sh = img.width / boxRatio;
    sy = (img.height - sh) / 2;
  }
  return { sx, sy, sw, sh, dx: 0, dy: 0, dw: w, dh: h };
}

function roundedPath(ctx: CanvasRenderingContext2D, w: number, h: number, r: number) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(w - radius, 0);
  ctx.quadraticCurveTo(w, 0, w, radius);
  ctx.lineTo(w, h - radius);
  ctx.quadraticCurveTo(w, h, w - radius, h);
  ctx.lineTo(radius, h);
  ctx.quadraticCurveTo(0, h, 0, h - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
}

/** Greedy word wrap; falls back to hard character breaks for long unbroken runs. */
export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const attempt = current ? `${current} ${word}` : word;
      if (current && ctx.measureText(attempt).width > maxWidth) {
        lines.push(current);
        current = word;
      } else {
        current = attempt;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function drawTextElement(
  ctx: CanvasRenderingContext2D,
  el: PhotocardTextElement,
  data: PhotocardData
) {
  const text = resolveTextContent(el, data).trim();
  if (!text) return;

  ctx.font = `${el.italic ? "italic" : "normal"} ${el.fontWeight} ${el.fontSize}px ${el.fontFamily}`;
  ctx.textBaseline = "middle";
  if ("letterSpacing" in ctx) {
    // Supported in current Chrome/Safari/Firefox; harmless where it isn't.
    (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${el.letterSpacing}px`;
  }

  const lineHeight = el.fontSize * el.lineHeight;
  const lines = wrapLines(ctx, text, el.width);
  const blockHeight = lines.length * lineHeight;
  // Vertically centred within the element box, matching the DOM renderer's
  // flex centring rather than top-aligning.
  let y = (el.height - blockHeight) / 2 + lineHeight / 2;

  if (el.highlight.enabled) {
    ctx.fillStyle = hexToRgba(el.highlight.color, el.highlight.opacity);
    const pad = el.fontSize * 0.3;
    ctx.fillRect(-pad, (el.height - blockHeight) / 2 - pad, el.width + pad * 2, blockHeight + pad * 2);
  }

  if (el.shadow.enabled) {
    ctx.shadowColor = el.shadow.color;
    ctx.shadowBlur = el.shadow.blur;
    ctx.shadowOffsetX = el.shadow.offsetX;
    ctx.shadowOffsetY = el.shadow.offsetY;
  }

  ctx.fillStyle = el.color;
  ctx.textAlign = el.align;
  const anchorX = el.align === "center" ? el.width / 2 : el.align === "right" ? el.width : 0;

  for (const line of lines) {
    ctx.fillText(line, anchorX, y);
    if (el.underline && line) {
      const metrics = ctx.measureText(line);
      const lineWidth = metrics.width;
      const startX =
        el.align === "center" ? anchorX - lineWidth / 2 : el.align === "right" ? anchorX - lineWidth : anchorX;
      ctx.fillRect(startX, y + el.fontSize * 0.42, lineWidth, Math.max(1, el.fontSize * 0.05));
    }
    y += lineHeight;
  }

  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function drawShapeElement(ctx: CanvasRenderingContext2D, el: PhotocardShapeElement) {
  ctx.fillStyle = hexToRgba(el.fill, el.fillOpacity);
  ctx.strokeStyle = el.stroke;
  ctx.lineWidth = el.strokeWidth;

  if (el.shape === "rect") {
    roundedPath(ctx, el.width, el.height, el.radius);
    ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  } else if (el.shape === "ellipse") {
    ctx.beginPath();
    ctx.ellipse(el.width / 2, el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
    ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  } else if (el.shape === "triangle") {
    ctx.beginPath();
    ctx.moveTo(el.width / 2, 0);
    ctx.lineTo(el.width, el.height);
    ctx.lineTo(0, el.height);
    ctx.closePath();
    ctx.fill();
    if (el.strokeWidth > 0) ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(0, el.height / 2);
    ctx.lineTo(el.width, el.height / 2);
    ctx.lineWidth = Math.max(1, el.strokeWidth || 4);
    ctx.strokeStyle = el.stroke === "#ffffff" && el.fill ? el.fill : el.stroke;
    ctx.stroke();
  }
}

async function drawImageElement(
  ctx: CanvasRenderingContext2D,
  el: PhotocardImageElement,
  data: PhotocardData
) {
  const src = resolveImageSrc(el, data);
  if (!src) return;
  const img = await loadImage(src);

  ctx.save();
  // Mask wins over plain radius — a circle mask is just a maximal radius.
  if (el.mask === "circle") {
    ctx.beginPath();
    ctx.ellipse(el.width / 2, el.height / 2, el.width / 2, el.height / 2, 0, 0, Math.PI * 2);
    ctx.clip();
  } else if (el.mask === "rounded") {
    roundedPath(ctx, el.width, el.height, Math.min(el.width, el.height) * 0.12);
    ctx.clip();
  } else if (el.radius > 0) {
    roundedPath(ctx, el.width, el.height, el.radius);
    ctx.clip();
  }
  const filter = cssFilter(el.filters);
  if (filter !== "none") ctx.filter = filter;
  if (el.flipH || el.flipV) {
    ctx.translate(el.flipH ? el.width : 0, el.flipV ? el.height : 0);
    ctx.scale(el.flipH ? -1 : 1, el.flipV ? -1 : 1);
  }
  const r = fitRect(img, el.width, el.height, el.fit);
  if (el.crop) {
    // Crop is stored source-relative (0-1) so it survives the image being
    // swapped for a processed version at a different pixel size.
    const cx = r.sx + el.crop.x * r.sw;
    const cy = r.sy + el.crop.y * r.sh;
    const cw = el.crop.width * r.sw;
    const ch = el.crop.height * r.sh;
    ctx.drawImage(img, cx, cy, cw, ch, r.dx, r.dy, r.dw, r.dh);
  } else {
    ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
  }
  ctx.restore();
}

async function drawElement(
  ctx: CanvasRenderingContext2D,
  el: PhotocardElement,
  data: PhotocardData
) {
  if (el.hidden) return;
  ctx.save();
  ctx.globalAlpha = Math.max(0, Math.min(100, el.opacity)) / 100;
  // BLEND_MODES is restricted to values canvas and CSS both implement, so the
  // studio preview and this export agree without a translation table.
  if (el.blend && el.blend !== "normal") {
    ctx.globalCompositeOperation = el.blend as GlobalCompositeOperation;
  }
  // Rotate about the element's centre, then work in its local space so every
  // draw helper can treat (0,0) as the element's own top-left.
  ctx.translate(el.x + el.width / 2, el.y + el.height / 2);
  ctx.rotate((el.rotation * Math.PI) / 180);
  ctx.translate(-el.width / 2, -el.height / 2);

  if (el.type === "text") drawTextElement(ctx, el, data);
  else if (el.type === "shape") drawShapeElement(ctx, el);
  else await drawImageElement(ctx, el, data);

  ctx.restore();
}

export type ExportOptions = {
  /** 1 = the document's own pixel size, 2 = twice that, etc. */
  scale?: number;
  format?: "png" | "jpeg" | "webp";
  /** 0-1, ignored for png. */
  quality?: number;
  /** png/webp only — skips painting the background layer. */
  transparent?: boolean;
};

/** Paints a document (with article data substituted) onto a fresh canvas. */
export async function renderDocumentToCanvas(
  doc: PhotocardDocument,
  data: PhotocardData,
  options: ExportOptions = {}
): Promise<HTMLCanvasElement> {
  const scale = options.scale ?? 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(doc.width * scale);
  canvas.height = Math.round(doc.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas isn't supported in this browser.");
  ctx.scale(scale, scale);

  if (!options.transparent) {
    const bg = doc.background;
    if (bg.type === "solid") {
      ctx.fillStyle = bg.color;
      ctx.fillRect(0, 0, doc.width, doc.height);
    } else if (bg.type === "gradient") {
      // CSS gradient angles run clockwise from "up"; canvas works in vectors,
      // so the angle is converted rather than passed through.
      const rad = ((bg.angle - 90) * Math.PI) / 180;
      const half = Math.max(doc.width, doc.height) / 2;
      const cx = doc.width / 2;
      const cy = doc.height / 2;
      const gradient = ctx.createLinearGradient(
        cx - Math.cos(rad) * half,
        cy - Math.sin(rad) * half,
        cx + Math.cos(rad) * half,
        cy + Math.sin(rad) * half
      );
      gradient.addColorStop(0, bg.from);
      gradient.addColorStop(1, bg.to);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, doc.width, doc.height);
    } else if (bg.type === "image" && bg.src) {
      const img = await loadImage(bg.src);
      const r = fitRect(img, doc.width, doc.height, bg.fit);
      ctx.drawImage(img, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    }
  }

  for (const el of doc.elements) {
    await drawElement(ctx, el, data);
  }
  return canvas;
}

export async function renderDocumentToBlob(
  doc: PhotocardDocument,
  data: PhotocardData,
  options: ExportOptions = {}
): Promise<Blob> {
  const canvas = await renderDocumentToCanvas(doc, data, options);
  const format = options.format ?? "png";
  const mime = `image/${format}`;
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't generate the image."))),
      mime,
      format === "png" ? undefined : options.quality ?? 0.92
    );
  });
}

/** Triggers a browser download for an already-built blob. */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
