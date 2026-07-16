import SiteHeader from "@/components/website/SiteHeader";
import Footer from "@/components/website/Footer";

export default function PublicLayout({ children }) {
  return (
    <>
      <SiteHeader />

      {/*
        All h1/h2/h3 inside public pages get Bodoni Moda automatically.
        The [&_h1],[&_h2],[&_h3] selectors scope it only to this layout
        so the dashboard/admin UI is unaffected.
      */}
      <main className="w-full min-h-screen [&_h1]:font-display [&_h2]:font-display [&_h3]:font-display">
        {children}
      </main>

      <Footer />
    </>
  );
}