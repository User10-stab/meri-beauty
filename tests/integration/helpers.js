import { AsyncLocalStorage } from "node:async_hooks";

// Real Next.js scopes cookies()/headers() to the current request via
// AsyncLocalStorage under the hood. We fake exactly that: each simulated
// "request" runs inside `withCookieJar`, and the mocked cookies() below reads
// whichever jar is active on that call stack. This is what lets two
// concurrent Promise.all branches in the same test process each look like an
// independent guest browser with its own cart cookie — without it, both
// branches would share one global cookie jar and collide on the same cart.
export const cookieJarStorage = new AsyncLocalStorage();

export function withCookieJar(jar, fn) {
  return cookieJarStorage.run(jar, fn);
}

export function makeCookieJar(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    get(name) {
      return store.has(name) ? { value: store.get(name) } : undefined;
    },
    set(name, value) {
      store.set(name, value);
    },
  };
}

/** Unique per test-run tag so cleanup can find (and only find) our own rows. */
export function testTag() {
  return `zz-concurrency-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
