import { emitManualActivityScan, subscribeToManualActivityScan } from "./manual-activity-scan";

describe("manual activity scan return channel", () => {
  it("delivers a badge only to the existing scanner for that activity", () => {
    const dinner = jest.fn();
    const workshop = jest.fn();
    const unsubscribe = subscribeToManualActivityScan(10, dinner);
    subscribeToManualActivityScan(20, workshop);

    emitManualActivityScan(10, "BADGE-1");
    expect(dinner).toHaveBeenCalledWith("BADGE-1");
    expect(workshop).not.toHaveBeenCalled();

    unsubscribe();
    emitManualActivityScan(10, "BADGE-2");
    expect(dinner).toHaveBeenCalledTimes(1);
  });
});
