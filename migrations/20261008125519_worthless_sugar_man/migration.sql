CREATE TYPE "board_role" AS ENUM('owner', 'manager', 'member');--> statement-breakpoint
CREATE TYPE "cg_air_status" AS ENUM('on_air', 'queued', 'done');--> statement-breakpoint
CREATE TYPE "cg_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "cg_type" AS ENUM('lower_third', 'breaking', 'channel_bug', 'full_frame', 'two_box', 'credits', 'data_plate', 'custom');--> statement-breakpoint
CREATE TYPE "feed_item_status" AS ENUM('new', 'translating', 'summarising', 'ready', 'failed', 'converted', 'rejected');--> statement-breakpoint
CREATE TYPE "feed_source_status" AS ENUM('healthy', 'fetching', 'error', 'disabled');--> statement-breakpoint
CREATE TYPE "live_destination_status" AS ENUM('pending', 'created', 'live', 'ended', 'failed');--> statement-breakpoint
CREATE TYPE "live_event_status" AS ENUM('draft', 'scheduled', 'ready', 'live', 'ended', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "photocard_status" AS ENUM('draft', 'active', 'archived');--> statement-breakpoint
CREATE TYPE "photocard_visibility" AS ENUM('private', 'admin', 'editors', 'article_desk', 'everyone');--> statement-breakpoint
CREATE TYPE "pitch_note_visibility" AS ENUM('internal', 'shared');--> statement-breakpoint
CREATE TYPE "pitch_rejection_reason" AS ENUM('duplicate', 'not_suitable', 'insufficient_information', 'outside_scope', 'already_covered', 'timing', 'other');--> statement-breakpoint
CREATE TYPE "pitch_status" AS ENUM('draft', 'pending_review', 'needs_changes', 'approved', 'assigned', 'in_progress', 'submitted', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "social_content_type" AS ENUM('post', 'reel', 'story', 'video', 'short');--> statement-breakpoint
CREATE TYPE "story_placement" AS ENUM('normal', 'lead', 'second_lead');--> statement-breakpoint
CREATE TYPE "story_priority" AS ENUM('low', 'normal', 'high', 'urgent', 'breaking');--> statement-breakpoint
CREATE TYPE "story_stage" AS ENUM('assignment', 'draft', 'nm_desk', 'qc', 'publish');--> statement-breakpoint
CREATE TYPE "story_type" AS ENUM('news', 'feature', 'opinion', 'investigation', 'interview', 'analysis');--> statement-breakpoint
CREATE TYPE "story_workflow_status" AS ENUM('assigned', 'draft', 'submitted', 'under_review', 'changes_requested', 'ready', 'held', 'in_qc', 'approved', 'scheduled', 'published', 'rejected', 'archived');--> statement-breakpoint
CREATE TYPE "task_priority" AS ENUM('low', 'medium', 'high', 'urgent');--> statement-breakpoint
CREATE TYPE "ticker_priority" AS ENUM('normal', 'high', 'breaking');--> statement-breakpoint
ALTER TYPE "social_post_status" ADD VALUE 'scheduled';--> statement-breakpoint
ALTER TYPE "social_post_status" ADD VALUE 'publishing';--> statement-breakpoint
ALTER TYPE "social_post_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "board" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"description" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_column" (
	"id" text PRIMARY KEY,
	"board_id" text NOT NULL,
	"name" text NOT NULL,
	"position" double precision DEFAULT 1000 NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_label" (
	"id" text PRIMARY KEY,
	"board_id" text NOT NULL,
	"name" text NOT NULL,
	"color" text DEFAULT '#77A4CE' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "board_member" (
	"board_id" text,
	"user_id" text,
	"board_role" "board_role" DEFAULT 'member'::"board_role" NOT NULL,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "board_member_pkey" PRIMARY KEY("board_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "brand_kit" (
	"id" text PRIMARY KEY DEFAULT 'default',
	"colors" jsonb NOT NULL,
	"fonts" jsonb NOT NULL,
	"assets" jsonb NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cg_air_item" (
	"id" text PRIMARY KEY,
	"template_id" text,
	"label" text NOT NULL,
	"document" jsonb NOT NULL,
	"fields" jsonb NOT NULL,
	"values" jsonb NOT NULL,
	"animation_in" text DEFAULT 'fade' NOT NULL,
	"animation_out" text DEFAULT 'fade' NOT NULL,
	"animation_ms" integer DEFAULT 400 NOT NULL,
	"layer" integer DEFAULT 2 NOT NULL,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"status" "cg_air_status" DEFAULT 'queued'::"cg_air_status" NOT NULL,
	"position" double precision DEFAULT 0 NOT NULL,
	"story_id" text,
	"data_source_id" text,
	"expires_at" timestamp,
	"started_at" timestamp,
	"ended_at" timestamp,
	"operator_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cg_channel" (
	"key" text PRIMARY KEY,
	"version" integer DEFAULT 0 NOT NULL,
	"output_key" text NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cg_data_source" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"kind" text DEFAULT 'custom' NOT NULL,
	"config" jsonb NOT NULL,
	"refresh_sec" integer DEFAULT 60 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_values" jsonb,
	"last_fetched_at" timestamp,
	"last_error" text,
	"created_by_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cg_event" (
	"id" text PRIMARY KEY,
	"action" text NOT NULL,
	"label" text NOT NULL,
	"detail" text,
	"template_id" text,
	"air_item_id" text,
	"duration_ms" integer,
	"operator_id" text,
	"at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cg_favorite" (
	"user_id" text,
	"template_id" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "cg_favorite_pkey" PRIMARY KEY("user_id","template_id")
);
--> statement-breakpoint
CREATE TABLE "cg_template" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"type" "cg_type" NOT NULL,
	"category" text DEFAULT 'custom' NOT NULL,
	"status" "cg_status" DEFAULT 'active'::"cg_status" NOT NULL,
	"document" jsonb NOT NULL,
	"fields" jsonb NOT NULL,
	"values" jsonb,
	"draft_document" jsonb,
	"draft_fields" jsonb,
	"draft_meta" jsonb,
	"animation_in" text DEFAULT 'fade' NOT NULL,
	"animation_out" text DEFAULT 'fade' NOT NULL,
	"animation_ms" integer DEFAULT 400 NOT NULL,
	"duration_sec" integer DEFAULT 0 NOT NULL,
	"layer" integer DEFAULT 2 NOT NULL,
	"is_emergency" boolean DEFAULT false NOT NULL,
	"needs_check" boolean DEFAULT false NOT NULL,
	"data_source_id" text,
	"created_by_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"last_used_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "feed_event" (
	"id" text PRIMARY KEY,
	"item_id" text NOT NULL,
	"label" text NOT NULL,
	"detail" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_item" (
	"id" text PRIMARY KEY,
	"source_id" text NOT NULL,
	"guid" text NOT NULL,
	"original_title" text NOT NULL,
	"original_body" text,
	"original_url" text NOT NULL,
	"original_language" text DEFAULT 'en' NOT NULL,
	"image_url" text,
	"published_at" timestamp,
	"bangla_title" text,
	"bangla_body" text,
	"bangla_summary" text,
	"key_points" jsonb,
	"ai_category" text,
	"ai_location" text,
	"ai_entities" jsonb,
	"editor_category" text,
	"status" "feed_item_status" DEFAULT 'new'::"feed_item_status" NOT NULL,
	"last_error" text,
	"translation_runs" integer DEFAULT 0 NOT NULL,
	"summary_runs" integer DEFAULT 0 NOT NULL,
	"story_id" text,
	"converted_at" timestamp,
	"converted_by_id" text,
	"story_key" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feed_source" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"default_category" text,
	"language" text DEFAULT 'en' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"status" "feed_source_status" DEFAULT 'healthy'::"feed_source_status" NOT NULL,
	"last_error" text,
	"last_fetched_at" timestamp,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homepage_layout" (
	"key" text PRIMARY KEY,
	"sections" jsonb NOT NULL,
	"updated_by_id" text,
	"updated_at" timestamp NOT NULL,
	"published_by_id" text,
	"published_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "live_comment" (
	"id" text PRIMARY KEY,
	"event_id" text NOT NULL,
	"destination_id" text NOT NULL,
	"platform" "social_platform" NOT NULL,
	"external_id" text NOT NULL,
	"author_name" text,
	"author_avatar_url" text,
	"message" text NOT NULL,
	"posted_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_destination" (
	"id" text PRIMARY KEY,
	"event_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"platform" "social_platform" NOT NULL,
	"account_label" text NOT NULL,
	"status" "live_destination_status" DEFAULT 'pending'::"live_destination_status" NOT NULL,
	"external_video_id" text,
	"external_stream_id" text,
	"chat_id" text,
	"chat_page_token" text,
	"chat_next_poll_at" timestamp,
	"last_polled_at" timestamp,
	"permalink" text,
	"viewers" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_event" (
	"id" text PRIMARY KEY,
	"title" text NOT NULL,
	"description" text,
	"status" "live_event_status" DEFAULT 'draft'::"live_event_status" NOT NULL,
	"source" text DEFAULT 'program' NOT NULL,
	"width" integer DEFAULT 1920 NOT NULL,
	"height" integer DEFAULT 1080 NOT NULL,
	"fps" integer DEFAULT 30 NOT NULL,
	"video_bitrate_kbps" integer DEFAULT 4500 NOT NULL,
	"audio_bitrate_kbps" integer DEFAULT 128 NOT NULL,
	"scheduled_for" timestamp,
	"started_at" timestamp,
	"ended_at" timestamp,
	"relay_session_id" text,
	"error_message" text,
	"peak_viewers" integer DEFAULT 0 NOT NULL,
	"story_id" text,
	"created_by_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_event_log" (
	"id" text PRIMARY KEY,
	"event_id" text NOT NULL,
	"message" text NOT NULL,
	"level" text DEFAULT 'info' NOT NULL,
	"actor_id" text,
	"at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "live_viewer_sample" (
	"id" text PRIMARY KEY,
	"event_id" text NOT NULL,
	"viewers" integer NOT NULL,
	"at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY,
	"user_id" text NOT NULL,
	"message" text NOT NULL,
	"task_id" text,
	"board_id" text,
	"story_id" text,
	"pitch_id" text,
	"read_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photocard_favorite" (
	"user_id" text,
	"template_id" text,
	"created_at" timestamp NOT NULL,
	CONSTRAINT "photocard_favorite_pkey" PRIMARY KEY("user_id","template_id")
);
--> statement-breakpoint
CREATE TABLE "photocard_template" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"category" text DEFAULT 'Custom' NOT NULL,
	"status" "photocard_status" DEFAULT 'draft'::"photocard_status" NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"document" jsonb NOT NULL,
	"visibility" "photocard_visibility" DEFAULT 'everyone'::"photocard_visibility" NOT NULL,
	"created_by_id" text,
	"frame_image_url" text,
	"text_layers" jsonb,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "photocard_template_version" (
	"id" text PRIMARY KEY,
	"template_id" text NOT NULL,
	"label" text NOT NULL,
	"document" jsonb NOT NULL,
	"created_by_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pitch_attachment" (
	"id" text PRIMARY KEY,
	"pitch_id" text NOT NULL,
	"media_id" text NOT NULL,
	"label" text,
	"position" integer DEFAULT 0 NOT NULL,
	"uploaded_by_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pitch_event" (
	"id" text PRIMARY KEY,
	"pitch_id" text NOT NULL,
	"actor_id" text,
	"message" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pitch_note" (
	"id" text PRIMARY KEY,
	"pitch_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"visibility" "pitch_note_visibility" DEFAULT 'shared'::"pitch_note_visibility" NOT NULL,
	"kind" text,
	"edited_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "site_setting" (
	"key" text PRIMARY KEY,
	"value" jsonb NOT NULL,
	"updated_by_id" text,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_account_group" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"created_by_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_account_group_member" (
	"group_id" text,
	"connection_id" text,
	CONSTRAINT "social_account_group_member_pkey" PRIMARY KEY("group_id","connection_id")
);
--> statement-breakpoint
CREATE TABLE "social_audit_log" (
	"id" text PRIMARY KEY,
	"connection_id" text,
	"platform" "social_platform",
	"account_label" text,
	"actor_id" text,
	"action" text NOT NULL,
	"detail" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_publication" (
	"id" text PRIMARY KEY,
	"title" text NOT NULL,
	"source_kind" text NOT NULL,
	"story_id" text,
	"reel_id" text,
	"created_by_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_activity" (
	"id" text PRIMARY KEY,
	"story_id" text NOT NULL,
	"actor_id" text,
	"message" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_comment" (
	"id" text PRIMARY KEY,
	"story_id" text NOT NULL,
	"author_id" text,
	"parent_id" text,
	"body" text NOT NULL,
	"context" text,
	"resolved" boolean DEFAULT false NOT NULL,
	"resolved_by_id" text,
	"resolved_at" timestamp,
	"edited_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_media" (
	"id" text PRIMARY KEY,
	"story_id" text NOT NULL,
	"media_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"caption" text,
	"credit" text,
	"uploaded_by_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_pitch" (
	"id" text PRIMARY KEY,
	"title" text NOT NULL,
	"category" text,
	"category_id" text,
	"story_type" "story_type" DEFAULT 'news'::"story_type" NOT NULL,
	"priority" "story_priority" DEFAULT 'normal'::"story_priority" NOT NULL,
	"status" "pitch_status" DEFAULT 'draft'::"pitch_status" NOT NULL,
	"description" text,
	"plan" text,
	"sources" text,
	"estimated_completion" text,
	"estimated_date" timestamp,
	"reporter_id" text,
	"created_by_id" text,
	"assigned_editor_id" text,
	"deadline" timestamp,
	"editor_note" text,
	"rejection_reason" "pitch_rejection_reason",
	"rejection_note" text,
	"rejected_by_id" text,
	"rejected_at" timestamp,
	"approved_by_id" text,
	"approved_at" timestamp,
	"story_id" text,
	"reopened" boolean DEFAULT false NOT NULL,
	"submitted_at" timestamp,
	"resubmit_count" integer DEFAULT 0 NOT NULL,
	"assigning_at" timestamp,
	"is_demo" boolean DEFAULT false NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "story_revision" (
	"id" text PRIMARY KEY,
	"story_id" text NOT NULL,
	"label" text NOT NULL,
	"snapshot" jsonb NOT NULL,
	"created_by_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_event" (
	"id" text PRIMARY KEY,
	"action" text NOT NULL,
	"from_label" text,
	"to_label" text,
	"detail" text,
	"operator_id" text,
	"at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_participant" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"location" text,
	"token" text NOT NULL,
	"state" text DEFAULT 'invited' NOT NULL,
	"video_quality" text,
	"audio_quality" text,
	"network_quality" text,
	"last_seen_at" timestamp,
	"expires_at" timestamp,
	"invited_by_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_signal" (
	"id" text PRIMARY KEY,
	"participant_id" text NOT NULL,
	"from_side" text NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "studio_source" (
	"id" text PRIMARY KEY,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"location" text,
	"notes" text,
	"device_id" text,
	"url" text,
	"poster_url" text,
	"participant_id" text,
	"position" double precision DEFAULT 0 NOT NULL,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"created_by_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subtask" (
	"id" text PRIMARY KEY,
	"task_id" text NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"position" double precision DEFAULT 1000 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task" (
	"id" text PRIMARY KEY,
	"board_id" text NOT NULL,
	"column_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"priority" "task_priority" DEFAULT 'medium'::"task_priority" NOT NULL,
	"position" double precision DEFAULT 1000 NOT NULL,
	"start_date" timestamp,
	"due_date" timestamp,
	"completed_at" timestamp,
	"completed_by_id" text,
	"archived" boolean DEFAULT false NOT NULL,
	"created_by_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_activity" (
	"id" text PRIMARY KEY,
	"task_id" text NOT NULL,
	"actor_id" text,
	"message" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_assignee" (
	"task_id" text,
	"user_id" text,
	CONSTRAINT "task_assignee_pkey" PRIMARY KEY("task_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "task_attachment" (
	"id" text PRIMARY KEY,
	"task_id" text NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"uploaded_by_id" text,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_comment" (
	"id" text PRIMARY KEY,
	"task_id" text NOT NULL,
	"author_id" text,
	"body" text NOT NULL,
	"edited_at" timestamp,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_label" (
	"task_id" text,
	"label_id" text,
	CONSTRAINT "task_label_pkey" PRIMARY KEY("task_id","label_id")
);
--> statement-breakpoint
CREATE TABLE "ticker_item" (
	"id" text PRIMARY KEY,
	"text" text NOT NULL,
	"story_id" text,
	"priority" "ticker_priority" DEFAULT 'normal'::"ticker_priority" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"starts_at" timestamp,
	"expires_at" timestamp,
	"position" double precision DEFAULT 0 NOT NULL,
	"created_by_id" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "follower_count" integer;--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "account_type" text;--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "needs_attention" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "health_message" text;--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "last_checked_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "last_posted_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "deactivated_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "deactivated_by_id" text;--> statement-breakpoint
ALTER TABLE "social_connection" ADD COLUMN "updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "publication_id" text;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "content_type" "social_content_type";--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "account_label" text;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "caption" text;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "title" text;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "link_url" text;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "media" jsonb;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "thumbnail_url" text;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "options" jsonb;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "scheduled_for" timestamp;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "last_attempt_at" timestamp;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "permalink" text;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "warning" text;--> statement-breakpoint
ALTER TABLE "social_post" ADD COLUMN "created_by_id" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "image_credit" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "view_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "photocard_template_id" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "photocard_image_url" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "pipeline_stage" "story_stage";--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "pipeline_status" "story_workflow_status";--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "priority" "story_priority" DEFAULT 'normal'::"story_priority" NOT NULL;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "story_type" "story_type" DEFAULT 'news'::"story_type" NOT NULL;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "deadline" timestamp;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "instructions" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "assigned_editor_id" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "assigned_by_id" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "pitch_id" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "last_saved_at" timestamp;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "submitted_at" timestamp;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "desk_placement" "story_placement" DEFAULT 'normal'::"story_placement" NOT NULL;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "hold_reason" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "held_by_id" text;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "held_at" timestamp;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "is_demo" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "qc_checklist" jsonb;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "scheduled_for" timestamp;--> statement-breakpoint
ALTER TABLE "story" ADD COLUMN "publish_connection_ids" text[];--> statement-breakpoint
CREATE INDEX "cg_air_item_status_idx" ON "cg_air_item" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "feed_item_source_guid_idx" ON "feed_item" ("source_id","guid");--> statement-breakpoint
CREATE INDEX "live_comment_event_idx" ON "live_comment" ("event_id","posted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "live_comment_unique_idx" ON "live_comment" ("destination_id","external_id");--> statement-breakpoint
CREATE INDEX "live_destination_event_idx" ON "live_destination" ("event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "live_destination_unique_idx" ON "live_destination" ("event_id","connection_id");--> statement-breakpoint
CREATE INDEX "live_event_status_idx" ON "live_event" ("status","created_at");--> statement-breakpoint
CREATE INDEX "live_event_log_event_idx" ON "live_event_log" ("event_id","at");--> statement-breakpoint
CREATE INDEX "live_viewer_sample_event_idx" ON "live_viewer_sample" ("event_id","at");--> statement-breakpoint
CREATE INDEX "pitch_attachment_pitch_idx" ON "pitch_attachment" ("pitch_id");--> statement-breakpoint
CREATE INDEX "pitch_event_pitch_idx" ON "pitch_event" ("pitch_id","created_at");--> statement-breakpoint
CREATE INDEX "pitch_note_pitch_idx" ON "pitch_note" ("pitch_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "story_pitch_unique_idx" ON "story" ("pitch_id");--> statement-breakpoint
CREATE INDEX "story_pitch_status_idx" ON "story_pitch" ("status");--> statement-breakpoint
CREATE INDEX "story_pitch_reporter_idx" ON "story_pitch" ("reporter_id");--> statement-breakpoint
CREATE INDEX "story_pitch_created_idx" ON "story_pitch" ("created_at");--> statement-breakpoint
CREATE INDEX "studio_participant_token_idx" ON "studio_participant" ("token");--> statement-breakpoint
CREATE INDEX "studio_signal_participant_idx" ON "studio_signal" ("participant_id","from_side");--> statement-breakpoint
ALTER TABLE "board" ADD CONSTRAINT "board_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "board_column" ADD CONSTRAINT "board_column_board_id_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "board_label" ADD CONSTRAINT "board_label_board_id_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_board_id_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "board_member" ADD CONSTRAINT "board_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cg_air_item" ADD CONSTRAINT "cg_air_item_template_id_cg_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "cg_template"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cg_air_item" ADD CONSTRAINT "cg_air_item_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cg_air_item" ADD CONSTRAINT "cg_air_item_data_source_id_cg_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "cg_data_source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cg_air_item" ADD CONSTRAINT "cg_air_item_operator_id_user_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cg_data_source" ADD CONSTRAINT "cg_data_source_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cg_event" ADD CONSTRAINT "cg_event_template_id_cg_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "cg_template"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cg_event" ADD CONSTRAINT "cg_event_operator_id_user_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cg_favorite" ADD CONSTRAINT "cg_favorite_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cg_favorite" ADD CONSTRAINT "cg_favorite_template_id_cg_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "cg_template"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "cg_template" ADD CONSTRAINT "cg_template_data_source_id_cg_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "cg_data_source"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "cg_template" ADD CONSTRAINT "cg_template_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "feed_event" ADD CONSTRAINT "feed_event_item_id_feed_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "feed_item"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feed_item" ADD CONSTRAINT "feed_item_source_id_feed_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "feed_source"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "feed_item" ADD CONSTRAINT "feed_item_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "feed_item" ADD CONSTRAINT "feed_item_converted_by_id_user_id_fkey" FOREIGN KEY ("converted_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "homepage_layout" ADD CONSTRAINT "homepage_layout_updated_by_id_user_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "homepage_layout" ADD CONSTRAINT "homepage_layout_published_by_id_user_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "live_comment" ADD CONSTRAINT "live_comment_event_id_live_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "live_event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "live_comment" ADD CONSTRAINT "live_comment_destination_id_live_destination_id_fkey" FOREIGN KEY ("destination_id") REFERENCES "live_destination"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "live_destination" ADD CONSTRAINT "live_destination_event_id_live_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "live_event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "live_destination" ADD CONSTRAINT "live_destination_connection_id_social_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "live_event" ADD CONSTRAINT "live_event_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "live_event" ADD CONSTRAINT "live_event_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "live_event_log" ADD CONSTRAINT "live_event_log_event_id_live_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "live_event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "live_event_log" ADD CONSTRAINT "live_event_log_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "live_viewer_sample" ADD CONSTRAINT "live_viewer_sample_event_id_live_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "live_event"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_board_id_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_pitch_id_story_pitch_id_fkey" FOREIGN KEY ("pitch_id") REFERENCES "story_pitch"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "photocard_favorite" ADD CONSTRAINT "photocard_favorite_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "photocard_favorite" ADD CONSTRAINT "photocard_favorite_template_id_photocard_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "photocard_template"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "photocard_template" ADD CONSTRAINT "photocard_template_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "photocard_template_version" ADD CONSTRAINT "photocard_template_version_z1P5p8XjsV9x_fkey" FOREIGN KEY ("template_id") REFERENCES "photocard_template"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "photocard_template_version" ADD CONSTRAINT "photocard_template_version_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "pitch_attachment" ADD CONSTRAINT "pitch_attachment_pitch_id_story_pitch_id_fkey" FOREIGN KEY ("pitch_id") REFERENCES "story_pitch"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pitch_attachment" ADD CONSTRAINT "pitch_attachment_media_id_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pitch_attachment" ADD CONSTRAINT "pitch_attachment_uploaded_by_id_user_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "pitch_event" ADD CONSTRAINT "pitch_event_pitch_id_story_pitch_id_fkey" FOREIGN KEY ("pitch_id") REFERENCES "story_pitch"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pitch_event" ADD CONSTRAINT "pitch_event_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "pitch_note" ADD CONSTRAINT "pitch_note_pitch_id_story_pitch_id_fkey" FOREIGN KEY ("pitch_id") REFERENCES "story_pitch"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "pitch_note" ADD CONSTRAINT "pitch_note_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "site_setting" ADD CONSTRAINT "site_setting_updated_by_id_user_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social_account_group" ADD CONSTRAINT "social_account_group_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social_account_group_member" ADD CONSTRAINT "social_account_group_member_bkAGM8ZWjNjc_fkey" FOREIGN KEY ("group_id") REFERENCES "social_account_group"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_account_group_member" ADD CONSTRAINT "social_account_group_member_ERNU1Sn8FfhG_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connection"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_audit_log" ADD CONSTRAINT "social_audit_log_connection_id_social_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connection"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social_audit_log" ADD CONSTRAINT "social_audit_log_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social_connection" ADD CONSTRAINT "social_connection_deactivated_by_id_user_id_fkey" FOREIGN KEY ("deactivated_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_publication_id_social_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "social_publication"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "social_post" ADD CONSTRAINT "social_post_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social_publication" ADD CONSTRAINT "social_publication_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social_publication" ADD CONSTRAINT "social_publication_reel_id_reel_id_fkey" FOREIGN KEY ("reel_id") REFERENCES "reel"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "social_publication" ADD CONSTRAINT "social_publication_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_photocard_template_id_photocard_template_id_fkey" FOREIGN KEY ("photocard_template_id") REFERENCES "photocard_template"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_assigned_editor_id_user_id_fkey" FOREIGN KEY ("assigned_editor_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_assigned_by_id_user_id_fkey" FOREIGN KEY ("assigned_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_pitch_id_story_pitch_id_fkey" FOREIGN KEY ("pitch_id") REFERENCES "story_pitch"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story" ADD CONSTRAINT "story_held_by_id_user_id_fkey" FOREIGN KEY ("held_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_activity" ADD CONSTRAINT "story_activity_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "story_activity" ADD CONSTRAINT "story_activity_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_comment" ADD CONSTRAINT "story_comment_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "story_comment" ADD CONSTRAINT "story_comment_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_comment" ADD CONSTRAINT "story_comment_parent_id_story_comment_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "story_comment"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "story_comment" ADD CONSTRAINT "story_comment_resolved_by_id_user_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_media" ADD CONSTRAINT "story_media_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "story_media" ADD CONSTRAINT "story_media_media_id_media_id_fkey" FOREIGN KEY ("media_id") REFERENCES "media"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "story_media" ADD CONSTRAINT "story_media_uploaded_by_id_user_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_pitch" ADD CONSTRAINT "story_pitch_category_id_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "category"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_pitch" ADD CONSTRAINT "story_pitch_reporter_id_user_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_pitch" ADD CONSTRAINT "story_pitch_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_pitch" ADD CONSTRAINT "story_pitch_assigned_editor_id_user_id_fkey" FOREIGN KEY ("assigned_editor_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_pitch" ADD CONSTRAINT "story_pitch_rejected_by_id_user_id_fkey" FOREIGN KEY ("rejected_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_pitch" ADD CONSTRAINT "story_pitch_approved_by_id_user_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_pitch" ADD CONSTRAINT "story_pitch_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "story_revision" ADD CONSTRAINT "story_revision_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "story_revision" ADD CONSTRAINT "story_revision_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "studio_event" ADD CONSTRAINT "studio_event_operator_id_user_id_fkey" FOREIGN KEY ("operator_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "studio_participant" ADD CONSTRAINT "studio_participant_invited_by_id_user_id_fkey" FOREIGN KEY ("invited_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "studio_signal" ADD CONSTRAINT "studio_signal_participant_id_studio_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "studio_participant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "studio_source" ADD CONSTRAINT "studio_source_participant_id_studio_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "studio_participant"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "studio_source" ADD CONSTRAINT "studio_source_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "subtask" ADD CONSTRAINT "subtask_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_board_id_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "board"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_column_id_board_column_id_fkey" FOREIGN KEY ("column_id") REFERENCES "board_column"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_completed_by_id_user_id_fkey" FOREIGN KEY ("completed_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task" ADD CONSTRAINT "task_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_activity" ADD CONSTRAINT "task_activity_actor_id_user_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_assignee" ADD CONSTRAINT "task_assignee_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_assignee" ADD CONSTRAINT "task_assignee_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_attachment" ADD CONSTRAINT "task_attachment_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_attachment" ADD CONSTRAINT "task_attachment_uploaded_by_id_user_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_comment" ADD CONSTRAINT "task_comment_author_id_user_id_fkey" FOREIGN KEY ("author_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "task_label" ADD CONSTRAINT "task_label_task_id_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "task"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "task_label" ADD CONSTRAINT "task_label_label_id_board_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "board_label"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ticker_item" ADD CONSTRAINT "ticker_item_story_id_story_id_fkey" FOREIGN KEY ("story_id") REFERENCES "story"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ticker_item" ADD CONSTRAINT "ticker_item_created_by_id_user_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "user"("id") ON DELETE SET NULL;