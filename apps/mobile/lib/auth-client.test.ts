const mockSecureStoreData = new Map<string, string>();

jest.mock("@better-auth/expo/client", () => ({
  expoClient: jest.fn(() => ({})),
}));
jest.mock("better-auth/client/plugins", () => ({
  inferAdditionalFields: jest.fn(() => ({})),
}));
jest.mock("better-auth/react", () => ({
  createAuthClient: jest.fn(() => ({
    $fetch: jest.fn(),
    $store: {
      atoms: {
        session: {
          get: jest.fn(() => ({
            data: { user: { id: "user-1" } },
            error: null,
            isPending: false,
          })),
          set: jest.fn(),
        },
      },
    },
    getCookie: jest.fn(() => "hackos.session_token=old-session"),
    signIn: {},
    signOut: jest.fn(),
  })),
}));
jest.mock("expo-secure-store", () => ({
  deleteItemAsync: jest.fn((key: string) => {
    mockSecureStoreData.delete(key);
    return Promise.resolve();
  }),
  getItemAsync: jest.fn((key: string) => Promise.resolve(mockSecureStoreData.get(key) ?? null)),
  setItemAsync: jest.fn((key: string, value: string) => {
    mockSecureStoreData.set(key, value);
    return Promise.resolve();
  }),
}));
jest.mock("./env", () => ({ API_URL: "https://api.example.test/" }));
jest.mock("./sign-out-events", () => ({ notifySignOut: jest.fn() }));

import * as SecureStore from "expo-secure-store";
import { authClient, forceLocalSignOut, signOut } from "./auth-client";
import { notifySignOut } from "./sign-out-events";

const mockSecureStore = SecureStore as jest.Mocked<typeof SecureStore>;
const mockAuthClient = authClient as unknown as {
  $fetch: jest.Mock;
  $store: { atoms: { session: { get: jest.Mock; set: jest.Mock } } };
  getCookie: jest.Mock;
  signOut: jest.Mock;
};
const mockNotifySignOut = notifySignOut as jest.Mock;

describe("mobile sign-out", () => {
  beforeEach(() => {
    mockSecureStoreData.clear();
    mockNotifySignOut.mockReset();
    mockAuthClient.getCookie.mockReset().mockReturnValue("hackos.session_token=old-session");
    mockAuthClient.$fetch.mockReset().mockResolvedValue({ data: { success: true }, error: null });
    mockAuthClient.$store.atoms.session.get.mockReset().mockReturnValue({
      data: { user: { id: "user-1" } },
      error: null,
      isPending: false,
    });
    mockAuthClient.$store.atoms.session.set.mockReset();
    mockSecureStore.deleteItemAsync.mockClear();
    mockSecureStore.getItemAsync.mockClear();
  });

  it("clears local session state and resolves without waiting for the server", async () => {
    mockSecureStoreData.set("hackos_cookie", "\u0001ba-chunks:2");
    mockSecureStoreData.set("hackos_cookie.0", "hackos.session_token=old-");
    mockSecureStoreData.set("hackos_cookie.1", "session");
    mockSecureStoreData.set("hackos_session_data", "\u0001ba-chunks:1");
    mockSecureStoreData.set("hackos_session_data.0", '{"session":{}}');

    let resolveServerRequest!: (value: unknown) => void;
    mockAuthClient.$fetch.mockReturnValue(
      new Promise((resolve) => {
        resolveServerRequest = resolve;
      }),
    );

    const result = await signOut();

    expect(result).toEqual({ data: { success: true }, error: null });
    expect(mockNotifySignOut).toHaveBeenCalledTimes(1);
    expect(mockAuthClient.signOut).not.toHaveBeenCalled();
    expect(mockAuthClient.$store.atoms.session.set).toHaveBeenCalledWith({
      data: null,
      error: null,
      isPending: false,
    });
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("hackos_cookie.0");
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("hackos_cookie.1");
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("hackos_cookie");
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("hackos_session_data.0");
    expect(mockSecureStore.deleteItemAsync).toHaveBeenCalledWith("hackos_session_data");
    expect(mockAuthClient.$fetch).toHaveBeenCalledWith(
      "https://api.example.test/api/auth/sign-out",
      expect.objectContaining({ method: "POST", onRequest: expect.any(Function) }),
    );
    const requestOptions = mockAuthClient.$fetch.mock.calls[0][1] as {
      onRequest: (context: { headers: Headers }) => void;
    };
    const headers = new Headers();
    requestOptions.onRequest({ headers });
    expect(headers.get("cookie")).toBe("hackos.session_token=old-session");

    resolveServerRequest({ data: { success: true }, error: null });
  });

  it("does not surface a failed server revoke after local sign-out", async () => {
    mockAuthClient.$fetch.mockRejectedValue(new Error("offline"));

    await expect(signOut()).resolves.toEqual({ data: { success: true }, error: null });
    await Promise.resolve();

    expect(mockNotifySignOut).toHaveBeenCalledTimes(1);
  });

  it("clears the in-memory session immediately when the fallback storage cleanup hangs", () => {
    mockSecureStore.getItemAsync.mockReturnValue(new Promise<string | null>(() => {}));

    forceLocalSignOut();

    expect(mockNotifySignOut).toHaveBeenCalledTimes(1);
    expect(mockAuthClient.$store.atoms.session.set).toHaveBeenCalledWith({
      data: null,
      error: null,
      isPending: false,
    });
  });
});
