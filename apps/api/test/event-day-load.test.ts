import { describe, expect, it } from "vitest";
import {
  assertDestructiveSafeDatabaseUrl,
  assertInternalQualificationApi,
  isDestructiveSafeDatabaseUrl,
  QUALIFICATION_DATABASE_NAME,
} from "../scripts/event-day-load.js";

describe("event-day qualification safety (#544)", () => {
  it("accepts only the fixed isolated event_day database on approved hosts", () => {
    expect(
      isDestructiveSafeDatabaseUrl(
        `postgres://hackos:hackos@localhost:5433/${QUALIFICATION_DATABASE_NAME}`,
      ),
    ).toBe(true);
    expect(
      isDestructiveSafeDatabaseUrl("postgres://hackos:hackos@localhost:5433/hackos_test"),
    ).toBe(false);
    expect(
      isDestructiveSafeDatabaseUrl(
        `postgres://hackos:hackos@production-db:5432/${QUALIFICATION_DATABASE_NAME}`,
      ),
    ).toBe(false);
    expect(() =>
      assertDestructiveSafeDatabaseUrl("postgres://hackos:hackos@localhost:5433/hackos_prod"),
    ).toThrow(/Refusing to reset database/);
  });

  it("allows only internal HTTP qualification API targets", () => {
    expect(() => assertInternalQualificationApi("http://api:3000")).not.toThrow();
    expect(() => assertInternalQualificationApi("http://localhost:3000")).not.toThrow();
    expect(() => assertInternalQualificationApi("https://api.example.org")).toThrow(
      /never public ingress/,
    );
    expect(() => assertInternalQualificationApi("http://api.example.org:3000")).toThrow(
      /never public ingress/,
    );
  });
});
