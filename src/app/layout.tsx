import type { Metadata } from "next";
import { Montserrat } from "next/font/google";
import s from "./ui.module.css";

const sans = Montserrat({ subsets: ["latin"], variable: "--font-sans", display: "swap" });

export const metadata: Metadata = {
  title: "Book a call",
  description: "Pick a time that works for you.",
  robots: { index: false, follow: false },
  openGraph: { title: "Book a call", description: "Pick a time that works for you." },
  twitter: { card: "summary", title: "Book a call" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
      <body style={{ margin: 0, background: "#08080a" }}>
        <div className={s.root}>
          {children}
          <p className={s.foot}>Booked with open-cal</p>
        </div>
      </body>
    </html>
  );
}
