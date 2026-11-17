import { getDb } from "@/db/client";
import { requireSessionRole } from "@/auth/session";
import { overview } from "@/domain/admin";
import { formatKwacha } from "@/domain/money";
import { AdminNav } from "./nav";

export const dynamic = "force-dynamic";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card" style={{ marginBottom: 0 }}>
      <div className="muted" style={{ fontSize: "0.85rem" }}>{label}</div>
      <div style={{ fontSize: "1.5rem", fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

export default async function AdminHome() {
  const admin = await requireSessionRole("admin");
  const o = await overview(await getDb(), admin.id);
  const n = (r: Record<string, number>, k: string) => r[k] ?? 0;
  return (
    <>
      <h1>Admin</h1>
      <AdminNav />
      <h2>People</h2>
      <div className="grid">
        <Stat label="Farmers" value={n(o.users, "farmer")} />
        <Stat label="Buyers" value={n(o.users, "buyer")} />
        <Stat label="Transporters" value={n(o.users, "transporter")} />
        <Stat label="Agents" value={n(o.users, "agent")} />
      </div>
      <h2>Produce and orders</h2>
      <div className="grid">
        <Stat label="Lots to be weighed" value={n(o.lots, "awaiting_checkin")} />
        <Stat label="Lots on offer" value={n(o.lots, "listed")} />
        <Stat label="Orders in progress" value={n(o.orders, "allocated") + n(o.orders, "assigned") + n(o.orders, "picked_up")} />
        <Stat label="Awaiting payment" value={n(o.orders, "delivered")} />
        <Stat label="Completed orders" value={n(o.orders, "completed")} />
      </div>
      <h2>Money and messages</h2>
      <div className="grid">
        <Stat label="Paid to farmers (confirmed)" value={formatKwacha(o.farmerPaymentsConfirmedNgwee)} />
        <Stat label="Failed SMS" value={o.failedSms} />
      </div>
    </>
  );
}
