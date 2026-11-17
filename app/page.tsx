import Link from "next/link";
import { getDb } from "@/db/client";
import { supplyByCollectionPoint } from "@/domain/lots";
import { pilot } from "@/domain/config";
import { formatKwacha } from "@/domain/money";

export const dynamic = "force-dynamic";

export default async function Home() {
  const supply = await supplyByCollectionPoint(await getDb());
  const totalKg = supply.reduce((s, r) => s + r.availableKg, 0);
  return (
    <>
      <h1>Buy {pilot.crop} directly from Zambian farmers</h1>
      <p className="muted">
        Smallholder farmers list their harvest by USSD. HarvestLink bulks small lots at collection points so a truck is worth sending.
        You pay each farmer&apos;s mobile money wallet on delivery, and HarvestLink never holds your money.
      </p>
      <p><Link className="button" href="/signup">Register as a buyer</Link> <Link href="/login">or log in</Link></p>

      <h2>Available now: {totalKg.toLocaleString()} kg</h2>
      <div className="card table-scroll">
        <table>
          <thead><tr><th>Collection point</th><th>District</th><th className="num">Available kg</th><th className="num">From</th></tr></thead>
          <tbody>
            {supply.map((r) => (
              <tr key={r.collectionPointId}>
                <td>{r.name}</td><td>{r.district}</td>
                <td className="num">{r.availableKg.toLocaleString()}</td>
                <td className="num">{r.lowestMinPriceNgwee ? `${formatKwacha(r.lowestMinPriceNgwee)}/kg` : "—"}</td>
              </tr>
            ))}
            {supply.length === 0 && <tr><td colSpan={4} className="muted">No collection points yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="muted">Farmers and transporters: dial the HarvestLink USSD code on any phone to register.</p>
    </>
  );
}
