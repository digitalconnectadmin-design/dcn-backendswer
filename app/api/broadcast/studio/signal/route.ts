import { headers } from "next/headers";
import { and, asc, eq, inArray, lt } from "drizzle-orm";

import { auth } from "@/lib/auth";
import { canManageNewsroom } from "@/lib/roles";
import { db } from "@/db/drizzle";
import { studioParticipant, studioSignal } from "@/db/schema";
import { participantByToken } from "@/lib/broadcast/studio-server";

export const dynamic = "force-dynamic";
/** Long polls hold the request open; this is the ceiling for one of them. */
export const maxDuration = 30;

/**
 * WebRTC signalling for the Web Studio, carried over the database because
 * this project has no socket server to run.
 *
 * Each side appends its offer / answer / ICE candidates and polls for the
 * other side's; a delivered row is deleted, so the table stays tiny and a
 * reconnect starts clean. **The media itself never touches the server** — it
 * goes peer-to-peer between the guest's browser and the operator's.
 *
 * Two kinds of caller:
 *   - the **operator**, authenticated by their session (canManageNewsroom);
 *   - a **remote participant**, authenticated only by the token in their join
 *     link, which is why the token is checked against the row (expiry and
 *     revocation included) on every single request rather than trusted once.
 */

type Side = "operator" | "participant";

async function resolveCaller(url: URL, body?: { token?: string; participantId?: string }) {
  const token = url.searchParams.get("token") ?? body?.token ?? null;
  if (token) {
    const participant = await participantByToken(token);
    if (!participant) return null;
    return { side: "participant" as Side, participantId: participant.id, name: participant.name, lastSeenAt: participant.lastSeenAt };
  }
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !canManageNewsroom(session.user.role)) return null;
  const participantId = url.searchParams.get("participantId") ?? body?.participantId ?? null;
  if (!participantId) return null;
  const [row] = await db
    .select({ id: studioParticipant.id, name: studioParticipant.name, lastSeenAt: studioParticipant.lastSeenAt })
    .from(studioParticipant)
    .where(eq(studioParticipant.id, participantId))
    .limit(1);
  if (!row) return null;
  return { side: "operator" as Side, participantId: row.id, name: row.name, lastSeenAt: row.lastSeenAt };
}

const noStore = { "cache-control": "no-store, max-age=0" };

/** ICE servers for both sides. A TURN relay is optional but is what makes
 *  restrictive mobile networks work; without it some guests won't connect. */
function iceServers() {
  const list: { urls: string | string[]; username?: string; credential?: string }[] = [
    { urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] },
  ];
  const turn = process.env.STUDIO_TURN_URL;
  if (turn) {
    list.push({
      urls: turn,
      username: process.env.STUDIO_TURN_USERNAME ?? undefined,
      credential: process.env.STUDIO_TURN_PASSWORD ?? undefined,
    });
  }
  return list;
}

/** Reads and consumes whatever the other side has written, if anything. */
async function drain(participantId: string, side: Side) {
  const other: Side = side === "operator" ? "participant" : "operator";
  // Read, then delete exactly those ids — a blanket delete would throw away a
  // message that arrived mid-request, unread.
  const rows = await db
    .select()
    .from(studioSignal)
    .where(and(eq(studioSignal.participantId, participantId), eq(studioSignal.fromSide, other)))
    .orderBy(asc(studioSignal.createdAt))
    .limit(60);
  if (rows.length) {
    await db.delete(studioSignal).where(
      inArray(
        studioSignal.id,
        rows.map((r) => r.id)
      )
    );
  }
  return rows;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function GET(request: Request) {
  const url = new URL(request.url);

  if (url.searchParams.get("mode") === "ice") {
    // Both sides need the same list; a participant has no session, so this is
    // deliberately readable with just a valid join token.
    const caller = await resolveCaller(url);
    if (!caller) return Response.json({ error: "Not allowed" }, { status: 401, headers: noStore });
    return Response.json({ iceServers: iceServers(), hasTurn: !!process.env.STUDIO_TURN_URL }, { headers: noStore });
  }

  const caller = await resolveCaller(url);
  if (!caller) return Response.json({ error: "Not allowed" }, { status: 401, headers: noStore });

  let rows = await drain(caller.participantId, caller.side);

  /**
   * Long poll. Each request from Bangladesh to a US function region costs the
   * best part of a second, so a 1.5s client timer meant an offer and its
   * answer could take many seconds to meet — and the requests piled up on top
   * of each other. Holding the request open instead delivers a message within
   * a few hundred milliseconds of it being written, with a fraction of the
   * traffic. `wait=0` (or no flag) keeps the old immediate behaviour.
   */
  const waitMs = Math.min(20_000, Math.max(0, Number(url.searchParams.get("wait") ?? 0)));
  if (rows.length === 0 && waitMs > 0) {
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await sleep(600);
      if (request.signal.aborted) return new Response(null, { status: 499 });
      rows = await drain(caller.participantId, caller.side);
      if (rows.length) break;
    }
  }

  // Housekeeping that doesn't need to happen on every poll: a stale-row sweep
  // now and then, and a heartbeat at most every 20 seconds.
  if (Math.random() < 0.05) {
    await db.delete(studioSignal).where(lt(studioSignal.createdAt, new Date(Date.now() - 5 * 60_000)));
  }
  if (caller.side === "participant" && (!caller.lastSeenAt || Date.now() - new Date(caller.lastSeenAt).getTime() > 20_000)) {
    await db.update(studioParticipant).set({ lastSeenAt: new Date() }).where(eq(studioParticipant.id, caller.participantId));
  }

  return Response.json(
    { messages: rows.map((r) => ({ id: r.id, kind: r.kind, payload: r.payload, at: r.createdAt })) },
    { headers: noStore }
  );
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  let body: {
    token?: string;
    participantId?: string;
    kind?: string;
    payload?: unknown;
    state?: "waiting" | "connected" | "left";
    videoQuality?: string;
    audioQuality?: string;
    networkQuality?: string;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Bad body" }, { status: 400, headers: noStore });
  }

  const caller = await resolveCaller(url, body);
  if (!caller) return Response.json({ error: "Not allowed" }, { status: 401, headers: noStore });

  // A participant reporting its own state: joining the waiting room, going
  // live, leaving, and what its own browser sees of the connection.
  if (body.kind === "state") {
    const set: Record<string, unknown> = { lastSeenAt: new Date() };
    if (body.state) set.state = body.state;
    if (typeof body.videoQuality === "string") set.videoQuality = body.videoQuality.slice(0, 40);
    if (typeof body.audioQuality === "string") set.audioQuality = body.audioQuality.slice(0, 40);
    if (typeof body.networkQuality === "string") set.networkQuality = body.networkQuality.slice(0, 40);
    await db.update(studioParticipant).set(set).where(eq(studioParticipant.id, caller.participantId));
    return Response.json({ ok: true }, { headers: noStore });
  }

  const kind = typeof body.kind === "string" ? body.kind.slice(0, 20) : "";
  if (!["offer", "answer", "candidate", "bye", "reoffer"].includes(kind)) {
    return Response.json({ error: "Unknown signal" }, { status: 400, headers: noStore });
  }
  // `payload` is NOT NULL in the table, so a missing one is a 400 rather than
  // a 500 from the insert. "reoffer" carries nothing, so it gets an empty object.
  if (body.payload == null && kind !== "bye" && kind !== "reoffer") {
    return Response.json({ error: "Missing payload" }, { status: 400, headers: noStore });
  }
  const payload = body.payload ?? {};
  // SDP and candidate blobs are small; anything much larger isn't signalling.
  if (JSON.stringify(payload ?? "").length > 200_000) {
    return Response.json({ error: "Payload too large" }, { status: 413, headers: noStore });
  }

  if (kind === "bye") {
    await db.delete(studioSignal).where(eq(studioSignal.participantId, caller.participantId));
    await db
      .update(studioParticipant)
      .set({ state: caller.side === "participant" ? "left" : "waiting", lastSeenAt: new Date() })
      .where(eq(studioParticipant.id, caller.participantId));
    return Response.json({ ok: true }, { headers: noStore });
  }

  // A fresh offer supersedes an earlier stalled negotiation from the same
  // side. Candidates are posted only after the offer has been stored (see
  // GuestPeer), so this can't wipe candidates that belong to it.
  if (kind === "offer") {
    await db
      .delete(studioSignal)
      .where(and(eq(studioSignal.participantId, caller.participantId), eq(studioSignal.fromSide, caller.side)));
  }

  await db.insert(studioSignal).values({
    participantId: caller.participantId,
    fromSide: caller.side,
    kind,
    payload: payload as object,
  });

  return Response.json({ ok: true }, { headers: noStore });
}
