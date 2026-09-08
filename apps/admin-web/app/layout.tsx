import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./platform-console.css";
import "./merchant-console.css";

export const metadata: Metadata = {
  title: "PW SaaS Admin",
  description: "陪玩门店多租户 SaaS 管理后台",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
