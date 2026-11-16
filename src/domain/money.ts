import { DomainError } from "./errors";

/** Format ngwee as Zambian Kwacha, e.g. 123450 -> "K1,234.50". */
export function formatKwacha(ngwee: number): string {
  const sign = ngwee < 0 ? "-" : "";
  const abs = Math.abs(ngwee);
  const kwacha = Math.floor(abs / 100).toLocaleString("en-ZM");
  const cents = String(abs % 100).padStart(2, "0");
  return `${sign}K${kwacha}.${cents}`;
}

/** Parse a user-entered kwacha amount ("12", "12.5", "K1,200.00") into integer ngwee. */
export function parseKwacha(input: string): number {
  const cleaned = input.trim().replace(/^k/i, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new DomainError("Enter an amount like 12 or 12.50");
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}
