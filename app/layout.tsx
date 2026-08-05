import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "App Template",
  description: "Squelette d'app hub perso.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr-CA">
      <body>{children}</body>
    </html>
  );
}
