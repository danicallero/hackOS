import { CAPABILITIES } from "@hackos/shared/capabilities";
import {
  collectCompanyTagHref,
  setPendingCompanyTag,
  takePendingCompanyTag,
} from "./company-tag-link";

describe("company-tag links (#935)", () => {
  it("keeps one pending link until it is taken", () => {
    expect(takePendingCompanyTag()).toBeNull();
    setPendingCompanyTag("04A1B2C3D4E5F6");
    expect(takePendingCompanyTag()).toBe("04A1B2C3D4E5F6");
    expect(takePendingCompanyTag()).toBeNull();
  });

  it("opens the Diary where the account has it: a direct tab or inside Others", () => {
    expect(collectCompanyTagHref("STAND-X", [])).toEqual({
      pathname: "/(tabs)/diary",
      params: { view: "companies", collect: "STAND-X" },
    });
    const operator = [CAPABILITIES.ACCREDIT_SCAN, CAPABILITIES.ACTIVITY_SCAN];
    expect(collectCompanyTagHref("STAND-X", operator)).toEqual({
      pathname: "/(tabs)/others/diary",
      params: { view: "companies", collect: "STAND-X" },
    });
  });
});
