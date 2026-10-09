export function formatDhanChartDateTime(value, fallbackTime) {
  const [date, requestedTime] = String(value ?? "").trim().split(/\s+/);
  const time = requestedTime || fallbackTime;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^\d{2}:\d{2}(?::\d{2})?$/.test(time || "")) {
    throw new Error("Dhan chart dates must use YYYY-MM-DD or YYYY-MM-DD HH:mm[:ss].");
  }

  const normalizedTime = time.length === 5 ? `${time}:00` : time;
  const parsed = new Date(`${date}T${normalizedTime}Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error("Dhan chart dates must contain a valid calendar date and time.");
  }

  return `${date} ${normalizedTime}`;
}
