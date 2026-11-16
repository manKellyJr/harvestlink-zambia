import Link from "next/link";
import { getDb } from "@/db/client";
import { requireSessionRole } from "@/auth/session";
import { supplyByCollectionPoint } from "@/domain/lots";
import { ordersForBuyer } from "@/domain/orders";
import { formatKwacha } from "@/domain/money";
import { pilot } from "@/domain/config";
import { ErrorBanner } from "@/web/ErrorBanner";
import { cancelOrderAction, confirmDeliveryAction, createOrder } from "../actions";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, string> = {
  allocated: "Waiting for transporter",
  assigned: "Transporter assigned",
  picked_up: "In transit",
  delivered: "Delivered, payments due",
  completed: "Completed",
  cancelled: "Cancelled",
};

export default async function BuyerHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const buyer = await requireSessionRole("buyer");
  const { error, notice, ...prev } = await searchParams;
  const db = await getDb();
  const [supply, myOrders] = await Promise.all([supplyByCollectionPoint(db), ordersForBuyer(db, buyer.id)]);

  return (
    <>
      <h1>Order {pilot.crop}</h1>
      <ErrorBanner error={error} />
      {notice && <p className="notice">{notice}</p>}

      <div className="card">
        <form action={createOrder} className="grid">
          <label>Collection point
            <select name="collectionPointId" required defaultValue={prev.cp}>
              {supply.map((s) => (
                <option key={s.collectionPointId} value={s.collectionPointId}>
                  {s.name} ({s.availableKg.toLocaleString()} kg{s.lowestMinPriceNgwee ? `, from ${formatKwacha(s.lowestMinPriceNgwee)}/kg` : ""})
                </option>
              ))}
            </select>
          </label>
          <label>Quantity (kg)<input name="quantityKg" type="number" min={50} step={1} required defaultValue={prev.kg} /></label>
          <label>Your price per kg (K)<input name="pricePerKg" inputMode="decimal" placeholder="10.00" required defaultValue={prev.price} /></label>
          <label>Transport fee you will pay (K)<input name="transportFee" inputMode="decimal" placeholder="1500" defaultValue={prev.fee} /></label>
          <label style={{ gridColumn: "1 / -1" }}>Delivery address<input name="deliveryAddress" required minLength={5} defaultValue={prev.addr} /></label>
          <div><button type="submit">Place order</button></div>
        </form>
        <p className="muted" style={{ marginBottom: 0 }}>
          Supply is reserved from farmers whose minimum price is at or below yours. On delivery you pay each farmer and the transporter directly to their mobile money wallet.
        </p>
      </div>

      <h2>My orders</h2>
      <div className="card table-scroll">
        <table>
          <thead><tr><th>#</th><th>From</th><th className="num">kg</th><th className="num">Price/kg</th><th className="num">Produce value</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {myOrders.map(({ order: o, collectionPoint }) => (
              <tr key={o.id}>
                <td>{o.id}</td>
                <td>{collectionPoint}</td>
                <td className="num">{o.quantityKg.toLocaleString()}</td>
                <td className="num">{formatKwacha(o.pricePerKgNgwee)}</td>
                <td className="num">{formatKwacha(o.quantityKg * o.pricePerKgNgwee)}</td>
                <td><span className="pill">{statusLabel[o.status]}</span></td>
                <td>
                  {o.status === "allocated" && (
                    <form action={cancelOrderAction}><input type="hidden" name="orderId" value={o.id} /><button className="secondary">Cancel</button></form>
                  )}
                  {o.status === "picked_up" && (
                    <form action={confirmDeliveryAction}><input type="hidden" name="orderId" value={o.id} /><button>Confirm delivery</button></form>
                  )}
                  {(o.status === "delivered" || o.status === "completed") && <Link href={`/buyer/orders/${o.id}`}>Payments</Link>}
                </td>
              </tr>
            ))}
            {myOrders.length === 0 && <tr><td colSpan={7} className="muted">No orders yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
