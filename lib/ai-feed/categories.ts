/**
 * The category vocabulary, in its own module with no server imports.
 *
 * It lives here rather than in ai.ts because client components (the sources
 * panel, the review form) need the list, and importing it from ai.ts would
 * pull a module that reads ANTHROPIC_API_KEY into the browser bundle.
 */
export const AI_CATEGORIES = [
  "World", "Politics", "Business", "Technology", "AI", "Science",
  "Health", "Sports", "Environment", "South Asia", "International",
] as const;

export type AiCategory = (typeof AI_CATEGORIES)[number];
