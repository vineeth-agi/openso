/**
 * Cron utilities — pure-JS expression parsing and formatting helpers.
 *
 * SAFE FOR CLIENT BUNDLES. Auth verification (which uses node:crypto) lives
 * in `@/lib/cron-auth` so that this module can be imported from client
 * components without pulling node-specific APIs into the browser.
 */

// ── Cron expression parsing ──

/**
 * Compute the next run time from a cron expression.
 * @param cronExpression - Standard 5-field cron expression (e.g., "0 9 * * 1")
 * @param from - Base date to compute from (defaults to now)
 * @returns Next run Date
 */
export function computeNextRunAt(
  cronExpression: string,
  from: Date = new Date(),
): Date {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length < 5) {
    // Invalid or simple interval — default to +1 hour
    return new Date(from.getTime() + 60 * 60 * 1000);
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const next = new Date(from);
  // Always work in UTC — cron expressions are stored in UTC.
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(next.getUTCMinutes() + 1);

  const maxAttempts = 48 * 60;
  for (let i = 0; i < maxAttempts; i++) {
    if (
      matchesCronField(minute!, next.getUTCMinutes()) &&
      matchesCronField(hour!, next.getUTCHours()) &&
      matchesCronField(dayOfMonth!, next.getUTCDate()) &&
      matchesCronField(month!, next.getUTCMonth() + 1) &&
      matchesCronField(dayOfWeek!, next.getUTCDay())
    ) {
      return next;
    }
    next.setUTCMinutes(next.getUTCMinutes() + 1);
  }

  return new Date(from.getTime() + 60 * 60 * 1000);
}

function matchesCronField(field: string, value: number): boolean {
  if (field === "*") return true;

  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return !isNaN(step) && step > 0 && value % step === 0;
  }

  if (field.includes(",")) {
    return field.split(",").some((v) => parseInt(v, 10) === value);
  }

  if (field.includes("-")) {
    const [start, end] = field.split("-").map((v) => parseInt(v, 10));
    return !isNaN(start!) && !isNaN(end!) && value >= start! && value <= end!;
  }

  return parseInt(field, 10) === value;
}

/**
 * Convert a cron expression to a human-readable string.
 */
export function cronToHuman(cronExpression: string): string {
  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length < 5) return cronExpression;

  const [minute, hour, dom, month, dow] = parts;

  if (minute === "*" && hour === "*") return "Every minute";
  if (minute?.startsWith("*/")) return `Every ${minute.slice(2)} minutes`;
  if (hour === "*" && minute !== "*") return `Every hour at :${minute!.padStart(2, "0")}`;

  const timeStr = `${hour!.padStart(2, "0")}:${minute!.padStart(2, "0")}`;

  if (dom === "*" && month === "*" && dow === "*") return `Daily at ${timeStr}`;
  if (dow === "1-5" || dow === "1,2,3,4,5") return `Weekdays at ${timeStr}`;
  if (dow === "0,6") return `Weekends at ${timeStr}`;

  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  if (dow !== "*" && dom === "*" && month === "*") {
    const dayNum = parseInt(dow, 10);
    const dayName = !isNaN(dayNum) && dayNum >= 0 && dayNum <= 6 ? days[dayNum] : dow;
    return `Every ${dayName} at ${timeStr}`;
  }

  return `${cronExpression} (${timeStr})`;
}

/**
 * Validate a cron expression (basic check).
 */
export function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/);
  return parts.length === 5 && parts.every((p) => /^[\d*,\-/]+$/.test(p));
}
