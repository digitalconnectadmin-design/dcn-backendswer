import { and, eq, ne, type SQL } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { slugify } from "@/lib/slug";

/**
 * What's left of `lib/content-actions.ts` once the auth guard moved to
 * `lib/api/guard.ts` and the FormData helpers moved to `lib/api/body.ts`:
 * the database utilities the services share.
 */

/**
 * Slugs are unique per table, so a collision has to be resolved rather than
 * left to throw a raw Postgres constraint error at the editor. Appends -2, -3…
 * until the slug is free, skipping the row being edited on update.
 *
 * Unchanged from the monolith.
 */
export async function uniqueSlug(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  slugColumn: SQL.Aliased | unknown,
  desired: string,
  excludeId?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  idColumn?: any
): Promise<string> {
  const base = slugify(desired) || "untitled";
  let candidate = base;

  for (let i = 2; i < 100; i++) {
    const where =
      excludeId && idColumn
        ? and(eq(slugColumn as never, candidate), ne(idColumn, excludeId))
        : eq(slugColumn as never, candidate);

    const existing = await db.select({ n: idColumn }).from(table).where(where).limit(1);
    if (existing.length === 0) return candidate;
    candidate = `${base}-${i}`;
  }
  return `${base}-${Date.now()}`;
}

/**
 * Standard paginated-list envelope, matching the shape the admin tables
 * already expect (`rows`, `total`, `page`, `perPage`, `totalPages`, `from`,
 * `to`, `perPageOptions`) so the list components port without touching their
 * pagination rendering.
 */
export type Paged<T> = {
  rows: T[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  from: number;
  to: number;
  perPageOptions: number[];
};

export function paged<T>(
  rows: T[],
  total: number,
  page: number,
  perPage: number,
  perPageOptions: number[]
): Paged<T> {
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  return {
    rows,
    total,
    page,
    perPage,
    totalPages,
    from: total === 0 ? 0 : (page - 1) * perPage + 1,
    to: Math.min(page * perPage, total),
    perPageOptions,
  };
}

/** Clamps a page/perPage pair coming off a query string. */
export function readPaging(
  page: number,
  perPage: number,
  options: number[]
): { page: number; perPage: number } {
  return {
    page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
    perPage: options.includes(perPage) ? perPage : options[0],
  };
}
