import Hero from "@/components/website/Hero";
import AboutUs from "@/components/website/AboutUs";
import InstagramLifestyle from "@/components/website/InstagramLifestyle";
import OurExperts from "@/components/website/OurExperts";
import BecomePartner from "@/components/website/BecomePartner";
import ClientReviews from "@/components/website/ClientReviews";
import FinalCTA from "@/components/website/FinalCTA";
import { fetchInstagramPosts, fetchInstagramProfile } from "@/lib/instagram";
import { getPublicReviews } from "@/lib/reviews/get-public-reviews";

export const metadata = {
  title: "Meri Beauty — Salon de beauté à Jette, Bruxelles",
  description:
    "Salon de beauté & bien-être à Jette, Bruxelles — coiffure, soins visage, manucure, massage et rituels corps sur mesure. Réservez votre rendez-vous en ligne.",
  // Sans cette ligne, Google choisissait lui-même la canonique de l'accueil et
  // retenait https://www.meribeautystudio.com/ — l'ancienne adresse du site.
  // Les clics de la recherche étaient donc comptés sur www (et même sur
  // http://www), et l'accueil ressortait à 0 dans Search Console alors que la
  // redirection 301 www → apex fonctionne. Inspection du 21/09/2026.
  alternates: { canonical: "/" },
};

// The testimonials below are a live database read. Without this the homepage
// is prerendered once at build time and a newly posted review would never
// surface. An hour is ample for testimonials and keeps the landing page cached.
export const revalidate = 3600;

export default async function Home() {
  const [instagramPosts, instagramProfile, reviews] = await Promise.all([
    fetchInstagramPosts(12),
    fetchInstagramProfile(),
    getPublicReviews(),
  ]);

  return (
    <>
      <Hero />
      <AboutUs />
      <InstagramLifestyle
        posts={instagramPosts.length > 0 ? instagramPosts : undefined}
        profile={instagramProfile ?? undefined}
      />
      <OurExperts />
      <BecomePartner />
      <ClientReviews reviews={reviews} />
      {/* <FinalCTA /> */}
    </>
  );
}
