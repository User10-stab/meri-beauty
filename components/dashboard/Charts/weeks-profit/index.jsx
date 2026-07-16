import { PeriodPicker } from "@/components/dashboard/period-picker";
import { cn } from "@/lib/utils";
import { getWeeksProfitData } from "@/services/charts.services";
import { WeeksProfitChart } from "./chart";

export async function WeeksProfit({ className, timeFrame }) {
  const data = await getWeeksProfitData(timeFrame);

  return (
    <div
      className={cn(
        "rounded-[10px] bg-white px-7.5 pt-7.5 shadow-1 dark:bg-gray-dark dark:shadow-card",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h2 className="text-body-2xlg font-bold text-dark dark:text-white">
          Profit {timeFrame || "this week"}
        </h2>

        <PeriodPicker
          items={["this week", "last week"]}
          defaultValue={timeFrame || "this week"}
          sectionKey="weeks_profit"
        />
      </div>

      <WeeksProfitChart data={data} />
    </div>
  );
}
