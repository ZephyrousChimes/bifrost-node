import type { Metadata } from "next";
import aeonikPro from "@/fonts/aeonik-pro.font";
import AuroraBackdrop from "@/components/AuroraBackdrop";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bifrost Dashboard",
  description: "Merchant dashboard for the Bifrost payment sandbox",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={aeonikPro.variable}>
      <body>
        <AuroraBackdrop />
        {children}
      </body>
    </html>
  );
}
