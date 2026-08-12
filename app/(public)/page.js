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
