import "@/css/satoshi.css";
import "@/css/style.css";
import "flatpickr/dist/flatpickr.min.css";
import "jsvectormap/dist/jsvectormap.css";

import { Cormorant_Garamond } from "next/font/google";
import { Providers } from "@/components/providers";
import { ConfirmProvider } from "@/components/ConfirmProvider";
import NextTopLoader from "nextjs-toploader";
import { Toaster } from "sonner";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export const metadata = {
  title: {
    default: "Meri Beauty",
    template: "%s | Meri Beauty",
  },
  description: "Premium salon management platform",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning className={cormorant.variable}>
      <body className="antialiased">
        <Providers>
          <ConfirmProvider>
            <NextTopLoader color="#5750F1" showSpinner={false} />

            {children}

            <Toaster
            position="bottom-right"
            richColors
            closeButton
            duration={5000}
            toastOptions={{
              className:
                "dark:bg-gray-dark dark:border-dark-3 dark:text-white",
            }}
          />
          </ConfirmProvider>
        </Providers>
      </body>
    </html>
  );
}
