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
  jest.useFakeTimers();
  jest.spyOn(Math, "random").mockReturnValue(0.5);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const wait = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

function Probe({
  refresh,
  onStreamDown,
  ...options
}: {
  refresh: () => void;
  onStreamDown?: (streamDown: () => boolean) => void;
} & Parameters<typeof useStreamRefresh>[1]) {
  const streamDown = useStreamRefresh(refresh, options);
  onStreamDown?.(streamDown);
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

  await act(async () => {
    for (const listener of mockListeners) listener.callback();
    mockOnResync.publicContent?.();
  });
  await wait(60);
  expect(refresh).toHaveBeenCalledTimes(1);
  await wait(60);
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("cancels a queued refresh and unsubscribes when the reader unmounts", async () => {
  const refresh = jest.fn();
  const view = await render(
    <Probe refresh={refresh} publicContent domains={["projects"]} jitterMs={20} />,
  );
  await act(async () => {});
  expect(mockListeners).toHaveLength(2);
  await act(async () => {
    for (const listener of mockListeners) listener.callback();
  });
  await view.unmount();
  await wait(60);
  expect(refresh).not.toHaveBeenCalled();
  expect(mockListeners).toHaveLength(0);
  expect(mockStops.publicContent).toHaveBeenCalledTimes(1);
  expect(mockStops.domain).toHaveBeenCalledTimes(1);
});

it("uses the newest refresh callback when a pending signal fires after a rerender", async () => {
  const previous = jest.fn();
  const latest = jest.fn();
  const view = await render(<Probe refresh={previous} publicContent jitterMs={20} />);
  await act(async () => {});
  expect(mockListeners).toHaveLength(1);
  await act(async () => {
    mockListeners[0]?.callback();
  });
  await view.rerender(<Probe refresh={latest} publicContent jitterMs={20} />);
  await wait(60);
  expect(previous).not.toHaveBeenCalled();
  expect(latest).toHaveBeenCalledTimes(1);
  expect(mockListeners).toHaveLength(1);
});

it("does not subscribe or refresh while disabled", async () => {
  const refresh = jest.fn();
  await render(<Probe refresh={refresh} publicContent domains={["projects"]} enabled={false} />);
  await wait(60);
  expect(mockListeners).toHaveLength(0);
  expect(refresh).not.toHaveBeenCalled();
});
