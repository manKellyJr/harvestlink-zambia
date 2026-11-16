import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { currentUser } from "@/auth/session";
import { logout } from "./actions";

export const metadata: Metadata = {
  title: "HarvestLink Zambia",
  description: "Buy bulked produce directly from smallholder farmers in Zambia",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  return (
    <html lang="en">
      <body>
        <header>
          <div className="wrap">
            <Link href="/" className="brand">HarvestLink</Link>
            {user ? (
              <form action={logout} className="inline">
                <span className="muted">{user.name}</span>
                <button className="secondary" type="submit">Log out</button>
              </form>
            ) : (
              <Link href="/login">Buyer login</Link>
            )}
          </div>
        </header>
        <main className="wrap">{children}</main>
      </body>
    </html>
  );
}
