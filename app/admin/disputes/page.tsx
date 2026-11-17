import { getDb } from "@/db/client";
import { requireSessionRole } from "@/auth/session";
import { listDisputes } from "@/domain/admin";
import { formatKwacha } from "@/domain/money";
import { walletLabels } from "@/domain/phone";
import { ErrorBanner } from "@/web/ErrorBanner";
import { AdminNav } from "../nav";
import { resolveDisputeAction } from "../../staff-actions";

export const dynamic = "force-dynamic";

export default async function Disputes({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const admin = await requireSessionRole("admin");
  const { error } = await searchParams;
  const rows = await listDisputes(await getDb(), admin.id);
  return (
    <>
      <h1>Payment disputes</h1>
      <AdminNav />
      <ErrorBanner error={error} />
      <p className="muted">A payee said they did not receive a payment. Call both sides and check the buyer&apos;s transaction ID with the operator before resolving.</p>
      {rows.length === 0 && <p className="card muted">No open disputes.</p>}
      {rows.map(({ payout: p, payeeName, buyerName, buyerPhone }) => (
        <div className="card" key={p.id}>
          <p style={{ marginTop: 0 }}>
            <strong>{formatKwacha(p.amountNgwee)}</strong> for order #{p.orderId}<br />
            Payee: {payeeName} ({p.payeeType}), {walletLabels[p.walletProvider]} {p.walletPhone}<br />
            Buyer: {buyerName}, {buyerPhone}<br />
            Buyer&apos;s transaction ID: {p.buyerReference ?? <em>none recorded</em>}
          </p>
          <form action={resolveDisputeAction} className="grid">
            <input type="hidden" name="payoutId" value={p.id} />
            <label style={{ gridColumn: "1 / -1" }}>How it was checked<input name="note" required minLength={5} placeholder="e.g. Airtel statement shows MP2611.. received 17 Nov" /></label>
            <label>Outcome
              <select name="outcome" defaultValue="paid">
                <option value="paid">Payment did arrive: confirm it</option>
                <option value="reopen">It did not arrive: buyer must pay</option>
              </select>
            </label>
            <div style={{ alignSelf: "end" }}><button>Resolve</button></div>
          </form>
        </div>
      ))}
    </>
  );
}
