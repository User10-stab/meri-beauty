/**
 * Reusable Email Service.
 * Sends email via OVH SMTP or captures it locally in Mailpit.
 *
 * @param {{ to: string | string[], subject: string, text: string, html: string, attachments?: { filename: string, content: Buffer }[], skipCc?: boolean, forceCc?: boolean, messageId?: string, beforeSubmit?: () => Promise<boolean> }} options
 *   skipCc=true : pas de copie interne au salon (campagnes marketing).
 *   forceCc=true : copie au salon même hors production (scripts lancés à la
 *   main sur le serveur, où NODE_ENV n'est pas « production »).
 */
import nodemailer from "nodemailer";
import { captureError } from "@/lib/monitoring";
import { brandedHtml } from "@/lib/email-templates";
import { reserveSmtpQuota, finishSmtpQuota } from "@/lib/campaigns/email-quota";

// Marker written into every HTML email that was built by the shared shell
// (htmlWrapper / buildEmailShell). Used by sendEmail to guarantee that no
// email leaves the app as bare, hand-rolled markup — the single most
// important guarantee of this module.
const EMAIL_SHELL_MARKER = "<!-- MERI_BEAUTY_EMAIL_SHELL -->";

const INTERNAL_COPY_ADDRESS = "contact@meribeautystudio.com";

/**
 * La copie interne (cc salon) n'est envoyée qu'en production, et jamais
 * quand l'appelant la refuse explicitement (campagnes marketing : une
 * copie PAR destinataire inonderait la boîte du salon).
 */
export function shouldCcInternal({ skipCc, forceCc } = {}) {
  if (skipCc) return false;
  if (forceCc) return true;
  return process.env.NODE_ENV === "production";
}

export { INTERNAL_COPY_ADDRESS };

function smtpFailureKind(error) {
  if (error.responseCode >= 400 && error.responseCode < 500) return "temporary";
  if (error.responseCode >= 500 && error.responseCode < 600) return "permanent";
  if (["EDNS", "ETLS", "EAUTH"].includes(error.code)) return "temporary";
  if (error.code === "EENVELOPE") return "permanent";
  if (/^(Connection timeout|Greeting never received)$/.test(error.message)) return "temporary";

  // Nodemailer can report socket errors as CONN even after sending DATA.
  // Without a rejection or evidence of a pre-submission failure, do not replay.
  return "unknown";
}

export async function sendEmail({ to, subject, text, html, attachments, skipCc, forceCc, messageId, beforeSubmit }) {
  // `to` is a single address or a list (invoice / credit-note delivery sends
  // the client plus address-book copies in one message).
  const hasRecipient = Array.isArray(to)
    ? to.some((addr) => typeof addr === "string" && addr.trim())
    : typeof to === "string" && to.trim();
  if (!hasRecipient) {
    return { success: false, error: "Missing recipient" };
  }

  // Hard guarantee: every email that goes out must be inside the branded
  // shell. Template functions (lib/email-templates.js) already return shelled
  // HTML. Any caller that still hands in a raw fragment (legacy inline HTML)
  // gets it wrapped here, so a plain/default email can never reach an inbox.
  let finalHtml = html;
  if (finalHtml && typeof finalHtml === "string" && !finalHtml.includes(EMAIL_SHELL_MARKER)) {
    try {
      finalHtml = brandedHtml(subject || "", finalHtml);
    } catch {
      // brandedHtml must never throw; if it somehow did, fall back to the
      // caller's markup rather than dropping the message entirely.
      finalHtml = html;
    }
  }

  const provider = process.env.EMAIL_PROVIDER || "smtp";
  if (process.env.NODE_ENV !== "production") {
    console.log(`[Email Service] ${provider} -> ${to}: ${subject}`);
  }

  if (provider === "mailpit") {
    // Mailpit is an isolated SMTP inbox for development/staging. Refuse to
    // route production mail there even if an environment variable is wrong.
    if (process.env.NODE_ENV === "production") {
      captureError(new Error("Mailpit is forbidden in production"), { area: "email", to, subject });
      return { success: false, error: "Mailpit is forbidden in production" };
    }

    try {
      const transport = nodemailer.createTransport({
        host: process.env.MAILPIT_SMTP_HOST || "127.0.0.1",
        port: Number(process.env.MAILPIT_SMTP_PORT || 1025),
        secure: false,
      });
      if (beforeSubmit && !(await beforeSubmit())) {
        return { success: false, kind: "cancelled", error: "Email submission cancelled" };
      }
      await transport.sendMail({
        from: process.env.EMAIL_FROM || "Meri Beauty Staging <staging@meribeautystudio.test>",
        to,
        // Local/dev mail stays in Mailpit's own inbox without the salon CC.
        subject,
        text,
        html: finalHtml,
        ...(attachments?.length ? { attachments } : {}),
      });
      return { success: true, provider: "mailpit" };
    } catch (error) {
      captureError(error, { area: "email", provider: "mailpit", to, subject });
      throw error;
    }
  }

  if (provider !== "smtp") {
    return { success: false, error: "Unsupported EMAIL_PROVIDER (use smtp or mailpit)" };
  }

  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) {
    console.log("[Email Service] SMTP_USER or SMTP_PASSWORD not set — email not sent");
    return { success: false, error: "SMTP_USER and SMTP_PASSWORD are required" };
  }

  const port = Number(process.env.SMTP_PORT || 465);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { success: false, error: "Invalid SMTP_PORT" };
  }

  let reservation;
  try {
    reservation = await reserveSmtpQuota();
  } catch (error) {
    captureError(error, { area: "email-quota", provider });
    return { success: false, kind: "temporary", error: "SMTP quota check failed" };
  }
  if (reservation.retryAt) {
    return { success: false, kind: "quota", retryAt: reservation.retryAt, error: "SMTP hourly limit reached" };
  }

  let submitted = false;
  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.mail.ovh.net",
      port,
      secure: port === 465,
      requireTLS: true,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });
    const cc = shouldCcInternal({ skipCc, forceCc }) ? INTERNAL_COPY_ADDRESS : undefined;
    if (beforeSubmit && !(await beforeSubmit())) {
      return { success: false, kind: "cancelled", error: "Email submission cancelled" };
    }
    submitted = true;
    const { messageId: acceptedId, accepted, rejected } = await transport.sendMail({
      from: process.env.EMAIL_FROM || { name: "Meri Beauty", address: user },
      replyTo: INTERNAL_COPY_ADDRESS,
      to,
      ...(cc ? { cc } : {}),
      subject,
      text: text ?? undefined,
      messageId,
      html: finalHtml,
      ...(attachments?.length ? { attachments } : {}),
    });

    if (rejected?.length) {
      captureError(new Error("SMTP rejected one or more recipients"), { area: "email", provider, to, subject, rejected });
      const recipients = [to].flat().map((address) => address?.trim().toLowerCase());
      if (cc && !recipients.includes(cc) && accepted.every((address) => address.toLowerCase() === cc)) {
        return { success: false, kind: "unknown", error: "SMTP accepted only the internal copy" };
      }
    }
    console.log("[Email Service] Email accepted via SMTP:", acceptedId);
    return { success: true, provider, id: acceptedId ?? null };
  } catch (error) {
    captureError(error, { area: "email", provider, to, subject });
    const kind = submitted ? smtpFailureKind(error) : "temporary";
    const rateLimited = kind === "temporary" &&
      /rate.limit|quota|too many|throttl/i.test(error.response || error.message || "");
    return { success: false, kind, rateLimited, error: error?.message ?? "Email delivery failed" };
  } finally {
    await finishSmtpQuota(reservation.id, submitted).catch((error) => {
      captureError(error, { area: "email-quota", provider });
    });
  }
}
