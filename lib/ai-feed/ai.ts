/**
 * Translation and summarisation via the Anthropic Messages API.
 *
 * SERVER ONLY. There's no `server-only` package in this project to enforce it
 * at build time, so the guard is by convention: this module is imported solely
 * from `"use server"` action files and route handlers. It reads
 * ANTHROPIC_API_KEY, which must never reach the browser — do not import it
 * from a client component.
 *
 * Called with `fetch` rather than the SDK because the project doesn't depend
 * on it and this is the only place an LLM is used — one function's worth of
 * HTTP isn't worth a dependency.
 *
 * REQUIRES `ANTHROPIC_API_KEY` in the environment. Without it every call
 * throws a readable error that surfaces in the item's `lastError` and the
 * Retry button, rather than silently producing nothing.
 */

import { AI_CATEGORIES } from "@/lib/ai-feed/categories";

const MODEL = "claude-sonnet-4-6";
const ENDPOINT = "https://api.anthropic.com/v1/messages";

export { AI_CATEGORIES };

/**
 * The newsroom contract, prepended to every call. Stated as hard prohibitions
 * rather than style advice because the failure mode that matters here is a
 * model quietly inventing a number or a quote that an editor then publishes
 * under the masthead.
 */
const NEWSROOM_RULES = `You are assisting a Bangladeshi newsroom. These rules are absolute:
- Use ONLY information present in the source text. Never add facts, context or background from your own knowledge.
- Never invent or alter quotes, names, numbers, dates, statistics or place names.
- Preserve attribution exactly ("according to X", "police said") — never present an attributed claim as established fact.
- Preserve uncertainty ("reportedly", "alleged", "is expected to") — never harden speculation into fact.
- Never add opinion, editorial framing, or political slant.
- If the source is too thin to summarise, say so in the field rather than padding it.
- Write natural, professional Bangla news prose — not transliterated English, not machine-literal translation.
Return ONLY valid JSON. No markdown fences, no commentary before or after.`;

type AnthropicContentBlock = { type: string; text?: string };

/**
 * Turns an API failure into something an editor can act on.
 *
 * The raw body ("Your credit balance is too low…" wrapped in JSON, under a
 * bare 400) tells a newsroom editor nothing about what to do, and worse, reads
 * like the article failed — when in fact the account needs topping up and the
 * same article will process fine afterwards. These are account/infrastructure
 * states, not content problems, and the message should say so.
 */
async function describeApiError(res: Response): Promise<Error> {
  const raw = await res.text().catch(() => "");
  let apiMessage = "";
  try {
    apiMessage = (JSON.parse(raw) as { error?: { message?: string } }).error?.message ?? "";
  } catch {
    apiMessage = raw.slice(0, 200);
  }
  const lower = apiMessage.toLowerCase();

  if (lower.includes("credit balance") || lower.includes("billing") || lower.includes("quota")) {
    return new Error(
      "The Anthropic account is out of credit, so translation and summarising can't run. " +
        "Top up at console.anthropic.com (Plans & Billing), then press Retry — nothing was lost."
    );
  }
  if (res.status === 401 || lower.includes("authentication") || lower.includes("api key")) {
    return new Error(
      "The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in your environment, then press Retry."
    );
  }
  if (res.status === 429 || lower.includes("rate limit")) {
    return new Error("Hit the AI rate limit. Wait a minute, then press Retry.");
  }
  if (res.status >= 500) {
    return new Error("The AI service is temporarily unavailable. Press Retry shortly.");
  }
  return new Error(`AI request failed (${res.status}). ${apiMessage || "No detail returned."}`);
}

/**
 * Failures that will recur until a human fixes the account, so there's no
 * point auto-retrying the rest of the queue against them.
 */
export function isAccountLevelFailure(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("out of credit") || m.includes("api key was rejected") || m.includes("rate limit");
}

async function callModel(prompt: string, maxTokens = 2000): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — add it to .env to enable AI translation and summarising."
    );
  }

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: NEWSROOM_RULES,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    throw await describeApiError(res);
  }

  const data = (await res.json()) as { content?: AnthropicContentBlock[] };
  const text = (data.content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();
  if (!text) throw new Error("The AI returned an empty response.");
  return text;
}

/** Models sometimes wrap JSON in fences despite instructions; tolerate it. */
function parseJson<T>(raw: string): T {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Last resort: the outermost {...} in the response.
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1)) as T;
    }
    throw new Error("The AI response wasn't valid JSON.");
  }
}

export type TranslationResult = { banglaTitle: string; banglaBody: string };

export async function translateToBangla(
  title: string,
  body: string | null
): Promise<TranslationResult> {
  const raw = await callModel(
    `Translate this wire article into Bangla.

Return JSON exactly: {"banglaTitle": string, "banglaBody": string}

- banglaTitle: the headline in Bangla. Keep it headline-length; do not add detail the original headline doesn't carry.
- banglaBody: the article text in Bangla, translated faithfully. Keep paragraph breaks as \\n\\n.

SOURCE HEADLINE: ${title}

SOURCE TEXT: ${body ?? "(The feed provided no body text — translate the headline only and set banglaBody to an empty string.)"}`
  );
  const parsed = parseJson<TranslationResult>(raw);
  if (!parsed.banglaTitle) throw new Error("The AI didn't return a Bangla headline.");
  return { banglaTitle: parsed.banglaTitle, banglaBody: parsed.banglaBody ?? "" };
}

export type SummaryResult = {
  banglaSummary: string;
  keyPoints: string[];
  category: string;
  location: string | null;
  entities: string[];
};

export async function summariseForNewsroom(
  title: string,
  body: string | null
): Promise<SummaryResult> {
  const raw = await callModel(
    `Summarise this wire article for a Bangladeshi news desk.

Return JSON exactly:
{"banglaSummary": string, "keyPoints": string[], "category": string, "location": string | null, "entities": string[]}

- banglaSummary: 2-4 sentences of Bangla. Factual, no opinion.
- keyPoints: 3-5 short Bangla bullet points of the most important facts.
- category: exactly one of ${AI_CATEGORIES.join(", ")}.
- location: the country or place the story concerns, in Bangla, or null if not applicable.
- entities: important people or organisations named IN THE SOURCE. Empty array if none. Do not add any not present.

SOURCE HEADLINE: ${title}

SOURCE TEXT: ${body ?? "(No body text was provided; base the summary on the headline alone and keep it short.)"}`
  );
  const parsed = parseJson<Partial<SummaryResult>>(raw);
  if (!parsed.banglaSummary) throw new Error("The AI didn't return a summary.");
  return {
    banglaSummary: parsed.banglaSummary,
    keyPoints: Array.isArray(parsed.keyPoints) ? parsed.keyPoints.slice(0, 6) : [],
    // Guard the category rather than trusting it — an off-list value would
    // break the category filter downstream.
    category: (AI_CATEGORIES as readonly string[]).includes(parsed.category ?? "")
      ? (parsed.category as string)
      : "World",
    location: parsed.location ?? null,
    entities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 10) : [],
  };
}

export function aiIsConfigured(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}
