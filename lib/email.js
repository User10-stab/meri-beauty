/**
 * Reusable Email Service.
 * Dispatches actual emails via SMTP if configured, or falls back to console logging.
 *
 * @param {{ to: string, subject: string, text: string, html: string }} options
 */
  import { Resend } from "resend";

export async function sendEmail({ to, subject, text, html }) {
  // Always log mock output to the console for development and fallback simulation
  console.log(`\n [Simulated Email Service]`);
  console.log(`----------------------------------------`);
  console.log(`To:      ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`Body:\n${text}`);
  console.log(`----------------------------------------\n`);

  try {

    const resend = new Resend(process.env.RESEND_API_KEY);

    resend.emails.send({
      from:'onboarding@resend.dev',
      to: to,
      subject: subject,
      html: html
    });
  

  } catch (error) {
    // Catch when nodemailer is not installed or connection configuration fails
    console.log(`[Email Service] SMTP dispatch omitted: ${error.message}`);
  }
}
