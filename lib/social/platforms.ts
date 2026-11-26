import type { SocialPlatformName } from "@/lib/social/content";

/** Client-safe platform vocabulary (no publisher code). */
export const PLATFORM_LABELS: Record<SocialPlatformName, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
  x: "X",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
};

/** What one connected account is called on each platform, for "Connect another …". */
export const ACCOUNT_NOUN: Record<SocialPlatformName, string> = {
  facebook: "Facebook Page",
  instagram: "Instagram account",
  youtube: "YouTube channel",
  x: "X account",
  linkedin: "LinkedIn account",
  tiktok: "TikTok account",
};

/**
 * How "connect another account" actually works on each platform — shown
 * under the button, because on some platforms it depends on which account
 * the browser is signed in to, not on anything this app controls.
 */
export const CONNECT_ANOTHER_HINT: Record<SocialPlatformName, string> = {
  facebook:
    "Facebook only lists Pages you've granted. If one is missing, choose “Edit access” on Facebook's screen and tick it.",
  instagram:
    "Instagram professional accounts come through their linked Facebook Pages — grant the Page on Facebook's screen.",
  youtube: "Google will ask which account or Brand Account to use — pick the channel you want to add.",
  x: "X connects whichever account is signed in on x.com. Switch accounts there first to add a different one.",
  linkedin: "LinkedIn connects whichever member is signed in on linkedin.com. Sign in as the other member first.",
  tiktok: "TikTok will ask you to confirm the account — switch accounts on TikTok's screen to add a different one.",
};

export const PLATFORM_ORDER: SocialPlatformName[] = ["facebook", "instagram", "youtube", "x", "linkedin", "tiktok"];
