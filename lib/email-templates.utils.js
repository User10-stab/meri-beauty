/**
 * Utility functions for email templates.
 * htmlWrapper wraps email HTML with the branded shell (footer, colors, etc.).
 */

export function htmlWrapper(subject, html) {
  const EMAIL_SHELL_MARKER = "<!-- MERI_BEAUTY_EMAIL_SHELL -->";

  // If the HTML already has the shell marker, return as-is
  if (html && typeof html === "string" && html.includes(EMAIL_SHELL_MARKER)) {
    return { subject, html };
  }

  // Otherwise, wrap with the branded shell
  const brandedHtml = `
    ${html}
    <hr style="margin: 20px 0; border: 0; border-top: 1px solid #e0e0e0;" />
    <p style="font-size: 12px; color: #888; text-align: center;">
      <a href="https://merribeauty.com" style="color: #888;">Meri Beauty</a> • Jette, Brussels
    </p>
  `;

  return { subject, html: brandedHtml };
}