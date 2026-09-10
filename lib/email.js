/**
 * Reusable Email Service.
 * Dispatches actual emails via SMTP if configured, or falls back to console logging.
 *
 * @param {{ to: string, subject: string, text: string, html: string, attachments?: { filename: string, content: Buffer }[] }} options
 */
import { Resend } from "resend";
import nodemailer from "nodemailer";
import { captureError } from "@/lib/monitoring";
import { brandedHtml } from "@/lib/email-templates";

// Marker written into every HTML email that was built by the shared shell
// (htmlWrapper / buildEmailShell). Used by sendEmail to guarantee that no
// email leaves the app as bare, hand-rolled markup — the single most
// important guarantee of this module.
const EMAIL_SHELL_MARKER = "<!-- MERI_BEAUTY_EMAIL_SHELL -->";

export async function sendEmail({ to, subject, text, html, attachments }) {
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

  const provider = process.env.EMAIL_PROVIDER || "resend";
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
      await transport.sendMail({
        from: process.env.EMAIL_FROM || "Meri Beauty Staging <staging@meribeautystudio.test>",
        to,
        cc: "contact@meribeautystudio.com",
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

  if (!process.env.RESEND_API_KEY) {
    console.log(`[Email Service] RESEND_API_KEY not set — email not sent`);
    return { success: false, error: "RESEND_API_KEY not set" };
  }

  try {

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      // Use a consistent branded from + explicit Reply-To.
      // Some inbox providers penalize bare role accounts and missing reply-to.
      from: "Meri Beauty <contact@meribeautystudio.com>",
      replyTo: "contact@meribeautystudio.com",
      to,
      cc: "contact@meribeautystudio.com",
      subject,
      // Always include a text part; missing text increases spam scoring.
      text: text ?? undefined,
      html: finalHtml,
      ...(attachments?.length ? { attachments } : {}),
    });

    if (error) {
      captureError(new Error(error?.message || "Resend API returned an error"), {
        area: "email",
        to,
        subject,
        resendError: error,
      });
      return { success: false, error: error?.message || "Resend API returned an error" };
    }
    console.log(`[Email Service] Email sent successfully via Resend:`, data);
    return { success: true, provider: "resend", id: data?.id ?? null };
  } catch (error) {
    captureError(error, { area: "email", to, subject });
    return { success: false, error: error?.message ?? "Email delivery failed" };
  }
}
