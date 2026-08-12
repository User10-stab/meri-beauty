"use server";

import bcrypt from "bcrypt";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { sendEmail } from "@/lib/email";
import { generateSecurePassword } from "@/lib/generate-password";
import { createAdminAccountSchema } from "@/lib/validations/admin-account";

const BCRYPT_SALT_ROUNDS = 12;
const REVALIDATE_PATH = "/dashboard/settings";

async function requireAdminAccountAccess() {
  const session = await auth();
  if (!session?.user) return { error: "Non authentifié." };
  if (!isAdminRole(session.user.role)) return { error: "Accès non autorisé." };
  return { session };
}

function buildWelcomeEmail({ fullName, email, password, loginUrl }) {
  const text = [
    `Bonjour ${fullName},`,
    ``,
    `Un compte administrateur Meri Beauty a été créé pour vous.`,
    ``,
    `Vos identifiants de connexion :`,
    `  E-mail       : ${email}`,
    `  Mot de passe : ${password}`,
    ``,
    `Connectez-vous ici : ${loginUrl}`,
    ``,
    `Pour des raisons de sécurité, changez ce mot de passe dès votre première connexion.`,
    ``,
    `L'équipe Meri Beauty`,
  ].join("\n");

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px;border:1px solid #eaeaea;border-radius:12px;background:#fff;">
      <h2 style="color:#2F3A2E;font-family:serif;margin-bottom:8px;">Accès administrateur — Meri Beauty</h2>
      <p style="font-size:15px;color:#404040;">Bonjour <strong>${fullName}</strong>,</p>
      <p style="font-size:14px;color:#525252;line-height:1.6;">
        Un compte administrateur a été créé pour vous. Voici vos identifiants de connexion :
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
        Pour des raisons de sécurité, changez ce mot de passe dès votre première connexion.
      </p>
    </div>
  `;

  return { text, html };
}

/** Existing administrator accounts — so an admin can see who already has access before adding another. */
export async function listAdminAccounts() {
  const guard = await requireAdminAccountAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "OWNER"] }, isDeleted: false },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true, fullName: true, email: true, role: true, isActive: true, createdAt: true },
  });

  return { success: true, data: admins };
}

/**
 * Creates a new ADMIN account. Only an existing ADMIN/OWNER can call this —
 * there is deliberately no public/self-service path to mint an admin.
 *
 * Always creates role "ADMIN", never "OWNER" — OWNER is the founder-level
 * role and isn't something one admin should be able to grant to another
 * through this form.
 *
 * Mirrors createIndependentStaff's onboarding pattern (actions/staff/
 * create-independent-staff.js): a random password is generated, hashed, and
 * emailed directly to the new admin rather than routed through a
 * set-your-password token flow. emailVerified is set true immediately —
 * unlike self-registration, the email address here is vouched for by the
 * admin creating the account, and ADMIN/OWNER login isn't gated on
 * emailVerified anyway (see auth.js).
 */
export async function createAdminAccount(input) {
  const guard = await requireAdminAccountAccess();
  if (guard.error) return { success: false, message: guard.error };

  const parsed = createAdminAccountSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs du formulaire.",
      errors: { fullName: fe.fullName?.[0] ?? null, email: fe.email?.[0] ?? null },
    };
  }

  const { fullName, email } = parsed.data;
  const plainPassword = generateSecurePassword();
  const hashedPassword = await bcrypt.hash(plainPassword, BCRYPT_SALT_ROUNDS);

  try {
    const admin = await prisma.user.create({
      data: {
        fullName,
        email,
        password: hashedPassword,
        role: "ADMIN",
        emailVerified: true,
        isActive: true,
      },
      select: { id: true, fullName: true, email: true, role: true, isActive: true, createdAt: true },
    });

    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
    const { text, html } = buildWelcomeEmail({
      fullName,
      email,
      password: plainPassword,
      loginUrl: `${baseUrl}/login`,
    });

    const emailResult = await sendEmail({
      to: email,
      subject: "Votre accès administrateur — Meri Beauty",
      text,
      html,
    });

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: emailResult?.success
        ? `Compte administrateur créé pour ${fullName}. Les identifiants ont été envoyés à ${email}.`
        : `Compte administrateur créé pour ${fullName}, mais l'e-mail n'a pas pu être envoyé. Vérifiez la configuration e-mail et transmettez les identifiants manuellement.`,
      data: admin,
      emailSent: Boolean(emailResult?.success),
      // Only surfaced when the email failed — the one case where the plain
      // password needs to reach the caller so staff can hand it over another
      // way. Never returned on the happy path.
      temporaryPassword: emailResult?.success ? undefined : plainPassword,
    };
  } catch (error) {
    if (error?.code === "P2002" && error.meta?.target?.includes?.("email")) {
      return {
        success: false,
        message: "Cette adresse e-mail est déjà utilisée par un autre compte.",
        errors: { email: "Cette adresse e-mail est déjà utilisée." },
      };
    }
    console.error("[createAdminAccount]", error);
    return { success: false, message: "Une erreur inattendue s'est produite. Veuillez réessayer." };
  }
}
