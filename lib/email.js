/**
 * Reusable Email Service.
 * Dispatches actual emails via SMTP if configured, or falls back to console logging.
 *
 * @param {{ to: string, subject: string, text: string, html: string, attachments?: { filename: string, content: Buffer }[] }} options
 */
import { Resend } from "resend";
import nodemailer from "nodemailer";
import { captureError } from "@/lib/monitoring";

export async function sendEmail({ to, subject, text, html, attachments }) {
  const provider = process.env.EMAIL_PROVIDER || "resend";
  if (process.env.NODE_ENV !== "production") {
    console.log(`[Email Service] ${provider} -> ${to}: ${subject}`);
  }

  if (provider === "mailpit") {
    // Mailpit is an isolated SMTP inbox for development/staging. Refuse to
    // route production mail there even if an environment variable is wrong.
    if (process.env.NODE_ENV === "production") {
      captureError(new Error("Mailpit is forbidden in production"), { area: "email", to, subject });
      return;
    }

    try {
      const transport = nodemailer.createTransport({
        host: process.env.MAILPIT_SMTP_HOST || "127.0.0.1",
        port: Number(process.env.MAILPIT_SMTP_PORT || 1025),
        secure: false,
      });
      await transport.sendMail({
        from: process.env.EMAIL_FROM || "Meri Beauty Staging <staging@meribeauty.test>",
        to,
        subject,
        text,
        html,
        ...(attachments?.length ? { attachments } : {}),
      });
      return;
    } catch (error) {
      captureError(error, { area: "email", provider: "mailpit", to, subject });
      throw error;
    }
  }

  if (!process.env.RESEND_API_KEY) {
    console.log(`[Email Service] RESEND_API_KEY not set — email not sent`);
    return;
  }

  try {

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      // Use a consistent branded from + explicit Reply-To.
      // Some inbox providers penalize bare role accounts and missing reply-to.
      from: "Meri Beauty <contact@meribeautystudio.com>",
      replyTo: "contact@meribeautystudio.com",
      to,
      subject,
      // Always include a text part; missing text increases spam scoring.
      text: text ?? undefined,
      html,
      ...(attachments?.length ? { attachments } : {}),
    });

    if (error) {
      captureError(new Error(error?.message || "Resend API returned an error"), {
        area: "email",
        to,
        subject,
        resendError: error,
      });
    } else {
      console.log(`[Email Service] Email sent successfully via Resend:`, data);
    }
  } catch (error) {
    captureError(error, { area: "email", to, subject });
  }
}
