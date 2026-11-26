/**
 * Photocard template document model.
 *
 * A template is a serializable *document* — canvas size, a background, and an
 * ordered list of absolutely-positioned elements — not a fixed set of columns.
 * The same document drives four renderers, which must agree with each other:
 *   - components/admin/photocard-renderer.tsx  (read-only DOM render)
 *   - components/admin/studio/studio-canvas.tsx (editable DOM render)
 *   - lib/photocard-render.ts                   (canvas export)
 *   - the article desk's generate step (via the canvas export)
 *
 * Coordinates are CANVAS PIXELS, with the document's own width/height as the
 * reference frame. `x`/`y` are the element's top-left; `rotation` is degrees
 * clockwise about its centre. The DOM renderers draw at a scale factor
 * (rendered width / document width) so one document renders identically at a
 * 180px library thumbnail and a 1080px export — see photocardScale().
 */

export const PHOTOCARD_DOC_VERSION = 2;

// --- Dynamic fields -------------------------------------------------------

/** Article values a text element can bind to instead of fixed copy. */
export type PhotocardTextField =
  | "headline"
  | "subheadline"
  | "category"
  | "author"
  | "date"
  | "location"
  | "source";

/** Article values an image element can bind to. */
export type PhotocardImageField = "featured_image" | "logo";

export const TEXT_FIELD_LABELS: Record<PhotocardTextField, string> = {
  headline: "Article headline",
  subheadline: "Subheadline",
  category: "Category",
  author: "Author / byline",
  date: "Publish date",
  location: "Location / dateline",
  source: "Source",
};

export const IMAGE_FIELD_LABELS: Record<PhotocardImageField, string> = {
  featured_image: "Featured image",
  logo: "Publication logo",
};

/** What the article desk supplies at generation time. */
export type PhotocardData = Partial<Record<PhotocardTextField, string>> &
  Partial<Record<PhotocardImageField, string>>;

/** Stand-in values so the studio and library previews aren't full of blanks. */
export const SAMPLE_PHOTOCARD_DATA: PhotocardData = {
  headline: "শিরোনাম এখানে দেখাবে",
  subheadline: "Subheadline preview text",
  category: "Breaking news",
  author: "Staff Correspondent",
  date: "14 Sep 2026",
  location: "Dhaka",
  source: "Digital Connect News",
};

// --- Elements -------------------------------------------------------------

export type PhotocardAlign = "left" | "center" | "right";
export type PhotocardTextTransform = "none" | "uppercase" | "lowercase" | "capitalize";
export type PhotocardFit = "cover" | "contain" | "fill";
export type PhotocardShapeKind =
  | "rect"
  | "ellipse"
  | "triangle"
  | "line"
  | "polygon"
  | "arrow";

/**
 * Only modes that canvas `globalCompositeOperation` and CSS `mix-blend-mode`
 * both implement under the same name are offered — so the studio preview and
 * the exported PNG can't disagree about what a blend looks like. Anything
 * outside this list (e.g. "hue", which canvas treats differently across
 * engines) is deliberately not exposed.
 */
export const BLEND_MODES = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "soft-light",
  "hard-light",
  "difference",
] as const;
export type PhotocardBlend = (typeof BLEND_MODES)[number];

type ElementBase = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Degrees clockwise about the element's centre. */
  rotation: number;
  /** 0-100. */
  opacity: number;
  locked: boolean;
  hidden: boolean;
  blend: PhotocardBlend;
  /**
   * Flat group membership: every element sharing a groupId moves, rotates,
   * locks and deletes together. Deliberately not a tree — nested groups would
   * mean a recursive document shape that every renderer and the exporter would
   * each have to walk. A flat id covers the newsroom cases (badge + bar,
   * logo + strapline) without that cost.
   */
  groupId: string | null;
};

export type PhotocardTextElement = ElementBase & {
  type: "text";
  /** Literal copy. Ignored when `field` is set. */
  text: string;
  /** When set, the article's value for this field replaces `text`. */
  field: PhotocardTextField | null;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  letterSpacing: number;
  lineHeight: number;
  align: PhotocardAlign;
  textTransform: PhotocardTextTransform;
  color: string;
  highlight: { enabled: boolean; color: string; opacity: number };
  shadow: { enabled: boolean; color: string; blur: number; offsetX: number; offsetY: number };
};

/** Normalised (0-1) source rectangle kept by a crop. Null means the full image. */
export type PhotocardCrop = { x: number; y: number; width: number; height: number } | null;

export type PhotocardImageMask = "none" | "rounded" | "circle";

/**
 * What has been baked into `src` by the enhancement tools. CSS-filterable
 * adjustments (brightness/contrast/saturate/blur) stay live in `filters` and
 * never touch pixels; sharpen, denoise, upscale and background removal can't
 * be expressed in CSS, so they produce a new processed asset — and this
 * record is what lets the UI show what was applied and offer Restore original.
 */
export type PhotocardImageProcessing = {
  sharpen: number;
  clarity: number;
  denoise: number;
  upscale: number;
  backgroundRemoved: boolean;
  preset: string | null;
};

export type PhotocardImageElement = ElementBase & {
  type: "image";
  src: string;
  /** The asset as uploaded. Never overwritten, so Restore original works. */
  originalSrc: string;
  processing: PhotocardImageProcessing;
  /**
   * Crop is stored as a normalised (0-1) window on the *source* image rather
   * than by rewriting the uploaded file, so "reset crop" is always available
   * and the original upload stays recoverable — the file on UploadThing is
   * never modified by cropping.
   */
  crop: PhotocardCrop;
  mask: PhotocardImageMask;
  field: PhotocardImageField | null;
  fit: PhotocardFit;
  radius: number;
  flipH: boolean;
  flipV: boolean;
  /** Percentages, 100 = unchanged; blur is px. */
  filters: { brightness: number; contrast: number; saturate: number; blur: number };
};

export type PhotocardShapeElement = ElementBase & {
  type: "shape";
  shape: PhotocardShapeKind;
  fill: string;
  fillOpacity: number;
  stroke: string;
  strokeWidth: number;
  radius: number;
  /** Sides for `polygon` (3-12). Ignored by other shape kinds. */
  sides?: number;
};

export type PhotocardElement =
  | PhotocardTextElement
  | PhotocardImageElement
  | PhotocardShapeElement;

// --- Background & document ------------------------------------------------

export type PhotocardBackground =
  | { type: "solid"; color: string }
  | { type: "gradient"; from: string; to: string; angle: number }
  | { type: "image"; src: string; fit: PhotocardFit }
  | { type: "transparent" };

export type PhotocardDocument = {
  version: number;
  width: number;
  height: number;
  background: PhotocardBackground;
  /** Painted in array order — index 0 is furthest back. */
  elements: PhotocardElement[];
};

// --- Canvas presets -------------------------------------------------------

export type PhotocardPreset = {
  key: string;
  label: string;
  width: number;
  height: number;
  group: string;
};

export const PHOTOCARD_PRESETS: PhotocardPreset[] = [
  { key: "ig-post", label: "Instagram post (1:1)", width: 1080, height: 1080, group: "Social" },
  { key: "ig-portrait", label: "Instagram portrait (4:5)", width: 1080, height: 1350, group: "Social" },
  { key: "ig-story", label: "Instagram / FB story (9:16)", width: 1080, height: 1920, group: "Social" },
  { key: "fb-post", label: "Facebook post (1.91:1)", width: 1200, height: 628, group: "Social" },
  { key: "x-post", label: "X post (16:9)", width: 1200, height: 675, group: "Social" },
  { key: "yt-thumb", label: "YouTube thumbnail (16:9)", width: 1280, height: 720, group: "Video" },
  { key: "web", label: "Website hero (16:9)", width: 1600, height: 900, group: "Web" },
];

export const TEMPLATE_CATEGORIES = [
  "Breaking news",
  "Politics",
  "Sports",
  "Entertainment",
  "Technology",
  "Business",
  "International",
  "Local news",
  "Special report",
  "Interview",
  "Quote",
  "Social media",
  "Custom",
] as const;

export const TEMPLATE_STATUSES = ["draft", "active", "archived"] as const;
export type PhotocardTemplateStatus = (typeof TEMPLATE_STATUSES)[number];

/**
 * Font stacks offered in the studio. These are concrete family names rather
 * than the site's CSS variables because the canvas exporter needs a real
 * family to pass to ctx.font — a `var(--font-sans)` string means nothing to
 * canvas. SolaimanLipi is appended to each so Bangla glyphs resolve the same
 * way they do site-wide (see the fonts section in CLAUDE.md).
 */
export const PHOTOCARD_FONTS: { label: string; value: string }[] = [
  { label: "Manrope (UI / body)", value: "Manrope, SolaimanLipi, sans-serif" },
  { label: "Newsreader (display)", value: "Newsreader, SolaimanLipi, serif" },
  { label: "Space Mono (broadcast)", value: "'Space Mono', SolaimanLipi, monospace" },
  { label: "System sans", value: "system-ui, SolaimanLipi, sans-serif" },
  { label: "System serif", value: "Georgia, SolaimanLipi, serif" },
];

export const DEFAULT_FONT = PHOTOCARD_FONTS[0].value;

// --- Factories ------------------------------------------------------------

function newId() {
  return crypto.randomUUID();
}

export function createTextElement(partial: Partial<PhotocardTextElement> = {}): PhotocardTextElement {
  return {
    id: newId(),
    type: "text",
    name: partial.name ?? "Text",
    x: 80,
    y: 80,
    width: 600,
    height: 160,
    rotation: 0,
    opacity: 100,
    locked: false,
    hidden: false,
    blend: "normal",
    groupId: null,
    text: "Your text here",
    field: null,
    fontFamily: DEFAULT_FONT,
    fontSize: 56,
    fontWeight: 700,
    italic: false,
    underline: false,
    letterSpacing: 0,
    lineHeight: 1.3,
    align: "left",
    textTransform: "none",
    color: "#ffffff",
    highlight: { enabled: false, color: "#000000", opacity: 70 },
    shadow: { enabled: false, color: "#000000", blur: 8, offsetX: 0, offsetY: 2 },
    ...partial,
  };
}

export function createImageElement(partial: Partial<PhotocardImageElement> = {}): PhotocardImageElement {
  return {
    id: newId(),
    type: "image",
    name: partial.name ?? "Image",
    x: 100,
    y: 100,
    width: 400,
    height: 400,
    rotation: 0,
    opacity: 100,
    locked: false,
    hidden: false,
    blend: "normal",
    groupId: null,
    src: "",
    originalSrc: "",
    processing: {
      sharpen: 0,
      clarity: 0,
      denoise: 0,
      upscale: 1,
      backgroundRemoved: false,
      preset: null,
    },
    crop: null,
    mask: "none",
    field: null,
    fit: "cover",
    radius: 0,
    flipH: false,
    flipV: false,
    filters: { brightness: 100, contrast: 100, saturate: 100, blur: 0 },
    ...partial,
  };
}

export function createShapeElement(partial: Partial<PhotocardShapeElement> = {}): PhotocardShapeElement {
  return {
    id: newId(),
    type: "shape",
    name: partial.name ?? "Shape",
    x: 100,
    y: 100,
    width: 400,
    height: 200,
    rotation: 0,
    opacity: 100,
    locked: false,
    hidden: false,
    blend: "normal",
    groupId: null,
    shape: "rect",
    fill: "#111111",
    fillOpacity: 100,
    stroke: "#ffffff",
    strokeWidth: 0,
    radius: 0,
    sides: 6,
    ...partial,
  };
}

/** A full-bleed image element bound to the article's featured image. */
export function createPhotoSlot(doc: { width: number; height: number }): PhotocardImageElement {
  return createImageElement({
    name: "Article photo",
    field: "featured_image",
    x: 0,
    y: 0,
    width: doc.width,
    height: doc.height,
  });
}

/** What a brand-new template starts as: photo slot, scrim, bound headline. */
export function defaultPhotocardDocument(width = 1080, height = 1080): PhotocardDocument {
  const doc = { width, height };
  return {
    version: PHOTOCARD_DOC_VERSION,
    width,
    height,
    background: { type: "solid", color: "#111111" },
    elements: [
      createPhotoSlot(doc),
      createShapeElement({
        name: "Headline scrim",
        x: 0,
        y: Math.round(height * 0.62),
        width,
        height: Math.round(height * 0.38),
        fill: "#000000",
        fillOpacity: 65,
      }),
      createTextElement({
        name: "Headline",
        field: "headline",
        text: "শিরোনাম এখানে দেখাবে",
        x: Math.round(width * 0.06),
        y: Math.round(height * 0.7),
        width: Math.round(width * 0.88),
        height: Math.round(height * 0.22),
        fontSize: Math.round(width * 0.055),
        fontFamily: DEFAULT_FONT,
        fontWeight: 700,
        color: "#ffffff",
      }),
    ],
  };
}

// --- Brand kit ----------------------------------------------------------

export type BrandKit = {
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
    breaking: string;
    success: string;
    warning: string;
  };
  fonts: { heading: string; body: string; caption: string };
  assets: { logo: string; altLogo: string; watermark: string };
};

export const DEFAULT_BRAND_KIT: BrandKit = {
  colors: {
    primary: "#1d3557",
    secondary: "#457b9d",
    accent: "#e63946",
    background: "#111111",
    text: "#ffffff",
    breaking: "#d7263d",
    success: "#2a9d8f",
    warning: "#e9c46a",
  },
  fonts: { heading: PHOTOCARD_FONTS[1].value, body: PHOTOCARD_FONTS[0].value, caption: PHOTOCARD_FONTS[0].value },
  assets: { logo: "", altLogo: "", watermark: "" },
};

/** Newsroom badge presets for the elements library. */
export const NEWSROOM_BADGES = [
  { label: "BREAKING", bg: "#d7263d", fg: "#ffffff" },
  { label: "LIVE", bg: "#c1121f", fg: "#ffffff" },
  { label: "EXCLUSIVE", bg: "#f1e28f", fg: "#111111" },
  { label: "DEVELOPING", bg: "#e76f51", fg: "#ffffff" },
  { label: "UPDATE", bg: "#457b9d", fg: "#ffffff" },
  { label: "OPINION", bg: "#6d597a", fg: "#ffffff" },
  { label: "WATCH", bg: "#2a9d8f", fg: "#ffffff" },
  { label: "SPECIAL REPORT", bg: "#1d3557", fg: "#ffffff" },
  { label: "VERIFIED", bg: "#2a9d8f", fg: "#ffffff" },
  { label: "NEWS ALERT", bg: "#e63946", fg: "#ffffff" },
] as const;

export const IMAGE_PRESETS = [
  { key: "original", label: "Original", sharpen: 0, clarity: 0, denoise: 0, brightness: 100, contrast: 100, saturate: 100 },
  { key: "natural", label: "Natural", sharpen: 15, clarity: 10, denoise: 10, brightness: 102, contrast: 104, saturate: 102 },
  { key: "sharp", label: "Sharp", sharpen: 55, clarity: 30, denoise: 0, brightness: 100, contrast: 110, saturate: 100 },
  { key: "portrait", label: "Portrait", sharpen: 20, clarity: 8, denoise: 25, brightness: 104, contrast: 102, saturate: 104 },
  { key: "lowlight", label: "Low light", sharpen: 25, clarity: 20, denoise: 45, brightness: 118, contrast: 108, saturate: 106 },
  { key: "newsroom", label: "Newsroom", sharpen: 25, clarity: 12, denoise: 15, brightness: 102, contrast: 106, saturate: 100 },
  { key: "social", label: "Social media", sharpen: 35, clarity: 22, denoise: 10, brightness: 104, contrast: 112, saturate: 112 },
  { key: "contrast", label: "High contrast", sharpen: 20, clarity: 25, denoise: 0, brightness: 100, contrast: 130, saturate: 105 },
  { key: "oldphoto", label: "Old photo", sharpen: 30, clarity: 15, denoise: 55, brightness: 106, contrast: 108, saturate: 80 },
] as const;

// --- Grouping helpers -----------------------------------------------------

/** Expands a selection so picking any group member selects the whole group. */
export function expandSelection(elements: PhotocardElement[], ids: string[]): string[] {
  const groups = new Set(
    elements.filter((e) => ids.includes(e.id) && e.groupId).map((e) => e.groupId as string)
  );
  if (groups.size === 0) return ids;
  const expanded = new Set(ids);
  for (const el of elements) {
    if (el.groupId && groups.has(el.groupId)) expanded.add(el.id);
  }
  return [...expanded];
}

/** Tight bounding box around a set of elements, ignoring rotation. */
export function boundingBox(elements: PhotocardElement[]) {
  if (elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...elements.map((e) => e.x));
  const y = Math.min(...elements.map((e) => e.y));
  const right = Math.max(...elements.map((e) => e.x + e.width));
  const bottom = Math.max(...elements.map((e) => e.y + e.height));
  return { x, y, width: right - x, height: bottom - y };
}

// --- Resolution & geometry ------------------------------------------------

/** Applies a text element's transform to whatever copy it resolved to. */
export function applyTextTransform(text: string, transform: PhotocardTextTransform): string {
  if (transform === "uppercase") return text.toUpperCase();
  if (transform === "lowercase") return text.toLowerCase();
  if (transform === "capitalize") {
    return text.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  }
  return text;
}

/** The copy a text element should actually show for a given article. */
export function resolveTextContent(el: PhotocardTextElement, data: PhotocardData): string {
  const raw = el.field ? (data[el.field] ?? "").trim() || el.text : el.text;
  return applyTextTransform(raw, el.textTransform);
}

/** The image URL an image element should actually show for a given article. */
export function resolveImageSrc(el: PhotocardImageElement, data: PhotocardData): string {
  if (el.field) return (data[el.field] ?? "").trim() || el.src;
  return el.src;
}

/** Display scale for rendering a document into a box of `renderedWidth` px. */
export function photocardScale(doc: PhotocardDocument, renderedWidth: number): number {
  return doc.width > 0 ? renderedWidth / doc.width : 1;
}

export function hexToRgba(hex: string, opacityPercent: number): string {
  const clean = hex.replace("#", "").trim();
  const expanded =
    clean.length === 3
      ? clean.split("").map((c) => c + c).join("")
      : clean;
  const value = Number.parseInt(expanded, 16);
  if (!Number.isFinite(value)) return `rgba(0, 0, 0, ${opacityPercent / 100})`;
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  const a = Math.min(100, Math.max(0, opacityPercent)) / 100;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function cssBackground(bg: PhotocardBackground): string {
  if (bg.type === "solid") return bg.color;
  if (bg.type === "gradient") return `linear-gradient(${bg.angle}deg, ${bg.from}, ${bg.to})`;
  return "transparent";
}

export function cssFilter(filters: PhotocardImageElement["filters"]): string {
  const parts: string[] = [];
  if (filters.brightness !== 100) parts.push(`brightness(${filters.brightness}%)`);
  if (filters.contrast !== 100) parts.push(`contrast(${filters.contrast}%)`);
  if (filters.saturate !== 100) parts.push(`saturate(${filters.saturate}%)`);
  if (filters.blur > 0) parts.push(`blur(${filters.blur}px)`);
  return parts.join(" ") || "none";
}

// --- Legacy migration -----------------------------------------------------

/**
 * Version 1 templates stored `textLayers`: percentage-positioned text with a
 * single optional highlight band, alongside a separate frameImageUrl column.
 * They're converted on read rather than in a data migration, so an install
 * that hasn't re-saved its templates yet keeps working — `normalizeDocument`
 * is the single entry point every read path uses.
 */
type LegacyLayer = {
  id?: string;
  label?: string;
  isDynamicHeadline?: boolean;
  content?: string;
  x?: number;
  y?: number;
  width?: number;
  fontSize?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: string;
  backgroundEnabled?: boolean;
  backgroundColor?: string;
  backgroundOpacity?: number;
};

export function migrateLegacyLayers(
  layers: LegacyLayer[],
  frameImageUrl: string | null,
  width: number,
  height: number
): PhotocardDocument {
  const elements: PhotocardElement[] = [createPhotoSlot({ width, height })];

  if (frameImageUrl) {
    elements.push(
      createImageElement({
        name: "Frame overlay",
        src: frameImageUrl,
        x: 0,
        y: 0,
        width,
        height,
        fit: "cover",
      })
    );
  }

  for (const l of layers) {
    const boxWidth = ((l.width ?? 70) / 100) * width;
    const fontSize = ((l.fontSize ?? 4) / 100) * width;
    const boxHeight = fontSize * 1.3 * 2;
    elements.push(
      createTextElement({
        name: l.label || "Text",
        text: l.content ?? "",
        field: l.isDynamicHeadline ? "headline" : null,
        // Legacy x/y addressed the box's CENTRE; the document model uses the
        // top-left, so both are shifted back by half the box here.
        x: ((l.x ?? 50) / 100) * width - boxWidth / 2,
        y: ((l.y ?? 50) / 100) * height - boxHeight / 2,
        width: boxWidth,
        height: boxHeight,
        fontSize,
        fontWeight: l.bold ? 700 : 500,
        italic: Boolean(l.italic),
        align: l.align === "left" || l.align === "right" ? l.align : "center",
        color: l.color ?? "#ffffff",
        highlight: {
          enabled: Boolean(l.backgroundEnabled),
          color: l.backgroundColor ?? "#000000",
          opacity: l.backgroundOpacity ?? 70,
        },
      })
    );
  }

  return {
    version: PHOTOCARD_DOC_VERSION,
    width,
    height,
    background: { type: "solid", color: "#111111" },
    elements,
  };
}

/**
 * Accepts whatever a template row holds — a v2 document, a v1 layer array, or
 * nothing — and always returns a usable document. Every read path goes
 * through this, so no renderer has to handle a half-shaped record.
 */
export function normalizeDocument(
  raw: unknown,
  fallback?: { frameImageUrl?: string | null; width?: number; height?: number }
): PhotocardDocument {
  const width = fallback?.width ?? 1080;
  const height = fallback?.height ?? 1080;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const doc = raw as Partial<PhotocardDocument>;
    if (Array.isArray(doc.elements) && typeof doc.width === "number") {
      return {
        version: PHOTOCARD_DOC_VERSION,
        width: doc.width,
        height: typeof doc.height === "number" ? doc.height : height,
        background: doc.background ?? { type: "solid", color: "#111111" },
        elements: doc.elements as PhotocardElement[],
      };
    }
  }

  if (Array.isArray(raw)) {
    return migrateLegacyLayers(raw as LegacyLayer[], fallback?.frameImageUrl ?? null, width, height);
  }

  return defaultPhotocardDocument(width, height);
}
