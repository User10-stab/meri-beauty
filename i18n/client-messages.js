// Messages envoyés au navigateur hors tableau de bord.
//
// NextIntlClientProvider sérialise TOUS les messages qu'on lui donne dans la
// charge RSC de chaque page. Le layout racine leur passait l'intégralité de
// messages/<locale>.json (≈150 Ko, dont tout le back-office : import Wix,
// caisse, ateliers…) : chaque visiteur du site public téléchargeait les
// textes internes de l'administration (audit « Points techniques », 2026-10).
//
// Le layout racine ne transmet donc plus que les namespaces publics ; le
// tableau de bord (app/dashboard/layout.jsx et app/(dashboard)/layout.jsx)
// remet un NextIntlClientProvider qui hérite de l'intégralité des messages.
//
// Liste NOIRE plutôt que liste blanche, volontairement : un namespace
// nouveau (ajouté pour une page publique) est envoyé par défaut — un
// namespace manquant ferait planter le composant client à l'exécution,
// alors qu'un namespace en trop ne coûte que quelques octets. N'ajouter ici
// que des namespaces utilisés EXCLUSIVEMENT sous /dashboard (vérifié par
// graphe d'imports depuis app/** hors dashboard, 2026-10-27).
export const DASHBOARD_ONLY_NAMESPACES = [
  "dashboard",
  "dashboardBoutique",
  "dashboardWorkshops",
  "dashboardFormations",
  "dashboardInvoices",
  "calendar",
  "calendarView",
  "monthView",
  "appointmentActions",
  "appointmentDetails",
  "appointmentPayment",
  "appointmentTable",
  "acceptedAppointmentPayment",
  "notifications",
  "rentalRequests",
  "settings",
];

/** Copie de `messages` sans les namespaces réservés au tableau de bord. */
export function pickPublicMessages(messages) {
  const out = {};
  for (const [namespace, value] of Object.entries(messages ?? {})) {
    if (!DASHBOARD_ONLY_NAMESPACES.includes(namespace)) out[namespace] = value;
  }
  return out;
}
