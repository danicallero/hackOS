import { REALTIME_LIMITS, type SseEnvelope } from "@hackos/shared/events";

export type ResyncReason = "reconnect" | "gap" | "identity-change" | "foreground";
export type RealtimeConsumer = {
  scope: string;
  events?: readonly string[];
  onEvent?: (event: SseEnvelope) => void;
  onResync?: (context: { reason: ResyncReason; topic: string; lastEventId: string | null }) => void;
  onConnectionChange?: (connected: boolean) => void;
};
type TopicState = { lastId: number | null; ignoreGap: boolean };

function retryAfter(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

/** One transport owner per client instance. Timers/readers are fenced by generation (#892). */
export class RealtimeClient {
  private consumers = new Set<RealtimeConsumer>();
  private topics = new Map<string, TopicState>();
  private controller: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private connected = false;
  private opened = false;
  private active = true;
  private failures = 0;
  private scopesKey = "";
  private foregroundRecovery = false;
  private physicalClose: (() => void) | null = null;
  private identity: string | number | null = null;
  private origin = "";

  constructor(
    private readonly options: {
      headers?: () => Record<string, string>;
      onResync?: (context: {
        reason: ResyncReason;
        topic: string;
        lastEventId: string | null;
      }) => void;
      onPhysicalConnection?: (url: string, state: "opened" | "closed") => void;
      publicPath?: string;
    } = {},
  ) {}

  /** The session owner, not individual components, establishes account/origin identity. */
  setIdentity(identity: string | number | null, origin: string): void {
    if (identity === this.identity && origin === this.origin) return;
    this.stop();
    this.consumers.clear();
    this.topics.clear();
    this.scopesKey = "";
    this.opened = false;
    this.failures = 0;
    this.identity = identity;
    this.origin = origin;
  }

  subscribe(consumer: RealtimeConsumer): () => void {
    this.consumers.add(consumer);
    try {
      this.updateScopes();
    } catch (error) {
      this.consumers.delete(consumer);
      throw error;
    }
    consumer.onConnectionChange?.(this.connected);
    return () => {
      if (!this.consumers.delete(consumer)) return;
      this.updateScopes();
    };
  }

  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (!active) this.stop();
    else {
      this.foregroundRecovery = this.opened;
      for (const state of this.topics.values()) state.ignoreGap = true;
      this.schedule(0);
    }
  }

  private state(scope: string): TopicState {
    let state = this.topics.get(scope);
    if (!state) {
      state = { lastId: null, ignoreGap: false };
      this.topics.set(scope, state);
    }
    return state;
  }

  private resync(scope: string, reason: ResyncReason): void {
    const state = this.state(scope);
    const context = {
      reason,
      topic: scope,
      lastEventId: state.lastId === null ? null : String(state.lastId),
    };
    this.options.onResync?.(context);
    for (const consumer of this.consumers) {
      if (consumer.scope === scope) consumer.onResync?.(context);
    }
  }

  private resyncAll(reason: ResyncReason): void {
    for (const scope of new Set([...this.consumers].map((consumer) => consumer.scope)))
      this.resync(scope, reason);
  }

  private status(connected: boolean): void {
    this.connected = connected;
    for (const consumer of this.consumers) consumer.onConnectionChange?.(connected);
  }

  private updateScopes(): void {
    const scopes = [...new Set([...this.consumers].map((consumer) => consumer.scope))].sort();
    const key = scopes.join(",");
    if (key === this.scopesKey) return;
    if (
      scopes.length > REALTIME_LIMITS.MAX_SCOPES ||
      key.length > REALTIME_LIMITS.MAX_QUERY_LENGTH
    ) {
      throw new Error("Realtime subscription limit exceeded");
    }
    this.scopesKey = key;
    for (const scope of this.topics.keys()) if (!scopes.includes(scope)) this.topics.delete(scope);
    // Abort before scheduling the replacement: there is never a second active reader.
    this.stop();
    this.failures = 0;
    if (key) this.schedule(REALTIME_LIMITS.SUBSCRIPTION_DEBOUNCE_MS);
    else this.opened = false;
  }

  private stop(): void {
    this.generation++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.physicalClose?.();
    this.physicalClose = null;
    void this.reader?.cancel().catch(() => undefined);
    this.reader = null;
    this.controller?.abort();
    this.controller = null;
    this.status(false);
  }

  private schedule(delay: number): void {
    if (!this.active || !this.scopesKey || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, delay);
  }

  private dispatch(block: string): void {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data) return;
    let event: SseEnvelope;
    try {
      event = JSON.parse(data) as SseEnvelope;
    } catch {
      return;
    }
    const scope = event.topic ?? (this.options.publicPath ? this.scopesKey : undefined);
    if (
      !scope ||
      typeof event.type !== "string" ||
      ![...this.consumers].some((consumer) => consumer.scope === scope)
    )
      return;
    const state = this.state(scope);
    const id = Number(event.id);
    let gap = false;
    if (Number.isSafeInteger(id) && id > 0) {
      gap = state.lastId !== null && id !== state.lastId + 1 && !state.ignoreGap;
      if (gap) this.resync(scope, "gap");
      state.lastId = id;
      state.ignoreGap = false;
    }
    // Gap recovery already refetches the model; dispatching the same hint doubles reads.
    if (gap) return;
    const callbacks = new Set<NonNullable<RealtimeConsumer["onEvent"]>>();
    for (const consumer of this.consumers) {
      if (consumer.scope === scope && (!consumer.events || consumer.events.includes(event.type))) {
        if (consumer.onEvent) callbacks.add(consumer.onEvent);
      }
    }
    for (const callback of callbacks) callback(event);
  }

  private async connect(): Promise<void> {
    if (!this.active || !this.scopesKey) return;
    const generation = ++this.generation;
    const controller = new AbortController();
    this.controller = controller;
    const path =
      this.options.publicPath ??
      `/api/realtime/stream?scopes=${encodeURIComponent(this.scopesKey)}`;
    const url = `${this.origin}${path}`;
    const current = () => generation === this.generation && !controller.signal.aborted;
    let delay: number | null = null;
    let terminal = false;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    this.options.onPhysicalConnection?.(url, "opened");
    let physicalClosed = false;
    const closePhysical = () => {
      if (physicalClosed) return;
      physicalClosed = true;
      this.options.onPhysicalConnection?.(url, "closed");
    };
    this.physicalClose = closePhysical;
    try {
      const response = await fetch(url, {
        credentials: "include",
        headers: { accept: "text/event-stream", ...this.options.headers?.() },
        signal: controller.signal,
      });
      if (!current()) {
        await response.body?.cancel();
        return;
      }
      if (!response.ok || !response.body) {
        delay = retryAfter(response);
        terminal = response.status === 401 || response.status === 403;
        if (terminal) this.resyncAll("identity-change");
        await response.body?.cancel();
        return;
      }
      this.failures = 0;
      this.status(true);
      if (this.opened) this.resyncAll(this.foregroundRecovery ? "foreground" : "reconnect");
      this.foregroundRecovery = false;
      this.opened = true;
      for (const state of this.topics.values()) state.ignoreGap = true;
      reader = response.body.getReader();
      this.reader = reader;
      const decoder = new TextDecoder();
      let buffer = "";
      while (current()) {
        const { done, value } = await reader.read();
        if (!current() || done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = buffer.replaceAll("\r\n", "\n");
        if (new TextEncoder().encode(buffer).byteLength > REALTIME_LIMITS.MAX_BUFFER_BYTES)
          throw new Error("Realtime buffer limit exceeded");
        let boundary = buffer.indexOf("\n\n");
        while (boundary >= 0 && current()) {
          this.dispatch(buffer.slice(0, boundary));
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf("\n\n");
        }
      }
    } catch {
      // Transport failures recover below; stale generations cannot schedule retries.
    } finally {
      void reader?.cancel().catch(() => undefined);
      controller.abort();
      closePhysical();
      if (generation === this.generation) {
        this.physicalClose = null;
        this.reader = null;
        this.controller = null;
        this.status(false);
        if (!terminal) {
          const backoff = Math.min(1000 * 2 ** Math.min(this.failures++, 5), 30_000);
          // Retry-After is a minimum, including values greater than our local backoff cap.
          this.schedule(Math.max(delay ?? 0, backoff) + Math.floor(Math.random() * 250));
        }
      }
    }
  }
}
