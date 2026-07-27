"use client";

import { useEffect, useState } from "react";
import { getBookableCategories } from "@/actions/reservation/get-bookable-categories";
import { Sparkles } from "lucide-react";
import toast from "react-hot-toast";

export default function CategoryStep({ data, updateData, nextStep }) {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadCategories();
  }, []);

  const loadCategories = async () => {
    setLoading(true);
    const result = await getBookableCategories();
    if (result.success) {
      setCategories(result.data);
    } else {
      toast.error(result.message || "Erreur lors du chargement");
    }
    setLoading(false);
  };

  const handleSelectCategory = (category) => {
    updateData({ category, service: null, staff: null, staffService: null });
    nextStep();
  };

  if (loading) {
    return (
      <div className="flex min-h-[500px] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-[#C8A46A] border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">
          Choisissez une catégorie
        </h2>
        <p className="mt-2 text-gray-600">
          Sélectionnez le type de service dont vous avez besoin
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {categories.map((category) => (
          <button
            key={category.id}
            onClick={() => handleSelectCategory(category)}
            className={`group relative overflow-hidden rounded-2xl border-2 p-6 text-left transition-all hover:shadow-lg ${
              data.category?.id === category.id
                ? "border-[#C8A46A] bg-[#C8A46A]/5"
                : "border-gray-200 hover:border-[#C8A46A]/50"
            }`}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Sparkles
                    size={20}
                    className={`${
                      data.category?.id === category.id
                        ? "text-[#C8A46A]"
                        : "text-gray-400 group-hover:text-[#C8A46A]"
                    }`}
                  />
                  <h3 className="text-lg font-semibold text-[#2F3A2E]">
                    {category.name}
                  </h3>
                </div>
                {category.description && (
                  <p className="mt-2 text-sm text-gray-600">
                    {category.description}
                  </p>
                )}
                <p className="mt-3 text-xs font-medium text-[#C8A46A]">
                  {category.servicesCount} service{category.servicesCount > 1 ? "s" : ""} disponible{category.servicesCount > 1 ? "s" : ""}
                </p>
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