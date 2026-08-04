"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { getCurrentStaffId } from "@/lib/route-protection";

const REVALIDATE_PATH = "/dashboard/account-settings";

function generateToken() {
  return randomBytes(24).toString("hex");
}

/**
 * Returns the current staff member's calendar feed URL, generating a token
 * on first request. Idempotent — repeated calls return the same URL until
 * explicitly regenerated.
 */
export async function getOrCreateCalendarToken() {
  const staffId = await getCurrentStaffId();
  if (!staffId) return { success: false, message: "Profil staff introuvable." };

  try {
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { calendarToken: true } });
    if (staff.calendarToken) {
      return { success: true, token: staff.calendarToken };
    }

    const token = generateToken();
    await prisma.staff.update({ where: { id: staffId }, data: { calendarToken: token } });
    return { success: true, token };
  } catch (error) {
    console.error("[getOrCreateCalendarToken]", error);
    return { success: false, message: "Impossible de générer le lien du calendrier." };
  }
}

/**
 * Rotates the current staff member's calendar feed token — the old URL
 * stops working immediately. Use if a URL was shared/leaked accidentally.
 */
export async function regenerateCalendarToken() {
  const staffId = await getCurrentStaffId();
  if (!staffId) return { success: false, message: "Profil staff introuvable." };

  try {
    const token = generateToken();
    await prisma.staff.update({ where: { id: staffId }, data: { calendarToken: token } });
    revalidatePath(REVALIDATE_PATH);
    return { success: true, token };
  } catch (error) {
    console.error("[regenerateCalendarToken]", error);
    return { success: false, message: "Impossible de régénérer le lien du calendrier." };
  }
}
