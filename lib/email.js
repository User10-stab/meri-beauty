/**
 * Reusable Email Service.
 * Dispatches actual emails via SMTP if configured, or falls back to console logging.
 *
 * @param {{ to: string, subject: string, text: string, html: string, attachments?: { filename: string, content: Buffer }[] }} options
 */
import { Resend } from "resend";

export async function sendEmail({ to, subject, text, html, attachments }) {
  // Always log mock output to the console for development and fallback simulation
  console.log(`\n [Simulated Email Service]`);
  console.log(`----------------------------------------`);
  console.log(`To:      ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`Body:\n${text}`);
  console.log(`----------------------------------------\n`);

  if (!process.env.RESEND_API_KEY) {
    console.log(`[Email Service] RESEND_API_KEY not set — email not sent`);
    return;
  }

  try {

    const resend = new Resend(process.env.RESEND_API_KEY);

    const { data, error } = await resend.emails.send({
      from: 'contact@meribeautystudio.com',
      to: to,
      subject: subject,
      html: html,
      ...(attachments?.length ? { attachments } : {}),
    });

    if (error) {
      console.error(`[Email Service] Resend error:`, error);
    } else {
      console.log(`[Email Service] Email sent successfully via Resend:`, data);
    }
  } catch (error) {
    console.error(`[Email Service] Error: ${error?.message || error}`);
  }
}
