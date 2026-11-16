import { DomainError } from "./errors";
import type { WalletProvider } from "@/db/schema";

/**
 * Normalise a Zambian mobile number to E.164 (+260XXXXXXXXX).
 * Accepts 0971234567, 971234567, 260971234567 and +260971234567.
 */
export function normalisePhone(input: string): string {
  const digits = input.replace(/[\s\-()]/g, "").replace(/^\+/, "");
  let national: string;
  if (/^260\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{9}$/.test(digits)) national = digits;
  else throw new DomainError("Enter a Zambian mobile number, e.g. 0971234567");
  if (!/^(7|9)\d{8}$/.test(national)) throw new DomainError("That is not a Zambian mobile number");
  return `+260${national}`;
}

/**
 * Guess the mobile network from the number prefix. Used only as a default:
 * because of number portability, the user always confirms their wallet provider.
 */
export function guessWalletProvider(e164: string): WalletProvider | undefined {
  const prefix = e164.slice(4, 6);
  if (["96", "76"].includes(prefix)) return "mtn";
  if (["97", "77", "57"].includes(prefix)) return "airtel";
  if (["95", "75"].includes(prefix)) return "zamtel";
  return undefined;
}

export const walletLabels: Record<WalletProvider, string> = {
  mtn: "MTN MoMo",
  airtel: "Airtel Money",
  zamtel: "Zamtel Kwacha",
};
