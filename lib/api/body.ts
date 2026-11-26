import { HttpError } from "@/lib/api/http";

/**
 * Request-body reading, shaped to make porting the 292 server actions as
 * mechanical as possible.
 *
 * Every action took a `FormData` and pulled values out of it with the helpers
 * in `lib/content-actions.ts`: `str(form, key)`, `optionalStr`, `bool`,
 * `parseDoc`. Those helpers are reproduced here with the same names and the
 * same signatures, over a `Fields` bag instead of `FormData`.
 *
 * So porting an action body is usually:
 *
 *   -  const name = str(formData, "name");
 *   +  const name = str(fields, "name");
 *
 * and the rest of the function is untouched. `Fields` is built from either a
 * JSON object or a real multipart form, so the frontend can send whichever is
 * convenient — JSON from a client component, `FormData` from a plain `<form>`
 * that still posts directly.
 */

export type Fields = {
  get(key: string): string | null;
  /** Raw value, for arrays and nested objects a form can't express. */
  raw(key: string): unknown;
  has(key: string): boolean;
  keys(): string[];
};

function fieldsFromRecord(record: Record<string, unknown>): Fields {
  return {
    get(key) {
      const v = record[key];
      if (v === null || v === undefined) return null;
      if (typeof v === "string") return v;
      if (typeof v === "number" || typeof v === "boolean") return String(v);
      // Objects/arrays are returned as JSON so `parseDoc` can read a Tiptap
      // document that arrived as a real object rather than a string.
      return JSON.stringify(v);
    },
    raw: (key) => record[key],
    has: (key) => key in record,
    keys: () => Object.keys(record),
  };
}

/**
 * Parses the request body into a `Fields` bag.
 *
 * Accepts `application/json` and `multipart/form-data` /
 * `application/x-www-form-urlencoded`. An empty body is an empty bag rather
 * than an error, so a POST that only needs its path parameters works without
 * the caller having to send `{}`.
 */
export async function readFields(request: Request): Promise<Fields> {
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();

  if (type === "application/json") {
    const text = await request.text();
    if (!text) return fieldsFromRecord({});
    try {
      const parsed = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new HttpError(400, "Request body must be a JSON object.");
      }
      return fieldsFromRecord(parsed as Record<string, unknown>);
    } catch (e) {
      if (e instanceof HttpError) throw e;
      throw new HttpError(400, "Request body isn't valid JSON.");
    }
  }

  if (type === "multipart/form-data" || type === "application/x-www-form-urlencoded") {
    const form = await request.formData();
    const record: Record<string, unknown> = {};
    for (const [key, value] of form.entries()) {
      // Repeated keys collapse into an array, matching `formData.getAll`.
      if (key in record) {
        const existing = record[key];
        record[key] = Array.isArray(existing) ? [...existing, value] : [existing, value];
      } else {
        record[key] = value;
      }
    }
    return fieldsFromRecord(record);
  }

  return fieldsFromRecord({});
}

/* ------------------------------------------------------------------------- *
 * The lib/content-actions.ts helpers, unchanged in behaviour.
 * ------------------------------------------------------------------------- */

export function str(f: Fields, key: string): string {
  const v = f.get(key);
  return typeof v === "string" ? v.trim() : "";
}

export function optionalStr(f: Fields, key: string): string | null {
  const v = str(f, key);
  return v === "" ? null : v;
}

export function bool(f: Fields, key: string): boolean {
  const raw = f.raw(key);
  if (typeof raw === "boolean") return raw;
  const v = f.get(key);
  // "on" is what an HTML checkbox sends; "true" is what JSON sends.
  return v === "on" || v === "true";
}

export function num(f: Fields, key: string, fallback: number): number {
  const v = Number(f.get(key));
  return Number.isFinite(v) ? v : fallback;
}

/** Parses the JSON produced by the Tiptap editor, falling back to an empty doc. */
export function parseDoc(f: Fields, key: string): unknown {
  const raw = f.raw(key);
  // Already an object (JSON request) — validate and pass through.
  if (raw && typeof raw === "object" && (raw as { type?: string }).type === "doc") {
    return raw;
  }
  const text = str(f, key);
  if (!text) return { type: "doc", content: [] };
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && parsed.type === "doc") return parsed;
  } catch {
    // fall through
  }
  return { type: "doc", content: [] };
}

/** A list of strings, from a JSON array or repeated form fields. */
export function strList(f: Fields, key: string): string[] {
  const raw = f.raw(key);
  if (Array.isArray(raw)) return raw.map((v) => String(v).trim()).filter(Boolean);
  const single = optionalStr(f, key);
  return single ? [single] : [];
}

/* ------------------------------------------------------------------------- *
 * Query-string reading, for list endpoints.
 * ------------------------------------------------------------------------- */

export function query(request: Request) {
  const sp = new URL(request.url).searchParams;
  return {
    str: (key: string, fallback = "") => sp.get(key)?.trim() || fallback,
    num: (key: string, fallback: number) => {
      const v = Number(sp.get(key));
      return Number.isFinite(v) ? v : fallback;
    },
    bool: (key: string) => sp.get(key) === "true" || sp.get(key) === "1",
    all: sp,
  };
}
