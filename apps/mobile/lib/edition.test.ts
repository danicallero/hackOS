import { shouldShowEditionSelector } from "@hackos/shared/editions";
import {
  commitEditionChange,
  editionHeaders,
  getEditionEpoch,
  getViewedEdition,
  resetViewedEdition,
  selectViewedEdition,
  subscribeEdition,
  viewedEditionSummary,
} from "./edition";

const edition = (eventKey: string, isCurrent: boolean) => ({
  eventKey,
  name: eventKey,
  status: isCurrent ? ("active" as const) : ("closed" as const),
  startsAt: null,
  endsAt: null,
  isCurrent,
});

afterEach(() => resetViewedEdition());

describe("viewed edition", () => {
  it("sends no header for the current edition and one for a selected past edition", () => {
    expect(editionHeaders()).toEqual({});
    selectViewedEdition("hackudc-2025");
    expect(editionHeaders()).toEqual({ "x-edition": "hackudc-2025" });
    selectViewedEdition(null);
    expect(editionHeaders()).toEqual({});
  });

  it("resets to the current edition and tells subscribers", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeEdition(listener);
    selectViewedEdition("hackudc-2025");
    commitEditionChange();
    expect(listener).toHaveBeenCalledTimes(1);
    const epoch = getEditionEpoch();
    resetViewedEdition();
    expect(getViewedEdition()).toBeNull();
    expect(getEditionEpoch()).toBe(epoch + 1);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("shows the selector only when there is more than one edition", () => {
    expect(shouldShowEditionSelector([edition("a", true)])).toBe(false);
    expect(shouldShowEditionSelector([edition("b", true), edition("a", false)])).toBe(true);
  });

  it("resolves the viewed summary, defaulting to the current edition", () => {
    const editions = [edition("b", true), edition("a", false)];
    expect(viewedEditionSummary(editions, null)?.eventKey).toBe("b");
    expect(viewedEditionSummary(editions, "a")?.eventKey).toBe("a");
  });
});
