import { emitCategory, subscribeToCategory } from "./notification-events";

describe("notification-events pub-sub", () => {
  it("only notifies listeners subscribed to the matching category", () => {
    const queueListener = jest.fn();
    const otherListener = jest.fn();
    subscribeToCategory("queue", queueListener);
    subscribeToCategory("announcements", otherListener);

    emitCategory("queue");

    expect(queueListener).toHaveBeenCalledTimes(1);
    expect(otherListener).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further notifications", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToCategory("queue", listener);
    unsubscribe();

    emitCategory("queue");

    expect(listener).not.toHaveBeenCalled();
  });

  it("emitting with no category is a no-op", () => {
    const listener = jest.fn();
    subscribeToCategory("queue", listener);

    emitCategory(undefined);

    expect(listener).not.toHaveBeenCalled();
  });
});
