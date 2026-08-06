import Hero from "@/components/website/Hero";
import AboutUs from "@/components/website/AboutUs";
import InstagramLifestyle from "@/components/website/InstagramLifestyle";
import OurExperts from "@/components/website/OurExperts";
import BecomePartner from "@/components/website/BecomePartner";
import ClientReviews from "@/components/website/ClientReviews";
import FinalCTA from "@/components/website/FinalCTA";
import { fetchInstagramPosts, fetchInstagramProfile } from "@/lib/instagram";

export const metadata = {
  title: "Meri Beauty — Salon de beauté à Jette, Bruxelles",
  description:
    "Salon de beauté & bien-être à Jette, Bruxelles — coiffure, soins visage, manucure, massage et rituels corps sur mesure. Réservez votre rendez-vous en ligne.",
};

export default async function Home() {
  const [instagramPosts, instagramProfile] = await Promise.all([
    fetchInstagramPosts(12),
    fetchInstagramProfile(),
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
      <ClientReviews />
      {/* <FinalCTA /> */}
    </>
  );
}
