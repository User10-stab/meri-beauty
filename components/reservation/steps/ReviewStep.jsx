"use client";

import { Calendar, Clock, User, Mail, Phone, Tag, Euro, FileText } from "lucide-react";
import Image from "next/image";
import { useState } from "react";
import { createReservation } from "@/actions/reservation/create-reservation";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export default function ReviewStep({ data, updateData, nextStep, customerSession }) {
  const totalAmount = data.staffService?.price || 0;
  const depositAmount = Math.max(totalAmount * 0.1, 10);
  const remainingAmount = totalAmount - depositAmount;
  
  const [processing, setProcessing] = useState(false);
  const router = useRouter();
  
  // Check if staff has manual confirmation mode
  const isManualConfirmation = data.staff?.reservationConfirmationMode === "MANUAL";

  const handleContinue = async () => {
    if (isManualConfirmation) {
      // Manual mode: create reservation without payment
      await handleManualReservation();
    } else {
      // Automatic mode: proceed to payment
      nextStep();
    }
  };

  const handleManualReservation = async () => {
    setProcessing(true);

    try {
      // Build customerInfo
      const customerInfo = customerSession
        ? {
            userId: customerSession.id,
            fullName: customerSession.fullName ?? "",
            email: customerSession.email ?? "",
            phone: customerSession.phone ?? "",
          }
        : data.customerInfo;

      // Create reservation without payment method
      const result = await createReservation({
        staffServiceId: data.staffService.id,
        date: data.date,
        time: data.time,
        customerInfo,
        paymentMethod: null, // No payment for manual mode
        notes: data.notes,
        isManualMode: true, // Flag to skip payment creation
      });

      if (!result.success) {
        toast.error(
          result.message || "La réservation a échoué. Veuillez réessayer dans quelques instants."
        );
        setProcessing(false);
        return;
      }

      // Show success
      toast.success("Demande de réservation envoyée avec succès !");
      
      // Redirect to home after a short delay
      setTimeout(() => {
        router.push("/");
      }, 2000);
    } catch (error) {
      console.error("[ReviewStep] Manual reservation error:", error);
      toast.error("Une erreur est survenue. Veuillez réessayer dans quelques instants.");
      setProcessing(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">
          Récapitulatif de votre réservation
        </h2>
        <p className="mt-2 text-gray-600">
          Vérifiez les détails avant de procéder au paiement
        </p>
      </div>

      <div className="space-y-6">
        {/* Service Details */}
        <div className="overflow-hidden rounded-2xl border-2 border-gray-200">
          <div className="bg-gradient-to-r from-[#2F3A2E] to-[#3d4e3b] p-6">
            <h3 className="text-lg font-semibold text-white">
              Détails du service
            </h3>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <Tag size={20} className="mt-1 text-[#C8A46A]" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Catégorie</p>
                  <p className="text-base font-semibold text-[#2F3A2E]">
                    {data.category?.name}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Tag size={20} className="mt-1 text-[#C8A46A]" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Service</p>
                  <p className="text-base font-semibold text-[#2F3A2E]">
                    {data.service?.name}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <User size={20} className="mt-1 text-[#C8A46A]" />
                <div className="flex items-center gap-3">
                  <div className="relative h-12 w-12 overflow-hidden rounded-full">
                    {data.staff?.photo ? (
                      <Image
                        src={data.staff.photo}
                        alt={data.staff.user.fullName}
                        fill
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#C8A46A] to-[#B8945A] text-lg font-bold text-white">
                        {data.staff?.user.fullName.charAt(0)}
                      </div>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-600">Experte</p>
                    <p className="text-base font-semibold text-[#2F3A2E]">
                      {data.staff?.user.fullName}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Calendar size={20} className="mt-1 text-[#C8A46A]" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Date</p>
                  <p className="text-base font-semibold text-[#2F3A2E]">
                    {data.date?.toLocaleDateString("fr-FR", {
                      weekday: "long",
                      year: "numeric",
                      month: "long",
                      day: "numeric",
                    })}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Clock size={20} className="mt-1 text-[#C8A46A]" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Heure</p>
                  <p className="text-base font-semibold text-[#2F3A2E]">
                    {data.time} ({data.staffService?.duration} minutes)
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Customer Information */}
        <div className="overflow-hidden rounded-2xl border-2 border-gray-200">
          <div className="bg-gradient-to-r from-[#2F3A2E] to-[#3d4e3b] p-6">
            <h3 className="text-lg font-semibold text-white">
              Vos informations
            </h3>
          </div>
          <div className="p-6">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <User size={20} className="mt-1 text-[#C8A46A]" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Nom</p>
                  <p className="text-base font-semibold text-[#2F3A2E]">
                    {data.customerInfo?.fullName}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Mail size={20} className="mt-1 text-[#C8A46A]" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Email</p>
                  <p className="text-base font-semibold text-[#2F3A2E]">
                    {data.customerInfo?.email}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <Phone size={20} className="mt-1 text-[#C8A46A]" />
                <div>
                  <p className="text-sm font-medium text-gray-600">Téléphone</p>
                  <p className="text-base font-semibold text-[#2F3A2E]">
                    {data.customerInfo?.phone}
                  </p>
                </div>
              </div>

              {data.notes && (
                <div className="flex items-start gap-3">
                  <FileText size={20} className="mt-1 text-[#C8A46A]" />
                  <div>
                    <p className="text-sm font-medium text-gray-600">Notes</p>
                    <p className="text-base text-[#2F3A2E]">{data.notes}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

         {/* Payment Summary - Only shown for AUTOMATIC mode */}
         {!isManualConfirmation && (
           <div className="overflow-hidden rounded-2xl border-2 border-[#C8A46A] bg-gradient-to-br from-[#C8A46A]/5 to-white">
             <div className="bg-[#C8A46A] p-6">
               <h3 className="text-lg font-semibold text-white">
                 Résumé du paiement
               </h3>
             </div>
             <div className="p-6">
               <div className="space-y-3">
                 <div className="flex items-center justify-between text-base">
                   <span className="text-gray-600">Prix du service</span>
                   <span className="font-semibold text-[#2F3A2E]">
                     €{totalAmount.toFixed(2)}
                   </span>
                 </div>

                 <div className="my-4 border-t border-gray-200"></div>

                 <div className="flex items-center justify-between text-base">
                   <span className="font-medium text-gray-600">
                     Acompte à payer maintenant (10% min.)
                   </span>
                   <span className="font-bold text-[#C8A46A]">
                     €{depositAmount.toFixed(2)}
                   </span>
                 </div>

                 <div className="flex items-center justify-between text-base">
                   <span className="font-medium text-gray-600">
                     À payer au salon
                   </span>
                   <span className="font-semibold text-[#2F3A2E]">
                     €{remainingAmount.toFixed(2)}
                   </span>
                 </div>

                 <div className="my-4 border-t-2 border-gray-300"></div>

                 <div className="flex items-center justify-between text-xl">
                   <span className="font-bold text-[#2F3A2E]">Total</span>
                   <span className="font-bold text-[#2F3A2E]">
                     €{totalAmount.toFixed(2)}
                   </span>
                 </div>
               </div>

               <div className="mt-6 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
                 <p className="font-medium">ℹ️ Information importante</p>
                 <p className="mt-1">
                   Un acompte minimum de 10% est requis pour confirmer votre réservation.
                   Le montant restant sera à régler sur place.
                 </p>
               </div>
             </div>
           </div>
         )}

         {/* Manual Reservation Notice */}
         {isManualConfirmation && (
           <div className="overflow-hidden rounded-2xl border-2 border-amber-200 bg-gradient-to-br from-amber-50 to-white">
             <div className="bg-amber-500 p-6">
               <h3 className="text-lg font-semibold text-white">
                 Demande de réservation
               </h3>
             </div>
             <div className="p-6">
               <div className="rounded-lg bg-amber-50 p-4 text-sm text-amber-800">
                 <p className="font-medium">⏳ Réservation en attente de confirmation</p>
                 <p className="mt-2">
                   Votre demande sera examinée par notre équipe. Vous recevrez un email de confirmation 
                   avec les instructions de paiement dans les plus brefs délais.
                 </p>
               </div>
             </div>
           </div>
         )}

         <button
           onClick={handleContinue}
           disabled={processing}
           className={`w-full rounded-lg px-6 py-4 text-base font-semibold text-white transition-all ${
             processing
               ? "cursor-not-allowed bg-gray-300"
               : "bg-[#C8A46A] hover:bg-[#B8945A]"
           }`}
         >
           {processing ? (
             <span className="flex items-center justify-center gap-2">
               <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent"></span>
               Traitement en cours…
             </span>
           ) : isManualConfirmation ? (
             "Envoyer la demande de réservation"
           ) : (
             "Procéder au paiement"
           )}
         </button>
      </div>
    </div>
  );
}
