/**
 * Known-good wire feeds, offered as one-click presets when adding a source.
 *
 * Every major publisher hides its feed at a different path, and a newsroom
 * editor has no reason to know them — this removes the most common point of
 * failure when setting the desk up. Auto-discovery (see `resolveFeedUrl`)
 * handles everything not listed here.
 */
export type FeedPreset = { name: string; url: string; category: string };

export const FEED_PRESETS: FeedPreset[] = [
  { name: "BBC — World", url: "https://feeds.bbci.co.uk/news/world/rss.xml", category: "World" },
  { name: "BBC — South Asia", url: "https://feeds.bbci.co.uk/news/world/asia/rss.xml", category: "South Asia" },
  { name: "BBC — Business", url: "https://feeds.bbci.co.uk/news/business/rss.xml", category: "Business" },
  { name: "BBC — Technology", url: "https://feeds.bbci.co.uk/news/technology/rss.xml", category: "Technology" },
  { name: "BBC — Science", url: "https://feeds.bbci.co.uk/news/science_and_environment/rss.xml", category: "Science" },
  { name: "BBC — Health", url: "https://feeds.bbci.co.uk/news/health/rss.xml", category: "Health" },
  { name: "Al Jazeera — All", url: "https://www.aljazeera.com/xml/rss/all.xml", category: "International" },
  { name: "The Guardian — World", url: "https://www.theguardian.com/world/rss", category: "World" },
  { name: "NPR — World", url: "https://feeds.npr.org/1004/rss.xml", category: "World" },
  { name: "TechCrunch", url: "https://techcrunch.com/feed/", category: "Technology" },
  { name: "TechCrunch — AI", url: "https://techcrunch.com/category/artificial-intelligence/feed/", category: "AI" },
  { name: "Ars Technica", url: "https://feeds.arstechnica.com/arstechnica/index", category: "Technology" },
  { name: "The Verge", url: "https://www.theverge.com/rss/index.xml", category: "Technology" },
  { name: "UN News", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", category: "International" },
];
