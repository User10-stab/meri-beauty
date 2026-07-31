/**
 * Email templates for Meri Beauty.
 *
 * Each function returns { subject, text, html } ready to pass to sendEmail().
 */

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date) {
  return new Date(date).toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

const brandColor = "#C8A46A";
const darkColor   = "#2F3A2E";

function htmlWrapper(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f9f9f7;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f7;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.08);">
          <!-- Header -->
          <tr>
            <td style="background:${darkColor};padding:28px 40px;text-align:center;">
              <span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:1px;">Meri Beauty</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:36px 40px 28px;">
              ${bodyHtml}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f4f4f0;padding:20px 40px;text-align:center;">
              <p style="margin:0;font-size:12px;color:#999;">
                © ${new Date().getFullYear()} Meri Beauty · Tous droits réservés<br/>
                Vous recevez cet email car vous êtes inscrit(e) à notre newsletter.
              </p>
              <p style="margin:4px 0 0;font-size:11px;color:#aaa;">
                Si vous ne souhaitez plus recevoir nos communications, vous pouvez vous désabonner depuis votre compte.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function divider() {
  return `<hr style="border:none;border-top:1px solid #eeede9;margin:24px 0;" />`;
}

function infoRow(label, value) {
  return `
    <tr>
      <td style="padding:6px 0;color:#888;font-size:14px;width:140px;vertical-align:top;">${label}</td>
      <td style="padding:6px 0;color:#2F3A2E;font-size:14px;font-weight:600;">${value}</td>
    </tr>`;
}

// ─── 1. Reservation received (PENDING status) ─────────────────────────────────

/**
 * @param {{
 *   customerName: string,
 *   serviceName: string,
 *   staffName: string,
 *   date: Date|string,
 *   time: string,
 * }} params
 */
export function reservationReceivedEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
}) {
  const subject = "Demande de réservation reçue – Meri Beauty";

  const text = `
Bonjour ${customerName},

Nous avons bien reçu votre demande de réservation. Voici un récapitulatif :

  Service   : ${serviceName}
  Experte   : ${staffName}
  Date      : ${formatDate(date)} à ${time}

Notre équipe va examiner votre demande et vous recevrez un email de confirmation avec un lien de paiement dans les plus brefs délais.

En cas de question, n'hésitez pas à nous contacter.

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Demande reçue ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Nous avons bien reçu votre demande de réservation.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Experte", staffName)}
        ${infoRow("Date", formatDate(date))}
        ${infoRow("Heure", time)}
      </tbody>
    </table>

    <div style="background:#fef3cd;border-left:4px solid ${brandColor};padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#856404;line-height:1.6;">
        ⏳ <strong>En attente de confirmation</strong><br/>
        Notre équipe va examiner votre demande. Vous recevrez un email de confirmation avec un lien de paiement dans les plus brefs délais.
      </p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      En cas de question, n'hésitez pas à nous contacter.
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

// ─── 2. Reservation confirmed with payment link ───────────────────────────────

/**
 * @param {{
 *   customerName: string,
 *   serviceName: string,
 *   staffName: string,
 *   date: Date|string,
 *   time: string,
 *   totalAmount: number,
 *   paymentUrl: string,
 * }} params
 */
export function reservationConfirmedWithPaymentLinkEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  totalAmount,
  paymentUrl,
}) {
  const subject = "Votre réservation est confirmée – Procédez au paiement";

  const text = `
Bonjour ${customerName},

Bonne nouvelle ! Votre réservation a été confirmée par notre équipe.

  Service   : ${serviceName}
  Experte   : ${staffName}
  Date      : ${formatDate(date)} à ${time}
  Montant   : €${Number(totalAmount).toFixed(2)}

Pour finaliser votre réservation, veuillez procéder au paiement en cliquant sur le lien ci-dessous :

${paymentUrl}

Vous pourrez choisir entre :
- Paiement en ligne (100% du montant)
- Paiement sur place (acompte de 10% en ligne)

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réservation confirmée ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Bonne nouvelle ! Votre réservation a été confirmée par notre équipe.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Experte", staffName)}
        ${infoRow("Date", formatDate(date))}
        ${infoRow("Heure", time)}
        ${infoRow("Montant", `<span style="color:${brandColor};font-size:16px;">€${Number(totalAmount).toFixed(2)}</span>`)}
      </tbody>
    </table>

    <div style="background:#d1ecf1;border-left:4px solid #0c5460;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0 0 12px;font-size:14px;color:#0c5460;line-height:1.6;">
        💳 <strong>Paiement requis</strong><br/>
        Pour finaliser votre réservation, veuillez procéder au paiement.
      </p>
      <p style="margin:0;font-size:13px;color:#0c5460;">
        Vous pourrez choisir entre :<br/>
        • Paiement en ligne (100%)<br/>
        • Paiement sur place (acompte de 10% en ligne)
      </p>
    </div>

    <a href="${paymentUrl}"
       style="display:inline-block;background:${brandColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;margin-bottom:24px;">
      Procéder au paiement
    </a>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Nous avons hâte de vous accueillir !
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

// ─── 3. Payment confirmation ──────────────────────────────────────────────────

/**
 * @param {{
 *   customerName: string,
 *   serviceName: string,
 *   staffName: string,
 *   date: Date|string,
 *   time: string,
 *   paidAmount: number,
 *   totalAmount: number,
 *   paymentMethod: string,
 * }} params
 */
export function paymentConfirmationEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  paidAmount,
  totalAmount,
  paymentMethod,
}) {
  const isFullPayment = Number(paidAmount) >= Number(totalAmount);
  const remainingAmount = Number(totalAmount) - Number(paidAmount);
  
  const subject = "Paiement confirmé – Meri Beauty";

  const text = `
Bonjour ${customerName},

Votre paiement a bien été reçu. Votre rendez-vous est maintenant confirmé !

  Service   : ${serviceName}
  Experte   : ${staffName}
  Date      : ${formatDate(date)} à ${time}
  ${isFullPayment ? `Montant payé : €${Number(paidAmount).toFixed(2)}` : `Acompte réglé : €${Number(paidAmount).toFixed(2)}
  Restant à payer sur place : €${remainingAmount.toFixed(2)}`}

${!isFullPayment ? 'Le solde sera à régler directement au salon lors de votre visite.\n\n' : ''}Nous avons hâte de vous accueillir !

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Paiement confirmé ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Votre paiement a bien été reçu. Votre rendez-vous est maintenant confirmé !</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Experte", staffName)}
        ${infoRow("Date", formatDate(date))}
        ${infoRow("Heure", time)}
        ${isFullPayment 
          ? infoRow("Montant payé", `<span style="color:#2a7a4b;">€${Number(paidAmount).toFixed(2)}</span>`)
          : `${infoRow("Acompte réglé", `<span style="color:#2a7a4b;">€${Number(paidAmount).toFixed(2)}</span>`)}
             ${infoRow("Restant à payer", `<span style="color:${brandColor};">€${remainingAmount.toFixed(2)}</span>`)}`
        }
      </tbody>
    </table>

    ${!isFullPayment ? `
    <div style="background:#fff3cd;border-left:4px solid #856404;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#856404;line-height:1.6;">
        💰 Le solde de <strong>€${remainingAmount.toFixed(2)}</strong> sera à régler directement au salon lors de votre visite.
      </p>
    </div>
    ` : ''}

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Nous avons hâte de vous accueillir !
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

// ─── 2. Welcome email with temporary credentials ──────────────────────────────

/**
 * @param {{
 *   customerName: string,
 *   email: string,
 *   temporaryPassword: string,
 *   loginUrl: string,
 * }} params
 */
export function welcomeWithCredentialsEmail({
  customerName,
  email,
  temporaryPassword,
  loginUrl,
}) {
  const subject = "Bienvenue chez Meri Beauty – Vos accès";

  const text = `
Bonjour ${customerName},

Un compte a été créé automatiquement pour vous suite à votre réservation.

Voici vos identifiants de connexion :

  Email       : ${email}
  Mot de passe: ${temporaryPassword}

Connectez-vous ici : ${loginUrl}

Pour votre sécurité, nous vous recommandons de changer votre mot de passe dès votre première connexion.

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Bienvenue chez Meri Beauty 👋</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Un compte a été créé automatiquement pour vous suite à votre première réservation.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Email", email)}
        ${infoRow("Mot de passe", `<code style="font-family:monospace;background:#eee;padding:2px 6px;border-radius:4px;">${temporaryPassword}</code>`)}
      </tbody>
    </table>

    <a href="${loginUrl}"
       style="display:inline-block;background:${brandColor};color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600;">
      Se connecter à mon compte
    </a>

    ${divider()}

    <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
      🔒 Pour votre sécurité, nous vous recommandons de modifier votre mot de passe dès votre première connexion.<br/>
      Si vous n'êtes pas à l'origine de cette réservation, contactez-nous immédiatement.
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

// ─── 4. Password reset ────────────────────────────────────────────────────────

/**
 * @param {{
 *   customerName: string,
 *   resetUrl: string,
 *   expiresInMinutes: number,
 * }} params
 */
export function passwordResetEmail({
  customerName,
  resetUrl,
  expiresInMinutes,
}) {
  const subject = "Réinitialisation de votre mot de passe – Meri Beauty";

  const text = `
Bonjour ${customerName},

Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte Meri Beauty.

Si vous êtes à l'origine de cette demande, cliquez sur le lien ci-dessous pour choisir un nouveau mot de passe :

  ${resetUrl}

Ce lien expire dans ${expiresInMinutes} minutes pour des raisons de sécurité.

Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet email. Votre mot de passe restera inchangé.

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réinitialisation du mot de passe</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Nous avons reçu une demande de réinitialisation de mot de passe pour votre compte.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Lien", `<a href="${resetUrl}" style="color:${darkColor};text-decoration:underline;">Réinitialiser mon mot de passe</a>`)}
        ${infoRow("Expire dans", `${expiresInMinutes} minutes`)}
      </tbody>
    </table>

    <div style="background:#fff3cd;border-left:4px solid ${brandColor};padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#856404;line-height:1.6;">
        ⚠️ <strong>Vous n'avez pas demandé cette réinitialisation ?</strong><br/>
        Vous pouvez ignorer cet email en toute sécurité. Votre mot de passe et votre compte ne seront pas modifiés.
      </p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :<br/>
      <code style="font-size:12px;word-break:break-all;background:#f4f4f0;padding:4px 8px;border-radius:4px;">${resetUrl}</code>
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

// ─── 5. Email verification ────────────────────────────────────────────────────

/**
 * @param {{
 *   customerName: string,
 *   verificationUrl: string,
 *   expiresInMinutes: number,
 * }} params
 */
export function emailVerificationEmail({
  customerName,
  verificationUrl,
  expiresInMinutes,
}) {
  const subject = "Vérifiez votre adresse email – Meri Beauty";

  const text = `
Bonjour ${customerName},

Merci de vous être inscrit sur Meri Beauty. Pour activer votre compte, veuillez vérifier votre adresse email en cliquant sur le lien ci-dessous :

  ${verificationUrl}

Ce lien expire dans ${expiresInMinutes} minutes pour des raisons de sécurité.

Si vous n'avez pas créé de compte, vous pouvez ignorer cet email.

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Vérifiez votre adresse email</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Merci de vous être inscrit sur Meri Beauty. Pour activer votre compte, veuillez vérifier votre adresse email.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Lien", `<a href="${verificationUrl}" style="color:${darkColor};text-decoration:underline;">Vérifier mon adresse email</a>`)}
        ${infoRow("Expire dans", `${expiresInMinutes} minutes`)}
      </tbody>
    </table>

    <div style="background:#d1ecf1;border-left:4px solid #0c5460;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#0c5460;line-height:1.6;">
        📧 <strong>Vous n'avez pas créé de compte ?</strong><br/>
        Vous pouvez ignorer cet email en toute sécurité.
      </p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Si le bouton ne fonctionne pas, copiez-collez ce lien dans votre navigateur :<br/>
      <code style="font-size:12px;word-break:break-all;background:#f4f4f0;padding:4px 8px;border-radius:4px;">${verificationUrl}</code>
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

// ─── 7. Contact form — owner notification ────────────────────────────────────

/**
 * @param {{
 *   name: string,
 *   email: string,
 *   phone: string|null,
 *   subject: string,
 *   message: string,
 *   salonName: string,
 * }} params
 */
export function contactOwnerNotificationEmail({
  name,
  email,
  phone,
  subject,
  message,
  salonName,
}) {
  const subjectLine = `Nouveau message de contact — ${subject}`;

  const text = `
Nouveau message de contact reçu sur le site ${salonName}

  Expéditeur : ${name}
  Email      : ${email}
  Téléphone  : ${phone || "Non renseigné"}
  Sujet      : ${subject}

Message :
${message}
  `.trim();

  const html = htmlWrapper(
    subjectLine,
    `
    <h2 style="margin:0 0 8px;font-size:20px;color:${darkColor};">Nouveau message de contact ✉️</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Un visiteur vous a envoyé un message depuis le site <strong>${salonName}</strong>.
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Expéditeur", name)}
        ${infoRow("Email", `<a href="mailto:${email}" style="color:${darkColor};">${email}</a>`)}
        ${infoRow("Téléphone", phone || "Non renseigné")}
        ${infoRow("Sujet", subject)}
      </tbody>
    </table>

    <div style="background:#f9f8f5;border-left:4px solid ${brandColor};padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${darkColor};">Message :</p>
      <p style="margin:0;font-size:14px;color:#2F3A2E;line-height:1.7;white-space:pre-wrap;">${message}</p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
      Vous pouvez répondre directement à cet email pour contacter ${name}.
    </p>
    `
  );

  return { subject: subjectLine, text, html };
}

// ─── 8. Contact form — visitor auto-reply ────────────────────────────────────

/**
 * @param {{
 *   name: string,
 *   subject: string,
 *   salonName: string,
 *   salonEmail: string,
 * }} params
 */
export function contactVisitorAutoReplyEmail({
  name,
  subject,
  salonName,
  salonEmail,
}) {
  const subjectLine = `Nous avons bien reçu votre message — ${salonName}`;

  const text = `
Bonjour ${name},

Nous vous remercions de nous avoir contactés au sujet de « ${subject} ».

Votre message a bien été transmis à notre équipe. Nous nous efforçons de répondre à toutes les demandes dans les plus brefs délais (généralement sous 24 à 48 heures).

En attendant, n'hésitez pas à consulter notre site web pour plus d'informations.

À très bientôt,
L'équipe ${salonName}
${salonEmail ? `\n${salonEmail}` : ""}
  `.trim();

  const html = htmlWrapper(
    subjectLine,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Message reçu ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${name}</strong>,</p>

    <p style="margin:0 0 20px;font-size:15px;color:#2F3A2E;line-height:1.7;">
      Nous vous remercions de nous avoir contactés au sujet de <strong>« ${subject} »</strong>.
    </p>

    <div style="background:#d1ecf1;border-left:4px solid #0c5460;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#0c5460;line-height:1.6;">
        📬 Votre message a bien été transmis à notre équipe.<br/>
        Nous nous efforçons de répondre à toutes les demandes dans les plus brefs délais (généralement sous 24 à 48 heures).
      </p>
    </div>

    <p style="margin:0 0 20px;font-size:14px;color:#666;line-height:1.6;">
      En attendant, n'hésitez pas à consulter notre site web pour plus d'informations.
    </p>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#888;">À très bientôt,<br/><strong style="color:${darkColor};">L'équipe ${salonName}</strong></p>
    ${salonEmail ? `<p style="margin:4px 0 0;font-size:13px;color:#999;">${salonEmail}</p>` : ""}
    `
  );

  return { subject: subjectLine, text, html };
}

// ─── 6. Newsletter (marketing email) ──────────────────────────────────────────

/**
 * @param {{
 *   customerName: string,
 *   title: string,
 *   content: string,
 *   salonName: string,
 * }} params
 */
export function newsletterEmail({ customerName, title, content, salonName }) {
  const subject = title;

  const text = `
Bonjour ${customerName},

${content}

---
${salonName}
  `.trim();

  // Render content as safe HTML paragraphs
  const bodyHtml = content
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;color:#2F3A2E;line-height:1.7;">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 16px;font-size:20px;color:${darkColor};">${title}</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,</p>

    ${bodyHtml}

    ${divider()}

    <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
      Merci de votre confiance,<br/>
      <strong style="color:${darkColor};">${salonName}</strong>
    </p>
    `
  );

  return { subject, text, html };
}

/**
 * Email template when a spot opens up for people on the waiting list.
 * Everyone is notified and the first person to finalize their booking gets the spot.
 *
 * @param {{
 *   customerName: string,
 *   activityTitle: string,
 *   sessionDate: string,
 *   reservationUrl: string,
 * }} params
 */
export function waitingListNotificationEmail({
  customerName,
  activityTitle,
  sessionDate,
  reservationUrl,
}) {
  const subject = `Une place s'est libérée pour "${activityTitle}" ! – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Bonne nouvelle ! Une place s'est libérée pour l'atelier "${activityTitle}" du ${sessionDate}.

Toutes les personnes inscrites sur la liste d'attente viennent d'être notifiées : la place sera attribuée à la première personne qui finalisera sa réservation.

Réservez dès maintenant en cliquant sur le lien ci-dessous :
  ${reservationUrl}

À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Une place s'est libérée ! 🎉</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Une place est à nouveau disponible pour l'activité <strong>${activityTitle}</strong>.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Activité", activityTitle)}
        ${infoRow("Date & Horaire", sessionDate)}
      </tbody>
    </table>

    <div style="text-align:center;margin:30px 0;">
      <a href="${reservationUrl}"
         style="display:inline-block;background:${brandColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;box-shadow:0 4px 12px rgba(200,164,106,0.3);">
        Réserver ma place maintenant
      </a>
    </div>

    ${divider()}

    <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
      ⚡ <strong>À qui la place ?</strong> Toutes les personnes de la liste d'attente ont été notifiées. La place sera attribuée à la première personne qui finalisera sa réservation, alors réservez vite !
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}