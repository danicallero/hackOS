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
  rolePosition: number | null;
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
 * H540, #544). Role position orders queued requests first; reserved capacity
 * keeps all P2/P3 traffic from consuming the operational share, including
 * authenticated participant and sponsor requests.
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
      waitSignal?.addEventListener("abort", waiter.onAbort, { once: true });
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
