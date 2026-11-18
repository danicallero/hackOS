import { TooManyRequestsError } from "./errors.js";
import { type AdmissionMetrics, httpAdmissionMetrics } from "./metrics.js";
import type { RequestLane } from "./request-lanes.js";
import { REQUEST_LANES, requestLaneRank } from "./request-lanes.js";

export interface RequestAdmissionLease {
  readonly lane: RequestLane;
  /** True once the lease was force-released after `maxHoldMs` (#1367). */
  readonly expired: boolean;
  /** Idempotent: releasing an expired or already released lease is a no-op. */
  release(): void;
}

/** Point-in-time admission state for readiness output (#1367). */
export interface RequestAdmissionHealth {
  active: number;
  queued: number;
  /** Age of the oldest queued P2/P3 request; 0 when none is waiting. */
  oldestBestEffortWaitSeconds: number;
}

interface Waiter {
  lane: RequestLane;
  rolePosition: number | null;
  queuedAt: bigint;
  resolve: (lease: RequestAdmissionLease) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
  waitTimer?: NodeJS.Timeout;
  settled: boolean;
}

interface RequestAdmissionOptions {
  maxConcurrent: number;
  reservedHighPriority?: number;
  /** Bound best-effort waiters so participant storms can be shed safely. */
  maxBestEffortPending?: number;
  /**
   * Defence in depth against leaked leases (#1367): a lease held longer than
   * this is force-released once, so a future leak path degrades capacity for
   * a bounded time instead of accumulating. Omit to disable.
   */
  maxHoldMs?: number;
  /** Called once per force-released lease, after its slot has been freed. */
  onLeaseExpired?: (lease: RequestAdmissionLease) => void;
  /**
   * Bound on queueing: a waiter still unserved after this long is rejected
   * with `waitTimeoutError(lane)`, so an overloaded or stalled gate answers
   * instead of holding the client until it gives up (#1367). Omit to wait
   * indefinitely.
   */
  maxWaitMs?: number;
  waitTimeoutError?: (lane: RequestLane) => Error;
  /** Where this scheduler reports; defaults to the HTTP admission metrics. */
  metrics?: AdmissionMetrics;
}

/**
 * Small in-process priority gate for finite HTTP work (H29, H38, H41-H42,
 * #540, #544). Role position orders queued requests first; reserved capacity
 * keeps all P2/P3 traffic from consuming the operational share, including
 * authenticated participant and sponsor requests.
 */
export class RequestAdmission {
  private readonly maxConcurrent: number;
  private readonly reservedHighPriority: number;
  private readonly maxBestEffortPending: number;
  private readonly maxHoldMs: number | undefined;
  private readonly onLeaseExpired: ((lease: RequestAdmissionLease) => void) | undefined;
  private readonly maxWaitMs: number | undefined;
  private readonly waitTimeoutError: (lane: RequestLane) => Error;
  private readonly metrics: AdmissionMetrics;
  private active = 0;
  private readonly waiters: Waiter[] = [];
  /** Start time of every held lease, for the oldest-lease leak signal. */
  private readonly leaseStarts = new Set<{ startedAt: bigint }>();

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
    if (options.maxHoldMs !== undefined && !(options.maxHoldMs > 0)) {
      throw new Error("Request admission maxHoldMs must be positive");
    }
    this.maxHoldMs = options.maxHoldMs;
    this.onLeaseExpired = options.onLeaseExpired;
    if (options.maxWaitMs !== undefined && !(options.maxWaitMs > 0)) {
      throw new Error("Request admission maxWaitMs must be positive");
    }
    this.maxWaitMs = options.maxWaitMs;
    this.waitTimeoutError =
      options.waitTimeoutError ?? (() => new Error("Timed out waiting for admission"));
    this.metrics = options.metrics ?? httpAdmissionMetrics;
    for (const lane of REQUEST_LANES) this.metrics.queueSize(lane, 0);
    this.metrics.attach(this);
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.waiters.length;
  }

  /** Age in seconds of the oldest waiter in the given lanes, or 0 (#1367). */
  oldestWaitSeconds(lanes: readonly RequestLane[] = REQUEST_LANES): number {
    let oldest: bigint | undefined;
    for (const waiter of this.waiters) {
      if (!lanes.includes(waiter.lane)) continue;
      if (oldest === undefined || waiter.queuedAt < oldest) oldest = waiter.queuedAt;
    }
    if (oldest === undefined) return 0;
    return Number(process.hrtime.bigint() - oldest) / 1_000_000_000;
  }

  /** Age in seconds of the longest-held lease, or 0 (#1367 leak signal). */
  oldestLeaseSeconds(): number {
    let oldest: bigint | undefined;
    for (const { startedAt } of this.leaseStarts) {
      if (oldest === undefined || startedAt < oldest) oldest = startedAt;
    }
    if (oldest === undefined) return 0;
    return Number(process.hrtime.bigint() - oldest) / 1_000_000_000;
  }

  health(): RequestAdmissionHealth {
    return {
      active: this.active,
      queued: this.waiters.length,
      oldestBestEffortWaitSeconds: this.oldestWaitSeconds(["P2", "P3"]),
    };
  }

  /**
   * Acquire a slot for a request. Higher role positions are served first;
   * the lane remains the tie-breaker for requests from users at the same
   * hierarchy level (H8, #544).
   */
  async acquire(lane: RequestLane, signal?: AbortSignal): Promise<RequestAdmissionLease>;
  async acquire(
    lane: RequestLane,
    rolePosition?: number | null,
    signal?: AbortSignal,
  ): Promise<RequestAdmissionLease>;
  async acquire(
    lane: RequestLane,
    rolePositionOrSignal: number | null | AbortSignal = null,
    signal?: AbortSignal,
  ): Promise<RequestAdmissionLease> {
    const rolePosition = isAbortSignal(rolePositionOrSignal) ? null : rolePositionOrSignal;
    const waitSignal = isAbortSignal(rolePositionOrSignal) ? rolePositionOrSignal : signal;
    if (waitSignal?.aborted) throw new Error("Request aborted while waiting for admission");
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
        rolePosition,
        queuedAt,
        resolve,
        reject,
        signal: waitSignal,
        settled: false,
      };
      // Both ways out of the queue without a slot: the client left, or the
      // wait bound passed. Either settles the waiter exactly once.
      const giveUp = (error: Error) => {
        if (waiter.settled) return;
        waiter.settled = true;
        if (waiter.waitTimer) clearTimeout(waiter.waitTimer);
        if (waiter.signal && waiter.onAbort) {
          waiter.signal.removeEventListener("abort", waiter.onAbort);
        }
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) this.waiters.splice(index, 1);
        reject(error);
        this.drain();
      };
      waiter.onAbort = () => giveUp(new Error("Request aborted while waiting for admission"));
      waitSignal?.addEventListener("abort", waiter.onAbort, { once: true });
      if (this.maxWaitMs !== undefined) {
        waiter.waitTimer = setTimeout(() => {
          this.metrics.waitTimedOut(lane);
          giveUp(this.waitTimeoutError(lane));
        }, this.maxWaitMs);
        waiter.waitTimer.unref();
      }
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
    const startedAt = process.hrtime.bigint();
    const leaseStart = { startedAt };
    this.leaseStarts.add(leaseStart);
    this.metrics.wait(lane, Number(startedAt - queuedAt) / 1_000_000_000);
    let released = false;
    let expired = false;
    let holdTimer: NodeJS.Timeout | undefined;
    // Every release path funnels through here, so a slot is freed exactly
    // once whether the request completes, aborts or outlives maxHoldMs.
    const free = (): boolean => {
      if (released) return false;
      released = true;
      if (holdTimer) clearTimeout(holdTimer);
      this.leaseStarts.delete(leaseStart);
      this.active--;
      this.drain();
      return true;
    };
    const lease: RequestAdmissionLease = {
      lane,
      get expired() {
        return expired;
      },
      release: () => {
        free();
      },
    };
    if (this.maxHoldMs !== undefined) {
      holdTimer = setTimeout(() => {
        expired = true;
        if (!free()) return;
        this.metrics.leaseExpired(lane);
        this.onLeaseExpired?.(lease);
      }, this.maxHoldMs);
      holdTimer.unref();
    }
    return lease;
  }

  private drain(): void {
    while (this.active < this.maxConcurrent) {
      let bestIndex = -1;
      let bestWaiter: Waiter | undefined;
      for (let index = 0; index < this.waiters.length; index++) {
        const waiter = this.waiters[index];
        if (!waiter || !this.canAdmit(waiter.lane)) continue;
        if (!bestWaiter || compareWaiterPriority(waiter, bestWaiter) < 0) {
          bestIndex = index;
          bestWaiter = waiter;
        }
      }
      if (bestIndex < 0) break;
      const waiter = this.waiters.splice(bestIndex, 1)[0];
      if (!waiter || waiter.settled) continue;
      waiter.settled = true;
      if (waiter.waitTimer) clearTimeout(waiter.waitTimer);
      if (waiter.signal && waiter.onAbort) {
        waiter.signal.removeEventListener("abort", waiter.onAbort);
      }
      waiter.resolve(this.start(waiter.lane, waiter.queuedAt));
    }
    this.updateQueueMetrics();
  }

  private updateQueueMetrics(): void {
    for (const lane of REQUEST_LANES) {
      this.metrics.queueSize(
        lane,
        this.waiters.reduce((count, waiter) => count + (waiter.lane === lane ? 1 : 0), 0),
      );
    }
  }
}

function compareWaiterPriority(left: Waiter, right: Waiter): number {
  // A missing role is lower than every persisted role position, including
  // migrated negative positions. `roles.position` is globally unique, so a
  // same-position comparison only occurs for anonymous requests.
  const leftRolePosition = left.rolePosition ?? Number.NEGATIVE_INFINITY;
  const rightRolePosition = right.rolePosition ?? Number.NEGATIVE_INFINITY;
  if (leftRolePosition !== rightRolePosition) {
    return leftRolePosition > rightRolePosition ? -1 : 1;
  }

  return requestLaneRank(left.lane) - requestLaneRank(right.lane);
}

function isAbortSignal(value: number | null | AbortSignal): value is AbortSignal {
  return typeof value === "object" && value !== null && "aborted" in value;
}
