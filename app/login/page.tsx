import Link from "next/link";
import { requestLogin } from "../actions";
import { ErrorBanner } from "@/web/ErrorBanner";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <h1>Buyer login</h1>
      <p className="muted">We will send a 6-digit code to your phone by SMS.</p>
      <ErrorBanner error={error} />
      <form action={requestLogin} className="stack">
        <label>Mobile number<input name="phone" type="tel" inputMode="tel" placeholder="0971234567" required autoComplete="tel" /></label>
        <button type="submit">Send code</button>
      </form>
      <p>New buyer? <Link href="/signup">Register</Link></p>
    </>
  );
}
