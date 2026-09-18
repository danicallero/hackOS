const mockSecureStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
}));

const mockConfigureAuthClient = jest.fn();
jest.mock("./auth-client", () => ({
  configureAuthClient: (...args: unknown[]) => mockConfigureAuthClient(...args),
}));

import { apiUrlFor, isApiMode } from "./api-mode";
import { DEVELOPMENT_API_URL, PRODUCTION_API_URL } from "./env";

describe("API endpoint modes", () => {
  beforeEach(() => {
    mockSecureStore.clear();
    mockConfigureAuthClient.mockClear();
  });

  it("maps only the two supported modes to their fixed endpoints", () => {
    expect(PRODUCTION_API_URL).toBe("https://api.hackudc.com");
    expect(DEVELOPMENT_API_URL).toBe("https://api.dani.md");
    expect(apiUrlFor("production")).toBe(PRODUCTION_API_URL);
    expect(apiUrlFor("development")).toBe(DEVELOPMENT_API_URL);
    expect(isApiMode("production")).toBe(true);
    expect(isApiMode("development")).toBe(true);
    expect(isApiMode("http://localhost:3000")).toBe(false);
    expect(isApiMode(null)).toBe(false);
  });
});
