"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcrypt";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";
import { updatePersonalInfoSchema } from "@/lib/validations/staff-settings";

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

    // Check unique constraints for email and phone if they are being changed
    if (email && email !== user.email) {
      const emailExists = await prisma.user.findUnique({ where: { email } });
      if (emailExists) {
        return {
          success: false,
          message: "Cet email est déjà utilisé.",
          errors: { email: "Cet email est déjà utilisé." },
        };
      }
    }

    if (phone && phone !== user.phone) {
      const phoneExists = await prisma.user.findUnique({ where: { phone } });
      if (phoneExists) {
        return {
          success: false,
          message: "Ce numéro de téléphone est déjà utilisé.",
          errors: { phone: "Ce numéro est déjà utilisé." },
        };
      }
    }

    // Build update data
    const updateData = {};

    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;

    if (newPassword) {
      updateData.password = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
    }

    if (Object.keys(updateData).length === 0) {
      return { success: false, message: "Aucune information à mettre à jour." };
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    revalidatePath(REVALIDATE_PATH);

    return { success: true, message: "Informations personnelles mises à jour avec succès." };
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
