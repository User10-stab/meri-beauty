const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://meribeautystudio.com";

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
        "/settings",
        "/appointments",
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
