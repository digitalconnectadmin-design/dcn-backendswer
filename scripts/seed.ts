/**
 * Seeds the starter content a fresh install needs: newsroom categories, and
 * the About Us / Contact Us pages that the footer expects to link to.
 *
 * Safe to run more than once — every insert is keyed on slug and skips rows
 * that already exist, so it won't duplicate or overwrite edited content.
 *
 *   npm run seed
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/neon-http";
import { asc, eq } from "drizzle-orm";

import { category, page, user } from "../db/schema";

const db = drizzle(process.env.DATABASE_URL!);

const CATEGORIES = [
  { name: "বাংলাদেশ", slug: "bangladesh", position: 0 },
  { name: "আন্তর্জাতিক", slug: "international", position: 1 },
  { name: "অর্থনীতি", slug: "economy", position: 2 },
  { name: "খেলাধুলা", slug: "sports", position: 3 },
  { name: "প্রযুক্তি", slug: "technology", position: 4 },
  { name: "বিনোদন", slug: "entertainment", position: 5 },
  { name: "মতামত", slug: "opinion", position: 6 },
];

/** Tiptap document helpers — `page.body` stores JSON, never HTML. */
const p = (text: string) => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const h = (text: string) => ({
  type: "heading",
  attrs: { level: 2 },
  content: [{ type: "text", text }],
});
const doc = (...nodes: unknown[]) => ({ type: "doc", content: nodes });

const PAGES = [
  {
    slug: "about-us",
    title: "আমাদের সম্পর্কে",
    excerpt:
      "ডিজিটাল কানেক্ট নিউজ — অনলাইন, ব্রডকাস্ট ও মাল্টিমিডিয়া সংবাদ এক প্ল্যাটফর্মে।",
    metaTitle: "আমাদের সম্পর্কে",
    metaDescription:
      "ডিজিটাল কানেক্ট নিউজের পরিচিতি, সম্পাদকীয় নীতিমালা ও কর্মপদ্ধতি।",
    body: doc(
      p(
        "ডিজিটাল কানেক্ট নিউজ একটি বহুমাধ্যম সংবাদ প্রতিষ্ঠান। অনলাইন পোর্টাল, টেলিভিশন ব্রডকাস্ট এবং ডিজিটাল মাল্টিমিডিয়া — তিনটি মাধ্যমেই আমরা পাঠক ও দর্শকের কাছে পৌঁছাই।"
      ),
      h("আমাদের লক্ষ্য"),
      p(
        "নির্ভুল, নিরপেক্ষ এবং সময়োপযোগী সংবাদ পরিবেশন করা। প্রতিটি প্রতিবেদন প্রকাশের আগে আমাদের সম্পাদকীয় ও কোয়ালিটি কন্ট্রোল প্রক্রিয়ার মধ্য দিয়ে যায়।"
      ),
      h("সম্পাদকীয় নীতিমালা"),
      p(
        "আমরা তথ্যের উৎস যাচাই করি, একাধিক পক্ষের বক্তব্য নেওয়ার চেষ্টা করি এবং কোনো ভুল হলে তা দ্রুত সংশোধন করে পাঠককে জানাই।"
      )
    ),
  },
  {
    slug: "contact-us",
    title: "যোগাযোগ",
    excerpt: "সংবাদ, বিজ্ঞাপন বা যেকোনো মতামতের জন্য আমাদের সঙ্গে যোগাযোগ করুন।",
    metaTitle: "যোগাযোগ",
    metaDescription:
      "ডিজিটাল কানেক্ট নিউজের সম্পাদকীয় ও বিজ্ঞাপন বিভাগের যোগাযোগের ঠিকানা।",
    body: doc(
      p(
        "সংবাদ, বিজ্ঞাপন কিংবা যেকোনো মতামত ও অভিযোগের জন্য আমাদের সঙ্গে যোগাযোগ করুন।"
      ),
      h("সম্পাদকীয় বিভাগ"),
      p("ইমেইল: news@digitalconnectbd.com"),
      h("বিজ্ঞাপন বিভাগ"),
      p("ইমেইল: ads@digitalconnectbd.com"),
      h("ঠিকানা"),
      p("ঢাকা, বাংলাদেশ")
    ),
  },
];

async function main() {
  // Pages need an author; the earliest account is the closest thing to an
  // owner on a fresh install.
  const [owner] = await db
    .select({ id: user.id, name: user.name })
    .from(user)
    .orderBy(asc(user.createdAt))
    .limit(1);

  if (!owner) {
    console.error(
      "No users exist yet. Register an account first, then re-run this script."
    );
    process.exit(1);
  }

  let addedCategories = 0;
  for (const c of CATEGORIES) {
    const existing = await db
      .select({ id: category.id })
      .from(category)
      .where(eq(category.slug, c.slug))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(category).values(c);
    addedCategories++;
  }

  let addedPages = 0;
  for (const pg of PAGES) {
    const existing = await db
      .select({ id: page.id })
      .from(page)
      .where(eq(page.slug, pg.slug))
      .limit(1);
    if (existing.length > 0) continue;
    await db.insert(page).values({
      ...pg,
      status: "published",
      publishedAt: new Date(),
      showInFooter: true,
      authorId: owner.id,
    });
    addedPages++;
  }

  console.log(`Author: ${owner.name}`);
  console.log(
    `Categories: ${addedCategories} added, ${CATEGORIES.length - addedCategories} already present`
  );
  console.log(
    `Pages: ${addedPages} added, ${PAGES.length - addedPages} already present`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
