"use server";

import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

/**
 * Creates a Stripe Checkout Session for the reservation deposit payment.
 * 
 * This function is called BEFORE any appointment/payment records exist in the database.
 * All reservation data is stored in Stripe metadata and will be processed by the webhook
 * when the payment is completed.
 * 
 * @param {{
 *   staffServiceId: string,
 *   date: Date|string,
 *   time: string,
 *   customerInfo: {
 *     userId?: string,
 *     fullName: string,
 *     email: string,
 *     phone: string,
 *     newsletterSubscribed?: boolean,
 *   },
 *   paymentMethod: string,
 *   notes?: string,
 * }} reservationData
 * @returns {Promise<{ success: boolean, sessionId?: string, url?: string, message?: string }>}
 */
export async function createCheckoutSession(reservationData) {
  try {
    const { staffServiceId, date, time, customerInfo, paymentMethod, notes } = reservationData;

    // ── 1. Validate required fields ──────────────────────────────────────────
    if (!staffServiceId || !date || !time || !customerInfo) {
      return { 
        success: false, 
        message: "Données manquantes pour créer la session de paiement" 
      };
    }

    if (!customerInfo.email || !customerInfo.fullName) {
      return { 
        success: false, 
        message: "Informations client incomplètes" 
      };
    }

    // ── 2. Load and validate staff service ────────────────────────────────────
    const staffService = await prisma.staffService.findUnique({
      where: { id: staffServiceId },
      include: {
        service: true,
        staff: { 
          include: { 
            user: { 
              select: { fullName: true } 
            } 
          } 
        },
      },
    });

    if (!staffService) {
      return { success: false, message: "Service introuvable" };
    }

    // ── 3. Calculate appointment times ────────────────────────────────────────
    const [hour, minute] = time.split(":").map(Number);
    const appointmentDate = new Date(date);
    appointmentDate.setHours(0, 0, 0, 0);

    const startTime = new Date(appointmentDate);
    startTime.setHours(hour, minute, 0, 0);

    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + staffService.duration);

    // ── 4. Verify slot availability ───────────────────────────────────────────
    const conflict = await prisma.appointment.findFirst({
      where: {
        staffServiceId,
        date: appointmentDate,
        startTime: { lte: endTime },
        endTime: { gte: startTime },
        status: { in: ["PENDING", "CONFIRMED"] },
        isDeleted: false,
      },
    });

    if (conflict) {
      return { 
        success: false, 
        message: "Ce créneau n'est plus disponible. Veuillez en sélectionner un autre." 
      };
    }

    // ── 5. Calculate payment amounts ──────────────────────────────────────────
    const totalAmount = Number(staffService.price);
    const depositAmount = totalAmount * 0.1;

    let amountToPay;

    switch (paymentMethod) {
    case "ONLINE":
        amountToPay = totalAmount;
        break;

    case "ON_SITE":
        amountToPay = depositAmount;
        break;

    default:
        return {
        success: false,
        message: "Méthode de paiement invalide.",
        };
    }
    // ── 6. Prepare metadata for Stripe ────────────────────────────────────────
    // Store ALL reservation data in metadata so the webhook can create the records
    const metadata = {
      // Reservation data
      staffServiceId,
      date: appointmentDate.toISOString(),
      time,
      notes: notes || "",
      
      // Customer data
      customerFullName: customerInfo.fullName,
      customerEmail: customerInfo.email,
      customerPhone: customerInfo.phone,
      customerUserId: customerInfo.userId || "",
      newsletterSubscribed: String(customerInfo.newsletterSubscribed ?? false),

      paymentMethod,
      
      serviceName: staffService.service.name,
    };

    // ── 7. Create Stripe Checkout Session ─────────────────────────────────────
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "eur",
            product_data: {
              name:
                paymentMethod === "ONLINE"
                    ? staffService.service.name
                    : `Acompte - ${staffService.service.name}`,
              description: `${staffService.staff?.user?.fullName || "Expert"} • ${new Date(date).toLocaleDateString("fr-FR")} • ${time}`,
             images: staffService.photo? [`${process.env.NEXT_PUBLIC_APP_URL}${staffService.photo}`]: [],
            },
            unit_amount: Math.round(amountToPay * 100), // Convert to cents
          },
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/reservation?canceled=true`,
      customer_email: customerInfo.email,
      metadata,
      payment_intent_data: {
        metadata, // Also attach to payment intent for redundancy
      },
    });

    return {
      success: true,
      sessionId: session.id,
      url: session.url,
    };
  } catch (error) {
    console.error("[createCheckoutSession]", error);
    return {
      success: false,
      message: "Erreur lors de la création de la session de paiement Stripe",
    };
  }
}

