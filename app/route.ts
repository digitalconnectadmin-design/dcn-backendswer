/**
 * Root handler, so `/` answers something useful instead of Next's 404 page.
 *
 * A `route.ts` rather than a `page.tsx` on purpose: this project has no root
 * layout and no React at all, and adding a page would require one.
 *
 * Useful when someone opens the Render URL in a browser to check the service
 * is alive — the 404 that would otherwise greet them reads like a broken
 * deploy.
 */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    {
      service: "dcn-backend",
      description: "Digital Connect News API. No UI is served from here.",
      health: "/api/v1/health",
      docs: "See API.md in the repository for the endpoint map.",
    },
    { headers: { "cache-control": "no-store" } }
  );
}
