import {
  emitCategory,
  emitNotificationChange,
  subscribeToCategory,
  subscribeToNotificationChanges,
} from "./notification-events";

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

  it("notifies global listeners for received and locally changed notifications", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToNotificationChanges(listener);

    emitCategory("announcements");
    emitNotificationChange();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    emitNotificationChange();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});
