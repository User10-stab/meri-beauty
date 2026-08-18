import { redirect } from "next/navigation";
import { resumeReservationPayment } from "@/actions/payment/resume-reservation-payment";

export const dynamic = "force-dynamic";

export default async function RetryReservationPaymentPage({ searchParams }) {
  const params = await searchParams;
  const paymentId = params?.paymentId;
  const result = await resumeReservationPayment(paymentId);

  if (result.success && result.url) {
    redirect(result.url);
  }

  redirect(`/mes-reservations?paymentError=${encodeURIComponent(result.message ?? "Paiement indisponible")}`);
}
