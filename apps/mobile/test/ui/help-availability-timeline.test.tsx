import { fireEvent, render, screen } from "@testing-library/react-native";
import { AvailabilityTimeline } from "@/components/help-desk/availability-timeline";
import { setEventTimeZone } from "@/lib/event-time";
import { clockRange, planDays } from "@/lib/help-desk";

jest.mock("@/lib/api", () => ({ apiFetch: jest.fn() }));
jest.mock("@/lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key, language: "en" }),
}));
jest.mock("@/components/symbol", () => ({ SymbolView: () => null }));

const window = { startsAt: "2026-11-27T19:00:00.000Z", endsAt: "2026-11-28T15:00:00.000Z" };
const stated = [{ startsAt: "2026-11-27T22:00:00.000Z", endsAt: "2026-11-28T01:00:00.000Z" }];

it("shows every hacking day, opens a stated stretch and adds one from a day (H62)", async () => {
  setEventTimeZone("Europe/Madrid");
  const days = planDays(window, stated, "en");
  const onAdd = jest.fn();
  const onEdit = jest.fn();
  await render(
    <AvailabilityTimeline
      days={days}
      intervals={stated}
      notBefore={window.startsAt}
      onAdd={onAdd}
      onEdit={onEdit}
    />,
  );
  expect(days).toHaveLength(2);
  // The night stretch is drawn on both lines and named once, on the day it starts.
  const range = clockRange(stated[0], "en");
  const pieces = screen.getAllByLabelText(new RegExp(`, ${range}$`));
  expect(pieces).toHaveLength(2);
  expect(screen.getAllByText(range)).toHaveLength(1);
  await fireEvent.press(pieces[1]);
  expect(onEdit).toHaveBeenCalledWith(0);
  await fireEvent.press(screen.getByLabelText(`helpAddInterval, ${days[1].label}`));
  expect(onAdd).toHaveBeenCalledWith(days[1], null);
});
