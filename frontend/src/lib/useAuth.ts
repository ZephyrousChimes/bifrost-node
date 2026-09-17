"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "bifrost_dashboard_api_key";

// The secret key lives only in this browser's localStorage -- there's no session/cookie layer
// on the dashboard, it's a thin client over the API's own bearer-token auth. Wrapped in
// try/catch per the platform's usual localStorage caveats (private browsing, blocked storage).
export function useAuth() {
  const [apiKey, setApiKeyState] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      setApiKeyState(localStorage.getItem(STORAGE_KEY));
    } catch {
      setApiKeyState(null);
    }
    setLoaded(true);
  }, []);

  const setApiKey = useCallback((key: string) => {
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      /* per-viewer convenience only -- a failed write just means it won't persist across reloads */
    }
    setApiKeyState(key);
  }, []);

  const clearApiKey = useCallback(() => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* see above */
    }
    setApiKeyState(null);
  }, []);

  return { apiKey, setApiKey, clearApiKey, loaded };
}
