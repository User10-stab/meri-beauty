"use server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { isAdminRole } from "@/lib/authorization";

export async function listAuditLogs({ take = 100 } = {}) {
  const session = await auth();
  if (!session?.user || !isAdminRole(session.user.role)) {
    return { success: false, message: "Accès non autorisé.", data: [] };
  }

  const logs = await prisma.auditLog.findMany({
    take: Math.min(Math.max(Number(take) || 100, 1), 200),
    orderBy: { createdAt: "desc" },
    include: { actor: { select: { fullName: true, email: true } } },
  });
  return { success: true, data: logs };
}
