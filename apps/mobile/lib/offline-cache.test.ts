const mockValues = new Map<string, string>();

jest.mock("expo-sqlite/kv-store", () => ({
  getItem: jest.fn((key: string) => Promise.resolve(mockValues.get(key) ?? null)),
  setItem: jest.fn((key: string, value: string) => {
    mockValues.set(key, value);
    return Promise.resolve();
  }),
  removeItem: jest.fn((key: string) => {
    mockValues.delete(key);
    return Promise.resolve();
  }),
  getAllKeysAsync: jest.fn(() => Promise.resolve([...mockValues.keys()])),
  multiGet: jest.fn((keys: string[]) =>
    Promise.resolve(keys.map((key) => [key, mockValues.get(key)])),
  ),
}));

import Storage from "expo-sqlite/kv-store";
import { clearCachedValues, writeCachedValue } from "./offline-cache";

const mockSetItem = Storage.setItem as jest.Mock;

describe("offline cache account cleanup", () => {
  beforeEach(() => {
    mockValues.clear();
    mockSetItem.mockImplementation((key: string, value: string) => {
      mockValues.set(key, value);
      return Promise.resolve();
    });
  });

  it("serializes a logout cleanup after a delayed predecessor write", async () => {
    let releaseWrite!: () => void;
    mockSetItem.mockImplementationOnce(
      (key: string, value: string) =>
        new Promise<void>((resolve) => {
          releaseWrite = () => {
            mockValues.set(key, value);
            resolve();
          };
        }),
    );

    const write = writeCachedValue("user:1:wallet", { userId: 1 });
    for (let index = 0; index < 5; index += 1) await Promise.resolve();
    expect(releaseWrite).toEqual(expect.any(Function));
    const clear = clearCachedValues("user:1:");
    releaseWrite();
    await Promise.all([write, clear]);

    expect(mockValues.has("hackos:offline:v1:user:1:wallet")).toBe(false);
  });

  it("does not remove another account's ordinary cache", async () => {
    await writeCachedValue("user:1:notifications", { userId: 1 });
    await writeCachedValue("user:2:notifications", { userId: 2 });

    await clearCachedValues("user:1:");

    expect(mockValues.has("hackos:offline:v1:user:1:notifications")).toBe(false);
    expect(mockValues.has("hackos:offline:v1:user:2:notifications")).toBe(true);
  });
});
