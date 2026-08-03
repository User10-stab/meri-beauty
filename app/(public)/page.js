import Hero from "@/components/website/Hero";
import WorkshopBanner from "@/components/website/WorkshopBanner";
import AboutUs from "@/components/website/AboutUs";
import InstagramLifestyle from "@/components/website/InstagramLifestyle";
import OurExperts from "@/components/website/OurExperts";
import BecomePartner from "@/components/website/BecomePartner";
import ClientReviews from "@/components/website/ClientReviews";
import FinalCTA from "@/components/website/FinalCTA";
import { fetchInstagramPosts, fetchInstagramProfile } from "@/lib/instagram";

export const metadata = {
  title: "Meri Beauty | Premium Salon Management Platform",
  description: "Manage appointments, independent professionals, employees, and billing seamlessly.",
};

export default async function Home() {
  const [instagramPosts, instagramProfile] = await Promise.all([
    fetchInstagramPosts(12),
    fetchInstagramProfile(),
  ]);

  return (
    <>
      <Hero />
      <WorkshopBanner />
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
