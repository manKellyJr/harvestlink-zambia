import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db/client";
import { collectionPoints, roleEnum, type Role } from "@/db/schema";
import { requireSessionRole } from "@/auth/session";
import { listUsers } from "@/domain/admin";
import { ErrorBanner } from "@/web/ErrorBanner";
import { AdminNav } from "../nav";
import { createAccountAction, toggleUserAction } from "../../staff-actions";

export const dynamic = "force-dynamic";

export default async function Users({ searchParams }: { searchParams: Promise<{ error?: string; role?: string; q?: string }> }) {
  const admin = await requireSessionRole("admin");
  const { error, role: roleParam, q } = await searchParams;
  const role = (roleEnum.enumValues as readonly string[]).includes(roleParam ?? "") ? (roleParam as Role) : undefined;
  const db = await getDb();
  const [rows, points] = await Promise.all([
    listUsers(db, admin.id, { role, q }),
    db.select().from(collectionPoints).where(eq(collectionPoints.active, true)).orderBy(asc(collectionPoints.name)),
  ]);
  return (
    <>
      <h1>Accounts</h1>
      <AdminNav />
      <ErrorBanner error={error} />
      <form className="inline" style={{ marginBottom: 12 }}>
        <select name="role" defaultValue={role ?? ""}>
          <option value="">All roles</option>
          {roleEnum.enumValues.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <input name="q" placeholder="Name or phone" defaultValue={q} />
        <button className="secondary">Filter</button>
      </form>
      <div className="card table-scroll">
        <table>
          <thead><tr><th>Name</th><th>Phone</th><th>Role</th><th>District / point</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {rows.map(({ user: u, collectionPoint }) => (
              <tr key={u.id}>
                <td>{u.name}</td><td>{u.phone}</td><td>{u.role}</td>
                <td>{collectionPoint ?? u.district ?? "—"}</td>
                <td><span className="pill">{u.active ? "Active" : "Suspended"}</span></td>
                <td>
                  {u.id !== admin.id && (
                    <form action={toggleUserAction}>
                      <input type="hidden" name="id" value={u.id} />
                      <input type="hidden" name="active" value={String(!u.active)} />
                      <input type="hidden" name="filterRole" value={role ?? ""} />
                      <button className="secondary">{u.active ? "Suspend" : "Reactivate"}</button>
                    </form>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className="muted">No accounts match.</td></tr>}
          </tbody>
        </table>
      </div>
      <h2>Create an account</h2>
      <p className="muted">For collection point agents, other admins, or buyers you have vetted in person. Farmers and transporters register themselves by USSD.</p>
      <form action={createAccountAction} className="card grid">
        <label>Role
          <select name="role" defaultValue="agent">
            <option value="agent">Agent</option><option value="buyer">Buyer</option><option value="admin">Admin</option>
          </select>
        </label>
        <label>Name<input name="name" required minLength={2} /></label>
        <label>Mobile number<input name="phone" type="tel" required /></label>
        <label>Collection point (agents)
          <select name="collectionPointId" defaultValue="">
            <option value="">—</option>
            {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label>District (buyers)<input name="district" /></label>
        <label>Wallet (buyers)
          <select name="walletProvider" defaultValue="">
            <option value="">—</option><option value="mtn">MTN MoMo</option><option value="airtel">Airtel Money</option><option value="zamtel">Zamtel Kwacha</option>
          </select>
        </label>
        <div><button>Create</button></div>
      </form>
    </>
  );
}
