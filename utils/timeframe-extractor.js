export function createTimeFrameExtractor(
  selectedTimeFrame,
) {
  return (sectionKey) => {
    return selectedTimeFrame
      ?.split(",")
      .find((value) => value.includes(sectionKey));
  };
}
