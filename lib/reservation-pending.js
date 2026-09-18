"use client";

// Single-slot pending reservation snapshot, written by the client information
// step when the verification email goes out and consumed by the reservation
// form when the customer returns verified. Same-device handoff (the common
// case: inbox opened on the same phone/browser). The snapshot never contains
// the password — the account was already created with it server-side, and
// after auto-login the review/payment steps identify the customer from the
// session, never from this payload.
const KEY = "mb:reservation-pending:v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // matches the verification token lifetime

export function savePendingReservation(snapshot) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), ...snapshot }));
  } catch {
    // Private browsing / storage disabled — the verification still works,
    // only the seamless resume is lost.
  }
}

export function loadPendingReservation(email) {
  try {
    const raw = localStorage.getItem(KEY);
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

export function clearPendingReservation() {
  try {
    localStorage.removeItem(KEY);
  } catch {}
}
