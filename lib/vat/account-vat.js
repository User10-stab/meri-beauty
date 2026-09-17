import { isValidVatFormat, isViesOutage, normalizeVatNumber, verifyVatWithVies } from "@/lib/vat-validation";

/**
 * One person, one VAT number — across both accounts they may hold.
 *
 * An independent practitioner is two rows in this database: a `User` (how she
 * buys, and how an invoice to her is addressed) and a `Staff` (how she works,
 * and which number her own sales are issued under). Each row carried its own
 * `vatNumber`, filled in by a different screen, so Julie Schoemans ended up
 * VIES-validated as a customer (BE0542845058, invoice F-2026-000009) and blank
 * as a staff member — unable to issue anything in her own name, while the same
 * number sat one table away.
 *
 * These helpers keep the two in step: whichever screen learns the number
 * writes it to both. Kept out of any "use server" module so they can run
 * inside a caller's transaction (and be unit-tested against a mocked client).
 */

/**
 * Writes `vatNumber` to the user AND to their staff profile, if they have one.
 *
 * `validatedAt` is the VIES confirmation instant, or null when the number was
 * accepted provisionally (VIES unreachable — see isViesOutage). Passing null
 * deliberately clears any previous validation: the number changed, so the old
 * confirmation no longer describes it.
 *
 * @param {object} client - prisma, or a transaction client
 * @param {{ userId: string, vatNumber: string, validatedAt?: Date|null, viesName?: string|null, viesAddress?: string|null }} input
 */
export async function syncAccountVatNumber(client, { userId, vatNumber, validatedAt = null, viesName = null, viesAddress = null }) {
  const normalized = normalizeVatNumber(vatNumber);
  if (!userId || !normalized) return { normalized: null, staffUpdated: 0 };

  await client.user.update({
    where: { id: userId },
    data: {
      // Holding a VAT number IS being a business here — the same rule
      // issueInvoice applies (lib/invoicing.js): a sole trader with no company
      // name is still B2B.
      isCompany: true,
      vatNumber: normalized,
      vatValidatedAt: validatedAt,
      vatValidationName: viesName,
      vatValidationAddress: viesAddress,
    },
  });

  // updateMany, not update: most users have no staff profile at all, and this
  // must not throw for them.
  const staff = await client.staff.updateMany({
    where: { userId, isDeleted: false },
    data: { vatNumber: normalized },
  });

  return { normalized, staffUpdated: staff.count };
}

/**
 * The one VIES gate every staff screen uses, so they can't drift apart.
 *
 * An independent invoices under her own number, so the number is mandatory —
 * but a VIES outage must not stop the salon from onboarding someone. Same
 * rule as every sale entry point (see isViesOutage): accept the number
 * provisionally, leave it unvalidated, and let the next check confirm it.
 * A number VIES actively reports as not active is refused outright.
 *
 * @returns {{ ok: true, vatNumber: string, validatedAt: Date|null, name: string|null, address: string|null, pending: boolean } | { ok: false, message: string }}
 */
export async function verifyStaffVatNumber(raw) {
  const normalized = normalizeVatNumber(raw);
  if (!normalized) return { ok: false, message: "Le numéro de TVA est obligatoire pour un indépendant." };
  if (!isValidVatFormat(normalized)) {
    return { ok: false, message: "Numéro de TVA UE invalide. Ajoutez le préfixe pays (BE, FR, DE, NL…)." };
  }

  const vies = await verifyVatWithVies(normalized);
  if (isViesOutage(vies)) {
    return { ok: true, vatNumber: normalized, validatedAt: null, name: null, address: null, pending: true };
  }
  if (!vies.success) {
    return { ok: false, message: vies.message || "Impossible de vérifier ce numéro auprès de VIES. Réessayez." };
  }
  if (!vies.valid) {
    return { ok: false, message: "Ce numéro de TVA n'est pas reconnu comme actif par VIES." };
  }
  return { ok: true, vatNumber: normalized, validatedAt: new Date(), name: vies.name ?? null, address: vies.address ?? null, pending: false };
}

/**
 * The VAT number this person already has on either account, preferring a
 * VIES-validated one. Lets a screen that is about to ask for a number use the
 * one the other screen already collected.
 */
export async function findKnownVatNumber(client, { userId = null, email = null }) {
  const where = userId ? { id: userId } : email ? { email: { equals: email, mode: "insensitive" }, isDeleted: false } : null;
  if (!where) return null;

  const user = await client.user.findFirst({
    where,
    select: { id: true, vatNumber: true, vatValidatedAt: true, staff: { select: { vatNumber: true } } },
  });
  if (!user) return null;

  const fromUser = user.vatNumber?.trim() || null;
  const fromStaff = user.staff?.vatNumber?.trim() || null;
  if (fromUser && user.vatValidatedAt) return { vatNumber: normalizeVatNumber(fromUser), validatedAt: user.vatValidatedAt };
  const found = fromUser || fromStaff;
  return found ? { vatNumber: normalizeVatNumber(found), validatedAt: fromUser === found ? user.vatValidatedAt : null } : null;
}
