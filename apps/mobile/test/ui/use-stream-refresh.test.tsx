import { EVENTS, REALTIME_SCOPES } from "@hackos/shared/events";

const mockListeners: { type: string; scope: string; callback: () => void }[] = [];
const mockStops = { domain: jest.fn(), publicContent: jest.fn() };
const mockOnResync: Record<string, () => void> = {};
// Plain functions: the project's jest config resets jest.fn implementations between tests.
jest.mock("@/lib/server-events", () => ({
  isServerEventConnected: () => false,
  startDomainEventStream: (topic: string, options: { onResync: () => void }) => {
    mockOnResync[topic] = options.onResync;
    return mockStops.domain;
  },
  startPublicContentEventStream: (options: { onResync: () => void }) => {
    mockOnResync.publicContent = options.onResync;
    return mockStops.publicContent;
  },
  subscribeToServerEvent: (type: string, callback: () => void, scope: string) => {
    const entry = { type, scope, callback };
    mockListeners.push(entry);
    return () => {
      mockListeners.splice(mockListeners.indexOf(entry), 1);
    };
  },
}));

import { act, render } from "@testing-library/react-native";

const { useStreamRefresh } = jest.requireActual<typeof import("@/lib/use-stream-refresh")>(
  "@/lib/use-stream-refresh",
);

beforeEach(() => {
  mockStops.domain = jest.fn();
  mockStops.publicContent = jest.fn();
  mockListeners.length = 0;
});
const wait = (ms: number) =>
  act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  });

function Probe({
  refresh,
  onStreamDown,
  ...options
}: {
  refresh: () => void;
  onStreamDown?: (streamDown: () => boolean) => void;
} & Parameters<typeof useStreamRefresh>[1]) {
  onStreamDown?.(useStreamRefresh(refresh, options));
  return null;
}

it("refreshes once per burst of stream signals and reports a down stream", async () => {
  const refresh = jest.fn();
  let streamDown: (() => boolean) | undefined;
  await render(
    <Probe
      refresh={refresh}
      publicContent
      domains={["projects"]}
      jitterMs={20}
      onStreamDown={(fn) => (streamDown = fn)}
    />,
  );
  await act(async () => {});
  expect(mockListeners.map(({ type, scope }) => [type, scope])).toEqual([
    [EVENTS.DATA_CHANGED, REALTIME_SCOPES.PUBLIC_CONTENT],
    [EVENTS.DOMAIN_CHANGED, "domain:projects"],
  ]);
  expect(streamDown?.()).toBe(true);

  act(() => {
    for (const listener of mockListeners) listener.callback();
    mockOnResync.publicContent?.();
  });
  await wait(60);
  expect(refresh).toHaveBeenCalledTimes(1);
  await wait(60);
  expect(refresh).toHaveBeenCalledTimes(1);
});
