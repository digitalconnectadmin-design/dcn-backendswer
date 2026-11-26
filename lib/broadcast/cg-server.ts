import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { cgAirItem, cgChannel, cgDataSource, cgEvent, cgFavorite, cgTemplate, story, user } from "@/db/schema";
import {
  defaultValues,
  sanitizeDataConfig,
  starterTemplates,
  type CgDataConfig,
  type CgDocument,
  type CgField,
  type CgValues,
} from "@/lib/cg";

/**
 * Server-side reads and the data-feed plumbing for Studio CG. Plain server
 * module (not "use server"): its functions are called from server components
 * and from the actions file, never passed to a client component — see the
 * Kanban note in CLAUDE.md about serialising non-action functions.
 */

export const CHANNEL_KEY = "default";

function newOutputKey() {
  return crypto.randomUUID().replace(/-/g, "");
}

/** The single channel row, created on first use (also mints the output key). */
export async function ensureChannel() {
  const [row] = await db.select().from(cgChannel).where(eq(cgChannel.key, CHANNEL_KEY)).limit(1);
  if (row) return row;
  await db
    .insert(cgChannel)
    .values({ key: CHANNEL_KEY, version: 1, outputKey: newOutputKey(), updatedAt: new Date() })
    .onConflictDoNothing();
  const [created] = await db.select().from(cgChannel).where(eq(cgChannel.key, CHANNEL_KEY)).limit(1);
  return created;
}

/**
 * Every change to the output bumps this counter, so the program preview and
 * the browser source can watch one tiny row instead of re-reading the whole
 * air state on a timer.
 */
export async function bumpVersion() {
  await ensureChannel();
  const [row] = await db
    .update(cgChannel)
    .set({ version: sql`${cgChannel.version} + 1`, updatedAt: new Date() })
    .where(eq(cgChannel.key, CHANNEL_KEY))
    .returning({ version: cgChannel.version });
  return row?.version ?? 0;
}

export async function getVersion() {
  const row = await ensureChannel();
  return row?.version ?? 0;
}

/**
 * Times a graphic off air when its duration has run out. Done as one
 * conditional UPDATE … RETURNING so that whichever request gets there first
 * is the one that logs it — two open browsers can't both write the "off air"
 * line. Called on every read of the air state, which is why a timed graphic
 * leaves air even with no operator watching.
 */
export async function expireDueGraphics() {
  const now = new Date();
  const expired = await db
    .update(cgAirItem)
    .set({ status: "done", endedAt: now })
    .where(and(eq(cgAirItem.status, "on_air"), lt(cgAirItem.expiresAt, now)))
    .returning({
      id: cgAirItem.id,
      label: cgAirItem.label,
      templateId: cgAirItem.templateId,
      startedAt: cgAirItem.startedAt,
      expiresAt: cgAirItem.expiresAt,
    });
  if (expired.length === 0) return 0;
  await db.insert(cgEvent).values(
    expired.map((e) => ({
      action: "auto_off",
      label: e.label,
      detail: "Duration reached",
      templateId: e.templateId,
      airItemId: e.id,
      // Measured to the moment it was due, not to when this ran: the row is
      // flipped by whichever poll notices, which can be a beat later.
      durationMs:
        e.startedAt && e.expiresAt ? new Date(e.expiresAt).getTime() - new Date(e.startedAt).getTime() : null,
    }))
  );
  await bumpVersion();
  return expired.length;
}

export type AirItem = {
  id: string;
  templateId: string | null;
  label: string;
  document: CgDocument;
  fields: CgField[];
  values: CgValues;
  animationIn: string;
  animationOut: string;
  animationMs: number;
  layer: number;
  status: "on_air" | "queued" | "done";
  position: number;
  expiresAt: Date | null;
  startedAt: Date | null;
  endedAt: Date | null;
  operatorId: string | null;
  operatorName?: string | null;
  storyId: string | null;
  dataSourceId: string | null;
};

/** What the output is showing plus what's lined up behind it. */
export async function getAirState() {
  await expireDueGraphics();
  // Read the version FIRST: if a take commits between the two queries, the
  // client stores the older version and polls again, rather than storing a
  // newer version alongside rows that predate it and never refetching.
  const version = await getVersion();
  const rows = await db
    .select({
      item: cgAirItem,
      operatorName: user.name,
    })
    .from(cgAirItem)
    .leftJoin(user, eq(user.id, cgAirItem.operatorId))
    .where(inArray(cgAirItem.status, ["on_air", "queued"]))
    .orderBy(cgAirItem.layer, cgAirItem.position);

  const all: AirItem[] = rows.map((r) => ({ ...(r.item as AirItem), operatorName: r.operatorName ?? null }));
  return {
    onAir: all.filter((i) => i.status === "on_air").sort((a, b) => a.layer - b.layer),
    queue: all.filter((i) => i.status === "queued").sort((a, b) => a.position - b.position),
    version,
  };
}

export type TemplateRow = typeof cgTemplate.$inferSelect & { isFavorite: boolean };

export async function getTemplates(userId: string): Promise<TemplateRow[]> {
  const [rows, favs] = await Promise.all([
    db
      .select()
      .from(cgTemplate)
      .where(or(eq(cgTemplate.status, "active"), eq(cgTemplate.status, "draft")))
      .orderBy(cgTemplate.name),
    db.select({ templateId: cgFavorite.templateId }).from(cgFavorite).where(eq(cgFavorite.userId, userId)),
  ]);
  const favSet = new Set(favs.map((f) => f.templateId));
  return rows.map((r) => ({ ...r, isFavorite: favSet.has(r.id) }));
}

export async function getHistory(limit = 40) {
  return db
    .select({
      id: cgEvent.id,
      action: cgEvent.action,
      label: cgEvent.label,
      detail: cgEvent.detail,
      durationMs: cgEvent.durationMs,
      at: cgEvent.at,
      operatorName: user.name,
    })
    .from(cgEvent)
    .leftJoin(user, eq(user.id, cgEvent.operatorId))
    .orderBy(desc(cgEvent.at))
    .limit(limit);
}

export async function getDataSources() {
  return db.select().from(cgDataSource).orderBy(cgDataSource.name);
}

/**
 * Creates the starter templates. Runs when the table is empty (a fresh
 * install has a usable CG desk immediately) and from "Restore starter
 * templates", which only re-creates the ones whose names are missing.
 */
export async function seedStarterTemplates(userId: string | null, onlyIfEmpty = false) {
  const existing = await db.select({ name: cgTemplate.name }).from(cgTemplate);
  // `onlyIfEmpty` is what the page passes. Without it, deleting or renaming a
  // starter graphic would be undone by the next render re-creating it.
  if (onlyIfEmpty && existing.length > 0) return 0;
  const have = new Set(existing.map((e) => e.name));
  const missing = starterTemplates().filter((t) => !have.has(t.name));
  if (missing.length === 0) return 0;

  // Weather/sports/market starters get a data source so the plate has
  // somewhere to pull from rather than a dead "live data" label.
  const sources = await db.select({ id: cgDataSource.id, kind: cgDataSource.kind }).from(cgDataSource);
  const byKind = new Map<string, { id: string }>(sources.map((s) => [s.kind, { id: s.id }]));
  for (const kind of ["weather", "sports", "market"] as const) {
    if (byKind.has(kind) || !missing.some((m) => m.dataKind === kind)) continue;
    const config: CgDataConfig =
      kind === "weather"
        ? { mode: "open_meteo", lat: 23.8103, lon: 90.4125, place: "ঢাকা", paths: {}, values: {} }
        : { mode: "manual", paths: {}, values: {} };
    const [created] = await db
      .insert(cgDataSource)
      .values({
        name: kind === "weather" ? "Dhaka weather" : kind === "sports" ? "Live match" : "DSE index",
        kind,
        config,
        refreshSec: kind === "weather" ? 300 : 60,
        createdById: userId,
      })
      .returning({ id: cgDataSource.id });
    byKind.set(kind, { id: created.id });
  }

  await db.insert(cgTemplate).values(
    missing.map((t) => ({
      name: t.name,
      type: t.type,
      category: t.category,
      status: "active" as const,
      document: t.document,
      fields: t.fields,
      values: defaultValues(t.fields),
      animationIn: t.animationIn,
      animationOut: t.animationOut,
      animationMs: t.animationMs,
      durationSec: t.durationSec,
      layer: defaultLayerFor(t.type),
      isEmergency: !!t.isEmergency,
      needsCheck: t.type === "breaking",
      dataSourceId: t.dataKind ? byKind.get(t.dataKind)?.id ?? null : null,
      createdById: userId,
    }))
  );
  return missing.length;
}

function defaultLayerFor(type: string) {
  switch (type) {
    case "full_frame":
    case "two_box":
      return 1;
    case "breaking":
      return 3;
    case "credits":
      return 4;
    case "channel_bug":
      return 5;
    default:
      return 2;
  }
}

// ---------------------------------------------------------------------------
// Story → graphic
// ---------------------------------------------------------------------------

const DHAKA = "Asia/Dhaka";

/**
 * Fills a template's fields from a newsroom story. Only the keys in
 * STORY_FIELD_MAP are touched; anything else the operator typed stays.
 */
export async function resolveStoryValues(storyId: string, fields: CgField[], current: CgValues): Promise<CgValues> {
  const [row] = await db
    .select({
      title: story.title,
      subtitle: story.subtitle,
      excerpt: story.excerpt,
      category: story.category,
      featuredImageUrl: story.featuredImageUrl,
      photocardImageUrl: story.photocardImageUrl,
      publishedAt: story.publishedAt,
      createdAt: story.createdAt,
      district: story.district,
      division: story.division,
      guestWriterName: story.guestWriterName,
      guestWriterDesignation: story.guestWriterDesignation,
      writerName: user.name,
    })
    .from(story)
    .leftJoin(user, eq(user.id, story.writerId))
    .where(eq(story.id, storyId))
    .limit(1);
  if (!row) return current;

  const date = new Date(row.publishedAt ?? row.createdAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: DHAKA,
  });
  const from: CgValues = {
    headline: row.title,
    subhead: row.subtitle ?? "",
    quote: row.excerpt ?? "",
    category: row.category,
    reporter: row.guestWriterName || row.writerName || "",
    role: row.guestWriterDesignation || (row.writerName ? "Reporter" : ""),
    location: row.district || row.division || "",
    image: row.featuredImageUrl || row.photocardImageUrl || "",
    date,
    // Common aliases so a hand-built template still fills in.
    name: row.guestWriterName || row.writerName || "",
    time: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: DHAKA }),
  };
  const next: CgValues = { ...current };
  for (const f of fields) if (from[f.key] !== undefined && from[f.key] !== "") next[f.key] = from[f.key];
  return next;
}

// ---------------------------------------------------------------------------
// Live data feeds
// ---------------------------------------------------------------------------

function pick(obj: unknown, path: string): unknown {
  return path
    .split(".")
    .filter(Boolean)
    .reduce<unknown>((acc, key) => {
      if (acc == null) return undefined;
      if (Array.isArray(acc)) {
        const i = Number(key);
        return Number.isInteger(i) ? acc[i] : undefined;
      }
      if (typeof acc === "object") return (acc as Record<string, unknown>)[key];
      return undefined;
    }, obj);
}

function asText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return "";
}

/**
 * Blocks loopback and private targets. The endpoint is admin-supplied, but
 * it's still a server-side fetch, so anything that isn't plainly a public
 * hostname or a public dotted-quad IPv4 is refused — that covers the
 * shorthand forms (`127.1`, `2130706433`, `0x7f.0.0.1`) which all resolve to
 * loopback but don't look like an IP to a naive quad check.
 */
function isBlockedHost(host: string) {
  const h = host.toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return true;
  if (h.includes(":")) return true; // IPv6 literal, including ::1

  const quad = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (quad) {
    const [a, b] = [Number(quad[1]), Number(quad[2])];
    if (quad.slice(1).some((n) => Number(n) > 255)) return true;
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  // Not a full IPv4: it must look like a real public domain. A single label
  // ("metadata", "kubernetes", "redis") is a cluster-internal name, so at
  // least two labels are required, and the last one must be a real TLD —
  // letters, or a punycode TLD such as xn--p1ai.
  const labels = h.split(".");
  if (labels.length < 2 || labels.some((l) => l === "")) return true;
  const tld = labels[labels.length - 1];
  return !(/^[a-z]{2,}$/.test(tld) || /^xn--[a-z0-9-]{2,}$/.test(tld));
}

async function fetchJson(url: string, headerName?: string, headerValue?: string): Promise<unknown> {
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new Error("That isn't a valid URL.");
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") throw new Error("Only http(s) endpoints are supported.");
  if (isBlockedHost(target.hostname)) throw new Error("That host isn't allowed.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(target, {
      cache: "no-store",
      signal: controller.signal,
      // Only the first URL is checked, so a redirect must not be followed —
      // otherwise a public endpoint could bounce us to a metadata service.
      redirect: "manual",
      headers: {
        accept: "application/json",
        ...(headerName && headerValue ? { [headerName]: headerValue } : {}),
      },
    });
    if (res.status >= 300 && res.status < 400) throw new Error("The feed redirects somewhere else — use the final URL.");
    if (!res.ok) throw new Error(`The feed answered ${res.status}.`);
    const text = await res.text();
    if (text.length > 512_000) throw new Error("The feed's response is too large.");
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("The feed didn't return JSON.");
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("The feed timed out.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

async function readOpenMeteo(config: CgDataConfig): Promise<CgValues> {
  const lat = config.lat ?? 23.8103;
  const lon = config.lon ?? 90.4125;
  const url = `${WEATHER_URL}?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation&hourly=precipitation_probability&forecast_days=1&timezone=${encodeURIComponent(DHAKA)}`;
  const json = (await fetchJson(url)) as Record<string, unknown>;
  const current = (json.current ?? {}) as Record<string, unknown>;
  const hourly = (json.hourly ?? {}) as Record<string, unknown>;
  const times = Array.isArray(hourly.time) ? (hourly.time as string[]) : [];
  const probs = Array.isArray(hourly.precipitation_probability) ? (hourly.precipitation_probability as number[]) : [];
  // Open-Meteo returns local hours for the requested timezone; match the hour
  // we're in rather than assuming index 0 is "now".
  // "sv-SE" gives "2026-09-27 10:31"; Open-Meteo gives "2026-09-27T10:00".
  const nowHour = new Date().toLocaleString("sv-SE", { timeZone: DHAKA }).slice(0, 13).replace(" ", "T");
  const idx = times.findIndex((t) => t.slice(0, 13) === nowHour);
  const prob = probs[idx >= 0 ? idx : 0];

  return {
    place: config.place ?? "",
    temp: current.temperature_2m != null ? `${Math.round(Number(current.temperature_2m))}°C` : "",
    humidity: current.relative_humidity_2m != null ? `${Math.round(Number(current.relative_humidity_2m))}%` : "",
    rain: prob != null ? `${Math.round(Number(prob))}%` : "",
    updated: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: DHAKA }),
  };
}

async function readHttp(config: CgDataConfig): Promise<CgValues> {
  if (!config.url) throw new Error("No endpoint is set for this feed.");
  const json = await fetchJson(config.url, config.headerName, config.headerValue);
  const out: CgValues = {};
  for (const [key, path] of Object.entries(config.paths ?? {})) out[key] = asText(pick(json, path));
  if (config.listPath && config.listField) {
    const list = pick(json, config.listPath);
    if (Array.isArray(list)) {
      const tpl = config.rowTemplate || "{name} {value}";
      out[config.listField] = list
        .slice(0, 20)
        .map((row) => tpl.replace(/\{([a-z0-9_.]+)\}/gi, (_m, k: string) => asText(pick(row, k))).trim())
        .filter(Boolean)
        .join("\n");
    }
  }
  out.updated = new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: DHAKA });
  return out;
}

export type DataReadResult = { values: CgValues; error: string | null; stale: boolean; fetchedAt: Date | null };

/**
 * Reads a feed and stores the result. A failure keeps the last good values
 * and reports the error — a plate on air must never blank out or show a
 * broken value, it shows the last number it had and says it's stale.
 */
export async function refreshDataSourceById(id: string): Promise<DataReadResult> {
  const [src] = await db.select().from(cgDataSource).where(eq(cgDataSource.id, id)).limit(1);
  if (!src) return { values: {}, error: "That data feed no longer exists.", stale: true, fetchedAt: null };
  const config = sanitizeDataConfig(src.config);
  const previous = (src.lastValues ?? {}) as CgValues;
  if (!src.isActive) {
    // Paused deliberately (usually because the feed started lying). Hand back
    // the last good values and say so rather than fetching anyway.
    return { values: previous, error: "This feed is paused — showing its last values.", stale: true, fetchedAt: src.lastFetchedAt };
  }

  if (config.mode === "manual") {
    const values = { ...(config.values ?? {}) };
    const now = new Date();
    await db.update(cgDataSource).set({ lastValues: values, lastFetchedAt: now, lastError: null, updatedAt: now }).where(eq(cgDataSource.id, id));
    return { values, error: null, stale: false, fetchedAt: now };
  }

  try {
    const values = config.mode === "open_meteo" ? await readOpenMeteo(config) : await readHttp(config);
    const now = new Date();
    await db.update(cgDataSource).set({ lastValues: values, lastFetchedAt: now, lastError: null, updatedAt: now }).where(eq(cgDataSource.id, id));
    return { values, error: null, stale: false, fetchedAt: now };
  } catch (e) {
    const message = e instanceof Error ? e.message : "The feed couldn't be read.";
    await db.update(cgDataSource).set({ lastError: message, updatedAt: new Date() }).where(eq(cgDataSource.id, id));
    return { values: previous, error: message, stale: true, fetchedAt: src.lastFetchedAt };
  }
}

/** Merges a feed's latest values into a template's fields. */
export function mergeDataValues(fields: CgField[], current: CgValues, data: CgValues): CgValues {
  const next = { ...current };
  for (const f of fields) if (data[f.key] !== undefined && data[f.key] !== "") next[f.key] = data[f.key];
  return next;
}
