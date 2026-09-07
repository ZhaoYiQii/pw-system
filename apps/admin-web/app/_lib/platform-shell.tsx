"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { clearAccessToken } from "./api";

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  return (
    <main className="min-h-screen bg-[#f4f5f7]">
      <header className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center gap-5 px-5 py-3">
          <span className="whitespace-nowrap font-semibold">PW SaaS</span>
          <nav className="flex flex-1 items-center gap-4 text-sm">
            <Link
              href="/tenants"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              租户管理
            </Link>
            <Link
              href="/packages"
              className="text-muted-foreground transition-colors hover:text-foreground"
            >
              套餐与功能
            </Link>
          </nav>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              clearAccessToken();
              router.push("/login");
            }}
          >
            退出
          </Button>
        </div>
      </header>
      <div className="mx-auto max-w-[1440px] px-5 py-8">{children}</div>
    </main>
  );
}
