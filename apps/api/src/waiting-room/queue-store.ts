import { randomBytes, randomInt } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { Redis } from 'ioredis';

import { REDIS } from '../infra/redis.module.js';

/** Prefix of every waiting-room key in Redis. `POST /__test/reset` deletes them all. */
export const QUEUE_KEY_PREFIX = 'testtix:queue';

/**
 * Queue order (sorted-set score). Customers who join before sales open get a random score below
 * `POST_OPEN_BASE`, so they are let in in a random order once sales open; later ones get
 * `POST_OPEN_BASE` plus their join time, so they follow in join order. Both stay exact integers
 * in a double (below 2^53) for join times up to the year 2109.
 */
export const POST_OPEN_BASE = 2 ** 42;
const PRE_OPEN_RANGE = 2 ** 40;

/** Per-event keys. */
function eventKeys(eventId: string) {
  const base = `${QUEUE_KEY_PREFIX}:event:${eventId}`;
  return {
    /** ZSET userId → queue order, of customers still waiting. */
    waiting: `${base}:waiting`,
    /** ZSET userId → admission expiry (epoch ms, server clock), of customers let in. */
    admitted: `${base}:admitted`,
    /** HASH userId → "<queue token> <admission token> <joined at ms>". */
    entries: `${base}:entries`,
    /** HASH: `nextBatchAt` (when the next batch goes in), `admitted` (count), `rate`. */
    meta: `${base}:meta`,
  };
}

const GLOBAL_KEYS = {
  /** HASH queue token → "<event ID> <user ID>". */
  tokens: `${QUEUE_KEY_PREFIX}:tokens`,
  /** HASH admission token → "<event ID> <user ID>". */
  admissions: `${QUEUE_KEY_PREFIX}:admissions`,
  /** SET of event IDs with customers waiting: the admission job's work list. */
  active: `${QUEUE_KEY_PREFIX}:active`,
  /** SET of every event ID that has had a queue (for `/metrics`). */
  events: `${QUEUE_KEY_PREFIX}:events`,
};

/*
 * Joins the queue, or returns the customer's current entry: one entry per customer and event
 * while it is waiting or its admission is unexpired. An expired admission is replaced by a new
 * entry at the back (its tokens stop working). Returns { created (0|1), entry }.
 */
const JOIN_SCRIPT = `
local existing = redis.call('HGET', KEYS[1], ARGV[1])
if existing then
  local expiresAt = redis.call('ZSCORE', KEYS[3], ARGV[1])
  if (not expiresAt) or tonumber(expiresAt) > tonumber(ARGV[5]) then
    return {0, existing}
  end
  local oldToken, oldAdmission = string.match(existing, '^(%S+) (%S+)')
  redis.call('HDEL', KEYS[4], oldToken)
  redis.call('HDEL', KEYS[5], oldAdmission)
  redis.call('ZREM', KEYS[3], ARGV[1])
end
local entry = ARGV[2] .. ' ' .. ARGV[3] .. ' ' .. ARGV[5]
local owner = ARGV[6] .. ' ' .. ARGV[1]
redis.call('HSET', KEYS[1], ARGV[1], entry)
redis.call('ZADD', KEYS[2], ARGV[4], ARGV[1])
redis.call('HSET', KEYS[4], ARGV[2], owner)
redis.call('HSET', KEYS[5], ARGV[3], owner)
redis.call('SADD', KEYS[6], ARGV[6])
redis.call('SADD', KEYS[7], ARGV[6])
return {1, entry}
`;

/*
 * Lets the next customers of one event in, at the server time ARGV[1]. Batch i goes in at
 * nextBatchAt + i seconds with ARGV[3] customers (0: everyone), so after a jump of the clock the
 * batches that fell due all go in at once. The first batch is due when sales open, or when the
 * first customer of an idle queue joined. Without anyone waiting the cursor is dropped, so an idle
 * queue saves up no batches. Returns how many were let in.
 */
const ADMIT_SCRIPT = `
local now = tonumber(ARGV[1])
local open = tonumber(ARGV[2])
local rate = tonumber(ARGV[3])
redis.call('HSET', KEYS[3], 'rate', ARGV[3])
if now < open then return 0 end
local waiting = redis.call('ZCARD', KEYS[1])
if waiting == 0 then
  redis.call('HDEL', KEYS[3], 'nextBatchAt')
  redis.call('SREM', KEYS[4], ARGV[5])
  return 0
end
local count = waiting
local nextBatchAt = nil
if rate > 0 then
  local cursor = redis.call('HGET', KEYS[3], 'nextBatchAt')
  if cursor then
    cursor = math.max(tonumber(cursor), open)
  else
    local first = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
    local score = tonumber(first[2])
    local base = tonumber(ARGV[6])
    if score >= base then cursor = math.max(open, score - base) else cursor = open end
  end
  if now < cursor then return 0 end
  local batches = math.floor((now - cursor) / 1000) + 1
  count = batches * rate
  nextBatchAt = cursor + batches * 1000
end
local popped = redis.call('ZPOPMIN', KEYS[1], count)
local expiresAt = string.format('%.0f', now + tonumber(ARGV[4]))
local admitted = 0
for i = 1, #popped, 2 do
  redis.call('ZADD', KEYS[2], expiresAt, popped[i])
  admitted = admitted + 1
end
redis.call('HINCRBY', KEYS[3], 'admitted', admitted)
if redis.call('ZCARD', KEYS[1]) == 0 then
  redis.call('HDEL', KEYS[3], 'nextBatchAt')
  redis.call('SREM', KEYS[4], ARGV[5])
elseif nextBatchAt then
  redis.call('HSET', KEYS[3], 'nextBatchAt', string.format('%.0f', nextBatchAt))
end
return admitted
`;

/** A customer's queue entry as stored. */
export interface StoredEntry {
  eventId: string;
  userId: string;
  token: string;
  admissionToken: string;
  joinedAt: Date;
  /** 0-based place among those waiting; null once let in. */
  rank: number | null;
  /** When the admission ends (server clock); null while waiting. */
  admissionExpiresAt: Date | null;
  /** Customers still waiting for this event. */
  waitingCount: number;
  /** When the next batch is due, if a batch has gone in since the queue was last empty. */
  nextBatchAt: Date | null;
}

/** Waiting-room numbers of one event, for `/metrics`. */
export interface QueueStats {
  eventId: string;
  waiting: number;
  admittedTotal: number;
  /** The rate the admission job last applied (0: let everyone in). Null before its first run. */
  ratePerSec: number | null;
}

export interface AdmitInput {
  eventId: string;
  now: Date;
  /** Nobody goes in before this time. */
  opensAt: Date;
  /** Customers per second; 0 lets everyone in. */
  ratePerSec: number;
  admissionTtlMs: number;
}

/**
 * The waiting rooms' state in Redis (C5.1): one sorted set of waiting customers per event, the
 * admitted customers with their expiry, and token lookups. Writes that must be atomic (joining,
 * letting customers in) are Lua scripts, so concurrent requests, replicas and workers never see a
 * half-done change. Times are server-clock milliseconds passed in by the caller; Redis key
 * expiry (real time) is never used.
 */
@Injectable()
export class QueueStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** Whether Redis is reachable right now (commands fail fast otherwise). */
  isReady(): boolean {
    return this.redis.status === 'ready';
  }

  /**
   * Joins `userId` to the event's queue, or returns their current entry (still waiting, or let in
   * and unexpired). `beforeOpen` decides the queue order: random before sales open, join order
   * after.
   */
  async join(
    eventId: string,
    userId: string,
    now: Date,
    beforeOpen: boolean,
  ): Promise<{ created: boolean; entry: StoredEntry }> {
    const keys = eventKeys(eventId);
    const score = beforeOpen ? randomInt(0, PRE_OPEN_RANGE) : POST_OPEN_BASE + now.getTime();
    const result = (await this.redis.eval(
      JOIN_SCRIPT,
      7,
      keys.entries,
      keys.waiting,
      keys.admitted,
      GLOBAL_KEYS.tokens,
      GLOBAL_KEYS.admissions,
      GLOBAL_KEYS.active,
      GLOBAL_KEYS.events,
      userId,
      newToken(),
      newToken(),
      String(score),
      String(now.getTime()),
      eventId,
    )) as [number, string];
    const entry = await this.read(eventId, userId);
    if (entry === null) throw new Error(`Queue entry of ${userId} for ${eventId} vanished`);
    return { created: result[0] === 1, entry };
  }

  /** The entry a queue token belongs to, or null for unknown (or replaced) tokens. */
  async findByToken(token: string): Promise<StoredEntry | null> {
    const owner = parseOwner(await this.redis.hget(GLOBAL_KEYS.tokens, token));
    if (owner === null) return null;
    const entry = await this.read(owner.eventId, owner.userId);
    return entry?.token === token ? entry : null;
  }

  /** The entry an admission token belongs to, or null for unknown (or replaced) tokens. */
  async findByAdmissionToken(admissionToken: string): Promise<StoredEntry | null> {
    const owner = parseOwner(await this.redis.hget(GLOBAL_KEYS.admissions, admissionToken));
    if (owner === null) return null;
    const entry = await this.read(owner.eventId, owner.userId);
    return entry?.admissionToken === admissionToken ? entry : null;
  }

  /** Event IDs with customers waiting. */
  async activeEventIds(): Promise<string[]> {
    return this.redis.smembers(GLOBAL_KEYS.active);
  }

  /** Lets the next customers of one event in (see `ADMIT_SCRIPT`). Returns how many. */
  async admit(input: AdmitInput): Promise<number> {
    const keys = eventKeys(input.eventId);
    return (await this.redis.eval(
      ADMIT_SCRIPT,
      4,
      keys.waiting,
      keys.admitted,
      keys.meta,
      GLOBAL_KEYS.active,
      String(input.now.getTime()),
      String(input.opensAt.getTime()),
      String(input.ratePerSec),
      String(input.admissionTtlMs),
      input.eventId,
      String(POST_OPEN_BASE),
    )) as number;
  }

  /** Stops the admission job from looking at an event (it no longer exists). */
  async deactivate(eventId: string): Promise<void> {
    await this.redis.srem(GLOBAL_KEYS.active, eventId);
  }

  /** Per-event numbers of every event that has had a queue. */
  async stats(): Promise<QueueStats[]> {
    const eventIds = (await this.redis.smembers(GLOBAL_KEYS.events)).sort();
    if (eventIds.length === 0) return [];
    const pipeline = this.redis.pipeline();
    for (const eventId of eventIds) {
      const keys = eventKeys(eventId);
      pipeline.zcard(keys.waiting);
      pipeline.hmget(keys.meta, 'admitted', 'rate');
    }
    const results = unwrap(await pipeline.exec());
    return eventIds.map((eventId, index) => {
      const waiting = results[index * 2] as number;
      const [admitted, rate] = results[index * 2 + 1] as [string | null, string | null];
      return {
        eventId,
        waiting,
        admittedTotal: admitted === null ? 0 : Number(admitted),
        ratePerSec: rate === null ? null : Number(rate),
      };
    });
  }

  /** Deletes every waiting room (test reset). */
  async clear(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${QUEUE_KEY_PREFIX}:*`,
        'COUNT',
        1000,
      );
      if (keys.length > 0) await this.redis.unlink(...keys);
      cursor = next;
    } while (cursor !== '0');
  }

  private async read(eventId: string, userId: string): Promise<StoredEntry | null> {
    const keys = eventKeys(eventId);
    const results = unwrap(
      await this.redis
        .pipeline()
        .hget(keys.entries, userId)
        .zrank(keys.waiting, userId)
        .zscore(keys.admitted, userId)
        .zcard(keys.waiting)
        .hget(keys.meta, 'nextBatchAt')
        .exec(),
    );
    const [raw, rank, expiresAt, waitingCount, nextBatchAt] = results as [
      string | null,
      number | null,
      string | null,
      number,
      string | null,
    ];
    if (raw === null) return null;
    const [token = '', admissionToken = '', joinedAt = ''] = raw.split(' ');
    return {
      eventId,
      userId,
      token,
      admissionToken,
      joinedAt: new Date(Number(joinedAt)),
      // A customer let in is no longer in the waiting set; checked first in case of a stale rank.
      rank: expiresAt === null ? rank : null,
      admissionExpiresAt: expiresAt === null ? null : new Date(Number(expiresAt)),
      waitingCount,
      nextBatchAt: nextBatchAt === null ? null : new Date(Number(nextBatchAt)),
    };
  }
}

/** An unguessable token (144 bits, URL-safe). */
function newToken(): string {
  return randomBytes(18).toString('base64url');
}

function parseOwner(value: string | null): { eventId: string; userId: string } | null {
  if (value === null) return null;
  const [eventId, userId] = value.split(' ');
  if (eventId === undefined || userId === undefined) return null;
  return { eventId, userId };
}

/** The results of a pipeline, throwing its first error. */
function unwrap(results: [Error | null, unknown][] | null): unknown[] {
  if (results === null) throw new Error('Redis pipeline was discarded');
  return results.map(([err, value]) => {
    if (err !== null) throw err;
    return value;
  });
}
