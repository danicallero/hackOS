// expo-crypto and expo-secure-store are native modules with no JS-only
// implementation to run under plain Jest. These fakes model just enough of
// each library's contract (an importable/exportable key object, a sealed
// blob that round-trips through JSON, an in-memory Keychain/Keystore) to
// exercise scanner-crypto.ts's own logic: which key gets used for which
// owner, and that resetting a key really forces a fresh one next time.
const mockSecureStore = new Map<string, string>();

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => mockSecureStore.get(key) ?? null),
  setItemAsync: jest.fn(async (key: string, value: string) => {
    mockSecureStore.set(key, value);
  }),
  deleteItemAsync: jest.fn(async (key: string) => {
    mockSecureStore.delete(key);
  }),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "WHEN_UNLOCKED_THIS_DEVICE_ONLY",
}));

jest.mock("expo-crypto", () => {
  let mockKeyCounter = 0;

  class MockAESEncryptionKey {
    material: string;
    constructor(material: string) {
      this.material = material;
    }
    static async generate() {
      mockKeyCounter += 1;
      return new MockAESEncryptionKey(`generated-${mockKeyCounter}`);
    }
    static async import(material: string) {
      return new MockAESEncryptionKey(material);
    }
    async encoded() {
      return this.material;
    }
  }

  class MockAESSealedData {
    keyMaterial: string;
    json: string;
    constructor(keyMaterial: string, json: string) {
      this.keyMaterial = keyMaterial;
      this.json = json;
    }
    static fromCombined(combined: string) {
      const [keyMaterial, json] = JSON.parse(combined);
      return new MockAESSealedData(keyMaterial, json);
    }
    combined() {
      return JSON.stringify([this.keyMaterial, this.json]);
    }
  }

  return {
    AESKeySize: { AES256: 256 },
    AESEncryptionKey: MockAESEncryptionKey,
    AESSealedData: MockAESSealedData,
    aesEncryptAsync: jest.fn(
      async (bytes: Uint8Array, key: InstanceType<typeof MockAESEncryptionKey>) => {
        const json = new TextDecoder().decode(bytes);
        return new MockAESSealedData(key.material, json);
      },
    ),
    aesDecryptAsync: jest.fn(
      async (
        sealed: InstanceType<typeof MockAESSealedData>,
        key: InstanceType<typeof MockAESEncryptionKey>,
      ) => {
        if (sealed.keyMaterial !== key.material) {
          throw new Error("decryption failed: wrong key");
        }
        return new TextEncoder().encode(sealed.json);
      },
    ),
  };
});

import {
  decryptJson,
  encryptJson,
  getQueueKey,
  getRosterKey,
  resetRosterKey,
} from "./scanner-crypto";

beforeEach(() => {
  mockSecureStore.clear();
  jest.clearAllMocks();
});

describe("getRosterKey", () => {
  it("persists the same key across calls until reset", async () => {
    const first = await getRosterKey();
    const second = await getRosterKey();
    expect(await first.encoded("base64")).toEqual(await second.encoded("base64"));
  });

  it("issues a brand new key after resetRosterKey", async () => {
    const before = await getRosterKey();
    await resetRosterKey();
    const after = await getRosterKey();
    expect(await after.encoded("base64")).not.toEqual(await before.encoded("base64"));
  });
});

describe("getQueueKey", () => {
  it("gives different users different keys", async () => {
    const a = await getQueueKey(1);
    const b = await getQueueKey(2);
    expect(await a.encoded("base64")).not.toEqual(await b.encoded("base64"));
  });

  it("gives the same user the same key as long as it's persisted in SecureStore", async () => {
    const first = await getQueueKey(7);
    const stored = mockSecureStore.get("scanner-queue-key-7");
    expect(stored).toBeDefined();
    const second = await getQueueKey(7);
    expect(await second.encoded("base64")).toEqual(await first.encoded("base64"));
  });
});

describe("encryptJson / decryptJson", () => {
  it("round-trips arbitrary JSON through a given key", async () => {
    const key = await getRosterKey();
    const value = { name: "Ada", intolerances: [1, 2], notes: null };
    const sealed = await encryptJson(value, key);
    const decrypted = await decryptJson<typeof value>(sealed, key);
    expect(decrypted).toEqual(value);
  });

  it("cannot be decrypted with a different owner's key", async () => {
    const a = await getQueueKey(1);
    const b = await getQueueKey(2);
    const sealed = await encryptJson({ secret: true }, a);
    await expect(decryptJson(sealed, b)).rejects.toThrow();
  });
});
