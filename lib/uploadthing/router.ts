import { createUploadthing, UploadThingError } from "uploadthing/server";
import type { FileRouter } from "uploadthing/server";
import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { canManageNewsroom } from "@/lib/roles";
import { db } from "@/db/drizzle";
import { media } from "@/db/schema";

const f = createUploadthing();

/**
 * Uploads go client -> UploadThing directly; this server only authorises the
 * request and records the resulting asset. That matters because server actions
 * cap request bodies at a few megabytes, so routing raw video through our own
 * server would fail on any real file.
 *
 * `middleware` runs before the browser is handed an upload token, so an
 * unauthenticated or under-privileged user never gets one.
 */
const requireUploader = async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UploadThingError("You must be signed in to upload.");
  if (!canManageNewsroom(session.user.role)) {
    throw new UploadThingError("Your role can't upload media.");
  }
  return { userId: session.user.id };
};

/**
 * Wider than `requireUploader`: any signed-in staff account, not just
 * admin/chief_editor. The Story Pipeline needs a reporter to upload their own
 * photos/video/audio/documents for an assigned story — uploading a file for
 * your own assignment isn't the newsroom-management privilege that gates the
 * classic Stories/Reels admin (see lib/pipeline/permissions.ts for the full
 * reasoning). Access to any *specific* story is still checked separately by
 * the pipeline server actions before an upload is attached to it.
 */
const requireStaffUploader = async () => {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) throw new UploadThingError("You must be signed in to upload.");
  return { userId: session.user.id };
};

export const uploadRouter = {
  imageUploader: f({
    image: { maxFileSize: "8MB", maxFileCount: 20 },
  })
    .middleware(requireUploader)
    .onUploadComplete(async ({ metadata, file }) => {
      const [row] = await db
        .insert(media)
        .values({
          url: file.ufsUrl,
          storageKey: file.key,
          kind: "image",
          mimeType: file.type,
          sizeBytes: file.size,
          uploadedById: metadata.userId,
        })
        .returning({ id: media.id, url: media.url });

      // Whatever is returned here is delivered to the client callback.
      return { mediaId: row.id, url: row.url };
    }),

  videoUploader: f({
    video: { maxFileSize: "512MB", maxFileCount: 5 },
  })
    .middleware(requireUploader)
    .onUploadComplete(async ({ metadata, file }) => {
      const [row] = await db
        .insert(media)
        .values({
          url: file.ufsUrl,
          storageKey: file.key,
          kind: "video",
          mimeType: file.type,
          sizeBytes: file.size,
          uploadedById: metadata.userId,
        })
        .returning({ id: media.id, url: media.url });

      return { mediaId: row.id, url: row.url };
    }),

  // --- Story Pipeline uploads: open to any signed-in staff account (see
  // requireStaffUploader above), since these are a reporter's own attachments
  // on their own assigned story rather than newsroom-management actions. ---

  pipelineImageUploader: f({
    image: { maxFileSize: "8MB", maxFileCount: 20 },
  })
    .middleware(requireStaffUploader)
    .onUploadComplete(async ({ metadata, file }) => {
      const [row] = await db
        .insert(media)
        .values({
          url: file.ufsUrl,
          storageKey: file.key,
          kind: "image",
          mimeType: file.type,
          sizeBytes: file.size,
          uploadedById: metadata.userId,
        })
        .returning({ id: media.id, url: media.url });
      return { mediaId: row.id, url: row.url };
    }),

  pipelineVideoUploader: f({
    video: { maxFileSize: "512MB", maxFileCount: 5 },
  })
    .middleware(requireStaffUploader)
    .onUploadComplete(async ({ metadata, file }) => {
      const [row] = await db
        .insert(media)
        .values({
          url: file.ufsUrl,
          storageKey: file.key,
          kind: "video",
          mimeType: file.type,
          sizeBytes: file.size,
          uploadedById: metadata.userId,
        })
        .returning({ id: media.id, url: media.url });
      return { mediaId: row.id, url: row.url };
    }),

  pipelineAudioUploader: f({
    audio: { maxFileSize: "64MB", maxFileCount: 5 },
  })
    .middleware(requireStaffUploader)
    .onUploadComplete(async ({ metadata, file }) => {
      const [row] = await db
        .insert(media)
        .values({
          url: file.ufsUrl,
          storageKey: file.key,
          kind: "audio",
          mimeType: file.type,
          sizeBytes: file.size,
          uploadedById: metadata.userId,
        })
        .returning({ id: media.id, url: media.url });
      return { mediaId: row.id, url: row.url };
    }),

  // UploadThing's route config only recognises a fixed set of type keys
  // (image/video/audio/pdf/text/blob) — "blob" is the catch-all used here so
  // a reporter can attach a Word doc, spreadsheet or other source document,
  // not just a PDF.
  pipelineDocumentUploader: f({
    pdf: { maxFileSize: "16MB", maxFileCount: 5 },
    blob: { maxFileSize: "16MB", maxFileCount: 5 },
  })
    .middleware(requireStaffUploader)
    .onUploadComplete(async ({ metadata, file }) => {
      const [row] = await db
        .insert(media)
        .values({
          url: file.ufsUrl,
          storageKey: file.key,
          kind: "document",
          mimeType: file.type,
          sizeBytes: file.size,
          uploadedById: metadata.userId,
        })
        .returning({ id: media.id, url: media.url });
      return { mediaId: row.id, url: row.url };
    }),
  /**
   * Story-pitch supporting material. One endpoint rather than the pipeline's
   * three because a reporter attaching research to an idea shouldn't have to
   * work out in advance which button a `.docx` goes under — the `media.kind`
   * is derived from the file's own MIME type instead. Same staff gate as the
   * pipeline uploaders: pitching is open to any signed-in account, and access
   * to a *specific* pitch is re-checked by `attachPitchMedia` before the upload
   * is linked to it.
   */
  pitchAttachmentUploader: f({
    image: { maxFileSize: "8MB", maxFileCount: 10 },
    pdf: { maxFileSize: "16MB", maxFileCount: 10 },
    blob: { maxFileSize: "16MB", maxFileCount: 10 },
  })
    .middleware(requireStaffUploader)
    .onUploadComplete(async ({ metadata, file }) => {
      const mime = file.type ?? "";
      const kind = mime.startsWith("image/")
        ? "image"
        : mime.startsWith("video/")
          ? "video"
          : mime.startsWith("audio/")
            ? "audio"
            : "document";
      const [row] = await db
        .insert(media)
        .values({
          url: file.ufsUrl,
          storageKey: file.key,
          kind,
          mimeType: mime || "application/octet-stream",
          sizeBytes: file.size,
          uploadedById: metadata.userId,
        })
        .returning({ id: media.id, url: media.url });
      if (!row) throw new UploadThingError("The upload couldn't be recorded. Please try again.");
      // `name` is echoed back so the pitch can show the original filename —
      // `media` has no column for one.
      return { mediaId: row.id, url: row.url, name: file.name, kind, size: file.size };
    }),
} satisfies FileRouter;

export type UploadRouter = typeof uploadRouter;
