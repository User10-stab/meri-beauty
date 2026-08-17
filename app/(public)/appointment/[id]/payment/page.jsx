import Link from "next/link";
import { getAcceptedAppointmentPaymentDetails } from "@/actions/payment/accepted-appointment-payment";
import AcceptedAppointmentPaymentClient from "@/components/reservation/AcceptedAppointmentPaymentClient";

export const metadata = {
  title: "Finaliser le rendez-vous – Meri Beauty",
  description: "Choisissez comment finaliser votre rendez-vous accepté.",
};

export default async function AcceptedAppointmentPaymentPage({ params }) {
  const { id } = await params;
  const result = await getAcceptedAppointmentPaymentDetails(id);

  if (!result.success) {
    const loginHref = `/login?callbackUrl=${encodeURIComponent(`/appointment/${id}/payment`)}`;
    return (
      <section className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-3xl font-semibold text-[#2F3A2E]">Finaliser le rendez-vous</h1>
        <p className="mt-4 text-gray-600">{result.message}</p>
        <Link
          href={result.code === "AUTH_REQUIRED" ? loginHref : "/mes-reservations"}
          className="mt-8 inline-flex rounded-xl bg-[#2F3A2E] px-6 py-3 font-semibold text-white"
        >
          {result.code === "AUTH_REQUIRED" ? "Se connecter" : "Mes rendez-vous"}
        </Link>
      </section>
    );
  }

  return <AcceptedAppointmentPaymentClient appointment={result.data} />;
}
