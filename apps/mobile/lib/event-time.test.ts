import {
  eventDayKey,
  eventZoneHint,
  formatEventTime,
  fromPickerDate,
  getEventTimeZone,
  setEventTimeZone,
  toPickerDate,
} from "./event-time";
import { formatLastUpdate } from "./format-date";

// H45/H47: the event's clock (Europe/Madrid) is shown and typed whatever zone
// the phone is in. Run under several TZ values to prove it:
// `TZ=America/Los_Angeles jest lib/event-time`.

const MADRID = "Europe/Madrid";

afterEach(() => setEventTimeZone(null));

describe("event zone store", () => {
  it("falls back to the device zone until the event zone is known, ignoring invalid ids", () => {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(getEventTimeZone()).toBe(device);
    setEventTimeZone("Not/AZone");
    expect(getEventTimeZone()).toBe(device);
    setEventTimeZone(MADRID);
    expect(getEventTimeZone()).toBe(MADRID);
  });
});

describe("picker date conversion", () => {
  it("shows the event wall clock in the device-local fields and inverts exactly", () => {
    const instant = new Date("2026-07-10T08:00:00.000Z"); // 10:00 CEST
    const picker = toPickerDate(instant, MADRID);
    expect([picker.getFullYear(), picker.getMonth(), picker.getDate()]).toEqual([2026, 6, 10]);
    expect([picker.getHours(), picker.getMinutes()]).toEqual([10, 0]);
    expect(fromPickerDate(picker, MADRID).toISOString()).toBe("2026-07-10T08:00:00.000Z");
  });

  it("round-trips either side of both Madrid transitions", () => {
    for (const iso of [
      "2026-03-29T00:59:00.000Z",
      "2026-03-29T01:00:00.000Z",
      "2026-10-24T23:59:00.000Z",
      "2026-10-25T02:00:00.000Z",
    ]) {
      expect(fromPickerDate(toPickerDate(new Date(iso), MADRID), MADRID).toISOString()).toBe(iso);
    }
  });

  it("maps the repeated October hour to its first occurrence", () => {
    // 02:30 happens twice on 25 Oct; a wall clock cannot say which, so 01:30Z becomes 00:30Z.
    const second = new Date("2026-10-25T01:30:00.000Z");
    expect(fromPickerDate(toPickerDate(second, MADRID), MADRID).toISOString()).toBe(
      "2026-10-25T00:30:00.000Z",
    );
  });

  it("merges a picked date and time on the event wall clock across the October change", () => {
    // Item is 10:00 CEST on 24 Oct; moving it to 26 Oct keeps 10:00 wall (CET = 09:00Z).
    const picker = toPickerDate(new Date("2026-10-24T08:00:00.000Z"), MADRID);
    picker.setFullYear(2026, 9, 26);
    expect(fromPickerDate(picker, MADRID).toISOString()).toBe("2026-10-26T09:00:00.000Z");
  });
});

describe("formatting", () => {
  it("formats instants and day keys in the event zone", () => {
    expect(
      formatEventTime(
        "2026-07-10T22:30:00.000Z",
        "en-GB",
        { hour: "2-digit", minute: "2-digit" },
        MADRID,
      ),
    ).toBe("00:30");
    expect(eventDayKey("2026-07-10T22:30:00.000Z", MADRID)).toBe("2026-07-11");
    expect(eventDayKey("garbage", MADRID)).toBe("");
  });

  it("hints the zone only when it differs from the phone's", () => {
    const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
    expect(eventZoneHint("en", device)).toBe("");
    const other = device === MADRID ? "America/New_York" : MADRID;
    expect(eventZoneHint("en", other, Date.parse("2026-07-01T00:00:00Z"))).not.toBe("");
  });

  it("buckets a last-update stamp by the event's day", () => {
    const t = () => "Yesterday";
    const now = new Date("2026-07-10T22:30:00.000Z"); // 00:30 on the 11th in Madrid
    // 21:00Z on the 10th is 23:00 on the 10th in Madrid: yesterday there.
    expect(formatLastUpdate("2026-07-10T21:00:00.000Z", "en", t, now, MADRID)).toMatch(
      /^Yesterday, /,
    );
    expect(formatLastUpdate("2026-07-10T22:10:00.000Z", "en", t, now, MADRID)).not.toMatch(
      /Yesterday/,
    );
  });
});
