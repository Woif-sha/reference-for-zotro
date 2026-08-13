export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function firstString(value: unknown): string | undefined {
  return asString(asArray(value)[0]);
}

export function isoYear(value: unknown): number | undefined {
  const number = asNumber(value);
  if (number && number >= 1000 && number <= 9999) return number;
  const string = asString(value);
  const match = string?.match(/^\d{4}/u);
  return match ? Number(match[0]) : undefined;
}
