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
    timeZone: "Europe/Brussels",
  });
}

const brandColor = "#C8A46A";
const darkColor   = "#2F3A2E";

/**
 * Escapes text before it's interpolated into an HTML email body. Several
 * templates embed free-text user input (contact form messages, product
 * names picked by an admin) directly — without this, a value containing
 * `<img src=x onerror=...>` becomes live HTML/script in whatever inbox
 * renders it, not just displayed text. Never apply this to a value that's
 * already a deliberately-built HTML fragment (e.g. an `<a href>` snippet).
 */
export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

/**
 * @param {string} title
 * @param {string} bodyHtml
 * @param {string|null} [unsubscribeUrl] - only passed by the actual marketing
 *   sends (newsletter, low-seats broadcasts) — a signed one-click link
 *   (see lib/newsletter-consent.js) so a recipient can withdraw consent
 *   without logging in, per GDPR/ePrivacy. Transactional emails (order
 *   confirmations, reminders, etc.) omit it and keep the generic footer.
 */
function htmlWrapper(title, bodyHtml, unsubscribeUrl = null) {
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
                © ${new Date().getFullYear()} Meri Beauty · Tous droits réservés
              </p>
              ${unsubscribeUrl ? `
              <p style="margin:4px 0 0;font-size:11px;color:#aaa;">
                Si vous ne souhaitez plus recevoir nos communications, <a href="${unsubscribeUrl}" style="color:#aaa;text-decoration:underline;">cliquez ici pour vous désabonner</a>.
              </p>` : ""}
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

/** Plain-text "phone / email" fragment for force-majeure contact call-outs, omitting whichever isn't set. */
function formatContactLine(phone, email) {
  return [phone, email].filter(Boolean).join(" / ");
}

/** Same as formatContactLine but with a mailto: link, for use inside HTML email bodies. */
function formatContactLineHtml(phone, email, color) {
  const parts = [];
  if (phone) parts.push(phone);
  if (email) parts.push(`<a href="mailto:${email}" style="color:${color};text-decoration:underline;">${email}</a>`);
  return parts.join(" / ");
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

Notre équipe va examiner votre demande et vous recevrez un email de confirmation dans les plus brefs délais.

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
        Notre équipe va examiner votre demande. Vous recevrez un email de confirmation dans les plus brefs délais.
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

export function reservationAcceptedEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  confirmationUrl,
}) {
  const subject = "Votre demande de rendez-vous a été acceptée – Meri Beauty";
  const text = `
Bonjour ${customerName},

Le salon a accepté votre demande de rendez-vous.

  Service   : ${serviceName}
  Experte   : ${staffName}
  Date      : ${formatDate(date)} à ${time}

Cliquez ici pour confirmer votre rendez-vous :
${confirmationUrl}

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Votre demande a été acceptée</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${escapeHtml(customerName)}</strong>,<br/>
    Le salon a accepté votre demande de rendez-vous.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", escapeHtml(serviceName))}
        ${infoRow("Experte", escapeHtml(staffName))}
        ${infoRow("Date", escapeHtml(formatDate(date)))}
        ${infoRow("Heure", escapeHtml(time))}
      </tbody>
    </table>
    <a href="${escapeHtml(confirmationUrl)}" style="display:inline-block;background:${brandColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;margin-bottom:24px;">
      Confirmer mon rendez-vous
    </a>
    <p style="margin:0 0 24px;font-size:13px;color:#999;">Utilisez ce bouton pour confirmer votre rendez-vous et, si nécessaire, effectuer le paiement.</p>
    ${divider()}
    <p style="margin:0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
  `);

  return { subject, text, html };
}

export function reservationRejectedEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  reason = null,
}) {
  const subject = "Votre demande de rendez-vous a été refusée – Meri Beauty";
  const text = `
Bonjour ${customerName},

Nous regrettons de vous informer que votre demande de rendez-vous a été refusée.

  Service   : ${serviceName}
  Experte   : ${staffName}
  Date      : ${formatDate(date)} à ${time}
${reason ? `Motif : ${reason}` : ''}

Nous vous invitons à prendre un nouveau rendez-vous à une date qui vous conviendra.

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Votre demande a été refusée</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${escapeHtml(customerName)}</strong>,<br/>
    Nous regrettons de vous informer que votre demande de rendez-vous a été refusée.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", escapeHtml(serviceName))}
        ${infoRow("Experte", escapeHtml(staffName))}
        ${infoRow("Date", escapeHtml(formatDate(date)))}
        ${infoRow("Heure", escapeHtml(time))}
      </tbody>
    </table>
    ${reason ? `
    <div style="background:#fee2e2;border-left:4px solid #dc2626;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#991b1b;line-height:1.6;">
        <strong>Motif :</strong> ${escapeHtml(reason)}
      </p>
    </div>
    ` : ''}
    <div style="background:#fef3cd;border-left:4px solid ${brandColor};padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#856404;line-height:1.6;">
        💡 <strong>Nouvelle réservation</strong><br/>
        Nous vous invitons à prendre un nouveau rendez-vous à une date qui vous conviendra.
      </p>
    </div>
    <a href="${escapeHtml(process.env.NEXT_PUBLIC_APP_URL)}/reservation" style="display:inline-block;background:${brandColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;margin-bottom:24px;">
      Prendre un nouveau rendez-vous
    </a>
    ${divider()}
    <p style="margin:0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
  `);

  return { subject, text, html };
}

// ─── 2. Reservation accepted with payment link ───────────────────────────────

/**
 * Email sent when staff accepts a reservation request (appointment moves from
 * PENDING to ACCEPTED status). The customer must choose a payment option to
 * move the appointment to CONFIRMED.
 * 
 * @param {{
 *   customerName: string,
 *   serviceName: string,
 *   staffName: string,
 *   date: Date|string,
 *   time: string,
 *   totalAmount: number,
 *   paymentUrl: string,
 *   allowedPaymentMethods: 'BOTH' | 'ONLINE_ONLY' | 'CASH_ONLY',
 *   depositEnabled: boolean,
 *   depositPercentage: number,
 * }} params
 */
export function reservationAcceptedWithPaymentLinkEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  totalAmount,
  paymentUrl,
  allowedPaymentMethods = 'BOTH',
  depositEnabled = false,
  depositPercentage = 10,
}) {
  const isCashOnly = allowedPaymentMethods === "CASH_ONLY";
  const subject = isCashOnly
    ? "Votre réservation a été acceptée – Confirmez votre rendez-vous"
    : "Votre réservation a été acceptée – Confirmez votre rendez-vous";

  // Générer les options de paiement selon les paramètres du staff
  let paymentOptionsText = '';
  let paymentOptionsHtml = '';
  
  if (allowedPaymentMethods === 'ONLINE_ONLY') {
    paymentOptionsText = '- Paiement en ligne (100% du montant) : votre réservation sera automatiquement confirmée';
    paymentOptionsHtml = '• <strong>Paiement en ligne (100%)</strong> : réservation confirmée immédiatement';
  } else if (isCashOnly) {
    paymentOptionsText = '- Paiement sur place : réglez directement au salon lors de votre visite';
    paymentOptionsHtml = '• <strong>Paiement sur place</strong> : réglez directement au salon lors de votre visite';
  } else { // BOTH
    if (depositEnabled) {
      const depositAmount = (totalAmount * depositPercentage / 100).toFixed(2);
      paymentOptionsText = `- Paiement en ligne (100% du montant) : votre réservation sera automatiquement confirmée\n- Paiement sur place avec acompte : payez un acompte de ${depositPercentage}% (€${depositAmount}) en ligne, puis réglez le solde de €${(totalAmount - depositAmount).toFixed(2)} directement au salon`;
      paymentOptionsHtml = `• <strong>Paiement en ligne (100%)</strong> : réservation confirmée immédiatement<br/>• <strong>Paiement sur place avec acompte de ${depositPercentage}%</strong> : payez €${depositAmount} en ligne, puis réglez le solde de €${(totalAmount - depositAmount).toFixed(2)} au salon`;
    } else {
      paymentOptionsText = '- Paiement en ligne (100% du montant) : votre réservation sera automatiquement confirmée\n- Paiement sur place : réglez directement au salon lors de votre visite';
      paymentOptionsHtml = '• <strong>Paiement en ligne (100%)</strong> : réservation confirmée immédiatement<br/>• <strong>Paiement sur place</strong> : réglez directement au salon lors de votre visite';
    }
  }

  const text = `
Bonjour ${customerName},

Bonne nouvelle ! Votre demande de réservation a été acceptée par notre équipe.

  Service   : ${serviceName}
  Experte   : ${staffName}
  Date      : ${formatDate(date)} à ${time}
  Montant   : €${Number(totalAmount).toFixed(2)}

${isCashOnly ? "Votre réservation peut être confirmée directement, sans paiement en ligne." : "Votre réservation n'est pas encore confirmée. Cliquez sur le lien ci-dessous pour choisir votre mode de confirmation :"}

${paymentUrl}

${isCashOnly ? "" : "Sur la page de confirmation, vous pourrez choisir entre :"}
${paymentOptionsText}

${isCashOnly ? "Après confirmation, votre rendez-vous sera ajouté à votre calendrier." : "Après confirmation ou paiement, vous recevrez une confirmation définitive de votre réservation."}

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réservation acceptée ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Bonne nouvelle ! Votre demande de réservation a été acceptée par notre équipe.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Experte", staffName)}
        ${infoRow("Date", formatDate(date))}
        ${infoRow("Heure", time)}
        ${infoRow("Montant", `<span style="color:${brandColor};font-size:16px;">€${Number(totalAmount).toFixed(2)}</span>`)}
      </tbody>
    </table>

    <div style="background:#fff3cd;border-left:4px solid #856404;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:14px;color:#856404;line-height:1.6;">
        ${isCashOnly
          ? "<strong>Confirmation requise</strong><br/>Cliquez sur le bouton ci-dessous pour confirmer votre rendez-vous. Aucun paiement en ligne ne sera demandé."
          : "<strong>Confirmation requise</strong><br/>Cliquez sur le bouton ci-dessous pour choisir votre mode de paiement et confirmer votre rendez-vous."}
      </p>
    </div>

    ${!isCashOnly ? `<div style="background:#d1ecf1;border-left:4px solid #0c5460;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0 0 12px;font-size:14px;color:#0c5460;line-height:1.6;">
        💳 <strong>Options de confirmation</strong><br/>
        Choisissez le paiement total en ligne ou le paiement au salon selon les options disponibles.
      </p>
      <p style="margin:0;font-size:13px;color:#0c5460;">
        ${paymentOptionsHtml}
      </p>
    </div>` : ""}

    <a href="${paymentUrl}"
       style="display:inline-block;background:${brandColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;margin-bottom:24px;">
      Confirmer ma réservation →
    </a>

    <p style="margin:0 0 24px;font-size:13px;color:#999;">
      ${isCashOnly ? "Le bouton vous permettra de confirmer directement votre rendez-vous." : "Le bouton vous redirigera vers notre page sécurisée pour choisir votre mode de paiement."}
    </p>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Après confirmation, vous recevrez une confirmation définitive de votre réservation.<br/>
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

export function reservationPaymentFailedEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  retryUrl,
}) {
  const subject = "Votre paiement n'a pas abouti – Meri Beauty";
  const text = `
Bonjour ${customerName},

Le paiement de votre réservation n'a pas abouti. Votre rendez-vous est conservé afin que vous puissiez réessayer.

  Service : ${serviceName}
  Experte : ${staffName}
  Date    : ${formatDate(date)} à ${time}

Réessayer le paiement :
${retryUrl}

À bientôt,
L'équipe Meri Beauty
  `.trim();
  const html = htmlWrapper(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Le paiement n'a pas abouti</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${escapeHtml(customerName)}</strong>,<br/>
    Le paiement n'a pas abouti, mais votre rendez-vous est conservé afin que vous puissiez réessayer.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;"><tbody>
      ${infoRow("Service", escapeHtml(serviceName))}
      ${infoRow("Experte", escapeHtml(staffName))}
      ${infoRow("Date", escapeHtml(formatDate(date)))}
      ${infoRow("Heure", escapeHtml(time))}
    </tbody></table>
    <a href="${escapeHtml(retryUrl)}" style="display:inline-block;background:${brandColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;margin-bottom:24px;">Réessayer le paiement</a>
    ${divider()}
    <p style="margin:0;font-size:14px;color:#888;">L'équipe Meri Beauty</p>
  `);
  return { subject, text, html };
}

export function reservationPaymentRequiredEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  retryUrl,
}) {
  const subject = "Finalisez votre réservation – Meri Beauty";
  const text = `
Bonjour ${customerName},

Votre réservation a bien été enregistrée, mais elle n'est pas encore confirmée.
Veuillez effectuer le paiement requis pour finaliser votre rendez-vous.

  Service : ${serviceName}
  Experte : ${staffName}
  Date    : ${formatDate(date)} à ${time}

Finaliser ma réservation :
${retryUrl}

À bientôt,
L'équipe Meri Beauty
  `.trim();
  const html = htmlWrapper(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Finalisez votre réservation</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${escapeHtml(customerName)}</strong>,<br/>
    Votre réservation a bien été enregistrée, mais elle n'est pas encore confirmée. Effectuez le paiement requis pour finaliser votre rendez-vous.</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;"><tbody>
      ${infoRow("Service", escapeHtml(serviceName))}
      ${infoRow("Experte", escapeHtml(staffName))}
      ${infoRow("Date", escapeHtml(formatDate(date)))}
      ${infoRow("Heure", escapeHtml(time))}
    </tbody></table>
    <a href="${escapeHtml(retryUrl)}" style="display:inline-block;background:${brandColor};color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:16px;font-weight:600;margin-bottom:24px;">Finaliser ma réservation</a>
    ${divider()}
    <p style="margin:0;font-size:14px;color:#888;">L'équipe Meri Beauty</p>
  `);
  return { subject, text, html };
}

// ─── 4. Reservation confirmed without online payment ──────────────────────────

/**
 * Sent when a reservation is confirmed without any online payment being made
 * (e.g. CASH_ONLY staff setting, or customer confirming an ACCEPTED appointment
 * without going through Stripe). Distinct from paymentConfirmationEmail, which
 * is only for actual online payments.
 *
 * @param {{
 *   customerName: string,
 *   serviceName: string,
 *   staffName: string,
 *   date: Date|string,
 *   time: string,
 *   paidAmount?: number,
 *   totalAmount?: number,
 *   paymentMethod?: string,
 *   checkInCode?: string|null,
 * }} params
 */
export function reservationConfirmedEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  paidAmount = null,
  totalAmount = null,
  paymentMethod = null,
  checkInCode = null,
}) {
  const hasPayment = Number.isFinite(Number(paidAmount)) && Number(paidAmount) > 0;
  const normalizedPaidAmount = hasPayment ? Number(paidAmount) : 0;
  const normalizedTotalAmount = Number.isFinite(Number(totalAmount)) ? Number(totalAmount) : normalizedPaidAmount;
  const remainingAmount = Math.max(0, normalizedTotalAmount - normalizedPaidAmount);
  const subject = "Votre rendez-vous est bien réservé";
  const paymentText = hasPayment
    ? `\n  Paiement   : €${normalizedPaidAmount.toFixed(2)}${paymentMethod ? ` (${paymentMethod})` : ""}${remainingAmount > 0 ? `\n  Restant à payer au salon : €${remainingAmount.toFixed(2)}` : ""}`
    : "";
  const paymentHtml = hasPayment
    ? `
    <div style="background:#f0f8f2;border-left:4px solid #2a7a4b;padding:16px;border-radius:4px;margin:24px 0;">
      <p style="margin:0;font-size:14px;color:#2a7a4b;line-height:1.6;">
        <strong>Paiement reçu</strong><br/>
        Montant payé : <strong>€${normalizedPaidAmount.toFixed(2)}</strong>${paymentMethod ? `<br/>Mode : ${escapeHtml(paymentMethod)}` : ""}${remainingAmount > 0 ? `<br/>Solde à régler au salon : <strong>€${remainingAmount.toFixed(2)}</strong>` : ""}
      </p>
    </div>`
    : "";

  const text = `
Bonjour ${customerName},

Votre rendez-vous est bien réservé.

  Service   : ${serviceName}
  Experte   : ${staffName}
  Date      : ${formatDate(date)} à ${time}
${paymentText}
${checkInCode ? `
Votre billet d'entrée : ${checkInCode}
Le QR code correspondant est joint à cet e-mail.
` : ""}
Nous avons hâte de vous accueillir !

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Votre rendez-vous est bien réservé ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Votre rendez-vous est bien réservé.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Experte", staffName)}
        ${infoRow("Date", formatDate(date))}
        ${infoRow("Heure", time)}
      </tbody>
    </table>

    ${paymentHtml}

    ${checkInTicketBlock(checkInCode)}

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Nous avons hâte de vous accueillir !
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

/** Sent when AUTOMATIC confirmation creates an appointment already confirmed. */
export function reservationCreatedAutomaticEmail({
  customerName,
  serviceName,
  staffName,
  date,
  time,
  totalAmount,
  paymentType = null,
  paymentAmount = null,
  checkInCode = null,
}) {
  return reservationConfirmedEmail({
    customerName,
    serviceName,
    staffName,
    date,
    time,
    paidAmount: paymentAmount,
    totalAmount,
    paymentMethod: paymentType,
    checkInCode,
  });
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

/**
 * Sent instead of emailVerificationEmail when the token was issued mid
 * guest-checkout (boutique/atelier/formation) rather than at plain
 * registration — same mechanism, different copy: this one tells the person
 * what happens next (credentials, then payment), since confirming isn't
 * the end of their journey here.
 */
export function checkoutEmailVerificationEmail({ customerName, verificationUrl, expiresInMinutes }) {
  const subject = "Confirmez votre email pour finaliser votre paiement – Meri Beauty";

  const text = `
Bonjour ${customerName},

Encore une étape avant de finaliser votre paiement : confirmez votre adresse email en cliquant sur le lien ci-dessous.

  ${verificationUrl}

Une fois confirmée, vous recevrez un email avec vos identifiants de connexion, puis vous pourrez terminer votre paiement.

Ce lien expire dans ${expiresInMinutes} minutes pour des raisons de sécurité.

Si vous n'êtes pas à l'origine de cette démarche, vous pouvez ignorer cet email.

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Confirmez votre email</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,<br/>
    Encore une étape avant de finaliser votre paiement : confirmez votre adresse email.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Lien", `<a href="${verificationUrl}" style="color:${darkColor};text-decoration:underline;">Confirmer mon adresse email</a>`)}
        ${infoRow("Expire dans", `${expiresInMinutes} minutes`)}
      </tbody>
    </table>

    <div style="background:#d1ecf1;border-left:4px solid #0c5460;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#0c5460;line-height:1.6;">
        📧 <strong>Et ensuite ?</strong><br/>
        Une fois confirmée, vous recevrez un email avec vos identifiants de connexion, puis vous pourrez terminer votre paiement.
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

  const safeName = escapeHtml(name);
  const safeEmail = escapeHtml(email);
  const safeSubject = escapeHtml(subject);
  const safePhone = phone ? escapeHtml(phone) : "Non renseigné";
  const safeMessage = escapeHtml(message);

  const html = htmlWrapper(
    subjectLine,
    `
    <h2 style="margin:0 0 8px;font-size:20px;color:${darkColor};">Nouveau message de contact ✉️</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Un visiteur vous a envoyé un message depuis le site <strong>${escapeHtml(salonName)}</strong>.
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Expéditeur", safeName)}
        ${infoRow("Email", `<a href="mailto:${safeEmail}" style="color:${darkColor};">${safeEmail}</a>`)}
        ${infoRow("Téléphone", safePhone)}
        ${infoRow("Sujet", safeSubject)}
      </tbody>
    </table>

    <div style="background:#f9f8f5;border-left:4px solid ${brandColor};padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${darkColor};">Message :</p>
      <p style="margin:0;font-size:14px;color:#2F3A2E;line-height:1.7;white-space:pre-wrap;">${safeMessage}</p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
      Vous pouvez répondre directement à cet email pour contacter ${safeName}.
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

  const safeName = escapeHtml(name);
  const safeSubject = escapeHtml(subject);
  const safeSalonName = escapeHtml(salonName);
  const safeSalonEmail = escapeHtml(salonEmail);
  const safeSubjectLine = escapeHtml(subjectLine);

  const html = htmlWrapper(
    safeSubjectLine,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Message reçu ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${safeName}</strong>,</p>

    <p style="margin:0 0 20px;font-size:15px;color:#2F3A2E;line-height:1.7;">
      Nous vous remercions de nous avoir contactés au sujet de <strong>« ${safeSubject} »</strong>.
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

    <p style="margin:0;font-size:14px;color:#888;">À très bientôt,<br/><strong style="color:${darkColor};">L'équipe ${safeSalonName}</strong></p>
    ${salonEmail ? `<p style="margin:4px 0 0;font-size:13px;color:#999;">${safeSalonEmail}</p>` : ""}
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
 *   unsubscribeUrl?: string,
 * }} params
 */
export function newsletterEmail({ customerName, title, content, salonName, unsubscribeUrl }) {
  const subject = title;

  const text = `
Bonjour ${customerName},

${content}

---
${salonName}
  `.trim();

  // Render content as safe HTML paragraphs — escape first, then apply our
  // own <p>/<br/> markup on the now-safe text (never escape after adding
  // real tags, or the tags themselves get escaped too).
  const bodyHtml = escapeHtml(content)
    .split(/\n\n+/)
    .map((p) => `<p style="margin:0 0 16px;font-size:15px;color:#2F3A2E;line-height:1.7;">${p.replace(/\n/g, '<br/>')}</p>`)
    .join('');

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 16px;font-size:20px;color:${darkColor};">${escapeHtml(title)}</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${escapeHtml(customerName)}</strong>,</p>

    ${bodyHtml}

    ${divider()}

    <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
      Merci de votre confiance,<br/>
      <strong style="color:${darkColor};">${escapeHtml(salonName)}</strong>
    </p>
    `,
    unsubscribeUrl
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
  isPending = false,
}) {
  // Multi-appointment bookings are never auto-confirmed (see
  // getReservationPaymentDecision's appointmentCount !== 1 rule) — they wait
  // on staff review, same as a MANUAL single booking. Saying "confirmed"
  // here when the appointments are actually PENDING would tell the customer
  // something the salon hasn't agreed to yet.
  const subject = isPending ? "Votre demande de rendez-vous a été reçue – Meri Beauty" : "Vos rendez-vous sont réservés – Meri Beauty";
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

  const introLine = isPending
    ? `Votre demande pour ${count} rendez-vous a bien été reçue. Nous vous confirmerons chaque créneau sous peu.`
    : `Vos ${count} rendez-vous ont été réservés avec succès !`;

  const text = `
Bonjour ${customerName},

${introLine}

${textLines}

  Total          : €${Number(totalAmount).toFixed(2)}

À bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">${isPending ? "Demande reçue ✓" : "Réservations confirmées ✓"}</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Bonjour <strong>${customerName}</strong>,<br/>
      ${introLine}
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${appointmentRows}
        <tr><td colspan="2" style="padding:4px 0;"><hr style="border:none;border-top:2px solid #ddd;" /></td></tr>
        ${infoRow("Total", `<span style="font-size:15px;">€${Number(totalAmount).toFixed(2)}</span>`)}
      </tbody>
    </table>

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
/**
 * The door ticket, shown in both activity confirmation e-mails.
 *
 * The QR itself rides as a PNG attachment (see qrPngAttachment): a `data:`
 * URI is stripped by Gmail, and CID embedding is spelled differently by our
 * two transports. So the body carries the readable code -- which is also what
 * staff type in when a phone is dead or the room has no signal -- and points
 * at the attachment.
 */
function checkInTicketBlock(code) {
  if (!code) return "";
  return `
    <div style="background:#f9f8f5;border:1px dashed #c9c2b4;border-radius:8px;padding:16px 20px;margin-bottom:24px;text-align:center;">
      <p style="margin:0 0 6px;font-size:13px;color:#666;">Votre billet d'entrée</p>
      <p style="margin:0;font-family:monospace;font-size:22px;font-weight:bold;letter-spacing:3px;color:${darkColor};">${code}</p>
      <p style="margin:8px 0 0;font-size:12px;color:#888;line-height:1.6;">
        Le QR code est joint à cet e-mail. Présentez-le à l'entrée — ou donnez simplement le code ci-dessus.
      </p>
    </div>
  `;
}

export function workshopReservationConfirmationEmail({
  customerName,
  activityTitle,
  sessionDate,
  seatsCount,
  paidAmount,
  totalAmount,
  balanceDue,
  isFullPayment,
  checkInCode,
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
${checkInCode ? `Votre billet d'entrée : ${checkInCode}
Le QR code correspondant est joint à cet e-mail.
` : ""}
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

    ${checkInTicketBlock(checkInCode)}

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
  salonPhone,
  salonEmail,
  checkInCode,
}) {
  const subject = `Votre réservation pour "${formationTitle}" est confirmée ! – Meri Beauty`;

  const contactLine = formatContactLine(salonPhone, salonEmail);

  const text = `
Bonjour ${customerName},

Votre réservation pour la formation "${formationTitle}" du ${sessionDate} est confirmée !

  Places réservées : ${seatsCount}
  Montant payé      : €${Number(paidAmount).toFixed(2)}
  Total             : €${Number(totalAmount).toFixed(2)}
${!isFullPayment ? `  Solde à régler sur place : €${Number(balanceDue).toFixed(2)}\n` : ""}
${!isFullPayment ? "Le solde sera à régler directement sur place, le jour de la formation.\n" : ""}
${checkInCode ? `Votre billet d'entrée : ${checkInCode}
Le QR code correspondant est joint à cet e-mail.
` : ""}
Important : l'acompte et le solde ne sont remboursables en aucun cas, que vous participiez ou non à la formation. Aucune annulation ou modification n'est possible, sauf cas de force majeure — dans ce cas uniquement, contactez-nous directement${contactLine ? ` (${contactLine})` : ""}.

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
        Aucune annulation ou modification n'est possible, sauf cas de force majeure — dans ce cas uniquement,
        contactez-nous directement${salonPhone || salonEmail ? ` (${formatContactLineHtml(salonPhone, salonEmail, "#842029")})` : ""}.
      </p>
    </div>

    ${checkInTicketBlock(checkInCode)}

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
export function workshopCancellationEmail({ customerName, activityTitle, sessionDate, refunded = false }) {
  const subject = `Votre réservation pour "${activityTitle}" a été annulée – Meri Beauty`;

  const depositNote = refunded
    ? "À titre exceptionnel, l'acompte versé vous a été remboursé."
    : "Conformément à nos conditions, l'acompte déjà versé n'est pas remboursable.";

  const text = `
Bonjour ${customerName},

Votre réservation pour l'atelier "${activityTitle}" du ${sessionDate} a été annulée.

${depositNote}

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

    <div style="background:${refunded ? "#d1e7dd" : "#f8d7da"};border-left:4px solid ${refunded ? "#0f5132" : "#842029"};padding:14px 16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:${refunded ? "#0f5132" : "#842029"};line-height:1.6;">
        ${depositNote}
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
 * @param {{ customerName: string, activityTitle: string, sessionDate: string, seatsLeft: number, unsubscribeUrl?: string }} params
 */
export function lowSeatsAnnouncementEmail({ customerName, activityTitle, sessionDate, seatsLeft, unsubscribeUrl }) {
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
    `,
    unsubscribeUrl
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
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${escapeHtml(customerName)}</strong>,<br/>
    Nous avons bien reçu votre demande de retour pour la commande <strong>n°${orderNumber}</strong> :</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:16px 20px;margin-bottom:24px;">
      <tbody><tr><td style="font-size:14px;color:${darkColor};white-space:pre-line;">${escapeHtml(itemsSummary)}</td></tr></tbody>
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
 * @param {{ customerName: string, orderNumber: number, refundAmount: number, manualRefund?: boolean }} params
 */
export function returnCompletedEmail({ customerName, orderNumber, refundAmount, refundFailed = false, manualRefund = false }) {
  const retCompletedSubject = `Retour finalisé – Commande n°${orderNumber} – Meri Beauty`;

  const refundNoteText = refundFailed
    ? "Le remboursement est en cours de traitement par notre équipe — vous serez recontacté(e) si besoin."
    : manualRefund
      ? "Le remboursement a été effectué directement en boutique."
      : "Le remboursement apparaîtra sur votre compte sous quelques jours.";

  const retCompletedText = `
Bonjour ${customerName},

Nous avons bien reçu et vérifié votre retour pour la commande n°${orderNumber}.

Montant remboursé : €${Number(refundAmount).toFixed(2)}
Vous trouverez la note de crédit correspondante en pièce jointe. ${refundNoteText}

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
      Vous trouverez la note de crédit correspondante en pièce jointe. ${refundNoteText}
    </p>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#888;">Merci de votre confiance,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject: retCompletedSubject, text: retCompletedText, html: retCompletedHtml };
}

/**
 * A rejection with no explanation reaching the customer leaves them
 * believing the request vanished, and produces a conflict at the counter
 * later instead of now — see bigbatch.txt P1 "Le client n'est pas
 * forcément informé d'un refus". Always carries the exact reason staff
 * gave (staffNote is required for a rejection, unlike approve/complete).
 *
 * @param {{ customerName: string, orderNumber: number, reason: string, decidedAt: Date }} params
 */
export function returnRejectedEmail({ customerName, orderNumber, reason, decidedAt }) {
  const retRejectedSubject = `Retour refusé – Commande n°${orderNumber} – Meri Beauty`;
  const decidedAtLabel = decidedAt.toLocaleDateString("fr-FR", { day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Brussels" });

  const retRejectedText = `
Bonjour ${customerName},

Votre demande de retour pour la commande n°${orderNumber} a été refusée le ${decidedAtLabel}.

Motif : ${reason}

Si vous pensez qu'il s'agit d'une erreur, ou si l'article présente un défaut couvert par la garantie légale, contactez directement le salon — nous sommes à votre disposition pour en discuter.

L'équipe Meri Beauty
  `.trim();

  const retRejectedHtml = htmlWrapper(
    retRejectedSubject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Retour refusé</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${escapeHtml(customerName)}</strong>,<br/>
    Votre demande de retour pour la commande <strong>n°${orderNumber}</strong> a été refusée le ${decidedAtLabel}.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>${infoRow("Motif", escapeHtml(reason))}</tbody>
    </table>

    <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.6;">
      Si vous pensez qu'il s'agit d'une erreur, ou si l'article présente un défaut couvert par la garantie légale, contactez directement le salon — nous sommes à votre disposition pour en discuter.
    </p>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#888;">L'équipe Meri Beauty</p>
    `
  );

  return { subject: retRejectedSubject, text: retRejectedText, html: retRejectedHtml };
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
 * Sent to the salon when a customer's cart exceeds 30kg (lib/shipping.js has
 * no flat-rate tier above that) and they've asked for a manual quote instead
 * of hitting a dead end at checkout.
 *
 * @param {{
 *   customerName: string, customerEmail: string, customerPhone: string,
 *   items: Array<{ productName: string, variantName: string, quantity: number }>,
 *   totalWeightKg: number, subtotal: number,
 *   pickupPoint: { name: string, address: string, postalCode: string, city: string } | null,
 *   notes: string | null, salonName: string,
 * }} params
 */
export function shippingQuoteRequestOwnerEmail({
  customerName,
  customerEmail,
  customerPhone,
  items,
  totalWeightKg,
  subtotal,
  pickupPoint,
  notes,
  salonName,
}) {
  const subject = `Devis de livraison demandé — ${customerName} (${totalWeightKg.toFixed(1)} kg)`;

  const itemsList = items.map((i) => `  - ${i.productName} — ${i.variantName} × ${i.quantity}`).join("\n");
  const addressText = pickupPoint
    ? `${pickupPoint.name} — ${pickupPoint.address}, ${pickupPoint.postalCode} ${pickupPoint.city}`
    : "Non renseigné";

  const text = `
Une cliente a demandé un devis de livraison — son panier dépasse 30 kg (${salonName}).

  Client      : ${customerName}
  Email       : ${customerEmail}
  Téléphone   : ${customerPhone}
  Poids total : ${totalWeightKg.toFixed(1)} kg
  Sous-total  : €${subtotal.toFixed(2)}
  Point relais: ${addressText}

Articles :
${itemsList}

${notes ? `Notes de la cliente :\n${notes}\n` : ""}
Merci de la recontacter directement pour lui communiquer un tarif de livraison.
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:20px;color:${darkColor};">Devis de livraison demandé 📦</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Une cliente a un panier de <strong>${totalWeightKg.toFixed(1)} kg</strong> — au-delà du tarif automatique (30 kg max).
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Client", customerName)}
        ${infoRow("Email", `<a href="mailto:${customerEmail}" style="color:${darkColor};">${customerEmail}</a>`)}
        ${infoRow("Téléphone", customerPhone)}
        ${infoRow("Poids total", `${totalWeightKg.toFixed(1)} kg`)}
        ${infoRow("Sous-total", `€${subtotal.toFixed(2)}`)}
        ${infoRow("Point relais", addressText)}
      </tbody>
    </table>

    <div style="background:#f9f8f5;border-left:4px solid ${brandColor};padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:${darkColor};">Articles :</p>
      <p style="margin:0;font-size:14px;color:#2F3A2E;line-height:1.7;white-space:pre-wrap;">${itemsList}</p>
    </div>

    ${notes ? `
    <div style="background:#fff3cd;border-left:4px solid #856404;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0 0 8px;font-size:13px;font-weight:600;color:#856404;">Notes de la cliente :</p>
      <p style="margin:0;font-size:14px;color:#856404;line-height:1.6;white-space:pre-wrap;">${notes}</p>
    </div>
    ` : ""}

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">Merci de la recontacter directement pour lui communiquer un tarif.</p>
    `
  );

  return { subject, text, html };
}

/**
 * Auto-reply confirming a shipping-quote request was received.
 * @param {{ customerName: string, totalWeightKg: number, salonName: string }} params
 */
export function shippingQuoteRequestConfirmationEmail({ customerName, totalWeightKg, salonName }) {
  const subject = `Votre demande de devis a bien été reçue – ${salonName}`;

  const text = `
Bonjour ${customerName},

Votre commande pèse ${totalWeightKg.toFixed(1)} kg, au-delà de ce que nous pouvons calculer automatiquement.

Votre demande de devis de livraison a bien été transmise à notre équipe. Nous vous recontacterons sous peu avec un tarif personnalisé.

À très bientôt,
L'équipe ${salonName}
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Demande de devis reçue ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${customerName}</strong>,</p>

    <div style="background:#d1ecf1;border-left:4px solid #0c5460;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#0c5460;line-height:1.6;">
        📦 Votre commande pèse <strong>${totalWeightKg.toFixed(1)} kg</strong>, au-delà de ce que nous calculons automatiquement.
        Notre équipe vous recontactera sous peu avec un tarif de livraison personnalisé.
      </p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#888;">À très bientôt,<br/><strong style="color:${darkColor};">L'équipe ${salonName}</strong></p>
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

/**
 * Formation equivalent of workshopCancellationEmail — no refund-exception
 * flag: her confirmed policy for formations is a straight "non-refundable,
 * contact me directly for force majeure" with no self-service exception UI.
 */
export function formationCancellationEmail({ customerName, formationTitle, sessionDate, salonPhone, salonEmail }) {
  const subject = `Votre réservation pour "${formationTitle}" a été annulée – Meri Beauty`;

  const contactLine = formatContactLine(salonPhone, salonEmail);

  const text = `
Bonjour ${customerName},

Votre réservation pour la formation "${formationTitle}" du ${sessionDate} a été annulée.

Conformément à nos conditions, l'acompte déjà versé n'est pas remboursable. Pour toute question, n'hésitez pas à nous contacter directement${contactLine ? ` (${contactLine})` : ""}.

L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réservation annulée</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Bonjour <strong>${customerName}</strong>,<br/>
      Votre réservation pour <strong>${formationTitle}</strong> du ${sessionDate} a été annulée.
    </p>
    <div style="background:#f8d7da;border-left:4px solid #842029;padding:14px 16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#842029;line-height:1.6;">
        Conformément à nos conditions, l'acompte déjà versé n'est pas remboursable. Pour toute question, n'hésitez pas à nous contacter directement${salonPhone || salonEmail ? ` (${formatContactLineHtml(salonPhone, salonEmail, "#842029")})` : ""}.
      </p>
    </div>
    ${divider()}
    <p style="margin:20px 0 0;font-size:14px;color:#888;">L'équipe Meri Beauty</p>
    `
  );

  return { subject, text, html };
}

/** Formation equivalent of waitingListJoinConfirmationEmail. */
export function formationWaitingListJoinConfirmationEmail({ customerName, formationTitle, sessionDate, position, seatsRequested }) {
  const subject = `Vous êtes sur liste d'attente pour "${formationTitle}" – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Votre inscription sur la liste d'attente pour la formation "${formationTitle}" du ${sessionDate} est bien enregistrée.

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
    Votre inscription pour la formation <strong>${formationTitle}</strong> est bien enregistrée.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Formation", formationTitle)}
        ${infoRow("Date & Horaire", sessionDate)}
        ${infoRow("Places demandées", String(seatsRequested))}
        ${infoRow("Position", `#${position}`)}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">
      Si une place se libère, vous serez averti(e) par email et la place sera attribuée à la première personne qui finalisera sa réservation.
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

/** Formation equivalent of waitingListNotificationEmail. */
export function formationWaitingListNotificationEmail({ customerName, formationTitle, sessionDate, reservationUrl }) {
  const subject = `Une place s'est libérée pour "${formationTitle}" ! – Meri Beauty`;

  const text = `
Bonjour ${customerName},

Bonne nouvelle ! Une place s'est libérée pour la formation "${formationTitle}" du ${sessionDate}.

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
    Une place est à nouveau disponible pour la formation <strong>${formationTitle}</strong>.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Formation", formationTitle)}
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

/** Formation equivalent of lowSeatsAnnouncementEmail. */
export function formationLowSeatsAnnouncementEmail({ customerName, formationTitle, sessionDate, seatsLeft, unsubscribeUrl }) {
  const subject = `Il ne reste presque plus de places pour "${formationTitle}" ! – Meri Beauty`;
  const seatsLabel = seatsLeft > 1 ? `${seatsLeft} places` : `${seatsLeft} place`;

  const text = `
Bonjour ${customerName},

Dépêchez-vous ! Il ne reste plus que ${seatsLabel} pour la formation "${formationTitle}" du ${sessionDate}.

Réservez vite sur notre site avant qu'elle ne soit complète.

À très bientôt,
L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Dernières places disponibles ! ⏳</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">
      Bonjour <strong>${customerName}</strong>,<br/>
      Il ne reste plus que <strong>${seatsLabel}</strong> pour la formation <strong>${formationTitle}</strong>.
    </p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Formation", formationTitle)}
        ${infoRow("Date & Horaire", sessionDate)}
        ${infoRow("Places restantes", seatsLabel)}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:0;font-size:13px;color:#999;line-height:1.6;">⚡ Réservez vite avant qu'elle ne soit complète !</p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `,
    unsubscribeUrl
  );

  return { subject, text, html };
}

// ─── Staff notification emails for reservation events ────────────────────────────────

/**
 * Email sent to staff when a new reservation is created.
 */
export function staffReservationCreatedEmail({
  staffName,
  customerName,
  serviceName,
  date,
  time,
  duration,
  totalAmount,
}) {
  const subject = "Nouvelle réservation – Meri Beauty";

  const text = `
Bonjour ${staffName},

Une nouvelle réservation a été créée :

  Service   : ${serviceName}
  Client    : ${customerName}
  Date      : ${formatDate(date)} à ${time}
  ${duration ? `Durée     : ${duration} min` : ""}
  ${totalAmount != null ? `Montant   : €${Number(totalAmount).toFixed(2)}` : ""}

Veuillez consulter le tableau de bord pour plus de détails.

L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Nouvelle réservation ✓</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${staffName}</strong>,<br/>
    Une nouvelle réservation a été créée.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Client", customerName)}
        ${infoRow("Date", formatDate(date))}
        ${infoRow("Heure", time)}
        ${duration ? infoRow("Durée", `${duration} min`) : ""}
        ${totalAmount != null ? infoRow("Montant", `€${Number(totalAmount).toFixed(2)}`) : ""}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Veuillez consulter le tableau de bord pour plus de détails.
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

export function staffReservationConfirmedEmail(params) {
  const email = staffReservationCreatedEmail(params);
  return {
    ...email,
    subject: "Nouvelle réservation confirmée – Meri Beauty",
  };
}

/**
 * Email sent to staff when a client submits a reservation request that awaits
 * manual confirmation (a PENDING request on a MANUAL-confirmation staff member).
 * Distinct from staffReservationConfirmedEmail, which fires only once the
 * appointment is actually confirmed.
 */
export function staffReservationRequestedEmail({
  staffName,
  customerName,
  serviceName,
  date,
  time,
}) {
  const subject = "Nouvelle demande de rendez-vous – Meri Beauty";

  const text = `
Bonjour ${staffName},

Une nouvelle demande de rendez-vous est en attente de votre confirmation :

  Service   : ${serviceName}
  Client    : ${customerName}
  Date      : ${formatDate(date)} à ${time}

Connectez-vous au tableau de bord pour l'accepter ou la refuser.

L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Nouvelle demande de rendez-vous</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${staffName}</strong>,<br/>
    Une nouvelle demande de rendez-vous est en attente de votre confirmation.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Client", customerName)}
        ${infoRow("Date", formatDate(date))}
        ${infoRow("Heure", time)}
      </tbody>
    </table>

    <div style="background:#fef3cd;border-left:4px solid ${brandColor};padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#856404;line-height:1.6;">
        ⏳ <strong>En attente de confirmation</strong><br/>
        Connectez-vous au tableau de bord pour accepter ou refuser cette demande.
      </p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#888;">L'équipe Meri Beauty</p>
    `
  );

  return { subject, text, html };
}

export function staffMultipleReservationsConfirmedEmail({
  staffName,
  customerName,
  appointments,
  totalAmount,
  isPending = false,
}) {
  const subject = isPending
    ? "Nouvelles demandes de rendez-vous – Meri Beauty"
    : "Nouvelles réservations – Meri Beauty";
  const headline = isPending ? "Nouvelles demandes de rendez-vous" : "Nouvelles réservations ✓";
  const intro = isPending
    ? `${appointments.length} nouvelles demandes de rendez-vous pour <strong>${escapeHtml(customerName)}</strong> attendent votre confirmation.`
    : `${appointments.length} nouvelles réservations ont été ajoutées à votre calendrier pour <strong>${escapeHtml(customerName)}</strong>.`;
  const textIntro = isPending
    ? `${appointments.length} nouvelles demandes de rendez-vous pour ${customerName} attendent votre confirmation.`
    : `${appointments.length} nouvelles réservations ont été ajoutées à votre calendrier pour ${customerName}.`;
  const rows = appointments.map((appointment, index) => `
    <tr>
      <td colspan="2" style="padding:10px 0 4px;font-size:13px;font-weight:700;color:${brandColor};text-transform:uppercase;">Rendez-vous ${index + 1}</td>
    </tr>
    ${infoRow("Service", escapeHtml(appointment.serviceName))}
    ${infoRow("Client", escapeHtml(customerName))}
    ${infoRow("Date", escapeHtml(formatDate(appointment.date)))}
    ${infoRow("Heure", escapeHtml(appointment.time))}
    ${appointment.duration ? infoRow("Durée", `${appointment.duration} min`) : ""}
    ${appointment.amount != null ? infoRow("Montant", `€${Number(appointment.amount).toFixed(2)}`) : ""}
  `).join('<tr><td colspan="2"><hr style="border:none;border-top:1px solid #eeede9;" /></td></tr>');
  const text = `
Bonjour ${staffName},

${textIntro}

${appointments.map((appointment, index) => `Rendez-vous ${index + 1}
  Service : ${appointment.serviceName}
  Date    : ${formatDate(appointment.date)} à ${appointment.time}
  Durée   : ${appointment.duration ?? "—"} min
  Montant : €${Number(appointment.amount ?? 0).toFixed(2)}`).join("\n\n")}

Total : €${Number(totalAmount).toFixed(2)}
${isPending ? "\nConnectez-vous au tableau de bord pour gérer ces demandes." : ""}

L'équipe Meri Beauty
  `.trim();
  const html = htmlWrapper(subject, `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">${headline}</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${escapeHtml(staffName)}</strong>,<br/>
    ${intro}</p>
    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;"><tbody>
      ${rows}
      <tr><td colspan="2" style="padding-top:12px;border-top:2px solid #ddd;">${infoRow("Total", `€${Number(totalAmount).toFixed(2)}`)}</td></tr>
    </tbody></table>
    ${divider()}
    <p style="margin:0;font-size:14px;color:#888;">L'équipe Meri Beauty</p>
  `);
  return { subject, text, html };
}

/**
 * Email sent to staff when a reservation is cancelled.
 */
export function staffReservationCancelledEmail({
  staffName,
  customerName,
  serviceName,
  date,
  time,
  reason,
}) {
  const subject = "Réservation annulée – Meri Beauty";

  const text = `
Bonjour ${staffName},

Une réservation a été annulée :

  Service   : ${serviceName}
  Client    : ${customerName}
  Date      : ${formatDate(date)} à ${time}
  ${reason ? `Raison    : ${reason}` : ""}

Veuillez consulter le tableau de bord pour plus de détails.

L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réservation annulée</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${staffName}</strong>,<br/>
    Une réservation a été annulée.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Client", customerName)}
        ${infoRow("Date", formatDate(date))}
        ${infoRow("Heure", time)}
        ${reason ? infoRow("Raison", reason) : ""}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Veuillez consulter le tableau de bord pour plus de détails.
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

/**
 * Email sent to staff when a reservation is modified/rescheduled.
 */
export function staffReservationModifiedEmail({
  staffName,
  customerName,
  serviceName,
  previousDate,
  newDate,
  newTime,
}) {
  const subject = "Réservation modifiée – Meri Beauty";

  const text = `
Bonjour ${staffName},

Une réservation a été modifiée :

  Service        : ${serviceName}
  Client         : ${customerName}
  Date précédente : ${formatDate(previousDate)}
  Nouvelle date  : ${formatDate(newDate)} à ${newTime}

Veuillez consulter le tableau de bord pour plus de détails.

L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Réservation modifiée</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${staffName}</strong>,<br/>
    Une réservation a été modifiée.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Client", customerName)}
        ${infoRow("Date précédente", formatDate(previousDate))}
        ${infoRow("Nouvelle date", formatDate(newDate))}
        ${infoRow("Nouvelle heure", newTime)}
      </tbody>
    </table>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Veuillez consulter le tableau de bord pour plus de détails.
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}

/**
 * Email sent to staff when a payment fails.
 */
export function staffPaymentFailedEmail({
  staffName,
  customerName,
  serviceName,
  date,
  time,
}) {
  const subject = "Échec de paiement – Meri Beauty";

  const text = `
Bonjour ${staffName},

Un paiement a échoué pour la réservation suivante :

  Service   : ${serviceName}
  Client    : ${customerName}
  Date      : ${formatDate(date)} à ${time}

La réservation a été automatiquement annulée.
Veuillez contacter le client si nécessaire.

L'équipe Meri Beauty
  `.trim();

  const html = htmlWrapper(
    subject,
    `
    <h2 style="margin:0 0 8px;font-size:22px;color:${darkColor};">Échec de paiement</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;">Bonjour <strong>${staffName}</strong>,<br/>
    Un paiement a échoué pour la réservation suivante.</p>

    <table cellpadding="0" cellspacing="0" style="width:100%;background:#f9f8f5;border-radius:8px;padding:4px 20px;margin-bottom:24px;">
      <tbody>
        ${infoRow("Service", serviceName)}
        ${infoRow("Client", customerName)}
        ${infoRow("Date", formatDate(date))}
        ${infoRow("Heure", time)}
      </tbody>
    </table>

    <div style="background:#f8d7da;border-left:4px solid #dc3545;padding:16px;border-radius:4px;margin-bottom:24px;">
      <p style="margin:0;font-size:14px;color:#721c24;line-height:1.6;">
        ⚠️ <strong>La réservation a été automatiquement annulée.</strong><br/>
        Veuillez contacter le client si nécessaire.
      </p>
    </div>

    ${divider()}

    <p style="margin:0;font-size:14px;color:#666;line-height:1.6;">
      Veuillez consulter le tableau de bord pour plus de détails.
    </p>
    <p style="margin:20px 0 0;font-size:14px;color:#888;">À bientôt,<br/><strong style="color:${darkColor};">L'équipe Meri Beauty</strong></p>
    `
  );

  return { subject, text, html };
}
