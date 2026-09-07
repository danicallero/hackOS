import type { ReactElement } from "react";
import type { NativeGesture } from "react-native-gesture-handler";

import { ScheduleSwipeRow } from "@/components/schedule-swipe-row";

describe("schedule swipe row (#626)", () => {
  it("allows the row pan to coexist with the vertical schedule list gesture", () => {
    const scrollGesture = {} as NativeGesture;
    const row = ScheduleSwipeRow({
      children: null,
      deleteLabel: "Delete",
      enabled: true,
      onDelete: () => {},
      scrollGesture,
    }) as ReactElement<{ simultaneousWith?: unknown }>;

    expect(row.props.simultaneousWith).toBe(scrollGesture);
  });
});
