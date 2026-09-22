"use client";

// Generic version of the localStorage snapshot reservation pioneered: written
// by a checkout/booking page's account step right before the verification
// email goes out, consumed when the customer returns via the emailed link.
// Namespaced by `flow` (e.g. "reservation", "formation", "workshop", "order")
// so different flows never collide on the same browser. Same-device handoff
// (the common case: inbox opened on the same phone/browser). The snapshot
// never contains the password — the account was already created with it
// server-side, and after auto-login the resumed step identifies the customer
// from the session, never from this payload.
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // matches the verification token lifetime

function keyFor(flow) {
  return `mb:pending-checkout:${flow}:v1`;
}

export function savePendingCheckout(flow, snapshot) {
  try {
    localStorage.setItem(keyFor(flow), JSON.stringify({ v: 1, savedAt: Date.now(), ...snapshot }));
  } catch {
    // Private browsing / storage disabled — verification still works, only
    // the seamless resume is lost.
  }
}

export function loadPendingCheckout(flow, email) {
  try {
    const raw = localStorage.getItem(keyFor(flow));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.v !== 1) return null;
    if (!parsed.email || parsed.email.toLowerCase() !== String(email ?? "").toLowerCase()) return null;
    if (!parsed.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    if (!parsed.data) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingCheckout(flow) {
  try {
    localStorage.removeItem(keyFor(flow));
  } catch {}
}
