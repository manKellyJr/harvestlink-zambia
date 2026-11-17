import { asc } from "drizzle-orm";
import { getDb } from "@/db/client";
import { collectionPoints } from "@/db/schema";
import { requireSessionRole } from "@/auth/session";
import { ErrorBanner } from "@/web/ErrorBanner";
import { AdminNav } from "../nav";
import { createCollectionPointAction, toggleCollectionPointAction } from "../../staff-actions";

export const dynamic = "force-dynamic";

export default async function CollectionPoints({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireSessionRole("admin");
  const { error } = await searchParams;
  const points = await (await getDb()).select().from(collectionPoints).orderBy(asc(collectionPoints.name));
  return (
    <>
      <h1>Collection points</h1>
      <AdminNav />
      <ErrorBanner error={error} />
      <div className="card table-scroll">
        <table>
          <thead><tr><th>Name</th><th>District</th><th>Status</th><th></th></tr></thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.id}>
                <td>{p.name}{p.description && <><br /><span className="muted">{p.description}</span></>}</td>
                <td>{p.district}</td>
                <td><span className="pill">{p.active ? "Active" : "Closed"}</span></td>
                <td>
                  <form action={toggleCollectionPointAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <input type="hidden" name="active" value={String(!p.active)} />
                    <button className="secondary">{p.active ? "Close" : "Reopen"}</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Add a collection point</h2>
      <form action={createCollectionPointAction} className="card grid">
        <label>Name<input name="name" required minLength={3} /></label>
        <label>District<input name="district" required /></label>
        <label style={{ gridColumn: "1 / -1" }}>Directions (optional)<input name="description" maxLength={200} /></label>
        <div><button>Add</button></div>
      </form>
    </>
  );
}
