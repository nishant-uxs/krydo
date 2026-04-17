/**
 * Small module-global store for the SIWE-issued JWT. We keep it in
 * localStorage so it survives reloads, and we cache it in memory for fast
 * access on every request without touching the Storage API.
 */
const KEY = "krydo_auth_token";
let inMemoryToken: string | null = null;

function hydrate(): string | null {
  if (inMemoryToken) return inMemoryToken;
  if (typeof window === "undefined") return null;
  try {
    inMemoryToken = window.localStorage.getItem(KEY);
  } catch {
    inMemoryToken = null;
  }
  return inMemoryToken;
}

hydrate();

export function getAuthToken(): string | null {
  return inMemoryToken ?? hydrate();
}

export function setAuthToken(token: string | null) {
  inMemoryToken = token;
  try {
    if (token) {
      window.localStorage.setItem(KEY, token);
    } else {
      window.localStorage.removeItem(KEY);
    }
  } catch {
    /* ignore quota / SSR errors */
  }
}

export function authHeader(): Record<string, string> {
  const t = getAuthToken();
  return t ? { Authorization: `Bearer ${t}` } : {};
}
