import { TooManyRequestsError } from "./errors.js";
import { observeAdmissionWait, setAdmissionQueueSize } from "./metrics.js";
import type { RequestLane } from "./request-lanes.js";
import { REQUEST_LANES, requestLaneRank } from "./request-lanes.js";

export interface RequestAdmissionLease {
  readonly lane: RequestLane;
  release(): void;
}

interface Waiter {
  lane: RequestLane;
  queuedAt: bigint;
  resolve: (lease: RequestAdmissionLease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  settled: boolean;
}

export interface RequestAdmissionOptions {
  maxConcurrent: number;
  reservedHighPriority?: number;
  /** Bound best-effort waiters so participant storms can be shed safely. */
  maxBestEffortPending?: number;
}

/**
 * Small in-process priority gate for finite HTTP work (H29, H38, H41-H42,
 * H540, #544). P0/P1 share reserved capacity; P2/P3 remain FIFO within
 * their lane and cannot consume it.
 */
export class RequestAdmission {
  private readonly maxConcurrent: number;
  private readonly reservedHighPriority: number;
  private readonly maxBestEffortPending: number;
  private active = 0;
  private readonly waiters: Waiter[] = [];

  constructor(options: RequestAdmissionOptions) {
    if (!Number.isInteger(options.maxConcurrent) || options.maxConcurrent < 1) {
      throw new Error("Request admission maxConcurrent must be a positive integer");
    }
    this.maxConcurrent = options.maxConcurrent;
    this.reservedHighPriority = Math.max(
      0,
      Math.min(
        options.maxConcurrent - 1,
        Math.floor(options.reservedHighPriority ?? Math.ceil(options.maxConcurrent / 4)),
      ),
    );
    this.maxBestEffortPending = Math.max(
      1,
      options.maxBestEffortPending ?? options.maxConcurrent * 4,
    );
    for (const lane of REQUEST_LANES) setAdmissionQueueSize(lane, 0);
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  async acquire(lane: RequestLane, signal?: AbortSignal): Promise<RequestAdmissionLease> {
    if (signal?.aborted) throw new Error("Request aborted while waiting for admission");
    const queuedAt = process.hrtime.bigint();
    if (this.canAdmit(lane)) return this.start(lane, queuedAt);

    if (
      (lane === "P2" || lane === "P3") &&
      this.bestEffortQueuedCount >= this.maxBestEffortPending
    ) {
      throw new TooManyRequestsError("Best-effort request admission queue exhausted", 1);
    }

    return new Promise<RequestAdmissionLease>((resolve, reject) => {
      const waiter: Waiter = {
        lane,
        queuedAt,
        resolve,
        reject,
        signal,
        settled: false,
      };
      const remove = () => {
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
      };
      waiter.onAbort = () => {
        if (waiter.settled) return;
        waiter.settled = true;
        remove();
        setAdmissionQueueSize(
          waiter.lane,
          this.waiters.filter((item) => item.lane === waiter.lane).length,
        );
        reject(new Error("Request aborted while waiting for admission"));
        this.drain();
      };
      signal?.addEventListener("abort", waiter.onAbort, { once: true });
      this.waiters.push(waiter);
      this.updateQueueMetrics();
      this.drain();
    });
  }

  private get bestEffortQueuedCount(): number {
    return this.waiters.reduce(
      (count, waiter) => count + (waiter.lane === "P2" || waiter.lane === "P3" ? 1 : 0),
      0,
    );
  }

  private canAdmit(lane: RequestLane): boolean {
    if (this.active >= this.maxConcurrent) return false;
    if (lane === "P2" || lane === "P3") {
      return this.active < this.maxConcurrent - this.reservedHighPriority;
    }
    return true;
  }

  private start(lane: RequestLane, queuedAt: bigint): RequestAdmissionLease {
    this.active++;
    const waitedSeconds = Number(process.hrtime.bigint() - queuedAt) / 1_000_000_000;
    observeAdmissionWait(lane, waitedSeconds);
    let released = false;
    return {
      lane,
      release: () => {
        if (released) return;
        released = true;
        this.active--;
        this.drain();
      },
    };
  }

  private drain(): void {
    while (this.active < this.maxConcurrent) {
      let bestIndex = -1;
      let bestRank = Number.POSITIVE_INFINITY;
      for (let index = 0; index < this.waiters.length; index++) {
        const waiter = this.waiters[index];
        if (!waiter || !this.canAdmit(waiter.lane)) continue;
        const rank = requestLaneRank(waiter.lane);
        if (rank < bestRank) {
          bestIndex = index;
          bestRank = rank;
        }
      }
      if (bestIndex < 0) break;
      const waiter = this.waiters.splice(bestIndex, 1)[0];
      if (!waiter || waiter.settled) continue;
      waiter.settled = true;
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve(this.start(waiter.lane, waiter.queuedAt));
    }
    this.updateQueueMetrics();
  }

  private updateQueueMetrics(): void {
    for (const lane of REQUEST_LANES) {
      setAdmissionQueueSize(
        lane,
        this.waiters.reduce((count, waiter) => count + (waiter.lane === lane ? 1 : 0), 0),
      );
    }
  }
}
