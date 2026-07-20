import PageHero from "@/components/website/PageHero";

export default async function Page() {
  return (
    <div className="w-full">
      <div className="relative">
        <PageHero
          title="Prenez rendez-vous"
          description="Notre équipe est là pour répondre à toutes vos questions et vous accompagner. Nous vous répondrons dans les plus brefs délais."
          buttonText="PRENDRE RENDEZ-VOUS"
          buttonLink="/reservation"
          backgroundImage="/Images/heroImage.webp"
          label="Réservez votre moment"
        />

        {/* Floating card */}
        <div className="absolute bottom-10 right-10 w-72 rounded-3xl bg-white/95 p-7 shadow-2xl backdrop-blur z-20">
          <p className="text-xs font-semibold uppercase tracking-[0.3em] text-[#C8A46A]">
            Réservation
          </p>
          <h3 className="mt-3 text-2xl font-semibold text-[#2F3A2E]">Rapide & Simple</h3>
          <p className="mt-4 leading-7 text-gray-500">
            Choisissez votre service, sélectionnez votre experte et trouvez le créneau parfait en quelques secondes.
          </p>
        </div>
      </div>
    </div>
  );
}
