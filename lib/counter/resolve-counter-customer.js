import { resolveOrCreateCustomer } from "@/actions/reservation/create-reservation";
import { saveCheckoutVatNumber } from "@/lib/customer-vat";
import { validateBillingAddress } from "@/lib/validations/customer-identity";
import { CounterCustomerError } from "@/lib/reservation-errors";

/**
 * Resolves who the buyer is for a counter transaction: an existing account
 * picked from search, or a brand-new B2C/B2B customer created on the spot.
 * Shared so a customer resolved or created from any counter flow (the
 * walk-in service composer, buyer completion on an existing booking, and
 * later a counter-created reservation) gets the same VAT/VIES rule and the
 * same address requirement, instead of each flow growing its own copy.
 *
 * Deliberately kept out of any "use server" file: every export of such a
 * file is a public POST endpoint, and this is plain logic shared by server
 * actions.
 *
 * `client` is whichever Prisma client is live at the call site — `tx` inside
 * an enclosing transaction, or plain `prisma` outside one. It is used for
 * the lookup-by-id, the VAT save and the address write. resolveOrCreateCustomer
 * itself always runs against the global `prisma` (see its own file) — a
 * pre-existing constraint every other caller of it already lives with, not
 * something introduced here.
 *
 * Throws CounterCustomerError for every failure a cashier should simply be
 * told about (customer not found, VAT rejected, address missing) — anything
 * else (a database error) propagates as-is for the caller to log.
 *
 * Address fields are flat on `input` (addressLine1/addressCity/...), the
 * same shape counterCustomerSchema and validateBillingAddress already use
 * everywhere else in the counter — not nested under an `address` key.
 *
 * @param {import("@prisma/client").PrismaClient | import("@prisma/client").Prisma.TransactionClient} client
 * @param {{userId?: string, fullName?: string, email?: string, phone?: string,
 *   vatNumber?: string, addressLine1?: string, addressLine2?: string,
 *   addressCity?: string, addressPostalCode?: string, addressCountry?: string}} input
 * @returns {Promise<object>} The resolved/created/updated User row.
 */
export async function resolveCounterCustomer(client, input) {
  let user;
  if (input.userId) {
    user = await client.user.findFirst({
      where: { id: input.userId, role: "CUSTOMER", isDeleted: false },
      include: { billingProfile: true },
    });
    if (!user) throw new CounterCustomerError("Client introuvable.");
  } else {
    const resolved = await resolveOrCreateCustomer(
      { fullName: input.fullName, email: input.email, phone: input.phone, newsletterSubscribed: false },
      undefined
    );
    user = resolved.user;
  }

  if (input.vatNumber) {
    const vatResult = await saveCheckoutVatNumber(client, user, input.vatNumber);
    if (!vatResult.success) throw new CounterCustomerError(vatResult.message);
    user = vatResult.user;
  }

  if (input.addressLine1) {
    const addressValidation = validateBillingAddress(input);
    if (!addressValidation.success) throw new CounterCustomerError(addressValidation.message);
    user = await client.user.update({ where: { id: user.id }, data: addressValidation.data });
  }

  // A VAT number with no billing address can never be invoiced —
  // issueInvoice's own guard (BUYER_LEGAL_DATA_INCOMPLETE) would otherwise
  // surface much later, at settlement, with the customer no longer at the
  // till to provide one. Same rule as create-workshop-reservation.js.
  if (user.vatNumber && !user.addressLine1) {
    throw new CounterCustomerError("Une adresse de facturation est obligatoire pour un client avec un numéro de TVA.");
  }

  return user;
}
