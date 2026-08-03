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

// ─── Appointment reminder (24h / 2h before) ───────────────────────────────────

/**
 * @param {{
 *   customerName: string,
 *   serviceName: string,
 *   staffName: string,
 *   date: Date|string,
 *   time: string,
 *   hoursBefore: 24|2,
 * }} params
 */
export function appointmentReminderEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  hoursBefore,
}) {
  const whenLabel = hoursBefore === 2 ? "dans 2 heures" : "demain";
  const subject = `Rappel — Votre rendez-vous ${whenLabel} – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Petit rappel : votre rendez-vous approche (${whenLabel}).

  Service   : ${serviceName}
  Experte   : ${staffName}
  Date      : ${formatDate(date)} à ${time}

À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Rappel de rendez-vous ⏰</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Petit rappel : votre rendez-vous approche (${whenLabel}).</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Experte", staffName)}
        ${infoRow("Date", formatDate(date))}
        ${infoRow("Heure", time)}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      À très bientôt !
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">L'équipe Meri Beauty</p>
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

// ─── 9. Multi-appointment reservation confirmation ────────────────────────────
// Restored 2026-08-01: the charifa-dev merge interleaved this function's body
// with waitingListNotificationEmail's below (same collision shape as the
// naima-dev incident — two functions sharing local names `subject`/`text`/
// `html` at the same structural position). This function never even reached
// its own `return` statement; it silently fell through into the other
// function's code. actions/reservation/create-reservation.js calls this by
// name, so it was returning `undefined` and breaking multi-appointment
// booking confirmations since that merge landed.

/**
 * Sent after a multi-appointment booking is confirmed and paid.
 *
 * @param {{
 *   customerName: string,
 *   appointments: Array<{ serviceName: string, staffName: string, date: Date|string, time: string }>,
 *   totalDepositPaid: number,
 *   totalAmount: number,
 * }} params
 */
export function multiReservationConfirmationEmail({
  customerName,
  appointments,
  totalDepositPaid,
  totalAmount,
}) {
  const subject = "Vos réservations sont confirmées – Meri Beauty";
  const count = appointments.length;

  const appointmentRows = appointments
    .map(
      (appt, i) => `
    <tr>
      <td colspan="2" style="padding:10px 0 4px;font-size:13px;font-weight:700;color:${brandColor};text-transform:uppercase;letter-spacing:0.05em;">
        Rendez-vous ${i + 1}
      </td>
    </tr>
    ${infoRow("Service", appt.serviceName)}
    ${infoRow("Experte", appt.staffName)}
    ${infoRow("Date", formatDate(appt.date))}
    ${infoRow("Heure", appt.time)}
  `
    )
    .join('<tr><td colspan="2" style="padding:4px 0;"><hr style="border:none;border-top:1px solid #eeede9;" /></td></tr>');

  const textLines = appointments
    .map(
      (appt, i) =>
        `  Rendez-vous ${i + 1}\n  Service : ${appt.serviceName}\n  Experte : ${appt.staffName}\n  Date    : ${formatDate(appt.date)} à ${appt.time}`
    )
    .join("\n\n");

  const text = `
Bonjour ${customerName},

Vos ${count} rendez-vous ont été enregistrés avec succès !

${textLines}

  Acompte réglé : €${Number(totalDepositPaid).toFixed(2)}
  Total          : €${Number(totalAmount).toFixed(2)}

Le solde sera à régler directement au salon.

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réservations confirmées ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Bonjour <strong>${customerName}</strong>,<br/>
      Vos <strong>${count} rendez-vous</strong> ont été enregistrés avec succès !
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${appointmentRows}
        <tr><td colspan="2" style="padding:4px 0;"><hr style="border:none;border-top:2px solid #ddd;" /></td></tr>
        ${infoRow("Acompte réglé", `<span style="color:#2a7a4b;font-size:15px;">€${Number(totalDepositPaid).toFixed(2)}</span>`)}
        ${infoRow("Total", `<span style="font-size:15px;">€${Number(totalAmount).toFixed(2)}</span>`)}
      </tbody>
    </table>

    <div style="background:#fff3cd;border-left:4px solid #856404;padding:14px 16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#856404;line-height:1.6;">
        💰 Le solde restant sera à régler directement au salon lors de votre visite.
      </p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">Nous avons hâte de vous accueillir !</p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
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

/**
 * Sent immediately when a customer joins the waiting list for a full
 * session — distinct from waitingListNotificationEmail, which fires later
 * when a spot actually opens up. This one just confirms the signup and
 * position so the customer isn't left wondering if it went through.
 *
 * @param {{
 *   customerName: string,
 *   activityTitle: string,
 *   sessionDate: string,
 *   position: number,
 *   seatsRequested: number,
 * }} params
 */
export function waitingListJoinConfirmationEmail({
  customerName,
  activityTitle,
  sessionDate,
  position,
  seatsRequested,
}) {
  const subject = `Vous êtes sur liste d'attente pour "${activityTitle}" – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Votre inscription sur la liste d'attente pour l'atelier "${activityTitle}" du ${sessionDate} est bien enregistrée.

  Places demandées : ${seatsRequested}
  Position          : #${position}

Si une place se libère, vous serez averti(e) par email et la place sera attribuée à la première personne qui finalisera sa réservation.

À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Vous êtes sur liste d'attente</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Votre inscription pour l'activité <strong>${activityTitle}</strong> est bien enregistrée.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Activité", activityTitle)}
        ${infoRow("Date & Horaire", sessionDate)}
        ${infoRow("Places demandées", String(seatsRequested))}
        ${infoRow("Position sur la liste", `#${position}`)}
      </tbody>
    </table>

    <div style="background:#fff3cd;border-left:4px solid #856404;padding:14px 16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#856404;line-height:1.6;">
        ⏳ Si une place se libère, vous serez averti(e) par email. Elle sera attribuée à la première personne qui finalise sa réservation.
      </p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">Merci de votre patience, nous espérons pouvoir vous accueillir !</p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

/**
 * Sent once a workshop/event reservation's payment is confirmed by the
 * Stripe webhook (deposit or full payment).
 *
 * @param {{
 *   customerName: string,
 *   activityTitle: string,
 *   sessionDate: string,
 *   seatsCount: number,
 *   paidAmount: number,
 *   totalAmount: number,
 *   balanceDue: number,
 *   isFullPayment: boolean,
 * }} params
 */
export function workshopReservationConfirmationEmail({
  customerName,
  activityTitle,
  sessionDate,
  seatsCount,
  paidAmount,
  totalAmount,
  balanceDue,
  isFullPayment,
}) {
  const subject = `Votre réservation pour "${activityTitle}" est confirmée ! – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Votre réservation pour l'atelier "${activityTitle}" du ${sessionDate} est confirmée !

  Places réservées : ${seatsCount}
  Montant payé      : €${Number(paidAmount).toFixed(2)}
  Total             : €${Number(totalAmount).toFixed(2)}
${!isFullPayment ? `  Solde à régler sur place : €${Number(balanceDue).toFixed(2)}\n` : ""}
${!isFullPayment ? "Le solde sera à régler directement sur place, le jour de l'atelier.\n" : ""}
À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réservation confirmée ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Bonjour <strong>${customerName}</strong>,<br/>
      Votre réservation pour <strong>${activityTitle}</strong> est confirmée !
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Activité", activityTitle)}
        ${infoRow("Date & Horaire", sessionDate)}
        ${infoRow("Places réservées", String(seatsCount))}
        <tr><td colspan="2" style="padding:4px 0;"><hr style="border:none;border-top:2px solid #ddd;" /></td></tr>
        ${infoRow("Montant payé", `<span style="color:#2a7a4b;font-size:15px;">€${Number(paidAmount).toFixed(2)}</span>`)}
        ${infoRow("Total", `<span style="font-size:15px;">€${Number(totalAmount).toFixed(2)}</span>`)}
      </tbody>
    </table>

    ${!isFullPayment ? `
    <div style="background:#fff3cd;border-left:4px solid #856404;padding:14px 16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#856404;line-height:1.6;">
        💰 Solde à régler sur place : <strong>€${Number(balanceDue).toFixed(2)}</strong>, le jour de l'atelier.
      </p>
    </div>
    ` : ""}

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">Nous avons hâte de vous accueillir !</p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

/**
 * Sent once a formation (training course) reservation's payment is
 * confirmed by the Stripe webhook (deposit or full payment). Unlike
 * ateliers, formations state plainly that BOTH the deposit and the balance
 * are non-refundable regardless of attendance — the deposit exists
 * specifically to lock in the client's commitment.
 *
 * @param {{
 *   customerName: string,
 *   formationTitle: string,
 *   sessionDate: string,
 *   seatsCount: number,
 *   paidAmount: number,
 *   totalAmount: number,
 *   balanceDue: number,
 *   isFullPayment: boolean,
 * }} params
 */
export function formationReservationConfirmationEmail({
  customerName,
  formationTitle,
  sessionDate,
  seatsCount,
  paidAmount,
  totalAmount,
  balanceDue,
  isFullPayment,
}) {
  const subject = `Votre réservation pour "${formationTitle}" est confirmée ! – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Votre réservation pour la formation "${formationTitle}" du ${sessionDate} est confirmée !

  Places réservées : ${seatsCount}
  Montant payé      : €${Number(paidAmount).toFixed(2)}
  Total             : €${Number(totalAmount).toFixed(2)}
${!isFullPayment ? `  Solde à régler sur place : €${Number(balanceDue).toFixed(2)}\n` : ""}
${!isFullPayment ? "Le solde sera à régler directement sur place, le jour de la formation.\n" : ""}
Important : l'acompte et le solde ne sont remboursables en aucun cas, que vous participiez ou non à la formation.

À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réservation confirmée ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Bonjour <strong>${customerName}</strong>,<br/>
      Votre réservation pour <strong>${formationTitle}</strong> est confirmée !
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Formation", formationTitle)}
        ${infoRow("Date & Horaire", sessionDate)}
        ${infoRow("Places réservées", String(seatsCount))}
        <tr><td colspan="2" style="padding:4px 0;"><hr style="border:none;border-top:2px solid #ddd;" /></td></tr>
        ${infoRow("Montant payé", `<span style="color:#2a7a4b;font-size:15px;">€${Number(paidAmount).toFixed(2)}</span>`)}
        ${infoRow("Total", `<span style="font-size:15px;">€${Number(totalAmount).toFixed(2)}</span>`)}
      </tbody>
    </table>

    ${!isFullPayment ? `
    <div style="background:#fff3cd;border-left:4px solid #856404;padding:14px 16px;border-radius:4px;margin-bottom:16px;">
      <p style="margin:0;font-size:13px;color:#856404;line-height:1.6;">
        💰 Solde à régler sur place : <strong>€${Number(balanceDue).toFixed(2)}</strong>, le jour de la formation.
      </p>
    </div>
    ` : ""}

    <div style="background:#f8d7da;border-left:4px solid #842029;padding:14px 16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#842029;line-height:1.6;">
        ⚠️ L'acompte et le solde ne sont remboursables en aucun cas, que vous participiez ou non à la formation.
      </p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">Nous avons hâte de vous accueillir !</p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

/**
 * Sent when an admin cancels a workshop/event reservation on a customer's
 * behalf. Deposits are never refunded once paid — this email states that
 * plainly rather than leaving it ambiguous.
 *
 * @param {{ customerName: string, activityTitle: string, sessionDate: string }} params
 */
export function workshopCancellationEmail({ customerName, activityTitle, sessionDate }) {
  const subject = `Votre réservation pour "${activityTitle}" a été annulée – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Votre réservation pour l'atelier "${activityTitle}" du ${sessionDate} a été annulée.

Conformément à nos conditions, l'acompte déjà versé n'est pas remboursable.

Pour toute question, n'hésitez pas à nous contacter.

L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réservation annulée</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Bonjour <strong>${customerName}</strong>,<br/>
      Votre réservation pour <strong>${activityTitle}</strong> du ${sessionDate} a été annulée.
    </p>

    <div style="background:#f8d7da;border-left:4px solid #842029;padding:14px 16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#842029;line-height:1.6;">
        Conformément à nos conditions, l'acompte déjà versé n'est pas remboursable.
      </p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">Pour toute question, n'hésitez pas à nous contacter.</p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">L'équipe Meri Beauty</p>
    `
  );

  return { subject, text, html };
}

/**
 * Sent once an admin-mediated session change (with its fee) has been paid
 * and applied.
 *
 * @param {{
 *   customerName: string,
 *   activityTitle: string,
 *   previousSessionDate: string,
 *   newSessionDate: string,
 *   changeFeeAmount: number,
 * }} params
 */
export function workshopSessionChangeEmail({
  customerName,
  activityTitle,
  previousSessionDate,
  newSessionDate,
  changeFeeAmount,
}) {
  const subject = `Votre séance pour "${activityTitle}" a été modifiée – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Votre réservation pour l'atelier "${activityTitle}" a bien été déplacée.

  Ancienne séance : ${previousSessionDate}
  Nouvelle séance  : ${newSessionDate}
  Frais de modification réglés : €${Number(changeFeeAmount).toFixed(2)}

À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Séance modifiée ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Bonjour <strong>${customerName}</strong>,<br/>
      Votre réservation pour <strong>${activityTitle}</strong> a bien été déplacée.
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Ancienne séance", previousSessionDate)}
        ${infoRow("Nouvelle séance", newSessionDate)}
        ${infoRow("Frais de modification", `€${Number(changeFeeAmount).toFixed(2)}`)}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

/**
 * Sent once an admin-mediated seat-count change (with its flat 10% fee)
 * has been paid and applied.
 *
 * @param {{
 *   customerName: string,
 *   activityTitle: string,
 *   previousSeatsCount: number,
 *   newSeatsCount: number,
 *   changeFeeAmount: number,
 * }} params
 */
export function workshopSeatsChangeEmail({
  customerName,
  activityTitle,
  previousSeatsCount,
  newSeatsCount,
  changeFeeAmount,
}) {
  const subject = `Le nombre de places de votre réservation pour "${activityTitle}" a été modifié – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Le nombre de places de votre réservation pour l'atelier "${activityTitle}" a bien été modifié.

  Ancien nombre de places : ${previousSeatsCount}
  Nouveau nombre de places : ${newSeatsCount}
  Frais de modification réglés : €${Number(changeFeeAmount).toFixed(2)}

À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réservation modifiée ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Bonjour <strong>${customerName}</strong>,<br/>
      Le nombre de places de votre réservation pour <strong>${activityTitle}</strong> a bien été modifié.
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Ancien nombre de places", String(previousSeatsCount))}
        ${infoRow("Nouveau nombre de places", String(newSeatsCount))}
        ${infoRow("Frais de modification", `€${Number(changeFeeAmount).toFixed(2)}`)}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

/**
 * Broadcast sent to newsletter-opted-in customers when a session drops
 * below 2 available seats — same audience as actions/newsletter/send-newsletter.js.
 *
 * @param {{ customerName: string, activityTitle: string, sessionDate: string, seatsLeft: number }} params
 */
export function lowSeatsAnnouncementEmail({ customerName, activityTitle, sessionDate, seatsLeft }) {
  const subject = `Il ne reste presque plus de places pour "${activityTitle}" ! – Meri Beauty`;
  const seatsLabel = seatsLeft > 1 ? `${seatsLeft} places` : `${seatsLeft} place`;

  const text = `
Bonjour ${customerName},

Dépêchez-vous ! Il ne reste plus que ${seatsLabel} pour l'atelier "${activityTitle}" du ${sessionDate}.

Réservez vite sur notre site avant qu'il ne soit complet.

À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Dernières places disponibles ! ⏳</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Bonjour <strong>${customerName}</strong>,<br/>
      Il ne reste plus que <strong>${seatsLabel}</strong> pour l'atelier <strong>${activityTitle}</strong>.
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Activité", activityTitle)}
        ${infoRow("Date & Horaire", sessionDate)}
        ${infoRow("Places restantes", seatsLabel)}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">⚡ Réservez vite avant qu'il ne soit complet !</p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

// ─── Returns (Belgian 14-day withdrawal right) ────────────────────────────────
// Restored 2026-08-01: the naima-dev merge silently overwrote these three
// functions' bodies with waitingListNotificationEmail's — both blocks used
// identical local names (`subject`/`text`/`html`) at the same structural
// position, which is almost certainly why the merge tool/reviewer conflated
// them. Locals below are renamed per-function (retXxxSubject/Text/Html) so
// this exact collision pattern can't repeat silently; the returned object's
// own keys stay `{ subject, text, html }` since sendEmail() and every caller
// (actions/boutique/returns.js) destructure those exact names.

/**
 * @param {{ customerName: string, orderNumber: number, itemsSummary: string }} params
 */
export function returnRequestReceivedEmail({ customerName, orderNumber, itemsSummary }) {
  const retReceivedSubject = `Demande de retour reçue – Commande n°${orderNumber} – Meri Beauty`;

  const retReceivedText = `
Bonjour ${customerName},

Nous avons bien reçu votre demande de retour pour la commande n°${orderNumber} :

${itemsSummary}

Notre équipe va l'examiner et revient vers vous rapidement.

L'équipe Meri Beauty
  `.trim();

  const retReceivedHtml = htmlWrapper(
    retReceivedSubject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Demande de retour reçue</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Nous avons bien reçu votre demande de retour pour la commande <strong>n°${orderNumber}</strong> :</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <tbody><tr><td style="font-size:14px;color:${darkColor};white-space:pre-line;">${itemsSummary}</td></tr></tbody>
    </table>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Notre équipe va l'examiner et revient vers vous rapidement.
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject: retReceivedSubject, text: retReceivedText, html: retReceivedHtml };
}

/**
 * @param {{ customerName: string, orderNumber: number, instructions: string }} params
 */
export function returnApprovedEmail({ customerName, orderNumber, instructions }) {
  const retApprovedSubject = `Retour approuvé – Commande n°${orderNumber} – Meri Beauty`;

  const retApprovedText = `
Bonjour ${customerName},

Votre demande de retour pour la commande n°${orderNumber} a été approuvée.

${instructions}

L'équipe Meri Beauty
  `.trim();

  const retApprovedHtml = htmlWrapper(
    retApprovedSubject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Retour approuvé ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Votre demande de retour pour la commande <strong>n°${orderNumber}</strong> a été approuvée.</p>

    <div style="background:#fff3cd;border-left:4px solid #856404;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#856404;line-height:1.6;">${instructions}</p>
    </div>

    ${divider()}

    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject: retApprovedSubject, text: retApprovedText, html: retApprovedHtml };
}

/**
 * @param {{ customerName: string, orderNumber: number, refundAmount: number }} params
 */
export function returnCompletedEmail({ customerName, orderNumber, refundAmount }) {
  const retCompletedSubject = `Retour finalisé – Commande n°${orderNumber} – Meri Beauty`;

  const retCompletedText = `
Bonjour ${customerName},

Nous avons bien reçu et vérifié votre retour pour la commande n°${orderNumber}.

Montant remboursé : €${Number(refundAmount).toFixed(2)}
Vous trouverez la note de crédit correspondante en pièce jointe. Le remboursement apparaîtra sur votre compte sous quelques jours.

L'équipe Meri Beauty
  `.trim();

  const retCompletedHtml = htmlWrapper(
    retCompletedSubject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Retour finalisé ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Nous avons bien reçu et vérifié votre retour pour la commande <strong>n°${orderNumber}</strong>.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>${infoRow("Montant remboursé", `<span style="color:#2a7a4b;">€${Number(refundAmount).toFixed(2)}</span>`)}</tbody>
    </table>

    <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.6;">
      Vous trouverez la note de crédit correspondante en pièce jointe. Le remboursement apparaîtra sur votre compte sous quelques jours.
    </p>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#888;">Merci de votre confiance,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject: retCompletedSubject, text: retCompletedText, html: retCompletedHtml };
}

/**
 * Sent 24h before a confirmed atelier/événement session — mirrors
 * appointmentReminderEmail's shape, single window (unlike appointments'
 * 24h+2h pair, a same-day 2h nudge doesn't add much for a scheduled event
 * booked well in advance).
 *
 * @param {{ customerName: string, activityTitle: string, sessionDate: string }} params
 */
export function workshopReservationReminderEmail({ customerName, activityTitle, sessionDate }) {
  const subject = `Rappel — "${activityTitle}" c'est demain ! – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Petit rappel : votre réservation pour l'atelier "${activityTitle}" approche, le ${sessionDate}.

À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Rappel de réservation ⏰</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Petit rappel : votre réservation approche.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Activité", activityTitle)}
        ${infoRow("Date & Horaire", sessionDate)}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">Nous avons hâte de vous accueillir !</p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">L'équipe Meri Beauty</p>
    `
  );

  return { subject, text, html };
}

/**
 * Sent 24h before a confirmed formation session. Same shape as
 * workshopReservationReminderEmail, kept as a separate function since the
 * two modules are deliberately independent (see FormationReservation).
 *
 * @param {{ customerName: string, formationTitle: string, sessionDate: string }} params
 */
export function formationReservationReminderEmail({ customerName, formationTitle, sessionDate }) {
  const subject = `Rappel — "${formationTitle}" c'est demain ! – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Petit rappel : votre réservation pour la formation "${formationTitle}" approche, le ${sessionDate}.

À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Rappel de réservation ⏰</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Petit rappel : votre réservation approche.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Formation", formationTitle)}
        ${infoRow("Date & Horaire", sessionDate)}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">Nous avons hâte de vous accueillir !</p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">L'équipe Meri Beauty</p>
    `
  );

  return { subject, text, html };
}
