import { TextEncoder } from "node:util";
import { vi } from "vitest";

export function mockRealtimeFetch() {
  const connections: {
    url: string;
    signal: AbortSignal;
    emit: (topic: string, id: number, type?: string) => void;
    raw: (text: string) => void;
    end: () => void;
  }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    let ended = false;
    const body = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
      cancel() {
        ended = true;
      },
    });
    connections.push({
      url,
      signal: init.signal as AbortSignal,
      emit(topic, id, type = "domain.changed") {
        if (!ended)
          controller.enqueue(
            new TextEncoder().encode(
              `data: ${JSON.stringify({ topic, id: String(id), type, at: "now", data: {} })}\n\n`,
            ),
          );
      },
      raw(text) {
        if (!ended) controller.enqueue(new TextEncoder().encode(text));
      },
      end() {
        if (!ended) {
          ended = true;
          controller.close();
        }
      },
    });
    return {
      ok: true,
      status: 200,
      body,
      headers: new Headers({ "content-type": "text/event-stream" }),
    };
  });
  vi.stubGlobal("fetch", fetcher);
  return { connections, fetcher };
}
