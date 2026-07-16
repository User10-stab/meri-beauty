async function delay(ms = 300) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getPaymentsOverviewData(_timeFrame) {
  await delay();

  return {
    received: [
      { x: "Jan", y: 1200 },
      { x: "Feb", y: 1800 },
      { x: "Mar", y: 1500 },
      { x: "Apr", y: 2100 },
      { x: "May", y: 1900 },
      { x: "Jun", y: 2400 },
    ],
    due: [
      { x: "Jan", y: 800 },
      { x: "Feb", y: 1100 },
      { x: "Mar", y: 900 },
      { x: "Apr", y: 1300 },
      { x: "May", y: 1000 },
      { x: "Jun", y: 1500 },
    ],
  };
}

export async function getWeeksProfitData(_timeFrame) {
  await delay();

  return {
    sales: [
      { x: "Mon", y: 44 },
      { x: "Tue", y: 55 },
      { x: "Wed", y: 41 },
      { x: "Thu", y: 67 },
      { x: "Fri", y: 22 },
      { x: "Sat", y: 43 },
      { x: "Sun", y: 65 },
    ],
    revenue: [
      { x: "Mon", y: 13 },
      { x: "Tue", y: 23 },
      { x: "Wed", y: 20 },
      { x: "Thu", y: 8 },
      { x: "Fri", y: 13 },
      { x: "Sat", y: 27 },
      { x: "Sun", y: 15 },
    ],
  };
}

export async function getDevicesUsedData(_timeFrame) {
  await delay();

  return [
    { name: "Desktop", amount: 16224 },
    { name: "Tablet", amount: 4220 },
    { name: "Mobile", amount: 3456 },
    { name: "Unknown", amount: 987 },
  ];
}

export async function getCampaignVisitorsData() {
  await delay();

  return {
    total_visitors: 345678,
    performance: 0.43,
    chart: [
      { x: "M", y: 268 },
      { x: "T", y: 385 },
      { x: "W", y: 201 },
      { x: "T", y: 298 },
      { x: "F", y: 187 },
      { x: "S", y: 195 },
      { x: "S", y: 291 },
    ],
  };
}
