"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { createClosureSchema } from "@/lib/validations/salon";

export async function createClosure(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = createClosureSchema.safeParse(input);
  if (!parsed.success) {
    const fe = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Veuillez corriger les erreurs.",
      errors: Object.fromEntries(
        Object.entries(fe).map(([k, v]) => [k, v?.[0] ?? null]),
      ),
    };
  }

  try {
    const salon = await prisma.salon.findFirst();
    if (!salon) {
      return { success: false, message: "Aucun salon trouvé." };
    }

    await prisma.salonClosure.create({
      data: {
        salonId: salon.id,
        title: parsed.data.title,
        startDate: new Date(parsed.data.startDate),
        endDate: parsed.data.endDate ? new Date(parsed.data.endDate) : null,
        isFullDay: parsed.data.isFullDay,
        openingTime: parsed.data.isFullDay ? null : (parsed.data.openingTime ?? null),
        closingTime: parsed.data.isFullDay ? null : (parsed.data.closingTime ?? null),
      },
    });

    // Fetch updated closures
    const closures = await prisma.salonClosure.findMany({
      where: { salonId: salon.id },
      orderBy: { startDate: "desc" },
    });

    revalidatePath("/dashboard/settings");
    return {
      success: true,
      message: "Fermeture ajoutée avec succès.",
      data: closures.map((c) => ({
        ...c,
        startDate: c.startDate.toISOString(),
        endDate: c.endDate?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    console.error("[createClosure]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
