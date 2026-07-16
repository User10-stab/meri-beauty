import { z } from "zod";

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

const singleDaySchema = z
  .object({
    day: z.enum([
      "MONDAY",
      "TUESDAY",
      "WEDNESDAY",
      "THURSDAY",
      "FRIDAY",
      "SATURDAY",
      "SUNDAY",
    ]),
    startTime: z.string().trim(),
    endTime: z.string().trim(),
    isClosed: z.boolean(),
  })
  .refine(
    (data) => {
      if (data.isClosed) return true;
      if (!TIME_REGEX.test(data.startTime) || !TIME_REGEX.test(data.endTime)) {
        return false;
      }
      return data.startTime < data.endTime;
    },
    {
      message:
        "L'heure de début doit être antérieure à l'heure de fin.",
      path: ["startTime"],
    }
  );

export const workingHoursSchema = z.object({
  staffId: z.string().trim().min(1, "Le professionnel est obligatoire."),
  days: z
    .array(singleDaySchema)
    .length(7, "Les 7 jours de la semaine sont obligatoires."),
});