import { prisma } from "@/lib/prisma";

export async function GET(req, { params }) {
  const { id } = await params;

  try {
    const reservation = await prisma.formationReservation.findUnique({
      where: { id },
      include: {
        session: {
          include: { formation: true },
        },
      },
    });

    if (!reservation) {
      return Response.json({ error: "Not found" }, { status: 404 });
    }

    return Response.json(reservation);
  } catch {
    return Response.json({ error: "Server error" }, { status: 500 });
  }
}
