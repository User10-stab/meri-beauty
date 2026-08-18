import { getAppBaseUrl } from "@/lib/site-url";

const SITE_URL = getAppBaseUrl();

export default function robots() {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard/",
        "/acces",
        "/login",
        "/register",
        "/forgot-password",
        "/reset-password",
        "/verify-email",
        "/mon-compte",
        "/profile",
        "/mes-reservations",
        "/boutique/cart",
        "/boutique/checkout",
        "/reservation-atelier/succes",
        "/reservation-formation/succes",
        "/reservation/success",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
