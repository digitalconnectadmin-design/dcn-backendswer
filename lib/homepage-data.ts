import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import { db } from "@/db/drizzle";
import {
  category,
  homepageLayout,
  media,
  photoGallery,
  photoGalleryImage,
  poll,
  reel,
  story,
  videoGallery,
  videoGalleryItem,
} from "@/db/schema";
import { defaultSections, sanitizeSections, STORY_KINDS, type HomeSection } from "@/lib/homepage";
import { withAttachedImages } from "@/lib/story-image-server";
import { derivedThumbnail } from "@/lib/video-embed";
// Was `@/app/(cms)/admin/polls/actions` in the monolith — a public-site
// module reaching into a CMS action file. See lib/services/polls.ts.
import { getPollResults } from "@/lib/services/polls";

/**
 * Turns a homepage layout (list of sections) into everything the public
 * homepage needs to render it. Used by the live homepage (published
 * layout) and the builder's preview (draft layout) — the same code, so the
 * preview can't drift from what will go live.
 */

export type StoryRow = typeof story.$inferSelect & { attachedImageUrl: string | null };

export async function getHomepageSections(which: "draft" | "published") {
  const rows = await db.select().from(homepageLayout).where(inArray(homepageLayout.key, ["draft", "published"]));
  const published = rows.find((r) => r.key === "published");
  const draft = rows.find((r) => r.key === "draft");
  // A draft that doesn't exist yet starts as a copy of what's live.
  const chosen = which === "draft" ? draft ?? published : published;
  return {
    sections: chosen ? sanitizeSections(chosen.sections) : defaultSections(),
    publishedAt: published?.publishedAt ?? null,
    publishedById: published?.publishedById ?? null,
    draftUpdatedAt: draft?.updatedAt ?? null,
    hasPublished: !!published,
  };
}

export type ResolvedStorySection = {
  section: HomeSection;
  stories: StoryRow[];
  /** "View all" target for category sections. */
  href: string | null;
};

export type ResolvedSection =
  | ({ type: "stories" } & ResolvedStorySection)
  | { type: "photo_stories"; section: HomeSection; galleries: PhotoStoryCard[] }
  | { type: "videos"; section: HomeSection; videoSets: VideoSetCard[]; reels: ReelCard[] }
  | { type: "poll"; section: HomeSection; poll: PollBlock | null };

export type PhotoStoryCard = { id: string; title: string; slug: string; cover: string | null; images: number };
export type VideoSetCard = {
  id: string;
  title: string;
  slug: string;
  excerpt: string | null;
  videos: number;
  thumbnail: string | null;
  previewVideoUrl: string | null;
};
export type ReelCard = { id: string; caption: string; videoUrl: string; thumbnailUrl: string | null };
export type PollBlock = { id: string; slug: string; question: string; results: { optionId: string; label: string; votes: number }[] };

const published = eq(story.status, "published");

/** Stories that a section could show, newest-first within the section's own ordering. */
async function candidatesFor(
  section: HomeSection,
  categories: Map<string, { id: string; name: string; slug: string }>,
  extra: number
) {
  const limit = section.count + extra;
  const now = Date.now();
  switch (section.kind) {
    case "featured":
      // Stories ticked "Lead news" in the article desk (in the last three
      // days) lead the featured section, then everything by recency.
      return db
        .select()
        .from(story)
        .where(published)
        .orderBy(
          // ISO string + explicit cast: a raw Date inside sql`` bypasses the
          // column's own mapping and would be serialised in the server's zone.
          desc(sql`(${story.isLeadNews} and ${story.publishedAt} > ${new Date(now - 72 * 3600_000).toISOString()}::timestamp)`),
          desc(story.publishedAt)
        )
        .limit(limit);
    case "latest":
      return db.select().from(story).where(published).orderBy(desc(story.publishedAt)).limit(limit);
    case "category": {
      const cat = section.categoryId ? categories.get(section.categoryId) : undefined;
      if (!cat) return [];
      return db
        .select()
        .from(story)
        .where(
          and(published, or(eq(story.categoryId, cat.id), and(isNull(story.categoryId), eq(story.category, cat.name))))
        )
        .orderBy(desc(story.publishedAt))
        .limit(limit);
    }
    case "most_read": {
      const recent = await db
        .select()
        .from(story)
        .where(and(published, gt(story.publishedAt, new Date(now - 7 * 24 * 3600_000)), gt(story.viewCount, 0)))
        .orderBy(desc(story.viewCount), desc(story.publishedAt))
        .limit(limit);
      if (recent.length >= section.count) return recent;
      // A quiet week: top up with the all-time most read.
      const allTime = await db
        .select()
        .from(story)
        .where(and(published, gt(story.viewCount, 0)))
        .orderBy(desc(story.viewCount))
        .limit(limit);
      const seen = new Set(recent.map((r) => r.id));
      return [...recent, ...allTime.filter((r) => !seen.has(r.id))];
    }
    default:
      return [];
  }
}

async function loadPhotoStories(): Promise<PhotoStoryCard[]> {
  const galleries = await db
    .select({ id: photoGallery.id, title: photoGallery.title, slug: photoGallery.slug, coverMediaId: photoGallery.coverMediaId })
    .from(photoGallery)
    .where(eq(photoGallery.status, "published"))
    .orderBy(desc(photoGallery.publishedAt))
    .limit(3);
  const ids = galleries.map((g) => g.id);
  // Second flat query instead of a correlated subquery — see the Drizzle
  // "unqualified columns" note in CLAUDE.md.
  const images = ids.length
    ? await db
        .select({ galleryId: photoGalleryImage.galleryId, url: media.url, mediaId: media.id })
        .from(photoGalleryImage)
        .innerJoin(media, eq(photoGalleryImage.mediaId, media.id))
        .where(inArray(photoGalleryImage.galleryId, ids))
        .orderBy(asc(photoGalleryImage.position))
    : [];
  return galleries.map((g) => {
    const mine = images.filter((i) => i.galleryId === g.id);
    const explicit = g.coverMediaId ? mine.find((i) => i.mediaId === g.coverMediaId)?.url : undefined;
    return { id: g.id, title: g.title, slug: g.slug, cover: explicit ?? mine[0]?.url ?? null, images: mine.length };
  });
}

async function loadVideos(): Promise<{ videoSets: VideoSetCard[]; reels: ReelCard[] }> {
  const [sets, reels] = await Promise.all([
    db
      .select({
        id: videoGallery.id,
        title: videoGallery.title,
        slug: videoGallery.slug,
        excerpt: videoGallery.excerpt,
        coverMediaId: videoGallery.coverMediaId,
      })
      .from(videoGallery)
      .where(eq(videoGallery.status, "published"))
      .orderBy(desc(videoGallery.publishedAt))
      .limit(3),
    db
      .select({ id: reel.id, caption: reel.caption, videoUrl: reel.videoUrl, thumbnailUrl: reel.thumbnailUrl })
      .from(reel)
      .where(eq(reel.status, "published"))
      .orderBy(desc(reel.publishedAt))
      .limit(6),
  ]);
  const ids = sets.map((v) => v.id);
  const items = ids.length
    ? await db
        .select({
          galleryId: videoGalleryItem.galleryId,
          source: videoGalleryItem.source,
          externalUrl: videoGalleryItem.externalUrl,
          mediaId: videoGalleryItem.mediaId,
          thumbnailMediaId: videoGalleryItem.thumbnailMediaId,
        })
        .from(videoGalleryItem)
        .where(inArray(videoGalleryItem.galleryId, ids))
        .orderBy(asc(videoGalleryItem.position))
    : [];
  const mediaIds = [...sets.map((v) => v.coverMediaId), ...items.flatMap((i) => [i.mediaId, i.thumbnailMediaId])].filter(
    (id): id is string => !!id
  );
  const mediaRows = mediaIds.length
    ? await db.select({ id: media.id, url: media.url }).from(media).where(inArray(media.id, mediaIds))
    : [];
  const url = (id: string | null) => mediaRows.find((m) => m.id === id)?.url ?? null;

  const videoSets = sets.map((v) => {
    const mine = items.filter((i) => i.galleryId === v.id);
    const first = mine[0];
    const cover = url(v.coverMediaId);
    const itemThumb = first
      ? url(first.thumbnailMediaId) ?? (first.source === "youtube" ? derivedThumbnail("youtube", first.externalUrl) : null)
      : null;
    return {
      id: v.id,
      title: v.title,
      slug: v.slug,
      excerpt: v.excerpt,
      videos: mine.length,
      thumbnail: cover ?? itemThumb,
      previewVideoUrl: !cover && !itemThumb && first?.source === "upload" ? url(first.mediaId) : null,
    };
  });
  return { videoSets, reels };
}

async function loadPoll(): Promise<PollBlock | null> {
  const [live] = await db
    .select({ id: poll.id, slug: poll.slug, question: poll.question })
    .from(poll)
    .where(and(eq(poll.status, "published"), sql`(${poll.closesAt} is null or ${poll.closesAt} > now())`))
    .orderBy(desc(poll.publishedAt))
    .limit(1);
  if (!live) return null;
  const results = await getPollResults(live.id);
  return { ...live, results };
}

/**
 * Resolves every visible section. Story sections are fetched in parallel
 * (each over-fetches a little), then de-duplicated in page order so a story
 * shown higher up isn't repeated lower down — except where an editor pinned
 * it on purpose.
 */
export async function buildHomepage(sections: HomeSection[]): Promise<ResolvedSection[]> {
  const visible = sections.filter((s) => s.visible);
  const categoryRows = await db
    .select({ id: category.id, name: category.name, slug: category.slug })
    .from(category)
    .where(and(eq(category.status, "published"), eq(category.permission, "public")));
  const categories = new Map<string, { id: string; name: string; slug: string }>(categoryRows.map((c) => [c.id, c]));

  const storySections = visible.filter((s) => STORY_KINDS.includes(s.kind));
  const extra = Math.min(60, storySections.reduce((n, s) => n + s.count, 0));
  const pinnedIds = Array.from(new Set(storySections.flatMap((s) => s.pinned)));

  const needs = new Set(visible.map((s) => s.kind));
  const [candidateLists, pinnedRows, photoStories, videos, pollBlock] = await Promise.all([
    Promise.all(storySections.map((s) => candidatesFor(s, categories, extra))),
    pinnedIds.length ? db.select().from(story).where(and(published, inArray(story.id, pinnedIds))) : Promise.resolve([]),
    needs.has("photo_stories") ? loadPhotoStories() : Promise.resolve([]),
    needs.has("videos") ? loadVideos() : Promise.resolve({ videoSets: [], reels: [] }),
    needs.has("poll") ? loadPoll() : Promise.resolve(null),
  ]);

  // One batched lookup for fallback images across every story on the page.
  const allRows = [...pinnedRows, ...candidateLists.flat()];
  const withImages = await withAttachedImages(Array.from(new Map(allRows.map((r) => [r.id, r])).values()));
  const byId = new Map(withImages.map((r) => [r.id, r]));

  const used = new Set<string>();
  const out: ResolvedSection[] = [];
  let storyIndex = 0;
  for (const section of visible) {
    if (STORY_KINDS.includes(section.kind)) {
      const candidates = candidateLists[storyIndex++];
      const chosen: StoryRow[] = [];
      for (const id of section.pinned) {
        const row = byId.get(id);
        if (row && !chosen.some((c) => c.id === id)) chosen.push(row);
        if (chosen.length >= section.count) break;
      }
      for (const c of candidates) {
        if (chosen.length >= section.count) break;
        if (used.has(c.id) || chosen.some((x) => x.id === c.id)) continue;
        const row = byId.get(c.id);
        if (row) chosen.push(row);
      }
      chosen.forEach((c) => used.add(c.id));
      const cat = section.kind === "category" && section.categoryId ? categories.get(section.categoryId) : undefined;
      out.push({
        type: "stories",
        section,
        stories: chosen,
        href: cat ? `/category/${cat.slug}` : null,
      });
    } else if (section.kind === "photo_stories") {
      out.push({ type: "photo_stories", section, galleries: photoStories });
    } else if (section.kind === "videos") {
      out.push({ type: "videos", section, ...videos });
    } else if (section.kind === "poll") {
      out.push({ type: "poll", section, poll: pollBlock });
    }
  }
  return out;
}
