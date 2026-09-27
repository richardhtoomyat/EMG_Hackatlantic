import { Redis } from "@upstash/redis";
import { createClient } from "redis";
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
/** A line typed in the station's terminal (Test tab). */
export interface StationMessage {
  seq: number;
  at: number; // ms epoch
  text: string;
}
interface LiveStore {
  push(stationId: string, metrics: Record<string, unknown>, samples: LiveChunk["samples"]): Promise<number>;
  since(stationId: string, since: number): Promise<LiveSnapshot>;
  clear(stationId: string): Promise<void>;
  pushMessage(stationId: string, text: string): Promise<number>;
  messages(stationId: string, since: number): Promise<{ messages: StationMessage[]; seq: number }>;
  clearMessages(stationId: string): Promise<void>;
}

const TTL_S = 15;
const MAX_CHUNKS = 60; // ~12 s at 5 batches/s
const MSG_TTL_S = 600; // terminal messages: 10 minutes, and wiped when the user disconnects
const MAX_MESSAGES = 100;
const msgKeys = (id: string) => ({ l: `live:msg:${id}`, s: `live:msgseq:${id}` });

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
  async pushMessage(id: string, text: string) {
    const k = msgKeys(id);
    const seq = await this.redis.incr(k.s);
    const p = this.redis.pipeline();
    p.expire(k.s, MSG_TTL_S);
    p.rpush(k.l, JSON.stringify({ seq, at: Date.now(), text }));
    p.ltrim(k.l, -MAX_MESSAGES, -1);
    p.expire(k.l, MSG_TTL_S);
    await p.exec();
    return seq;
  }
  async messages(id: string, since: number) {
    const k = msgKeys(id);
    const [list, s] = await Promise.all([
      this.redis.lrange<string | StationMessage>(k.l, 0, -1),
      this.redis.get<number | string>(k.s),
    ]);
    const msgs = (list ?? []).map((m) => (typeof m === "string" ? (JSON.parse(m) as StationMessage) : m));
    return { messages: msgs.filter((m) => m.seq > since), seq: Number(s ?? 0) };
  }
  async clearMessages(id: string) {
    const k = msgKeys(id);
    await this.redis.del(k.l, k.s);
  }
}

/** Plain Redis over a redis:// connection (REDIS_URL), e.g. Vercel's "Redis" (Redis Cloud). */
class TcpRedisStore implements LiveStore {
  private client: ReturnType<typeof createClient>;
  private ready: Promise<unknown> | null = null;
  constructor(url: string) {
    this.client = createClient({ url, socket: { connectTimeout: 5000, reconnectStrategy: (n) => Math.min(n * 200, 2000) } });
    this.client.on("error", (err) => console.error("[live] redis error:", err instanceof Error ? err.message : err));
  }
  /** One connection per function instance, reused across requests. */
  private async redis() {
    if (!this.client.isOpen) this.ready ??= this.client.connect().finally(() => (this.ready = null));
    if (this.ready) await this.ready;
    return this.client;
  }
  private keys(id: string) {
    return { m: `live:m:${id}`, c: `live:c:${id}`, s: `live:s:${id}` };
  }
  async push(id: string, metrics: Record<string, unknown>, samples: LiveChunk["samples"]) {
    const r = await this.redis();
    const k = this.keys(id);
    const seq = await r.incr(k.s);
    const m = r.multi().expire(k.s, TTL_S * 4).set(k.m, JSON.stringify(metrics), { EX: TTL_S });
    if (samples.length) m.rPush(k.c, JSON.stringify({ seq, samples })).lTrim(k.c, -MAX_CHUNKS, -1).expire(k.c, TTL_S);
    await m.exec();
    return seq;
  }
  async since(id: string, since: number): Promise<LiveSnapshot> {
    const r = await this.redis();
    const k = this.keys(id);
    const [m, list, s] = await Promise.all([r.get(k.m), r.lRange(k.c, 0, -1), r.get(k.s)]);
    const chunks = list.map((c) => JSON.parse(c) as LiveChunk).filter((c) => c.seq > since);
    return { metrics: m ? (JSON.parse(m) as Record<string, unknown>) : null, chunks, seq: Number(s ?? 0) };
  }
  async clear(id: string) {
    const r = await this.redis();
    const k = this.keys(id);
    await r.del([k.m, k.c]);
  }
  async pushMessage(id: string, text: string) {
    const r = await this.redis();
    const k = msgKeys(id);
    const seq = await r.incr(k.s);
    await r
      .multi()
      .expire(k.s, MSG_TTL_S)
      .rPush(k.l, JSON.stringify({ seq, at: Date.now(), text }))
      .lTrim(k.l, -MAX_MESSAGES, -1)
      .expire(k.l, MSG_TTL_S)
      .exec();
    return seq;
  }
  async messages(id: string, since: number) {
    const r = await this.redis();
    const k = msgKeys(id);
    const [list, s] = await Promise.all([r.lRange(k.l, 0, -1), r.get(k.s)]);
    const msgs = list.map((m) => JSON.parse(m) as StationMessage);
    return { messages: msgs.filter((m) => m.seq > since), seq: Number(s ?? 0) };
  }
  async clearMessages(id: string) {
    const r = await this.redis();
    const k = msgKeys(id);
    await r.del([k.l, k.s]);
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
  private msgs = new Map<string, { list: StationMessage[]; seq: number }>();
  private msg(id: string) {
    if (!this.msgs.has(id)) this.msgs.set(id, { list: [], seq: 0 });
    return this.msgs.get(id)!;
  }
  async pushMessage(id: string, text: string) {
    const m = this.msg(id);
    m.seq += 1;
    m.list = [...m.list, { seq: m.seq, at: Date.now(), text }].slice(-MAX_MESSAGES);
    return m.seq;
  }
  async messages(id: string, since: number) {
    const m = this.msg(id);
    return { messages: m.list.filter((x) => x.seq > since), seq: m.seq };
  }
  async clearMessages(id: string) {
    this.msgs.delete(id);
  }
}

let store: LiveStore | null = null;
export function live(): LiveStore {
  if (!store) {
    const e = env();
    if (e.memoryLiveStore) store = new MemoryStore();
    else if (e.redisUrl && e.redisToken) store = new UpstashStore(e.redisUrl, e.redisToken);
    else if (e.redisConnectionUrl) store = new TcpRedisStore(e.redisConnectionUrl);
    else throw new HttpError(503, "Live stream not configured: connect a Redis database (Upstash or Redis) to the Vercel project");
  }
  return store;
}
