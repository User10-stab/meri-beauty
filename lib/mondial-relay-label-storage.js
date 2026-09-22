/**
 * Local copy of a Mondial Relay shipping label PDF.
 *
 * Mondial Relay's own `labelUrl` (returned from createShipmentLabel) is
 * never handed to the browser directly and never trusted to stay valid: its
 * actual lifetime has never been confirmed (see the sandbox-characterization
 * step of the Mondial Relay test plan), and the PDF carries the customer's
 * name, address and phone, so it shouldn't be a bare external/guessable
 * link either way. Instead we fetch it once, right after a successful
 * creation, and keep our own copy — served back out only through the
 * authenticated route at app/api/orders/[id]/shipping-label.
 *
 * Stored outside `public/` on purpose (see .gitignore) — same on-disk
 * convention as app/api/upload/route.js, but never web-servable by path
 * guessing the way public/uploads is.
 */

import { writeFile, readFile, mkdir } from "fs/promises";
import path from "path";

const LABEL_DIR = path.join(process.cwd(), "private-uploads", "mondial-relay-labels");

function labelPath(orderId) {
  // orderId is always our own cuid, never attacker-influenced — still,
  // never build a path from anything that could contain a separator.
  const safeId = String(orderId).replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(LABEL_DIR, `${safeId}.pdf`);
}

/**
 * Fetches `labelUrl` and writes it to disk. Never throws — a failure here
 * must not undo an already-purchased, already-billed shipment; the caller
 * falls back to the raw Mondial Relay URL and logs this as a critical error.
 * @returns {Promise<boolean>} whether the local copy now exists.
 */
export async function storeShippingLabel(orderId, labelUrl) {
  try {
    const response = await fetch(labelUrl);
    if (!response.ok) {
      console.error("[mondial-relay-label-storage] fetch failed", response.status, orderId);
      return false;
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    await mkdir(LABEL_DIR, { recursive: true });
    await writeFile(labelPath(orderId), bytes);
    return true;
  } catch (error) {
    console.error("[mondial-relay-label-storage] store failed", orderId, error);
    return false;
  }
}

/**
 * @returns {Promise<Buffer|null>} the stored PDF bytes, or null if no local
 * copy exists (falls back to Order.labelUrl at the call site).
 */
export async function readStoredShippingLabel(orderId) {
  try {
    return await readFile(labelPath(orderId));
  } catch {
    return null;
  }
}
