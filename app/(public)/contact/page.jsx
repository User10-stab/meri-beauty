import PageHero from "@/components/website/PageHero";
import ContactFormSection from "@/components/website/ContactFormSection";
import { getSalon } from "@/actions/salon/get-salon";
import { getTranslations } from "next-intl/server";

export async function generateMetadata() {
  const t = await getTranslations("contact");
  return {
    title: t("metadataTitle"),
    description: t("metadataDescription"),
  };
}

export default async function ContactPage() {
  const t = await getTranslations("contact");
  const { data: salon } = await getSalon();

  const phone = salon?.phone || "";
  const email = salon?.email || "";
  const address = salon?.address || "";

  return (
    <>
      <PageHero
        title={t("heroTitle")}
        description={t("heroDescription")}
        buttonText={t("heroButton")}
        buttonLink="/reservation"
        backgroundImage="/Images/heroImage.webp"
        label={t("heroLabel")}
      />

      <ContactFormSection salon={salon} />

      {/* Map Section */}
      <section className="relative w-full bg-cream">
        <div className="mx-auto max-w-[1400px] px-6 py-16 lg:px-14 lg:py-24 xl:px-20">
          <div className="mb-10">
            <div className="mb-4 flex items-center gap-3">
              <span className="h-px w-12 bg-gold" />
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-gold">
                {t("mapEyebrow")}
              </span>
            </div>
            <h2 className="text-[2rem] font-bold leading-tight text-ink sm:text-[2.4rem] lg:text-[2.8rem]">
              {t("mapTitle")}
            </h2>
          </div>

          {/* Map Container */}
          <div className="relative h-[450px] w-full overflow-hidden rounded-2xl bg-primary/10 shadow-lg p-2">
            {/* Placeholder for Google Maps or other map service */}
            <iframe
              src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d20139.178511640624!2d4.296542632110687!3d50.87935641519008!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x47c3c3eea4dee6f9%3A0x7fff6026e637a25d!2s1090%20Jette%2C%20Belgique!5e0!3m2!1sfr!2sma!4v1784551549677!5m2!1sfr!2sma"
              width="100%"
              height="100%"
              style={{ border: 0 }}
              allowFullScreen
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              className="rounded-2xl"
/>
              
            {/* <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center">
                <MapPin className="mx-auto mb-4 h-16 w-16 text-gold/50" />
                <p className="text-lg font-medium text-ink/70">
                  Carte interactive bientôt disponible
                </p>
                <p className="mt-2 text-sm text-ink/50">
                  {salon?.address ?? ""}
                </p>
              </div>
            </div> */}
          </div>

          {/* Address Card Below Map */}
          <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            <div className="rounded-xl bg-white p-6 shadow-md">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.13em] text-gold">
                {t("addressLabel")}
              </h3>
              <p className="text-ink whitespace-pre-line">
                {address}
              </p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-md">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.13em] text-gold">
                {t("phoneLabel")}
              </h3>
              <p className="text-ink">{phone}</p>
            </div>
            <div className="rounded-xl bg-white p-6 shadow-md sm:col-span-2 lg:col-span-1">
              <h3 className="mb-2 text-[13px] font-semibold uppercase tracking-[0.13em] text-gold">
                {t("emailLabel")}
              </h3>
              <p className="text-ink">{email}</p>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
