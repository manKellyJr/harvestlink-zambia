import Link from "next/link";

export function AdminNav() {
  return (
    <p className="inline" style={{ gap: 16 }}>
      <Link href="/admin">Overview</Link>
      <Link href="/admin/collection-points">Collection points</Link>
      <Link href="/admin/users">Accounts</Link>
      <Link href="/admin/disputes">Disputes</Link>
      <Link href="/agent">Check-in</Link>
    </p>
  );
}
