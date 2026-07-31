"use client";

import { useEffect, useState } from "react";
import { getBookableServices } from "@/actions/reservation/get-bookable-services";
import { Clock } from "lucide-react";
import { toast } from "sonner";

export default function ServiceStep({ data, updateData, nextStep }) {
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);

  // Build a Set of service IDs already committed to the draft list so they
  // can be excluded from the selection. The rule is per-service, not per-staff.
  const draftedServiceIds = new Set(
    (data.appointmentDrafts ?? []).map((d) => d.service?.id).filter(Boolean)
  );

  useEffect(() => {
    if (data.category) {
      loadServices();
    }
  }, [data.category]);

  const loadServices = async () => {
    setLoading(true);
    const result = await getBookableServices(data.category.id);
    if (result.success) {
      setServices(result.data);
    } else {
      toast.error(result.message || "Erreur lors du chargement");
    }
    setLoading(false);
  };

  const handleSelectService = (service) => {
    updateData({ service, staff: null, staffService: null });
    nextStep();
  };

  if (loading) {
    return (
      <div className="flex min-h-[500px] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#C8A46A] border-t-transparent"></div>
      </div>
    );
  }

  // Services available for selection — exclude any already in the draft list
  const availableServices = services.filter((s) => !draftedServiceIds.has(s.id));

  if (availableServices.length === 0) {
    return (
      <div className="flex min-h-[500px] flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg text-gray-600">
          Aucun service disponible pour cette catégorie
        </p>
        {draftedServiceIds.size > 0 && (
          <p className="text-sm text-gray-400">
            Tous les services de cette catégorie ont déjà été ajoutés à votre réservation.
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">
          Sélectionnez un service
        </h2>
        <p className="mt-2 text-gray-600">
          {data.category?.name} • {availableServices.length} service{availableServices.length > 1 ? "s" : ""} disponible{availableServices.length > 1 ? "s" : ""}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {availableServices.map((service) => (
          <button
            key={service.id}
            onClick={() => handleSelectService(service)}
            className={`group relative overflow-hidden rounded-2xl border-2 text-left transition-all hover:shadow-lg ${
              data.service?.id === service.id
                ? "border-[#C8A46A] bg-[#C8A46A]/5"
                : "border-gray-200 hover:border-[#C8A46A]/50"
            }`}
          >
            <div className="p-4">
              <h3 className="text-lg font-semibold text-[#2F3A2E]">
                {service.name}
              </h3>
              {service.description && (
                <p className="mt-2 line-clamp-2 text-sm text-gray-600">
                  {service.description}
                </p>
              )}
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-1 text-sm text-gray-600">
                  <Clock size={16} />
                  <span>{service.durationRange}</span>
                </div>
                <div className="text-lg font-bold text-[#C8A46A]">
                  {service.priceRange}
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