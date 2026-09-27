/** Small helpers for Web-standard (Request → Response) Vercel functions. */

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export async function readJson<T = Record<string, unknown>>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

/** Last path segment: /api/station/heartbeat → "heartbeat". */
export const actionOf = (req: Request) => new URL(req.url).pathname.replace(/\/+$/, "").split("/").pop() ?? "";

/** Runs a handler and turns thrown errors into JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    console.error("[api] unexpected error:", err);
    return json({ error: "Internal error" }, 500);
  }
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ validation
export function num(v: unknown, name: string, min: number, max: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, `${name} must be a number between ${min} and ${max}`);
  return n;
}

export function str(v: unknown, name: string, maxLen = 200): string {
  if (typeof v !== "string" || !v.trim() || v.length > maxLen) throw new HttpError(400, `${name} is required (max ${maxLen} chars)`);
  return v.trim();
}

/** {"Left Bicep": 67, ...} — short keys, 0–100 values, at most 20 entries. */
export function musclePct(v: unknown): Record<string, number> {
  if (v == null) return {};
  if (typeof v !== "object" || Array.isArray(v)) throw new HttpError(400, "muscle_pct must be an object");
  const entries = Object.entries(v as Record<string, unknown>);
  if (entries.length > 20) throw new HttpError(400, "muscle_pct has too many entries");
  return Object.fromEntries(entries.map(([k, x]) => [str(k, "muscle name", 40), Math.round(num(x, k, 0, 100))]));
}
