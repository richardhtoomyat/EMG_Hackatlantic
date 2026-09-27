import { Redis } from "@upstash/redis";
import { env } from "./env.js";
import { HttpError } from "./http.js";

/**
 * Temporary hand-off for live data between the station's uploads and the web
 * app's polling. Nothing here is permanent: keys expire after TTL_S seconds.
 *   metrics  — latest live numbers (L/R %, reps, TUT, …)
 *   chunks   — the last MAX_CHUNKS batches of raw envelope samples, numbered by seq
 */
export interface LiveChunk {
  seq: number;
  samples: [number, number | null, number | null][]; // [t ms since set start, left raw, right raw]
}
export interface LiveSnapshot {
  metrics: Record<string, unknown> | null;
  chunks: LiveChunk[];
  seq: number;
}
interface LiveStore {
  push(stationId: string, metrics: Record<string, unknown>, samples: LiveChunk["samples"]): Promise<number>;
  since(stationId: string, since: number): Promise<LiveSnapshot>;
  clear(stationId: string): Promise<void>;
}

const TTL_S = 15;
const MAX_CHUNKS = 60; // ~12 s at 5 batches/s

class UpstashStore implements LiveStore {
  private redis: Redis;
  constructor(url: string, token: string) {
    this.redis = new Redis({ url, token });
  }
  private keys(id: string) {
    return { m: `live:m:${id}`, c: `live:c:${id}`, s: `live:s:${id}` };
  }
  async push(id: string, metrics: Record<string, unknown>, samples: LiveChunk["samples"]) {
    const k = this.keys(id);
    const seq = await this.redis.incr(k.s);
    const p = this.redis.pipeline();
    p.expire(k.s, TTL_S * 4);
    p.set(k.m, JSON.stringify(metrics), { ex: TTL_S });
    if (samples.length) {
      p.rpush(k.c, JSON.stringify({ seq, samples }));
      p.ltrim(k.c, -MAX_CHUNKS, -1);
      p.expire(k.c, TTL_S);
    }
    await p.exec();
    return seq;
  }
  async since(id: string, since: number): Promise<LiveSnapshot> {
    const k = this.keys(id);
    const [m, list, s] = await Promise.all([
      this.redis.get<string | Record<string, unknown>>(k.m),
      this.redis.lrange<string | LiveChunk>(k.c, 0, -1),
      this.redis.get<number | string>(k.s),
    ]);
    const parse = <T>(v: string | T): T => (typeof v === "string" ? (JSON.parse(v) as T) : v);
    const chunks = (list ?? []).map((c) => parse<LiveChunk>(c)).filter((c) => c.seq > since);
    return { metrics: m ? parse<Record<string, unknown>>(m) : null, chunks, seq: Number(s ?? 0) };
  }
  async clear(id: string) {
    const k = this.keys(id);
    await this.redis.del(k.m, k.c);
  }
}

/** Local tests only (single process). */
class MemoryStore implements LiveStore {
  private data = new Map<string, { metrics: Record<string, unknown> | null; chunks: LiveChunk[]; seq: number }>();
  private get(id: string) {
    if (!this.data.has(id)) this.data.set(id, { metrics: null, chunks: [], seq: 0 });
    return this.data.get(id)!;
  }
  async push(id: string, metrics: Record<string, unknown>, samples: LiveChunk["samples"]) {
    const d = this.get(id);
    d.seq += 1;
    d.metrics = metrics;
    if (samples.length) d.chunks = [...d.chunks, { seq: d.seq, samples }].slice(-MAX_CHUNKS);
    return d.seq;
  }
  async since(id: string, since: number) {
    const d = this.get(id);
    return { metrics: d.metrics, chunks: d.chunks.filter((c) => c.seq > since), seq: d.seq };
  }
  async clear(id: string) {
    const d = this.get(id);
    d.metrics = null;
    d.chunks = [];
  }
}

let store: LiveStore | null = null;
export function live(): LiveStore {
  if (!store) {
    const e = env();
    if (e.memoryLiveStore) store = new MemoryStore();
    else if (e.redisUrl && e.redisToken) store = new UpstashStore(e.redisUrl, e.redisToken);
    else throw new HttpError(503, "Live stream not configured: add Upstash Redis to the Vercel project");
  }
  return store;
}
