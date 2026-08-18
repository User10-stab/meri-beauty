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

/**
 * Existing administrator accounts — so an admin can see who already has
 * access before adding another. Deliberately includes soft-deleted rows
 * (unlike most list actions in this codebase) so a deletion can be undone
 * from the same screen — without this, "Supprimer" would be a one-way door
 * back to needing CLI/server access, defeating the point of this feature.
 */
export async function listAdminAccounts() {
  const guard = await requireAdminAccountAccess();
  if (guard.error) return { success: false, message: guard.error, data: [] };

  const admins = await prisma.user.findMany({
    where: { role: { in: ["ADMIN", "OWNER"] } },
    orderBy: [{ role: "asc" }, { createdAt: "asc" }],
    select: { id: true, fullName: true, email: true, role: true, isActive: true, isDeleted: true, createdAt: true },
  });

  return { success: true, data: admins };
}

/**
 * Shared guards for every action that changes another admin's access
 * (deactivate/delete/reactivate). Two rules, both hard-blocks:
 *
 *  1. Nobody can act on their own account through this UI — prevents an
 *     accidental self-lockout with no one else to undo it.
 *  2. A plain ADMIN can never mutate an OWNER's account status, in either
 *     direction — mirrors createAdminAccount's "ADMIN can't grant OWNER"
 *     rule symmetrically. Only an OWNER can act on another OWNER.
 *
 * Returns the target user row (so callers don't re-fetch) or an error.
 */
async function loadMutationTarget(session, targetId) {
  if (targetId === session.user.id) {
    return { error: "Vous ne pouvez pas modifier votre propre statut depuis cet écran." };
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { id: true, fullName: true, role: true, isActive: true, isDeleted: true },
  });
  if (!target || !["ADMIN", "OWNER"].includes(target.role)) {
    return { error: "Compte administrateur introuvable." };
  }
  if (target.role === "OWNER" && session.user.role !== "OWNER") {
    return { error: "Seul un propriétaire peut modifier le statut d'un autre propriétaire." };
  }

  return { target };
}

/**
 * Blocks an action that would leave zero active admins — the hard safety
 * net behind the self-guard above. Counts every OTHER active, non-deleted
 * ADMIN/OWNER; the guard fires if that count is already zero (i.e. the
 * target being acted on is the last one standing).
 */
async function assertAnotherActiveAdminRemains(targetId) {
  const remaining = await prisma.user.count({
    where: { role: { in: ["ADMIN", "OWNER"] }, isActive: true, isDeleted: false, id: { not: targetId } },
  });
  if (remaining === 0) {
    return { error: "Impossible : il ne resterait plus aucun compte administrateur actif. Créez ou réactivez-en un autre d'abord." };
  }
  return {};
}

/** Reversible: blocks login, keeps the account visible (marked "Inactif") and instantly restorable. */
export async function deactivateAdminAccount(targetId) {
  const guard = await requireAdminAccountAccess();
  if (guard.error) return { success: false, message: guard.error };

  const targetCheck = await loadMutationTarget(guard.session, targetId);
  if (targetCheck.error) return { success: false, message: targetCheck.error };
  if (!targetCheck.target.isActive) {
    return { success: false, message: "Ce compte est déjà inactif." };
  }

  const remainingCheck = await assertAnotherActiveAdminRemains(targetId);
  if (remainingCheck.error) return { success: false, message: remainingCheck.error };

  await prisma.user.update({
    where: { id: targetId },
    // Auth.js compares the JWT's sessionVersion against the DB on every
    // session refresh. Without this bump, a deactivated admin could keep
    // using their existing JWT until the normal revalidation window elapsed.
    data: { isActive: false, sessionVersion: { increment: 1 } },
  });
  revalidatePath(REVALIDATE_PATH);
  return { success: true, message: `Le compte de ${targetCheck.target.fullName} a été désactivé.` };
}

/**
 * Soft-delete, matching the pattern used everywhere else in this codebase
 * (see deleteIndependentStaff) — never a hard SQL DELETE. History that
 * references this User (AuditLog.actorId, past Transactions, etc.) stays
 * intact; the row simply drops out of the active-admin count and is shown
 * as "Supprimé" instead of "Actif"/"Inactif", with a one-click restore.
 */
export async function deleteAdminAccount(targetId) {
  const guard = await requireAdminAccountAccess();
  if (guard.error) return { success: false, message: guard.error };

  const targetCheck = await loadMutationTarget(guard.session, targetId);
  if (targetCheck.error) return { success: false, message: targetCheck.error };
  if (targetCheck.target.isDeleted) {
    return { success: false, message: "Ce compte est déjà supprimé." };
  }

  const remainingCheck = await assertAnotherActiveAdminRemains(targetId);
  if (remainingCheck.error) return { success: false, message: remainingCheck.error };

  await prisma.user.update({
    where: { id: targetId },
    data: { isActive: false, isDeleted: true, deletedAt: new Date(), sessionVersion: { increment: 1 } },
  });
  revalidatePath(REVALIDATE_PATH);
  return { success: true, message: `Le compte de ${targetCheck.target.fullName} a été supprimé. Il peut être restauré à tout moment.` };
}

/**
 * Undoes either a deactivation or a deletion — always results in a fully
 * active account. No "last admin" guard needed here: this only ever adds
 * access back, it can't be the action that drops the count to zero.
 */
export async function reactivateAdminAccount(targetId) {
  const guard = await requireAdminAccountAccess();
  if (guard.error) return { success: false, message: guard.error };

  const targetCheck = await loadMutationTarget(guard.session, targetId);
  if (targetCheck.error) return { success: false, message: targetCheck.error };
  if (targetCheck.target.isActive && !targetCheck.target.isDeleted) {
    return { success: false, message: "Ce compte est déjà actif." };
  }

  await prisma.user.update({
    where: { id: targetId },
    data: { isActive: true, isDeleted: false, deletedAt: null },
  });
  revalidatePath(REVALIDATE_PATH);
  return { success: true, message: `Le compte de ${targetCheck.target.fullName} a été réactivé.` };
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
