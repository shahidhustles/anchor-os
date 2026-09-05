import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Anchor OS",
  description: "A local AI workbench powered by Eve",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="light" style={{ colorScheme: "light" }}>
      <body className="h-dvh bg-white">{children}</body>
    </html>
  );
}
