const DAY_NAMES = {
  MONDAY: "Lundi",
  TUESDAY: "Mardi",
  WEDNESDAY: "Mercredi",
  THURSDAY: "Jeudi",
  FRIDAY: "Vendredi",
  SATURDAY: "Samedi",
  SUNDAY: "Dimanche",
};

export function groupWorkingDays(days) {
  if (!days?.length) return [];

  const order = [
    "MONDAY",
    "TUESDAY",
    "WEDNESDAY",
    "THURSDAY",
    "FRIDAY",
    "SATURDAY",
    "SUNDAY",
  ];

  const sorted = [...days].sort(
    (a, b) => order.indexOf(a.day) - order.indexOf(b.day)
  );

  const groups = [];

  for (const current of sorted) {
    const hours = current.isOpen
      ? `${current.openingTime} - ${current.closingTime}`
      : "Closed";

    const last = groups[groups.length - 1];

    if (last && last.hours === hours) {
      last.days.push(current.day);
    } else {
      groups.push({
        days: [current.day],
        hours,
      });
    }
  }

  return groups.map((group) => {
    const first = group.days[0];
    const last = group.days[group.days.length - 1];

    const label =
      group.days.length === 1
        ? DAY_NAMES[first]
        : `${DAY_NAMES[first]} - ${DAY_NAMES[last]}`;

    return {
      label,
      hours: group.hours === "Closed" ? "Fermé" : group.hours,
      isClosed: group.hours === "Closed",
    };
  });
}