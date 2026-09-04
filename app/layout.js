import "@/css/satoshi.css";
import "@/css/style.css";

import "flatpickr/dist/flatpickr.min.css";
import "jsvectormap/dist/jsvectormap.css";

import { Style_Script, Cormorant_Garamond , Betania_Patmos } from "next/font/google";

import { Providers } from "@/components/providers";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import NextTopLoader from "nextjs-toploader";
import { AppToaster } from "@/components/AppToaster";

import { getMetadataBase } from "@/lib/site-url";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { auth } from "@/auth";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

const styleScript = Style_Script({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-style-script",
  display: "swap",
});
const betaniaPatmos = Betania_Patmos({
  weight: "400",
  subsets: ["latin"],
  variable: "--font-betania-patmos",
  display: "swap",
});

const SITE_DESCRIPTION =
  "Salon de beauté & bien-être à Jette, Bruxelles — coiffure, soins visage, manucure, massage et rituels corps sur mesure.";

export const metadata = {
  metadataBase: getMetadataBase(),
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

export default async function RootLayout({ children }) {
  const locale = await getLocale();
  const messages = await getMessages();
  const session = await auth();

  return (
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${cormorant.variable} ${styleScript.variable} ${betaniaPatmos.variable}`}
    >
      <body className="antialiased" suppressHydrationWarning>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers session={session}>
            <ConfirmProvider>
              <NextTopLoader color="#5750F1" showSpinner={false} />
              {children}
              <AppToaster />
            </ConfirmProvider>
          </Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}