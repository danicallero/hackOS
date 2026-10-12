import { renderMobile } from "./render";

// H45/H47: the picker shows and returns the EVENT's clock, whatever zone the
// phone is in.

const pickerProps: { current: Record<string, unknown> | null } = { current: null };

jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = jest.requireActual("react-native");
  return {
    __esModule: true,
    default: (props: Record<string, unknown>) => {
      pickerProps.current = props;
      return <View testID="picker" />;
    },
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));

import { DateTimeField } from "@/components/date-time-field";
import { setEventTimeZone } from "@/lib/event-time";

afterEach(() => {
  setEventTimeZone(null);
  pickerProps.current = null;
});

describe("DateTimeField", () => {
  it("hands the picker the event wall clock and converts its answer back to an instant", async () => {
    setEventTimeZone("Europe/Madrid");
    const onChange = jest.fn();
    await renderMobile(
      <DateTimeField
        value={new Date("2026-07-10T08:00:00.000Z")}
        onChange={onChange}
        dateAccessibilityLabel="date"
        timeAccessibilityLabel="time"
      />,
    );
    const shown = pickerProps.current?.value as Date;
    // 10:00 on the 10th in Madrid, as device-local fields.
    expect([shown.getMonth(), shown.getDate(), shown.getHours(), shown.getMinutes()]).toEqual([
      6, 10, 10, 0,
    ]);

    // The user picks 12:30 on the 11th (device-local fields = event wall clock).
    const picked = new Date(2026, 6, 11, 12, 30);
    (pickerProps.current?.onValueChange as (e: unknown, d: Date) => void)({}, picked);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0][0] as Date).toISOString()).toBe("2026-07-11T10:30:00.000Z");
  });
});
