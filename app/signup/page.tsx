import { requestSignup } from "../actions";
import { ErrorBanner } from "@/web/ErrorBanner";

export default async function Signup({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <>
      <h1>Register as a buyer</h1>
      <ErrorBanner error={error} />
      <form action={requestSignup} className="stack">
        <label>Business or your name<input name="name" required minLength={2} maxLength={60} /></label>
        <label>Mobile number<input name="phone" type="tel" inputMode="tel" placeholder="0971234567" required /></label>
        <label>District<input name="district" required /></label>
        <label>Mobile money provider you pay from
          <select name="walletProvider" required defaultValue="">
            <option value="" disabled>Choose</option>
            <option value="mtn">MTN MoMo</option>
            <option value="airtel">Airtel Money</option>
            <option value="zamtel">Zamtel Kwacha</option>
          </select>
        </label>
        <label style={{ display: "flex", gap: 8, fontWeight: 400 }}>
          <input type="checkbox" name="consent" style={{ width: "auto" }} required />
          I agree that HarvestLink stores my name, phone number and district to run my orders, as described in the privacy notice.
        </label>
        <button type="submit">Send verification code</button>
      </form>
    </>
  );
}
