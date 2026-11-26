import { headers } from "next/headers";

import { auth } from "@/lib/auth";
import { canManageNewsroom } from "@/lib/roles";
import { ensureChannel, expireDueGraphics, getAirState, getVersion } from "@/lib/broadcast/cg-server";

export const dynamic = "force-dynamic";

/**
 * What is on air, for the operator's program preview and for the browser
 * source in OBS/vMix.
 *
 * `?mode=version` returns just the channel's change counter — a few bytes —
 * so a client can poll it twice a second and only fetch the full state when
 * something actually changed. There's no websocket infrastructure in this
 * project, so this is honest polling rather than push: a take reaches the
 * output within about half a second.
 *
 * Auth is either a signed-in operator or the channel's `key`, because a
 * browser source can't sign in. The key is in the URL, so treat the output
 * URL as a secret and rotate it from the CG page if it leaks.
 */
async function authorise(url: URL) {
  const key = url.searchParams.get("key");
  const channel = await ensureChannel();
  if (key && channel?.outputKey && key === channel.outputKey) return true;
  const session = await auth.api.getSession({ headers: await headers() });
  return !!session && canManageNewsroom(session.user.role);
}

/**
 * Times a due graphic off air. The output page calls this the instant one of
 * its own countdowns reaches zero, which is why the version poll doesn't have
 * to run an expiry write twice a second — and any read of the full state
 * expires due rows too, so the database is never left claiming something is
 * on air after its duration.
 */
export async function POST(request: Request) {
  const url = new URL(request.url);
  if (!(await authorise(url))) {
    return Response.json({ error: "Not allowed" }, { status: 401, headers: { "cache-control": "no-store" } });
  }
  const expired = await expireDueGraphics();
  return Response.json({ expired, version: await getVersion() }, { headers: { "cache-control": "no-store" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!(await authorise(url))) {
    return Response.json({ error: "Not allowed" }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  const noStore = { "cache-control": "no-store, max-age=0" };

  if (url.searchParams.get("mode") === "version") {
    // The sweep runs here too, not just on a full read: the output page also
    // times its own graphics off locally, but if that browser missed a take
    // (or its POST was dropped) this is what stops a row claiming to be on air
    // for hours. The WHERE matches nothing in the normal case, so it's cheap.
    await expireDueGraphics();
    return Response.json({ version: await getVersion() }, { headers: noStore });
  }

  const state = await getAirState();
  return Response.json(
    {
      version: state.version,
      serverTime: new Date().toISOString(),
      onAir: state.onAir.map((i) => ({
        id: i.id,
        templateId: i.templateId,
        label: i.label,
        layer: i.layer,
        document: i.document,
        values: i.values,
        animationIn: i.animationIn,
        animationOut: i.animationOut,
        animationMs: i.animationMs,
        startedAt: i.startedAt,
        expiresAt: i.expiresAt,
        operatorName: i.operatorName ?? null,
      })),
    },
    { headers: noStore }
  );
}
