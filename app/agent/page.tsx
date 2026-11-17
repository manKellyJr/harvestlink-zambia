import { getDb } from "@/db/client";
import { requireSessionRole } from "@/auth/session";
import { listActiveCollectionPoints, lotsAwaitingCheckin } from "@/domain/lots";
import { formatKwacha } from "@/domain/money";
import { ErrorBanner } from "@/web/ErrorBanner";
import { checkInAction, rejectLotAction } from "../staff-actions";

export const dynamic = "force-dynamic";

/** Collection point check-in, designed for a low-end Android phone at the scale. */
export default async function AgentHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const staff = await requireSessionRole("agent", "admin");
  const { error, notice, cp: cpParam } = await searchParams;
  const db = await getDb();
  const points = await listActiveCollectionPoints(db);
  const cpId = staff.role === "agent" ? staff.collectionPointId : Number(cpParam) || points[0]?.id;
  const cp = points.find((p) => p.id === cpId);
  const waiting = cp ? await lotsAwaitingCheckin(db, cp.id) : [];
  const back = staff.role === "admin" && cp ? `/agent?cp=${cp.id}` : "/agent";

  return (
    <>
      <h1>Check in lots{cp ? `: ${cp.name}` : ""}</h1>
      {staff.role === "admin" && (
        <form className="inline" style={{ marginBottom: 16 }}>
          <select name="cp" defaultValue={cp?.id}>
            {points.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="secondary">Show</button>
        </form>
      )}
      <ErrorBanner error={error} />
      {notice && <p className="notice">{notice}</p>}
      {!cp && <p className="error">Your account is not linked to an active collection point. Ask an admin.</p>}
      <p className="muted">Weigh each lot in front of the farmer. The weighed kg is what the farmer is paid for. Grade A: clean, dry, under 1% foreign matter. Grade B: saleable but below grade A. Reject wet, mouldy or contaminated produce.</p>
      {cp && waiting.length === 0 && <p className="card muted">No lots waiting to be weighed.</p>}
      {waiting.map(({ lot, farmerName, farmerPhone }) => (
        <div className="card" key={lot.id}>
          <p style={{ marginTop: 0 }}>
            <strong>Lot #{lot.id}</strong> · {farmerName} · {farmerPhone}<br />
            <span className="muted">Declared {lot.declaredKg} kg, minimum {formatKwacha(lot.minPricePerKgNgwee)}/kg</span>
          </p>
          <form action={checkInAction} className="grid">
            <input type="hidden" name="lotId" value={lot.id} />
            <input type="hidden" name="back" value={back} />
            <label>Weighed kg<input name="weighedKg" type="number" inputMode="numeric" min={1} required /></label>
            <label>Grade
              <select name="grade" defaultValue="A"><option value="A">A</option><option value="B">B</option></select>
            </label>
            <div style={{ alignSelf: "end" }}><button>Check in</button></div>
          </form>
          <details style={{ marginTop: 12 }}>
            <summary>Reject this lot</summary>
            <form action={rejectLotAction} className="inline" style={{ marginTop: 8 }}>
              <input type="hidden" name="lotId" value={lot.id} />
              <input type="hidden" name="back" value={back} />
              <input name="reason" placeholder="Reason, e.g. too wet" required minLength={3} />
              <button className="secondary">Reject</button>
            </form>
          </details>
        </div>
      ))}
    </>
  );
}
