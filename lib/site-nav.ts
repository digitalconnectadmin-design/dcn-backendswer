import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db/drizzle";
import { category, page } from "@/db/schema";

/** Fixed sections of the public site. */
export const SITE_SECTIONS = [
  { label: "সর্বশেষ", href: "/" },
  { label: "ফটোস্টোরি", href: "/photo-stories" },
  { label: "ভিডিও", href: "/videos" },
] as const;

/**
 * Published pages the editor flagged for the nav. Shared by the header and
 * footer so a page can't appear in one and not the other.
 */
export async function getFooterPages() {
  const rows = await db
    .select({ title: page.title, slug: page.slug })
    .from(page)
    .where(and(eq(page.status, "published"), eq(page.showInFooter, true)))
    .orderBy(asc(page.title));

  return rows.map((r) => ({ label: r.title, href: `/page/${r.slug}` }));
}

/**
 * Managed categories for the public nav and footer section list.
 *
 * Filtered to published + public: a draft category shouldn't appear before
 * an editor finishes setting it up, and "admin" permission marks an internal
 * desk section (e.g. a wire-copy holding bin) that was never meant to be
 * reader-facing in the first place.
 */
export async function getNavCategories() {
  const rows = await db
    .select({ name: category.name, slug: category.slug })
    .from(category)
    .where(and(eq(category.status, "published"), eq(category.permission, "public")))
    .orderBy(asc(category.position), asc(category.name));

  return rows.map((r) => ({ label: r.name, href: `/category/${r.slug}` }));
}

export type NavTree = {
  label: string;
  href: string;
  children: { label: string; href: string }[];
};

/**
 * Top-level categories with their sub-categories nested underneath, so the
 * header can render a caret and a dropdown only where children actually
 * exist — a caret on an empty menu is worse than no caret.
 */
export async function getCategoryTree(): Promise<NavTree[]> {
  const rows = await db
    .select({
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentId: category.parentId,
    })
    .from(category)
    .where(and(eq(category.status, "published"), eq(category.permission, "public")))
    .orderBy(asc(category.position), asc(category.name));

  const parents = rows.filter((r) => r.parentId === null);

  return parents.map((p) => ({
    label: p.name,
    href: `/category/${p.slug}`,
    children: rows
      .filter((r) => r.parentId === p.id)
      .map((c) => ({ label: c.name, href: `/category/${c.slug}` })),
  }));
}

/*
 * The Bangla date helpers moved to `lib/bangla-date.ts`, which imports no
 * database, and are re-exported here so every existing caller keeps working.
 */
export { toBanglaDigits, banglaDate, banglaShortDate } from "@/lib/bangla-date";
