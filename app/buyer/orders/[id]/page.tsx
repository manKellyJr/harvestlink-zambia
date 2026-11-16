import Link from "next/link";
import { notFound } from "next/navigation";
import { getDb } from "@/db/client";
import { requireSessionRole } from "@/auth/session";
import { payoutsForOrder } from "@/domain/payouts";
import { formatKwacha } from "@/domain/money";
import { walletLabels } from "@/domain/phone";
import { ErrorBanner } from "@/web/ErrorBanner";
import { markPaidAction } from "../../../actions";

export const dynamic = "force-dynamic";

const statusLabel = { owed: "To pay", buyer_marked_paid: "Sent, awaiting confirmation", confirmed: "Confirmed by payee", disputed: "Payee reports NOT received" };

export default async function OrderPayments({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string }> }) {
  const buyer = await requireSessionRole("buyer");
  const { id } = await params;
  const { error } = await searchParams;
  const orderId = Number(id);
  if (!Number.isInteger(orderId)) notFound();
  const rows = await payoutsForOrder(await getDb(), buyer.id, orderId);
  if (rows.length === 0) notFound();
  const total = rows.reduce((s, r) => s + r.payout.amountNgwee, 0);

  return (
    <>
      <p><Link href="/buyer">← My orders</Link></p>
      <h1>Payments for order #{orderId}</h1>
      <p className="muted">
        Send each amount from your own mobile money wallet to the number shown, then enter the transaction ID. Each farmer confirms receipt on their phone. Total {formatKwacha(total)}.
      </p>
      <ErrorBanner error={error} />
      <div className="card table-scroll">
        <table>
          <thead><tr><th>Payee</th><th>Wallet</th><th className="num">Amount</th><th>Status</th><th>Transaction ID</th></tr></thead>
          <tbody>
            {rows.map(({ payout: p, payeeName }) => (
              <tr key={p.id}>
                <td>{payeeName}<br /><span className="muted">{p.payeeType}</span></td>
                <td>{walletLabels[p.walletProvider]}<br />{p.walletPhone}</td>
                <td className="num">{formatKwacha(p.amountNgwee)}</td>
                <td><span className="pill">{statusLabel[p.status]}</span></td>
                <td>
                  {p.status === "owed" || p.status === "disputed" ? (
                    <form action={markPaidAction} className="inline">
                      <input type="hidden" name="orderId" value={orderId} />
                      <input type="hidden" name="payoutId" value={p.id} />
                      <input name="reference" placeholder="e.g. MP241116.1234.A0001" required size={18} defaultValue={p.buyerReference ?? ""} />
                      <button>Mark sent</button>
                    </form>
                  ) : (
                    p.buyerReference ?? "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
