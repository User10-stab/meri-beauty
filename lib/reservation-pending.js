"use client";

// Reservation-specific wrapper around lib/pending-checkout.js. Keeps the
// original storage key ("mb:reservation-pending:v1", not the generic
// "mb:pending-checkout:reservation:v1") so a snapshot already sitting in a
// customer's browser from before this file existed is not orphaned.
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
