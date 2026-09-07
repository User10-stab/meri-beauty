"use server";

import { auth } from "@/auth";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { isAdminRole, hasDashboardPermission, STAFF_PERMISSIONS, ROLES } from "@/lib/authorization";
import { getCurrentStaffId } from "@/lib/route-protection";
import { staffCustomerRelationshipFilters } from "@/lib/staff-customer-scope";
import { z } from "zod";
import { customerEmailSchema, fullNameSchema } from "@/lib/validations/customer-identity";
import countriesData from "@/data/countries.json";

// Map country name ↔ ISO code so CountrySelect (which stores the French name
// like "Belgique") and the DB (which stores the code like "BE") stay in sync
// regardless of whether the caller sends a code or a name.
const CODE_TO_NAME = new Map(countriesData.map((c) => [c.code.toUpperCase(), c.name]));
const NAME_TO_CODE = new Map(countriesData.map((c) => [c.name.toLowerCase(), c.code.toUpperCase()]));

function normalizeCountryToCode(raw) {
  if (!raw) return "BE";
  const trimmed = String(raw).trim();
  if (/^[A-Za-z]{2}$/.test(trimmed)) return trimmed.toUpperCase();
  const mapped = NAME_TO_CODE.get(trimmed.toLowerCase());
  return mapped ?? trimmed.toUpperCase().slice(0, 2);
}

function isValidCountryCode(code) {
  return CODE_TO_NAME.has(code.toUpperCase());
}

const nickNameSchema = z
  .string()
  .trim()
  .max(50, "Le surnom ne peut pas dépasser 50 caractères.")
  .optional()
  .or(z.literal(""))
  .transform((v) => (v && v.trim().length >= 2 ? v.trim() : v?.trim() ? v.trim() : null))
  .superRefine((v, ctx) => {
    if (v !== null && v !== "" && v.length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Le surnom doit comporter au moins 2 caractères." });
    }
  });

const phoneSchema = z
  .string()
  .trim()
  .min(8, "Le numéro de téléphone doit comporter au moins 8 caractères.")
  .max(20, "Le numéro de téléphone ne peut pas dépasser 20 caractères.")
  .regex(/^[+]?[\d\s()/-]+$/, "Le numéro de téléphone ne peut contenir que des chiffres, espaces et les caractères + ( ) - /.");

const optionalPhoneSchema = z.union([phoneSchema, z.literal("")]).optional().transform((v) => (v ?? ""));

const updateCustomerSchema = z.object({
  id: z.string().min(1, "Identifiant manquant."),
  fullName: fullNameSchema,
  nickName: z
    .string()
    .trim()
    .max(50, "Le surnom ne peut pas dépasser 50 caractères.")
    .optional()
    .nullable()
    .or(z.literal("")),
  email: customerEmailSchema,
  phone: phoneSchema,
  isActive: z.boolean().optional().default(true),
  addressLine1: z.string().trim().min(3, "L'adresse est obligatoire.").max(150, "L'adresse ne peut pas dépasser 150 caractères."),
  addressLine2: z.string().trim().max(150, "L'adresse ne peut pas dépasser 150 caractères.").optional().nullable().or(z.literal("")),
  addressCity: z.string().trim().min(2, "La ville est obligatoire.").max(100, "La ville ne peut pas dépasser 100 caractères."),
  addressPostalCode: z.string().trim().min(3, "Le code postal est obligatoire.").max(10, "Le code postal ne peut pas dépasser 10 caractères."),
  addressCountry: z.string().trim().min(2, "Le pays est obligatoire.").max(100),
});

/**
 * Edits a customer's profile from the dashboard — OWNER/ADMIN always,
 * STAFF only when they hold the CUSTOMERS permission *and* the customer is
 * actually linked to them (same scope as getCustomers). STAFF outside that
 * scope are treated as "not found" to avoid leaking existence.
 */
export async function updateCustomer(input) {
  const session = await auth();
  if (!session?.user) {
    return { success: false, message: "Accès non autorisé." };
  }

  const isAdmin = isAdminRole(session.user.role);
  const isStaff = session.user.role === ROLES.STAFF;

  if (!isAdmin) {
    // Staff must hold the explicit CUSTOMERS capability; everyone else is denied.
    if (!isStaff || !(await hasDashboardPermission(session.user, STAFF_PERMISSIONS.CUSTOMERS))) {
      return { success: false, message: "Accès non autorisé." };
    }
  }

  const parsed = updateCustomerSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    const firstField = Object.keys(fe)[0];
    const firstMsg = firstField ? fe[firstField]?.[0] : null;
    return {
      success: false,
      message: firstMsg ?? parsed.error.issues[0]?.message ?? "Données invalides.",
      errors: Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? null])),
    };
  }

  const {
    id,
    fullName,
    nickName,
    email,
    phone,
    isActive,
    addressLine1,
    addressLine2,
    addressCity,
    addressPostalCode,
    addressCountry: rawCountry,
  } = parsed.data;

  const addressCountry = normalizeCountryToCode(rawCountry);
  if (!isValidCountryCode(addressCountry)) {
    return { success: false, message: "Pays invalide.", errors: { addressCountry: "Sélectionnez un pays valide." } };
  }

  // Normalize nickName: empty string → null, keep null otherwise
  const normalizedNickName = nickName && String(nickName).trim().length >= 2 ? String(nickName).trim() : null;

  const normalizedEmail = String(email).trim().toLowerCase();
  const normalizedPhone = String(phone).trim();

  try {
    // Scope check: STAFF may only edit customers they are related to.
    let staffRelationshipFilters = null;
    let staffId = null;
    if (isStaff && !isAdmin) {
      staffId = await getCurrentStaffId();
      if (!staffId) return { success: false, message: "Profil staff introuvable." };
      staffRelationshipFilters = staffCustomerRelationshipFilters({ staffId, staffUserId: session.user.id });
    }

    const existing = await prisma.user.findFirst({
      where: {
        id,
        role: "CUSTOMER",
        isDeleted: false,
        ...(staffRelationshipFilters ? { OR: staffRelationshipFilters } : {}),
      },
      select: { id: true, email: true, phone: true },
    });
    if (!existing) return { success: false, message: "Client introuvable." };

    // Uniqueness — active-only, exclude self, ignore soft-deleted rows.
    if (normalizedEmail !== existing.email?.toLowerCase()) {
      const emailConflict = await prisma.user.findFirst({
        where: { email: normalizedEmail, isDeleted: false, id: { not: id } },
        select: { id: true },
      });
      if (emailConflict) {
        return {
          success: false,
          message: "Cet email est déjà utilisé.",
          errors: { email: "Cet email est déjà utilisé par un autre compte actif." },
        };
      }
    }

    if (normalizedPhone && normalizedPhone !== existing.phone) {
      const phoneConflict = await prisma.user.findFirst({
        where: { phone: normalizedPhone, isDeleted: false, id: { not: id } },
        select: { id: true },
      });
      if (phoneConflict) {
        return {
          success: false,
          message: "Ce numéro de téléphone est déjà utilisé.",
          errors: { phone: "Ce numéro est déjà utilisé par un autre compte actif." },
        };
      }
    }

    const emailChanged = normalizedEmail !== existing.email?.toLowerCase();

    const data = {
      fullName: fullName.trim(),
      nickName: normalizedNickName,
      email: normalizedEmail,
      phone: normalizedPhone,
      isActive: Boolean(isActive),
      addressLine1: addressLine1.trim(),
      addressLine2: addressLine2 ? String(addressLine2).trim() || null : null,
      addressCity: addressCity.trim(),
      addressPostalCode: addressPostalCode.trim(),
      addressCountry,
      ...(emailChanged ? { emailVerified: false } : {}),
    };

    await prisma.user.update({
      where: { id },
      data,
    });

    revalidatePath("/dashboard/customers");
    return { success: true, message: "Client mis à jour." };
  } catch (error) {
    // Prisma unique constraint fallback — maps to active-only check above but
    // guards the race window between findFirst and update.
    if (error?.code === "P2002") {
      const target = error.meta?.target;
      if (Array.isArray(target) ? target.includes("email") : String(target ?? "").includes("email")) {
        return { success: false, message: "Cet email est déjà utilisé.", errors: { email: "Cet email est déjà utilisé." } };
      }
      if (Array.isArray(target) ? target.includes("phone") : String(target ?? "").includes("phone")) {
        return { success: false, message: "Ce numéro est déjà utilisé.", errors: { phone: "Ce numéro est déjà utilisé." } };
      }
    }
    console.error("[updateCustomer]", error);
    return { success: false, message: "Erreur lors de la mise à jour du client." };
  }
}
