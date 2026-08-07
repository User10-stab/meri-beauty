import SiteHeader from "@/components/website/SiteHeader";
import Footer from "@/components/website/Footer";
import { getSalon } from "@/actions/salon/get-salon";
import { getPublicServices } from "@/actions/services/get-services";
import { getAppBaseUrl } from "@/lib/site-url";

const SITE_URL = getAppBaseUrl();

const SCHEMA_DAY = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

/** LocalBusiness/HairSalon structured data — lets Google show address,
 * hours, phone, and (once reviews exist) a rating directly in search
 * results instead of just a plain blue link. */
function buildLocalBusinessSchema(salon) {
  if (!salon) return null;

  return {
    "@context": "https://schema.org",
    "@type": "HairSalon",
    name: salon.name,
    url: SITE_URL,
    ...(salon.logo ? { image: salon.logo } : {}),
    ...(salon.phone ? { telephone: salon.phone } : {}),
    ...(salon.email ? { email: salon.email } : {}),
    ...(salon.address
      ? {
          address: {
            "@type": "PostalAddress",
            streetAddress: salon.address,
            addressCountry: "BE",
          },
        }
      : {}),
    ...(salon.workingDays?.length
      ? {
          openingHoursSpecification: salon.workingDays
            .filter((wd) => wd.isOpen)
            .map((wd) => ({
              "@type": "OpeningHoursSpecification",
              dayOfWeek: SCHEMA_DAY[wd.day] ?? wd.day,
              opens: wd.openingTime,
              closes: wd.closingTime,
            })),
        }
      : {}),
    sameAs: [salon.instagram, salon.facebook, salon.tiktok].filter(Boolean),
  };
}

// Deliberately NOT fetching the cart here: this layout wraps every public
// page including the marketing homepage, and getCart() touches cookies() —
// doing that in a shared layout would force cookies() during static
// generation for every page under it, permanently opting the whole public
// site out of static rendering. SiteHeader fetches its own cart badge count
// client-side instead (see components/website/SiteHeader.jsx), which only
// costs a request on pages a visitor actually loads, not a build-time
// static/ISR regression on pages that have nothing to do with the boutique.
export default async function PublicLayout({ children }) {
  const [salonResult, servicesResult] = await Promise.all([
    getSalon(),
    getPublicServices(),
  ]);
  const salon = salonResult.data;
  const services = servicesResult.data ?? [];
  const localBusinessSchema = buildLocalBusinessSchema(salon);

  return (
    <>
      {localBusinessSchema && (
        <script
          type="application/ld+json"
          // Escape "<" so a salon-editable field (name, address) can never
          // break out of the script tag or inject markup.
          dangerouslySetInnerHTML={{ __html: JSON.stringify(localBusinessSchema).replace(/</g, "\\u003c") }}
        />
      )}

      <SiteHeader />

      {/*
        All h1/h2/h3 inside public pages get Bodoni Moda automatically.
        The [&_h1],[&_h2],[&_h3] selectors scope it only to this layout
        so the dashboard/admin UI is unaffected.
      */}
      <main className="w-full min-h-screen [&_h1]:font-display [&_h2]:font-display [&_h3]:font-display">
        {children}
      </main>

      <Footer salon={salon} services={services} />
    </>
  );
}