// Currency helpers used across the tax domain.
export function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function toCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function asNumber(value: unknown): number {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string") {
    return Number.parseFloat(value);
  }

  if (value && typeof value === "object" && "toString" in value) {
    return Number.parseFloat(String(value));
  }

  return 0;
}
