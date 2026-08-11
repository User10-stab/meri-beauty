import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { ok, unauthorized, forbidden, notFound, serverError } from "@/lib/api-response";

export async function GET(request, { params }) {
  const session = await auth();
  if (!session?.user) {
    return unauthorized("Vous devez être connecté.");
  }

   // Await params to access its properties
   const resolvedParams = await params;
   
   // Users can only access their own data
   if (session.user.id !== resolvedParams.id) {
     return forbidden("Vous ne pouvez accéder qu'à vos propres données.");
   }

   try {
     const user = await prisma.user.findUnique({
       where: { id: resolvedParams.id },
       select: {
         id: true,
         email: true,
         fullName: true,
         phone: true,
         vatNumber: true,
         role: true,
         createdAt: true,
       },
     });

    if (!user) {
      return notFound("Utilisateur introuvable.");
    }

    return ok(user);
  } catch (error) {
    console.error("[GET /api/users/:id]", error);
    return serverError();
  }
}