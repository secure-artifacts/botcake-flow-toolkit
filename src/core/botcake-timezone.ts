export function toBotcakeTimezoneValue(value: number): string {
  if (!Number.isFinite(value) || value < -12 || value > 14) throw new Error("时区数值无效");
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

export function isSameBotcakeTimezone(current: unknown, target: number): boolean {
  return String(current ?? "").trim() === toBotcakeTimezoneValue(target);
}
