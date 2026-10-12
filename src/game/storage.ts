// The one door to localStorage. Storage can fail at any point in a real
// browser: blocked site data (and third-party iframes denied storage) throws
// SecurityError from the `localStorage` getter itself, and a full disk throws
// QuotaExceededError from setItem. Each helper wraps the whole access, getter
// included, so the game keeps running, just without memory.

export function get(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function set(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage is best-effort
  }
}

export function remove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // storage is best-effort
  }
}

export function keys(): string[] {
  try {
    const out: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key !== null) out.push(key);
    }
    return out;
  } catch {
    return [];
  }
}
