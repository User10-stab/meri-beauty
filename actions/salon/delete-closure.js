"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";
import { deleteClosureSchema } from "@/lib/validations/salon";

export async function deleteClosure(input) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Permissions insuffisantes" };
  }

  const parsed = deleteClosureSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Identifiant manquant." };
  }

  try {
    const salon = await prisma.salon.findFirst();
    if (!salon) {
      return { success: false, message: "Aucun salon trouvé." };
    }

    await prisma.salonClosure.delete({ where: { id: parsed.data.id } });

    // Fetch updated closures
    const closures = await prisma.salonClosure.findMany({
      where: { salonId: salon.id },
      orderBy: { startDate: "desc" },
    });

    revalidatePath("/dashboard/settings");
    return {
      success: true,
      message: "Fermeture supprimée.",
      data: closures.map((c) => ({
        ...c,
        startDate: c.startDate.toISOString(),
        endDate: c.endDate?.toISOString() ?? null,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      })),
    };
  } catch (error) {
    if (error.code === "P2025") {
      return { success: false, message: "Cette fermeture n'existe plus." };
    }
    console.error("[deleteClosure]", error);
    return { success: false, message: "Une erreur est survenue." };
  }
}
