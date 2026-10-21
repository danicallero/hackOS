import { emitTabReselect, subscribeTabReselect } from "./tab-reselect";

describe("tab reselect (H55)", () => {
  it("notifies only the pressed tab's subscribers and stops after unsubscribe", () => {
    const scan = jest.fn();
    const activities = jest.fn();
    const off = subscribeTabReselect("scan", scan);
    subscribeTabReselect("activities", activities);
    emitTabReselect("scan");
    expect(scan).toHaveBeenCalledTimes(1);
    expect(activities).not.toHaveBeenCalled();
    off();
    emitTabReselect("scan");
    expect(scan).toHaveBeenCalledTimes(1);
  });
});
