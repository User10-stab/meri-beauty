"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcrypt";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";
import { updatePersonalInfoSchema } from "@/lib/validations/staff-settings";
import { sendVerificationEmail } from "@/actions/auth/verify-email";

const BCRYPT_SALT_ROUNDS = 12;
const REVALIDATE_PATH = "/dashboard/account-settings";

export async function updatePersonalInfo(input) {
  const parsed = updatePersonalInfoSchema.safeParse(input);

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs.",
      errors: {
        fullName: fe.fullName?.[0] ?? null,
        email: fe.email?.[0] ?? null,
        phone: fe.phone?.[0] ?? null,
        currentPassword: fe.currentPassword?.[0] ?? null,
        newPassword: fe.newPassword?.[0] ?? null,
      },
    };
  }

  try {
    const session = await auth();

    if (!session?.user || session.user.role !== ROLES.STAFF) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    // Load the user with their current password hash
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        fullName: true,
        email: true,
        phone: true,
        password: true,
      },
    });

    if (!user) {
      return { success: false, message: "Utilisateur introuvable." };
    }

    const { fullName, email, phone, currentPassword, newPassword } = parsed.data;

    // Verify current password
    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
      return {
        success: false,
        message: "Le mot de passe actuel est incorrect.",
        errors: { currentPassword: "Mot de passe incorrect." },
      };
    }

    // Check unique constraints for email and phone if they are being changed.
    // Ignore soft-deleted users so a deleted account can be re-created cleanly.
    if (email && email !== user.email) {
      const emailExists = await prisma.user.findFirst({
        where: { email, isDeleted: false },
        select: { id: true },
      });
      if (emailExists) {
        return {
          success: false,
          message: "Cet email est déjà utilisé.",
          errors: { email: "Cet email est déjà utilisé." },
        };
      }
    }

    if (phone && phone !== user.phone) {
      const phoneExists = await prisma.user.findFirst({
        where: { phone, isDeleted: false },
        select: { id: true },
      });
      if (phoneExists) {
        return {
          success: false,
          message: "Ce numéro de téléphone est déjà utilisé.",
          errors: { phone: "Ce numéro est déjà utilisé." },
        };
      }
    }

    const emailChanged = email !== undefined && email !== user.email;

    // Build update data
    const updateData = {};

    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;

    if (newPassword) {
      updateData.password = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
      // Invalidates any other session logged in with the old password.
      updateData.sessionVersion = { increment: 1 };
    }
    if (emailChanged) {
      // Same rule as the customer profile update (actions/customer/profile.js)
      // — an unproven new address must not inherit the account's verified
      // status, or its real owner (if it isn't this staff member) could
      // reset-password their way in later treating it as confirmed.
      updateData.emailVerified = false;
    }

    if (Object.keys(updateData).length === 0) {
      return { success: false, message: "Aucune information à mettre à jour." };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    if (emailChanged) {
      sendVerificationEmail({ email, fullName: fullName ?? user.fullName }).catch((err) =>
        console.error("[updatePersonalInfo] verification email failed:", err)
      );
    }

    revalidatePath(REVALIDATE_PATH);

    return {
      success: true,
      message: emailChanged
        ? "Informations mises à jour avec succès. Vérifiez votre boîte mail pour confirmer votre nouvelle adresse."
        : "Informations personnelles mises à jour avec succès.",
    };
  } catch (error) {
    if (error?.code === "P2002") {
      const target = error.meta?.target;
      if (target?.includes("email")) {
        return { success: false, message: "Cet email est déjà utilisé.", errors: { email: "Cet email est déjà utilisé." } };
      }
      if (target?.includes("phone")) {
        return { success: false, message: "Ce numéro de téléphone est déjà utilisé.", errors: { phone: "Ce numéro est déjà utilisé." } };
      }
    }

    console.error("[updatePersonalInfo]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
