import type { SocialPlatform, SocialPublisher } from "@/lib/social/types";
import { facebookPublisher } from "@/lib/social/facebook";
import { instagramPublisher } from "@/lib/social/instagram";
import { youtubePublisher } from "@/lib/social/youtube";
import { xPublisher } from "@/lib/social/x";
import { linkedinPublisher } from "@/lib/social/linkedin";
import { tiktokPublisher } from "@/lib/social/tiktok";

// Labels live in lib/social/platforms.ts so client components can import
// them without pulling every publisher (and its server-only code) into the
// browser bundle. Re-exported here for existing server-side imports.
export { PLATFORM_LABELS } from "@/lib/social/platforms";

export const socialRegistry: Record<SocialPlatform, SocialPublisher> = {
  facebook: facebookPublisher,
  instagram: instagramPublisher,
  youtube: youtubePublisher,
  x: xPublisher,
  linkedin: linkedinPublisher,
  tiktok: tiktokPublisher,
};
