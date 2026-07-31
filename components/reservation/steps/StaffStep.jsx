"use client";

import { useEffect, useState } from "react";
import { getStaffByService } from "@/actions/reservation/get-staff-by-service";
import { Star, Clock, Euro } from "lucide-react";
import toast from "react-hot-toast";
import Image from "next/image";

export default function StaffStep({ data, updateData, nextStep }) {
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (data.service) {
      loadStaff();
    }
  }, [data.service]);

  const loadStaff = async () => {
    setLoading(true);
    const result = await getStaffByService(data.service.id);
    if (result.success) {
      setStaffList(result.data);
    } else {
      toast.error(result.message || "Erreur lors du chargement");
    }
    setLoading(false);
  };

  const handleSelectStaff = (staffService) => {
    // Store the selection in shared state (for display purposes in other steps),
    // then immediately call nextStep with the selected staffService so the
    // parent can build the draft without reading stale state.
    updateData({
      staff:        staffService.staff,
      staffService,
      date:         null,
      time:         null,
    });
    nextStep(staffService);
  };

  if (loading) {
    return (
      <div className="flex min-h-[500px] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#C8A46A] border-t-transparent"></div>
      </div>
    );
  }

  if (staffList.length === 0) {
    return (
      <div className="flex min-h-[500px] flex-col items-center justify-center">
        <p className="text-lg text-gray-600">
          Aucune experte disponible pour ce service
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">
          Choisissez votre experte
        </h2>
        <p className="mt-2 text-gray-600">
          {data.service?.name} • {staffList.length} experte{staffList.length > 1 ? "s" : ""} disponible{staffList.length > 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {staffList.map((staffService) => (
          <button
            key={staffService.id}
            onClick={() => handleSelectStaff(staffService)}
            className={`group relative overflow-hidden rounded-2xl border-2 text-left transition-all hover:shadow-xl ${
              data.staffService?.id === staffService.id
                ? "border-[#C8A46A] bg-[#C8A46A]/5"
                : "border-gray-200 hover:border-[#C8A46A]/50"
            }`}
          >
            <div className="p-5">
              {/* Staff Photo */}
              <div className="mb-4 flex justify-center">
                <div className="relative h-24 w-24 overflow-hidden rounded-full border-4 border-white shadow-lg">
                  {staffService.staff.photo ? (
                    <Image
                      src={staffService.staff.photo}
                      alt={staffService.staff.user.fullName}
                      fill
                      className="object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-[#C8A46A] to-[#B8945A] text-2xl font-bold text-white">
                      {staffService.staff.user.fullName.charAt(0)}
                    </div>
                  )}
                </div>
              </div>

              {/* Staff Info */}
              <div className="text-center">
                <h3 className="text-xl font-semibold text-[#2F3A2E]">
                  {staffService.staff.user.fullName}
                </h3>

                {/* Rating */}
                {staffService.avgRating > 0 && (
                  <div className="mt-2 flex items-center justify-center gap-1">
                    <Star size={16} className="fill-[#C8A46A] text-[#C8A46A]" />
                    <span className="text-sm font-semibold text-[#2F3A2E]">
                      {staffService.avgRating.toFixed(1)}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({staffService.reviewCount} avis)
                    </span>
                  </div>
                )}

                {/* Languages */}
                {staffService.staff.languages &&
                  staffService.staff.languages.length > 0 && (
                    <p className="mt-2 text-xs text-gray-600">
                      {staffService.staff.languages.join(", ")}
                    </p>
                  )}

                {/* Bio */}
                {staffService.staff.bio && (
                  <p className="mt-3 line-clamp-2 text-sm text-gray-600">
                    {staffService.staff.bio}
                  </p>
                )}

                {/* Service Details */}
                <div className="mt-4 space-y-2 border-t pt-4">
                  <div className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-1 text-gray-600">
                      <Clock size={16} />
                      <span>{staffService.duration} min</span>
                    </div>
                    <div className="flex items-center gap-1 text-xl font-bold text-[#C8A46A]">
                      <Euro size={20} />
                      <span>{staffService.price.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Animated background */}
            <div className="absolute inset-0 -z-10 bg-gradient-to-br from-[#C8A46A]/10 to-transparent opacity-0 transition-opacity group-hover:opacity-100" />
          </button>
        ))}
      </div>
    </div>
  );
}
