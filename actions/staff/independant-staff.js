"use server";

import { prisma } from "@/lib/prisma";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAdminRole } from "@/lib/authorization";

const VALID_LANGUAGES = ["ARABIC", "FRENCH", "ENGLISH"];

async function requireAdmin() {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) throw new Error("Acces non autorise.");
}

function normalizeLanguages(value) {
  return value
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean)
    .filter((item) => VALID_LANGUAGES.includes(item));
}

export async function createIndependentStaff(formData) {
  await requireAdmin();
  const userId = formData.get("userId")?.toString().trim();
  const bio = formData.get("bio")?.toString().trim() || null;
  const languages = normalizeLanguages(formData.get("languages")?.toString() || "");
  const isActive = formData.get("isActive") === "on";

  if (!userId) {
    throw new Error("Please select a user to attach to the staff profile.");
  }

  const existingProfile = await prisma.staff.findUnique({
    where: { userId },
    select: { id: true, isDeleted: true },
  });

  if (existingProfile && !existingProfile.isDeleted) {
    throw new Error("This user already has an active staff profile.");
  }

  await prisma.staff.create({
    data: {
      userId,
      type: "INDEPENDENT",
      bio,
      languages,
      isActive,
      isDeleted: false,
    },
  });

  revalidatePath("/dashboard/independent-staff");
  redirect("/dashboard/independent-staff");
}

export async function updateIndependentStaff(formData) {
  await requireAdmin();
  const id = formData.get("id")?.toString().trim();
  const bio = formData.get("bio")?.toString().trim() || null;
  const languages = normalizeLanguages(formData.get("languages")?.toString() || "");
  const isActive = formData.get("isActive") === "on";

  if (!id) {
    throw new Error("Missing staff profile identifier.");
  }

  const existing = await prisma.staff.findUnique({
    where: { id },
    select: { isDeleted: true },
  });

  if (!existing || existing.isDeleted) {
    throw new Error("Staff profile not found.");
  }

  await prisma.staff.update({
    where: { id },
    data: { bio, languages, isActive },
  });

  revalidatePath("/dashboard/independent-staff");
  redirect("/dashboard/independent-staff");
}

export async function deleteIndependentStaff(formData) {
  await requireAdmin();
  const id = formData.get("id")?.toString().trim();

  if (!id) {
    throw new Error("Missing staff profile identifier.");
  }

  const existing = await prisma.staff.findUnique({
    where: { id },
    select: { isDeleted: true, userId: true },
  });

  if (!existing || existing.isDeleted) {
    throw new Error("Staff profile not found.");
  }

  const now = new Date();

  await prisma.$transaction([
    prisma.staff.update({
      where: { id },
      data: { isActive: false, isDeleted: true, deletedAt: now },
    }),
    prisma.user.update({
      where: { id: existing.userId },
      data: { isActive: false, isDeleted: true, deletedAt: now },
    }),
    prisma.staffService.updateMany({
      where: { staffId: id, isActive: true },
      data: { isActive: false },
    }),
    prisma.contract.updateMany({
      where: { staffId: id, status: "ACTIVE" },
      data: { status: "TERMINATED" },
    }),
  ]);

  revalidatePath("/dashboard/independent-staff");
  redirect("/dashboard/independent-staff");
}
