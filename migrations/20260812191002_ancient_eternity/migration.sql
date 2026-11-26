CREATE TYPE "category_permission" AS ENUM('public', 'admin');--> statement-breakpoint
CREATE TYPE "category_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "content_status" AS ENUM('draft', 'in_review', 'qc', 'published');--> statement-breakpoint
CREATE TYPE "employment_type" AS ENUM('full_time', 'part_time', 'contract', 'intern');--> statement-breakpoint
CREATE TYPE "media_kind" AS ENUM('image', 'video', 'audio', 'document');--> statement-breakpoint
CREATE TYPE "social_platform" AS ENUM('facebook', 'instagram', 'youtube', 'x', 'linkedin', 'tiktok');--> statement-breakpoint
CREATE TYPE "social_post_status" AS ENUM('queued', 'posted', 'failed');--> statement-breakpoint
CREATE TYPE "user_role" AS ENUM('admin', 'chief_editor', 'news_editor', 'reporter', 'digital_executive', 'graphics');--> statement-breakpoint
CREATE TYPE "video_source" AS ENUM('upload', 'youtube', 'facebook');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "branch" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"company_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "category" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"description" text,
	"parent_id" text,
	"permission" "category_permission" DEFAULT 'public'::"category_permission" NOT NULL,
	"icon_class" text,
	"status" "category_status" DEFAULT 'published'::"category_status" NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "department" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "designation" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employee_profile" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL UNIQUE,
	"employee_code" text UNIQUE,
	"phone" text,
	"personal_email" text,
	"date_of_birth" timestamp,
	"gender" text,
	"national_id" text,
	"address" text,
	"emergency_contact_name" text,
	"emergency_contact_phone" text,
	"company_id" text,
	"branch_id" text,
	"department_id" text,
	"designation_id" text,
	"employment_type" "employment_type" DEFAULT 'full_time'::"employment_type" NOT NULL,
	"joining_date" timestamp,
	"division" text,
	"district" text,
	"upazila" text,
	"daily_news_target" integer,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" text PRIMARY KEY,
	"url" text NOT NULL,
	"storage_key" text NOT NULL UNIQUE,
	"kind" "media_kind" NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"width" integer,
	"height" integer,
	"alt_text" text,
	"caption" text,
	"credit" text,
	"uploaded_by_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"excerpt" text,
	"status" "content_status" DEFAULT 'draft'::"content_status" NOT NULL,
	"author_id" text NOT NULL,
	"published_at" timestamp,
	"meta_title" text,
	"meta_description" text,
	"focus_keyword" text,
	"canonical_url" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"body" jsonb DEFAULT '{"type":"doc","content":[]}' NOT NULL,
	"show_in_footer" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photo_gallery" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"excerpt" text,
	"status" "content_status" DEFAULT 'draft'::"content_status" NOT NULL,
	"author_id" text NOT NULL,
	"published_at" timestamp,
	"meta_title" text,
	"meta_description" text,
	"focus_keyword" text,
	"canonical_url" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"cover_media_id" text
);
--> statement-breakpoint
CREATE TABLE "photo_gallery_image" (
	"id" text PRIMARY KEY,
	"gallery_id" text NOT NULL,
	"media_id" text NOT NULL,
	"position" integer NOT NULL,
	"caption" text,
	"credit" text,
	"alt_text" text
);
--> statement-breakpoint
CREATE TABLE "poll" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"excerpt" text,
	"status" "content_status" DEFAULT 'draft'::"content_status" NOT NULL,
	"author_id" text NOT NULL,
	"published_at" timestamp,
	"meta_title" text,
	"meta_description" text,
	"focus_keyword" text,
	"canonical_url" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"question" text NOT NULL,
	"closes_at" timestamp,
	"allow_multiple" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_option" (
	"id" text PRIMARY KEY,
	"poll_id" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "poll_vote" (
	"id" text PRIMARY KEY,
	"poll_id" text NOT NULL,
	"poll_option_id" text NOT NULL,
	"voter_hash" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reel" (
	"id" text PRIMARY KEY,
	"caption" text NOT NULL,
	"video_url" text NOT NULL,
	"thumbnail_url" text,
	"status" "content_status" DEFAULT 'draft'::"content_status" NOT NULL,
	"author_id" text NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"impersonated_by" text,
	"user_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_connection" (
	"id" text PRIMARY KEY,
	"platform" "social_platform" NOT NULL,
	"label" text NOT NULL,
	"external_account_id" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text,
	"token_expires_at" timestamp,
	"is_active" boolean NOT NULL,
	"connected_by_id" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_post" (
	"id" text PRIMARY KEY,
	"story_id" text,
	"reel_id" text,
	"platform" "social_platform" NOT NULL,
	"connection_id" text,
	"status" "social_post_status" DEFAULT 'queued'::"social_post_status" NOT NULL,
	"external_post_id" text,
	"error_message" text,
	"posted_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"excerpt" text,
	"body" text NOT NULL,
	"body_json" jsonb,
	"featured_image_url" text,
	"category" text NOT NULL,
	"category_id" text,
	"subtitle" text,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"youtube_url" text,
	"attachment_url" text,
	"image_caption" text,
	"is_news_ticker" boolean DEFAULT false NOT NULL,
	"is_lead_news" boolean DEFAULT false NOT NULL,
	"is_spotlight" boolean DEFAULT false NOT NULL,
	"division" text,
	"district" text,
	"upazila" text,
	"guest_writer_name" text,
	"guest_writer_designation" text,
	"writer_id" text,
	"status" "content_status" DEFAULT 'draft'::"content_status" NOT NULL,
	"author_id" text NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_category" (
	"story_id" text,
	"category_id" text,
	CONSTRAINT "story_category_pkey" PRIMARY KEY("story_id","category_id")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'reporter'::"user_role" NOT NULL,
	"must_change_password" boolean DEFAULT false NOT NULL,
	"banned" boolean DEFAULT false,
	"ban_reason" text,
	"ban_expires" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp,
	"updated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "video" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"thumbnail_url" text,
	"video_link" text NOT NULL,
	"description" text,
	"status" "content_status" DEFAULT 'draft'::"content_status" NOT NULL,
	"author_id" text NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "video_gallery" (
	"id" text PRIMARY KEY,
	"slug" text NOT NULL UNIQUE,
	"title" text NOT NULL,
	"excerpt" text,
	"status" "content_status" DEFAULT 'draft'::"content_status" NOT NULL,
	"author_id" text NOT NULL,
	"published_at" timestamp,
	"meta_title" text,
	"meta_description" text,
	"focus_keyword" text,
	"canonical_url" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"cover_media_id" text
);
--> statement-breakpoint
CREATE TABLE "video_gallery_item" (
	"id" text PRIMARY KEY,
	"gallery_id" text NOT NULL,
	"position" integer NOT NULL,
	"title" text NOT NULL,
	"source" "video_source" NOT NULL,
	"media_id" text,
	"external_url" text,
	"thumbnail_media_id" text,
	"duration_seconds" integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX "poll_vote_once_idx" ON "poll_vote" ("poll_id","voter_hash");--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "branch" ADD CONSTRAINT "branch_company_id_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "category" ADD CONSTRAINT "category_parent_id_category_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "category"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "employee_profile" ADD CONSTRAINT "employee_profile_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "employee_profile" ADD CONSTRAINT "employee_profile_company_id_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "company"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "employee_profile" ADD CONSTRAINT "employee_profile_branch_id_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "employee_profile" ADD CONSTRAINT "employee_profile_department_id_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "department"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "employee_profile" ADD CONSTRAINT "employee_profile_designation_id_designation_id_fkey" FOREIGN KEY ("designation_id") REFERENCES "designation"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "media" ADD CONSTRAINT "media_uploaded_by_id_user_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "page" ADD CONSTRAINT "page_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "photo_gallery" ADD CONSTRAINT "photo_gallery_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "photo_gallery" ADD CONSTRAINT "photo_gallery_cover_media_id_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "photo_gallery_image" ADD CONSTRAINT "photo_gallery_image_gallery_id_photo_gallery_id_fkey" FOREIGN KEY ("gallery_id") REFERENCES "photo_gallery"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "photo_gallery_image" ADD CONSTRAINT "photo_gallery_image_media_id_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "poll" ADD CONSTRAINT "poll_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "poll_option" ADD CONSTRAINT "poll_option_poll_id_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "poll"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "poll_vote" ADD CONSTRAINT "poll_vote_poll_id_poll_id_fkey" FOREIGN KEY ("poll_id") REFERENCES "poll"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "poll_vote" ADD CONSTRAINT "poll_vote_poll_option_id_poll_option_id_fkey" FOREIGN KEY ("poll_option_id") REFERENCES "poll_option"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "reel" ADD CONSTRAINT "reel_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_connection" ADD CONSTRAINT "social_connection_connected_by_id_user_id_fkey" FOREIGN KEY ("connected_by_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_reel_id_reel_id_fkey" FOREIGN KEY ("reel_id") REFERENCES "reel"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_connection_id_social_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connection"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_category_id_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_writer_id_user_id_fkey" FOREIGN KEY ("writer_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "story_category" ADD CONSTRAINT "story_category_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "story_category" ADD CONSTRAINT "story_category_category_id_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "video" ADD CONSTRAINT "video_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "video_gallery" ADD CONSTRAINT "video_gallery_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "video_gallery" ADD CONSTRAINT "video_gallery_cover_media_id_media_id_fkey" FOREIGN KEY ("cover_media_id") REFERENCES "media"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "video_gallery_item" ADD CONSTRAINT "video_gallery_item_gallery_id_video_gallery_id_fkey" FOREIGN KEY ("gallery_id") REFERENCES "video_gallery"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "video_gallery_item" ADD CONSTRAINT "video_gallery_item_media_id_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "video_gallery_item" ADD CONSTRAINT "video_gallery_item_thumbnail_media_id_media_id_fkey" FOREIGN KEY ("thumbnail_media_id") REFERENCES "media"("id") ON DELETE SET NULL;