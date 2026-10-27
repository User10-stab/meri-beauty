import { NextIntlClientProvider } from "next-intl";

// La caisse et le scan (/dashboard/boutique/point-of-sale, /scan) vivent dans
// ce groupe de routes, hors de app/dashboard/layout.jsx. Le layout racine
// n'envoie que les namespaces publics (i18n/client-messages.js) : sans props,
// ce provider serveur hérite de l'intégralité des messages de la requête.
export default function DashboardGroupLayout({ children }) {
  return <NextIntlClientProvider>{children}</NextIntlClientProvider>;
}
