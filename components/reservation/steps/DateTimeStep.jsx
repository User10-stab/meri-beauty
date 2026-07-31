"use client";

import { useEffect, useState } from "react";
import { getAvailableSlots, getMonthAvailability } from "@/actions/reservation/get-available-slots";
import { ChevronLeft, ChevronRight, Calendar, Clock } from "lucide-react";
import { toast } from "sonner";

const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const DAYS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

export default function DateTimeStep({ data, updateData, nextStep }) {
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(data.date || null);
  const [selectedTime, setSelectedTime] = useState(data.time || null);
  const [availableSlots, setAvailableSlots] = useState([]);
  const [disabledDates, setDisabledDates] = useState(new Set());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selectedDate && data.staffService) {
      loadAvailableSlots();
    }
  }, [selectedDate, data.staffService]);

  useEffect(() => {
    if (!data.staffService?.id) return;

    const loadMonthAvailability = async () => {
      const result = await getMonthAvailability(data.staffService.id, currentMonth);
      if (result.success) {
        setDisabledDates(new Set(result.data.unavailableDates || []));
      }
    };

    loadMonthAvailability();
  }, [currentMonth, data.staffService?.id]);

  const loadAvailableSlots = async () => {
    setLoading(true);
    const result = await getAvailableSlots(data.staffService.id, selectedDate);
    if (result.success) {
      setAvailableSlots(result.data.slots || []);
      if (!result.data.isWorkingDay && result.data.reason) {
        const errorMessages = {
          "Staff not available": "Le membre du personnel n'est pas disponible",
          "User deleted": "Le compte a été supprimé",
          "No working hours configured": "Aucun horaire de travail configuré",
          "No active contract": "Aucun contrat actif",
          "Contract has not started yet": "Le contrat n'a pas encore commencé",
          "Contract has expired": "Le contrat a expiré",
          "Salon closed this day": "Le salon est fermé ce jour",
          "Staff not working this day": "Le membre du personnel ne travaille pas ce jour",
          "Staff on time off": "Le membre du personnel est en congé",
          "Salon closure": "Le salon est fermé (exception)",
        };
        toast.error(errorMessages[result.data.reason] || "Ce jour n'est pas disponible");
      } else if (!result.data.isWorkingDay) {
        toast.error("Ce jour n'est pas disponible");
      }
    } else {
      toast.error(result.message || "Erreur lors du chargement");
      setAvailableSlots([]);
    }
    setLoading(false);
  };

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();

    const days = [];
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    // Add days of the month
    for (let i = 1; i <= daysInMonth; i++) {
      days.push(new Date(year, month, i));
    }
    return days;
  };

  const getDateKey = (date) => {
    if (!date) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };

  const isDateDisabled = (date) => {
    if (!date) return true;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (date < today) return true;
    return disabledDates.has(getDateKey(date));
  };

  const isSameDay = (date1, date2) => {
    if (!date1 || !date2) return false;
    return (
      date1.getFullYear() === date2.getFullYear() &&
      date1.getMonth() === date2.getMonth() &&
      date1.getDate() === date2.getDate()
    );
  };

  const handleDateSelect = (date) => {
    if (isDateDisabled(date)) return;
    setSelectedDate(date);
    setSelectedTime(null);
    updateData({ date, time: null });
  };

  const handleTimeSelect = (time) => {
    setSelectedTime(time);
    updateData({ time });
  };

  const handleConfirm = () => {
    if (!selectedDate || !selectedTime) {
      toast.error("Veuillez sélectionner une date et une heure");
      return;
    }
    nextStep();
  };

  const previousMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1)
    );
  };

  const nextMonth = () => {
    setCurrentMonth(
      new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1)
    );
  };

  const days = getDaysInMonth(currentMonth);

  return (
    <div>
      <div className="mb-8 text-center">
        <h2 className="text-3xl font-bold text-[#2F3A2E]">
          Choisissez une date et une heure
        </h2>
        <p className="mt-2 text-gray-600">
          {data.staffService?.staff.user.fullName} • {data.service?.name}
        </p>
      </div>

      <div className="mx-auto grid max-w-5xl gap-8 lg:grid-cols-2">
        {/* Calendar */}
        <div className="rounded-2xl border-2 border-gray-200 p-6">
          <div className="mb-6 flex items-center justify-between">
            <button
              onClick={previousMonth}
              className="rounded-lg p-2 hover:bg-gray-100"
            >
              <ChevronLeft size={20} />
            </button>
            <h3 className="text-xl font-semibold text-[#2F3A2E]">
              {MONTHS[currentMonth.getMonth()]} {currentMonth.getFullYear()}
            </h3>
            <button
              onClick={nextMonth}
              className="rounded-lg p-2 hover:bg-gray-100"
            >
              <ChevronRight size={20} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-2">
            {DAYS.map((day) => (
              <div
                key={day}
                className="text-center text-sm font-semibold text-gray-600"
              >
                {day}
              </div>
            ))}
            {days.map((day, index) => (
              <button
                key={index}
                onClick={() => day && handleDateSelect(day)}
                disabled={isDateDisabled(day)}
                className={`aspect-square rounded-lg border text-sm font-medium transition-all ${
                  !day
                    ? "invisible"
                    : isDateDisabled(day)
                    ? "cursor-not-allowed border-red-200 bg-red-50 text-red-500"
                    : isSameDay(day, selectedDate)
                    ? "border-[#C8A46A] bg-[#C8A46A] text-white"
                    : "border-transparent bg-white text-[#2F3A2E] hover:border-[#C8A46A]/40 hover:bg-[#C8A46A]/10"
                }`}
              >
                {day ? day.getDate() : ""}
              </button>
            ))}
          </div>

          <div className="mt-4 flex items-center gap-2 text-xs text-gray-500">
            <span className="inline-flex h-3 w-3 rounded-full border border-red-200 bg-red-50" />
            <span>Dates indisponibles</span>
          </div>

          {selectedDate && (
            <div className="mt-6 flex items-center gap-2 rounded-lg bg-[#C8A46A]/10 p-3 text-sm">
              <Calendar size={18} className="text-[#C8A46A]" />
              <span className="font-medium text-[#2F3A2E]">
                {selectedDate.toLocaleDateString("fr-FR", {
                  weekday: "long",
                  year: "numeric",
                  month: "long",
                  day: "numeric",
                })}
              </span>
            </div>
          )}
        </div>

        {/* Time Slots */}
        <div className="rounded-2xl border-2 border-gray-200 p-6">
          <h3 className="mb-6 text-xl font-semibold text-[#2F3A2E]">
            Créneaux disponibles
          </h3>

          {!selectedDate ? (
            <div className="flex h-64 items-center justify-center text-gray-500">
              Sélectionnez d'abord une date
            </div>
          ) : loading ? (
            <div className="flex h-64 items-center justify-center">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-[#C8A46A] border-t-transparent"></div>
            </div>
          ) : availableSlots.length === 0 ? (
            <div className="flex h-64 items-center justify-center text-gray-500">
              Aucun créneau disponible ce jour
            </div>
          ) : (
            <div className="grid max-h-96 grid-cols-2 gap-3 overflow-y-auto">
              {availableSlots.map((slot) => (
                <button
                  key={slot.time}
                  onClick={() => slot.available && handleTimeSelect(slot.time)}
                  disabled={!slot.available}
                  className={`rounded-lg p-3 text-sm font-medium transition-all ${
                    !slot.available
                      ? "cursor-not-allowed bg-gray-100 text-gray-400"
                      : selectedTime === slot.time
                      ? "bg-[#C8A46A] text-white"
                      : "bg-white border-2 border-gray-200 hover:border-[#C8A46A] text-[#2F3A2E]"
                  }`}
                >
                  <Clock size={16} className="mx-auto mb-1" />
                  {slot.time}
                </button>
              ))}
            </div>
          )}

          {selectedTime && (
            <button
              onClick={handleConfirm}
              className="mt-6 w-full rounded-lg bg-[#C8A46A] px-6 py-3 text-sm font-semibold text-white transition-all hover:bg-[#B8945A]"
            >
              Confirmer l'horaire
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
