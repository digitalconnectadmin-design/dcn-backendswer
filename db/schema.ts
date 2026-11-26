import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  integer,
  doublePrecision,
  jsonb,
  uniqueIndex,
  index,
  primaryKey,
  pgEnum,
} from "drizzle-orm/pg-core";

import {
  defaultPhotocardDocument,
  type PhotocardDocument,
} from "@/lib/photocard";
import type { StoryRevisionSnapshot, QcChecklist } from "@/lib/pipeline";
import type { SocialMediaItem, SocialPostOptions } from "@/lib/social/content";
import type { HomeSection } from "@/lib/homepage";
import type { CgDataConfig, CgDocument, CgDraftMeta, CgField, CgValues } from "@/lib/cg";
import type { ParticipantRole, ParticipantState, SourceKind } from "@/lib/studio";

// Roles available inside the newsroom CMS. More granular per-desk permissions
// (assignments, publishing rights, etc.) will layer on top of this later.
export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "chief_editor",
  "news_editor",
  "reporter",
  "digital_executive",
  "graphics",
]);

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified")
    .$defaultFn(() => false)
    .notNull(),
  image: text("image"),
  role: userRoleEnum("role").default("reporter").notNull(),
  // Set when an admin creates the account with a generated temporary
  // password. The (cms) layout redirects anyone carrying this flag to the
  // change-password screen and refuses to render the admin area until it's
  // cleared, so a shared temporary credential can't stay in use.
  mustChangePassword: boolean("must_change_password").default(false).notNull(),
  // Added by the better-auth admin plugin — a banned user's sessions are
  // revoked and further sign-ins rejected automatically.
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: timestamp("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // Set while an admin is impersonating this session (admin plugin).
  impersonatedBy: text("impersonated_by"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at"),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()),
});

// ---------------------------------------------------------------------------
// Editorial content
// ---------------------------------------------------------------------------

export const contentStatusEnum = pgEnum("content_status", [
  "draft",
  "in_review",
  "qc",
  "published",
]);

// See lib/pipeline.ts for what each value means and how they relate —
// these mirror its PIPELINE_STAGES / PIPELINE_STATUSES / PRIORITIES /
// STORY_TYPES arrays exactly; keep the two in sync if either changes.
export const storyStageEnum = pgEnum("story_stage", [
  "assignment",
  "draft",
  "nm_desk",
  "qc",
  "publish",
]);

export const storyWorkflowStatusEnum = pgEnum("story_workflow_status", [
  "assigned",
  "draft",
  "submitted",
  // The desk is working on it — headline, tags, placement.
  "under_review",
  "changes_requested",
  // The desk has finished and the story is ready to leave for QC. Distinct
  // from `approved`, which means QC has signed it off and it may be published.
  "ready",
  // Editorial hold. Its own status rather than a flag beside another one:
  // a held story must not also read as "ready", and the desk needs to list
  // holds as their own queue.
  "held",
  "in_qc",
  "approved",
  "scheduled",
  "published",
  "rejected",
  "archived",
]);

/**
 * Where a story sits on the front page by the desk's reckoning. The lead slot
 * is single — see `setPlacement` in the desk's actions, which demotes the
 * current holder in the same write.
 */
export const storyPlacementEnum = pgEnum("story_placement", ["normal", "lead", "second_lead"]);

export const storyPriorityEnum = pgEnum("story_priority", [
  "low",
  "normal",
  "high",
  "urgent",
  "breaking",
]);

export const storyTypeEnum = pgEnum("story_type", [
  "news",
  "feature",
  "opinion",
  "investigation",
  "interview",
  "analysis",
]);

export const story = pgTable(
  "story",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    // `body` keeps the plain-text version: existing rows already hold it, and
    // it stays useful for search and excerpt generation. `bodyJson` holds the
    // Tiptap document written by the rich editor. Renderers prefer bodyJson and
    // fall back to body, so nothing published before the editor existed breaks.
    body: text("body").notNull(),
    bodyJson: jsonb("body_json"),
    featuredImageUrl: text("featured_image_url"),
    // `category` holds the display name and stays NOT NULL so existing rows and
    // every read path keep working untouched. `categoryId` is the real relation,
    // written alongside it whenever a category is picked. Reads use `category`;
    // the id is there for filtering and for category pages.
    category: text("category").notNull(),
    categoryId: text("category_id").references((): AnyPgColumn => category.id, {
      onDelete: "set null",
    }),
    subtitle: text("subtitle"),
    // Free-form topics. A Postgres text[] rather than a join table: tags are
    // only ever read back with the story and filtered with @>, so a join adds
    // a table and two queries for no gain.
    tags: text("tags").array().default([]).notNull(),
    youtubeUrl: text("youtube_url"),
    attachmentUrl: text("attachment_url"),
    imageCaption: text("image_caption"),
    // Photographer / agency credit shown under the featured image.
    imageCredit: text("image_credit"),
    // Counted on each public story view (see app/(home)/story/[slug]); drives
    // the homepage "Most read" section. A plain counter — no per-visitor
    // dedupe, so treat it as a popularity signal, not audited analytics.
    viewCount: integer("view_count").default(0).notNull(),
    // The template applied to featuredImageUrl to produce photocardImageUrl,
    // if any. Set null on delete rather than blocking it — a story keeps its
    // already-generated photocard even if the template is later removed.
    photocardTemplateId: text("photocard_template_id").references(
      (): AnyPgColumn => photocardTemplate.id,
      { onDelete: "set null" }
    ),
    // The flattened photo + frame + headline image, generated client-side and
    // uploaded like any other asset. Separate from featuredImageUrl so the
    // plain photo is never overwritten by the composed graphic.
    photocardImageUrl: text("photocard_image_url"),
    // Placement flags driving the ticker, lead slot and spotlight rail.
    isNewsTicker: boolean("is_news_ticker").default(false).notNull(),
    isLeadNews: boolean("is_lead_news").default(false).notNull(),
    isSpotlight: boolean("is_spotlight").default(false).notNull(),
    // Dateline. Free text rather than FKs to a geo table — the desk needs to
    // file from places a fixed list won't always cover.
    division: text("division"),
    district: text("district"),
    upazila: text("upazila"),
    // Bylines for contributors who don't have a newsroom account.
    guestWriterName: text("guest_writer_name"),
    guestWriterDesignation: text("guest_writer_designation"),
    writerId: text("writer_id").references((): AnyPgColumn => user.id, {
      onDelete: "set null",
    }),
    status: contentStatusEnum("status").default("draft").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    publishedAt: timestamp("published_at"),

    // --- Story Pipeline (`/admin/pipeline`) ---
    // Null for every story authored the classic way, through /admin/stories
    // directly — only a story created with "+ New Story" in the pipeline
    // carries a stage, so the two authoring paths can coexist without the
    // pipeline board ever showing a story nobody assigned through it.
    //
    // `pipelineStage` is which of the five board columns a card sits in.
    // It's deliberately not derived from `status`: Assignment and Draft &
    // Submit are both `status: draft`, so status alone can't tell them apart.
    // `pipelineStatus` is the fine-grained badge (see lib/pipeline.ts) shown
    // on the story itself — several statuses can share one stage (both
    // "submitted" and "changes_requested" sit in Draft & Submit).
    //
    // `status` itself is still written on every pipeline transition (draft
    // through nm_desk/qc, published on publish) — this is the first workflow
    // that actually moves a story through `in_review`/`qc`, which the column
    // comment above has said were "modeled but no workflow moves a story
    // through them yet" since the original schema. That's now true only for
    // pipeline stories; classic stories still go straight draft -> published.
    pipelineStage: storyStageEnum("pipeline_stage"),
    pipelineStatus: storyWorkflowStatusEnum("pipeline_status"),
    priority: storyPriorityEnum("priority").default("normal").notNull(),
    storyType: storyTypeEnum("story_type").default("news").notNull(),
    deadline: timestamp("deadline"),
    // Initial assignment brief from the desk — separate from the article body,
    // which the reporter writes; this is what they were asked to do.
    instructions: text("instructions"),
    // The reporter/editor overseeing this story at the NM Desk stage. Distinct
    // from `writerId` (the byline) — an editor can be assigned without being
    // credited, and vice versa for a guest byline.
    assignedEditorId: text("assigned_editor_id").references(
      (): AnyPgColumn => user.id,
      { onDelete: "set null" }
    ),
    assignedById: text("assigned_by_id").references((): AnyPgColumn => user.id, {
      onDelete: "set null",
    }),
    assignedAt: timestamp("assigned_at"),
    // The story pitch this assignment was created from, when it came out of the
    // pitch desk's "Approve & Assign" rather than being typed straight into the
    // pipeline. Carried so the pipeline can show where the idea came from and so
    // the pitch and its story can be reconciled in either direction — the pitch
    // row also holds `storyId`, which is the same link read the other way.
    // `set null` rather than cascade: deleting a pitch must never delete a story
    // that is already being reported.
    pitchId: text("pitch_id").references((): AnyPgColumn => storyPitch.id, {
      onDelete: "set null",
    }),
    lastSavedAt: timestamp("last_saved_at"),
    // When the reporter first sent it to the desk. `updatedAt` moves on every
    // edit, so it can't answer "how long has this been waiting?".
    submittedAt: timestamp("submitted_at"),

    // --- News Management Desk (`/admin/nm-desk`) ---
    // Editorial placement. `isLeadNews` above is the flag the public front page
    // reads and is kept in step with this, so the desk and the site cannot
    // disagree about which story is the lead.
    deskPlacement: storyPlacementEnum("desk_placement").default("normal").notNull(),
    // Set together when a story goes on editorial hold, cleared together when
    // the hold is released.
    holdReason: text("hold_reason"),
    heldById: text("held_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    heldAt: timestamp("held_at"),
    /**
     * Sample stories created by the desk's Demo data toggle.
     *
     * A demo row in this table is riskier than one in any other, because this
     * table feeds the public website. Two things keep it off the site: it is
     * seeded with `status: "draft"`, which every public query already filters
     * out, and every publish path refuses a row carrying this flag.
     */
    isDemo: boolean("is_demo").default(false).notNull(),
    qcChecklist: jsonb("qc_checklist").$type<QcChecklist>(),
    // Set when an editor schedules rather than publishes immediately. `status`
    // stays "draft" (so the story is not publicly visible) until either the
    // publish cron promotes it or an editor publishes it by hand.
    scheduledFor: timestamp("scheduled_for"),
    // Which configured social connections a scheduled publish should fan out
    // to, chosen in the Publish modal's destination picker. Null means "every
    // active connection at publish time" (the default, and the only behaviour
    // for an immediate publish, which enqueues before this would ever be read).
    publishConnectionIds: text("publish_connection_ids").array(),

    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    /**
     * One assignment per pitch, enforced by the database rather than by a
     * read-then-insert in the action — two editors clicking "Approve & assign"
     * on the same pitch at the same moment would both see `storyId` still null
     * and both insert. Postgres allows any number of NULLs in a unique index,
     * so stories that came from nowhere near the pitch desk are unaffected.
     */
    uniqueIndex("story_pitch_unique_idx").on(t.pitchId),
  ]
);

// Short-form video, kept separate from `story` since reels carry different
// fields (no body copy, a video/thumbnail pair instead of a featured image)
// and post to a different set of platforms.
export const reel = pgTable("reel", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  caption: text("caption").notNull(),
  // External URL for now — an upload/hosting pipeline for raw video files
  // is a separate piece of work this table doesn't yet depend on.
  videoUrl: text("video_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  status: contentStatusEnum("status").default("draft").notNull(),
  authorId: text("author_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// ---------------------------------------------------------------------------
// Social publishing
// ---------------------------------------------------------------------------

export const socialPlatformEnum = pgEnum("social_platform", [
  "facebook",
  "instagram",
  "youtube",
  "x",
  "linkedin",
  "tiktok",
]);

// New values are appended (never reordered) so `drizzle-kit push` can add
// them with ALTER TYPE ... ADD VALUE without touching existing rows.
//   scheduled  — waiting for its own `scheduledFor`, picked up by the cron
//   publishing — claimed by a runner right now (the claim is what stops the
//                cron and an in-request run from posting the same row twice)
//   cancelled  — a scheduled post someone withdrew before it went out
export const socialPostStatusEnum = pgEnum("social_post_status", [
  "queued",
  "posted",
  "failed",
  "scheduled",
  "publishing",
  "cancelled",
]);

// Where on the platform a post lands. See lib/social/content.ts — a Reel,
// a Story and a feed Post are separate API endpoints and are never inferred
// from one another.
export const socialContentTypeEnum = pgEnum("social_content_type", [
  "post",
  "reel",
  "story",
  "video",
  "short",
]);

// One row per connected destination (a Facebook Page, an X account, etc).
// Access tokens are stored as-is for now; swap in an encrypted column
// (e.g. pgcrypto or app-level encryption) before handling real credentials.
export const socialConnection = pgTable("social_connection", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  platform: socialPlatformEnum("platform").notNull(),
  label: text("label").notNull(),
  externalAccountId: text("external_account_id").notNull(),
  accessToken: text("access_token").notNull(),
  // Some platforms (X) issue short-lived access tokens alongside a
  // longer-lived refresh token — null for platforms whose tokens don't
  // expire (Facebook/Instagram long-lived Page tokens).
  refreshToken: text("refresh_token"),
  tokenExpiresAt: timestamp("token_expires_at"),
  isActive: boolean("is_active")
    .$defaultFn(() => true)
    .notNull(),
  connectedById: text("connected_by_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),

  // --- Social publishing center ---
  // Every column below is nullable or has a real database default, so
  // `drizzle-kit push` can add them to a table that already has rows.
  //
  // Profile details shown on the account card. Fetched from the platform at
  // connect time and on "Check connection"; any of them may stay null where
  // a platform doesn't expose it to this app's scopes (TikTok followers,
  // LinkedIn followers for a personal profile).
  username: text("username"),
  avatarUrl: text("avatar_url"),
  followerCount: integer("follower_count"),
  accountType: text("account_type"),
  // Set when a publish or a health check fails because of the token or a
  // missing permission — the account card shows "Action required" and a
  // Reconnect button. Cleared by the next successful post or check.
  needsAttention: boolean("needs_attention").default(false).notNull(),
  healthMessage: text("health_message"),
  lastCheckedAt: timestamp("last_checked_at"),
  lastPostedAt: timestamp("last_posted_at"),
  deactivatedAt: timestamp("deactivated_at"),
  deactivatedById: text("deactivated_by_id").references((): AnyPgColumn => user.id, {
    onDelete: "set null",
  }),
  updatedAt: timestamp("updated_at"),
});

/**
 * One composer submission — "publish this story to these 5 accounts" — so
 * the result screen and history can group per-account attempts under the
 * thing the editor actually did. Legacy `social_post` rows written before
 * this existed have no publication and are grouped by story/reel instead.
 */
export const socialPublication = pgTable("social_publication", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  sourceKind: text("source_kind").$type<"story" | "reel" | "custom">().notNull(),
  storyId: text("story_id").references((): AnyPgColumn => story.id, { onDelete: "set null" }),
  reelId: text("reel_id").references((): AnyPgColumn => reel.id, { onDelete: "set null" }),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// One row per (publication, account) attempt. Exactly one of storyId /
// reelId is set for website content; both are null for a custom post.
//
// Each row carries its *complete* request — content type, caption, media,
// options — rather than re-deriving it from the story at run time. That's
// what makes per-account captions, per-account schedules and single-account
// retry possible: retrying a failed YouTube upload re-sends exactly what
// the editor approved, even if the story has been edited since.
export const socialPost = pgTable("social_post", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  storyId: text("story_id").references(() => story.id, {
    onDelete: "cascade",
  }),
  reelId: text("reel_id").references(() => reel.id, { onDelete: "cascade" }),
  platform: socialPlatformEnum("platform").notNull(),
  connectionId: text("connection_id").references(() => socialConnection.id, {
    onDelete: "set null",
  }),
  status: socialPostStatusEnum("status").default("queued").notNull(),
  externalPostId: text("external_post_id"),
  errorMessage: text("error_message"),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),

  // --- Social publishing center (all nullable / DB-defaulted, see above) ---
  publicationId: text("publication_id").references((): AnyPgColumn => socialPublication.id, {
    onDelete: "cascade",
  }),
  // Null only on rows written before content types existed; the runner
  // falls back to the old article/reel behaviour for those.
  contentType: socialContentTypeEnum("content_type"),
  // Snapshot of the account's name at the time, so history stays readable
  // after an account is removed (connectionId goes null on delete).
  accountLabel: text("account_label"),
  caption: text("caption"),
  title: text("title"),
  linkUrl: text("link_url"),
  media: jsonb("media").$type<SocialMediaItem[]>(),
  thumbnailUrl: text("thumbnail_url"),
  options: jsonb("options").$type<SocialPostOptions>(),
  scheduledFor: timestamp("scheduled_for"),
  attemptCount: integer("attempt_count").default(0).notNull(),
  lastAttemptAt: timestamp("last_attempt_at"),
  // Where it actually landed, as reported back by the platform — this is
  // how a Facebook Reel that ended up as a Story gets caught.
  permalink: text("permalink"),
  warning: text("warning"),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, {
    onDelete: "set null",
  }),
});

/** Named sets of accounts ("News accounts", "Sports accounts") for one-click selection. */
export const socialAccountGroup = pgTable("social_account_group", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const socialAccountGroupMember = pgTable(
  "social_account_group_member",
  {
    groupId: text("group_id")
      .notNull()
      .references((): AnyPgColumn => socialAccountGroup.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references((): AnyPgColumn => socialConnection.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.connectionId] })]
);

/**
 * Who connected, reconnected, deactivated or regrouped which account — the
 * spec's "keep a record of who connected, disconnected, or published".
 * Publishing itself is recorded on `social_post.createdById`, so it isn't
 * duplicated here. Rendered text, like the other activity logs, so it stays
 * readable after an account or person is removed.
 */
export const socialAuditLog = pgTable("social_audit_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  connectionId: text("connection_id").references((): AnyPgColumn => socialConnection.id, {
    onDelete: "set null",
  }),
  platform: socialPlatformEnum("platform"),
  accountLabel: text("account_label"),
  actorId: text("actor_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  action: text("action").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});


// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------

export const mediaKindEnum = pgEnum("media_kind", ["image", "video", "audio", "document"]);

/**
 * Every uploaded asset lands here once, and content references it by id.
 * Storing dimensions and mime alongside the URL means `next/image` can render
 * without a layout shift and without a round-trip to the storage provider.
 *
 * `storageKey` is UploadThing's file key — needed to delete the underlying
 * file, since deleting only the row would leak storage.
 */
export const media = pgTable("media", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  url: text("url").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  kind: mediaKindEnum("kind").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  // Editorial metadata — the deck calls for per-image caption, credit and
  // alt-text, so they live on the asset rather than only on gallery rows.
  altText: text("alt_text"),
  caption: text("caption"),
  credit: text("credit"),
  uploadedById: text("uploaded_by_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// ---------------------------------------------------------------------------
// Shared publishable columns
// ---------------------------------------------------------------------------

/**
 * Page, poll and both gallery types are separate tables (deliberate — see
 * CLAUDE.md), but they share the same editorial lifecycle. Defining those
 * columns once here keeps the tables from drifting apart as fields are added,
 * without coupling them in the database.
 *
 * Note each table declares its own `slug` unique index, so slugs only need to
 * be unique *within* a type — which is why every type gets its own URL prefix.
 */
function publishable() {
  return {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    excerpt: text("excerpt"),
    status: contentStatusEnum("status").default("draft").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    publishedAt: timestamp("published_at"),
    // SEO — mirrors the deck's dedicated SEO panel.
    metaTitle: text("meta_title"),
    metaDescription: text("meta_description"),
    focusKeyword: text("focus_keyword"),
    canonicalUrl: text("canonical_url"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  };
}

// ---------------------------------------------------------------------------
// Static pages
// ---------------------------------------------------------------------------

/**
 * About Us, Privacy Policy, Contact — long-lived pages that sit outside the
 * news feed. `body` holds Tiptap JSON, not HTML, so rendering never needs
 * dangerouslySetInnerHTML.
 */
export const page = pgTable("page", {
  ...publishable(),
  body: jsonb("body").notNull().default({ type: "doc", content: [] }),
  // Pages pinned to the footer/header nav.
  showInFooter: boolean("show_in_footer").default(false).notNull(),
});

// ---------------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------------

export const poll = pgTable("poll", {
  ...publishable(),
  question: text("question").notNull(),
  // Null means the poll stays open indefinitely.
  closesAt: timestamp("closes_at"),
  allowMultiple: boolean("allow_multiple").default(false).notNull(),
});

export const pollOption = pgTable("poll_option", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  pollId: text("poll_id")
    .notNull()
    .references(() => poll.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  position: integer("position").notNull(),
});

/**
 * Readers aren't logged in, so a vote is deduplicated by a salted hash of
 * IP + user agent rather than a user id. Storing the hash instead of the raw
 * IP keeps the table from becoming a log of readers' addresses.
 */
export const pollVote = pgTable(
  "poll_vote",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    pollId: text("poll_id")
      .notNull()
      .references(() => poll.id, { onDelete: "cascade" }),
    pollOptionId: text("poll_option_id")
      .notNull()
      .references(() => pollOption.id, { onDelete: "cascade" }),
    voterHash: text("voter_hash").notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [uniqueIndex("poll_vote_once_idx").on(t.pollId, t.voterHash)]
);

// ---------------------------------------------------------------------------
// Photo galleries
// ---------------------------------------------------------------------------

export const photoGallery = pgTable("photo_gallery", {
  ...publishable(),
  coverMediaId: text("cover_media_id").references(() => media.id, {
    onDelete: "set null",
  }),
});

/**
 * Per-image caption/credit/alt override what's on the media asset, so the same
 * photo can carry different context in different galleries.
 */
export const photoGalleryImage = pgTable("photo_gallery_image", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  galleryId: text("gallery_id")
    .notNull()
    .references(() => photoGallery.id, { onDelete: "cascade" }),
  mediaId: text("media_id")
    .notNull()
    .references(() => media.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  caption: text("caption"),
  credit: text("credit"),
  altText: text("alt_text"),
});

// ---------------------------------------------------------------------------
// Video galleries
// ---------------------------------------------------------------------------

export const videoGallery = pgTable("video_gallery", {
  ...publishable(),
  coverMediaId: text("cover_media_id").references(() => media.id, {
    onDelete: "set null",
  }),
});

export const videoSourceEnum = pgEnum("video_source", ["upload", "youtube", "facebook"]);

/**
 * A video gallery entry is either an uploaded asset (`mediaId`) or an embed
 * from YouTube/Facebook (`externalUrl`) — newsrooms routinely curate both, and
 * forcing every video through upload would mean re-hosting content already
 * live on the channel.
 */
export const videoGalleryItem = pgTable("video_gallery_item", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  galleryId: text("gallery_id")
    .notNull()
    .references(() => videoGallery.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
  title: text("title").notNull(),
  source: videoSourceEnum("source").notNull(),
  mediaId: text("media_id").references(() => media.id, { onDelete: "set null" }),
  externalUrl: text("external_url"),
  thumbnailMediaId: text("thumbnail_media_id").references(() => media.id, {
    onDelete: "set null",
  }),
  durationSeconds: integer("duration_seconds"),
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

/**
 * Newsroom sections (Bangladesh, খেলা, অর্থনীতি …). Managed from
 * /admin/categories rather than typed free-hand on every story.
 */
export const categoryPermissionEnum = pgEnum("category_permission", [
  "public",
  "admin",
]);

// Deliberately separate from contentStatusEnum: a category is either shown
// or it isn't. The in_review/qc stages that enum carries are article
// workflow states and don't apply here.
export const categoryStatusEnum = pgEnum("category_status", [
  "draft",
  "published",
]);

export const category = pgTable("category", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  // Self-reference: a row with a parentId is a sub-category. Top-level
  // categories fill the primary <select>; their children populate the
  // sub-category checkbox list.
  parentId: text("parent_id").references((): AnyPgColumn => category.id, {
    onDelete: "cascade",
  }),
  // "admin" hides the category from the public nav/category pages — an
  // internal desk section (e.g. a wire-copy holding bin) rather than a
  // reader-facing one.
  permission: categoryPermissionEnum("permission").default("public").notNull(),
  // Bootstrap Icons / Font Awesome class, e.g. "ri-arrow-right-line". Stored
  // as the raw class string rather than an enum of known icons, since the
  // set of possible classes across two icon libraries is effectively open.
  iconClass: text("icon_class"),
  status: categoryStatusEnum("status").default("published").notNull(),
  // Controls ordering in nav and category pickers.
  position: integer("position").default(0).notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// ---------------------------------------------------------------------------
// Photocard templates
// ---------------------------------------------------------------------------

/**
 * Who may use a template. Enforced server-side in
 * app/(cms)/admin/photocard-templates/actions.ts — the library and the
 * article desk both filter through the same helper, so hiding a card in the
 * UI is never the only thing standing between a user and a template.
 */
export const photocardVisibilityEnum = pgEnum("photocard_visibility", [
  "private",
  "admin",
  "editors",
  "article_desk",
  "everyone",
]);

export const photocardStatusEnum = pgEnum("photocard_status", [
  "draft",
  "active",
  "archived",
]);

/**
 * A reusable photocard design.
 *
 * `document` holds the whole design as a serializable PhotocardDocument (see
 * lib/photocard.ts): canvas size, background, and an ordered list of text /
 * image / shape elements with position, rotation, styling and — for elements
 * bound to an article field — which value fills them at generation time.
 * It's one jsonb column rather than a table of elements because a document is
 * only ever read and written whole, and the editor needs it to round-trip
 * exactly.
 *
 * The legacy v1 columns below are kept so templates saved before the studio
 * existed still open: `normalizeDocument()` converts a v1 `textLayers` array
 * (plus `frameImageUrl`) into a document on read, and the next save writes a
 * real document back into `document`. Don't drop them until every install has
 * re-saved its templates.
 */
export const photocardTemplate = pgTable("photocard_template", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  category: text("category").default("Custom").notNull(),
  status: photocardStatusEnum("status").default("draft").notNull(),
  tags: text("tags").array().default([]).notNull(),
  document: jsonb("document")
    .$type<PhotocardDocument>()
    .notNull()
    .$defaultFn(() => defaultPhotocardDocument()),
  visibility: photocardVisibilityEnum("visibility").default("everyone").notNull(),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, {
    onDelete: "set null",
  }),
  // --- legacy v1 columns, read-only compatibility ---
  frameImageUrl: text("frame_image_url"),
  textLayers: jsonb("text_layers"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

/**
 * Per-user favourites. A join table rather than a column on the template so
 * one person starring a template doesn't change what anyone else sees.
 */
export const photocardFavorite = pgTable(
  "photocard_favorite",
  {
    userId: text("user_id")
      .notNull()
      .references((): AnyPgColumn => user.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references((): AnyPgColumn => photocardTemplate.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.templateId] })]
);

/**
 * Lightweight versioning: a named snapshot of a whole document, taken on
 * demand. Deliberately not an every-save audit log — that would grow without
 * bound for no editorial benefit. Restoring a version just writes its
 * document back onto the template.
 */
export const photocardTemplateVersion = pgTable("photocard_template_version", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  templateId: text("template_id")
    .notNull()
    .references((): AnyPgColumn => photocardTemplate.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  document: jsonb("document").$type<PhotocardDocument>().notNull(),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

/**
 * One brand kit per newsroom (a single row, keyed by a fixed id). Colours,
 * fonts and logo assets the studio can apply in one click.
 */
export const brandKit = pgTable("brand_kit", {
  id: text("id").primaryKey().default("default"),
  colors: jsonb("colors").$type<Record<string, string>>().notNull(),
  fonts: jsonb("fonts").$type<Record<string, string>>().notNull(),
  assets: jsonb("assets").$type<Record<string, string>>().notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// ---------------------------------------------------------------------------
// Kanban task boards
// ---------------------------------------------------------------------------

export const boardRoleEnum = pgEnum("board_role", ["owner", "manager", "member"]);

/**
 * A board is a workspace (Newsroom, Marketing, Project Alpha). Columns live in
 * their own table rather than an enum because the whole point is that each
 * team configures its own workflow.
 */
export const board = pgTable("board", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  archived: boolean("archived").default(false).notNull(),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
});

/**
 * Membership is what scopes visibility: an employee sees a board only if they
 * are a member (admins excepted). `boardRole` is per board, deliberately
 * separate from the site-wide `user.role` — a reporter can be the manager of
 * a board without gaining newsroom-wide powers.
 */
export const boardMember = pgTable(
  "board_member",
  {
    boardId: text("board_id").notNull().references((): AnyPgColumn => board.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references((): AnyPgColumn => user.id, { onDelete: "cascade" }),
    boardRole: boardRoleEnum("board_role").default("member").notNull(),
    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  },
  (t) => [primaryKey({ columns: [t.boardId, t.userId] })]
);

/**
 * `position` is a sparse float so a column (or task) can be dropped between
 * two neighbours by averaging their positions — one UPDATE on the moved row
 * instead of renumbering every sibling on each drag.
 */
export const boardColumn = pgTable("board_column", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  boardId: text("board_id").notNull().references((): AnyPgColumn => board.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  position: doublePrecision("position").default(1000).notNull(),
  // Marks the terminal column: dropping a task here stamps completedAt/By.
  isDone: boolean("is_done").default(false).notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

export const taskPriorityEnum = pgEnum("task_priority", ["low", "medium", "high", "urgent"]);

export const task = pgTable("task", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  boardId: text("board_id").notNull().references((): AnyPgColumn => board.id, { onDelete: "cascade" }),
  // The column IS the status — there's no separate status field to fall out of
  // sync with it. Moving a card and changing status from the detail view are
  // the same write.
  columnId: text("column_id").notNull().references((): AnyPgColumn => boardColumn.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  priority: taskPriorityEnum("priority").default("medium").notNull(),
  position: doublePrecision("position").default(1000).notNull(),
  startDate: timestamp("start_date"),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  completedById: text("completed_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  archived: boolean("archived").default(false).notNull(),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
});

/** Many-to-many: a task can have several assignees. */
export const taskAssignee = pgTable(
  "task_assignee",
  {
    taskId: text("task_id").notNull().references((): AnyPgColumn => task.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references((): AnyPgColumn => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.userId] })]
);

export const boardLabel = pgTable("board_label", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  boardId: text("board_id").notNull().references((): AnyPgColumn => board.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  color: text("color").default("#77A4CE").notNull(),
});

export const taskLabel = pgTable(
  "task_label",
  {
    taskId: text("task_id").notNull().references((): AnyPgColumn => task.id, { onDelete: "cascade" }),
    labelId: text("label_id").notNull().references((): AnyPgColumn => boardLabel.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] })]
);

export const subtask = pgTable("subtask", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskId: text("task_id").notNull().references((): AnyPgColumn => task.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  done: boolean("done").default(false).notNull(),
  position: doublePrecision("position").default(1000).notNull(),
});

export const taskComment = pgTable("task_comment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskId: text("task_id").notNull().references((): AnyPgColumn => task.id, { onDelete: "cascade" }),
  authorId: text("author_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  body: text("body").notNull(),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

export const taskAttachment = pgTable("task_attachment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskId: text("task_id").notNull().references((): AnyPgColumn => task.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  url: text("url").notNull(),
  uploadedById: text("uploaded_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

/**
 * Append-only activity log. `message` is rendered as written rather than
 * reconstructed from ids at read time, so history stays readable even after a
 * column is renamed or a member leaves.
 */
export const taskActivity = pgTable("task_activity", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  taskId: text("task_id").notNull().references((): AnyPgColumn => task.id, { onDelete: "cascade" }),
  actorId: text("actor_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

export const notification = pgTable("notification", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id").notNull().references((): AnyPgColumn => user.id, { onDelete: "cascade" }),
  message: text("message").notNull(),
  taskId: text("task_id").references((): AnyPgColumn => task.id, { onDelete: "cascade" }),
  boardId: text("board_id").references((): AnyPgColumn => board.id, { onDelete: "cascade" }),
  // Added for the Story Pipeline, which reuses this same notifications table
  // rather than standing up a parallel one — a notification is either about a
  // Kanban task/board or a pipeline story, never both.
  storyId: text("story_id").references((): AnyPgColumn => story.id, { onDelete: "cascade" }),
  // Added for the pitch desk, same pattern again — a notification is about a
  // task, a board, a pipeline story or a story pitch, never more than one.
  pitchId: text("pitch_id").references((): AnyPgColumn => storyPitch.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

// ---------------------------------------------------------------------------
// AI news feed (wire ingestion)
// ---------------------------------------------------------------------------

export const feedSourceStatusEnum = pgEnum("feed_source_status", [
  "healthy",
  "fetching",
  "error",
  "disabled",
]);

/**
 * A configured wire/RSS source. `url` is an RSS or Atom feed URL — the
 * ingester speaks those two formats only, which is what Reuters, AFP, AP and
 * the BBC all publish.
 *
 * `lastError`/`lastFetchedAt` are kept on the row rather than derived from the
 * event log so the sources table renders without a per-source subquery, and so
 * one broken source is visibly broken without blocking the others.
 */
export const feedSource = pgTable("feed_source", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  url: text("url").notNull(),
  // Optional editorial hint: the desk section wire copy from here usually
  // belongs to. The AI still classifies per article; this is the fallback.
  defaultCategory: text("default_category"),
  language: text("language").default("en").notNull(),
  enabled: boolean("enabled").default(true).notNull(),
  status: feedSourceStatusEnum("status").default("healthy").notNull(),
  lastError: text("last_error"),
  lastFetchedAt: timestamp("last_fetched_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
  updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
});

export const feedItemStatusEnum = pgEnum("feed_item_status", [
  "new",
  "translating",
  "summarising",
  "ready",
  "failed",
  "converted",
  "rejected",
]);

/**
 * One ingested article. Original wire fields and AI output live side by side
 * and are never merged: an editor must always be able to see what the source
 * actually said next to what the model produced, and `convert to draft` copies
 * the AI fields into a CMS draft rather than mutating this row.
 *
 * `guid` is the feed's own item id (or the article URL when a feed omits one),
 * unique per source — that uniqueness constraint is the duplicate guard, so a
 * feed re-listing the same item on every poll can't create a second row.
 */
export const feedItem = pgTable(
  "feed_item",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    sourceId: text("source_id")
      .notNull()
      .references((): AnyPgColumn => feedSource.id, { onDelete: "cascade" }),
    guid: text("guid").notNull(),
    originalTitle: text("original_title").notNull(),
    originalBody: text("original_body"),
    originalUrl: text("original_url").notNull(),
    originalLanguage: text("original_language").default("en").notNull(),
    imageUrl: text("image_url"),
    publishedAt: timestamp("published_at"),

    // --- AI output, all nullable until processing runs ---
    banglaTitle: text("bangla_title"),
    banglaBody: text("bangla_body"),
    banglaSummary: text("bangla_summary"),
    keyPoints: jsonb("key_points").$type<string[]>(),
    aiCategory: text("ai_category"),
    aiLocation: text("ai_location"),
    aiEntities: jsonb("ai_entities").$type<string[]>(),
    // Set when an editor overrides the AI's category; the UI prefers this.
    editorCategory: text("editor_category"),

    status: feedItemStatusEnum("status").default("new").notNull(),
    lastError: text("last_error"),
    translationRuns: integer("translation_runs").default(0).notNull(),
    summaryRuns: integer("summary_runs").default(0).notNull(),

    // Set once converted, so the list can link straight to the draft and the
    // button can't be pressed twice into two drafts.
    storyId: text("story_id").references((): AnyPgColumn => story.id, {
      onDelete: "set null",
    }),
    convertedAt: timestamp("converted_at"),
    convertedById: text("converted_by_id").references((): AnyPgColumn => user.id, {
      onDelete: "set null",
    }),

    /**
     * Fingerprint of the normalised headline, used to spot the same event
     * reported by different wires. Deliberately NOT a uniqueness constraint —
     * related stories stay separate rows, they're only grouped for display.
     */
    storyKey: text("story_key"),

    createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
    updatedAt: timestamp("updated_at").$defaultFn(() => new Date()).notNull(),
  },
  (t) => [uniqueIndex("feed_item_source_guid_idx").on(t.sourceId, t.guid)]
);

/**
 * Append-only processing log — what happened to an item and when. Powers the
 * per-article history and makes a failure diagnosable without server logs.
 */
export const feedEvent = pgTable("feed_event", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  itemId: text("item_id")
    .notNull()
    .references((): AnyPgColumn => feedItem.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  detail: text("detail"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

// ---------------------------------------------------------------------------
// Standalone videos (the "Video Gallery" desk)
// ---------------------------------------------------------------------------

/**
 * A flat list of videos, each with its own thumbnail and embed link.
 *
 * Distinct from `videoGallery`/`videoGalleryItem`, which model a *curated
 * collection* of videos published as one page. This table is the day-to-day
 * desk: one row per video, edited and deleted individually.
 */
export const video = pgTable("video", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  // Either a plain video URL or a full <iframe> embed snippet — the desk
  // accepts whatever the source hands them. Sanitised at render time by
  // lib/video-embed.ts rather than trusted as-is.
  videoLink: text("video_link").notNull(),
  description: text("description"),
  status: contentStatusEnum("status").default("draft").notNull(),
  authorId: text("author_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// ---------------------------------------------------------------------------
// Story ↔ sub-category join
// ---------------------------------------------------------------------------

/**
 * A story has one primary category (`story.categoryId`) plus any number of
 * sub-categories, which is the checkbox list on the article form.
 */
export const storyCategory = pgTable(
  "story_category",
  {
    storyId: text("story_id")
      .notNull()
      .references(() => story.id, { onDelete: "cascade" }),
    categoryId: text("category_id")
      .notNull()
      .references(() => category.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.storyId, t.categoryId] })]
);

// ---------------------------------------------------------------------------
// HR: organisation structure
// ---------------------------------------------------------------------------

/**
 * Company / Branch / Department / Designation are separate tables rather
 * than free-text columns on the employee profile so an admin can manage the
 * list once and every employee form picks from it — otherwise the same
 * department ends up spelled three ways across a newsroom.
 *
 * All four use `ON DELETE SET NULL` from the profile side: removing a
 * department shouldn't delete the people in it.
 */
export const company = pgTable("company", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const branch = pgTable("branch", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  companyId: text("company_id").references(() => company.id, {
    onDelete: "cascade",
  }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const department = pgTable("department", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const designation = pgTable("designation", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

export const employmentTypeEnum = pgEnum("employment_type", [
  "full_time",
  "part_time",
  "contract",
  "intern",
]);

// ---------------------------------------------------------------------------
// HR: employee profile
// ---------------------------------------------------------------------------

/**
 * One row per staff account, holding everything that isn't authentication.
 *
 * Deliberately a separate table from `user` rather than more columns on it:
 * better-auth owns `user` (its admin plugin writes role/banned/ban* there),
 * so keeping HR data out of it means a better-auth upgrade can't collide
 * with these fields, and the auth table stays small for the queries that run
 * on every request.
 */
export const employeeProfile = pgTable("employee_profile", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),

  // Human-readable staff number, e.g. "DCN-014". Unique but nullable —
  // accounts that predate this feature won't have one.
  employeeCode: text("employee_code").unique(),

  // --- Personal information ---
  phone: text("phone"),
  personalEmail: text("personal_email"),
  dateOfBirth: timestamp("date_of_birth"),
  gender: text("gender"),
  nationalId: text("national_id"),
  address: text("address"),
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),

  // --- Employment details ---
  companyId: text("company_id").references(() => company.id, { onDelete: "set null" }),
  branchId: text("branch_id").references(() => branch.id, { onDelete: "set null" }),
  departmentId: text("department_id").references(() => department.id, { onDelete: "set null" }),
  designationId: text("designation_id").references(() => designation.id, { onDelete: "set null" }),
  employmentType: employmentTypeEnum("employment_type").default("full_time").notNull(),
  joiningDate: timestamp("joining_date"),

  // --- Working location ---
  // Free text for the same reason the article dateline is (lib/bd-locations.ts):
  // a fixed list can't cover every posting, and a FK would block the ones it
  // misses.
  division: text("division"),
  district: text("district"),
  upazila: text("upazila"),

  // --- Output target ---
  // How many stories this person is expected to file per day. Nullable
  // because it's meaningless for non-editorial roles (graphics, admin).
  dailyNewsTarget: integer("daily_news_target"),

  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

// ---------------------------------------------------------------------------
// Story Pipeline (`/admin/pipeline`)
// ---------------------------------------------------------------------------

/**
 * Discussion thread on a pipeline story. `parentId` makes a row a reply;
 * `resolved` covers both the NM Desk/QC "flag an issue" use (a comment that
 * gets checked off once fixed) and ordinary discussion, which is simply never
 * resolved. One table for both rather than a separate "QC comment" type — a
 * QC note is a comment with a reply and a resolve action, not a different
 * kind of row.
 */
export const storyComment = pgTable("story_comment", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  storyId: text("story_id").notNull().references((): AnyPgColumn => story.id, { onDelete: "cascade" }),
  authorId: text("author_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  parentId: text("parent_id").references((): AnyPgColumn => storyComment.id, { onDelete: "cascade" }),
  body: text("body").notNull(),
  // Which pipeline stage the story was in when this was posted (e.g. "qc"),
  // stamped at write time purely so the UI can badge it "QC comment" the way
  // the spec's QC review screen does — not a separate comment type.
  context: text("context"),
  resolved: boolean("resolved").default(false).notNull(),
  resolvedById: text("resolved_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at"),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

/**
 * Append-only activity log, same shape and reasoning as `taskActivity`:
 * `message` is rendered as written rather than reconstructed from ids, so
 * history stays readable even after a person leaves or a stage is renamed.
 */
export const storyActivity = pgTable("story_activity", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  storyId: text("story_id").notNull().references((): AnyPgColumn => story.id, { onDelete: "cascade" }),
  actorId: text("actor_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

/**
 * On-demand named snapshots (taken on submit, on send-to-QC, and on manual
 * save), not an every-keystroke audit log — that would grow without bound
 * for no editorial benefit. `snapshot` holds the whole editable surface as
 * one jsonb blob (see StoryRevisionSnapshot in lib/pipeline.ts); restoring a
 * revision writes it straight back onto the story's own columns.
 */
export const storyRevision = pgTable("story_revision", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  storyId: text("story_id").notNull().references((): AnyPgColumn => story.id, { onDelete: "cascade" }),
  label: text("label").notNull(),
  snapshot: jsonb("snapshot").$type<StoryRevisionSnapshot>().notNull(),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});

/**
 * Extra media beyond the single `featuredImageUrl` — the reporter's uploaded
 * images/video/audio/documents for this story. A join onto the existing
 * `media` table (not a new asset table) so every upload still goes through
 * one place for storage cleanup on delete.
 */
export const storyMedia = pgTable("story_media", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  storyId: text("story_id").notNull().references((): AnyPgColumn => story.id, { onDelete: "cascade" }),
  mediaId: text("media_id").notNull().references((): AnyPgColumn => media.id, { onDelete: "cascade" }),
  position: integer("position").default(0).notNull(),
  // Overrides the asset's own caption/credit for this specific use, same
  // reasoning as photoGalleryImage.
  caption: text("caption"),
  credit: text("credit"),
  uploadedById: text("uploaded_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").$defaultFn(() => new Date()).notNull(),
});


// ---------------------------------------------------------------------------
// Homepage builder & breaking-news ticker
// ---------------------------------------------------------------------------

/**
 * The homepage arrangement. Exactly two rows, keyed "draft" and
 * "published": the builder only ever writes the draft, Publish copies it
 * to published, and the public homepage only ever reads published — so an
 * editor experimenting can't change the live site by accident. No row at
 * all means "the default layout" (lib/homepage.ts defaultSections()).
 */
export const homepageLayout = pgTable("homepage_layout", {
  key: text("key").$type<"draft" | "published">().primaryKey(),
  sections: jsonb("sections").$type<HomeSection[]>().notNull(),
  updatedById: text("updated_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
  publishedById: text("published_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  publishedAt: timestamp("published_at"),
});

export const tickerPriorityEnum = pgEnum("ticker_priority", ["normal", "high", "breaking"]);

/**
 * One line in the red breaking-news bar. Shown when active and inside its
 * start/expiry window, in `position` order (sparse doubles, like Kanban
 * cards, so a drag is one UPDATE). A linked story makes the line clickable.
 */
export const tickerItem = pgTable("ticker_item", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  text: text("text").notNull(),
  storyId: text("story_id").references((): AnyPgColumn => story.id, { onDelete: "set null" }),
  priority: tickerPriorityEnum("priority").default("normal").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  startsAt: timestamp("starts_at"),
  expiresAt: timestamp("expires_at"),
  position: doublePrecision("position").default(0).notNull(),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at"),
});

/** Small site-wide settings as JSON by key — currently "ticker" (TickerSettings). */
export const siteSetting = pgTable("site_setting", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedById: text("updated_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});


// ---------------------------------------------------------------------------
// Studio CG & graphics (broadcast)
// ---------------------------------------------------------------------------

export const cgTypeEnum = pgEnum("cg_type", [
  "lower_third",
  "breaking",
  "channel_bug",
  "full_frame",
  "two_box",
  "credits",
  "data_plate",
  "custom",
]);

export const cgStatusEnum = pgEnum("cg_status", ["draft", "active", "archived"]);

/**
 * A graphic template: the design (`document`), the fields an operator fills
 * in, and how it animates. `draftDocument`/`draftFields` hold an edit that
 * hasn't been taken to air yet — editing a template must never change what
 * is on screen mid-broadcast, so the live copy is only replaced when
 * someone presses "Publish design" (or "Take updated version").
 */
export const cgTemplate = pgTable("cg_template", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  type: cgTypeEnum("type").notNull(),
  category: text("category").notNull().default("custom"),
  status: cgStatusEnum("status").default("active").notNull(),
  document: jsonb("document").$type<CgDocument>().notNull(),
  fields: jsonb("fields").$type<CgField[]>().notNull(),
  /** Last values an operator used, so a plate opens where it was left. */
  values: jsonb("values").$type<CgValues>(),
  draftDocument: jsonb("draft_document").$type<CgDocument>(),
  draftFields: jsonb("draft_fields").$type<CgField[]>(),
  /**
   * The rest of a draft edit — name, type, animation, duration, layer and so
   * on. Without this, saving a draft would still change how the LIVE version
   * behaves the next time it's taken, which is exactly what draft-vs-live is
   * meant to prevent.
   */
  draftMeta: jsonb("draft_meta").$type<CgDraftMeta>(),
  animationIn: text("animation_in").default("fade").notNull(),
  animationOut: text("animation_out").default("fade").notNull(),
  animationMs: integer("animation_ms").default(400).notNull(),
  /** 0 = stays on air until taken off. */
  durationSec: integer("duration_sec").default(0).notNull(),
  layer: integer("layer").default(2).notNull(),
  /** Fast-access red buttons for the operator. */
  isEmergency: boolean("is_emergency").default(false).notNull(),
  /** Needs a second look before air (used for the confirm step). */
  needsCheck: boolean("needs_check").default(false).notNull(),
  dataSourceId: text("data_source_id").references((): AnyPgColumn => cgDataSource.id, { onDelete: "set null" }),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
  lastUsedAt: timestamp("last_used_at"),
});

/** Per-operator favourites — they differ by who is on shift. */
export const cgFavorite = pgTable(
  "cg_favorite",
  {
    userId: text("user_id")
      .notNull()
      .references((): AnyPgColumn => user.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references((): AnyPgColumn => cgTemplate.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.templateId] })]
);

export const cgAirStatusEnum = pgEnum("cg_air_status", ["on_air", "queued", "done"]);

/**
 * What is on air, and what is lined up. One row per take: `on_air` rows are
 * the output (at most one per layer — taking a second graphic onto a layer
 * retires the first), `queued` rows are the operator's rundown in `position`
 * order, `done` rows are the history.
 *
 * Values are copied onto the row rather than read back from the template, so
 * editing a template's defaults can't silently rewrite what is already on
 * screen, and the history shows the words that actually aired.
 */
export const cgAirItem = pgTable(
  "cg_air_item",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    templateId: text("template_id").references((): AnyPgColumn => cgTemplate.id, { onDelete: "set null" }),
    /** Snapshot of the design and words as taken — history stays truthful. */
    label: text("label").notNull(),
    document: jsonb("document").$type<CgDocument>().notNull(),
    fields: jsonb("fields").$type<CgField[]>().notNull(),
    values: jsonb("values").$type<CgValues>().notNull(),
    animationIn: text("animation_in").default("fade").notNull(),
    animationOut: text("animation_out").default("fade").notNull(),
    animationMs: integer("animation_ms").default(400).notNull(),
    layer: integer("layer").default(2).notNull(),
    /** Chosen when it was prepared: 0 = manual. A queued row keeps the
        operator's choice instead of re-reading the template at take time. */
    durationSec: integer("duration_sec").default(0).notNull(),
    status: cgAirStatusEnum("status").default("queued").notNull(),
    position: doublePrecision("position").default(0).notNull(),
    storyId: text("story_id").references((): AnyPgColumn => story.id, { onDelete: "set null" }),
    dataSourceId: text("data_source_id").references((): AnyPgColumn => cgDataSource.id, { onDelete: "set null" }),
    /** Auto-off: the output ignores rows past this instant, so a timed graphic
        leaves air even if every browser is closed. */
    expiresAt: timestamp("expires_at"),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    operatorId: text("operator_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // The expiry sweep and every read filter on status, while `done` rows
  // accumulate as history — so status carries an index.
  (t) => [index("cg_air_item_status_idx").on(t.status)]
);

/**
 * A live data feed behind a plate. `mode` decides where the numbers come
 * from (typed in, a JSON endpoint with dotted paths, or keyless Open-Meteo
 * weather). `lastValues` is the last successful read and is what a plate
 * falls back to when a fetch fails — a plate never goes blank on air.
 */
export const cgDataSource = pgTable("cg_data_source", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  kind: text("kind").notNull().default("custom"),
  config: jsonb("config").$type<CgDataConfig>().notNull(),
  refreshSec: integer("refresh_sec").default(60).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  lastValues: jsonb("last_values").$type<CgValues>(),
  lastFetchedAt: timestamp("last_fetched_at"),
  lastError: text("last_error"),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

/** On-air history and operator activity — one append-only log for both. */
export const cgEvent = pgTable("cg_event", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  action: text("action").notNull(),
  label: text("label").notNull(),
  detail: text("detail"),
  templateId: text("template_id").references((): AnyPgColumn => cgTemplate.id, { onDelete: "set null" }),
  airItemId: text("air_item_id"),
  /** How long it was on air, filled in when it comes off. */
  durationMs: integer("duration_ms"),
  operatorId: text("operator_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  at: timestamp("at")
    .$defaultFn(() => new Date())
    .notNull(),
});

/**
 * One row, key "default". `version` is bumped by every change to the output
 * so the program preview and the browser source can poll a single tiny row
 * instead of re-reading the whole air state, and `outputKey` is the shared
 * secret in the browser-source URL (OBS/vMix can't sign in).
 */
export const cgChannel = pgTable("cg_channel", {
  key: text("key").primaryKey(),
  version: integer("version").default(0).notNull(),
  outputKey: text("output_key").notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});


// ---------------------------------------------------------------------------
// Web Studio (browser switcher)
// ---------------------------------------------------------------------------

/**
 * A source on the studio's bus. The row is the *configuration* — what it's
 * called, what kind it is, which device or file it points at. Whether it is
 * actually live is never stored: that's read from the device, the peer
 * connection or the media element at render time, so a source can't claim to
 * be connected while its camera is unplugged.
 */
export const studioSource = pgTable("studio_source", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  kind: text("kind").$type<SourceKind>().notNull(),
  location: text("location"),
  notes: text("notes"),
  /** Camera/screen: the browser's deviceId, remembered per operator machine.
      It can go stale when kit is swapped, which is why it's nullable and the
      console falls back to asking for the device again. */
  deviceId: text("device_id"),
  /** VTR/external: the file or stream URL. */
  url: text("url"),
  /** VTR: poster image, when the media library has one. */
  posterUrl: text("poster_url"),
  /** Reporter/guest sources are backed by a participant row. */
  participantId: text("participant_id").references((): AnyPgColumn => studioParticipant.id, { onDelete: "cascade" }),
  position: doublePrecision("position").default(0).notNull(),
  isEnabled: boolean("is_enabled").default(true).notNull(),
  createdById: text("created_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at")
    .$defaultFn(() => new Date())
    .notNull(),
  updatedAt: timestamp("updated_at")
    .$defaultFn(() => new Date())
    .notNull(),
});

/**
 * A remote reporter or guest invited into the studio. `token` is the secret in
 * their join link — they never sign in, so the link is the credential, which
 * is why it expires and can be revoked.
 */
export const studioParticipant = pgTable(
  "studio_participant",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    name: text("name").notNull(),
    role: text("role").$type<ParticipantRole>().notNull(),
    location: text("location"),
    token: text("token").notNull(),
    state: text("state").$type<ParticipantState>().default("invited").notNull(),
    /** Last thing their own browser reported: resolution, and how the peer
        connection is doing. Display only — never trusted for access. */
    videoQuality: text("video_quality"),
    audioQuality: text("audio_quality"),
    networkQuality: text("network_quality"),
    lastSeenAt: timestamp("last_seen_at"),
    expiresAt: timestamp("expires_at"),
    invitedById: text("invited_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  // Every signalling poll from a contributor resolves their token first.
  (t) => [index("studio_participant_token_idx").on(t.token)]
);

/**
 * WebRTC signalling, exchanged through the database because this project has
 * no socket server: each side appends its offer/answer/ICE candidates and
 * polls for the other side's. Rows are consumed (deleted) once delivered, and
 * the media itself never goes near the server — it's peer-to-peer.
 */
export const studioSignal = pgTable(
  "studio_signal",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    participantId: text("participant_id")
      .notNull()
      .references((): AnyPgColumn => studioParticipant.id, { onDelete: "cascade" }),
    /** Who wrote it: the studio operator, or the remote participant. */
    fromSide: text("from_side").$type<"operator" | "participant">().notNull(),
    /** "offer" | "answer" | "candidate" | "bye" */
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("studio_signal_participant_idx").on(t.participantId, t.fromSide)]
);

/** Switch history and studio activity — append-only, one row per action. */
export const studioEvent = pgTable("studio_event", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  action: text("action").notNull(),
  fromLabel: text("from_label"),
  toLabel: text("to_label"),
  detail: text("detail"),
  operatorId: text("operator_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
  at: timestamp("at")
    .$defaultFn(() => new Date())
    .notNull(),
});


// ---------------------------------------------------------------------------
// Live Studio (Facebook Live + YouTube Live)
// ---------------------------------------------------------------------------

/**
 * Where a broadcast is in its life.
 *
 * `ready` is distinct from `live`: the platform broadcasts exist and the relay
 * is holding a session, but no pictures have arrived yet. That gap is where
 * most go-live failures happen (a wrong key, a channel not enabled for live),
 * so it needs its own state rather than being lumped in with either side.
 */
export const liveEventStatusEnum = pgEnum("live_event_status", [
  "draft",
  "scheduled",
  "ready",
  "live",
  "ended",
  "failed",
  "cancelled",
]);

/** Per-destination state, which is independent — Facebook can fail while YouTube runs. */
export const liveDestinationStatusEnum = pgEnum("live_destination_status", [
  "pending",
  "created",
  "live",
  "ended",
  "failed",
]);

/**
 * One broadcast: what it is called, where it is going, and what happened.
 *
 * The RTMPS stream keys are **not** here. They are fetched from each platform
 * at go-live, handed straight to the relay, and never stored — a stream key in
 * a database row is a credential that can hijack a live broadcast, and nothing
 * in this app needs to read one twice.
 */
export const liveEvent = pgTable(
  "live_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),
    description: text("description"),
    status: liveEventStatusEnum("status").default("draft").notNull(),
    /**
     * What the operator's browser sends: the composited studio program (shared
     * as a tab) or a plain camera. Stored because the control room's
     * instructions differ per mode and an operator reopening a prepared event
     * should get the one they set up.
     */
    source: text("source").$type<"program" | "camera">().default("program").notNull(),
    /** Encode settings passed to the relay, so a re-go-live matches the first. */
    width: integer("width").default(1920).notNull(),
    height: integer("height").default(1080).notNull(),
    fps: integer("fps").default(30).notNull(),
    videoBitrateKbps: integer("video_bitrate_kbps").default(4500).notNull(),
    audioBitrateKbps: integer("audio_bitrate_kbps").default(128).notNull(),
    /** Set for a planned broadcast. Nothing starts it automatically — see lib/live.ts. */
    scheduledFor: timestamp("scheduled_for"),
    startedAt: timestamp("started_at"),
    endedAt: timestamp("ended_at"),
    /** The relay's own session id while a broadcast is up; cleared when it ends. */
    relaySessionId: text("relay_session_id"),
    /** Last error shown in the control room — a platform refusal or a relay fault. */
    errorMessage: text("error_message"),
    /** Peak concurrent viewers across destinations, sampled while live. */
    peakViewers: integer("peak_viewers").default(0).notNull(),
    /** Optional link to the story this broadcast belongs to. */
    storyId: text("story_id").references((): AnyPgColumn => story.id, { onDelete: "set null" }),
    createdById: text("created_by_id").references((): AnyPgColumn => user.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("live_event_status_idx").on(t.status, t.createdAt)]
);

/**
 * One destination of one broadcast — a Facebook Page or a YouTube channel.
 *
 * `externalVideoId` is the platform's own id for the live video (a Facebook
 * live_video id, a YouTube broadcast id), which is what every later call needs:
 * ending it, reading the viewer count, fetching comments, finding the VOD.
 */
export const liveDestination = pgTable(
  "live_destination",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    eventId: text("event_id")
      .notNull()
      .references((): AnyPgColumn => liveEvent.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references((): AnyPgColumn => socialConnection.id, { onDelete: "cascade" }),
    platform: socialPlatformEnum("platform").notNull(),
    /** Snapshotted so history still reads correctly after an account is renamed. */
    accountLabel: text("account_label").notNull(),
    status: liveDestinationStatusEnum("status").default("pending").notNull(),
    externalVideoId: text("external_video_id"),
    /** YouTube needs its stream id too, to bind and to read stream health. */
    externalStreamId: text("external_stream_id"),
    /** YouTube's live chat id, read from the broadcast once it exists. */
    chatId: text("chat_id"),
    /**
     * Where the chat read got to.
     *
     * Without it every poll re-fetched the same window of messages and could
     * still miss anything that scrolled past between polls. With it each call
     * returns only what is new.
     */
    chatPageToken: text("chat_page_token"),
    /**
     * The earliest YouTube will accept another chat read
     * (`pollingIntervalMillis` from the last response, which the API publishes
     * precisely so clients don't burn their quota).
     */
    chatNextPollAt: timestamp("chat_next_poll_at"),
    /**
     * When this destination was last read from its platform — which is not the
     * same as when the control room last refreshed.
     *
     * YouTube's Live Streaming API costs quota per call (1 unit for a
     * broadcast read, 1 for the viewer count, 5 for a page of chat) against a
     * default of 10,000 a day, so the platform cadence has to be slower than
     * the UI's and must not multiply by the number of open console tabs. This
     * column is what every tab agrees on.
     */
    lastPolledAt: timestamp("last_polled_at"),
    permalink: text("permalink"),
    viewers: integer("viewers").default(0).notNull(),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("live_destination_event_idx").on(t.eventId),
    // One Page or channel cannot be two destinations of the same broadcast.
    uniqueIndex("live_destination_unique_idx").on(t.eventId, t.connectionId),
  ]
);

/**
 * Comments mirrored from the platforms while a broadcast is live.
 *
 * Stored rather than only displayed, for two reasons: the control room polls
 * from several operators' browsers and each should see the same thread, and
 * Facebook's comment edge and YouTube's live chat both only return recent
 * messages — once a broadcast ends, the chat is gone from the API but the
 * newsroom may still want what was said.
 */
export const liveComment = pgTable(
  "live_comment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    eventId: text("event_id")
      .notNull()
      .references((): AnyPgColumn => liveEvent.id, { onDelete: "cascade" }),
    destinationId: text("destination_id")
      .notNull()
      .references((): AnyPgColumn => liveDestination.id, { onDelete: "cascade" }),
    platform: socialPlatformEnum("platform").notNull(),
    /** The platform's own comment id — the unique index below dedupes polls. */
    externalId: text("external_id").notNull(),
    authorName: text("author_name"),
    authorAvatarUrl: text("author_avatar_url"),
    message: text("message").notNull(),
    postedAt: timestamp("posted_at").notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("live_comment_event_idx").on(t.eventId, t.postedAt),
    /**
     * What actually stops duplicates. Polling overlaps by design — each poll
     * asks for a little more than it needs so nothing is missed between
     * requests — so the insert relies on this index rather than on a
     * read-then-write that would race between two operators' tabs.
     */
    uniqueIndex("live_comment_unique_idx").on(t.destinationId, t.externalId),
  ]
);

/** Append-only log of what happened to a broadcast, for the control room and after. */
export const liveEventLog = pgTable(
  "live_event_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    eventId: text("event_id")
      .notNull()
      .references((): AnyPgColumn => liveEvent.id, { onDelete: "cascade" }),
    message: text("message").notNull(),
    level: text("level").$type<"info" | "warn" | "error">().default("info").notNull(),
    actorId: text("actor_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    at: timestamp("at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("live_event_log_event_idx").on(t.eventId, t.at)]
);

/** Viewer samples while live, so the control room can draw a line rather than a number. */
export const liveViewerSample = pgTable(
  "live_viewer_sample",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    eventId: text("event_id")
      .notNull()
      .references((): AnyPgColumn => liveEvent.id, { onDelete: "cascade" }),
    /** Total across destinations at this instant. */
    viewers: integer("viewers").notNull(),
    at: timestamp("at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("live_viewer_sample_event_idx").on(t.eventId, t.at)]
);


// ---------------------------------------------------------------------------
// Story pitches (editorial pitch desk)
// ---------------------------------------------------------------------------

/**
 * See lib/pitches.ts for what each value means and why "resubmitted" is
 * deliberately not one of them.
 */
export const pitchStatusEnum = pgEnum("pitch_status", [
  "draft",
  "pending_review",
  "needs_changes",
  "approved",
  "assigned",
  "in_progress",
  "submitted",
  "completed",
  "rejected",
]);

export const pitchRejectionReasonEnum = pgEnum("pitch_rejection_reason", [
  "duplicate",
  "not_suitable",
  "insufficient_information",
  "outside_scope",
  "already_covered",
  "timing",
  "other",
]);

export const pitchNoteVisibilityEnum = pgEnum("pitch_note_visibility", ["internal", "shared"]);

/**
 * A story idea, from the moment a reporter starts typing it to the moment the
 * story it became is published.
 *
 * Its own table rather than a `story` row in a pre-assignment stage: a pitch
 * that is rejected, or sits as a draft for a fortnight, is not a story and
 * shouldn't be occupying the story table with a slug, a NOT NULL body and a
 * place in every query that reads articles. The link between the two is
 * `storyId` here (and `story.pitchId` the other way), created exactly once,
 * when an editor approves and assigns.
 *
 * `priority` and `storyType` reuse the pipeline's own pg enums so an approved
 * pitch's values land on the story with no translation.
 */
export const storyPitch = pgTable(
  "story_pitch",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    title: text("title").notNull(),

    // Category is stored the same two ways as `story.category`/`categoryId`
    // and for the same reason (see the Categories note in CLAUDE.md): the
    // display name survives the category being deleted, the FK is what links.
    category: text("category"),
    categoryId: text("category_id").references((): AnyPgColumn => category.id, {
      onDelete: "set null",
    }),

    storyType: storyTypeEnum("story_type").default("news").notNull(),
    priority: storyPriorityEnum("priority").default("normal").notNull(),
    status: pitchStatusEnum("status").default("draft").notNull(),

    /** "Why is this story important?" — the pitch itself. */
    description: text("description"),
    /** "What will you investigate?" — the reporting plan. */
    plan: text("plan"),
    /** Expected sources, free text. */
    sources: text("sources"),

    /** Coarse token from lib/pitches.ts (`today`, `this_week`, …). */
    estimatedCompletion: text("estimated_completion"),
    /** The concrete date that token resolved to when it was chosen. */
    estimatedDate: timestamp("estimated_date"),

    /** Whose idea it is editorially — the byline if it gets commissioned. */
    reporterId: text("reporter_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    /** Who typed it in. An editor may pitch on a reporter's behalf. */
    createdById: text("created_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    /** Editor chosen at approval time; becomes `story.assignedEditorId`. */
    assignedEditorId: text("assigned_editor_id").references((): AnyPgColumn => user.id, {
      onDelete: "set null",
    }),

    /** Set by the editor at approval; becomes `story.deadline`. */
    deadline: timestamp("deadline"),

    /**
     * The latest note the reporter is meant to read — the Request Changes
     * explanation, or the approval note. Denormalised onto the row (as well as
     * being a `pitch_note` row) so the inbox card can show it without a second
     * query per card, which is what the spec's card mock-up requires.
     */
    editorNote: text("editor_note"),

    rejectionReason: pitchRejectionReasonEnum("rejection_reason"),
    rejectionNote: text("rejection_note"),
    rejectedById: text("rejected_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    rejectedAt: timestamp("rejected_at"),

    approvedById: text("approved_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at"),

    /**
     * The Story Pipeline assignment this pitch became. Null until approval.
     * `set null` on delete so removing a story doesn't erase the pitch's
     * history — the pitch falls back to "approved" if its story goes away.
     */
    storyId: text("story_id").references((): AnyPgColumn => story.id, { onDelete: "set null" }),

    /** Lets an editor hand an approved pitch back for editing (spec §22). */
    reopened: boolean("reopened").default(false).notNull(),

    submittedAt: timestamp("submitted_at"),
    /** >0 means it has been through a Request Changes round; drives the "Resubmitted" badge. */
    resubmitCount: integer("resubmit_count").default(0).notNull(),

    /**
     * Held while "Approve & Assign" is mid-flight, so two editors clicking it at
     * the same moment can't each create a story for the same idea.
     *
     * Its own column rather than reusing `status` as the flag: the status is
     * also what the reconciler reads and rewrites, so a claim expressed there
     * would be released by anyone else's page load. And `storyId` can't hold a
     * sentinel — it's a foreign key, with nothing to point at until the story
     * exists. A claim older than `ASSIGN_CLAIM_TTL_MS` is treated as abandoned,
     * so a request that died mid-way can't block the pitch forever.
     */
    assigningAt: timestamp("assigning_at"),

    /**
     * Sample rows created by the Demo data toggle. Excluded from every query
     * while the toggle is off, badged while it is on, and refused by
     * `approveAndAssign` — a demo idea must never turn into a real assignment.
     */
    isDemo: boolean("is_demo").default(false).notNull(),

    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
    updatedAt: timestamp("updated_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [
    index("story_pitch_status_idx").on(t.status),
    index("story_pitch_reporter_idx").on(t.reporterId),
    index("story_pitch_created_idx").on(t.createdAt),
  ]
);

/**
 * Editorial notes and the discussion thread, in one table split by
 * `visibility`: `internal` rows are editors-only and are filtered out in SQL
 * for anyone who isn't a reviewer, `shared` rows are the conversation the
 * reporter takes part in. One table because both are "a person wrote a
 * paragraph about this pitch at a point in time" — the only difference is who
 * may read it.
 */
export const pitchNote = pgTable(
  "pitch_note",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    pitchId: text("pitch_id")
      .notNull()
      .references((): AnyPgColumn => storyPitch.id, { onDelete: "cascade" }),
    authorId: text("author_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    visibility: pitchNoteVisibilityEnum("visibility").default("shared").notNull(),
    /** Marks the note that accompanied a Request Changes or a rejection. */
    kind: text("kind"),
    editedAt: timestamp("edited_at"),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("pitch_note_pitch_idx").on(t.pitchId, t.createdAt)]
);

/**
 * Supporting material on a pitch — research notes, a PDF, a reference photo.
 * Points at a `media` row (so deletion can reclaim the stored file the same way
 * the media desk does) rather than holding a bare URL.
 */
export const pitchAttachment = pgTable(
  "pitch_attachment",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    pitchId: text("pitch_id")
      .notNull()
      .references((): AnyPgColumn => storyPitch.id, { onDelete: "cascade" }),
    mediaId: text("media_id")
      .notNull()
      .references((): AnyPgColumn => media.id, { onDelete: "cascade" }),
    /** The original filename, kept because `media` doesn't store one. */
    label: text("label"),
    position: integer("position").default(0).notNull(),
    uploadedById: text("uploaded_by_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("pitch_attachment_pitch_idx").on(t.pitchId)]
);

/**
 * Append-only activity timeline. Same reasoning as `storyActivity`: the
 * message is stored as rendered text rather than rebuilt from ids, so the
 * history stays readable after a person leaves or a category is renamed.
 */
export const pitchEvent = pgTable(
  "pitch_event",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    pitchId: text("pitch_id")
      .notNull()
      .references((): AnyPgColumn => storyPitch.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references((): AnyPgColumn => user.id, { onDelete: "set null" }),
    message: text("message").notNull(),
    createdAt: timestamp("created_at")
      .$defaultFn(() => new Date())
      .notNull(),
  },
  (t) => [index("pitch_event_pitch_idx").on(t.pitchId, t.createdAt)]
);
