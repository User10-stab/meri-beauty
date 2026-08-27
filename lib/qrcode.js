import QRCode from "qrcode";

/** Black-on-white, not brand colors — contrast is what makes a scan reliable. */
const OPTIONS = { margin: 1, width: 240, color: { dark: "#000000", light: "#FFFFFF" } };

async function qrDataUrl(value) {
  return QRCode.toDataURL(value, OPTIONS);
}

/** Data-URL QR code for a boutique order's pickup code. */
export async function pickupQrDataUrl(code) {
  return qrDataUrl(code);
}

/** Data-URL QR code for an atelier/événement/formation check-in ticket. */
export async function checkInQrDataUrl(code) {
  return qrDataUrl(code);
}

/**
 * The same QR as a real PNG file, for attaching to an e-mail.
 *
 * Deliberately an attachment rather than an image in the message body: a
 * `data:` URI is stripped by Gmail and most webmail, and CID embedding is
 * spelled differently by our two transports (Resend wants `content_id`,
 * nodemailer wants `cid`), so an attachment is the only form that actually
 * renders for every recipient. On a phone it opens full-screen, which is what
 * someone holding it up at a door or a counter wants anyway.
 *
 * Callers should `.catch(() => null)` and send the mail regardless — the
 * readable code in the body is the fallback, and a missing QR must never cost
 * the customer their confirmation e-mail.
 *
 * @returns {Promise<{ filename: string, content: Buffer }>}
 */
export async function qrPngAttachment(value, filename) {
  return { filename, content: await QRCode.toBuffer(value, OPTIONS) };
}
