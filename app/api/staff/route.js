import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
  const experts = await prisma.staff.findMany({
    where: {
      type: "INDEPENDENT",
      isDeleted: false,
      user: { isDeleted: false },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      photo: true,
      bio: true,
      yearsOfExperience: true,
      user: {
        select: {
          fullName: true,
          avatar: true,
        },
      },
    },
  });

  return NextResponse.json(
    experts.map((staff) => ({
      id: staff.id,
      name: staff.user.fullName,
      speciality: staff.bio ?? "Expertise beauté",
      experience: staff.yearsOfExperience ?? 0,
      rating: 4.9,
      image: staff.photo ?? staff.user.avatar ?? "/Images/expert.jpg",
    }))
  );
}