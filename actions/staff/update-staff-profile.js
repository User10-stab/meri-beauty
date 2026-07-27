"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { ROLES } from "@/lib/authorization";
import { updateStaffProfileSchema } from "@/lib/validations/staff-settings";

const REVALIDATE_PATH = "/dashboard/account-settings";

export async function updateStaffProfile(input) {
  const parsed = updateStaffProfileSchema.safeParse(input);

  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs.",
      errors: {
        photo: fe.photo?.[0] ?? null,
        bio: fe.bio?.[0] ?? null,
        languages: fe.languages?.[0] ?? null,
        yearsOfExperience: fe.yearsOfExperience?.[0] ?? null,
      },
    };
  }

  try {
    const session = await auth();

    if (!session?.user || session.user.role !== ROLES.STAFF) {
      return { success: false, message: "Permissions insuffisantes" };
    }

    const { photo, bio, languages, yearsOfExperience } = parsed.data;

    await prisma.staff.update({
      where: { userId: session.user.id },
      data: {
        ...(photo !== undefined ? { photo } : {}),
        ...(bio !== undefined ? { bio } : {}),
        ...(languages !== undefined ? { languages } : {}),
        ...(yearsOfExperience !== undefined ? { yearsOfExperience } : {}),
      },
    });

    revalidatePath(REVALIDATE_PATH);

    return { success: true, message: "Profil mis à jour avec succès." };
  } catch (error) {
    console.error("[updateStaffProfile]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
