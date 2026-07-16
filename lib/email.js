/**
 * Reusable Email Service.
 * Dispatches actual emails via SMTP if configured, or falls back to console logging.
 *
 * @param {{ to: string, subject: string, text: string, html: string }} options
 */
export async function sendEmail({ to, subject, text, html }) {
  // Always log mock output to the console for development and fallback simulation
  console.log(`\n [Simulated Email Service]`);
  console.log(`----------------------------------------`);
  console.log(`To:      ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(`Body:\n${text}`);
  console.log(`----------------------------------------\n`);

  try {
    // Dynamically check if nodemailer is available to avoid runtime crashes
    const nodemailer = await import("nodemailer");
    
    const host = process.env.SMTP_HOST;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;

    if (host && user && pass) {
      const transporter = nodemailer.createTransport({
        host,
        port: parseInt(process.env.SMTP_PORT || "587"),
        secure: process.env.SMTP_SECURE === "true",
        auth: { user, pass },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || '"Meri Beauty" <noreply@meribeauty.com>',
        to,
        subject,
        text,
        html,
      });

      console.log(`[Email Service] Actual email successfully sent to ${to} via SMTP.`);
    } else {
      console.log(`[Email Service] SMTP is not configured. Mock logging utilized.`);
    }
  } catch (error) {
    // Catch when nodemailer is not installed or connection configuration fails
    console.log(`[Email Service] SMTP dispatch omitted: ${error.message}`);
  }
}
