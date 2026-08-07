import { type Processor, Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config.js";
import { REDIS_CONNECTION_OPTS } from "./valkey.js";

/**
 * BullMQ scaffolding (plan/01: API = Fastify + BullMQ over Valkey).
 *
 * Modules declare queues + processors via `registerWorker`. In dev/test the
 * API process runs them inline (config.workersInline); in production the
 * dedicated worker entrypoint (src/worker.ts) runs them in a separate
 * container so heavy jobs never degrade request latency (plan/07 §2).
 *
 * Background processes expected here (plan/07 §5): queue pump, confirmation
 * expirer, scheduled-visibility publisher, notification dispatcher.
 */

const connection = () => new Redis(config.VALKEY_URL, REDIS_CONNECTION_OPTS);

const queues = new Map<string, Queue>();
const processors = new Map<string, Processor>();
const workers: Worker[] = [];

export function getQueue(name: string): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, { connection: connection() });
    queues.set(name, q);
  }
  return q;
}

/** Declare the processor for a queue. Actual Workers start via startWorkers(). */
export function registerWorker(name: string, processor: Processor): void {
  if (processors.has(name)) throw new Error(`Worker already registered for queue "${name}"`);
  processors.set(name, processor);
}

export function startWorkers(): void {
  for (const [name, processor] of processors) {
    workers.push(new Worker(name, processor, { connection: connection() }));
  }
}

export async function stopQueues(): Promise<void> {
  await Promise.allSettled([
    ...workers.map((w) => w.close()),
    ...[...queues.values()].map((q) => q.close()),
  ]);
  workers.length = 0;
  queues.clear();
  processors.clear();
}
