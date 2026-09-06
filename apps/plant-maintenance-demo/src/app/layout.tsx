import type { Metadata } from "next";

import { AppFooter } from "@/components/app-footer";
import { AppHeader } from "@/components/app-header";

import "./globals.css";

export const metadata: Metadata = {
  title: "PlantOps — Plant Maintenance Demo",
  description:
    "A local demonstration CMMS for the Anchor OS browser-control demo. All data is synthetic.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col bg-canvas font-sans text-ink">
        <AppHeader />
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8 sm:px-6">{children}</main>
        <AppFooter />
      </body>
    </html>
  );
}
