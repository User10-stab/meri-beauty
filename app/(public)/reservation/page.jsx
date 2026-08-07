import PageHero from "@/components/website/PageHero";
import ReservationForm from "@/components/reservation/ReservationForm";
import { auth } from "@/auth";

export default async function Page() {
  const session = await auth();

  // Only pass customer session data — staff/admin sessions are irrelevant here
  const customerSession =
    session?.user?.role === "CUSTOMER" ? session.user : null;

  return (
    <div className="w-full bg-white">
      {/* Hero Section */}
      <div className="relative">
        <PageHero
          title="Prenez rendez-vous"
          description="Notre équipe est là pour répondre à toutes vos questions et vous accompagner. Nous vous répondrons dans les plus brefs délais."
          buttonText="PRENDRE RENDEZ-VOUS"
          buttonLink="#booking"
          backgroundImage="/Images/heroImage.webp"
          label="Réservez votre moment"
        />

        {/* Floating card */}
        <div className="absolute bottom-10 right-10 w-72 rounded-3xl bg-white/95 p-7 shadow-2xl backdrop-blur z-20 hidden lg:block">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#C8A46A]">
            Réservation
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-[#2F3A2E]">Rapide & Simple</h3>
          <p className="mt-4 leading-7 text-gray-500">
            Choisissez votre service, sélectionnez votre experte et trouvez le créneau parfait en quelques secondes.
          </p>
        </div>
      </div>

      {/* Reservation Form */}
      <div className=" flex flex-col items-center justify-center pt-20 pb-10">
        <h2 className="mb-3 font-display text-[2rem] font-bold leading-[1.08] tracking-tight text-primary sm:text-[2.4rem] lg:text-[3rem]"> Réservez votre rendez-vous</h2>
        <p>Prenez soin de vous, nous nous occupons du reste. </p>
      </div>
      <div id="booking" className="bg-gradient-to-b from-white to-gray-50">
        <ReservationForm customerSession={customerSession} />
      </div>
    </div>
  );
}
