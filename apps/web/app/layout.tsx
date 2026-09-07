import type { Metadata } from "next";
import { Geist_Mono, Outfit } from "next/font/google";
import "./globals.css";

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-outfit",
  display: "swap",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

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
    <html
      lang="en"
      className={`light ${outfit.variable} ${geistMono.variable}`}
      style={{ colorScheme: "light" }}
    >
      <body className="h-dvh bg-background font-sans">{children}</body>
    </html>
  );
}
