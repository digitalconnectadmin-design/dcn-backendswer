import { corsHeaders } from "@/lib/api/cors";

/**
 * One response shape for the whole API, so the frontend never has to guess.
 *
 *   success → { ok: true,  data: T }
 *   failure → { ok: false, error: { message, code?, fields? } }
 *
 * This mirrors the `ActionResult` type the server actions returned
 * (`{ ok: true, message } | { ok: false, message }`), which means porting a
 * component is mostly a matter of changing where the result comes from rather
 * than how it is checked.
 */

export type ApiError = {
  message: string;
  /** Machine-readable, for cases the frontend must branch on. */
  code?: string;
  /** Per-field validation messages, keyed by form field name. */
  fields?: Record<string, string>;
};

export type ApiEnvelope<T> = { ok: true; data: T } | { ok: false; error: ApiError };

/** The codes the frontend is expected to handle specially. */
export const CODES = {
  UNAUTHENTICATED: "unauthenticated",
  FORBIDDEN: "forbidden",
  NOT_FOUND: "not_found",
  VALIDATION: "validation",
  MUST_CHANGE_PASSWORD: "must_change_password",
  INTERNAL: "internal",
} as const;

function base(request: Request): Record<string, string> {
  return {
    "content-type": "application/json; charset=utf-8",
    // Nothing in this API is cacheable by default. Public read endpoints opt
    // back in individually with `cache` below.
    "cache-control": "no-store",
    ...corsHeaders(request.headers.get("origin")),
  };
}

export function ok<T>(request: Request, data: T, init?: { status?: number; headers?: Record<string, string> }) {
  return new Response(JSON.stringify({ ok: true, data } satisfies ApiEnvelope<T>), {
    status: init?.status ?? 200,
    headers: { ...base(request), ...init?.headers },
  });
}

export function fail(
  request: Request,
  message: string,
  init?: { status?: number; code?: string; fields?: Record<string, string> }
) {
  const error: ApiError = { message };
  if (init?.code) error.code = init.code;
  if (init?.fields) error.fields = init.fields;

  return new Response(JSON.stringify({ ok: false, error } satisfies ApiEnvelope<never>), {
    status: init?.status ?? 400,
    headers: base(request),
  });
}

export const unauthenticated = (request: Request, message = "You need to sign in.") =>
  fail(request, message, { status: 401, code: CODES.UNAUTHENTICATED });

export const forbidden = (request: Request, message = "Your role can't do that.") =>
  fail(request, message, { status: 403, code: CODES.FORBIDDEN });

export const notFound = (request: Request, message = "Not found.") =>
  fail(request, message, { status: 404, code: CODES.NOT_FOUND });

export const invalid = (request: Request, message: string, fields?: Record<string, string>) =>
  fail(request, message, { status: 422, code: CODES.VALIDATION, fields });

/** Cache headers for a public read that may safely go stale for a moment. */
export function cache(seconds: number): Record<string, string> {
  return {
    "cache-control": `public, max-age=0, s-maxage=${seconds}, stale-while-revalidate=${seconds * 4}`,
  };
}

/**
 * Wraps a handler so a thrown error becomes a JSON envelope instead of
 * Next's HTML error page — which the frontend's `fetch` would try to parse as
 * JSON and fail on, reporting a parse error rather than the real problem.
 *
 * `HttpError` carries its own status; anything else is a bug and becomes a
 * 500 with its message hidden in production.
 */
export class HttpError extends Error {
  status: number;
  code?: string;
  fields?: Record<string, string>;

  constructor(status: number, message: string, opts?: { code?: string; fields?: Record<string, string> }) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = opts?.code;
    this.fields = opts?.fields;
  }
}

export function handler<Ctx>(fn: (request: Request, ctx: Ctx) => Promise<Response>) {
  return async (request: Request, ctx: Ctx): Promise<Response> => {
    try {
      return await fn(request, ctx);
    } catch (err) {
      if (err instanceof HttpError) {
        return fail(request, err.message, { status: err.status, code: err.code, fields: err.fields });
      }
      // Log the real thing for the Render logs, return something safe.
      console.error("[api] unhandled", err);
      return fail(
        request,
        process.env.NODE_ENV === "development" && err instanceof Error
          ? err.message
          : "Something went wrong on the server.",
        { status: 500, code: CODES.INTERNAL }
      );
    }
  };
}

/** Preflight. Every route group re-exports this as its `OPTIONS`. */
export function preflight(request: Request) {
  return new Response(null, { status: 204, headers: corsHeaders(request.headers.get("origin")) });
}
