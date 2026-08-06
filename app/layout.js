import "@/css/satoshi.css";
import "@/css/style.css";
import "flatpickr/dist/flatpickr.min.css";
import "jsvectormap/dist/jsvectormap.css";

import { Cormorant_Garamond } from "next/font/google";
import { Providers } from "@/components/providers";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import NextTopLoader from "nextjs-toploader";
import { AppToaster } from "@/components/AppToaster";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://meribeautystudio.com";
const SITE_DESCRIPTION =
  "Salon de beauté & bien-être à Jette, Bruxelles — coiffure, soins visage, manucure, massage et rituels corps sur mesure.";

export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "Meri Beauty — Salon de beauté à Jette, Bruxelles",
    template: "%s | Meri Beauty",
  },
  description: SITE_DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "fr_BE",
    siteName: "Meri Beauty",
    title: "Meri Beauty — Salon de beauté à Jette, Bruxelles",
    description: SITE_DESCRIPTION,
    images: [{ url: "/Images/hero.webp" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Meri Beauty — Salon de beauté à Jette, Bruxelles",
    description: SITE_DESCRIPTION,
    images: ["/Images/hero.webp"],
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="fr-BE" suppressHydrationWarning className={cormorant.variable}>
      <body className="antialiased" suppressHydrationWarning>
        <Providers>
          <ConfirmProvider>
            <NextTopLoader color="#5750F1" showSpinner={false} />

            {children}

            <AppToaster />
          </ConfirmProvider>
        </Providers>
      </body>
    </html>
  );
}
