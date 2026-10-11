import {
  notifySignOut,
  registerSignOutListener,
  SIGN_OUT_CLEANUP_TIMEOUT_MS,
} from "./sign-out-events";

describe("sign-out events", () => {
  afterEach(() => jest.useRealTimers());

  it("settles after async cleanup and survives a failing listener (#966)", async () => {
    let finish!: () => void;
    const seen: string[] = [];
    const removeFailing = registerSignOutListener(() => {
      throw new Error("broken listener");
    });
    const removeAsync = registerSignOutListener(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const removeSync = registerSignOutListener(() => {
      seen.push("sync");
    });

    let settled = false;
    const done = notifySignOut().then(() => {
      settled = true;
    });
    expect(seen).toEqual(["sync"]);
    await Promise.resolve();
    expect(settled).toBe(false);

    finish();
    await done;
    expect(settled).toBe(true);
    for (const remove of [removeFailing, removeAsync, removeSync]) remove();
  });

  it("does not wait forever for a hanging cleanup", async () => {
    jest.useFakeTimers();
    const remove = registerSignOutListener(() => new Promise(() => {}));
    let settled = false;
    const done = notifySignOut().then(() => {
      settled = true;
    });
    jest.advanceTimersByTime(SIGN_OUT_CLEANUP_TIMEOUT_MS);
    await done;
    expect(settled).toBe(true);
    remove();
  });
});
