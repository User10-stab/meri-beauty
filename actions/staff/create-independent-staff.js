"use server";

import bcrypt from "bcrypt";
import crypto from "crypto";
import { revalidatePath } from "next/cache";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { sendEmail } from "@/lib/email";
import { emailVerificationEmail } from "@/lib/email-templates";
import { generateSecurePassword } from "@/lib/generate-password";
import { createIndependentStaffSchema } from "@/lib/validations/independent-staff";
import { verifyVatWithVies } from "@/lib/vat-validation";
import { createAndSendStaffContractInvoice } from "@/lib/staff-invoice";

const BCRYPT_SALT_ROUNDS = 12;
const VERIFICATION_TOKEN_EXPIRY_MINUTES = 24 * 60; // 24 hours instead of 15 minutes
const REVALIDATE_PATH = "/dashboard/staff/auto-entrepreneur";

function buildWelcomeEmail({ fullName, email, password, loginUrl }) {
  const text = [
    `Bonjour ${fullName},`,
    ``,
    `Votre compte auto-entrepreneur a été créé sur la plateforme Meri Beauty.`,
    ``,
    `Vos identifiants de connexion :`,
    `  E-mail      : ${email}`,
    `  Mot de passe : ${password}`,
    ``,
    `Connectez-vous ici : ${loginUrl}`,
    ``,
    `Pour des raisons de sécurité, nous vous recommandons de changer votre mot de passe dès votre première connexion.`,
    ``,
    `Cordialement,`,
    `L'équipe Meri Beauty`,
  ].join("\n");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #eaeaea;border-radius:12px;background:#fff;">
      <h2 style="color:#2F3A2E;font-family:serif;margin-bottom:8px;">Bienvenue sur Meri Beauty</h2>
      <p style="font-size:15px;color:#404040;">Bonjour <strong>${fullName}</strong>,</p>
      <p style="font-size:14px;color:#525252;line-height:1.6;">
        Votre compte auto-entrepreneur a été créé. Voici vos identifiants de connexion :
      </p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;font-size:14px;">
        <tr>
          <td style="padding:10px 14px;background:#f4f6f4;border-radius:8px 0 0 0;font-weight:600;color:#2F3A2E;width:40%;">E-mail</td>
          <td style="padding:10px 14px;background:#f4f6f4;border-radius:0 8px 0 0;color:#404040;">${email}</td>
        </tr>
        <tr>
          <td style="padding:10px 14px;background:#eef2ed;font-weight:600;color:#2F3A2E;">Mot de passe</td>
          <td style="padding:10px 14px;background:#eef2ed;font-family:monospace;letter-spacing:1px;color:#404040;">${password}</td>
        </tr>
      </table>
      <p style="margin:28px 0;text-align:center;">
        <a href="${loginUrl}" style="background:#2F3A2E;color:#fff;padding:13px 28px;text-decoration:none;border-radius:10px;font-weight:600;display:inline-block;">
          Se connecter
        </a>
      </p>
      <p style="font-size:12px;color:#737373;">
        Pour des raisons de sécurité, nous vous recommandons de changer votre mot de passe dès votre première connexion.
      </p>
    </div>
  `;

  return { text, html };
}

/**
 * Creates User (STAFF) + Staff (INDEPENDENT) + Contract (FIXED_RENT — mandatory)
 * + StaffService assignments — all inside a single Prisma transaction.
 *
 * @param {object} input  Raw form data (validated against createIndependentStaffSchema)
 * @returns {{ success: boolean, message: string, errors?: object, staffId?: string }}
 */
export async function createIndependentStaff(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = createIndependentStaffSchema.safeParse(input);

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs dans le formulaire.",
      errors: {
        fullName: fe.fullName?.[0] ?? null,
        email: fe.email?.[0] ?? null,
        phone: fe.phone?.[0] ?? null,
        addressLine1: fe.addressLine1?.[0] ?? null,
        addressLine2: fe.addressLine2?.[0] ?? null,
        addressCity: fe.addressCity?.[0] ?? null,
        addressPostalCode: fe.addressPostalCode?.[0] ?? null,
        addressCountry: fe.addressCountry?.[0] ?? null,
        photo: fe.photo?.[0] ?? null,
        bio: fe.bio?.[0] ?? null,
        languages: fe.languages?.[0] ?? null,
        yearsOfExperience: fe.yearsOfExperience?.[0] ?? null,
        hireDate: fe.hireDate?.[0] ?? null,
        vatNumber: fe.vatNumber?.[0] ?? null,
        rythme: fe.rythme?.[0] ?? null,
        serviceIds: fe.serviceIds?.[0] ?? null,
        dashboardPermissions: fe.dashboardPermissions?.[0] ?? null,
        contract: fe["contract"]?.[0] ?? null,
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
    rythme,
    serviceIds,
    dashboardPermissions,
    contract,
  } = parsed.data;

  // Validate referenced service IDs exist
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

  // A staff member already active under this email blocks re-creation; a
  // soft-deleted one does not (see createStaffFromRental for the case where
  // the Staff row itself must be reactivated instead of duplicated).
  const existingUser = await prisma.user.findFirst({
    where: { email },
    select: { staff: { select: { isDeleted: true } } },
  });
  if (existingUser?.staff && !existingUser.staff.isDeleted) {
    return {
      success: false,
      message: "Un membre du personnel avec cette adresse e-mail existe déjà.",
      errors: { email: "Un membre du personnel avec cette adresse e-mail existe déjà." },
    };
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

  const plainPassword = generateSecurePassword();
  const hashedPassword = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);

  try {
    const { staff, contract: createdContract, user: createdUser } = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
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

      const newStaff = await tx.staff.create({
        data: {
          userId: user.id,
          type: "INDEPENDENT",
          photo: photo ?? null,
          bio: bio ?? null,
          languages: languages ?? [],
          yearsOfExperience: yearsOfExperience ?? null,
          isActive: true,
          hireDate: hireDate ? new Date(hireDate) : null,
          vatNumber,
          rythme: rythme ?? null,
          dashboardPermissions,
        },
      });

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

      if (ids.length > 0) {
        await tx.staffService.createMany({
          data: ids.map((serviceId) => ({
            staffId: newStaff.id,
            serviceId,
            // createdById should be the admin performing the action
            createdById: session.user.id,
            // Admin assigns services, staff can edit details later
            price: 0,
            duration: 0,
            photo: "",
            isActive: true,
          })),
          skipDuplicates: true,
        });
      }

      return { staff: newStaff, contract: newContract, user };
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const loginUrl = `${baseUrl}/login`;

    const { text, html } = buildWelcomeEmail({
      fullName,
      email,
      password: plainPassword,
      loginUrl,
    });

    await sendEmail({
      to: email,
      subject: "Vos identifiants de connexion – Meri Beauty",
      text,
      html,
    });

    const verificationPlainToken = crypto.randomUUID();
    const verificationTokenHash = await bcrypt.hash(
      verificationPlainToken,
      BCRYPT_SALT_ROUNDS
    );
    const verificationExpiresAt = new Date(
      Date.now() + VERIFICATION_TOKEN_EXPIRY_MINUTES * 60 * 1000
    );

    await prisma.emailVerificationToken.create({
      data: {
        email,
        tokenHash: verificationTokenHash,
        expiresAt: verificationExpiresAt,
      },
    });

    const verificationUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(
      verificationPlainToken
    )}`;

    const verificationTemplate = emailVerificationEmail({
      customerName: fullName,
      verificationUrl,
      expiresInMinutes: VERIFICATION_TOKEN_EXPIRY_MINUTES,
    });

    await sendEmail({
      to: email,
      subject: verificationTemplate.subject,
      text: verificationTemplate.text,
      html: verificationTemplate.html,
    });

    // Generate and send invoice for the staff contract — outside the main
    // transaction so a failed email does not roll back staff/contract creation.
    // Idempotent: reuses existing invoice if already present for this contract.
    // Errors are logged but do not fail the staff creation response.
    try {
      await createAndSendStaffContractInvoice({
        contract: createdContract,
        user: { ...createdUser, vatNumber },
      });
    } catch (invoiceErr) {
      console.error("[createIndependentStaff] staff invoice failed (non-blocking):", invoiceErr);
    }

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: `Le profil de ${fullName} a été créé avec succès. Les identifiants ont été envoyés par e-mail.`,
      staffId: staff.id,
    };
  } catch (error) {
    if (error?.code === "P2002") {
      const fields = error.meta?.target ?? [];

      if (fields.includes("email")) {
        return {
          success: false,
          message: "Cette adresse e-mail est déjà utilisée.",
          errors: { email: "Cette adresse e-mail est déjà utilisée." },
        };
      }
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

    console.error("[createIndependentStaff]", error);
    return {
      success: false,
      message: "Une erreur inattendue s'est produite. Veuillez réessayer.",
    };
  }
}
