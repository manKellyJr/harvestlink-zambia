import { redirect } from "next/navigation";
import { DomainError } from "@/domain/errors";

/**
 * Run a server action body. A DomainError (bad input, not allowed) is shown to
 * the user on `backTo`; anything else is a bug and is re-thrown to be logged.
 */
export async function runAction(backTo: string, fn: () => Promise<string | void>): Promise<never> {
  let next: string;
  try {
    next = (await fn()) ?? backTo;
  } catch (err) {
    if (err instanceof DomainError) {
      const sep = backTo.includes("?") ? "&" : "?";
      redirect(`${backTo}${sep}error=${encodeURIComponent(err.message)}`);
    }
    throw err;
  }
  redirect(next);
}

export const field = (form: FormData, name: string) => String(form.get(name) ?? "");
