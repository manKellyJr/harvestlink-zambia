import { verifyLogin } from "../../actions";
import { ErrorBanner } from "@/web/ErrorBanner";

export default async function Verify({ searchParams }: { searchParams: Promise<{ phone?: string; error?: string }> }) {
  const { phone = "", error } = await searchParams;
  return (
    <>
      <h1>Enter your code</h1>
      <p className="muted">We sent a code by SMS to {phone}.</p>
      <ErrorBanner error={error} />
      <form action={verifyLogin} className="stack">
        <input type="hidden" name="phone" value={phone} />
        <label>6-digit code<input name="code" inputMode="numeric" pattern="\d{6}" maxLength={6} required autoComplete="one-time-code" /></label>
        <button type="submit">Log in</button>
      </form>
    </>
  );
}
