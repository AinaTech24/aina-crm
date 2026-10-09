/**
 * BullMQ queue setup. We use Redis-backed queues for:
 *   - workflow.runner             — execute one step of a workflow run
 *   - outbox.poller               — internal scheduler that polls events_outbox
 *   - segment.materializer        — re-materialize dynamic segments
 *   - vartify.template_sync          — periodic sync of WhatsApp template approval status
 *   - comm.dispatch.{channel}     — channel-specific send queues (rate-limit per tenant)
 *   - master.scheduler            — cron-style triggers fire here
 *
 * Per-tenant rate limiting: BullMQ supports `limiter: { max, duration }` per
 * worker. We give each tenant their own queue suffix for sensitive
 * workloads to prevent noisy-neighbor (e.g., a tenant's 50k-message broadcast
 * starving another tenant's transactional comms).
 */

import { Queue, type ConnectionOptions } from "bullmq";
import IORedis from "ioredis";

let connection: ConnectionOptions | undefined;
let redisClient: IORedis | undefined;

export function redis() {
  if (!redisClient) {
    redisClient = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      maxRetriesPerRequest: null,
    });
  }
  return redisClient;
}

export function getConnection(): ConnectionOptions {
  if (!connection) {
    connection = { connection: redis() } as any;
  }
  return connection!;
}

const queues = new Map<string, Queue>();

export function queue(name: string): Queue {
  if (!queues.has(name)) {
    queues.set(
      name,
      new Queue(name, {
        connection: redis(),
        defaultJobOptions: {
          attempts: 5,
          backoff: { type: "exponential", delay: 2000 },
          removeOnComplete: { age: 86_400, count: 10_000 },
          removeOnFail: { age: 604_800 },
        },
      })
    );
  }
  return queues.get(name)!;
}

export class QueueUnavailableError extends Error {
  status = 503;
  constructor(name: string) {
    super(`The ${name} queue is unavailable right now — nothing was lost; try again shortly.`);
    this.name = "QueueUnavailableError";
  }
}

// Producer side for REQUEST paths: its own connection with the offline buffer
// OFF. The shared connection queues commands while Redis is down
// (maxRetriesPerRequest: null), so an add() there either hangs the request or —
// once timed out — is still delivered when Redis returns: the infrastructure
// check caught a file reported "queue unavailable" being imported anyway. Here
// a command is sent now or fails now; nothing is held back to run later.
let producerClient: IORedis | undefined;
function producerRedis() {
  if (!producerClient) {
    producerClient = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    producerClient.on("error", () => { /* reported per request by addWithin */ });
  }
  return producerClient;
}
const producerQueues = new Map<string, Queue>();
export function producerQueue(name: string): Queue {
  if (!producerQueues.has(name)) {
    producerQueues.set(name, new Queue(name, {
      connection: producerRedis(),
      defaultJobOptions: { attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: { age: 86_400, count: 10_000 }, removeOnFail: { age: 604_800 } },
    }));
  }
  return producerQueues.get(name)!;
}

/**
 * Is the producer connection usable now (waiting at most `ms` for it)? A
 * request path that only READS or REMOVES jobs checks this first: BullMQ itself
 * waits for a connection to become ready, so a command started while Redis is
 * down would otherwise run later, after the caller has given up on it.
 */
export async function producerReady(ms: number): Promise<boolean> {
  const client = producerRedis();
  if (client.status === "ready") return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onReady: (() => void) | undefined;
  try {
    return await Promise.race([
      new Promise<boolean>((resolve) => { onReady = () => resolve(true); client.once("ready", onReady); }),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (onReady) client.off("ready", onReady);
  }
}

/**
 * Enqueue from a request: wait (bounded) for the producer connection, then add.
 * Redis down → QueueUnavailableError, and the job does NOT exist — the caller
 * records that, and nothing runs behind its back later.
 */
export async function addWithin<T>(q: Queue, name: string, data: T, opts?: Parameters<Queue["add"]>[2], ms = Number(process.env.QUEUE_ADD_TIMEOUT_MS ?? 8000)) {
  const client = producerQueues.get(q.name) === q ? producerRedis() : null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (client && client.status !== "ready") {
      await Promise.race([
        new Promise<void>((resolve) => client.once("ready", () => resolve())),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new QueueUnavailableError(q.name)), ms); }),
      ]);
      if (timer) { clearTimeout(timer); timer = undefined; }
    }
    return await Promise.race([
      q.add(name, data as any, opts).catch((e) => { throw client ? new QueueUnavailableError(q.name) : e; }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new QueueUnavailableError(q.name)), ms); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const Q = {
  workflowRunner: () => queue("workflow.runner"),
  outboxPoller: () => queue("outbox.poller"),
  segmentMaterializer: () => queue("segment.materializer"),
  vartifyTemplateSync: () => queue("vartify.template_sync"),
  masterScheduler: () => queue("master.scheduler"),
  commDispatch: (channel: string, tenantId: string) => queue(`comm.dispatch.${channel}.${tenantId}`),
  campaignDispatch: (tenantId: string) => queue(`campaign.dispatch.${tenantId}`),
  // Heavy RTA file parse — runs in the WORKER (concurrency 1) so a large CAMS /
  // KFintech master never blocks the web event loop or OOM-crashes the web
  // server. The job payload carries the zip password (Redis-only, removed on
  // complete); the file itself stays in S3 and is fetched by the worker.
  rtaImport: () => queue("rta.import"),
  /** The same queue for request paths (upload, re-import): fails fast, never buffers. */
  rtaImportProducer: () => producerQueue("rta.import"),
};
