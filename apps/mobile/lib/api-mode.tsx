import * as SecureStore from "expo-secure-store";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from "react";
import { authClient, configureAuthClient, signOut } from "./auth-client";
import { DEVELOPMENT_API_URL, PRODUCTION_API_URL, setApiUrl } from "./env";
import { clearApiEnvironmentData } from "./storage-usage";

export type ApiMode = "development" | "production";

const STORAGE_KEY = "hackos_api_mode";

export function apiUrlFor(mode: ApiMode): string {
  return mode === "development" ? DEVELOPMENT_API_URL : PRODUCTION_API_URL;
}

export function isApiMode(value: string | null): value is ApiMode {
  return value === "development" || value === "production";
}

async function readApiMode(): Promise<ApiMode> {
  try {
    const stored = await SecureStore.getItemAsync(STORAGE_KEY);
    return isApiMode(stored) ? stored : "production";
  } catch {
    return "production";
  }
}

function applyApiMode(mode: ApiMode): void {
  setApiUrl(apiUrlFor(mode));
  // Better Auth captures its base URL at creation, so replace the client
  // before any authenticated child is mounted.
  configureAuthClient(mode);
}

interface ApiModeContextValue {
  mode: ApiMode;
  setMode: (mode: ApiMode) => Promise<void>;
}

const ApiModeContext = createContext<ApiModeContextValue>({
  mode: "production",
  setMode: async () => undefined,
});

/** Hydrates the hidden endpoint preference before requests can begin. */
export function ApiModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ApiMode | null>(null);

  useEffect(() => {
    void readApiMode().then((storedMode) => {
      applyApiMode(storedMode);
      setModeState(storedMode);
    });
  }, []);

  const setMode = useCallback(
    async (nextMode: ApiMode) => {
      if (nextMode === mode) return;
      // Close the old server-side session before changing API_URL. If this
      // fails (for example offline), retain the old environment and its queue
      // rather than risk replaying a scanner operation against a new server.
      if (authClient.getCookie()) {
        const result = await signOut();
        if (result.error)
          throw new Error(result.error.message || "Could not close the previous session");
      }
      await clearApiEnvironmentData();
      await SecureStore.setItemAsync(STORAGE_KEY, nextMode);
      applyApiMode(nextMode);
      setModeState(nextMode);
    },
    [mode],
  );

  // Do not let the default production client make a request before a persisted
  // development selection has had a chance to hydrate.
  if (mode === null) return null;

  return (
    <ApiModeContext.Provider value={{ mode, setMode }} key={mode}>
      {children}
    </ApiModeContext.Provider>
  );
}

export function useApiMode(): ApiModeContextValue {
  return useContext(ApiModeContext);
}
