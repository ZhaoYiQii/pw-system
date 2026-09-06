"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { clearAccessToken } from "./api";

const LINKS = [
  { href: "/customers", label: "客户" },
  { href: "/players", label: "陪玩" },
  { href: "/catalog", label: "服务目录" },
  { href: "/settings", label: "门店设置" }
];

export function TenantNav() {
  const router = useRouter();
  const logout = () => {
    clearAccessToken();
    router.push("/store/login");
  };
  return (
    <nav className="topnav">
      <span className="brand">PW SaaS</span>
      {LINKS.map((l) => (
        <Link key={l.href} href={l.href}>
          {l.label}
        </Link>
      ))}
      <span className="spacer" />
      <button className="btn" onClick={logout}>
        退出
      </button>
    </nav>
  );
}