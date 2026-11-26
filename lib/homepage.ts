/**
 * Homepage layout vocabulary — pure types, constants and validation, safe
 * to import from the builder (client) and the public homepage (server).
 *
 * A homepage is an ordered list of sections. Each section says WHAT it
 * shows (kind + category + pinned stories) and HOW (layout, count, toggles).
 * Two copies are stored: the draft the editor is working on and the
 * published one the public site renders — see `homepage_layout`.
 */

export const SECTION_KINDS = ["featured", "latest", "category", "most_read", "photo_stories", "videos", "poll"] as const;
export type SectionKind = (typeof SECTION_KINDS)[number];

export const SECTION_KIND_LABELS: Record<SectionKind, string> = {
  featured: "Featured / top stories",
  latest: "Latest news",
  category: "Category",
  most_read: "Most read",
  photo_stories: "Photo stories",
  videos: "Videos",
  poll: "Poll",
};

/** Kinds that list news stories (and so take a story layout). */
export const STORY_KINDS: SectionKind[] = ["featured", "latest", "category", "most_read"];

export const STORY_LAYOUTS = ["mosaic", "hero_side", "three_col", "large_small", "list"] as const;
export type StoryLayout = (typeof STORY_LAYOUTS)[number];

export const LAYOUT_LABELS: Record<StoryLayout, { name: string; hint: string }> = {
  mosaic: { name: "Front-page mosaic", hint: "Lead story, two beside it, then the mixed grid" },
  hero_side: { name: "A · Hero + 2 side stories", hint: "One large story, two stacked beside it" },
  three_col: { name: "B · 3 columns", hint: "Equal cards in rows of three" },
  large_small: { name: "C · Large + small cards", hint: "One large story, compact headlines beside it" },
  list: { name: "D · Horizontal list", hint: "Thumbnail and headline, one per row" },
};

export type HomeSection = {
  id: string;
  kind: SectionKind;
  title: string;
  showTitle: boolean;
  visible: boolean;
  layout: StoryLayout;
  /** How many stories the section shows (story kinds only). */
  count: number;
  /** Category sections: the category's id. */
  categoryId: string | null;
  showImages: boolean;
  showExcerpts: boolean;
  /**
   * Stories an editor placed by hand, in order. They fill the first slots
   * (for Featured: Main, Secondary, Sidebar…); the rest fill automatically.
   */
  pinned: string[];
};

export const COUNT_LIMITS = { min: 1, max: 30 };

/** Slot names for pinned stories in the Featured section, in order. */
export const FEATURED_SLOT_NAMES = ["Main story", "Secondary story", "Sidebar story"];

export function slotName(kind: SectionKind, index: number): string {
  if (kind === "featured" && index < FEATURED_SLOT_NAMES.length) return FEATURED_SLOT_NAMES[index];
  return `Position ${index + 1}`;
}

function sid() {
  return `sec_${Math.random().toString(36).slice(2, 10)}`;
}

export function newSection(kind: SectionKind, overrides: Partial<HomeSection> = {}): HomeSection {
  return {
    id: sid(),
    kind,
    title: SECTION_KIND_LABELS[kind],
    showTitle: kind !== "featured",
    visible: true,
    layout: kind === "featured" ? "mosaic" : kind === "most_read" ? "list" : "hero_side",
    count: kind === "featured" ? 13 : kind === "most_read" ? 5 : 5,
    categoryId: null,
    showImages: true,
    // Featured keeps the lead story's standfirst, as the front page always had.
    showExcerpts: kind === "featured",
    pinned: [],
    ...overrides,
  };
}

/**
 * The default arrangement reproduces the homepage exactly as it was before
 * the builder existed — the front-page mosaic, then photo stories, then
 * videos beside the live poll — so shipping the builder changes nothing
 * until an editor publishes a change. "Reset to default" returns here.
 */
export function defaultSections(): HomeSection[] {
  return [
    { ...newSection("featured", { title: "Top stories", count: 22 }), id: "default-featured" },
    { ...newSection("photo_stories", { title: "Photo stories" }), id: "default-photo" },
    { ...newSection("videos", { title: "Videos" }), id: "default-videos" },
    { ...newSection("poll", { title: "Poll" }), id: "default-poll" },
  ];
}

/**
 * Re-validates a layout arriving from the browser (or an old row) into a
 * well-formed list: unknown kinds and layouts dropped or defaulted, counts
 * clamped, duplicate ids re-issued. Arbitrary client JSON is never saved
 * as-is — same discipline as the photocard studio's sanitizeDocument.
 */
export function sanitizeSections(input: unknown): HomeSection[] {
  if (!Array.isArray(input)) return defaultSections();
  const seen = new Set<string>();
  const out: HomeSection[] = [];
  for (const raw of input.slice(0, 40)) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const kind = SECTION_KINDS.includes(r.kind as SectionKind) ? (r.kind as SectionKind) : null;
    if (!kind) continue;
    const base = newSection(kind);
    let id = typeof r.id === "string" && r.id.length <= 64 ? r.id : base.id;
    if (seen.has(id)) id = base.id;
    seen.add(id);
    const count = Number(r.count);
    out.push({
      id,
      kind,
      title: typeof r.title === "string" ? r.title.slice(0, 80) : base.title,
      showTitle: typeof r.showTitle === "boolean" ? r.showTitle : base.showTitle,
      visible: typeof r.visible === "boolean" ? r.visible : true,
      layout: STORY_LAYOUTS.includes(r.layout as StoryLayout) ? (r.layout as StoryLayout) : base.layout,
      count: Number.isFinite(count) ? Math.min(COUNT_LIMITS.max, Math.max(COUNT_LIMITS.min, Math.round(count))) : base.count,
      categoryId: typeof r.categoryId === "string" && r.categoryId ? r.categoryId : null,
      showImages: typeof r.showImages === "boolean" ? r.showImages : true,
      showExcerpts: typeof r.showExcerpts === "boolean" ? r.showExcerpts : base.showExcerpts,
      pinned: Array.isArray(r.pinned)
        ? Array.from(new Set(r.pinned.filter((p): p is string => typeof p === "string"))).slice(0, 30)
        : [],
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Breaking-news ticker
// ---------------------------------------------------------------------------

export const TICKER_PRIORITIES = ["normal", "high", "breaking"] as const;
export type TickerPriority = (typeof TICKER_PRIORITIES)[number];

export const TICKER_PRIORITY_LABELS: Record<TickerPriority, string> = {
  normal: "Normal",
  high: "High",
  breaking: "Breaking",
};

export type TickerSettings = {
  enabled: boolean;
  label: string;
  /** Seconds for one full pass of the items. Lower is faster. */
  speedSec: number;
  direction: "left" | "right";
  pauseOnHover: boolean;
  autoScroll: boolean;
  maxItems: number;
  /** Also show published stories ticked "News ticker" in the article desk. */
  includeFlaggedStories: boolean;
};

export const DEFAULT_TICKER_SETTINGS: TickerSettings = {
  enabled: true,
  label: "Breaking",
  speedSec: 28,
  direction: "left",
  pauseOnHover: true,
  autoScroll: true,
  maxItems: 10,
  includeFlaggedStories: true,
};

export function sanitizeTickerSettings(input: unknown): TickerSettings {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = DEFAULT_TICKER_SETTINGS;
  const num = (v: unknown, min: number, max: number, dflt: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : dflt;
  };
  return {
    enabled: typeof r.enabled === "boolean" ? r.enabled : d.enabled,
    label: typeof r.label === "string" && r.label.trim() ? r.label.trim().slice(0, 24) : d.label,
    speedSec: num(r.speedSec, 8, 120, d.speedSec),
    direction: r.direction === "right" ? "right" : "left",
    pauseOnHover: typeof r.pauseOnHover === "boolean" ? r.pauseOnHover : d.pauseOnHover,
    autoScroll: typeof r.autoScroll === "boolean" ? r.autoScroll : d.autoScroll,
    maxItems: num(r.maxItems, 1, 30, d.maxItems),
    includeFlaggedStories: typeof r.includeFlaggedStories === "boolean" ? r.includeFlaggedStories : d.includeFlaggedStories,
  };
}

/** Where an item is in its lifecycle right now — what the manager shows. */
export function tickerItemState(
  item: { isActive: boolean; startsAt: Date | string | null; expiresAt: Date | string | null },
  now = new Date()
): "active" | "scheduled" | "expired" | "disabled" {
  if (!item.isActive) return "disabled";
  if (item.expiresAt && new Date(item.expiresAt) <= now) return "expired";
  if (item.startsAt && new Date(item.startsAt) > now) return "scheduled";
  return "active";
}
