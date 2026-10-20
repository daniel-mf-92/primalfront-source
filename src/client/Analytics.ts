type AnalyticsValue = string | number | boolean;

type AnalyticsWindow = Window & {
  gtag?: (
    command: "event",
    eventName: string,
    params: Record<string, AnalyticsValue>,
  ) => void;
};

export function trackAnalyticsEvent(
  eventName: string,
  params: Record<string, AnalyticsValue | null | undefined> = {},
): void {
  if (typeof window === "undefined") return;

  const gtag = (window as AnalyticsWindow).gtag;
  if (typeof gtag !== "function") return;

  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(
      (entry): entry is [string, AnalyticsValue] =>
        entry[1] !== null && entry[1] !== undefined,
    ),
  );

  gtag("event", eventName, cleanParams);
}
