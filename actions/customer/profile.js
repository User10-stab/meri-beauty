"use server";

import bcrypt from "bcrypt";
import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
// Shared with the staff account-settings page (actions/staff/update-personal-info.js)
// — same rules (name/email/phone + optional password change, current password
// always required to confirm), nothing staff-specific in it.
import { updatePersonalInfoSchema } from "@/lib/validations/staff-settings";

const BCRYPT_SALT_ROUNDS = 12;

export async function getMyProfile() {
  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      fullName: true,
      email: true,
      phone: true,
      appointments: {
        where: { isDeleted: false },
        orderBy: { startTime: "desc" },
        select: {
          id: true,
          date: true,
          startTime: true,
          endTime: true,
          status: true,
          review: {
            select: {
              id: true,
              rating: true,
              comment: true,
              createdAt: true,
            },
          },
          staffService: {
            select: {
              service: { select: { name: true } },
              staff: {
                select: {
                  user: { select: { fullName: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!user) return { success: false, message: "Utilisateur introuvable." };

  return {
    success: true,
    data: {
      ...user,
      appointments: user.appointments.map((appointment) => ({
        ...appointment,
        date: appointment.date?.toISOString() ?? null,
        startTime: appointment.startTime?.toISOString() ?? null,
        endTime: appointment.endTime?.toISOString() ?? null,
        review: appointment.review
          ? {
              ...appointment.review,
              createdAt: appointment.review.createdAt?.toISOString() ?? null,
            }
          : null,
      })),
    },
  };
}

export async function updateMyProfile(input) {
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

  const session = await auth();
  if (!session?.user?.id) {
    return { success: false, message: "Vous devez être connecté(e)." };
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, fullName: true, email: true, phone: true, password: true },
    });
    if (!user) return { success: false, message: "Utilisateur introuvable." };

    const { fullName, email, phone, currentPassword, newPassword } = parsed.data;

    const passwordMatch = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatch) {
      return {
        success: false,
        message: "Le mot de passe actuel est incorrect.",
        errors: { currentPassword: "Mot de passe incorrect." },
      };
    }

    if (email && email !== user.email) {
      const emailExists = await prisma.user.findUnique({ where: { email } });
      if (emailExists) {
        return { success: false, message: "Cet email est déjà utilisé.", errors: { email: "Cet email est déjà utilisé." } };
      }
    }

    if (phone && phone !== user.phone) {
      const phoneExists = await prisma.user.findUnique({ where: { phone } });
      if (phoneExists) {
        return { success: false, message: "Ce numéro de téléphone est déjà utilisé.", errors: { phone: "Ce numéro est déjà utilisé." } };
      }
    }

    const updateData = {};
    if (fullName !== undefined) updateData.fullName = fullName;
    if (email !== undefined) updateData.email = email;
    if (phone !== undefined) updateData.phone = phone;
    if (newPassword) {
      updateData.password = await bcrypt.hash(newPassword, BCRYPT_SALT_ROUNDS);
      // Invalidates any other session logged in with the old password.
      updateData.sessionVersion = { increment: 1 };
    }

    if (Object.keys(updateData).length === 0) {
      return { success: false, message: "Aucune information à mettre à jour." };
    }

    await prisma.user.update({ where: { id: user.id }, data: updateData });

    revalidatePath("/profile");
    return { success: true, message: "Profil mis à jour avec succès." };
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
    console.error("[updateMyProfile]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
