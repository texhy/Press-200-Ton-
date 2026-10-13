import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Noto_Nastaliq_Urdu } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono-face", display: "swap" });
const urdu = Noto_Nastaliq_Urdu({ subsets: ["arabic"], variable: "--font-urdu", display: "swap", weight: ["400", "700"] });

export const metadata: Metadata = {
  title: "Press 200 — ByteAIro",
  description: "PLC + VFD + camera, on one spine.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <body className={`${inter.variable} ${mono.variable} ${urdu.variable}`}>{children}</body>
    </html>
  );
}
