"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { createIndependentStaffSchema } from "@/lib/validations/independent-staff";
import { sendEmail } from "@/lib/email";
import { verifyVatWithVies } from "@/lib/vat-validation";
import { createAndSendStaffContractInvoice } from "@/lib/staff-invoice";

const REVALIDATE_PATH = "/dashboard/staff/auto-entrepreneur";

/**
 * Creates a Staff (INDEPENDENT) record linked to an **existing** User.
 *
 * This action is used when approving a rental request: the applicant already
 * has a User account, so we skip creating a new User, generating a password,
 * and sending a welcome email. Instead we:
 *  1. Find the existing user by email
 *  2. Update their fullName / phone / professional address if the admin changed them
 *  3. Create the Staff record + Contract (mandatory) + Service assignments
 *
 * If the user does NOT exist (edge case), it falls back to creating a new
 * User + Staff (same as createIndependentStaff).
 *
 * @param {object} input  Raw form data (validated against createIndependentStaffSchema)
 * @returns {{ success: boolean, message: string, errors?: object, staffId?: string }}
 */
export async function createStaffFromRental(input, rentalRequestId) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  if (typeof rentalRequestId !== "string" || !rentalRequestId.trim()) {
    return { success: false, message: "Demande de location manquante." };
  }

  // ── 1. Validate ──────────────────────────────────────────────────────────
  const parsed = createIndependentStaffSchema.safeParse(input);

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs dans le formulaire.",
      errors: {
        fullName:          fe.fullName?.[0]          ?? null,
        email:             fe.email?.[0]             ?? null,
        phone:             fe.phone?.[0]             ?? null,
        addressLine1:      fe.addressLine1?.[0]      ?? null,
        addressLine2:      fe.addressLine2?.[0]      ?? null,
        addressCity:       fe.addressCity?.[0]       ?? null,
        addressPostalCode: fe.addressPostalCode?.[0] ?? null,
        addressCountry:    fe.addressCountry?.[0]    ?? null,
        photo:             fe.photo?.[0]             ?? null,
        bio:               fe.bio?.[0]               ?? null,
        languages:         fe.languages?.[0]         ?? null,
        yearsOfExperience: fe.yearsOfExperience?.[0] ?? null,
        hireDate:          fe.hireDate?.[0]          ?? null,
        vatNumber:         fe.vatNumber?.[0]         ?? null,
        serviceIds:        fe.serviceIds?.[0]        ?? null,
        dashboardPermissions: fe.dashboardPermissions?.[0] ?? null,
        contract:          fe["contract"]?.[0]       ?? null,
      },
    };
  }

  const {
    fullName,
    email,
    phone,
    addressLine1,
    addressLine2,
    addressCity,
    addressPostalCode,
    addressCountry,
    photo,
    bio,
    languages,
    yearsOfExperience,
    hireDate,
    vatNumber,
    serviceIds,
    dashboardPermissions,
    contract,
  } = parsed.data;

  // ── 2. Validate referenced service IDs exist ─────────────────────────────
  const ids = serviceIds ?? [];
  if (ids.length > 0) {
    const found = await prisma.service.findMany({
      where: { id: { in: ids }, isDeleted: false },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      return {
        success: false,
        message: "Un ou plusieurs services sélectionnés sont introuvables.",
        errors: { serviceIds: "Services introuvables." },
      };
    }
  }

  if (vatNumber) {
    const viesResult = await verifyVatWithVies(vatNumber);
    if (!viesResult.success) {
      return { success: false, message: viesResult.message || "Impossible de vérifier ce numéro auprès de VIES. Réessayez.", errors: { vatNumber: "Vérification VIES indisponible." } };
    }
    if (!viesResult.valid) {
      return { success: false, message: "Ce numéro de TVA n'est pas reconnu comme actif par VIES.", errors: { vatNumber: "Numéro non reconnu par VIES." } };
    }
  }

  // ── 3. Check if user already exists ──────────────────────────────────────
  const existingUser = await prisma.user.findFirst({
    where: { email, isDeleted: false },
    select: {
      id: true,
      fullName: true,
      email: true,
      phone: true,
      role: true,
      staff: { select: { id: true, isDeleted: true } },
    },
  });

  // Staff.userId is unique — a soft-deleted Staff row for this user can't be
  // re-inserted, it must be reactivated instead (see below). An active one
  // blocks creation outright.
  if (existingUser?.staff && !existingUser.staff.isDeleted) {
    return {
      success: false,
      message: "Un membre du personnel avec cette adresse e-mail existe déjà.",
      errors: { email: "Un membre du personnel avec cette adresse e-mail existe déjà." },
    };
  }
  const deletedStaffId = existingUser?.staff?.isDeleted ? existingUser.staff.id : null;

  // ── 4. Transaction ───────────────────────────────────────────────────────
  try {
    const staff = await prisma.$transaction(async (tx) => {
      const rentalRequest = await tx.rentalRequest.findFirst({
        where: {
          id: rentalRequestId,
          isDeleted: false,
          status: "PENDING",
          contractId: null,
        },
        include: { user: { select: { email: true, fullName: true } } },
      });

      if (!rentalRequest) {
        const error = new Error("RENTAL_REQUEST_ALREADY_CONVERTED");
        error.code = "RENTAL_REQUEST_ALREADY_CONVERTED";
        throw error;
      }

      if (
        rentalRequest.user?.email &&
        rentalRequest.user.email.toLowerCase() !== email.toLowerCase()
      ) {
        const error = new Error("RENTAL_REQUEST_APPLICANT_MISMATCH");
        error.code = "RENTAL_REQUEST_APPLICANT_MISMATCH";
        throw error;
      }

      let userId;

      if (existingUser) {
        // ── Existing user: update info, link Staff to this user ──────────
        userId = existingUser.id;

        // Update user info in case the admin modified the fields,
        // and promote the user from CUSTOMER to STAFF. The professional
        // address from the form wins — it is what the rental invoice prints.
        await tx.user.update({
          where: { id: userId },
          data: {
            fullName,
            phone,
            addressLine1,
            addressLine2: addressLine2 || null,
            addressCity,
            addressPostalCode,
            addressCountry,
            role: "STAFF",
            // email is NOT updated — it's the unique identifier and should
            // remain as-is to avoid breaking references
          },
        });
      } else {
        // ── No existing user: this shouldn't happen for rental requests,
        //     but handle gracefully by creating a minimal user.
        //     We still need a password — generate one.
        const bcrypt = await import("bcrypt");
        const crypto = await import("crypto");

        const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
        const lower = "abcdefghjkmnpqrstuvwxyz";
        const digits = "23456789";
        const symbols = "!@#$%^&*";
        const all = upper + lower + digits + symbols;
        const pick = (str) => str[crypto.default.randomInt(str.length)];
        const required = [pick(upper), pick(lower), pick(digits), pick(symbols)];
        const rest = Array.from({ length: 12 }, () => pick(all));
        const combined = [...required, ...rest];
        for (let i = combined.length - 1; i > 0; i--) {
          const j = crypto.default.randomInt(i + 1);
          [combined[i], combined[j]] = [combined[j], combined[i]];
        }
        const plainPassword = combined.join("");
        const hashedPassword = await bcrypt.default.hash(plainPassword, 12);

        const newUser = await tx.user.create({
          data: {
            fullName,
            email,
            phone,
            addressLine1,
            addressLine2: addressLine2 || null,
            addressCity,
            addressPostalCode,
            addressCountry,
            password: hashedPassword,
            role: "STAFF",
            emailVerified: false,
            isActive: true,
          },
        });
        userId = newUser.id;
      }

      // ── Create (or reactivate a soft-deleted) Staff record ────────────
      const staffData = {
        type: "INDEPENDENT",
        photo: photo ?? null,
        bio: bio ?? null,
        languages: languages ?? [],
        yearsOfExperience: yearsOfExperience ?? null,
        isActive: true,
        hireDate: hireDate ? new Date(hireDate) : null,
        vatNumber,
        dashboardPermissions,
      };

      const newStaff = deletedStaffId
        ? await tx.staff.update({
            where: { id: deletedStaffId },
            data: { ...staffData, isDeleted: false, deletedAt: null },
          })
        : await tx.staff.create({ data: { ...staffData, userId } });

      // ── Create Contract (always FIXED_RENT — mandatory for all staff) ──
      const newContract = await tx.contract.create({
        data: {
          staffId: newStaff.id,
          type: "FIXED_RENT",
          fixedRent: contract.fixedRent,
          startDate: new Date(contract.startDate),
          endDate: contract.endDate ? new Date(contract.endDate) : null,
          status: "ACTIVE",
          notes: contract.notes ?? null,
        },
      });

      const linked = await tx.rentalRequest.updateMany({
        where: {
          id: rentalRequestId,
          status: "PENDING",
          contractId: null,
          isDeleted: false,
        },
        data: {
          status: "APPROVED",
          contractId: newContract.id,
        },
      });

      if (linked.count !== 1) {
        const error = new Error("RENTAL_REQUEST_ALREADY_CONVERTED");
        error.code = "RENTAL_REQUEST_ALREADY_CONVERTED";
        throw error;
      }

      // ── Assign services ──────────────────────────────────────────────
      if (ids.length > 0) {
        await tx.staffService.createMany({
          data: ids.map((serviceId) => ({
            staffId: newStaff.id,
            serviceId,
            createdById: userId,
            price: 0,
            duration: 0,
            photo: "",
            isActive: true,
          })),
          skipDuplicates: true,
        });
      }

      return { staff: newStaff, contract: newContract, userId };
    });

    revalidatePath(REVALIDATE_PATH);
    revalidatePath("/dashboard/rental-requests");

    // Invoice for the new contract — outside transaction so email failure does not roll back staff/contract.
    // Idempotent per contract; errors are logged but do not fail the overall creation.
    try {
      const invoiceUser = await prisma.user.findUnique({
        where: { email },
        select: { id: true, fullName: true, email: true, vatNumber: true, isCompany: true, addressLine1: true, addressLine2: true, addressCity: true, addressPostalCode: true, addressCountry: true, vatValidatedAt: true },
      });
      const contractForInvoice = await prisma.contract.findFirst({
        where: { staffId: staff.staff.id },
        orderBy: { createdAt: "desc" },
      });
      // Fallback to the created contract if fetch fails
      const finalContract = contractForInvoice ?? staff.contract;
      if (finalContract && invoiceUser) {
        await createAndSendStaffContractInvoice({
          contract: finalContract,
          user: { ...invoiceUser, vatNumber: invoiceUser.vatNumber ?? vatNumber },
        });
      }
    } catch (invoiceErr) {
      console.error("[createStaffFromRental] staff invoice failed (non-blocking):", invoiceErr);
    }

    sendEmail({
      to: email,
      subject: "Votre demande de location a été approuvée – Meri Beauty",
      text: `Bonjour ${fullName},\n\nVotre demande de location a été approuvée et votre contrat a été créé.\n\nL'équipe Meri Beauty`,
      html: `<p>Bonjour ${fullName},</p><p>Votre demande de location a été approuvée et votre contrat a été créé.</p><p>L'équipe Meri Beauty</p>`,
    }).catch((err) => console.error("[createStaffFromRental] approval email failed:", err));

    return {
      success: true,
      message: existingUser
        ? `Le profil de ${fullName} a été créé avec succès.`
        : `Le profil de ${fullName} a été créé avec succès. Les identifiants ont été envoyés par e-mail.`,
      staffId: staff.id,
    };
  } catch (error) {
    if (error.code === "RENTAL_REQUEST_ALREADY_CONVERTED") {
      return {
        success: false,
        message: "Cette demande a déjà été traitée ou liée à un contrat.",
      };
    }

    if (error.code === "RENTAL_REQUEST_APPLICANT_MISMATCH") {
      return {
        success: false,
        message: "L'adresse e-mail ne correspond pas au demandeur.",
      };
    }

    if (error.code === "P2002") {
      const fields = error.meta?.target ?? [];

      if (fields.includes("vatNumber")) {
        return {
          success: false,
          message: "Ce numéro de TVA est déjà utilisé.",
          errors: { vatNumber: "Ce numéro de TVA est déjà utilisé." },
        };
      }

      if (fields.includes("phone")) {
        return {
          success: false,
          message: "Ce numéro de téléphone est déjà utilisé.",
          errors: { phone: "Ce numéro de téléphone est déjà utilisé." },
        };
      }
      return {
        success: false,
        message: "Un compte avec ces informations existe déjà.",
      };
    }

    console.error("[createStaffFromRental]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}
