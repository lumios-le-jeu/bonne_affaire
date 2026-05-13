import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "La Bonne Affaire - LBC Tracker",
  description: "Track Leboncoin prices and detect the best deals instantly.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={inter.className}>
        <div className="container">
          <header style={{ paddingBottom: '2rem', borderBottom: '1px solid var(--card-border)', marginBottom: '2rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h1 style={{ margin: 0, fontSize: '2rem' }}>La Bonne Affaire <sub style={{ fontSize: '0.8rem', opacity: 0.6, verticalAlign: 'middle', fontWeight: 'normal' }}>v1.0</sub> ⚡️</h1>
              <nav>
                <a href="/" style={{ color: 'var(--foreground)', textDecoration: 'none', fontWeight: 600 }}>Dashboard</a>
              </nav>
            </div>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
