const mockWrite = jest.fn();
jest.mock("./offline-cache", () => ({
  writeCachedValue: (...args: unknown[]) => mockWrite(...args),
}));

import {
  clearProfileSeeds,
  companySeed,
  personSeed,
  requesterSeed,
  seedCompanies,
  seedPeople,
  seedRequester,
} from "./profile-seed";

beforeEach(() => {
  clearProfileSeeds();
  mockWrite.mockReset();
});

it("keeps what each list knew about a person, without losing fields another list carried", () => {
  seedPeople([{ userId: 1, displayName: "Iria Test", photoUrl: "/p/1", headline: "Designer" }]);
  // A list with no headline (a speaker row) keeps the one the diary gave.
  seedPeople([{ userId: 1, displayName: "Iria Test", photoUrl: "/p/1?v=2" }]);
  expect(personSeed(1)).toEqual({
    userId: 1,
    displayName: "Iria Test",
    photoUrl: "/p/1?v=2",
    headline: "Designer",
  });
  expect(personSeed(2)).toBeNull();
});

it("seeds a requester by request id and as a person", () => {
  seedRequester(40, { userId: 3, displayName: "Xoán Proba", photoUrl: null });
  expect(requesterSeed(40)?.displayName).toBe("Xoán Proba");
  expect(personSeed(3)?.displayName).toBe("Xoán Proba");
});

it("keeps only the most recent few hundred entries", () => {
  seedPeople(
    Array.from({ length: 320 }, (_, index) => ({
      userId: index + 1,
      displayName: `Person ${index + 1}`,
      photoUrl: null,
    })),
  );
  expect(personSeed(1)).toBeNull();
  expect(personSeed(320)?.displayName).toBe("Person 320");
});

it("stays in memory only and is gone after clearing", () => {
  seedPeople([{ userId: 1, displayName: "Iria Test", photoUrl: null }]);
  seedCompanies([{ id: 5, name: "Proba Labs", logoUrl: null }]);
  expect(companySeed(5)?.name).toBe("Proba Labs");
  expect(mockWrite).not.toHaveBeenCalled();
  clearProfileSeeds();
  expect(personSeed(1)).toBeNull();
  expect(companySeed(5)).toBeNull();
});
