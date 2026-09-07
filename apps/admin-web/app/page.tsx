import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const PLATFORM_LINKS = [
  { href: "/login", label: "平台登录" },
  { href: "/tenants", label: "租户管理" },
  { href: "/packages", label: "套餐与功能开关" },
];

const STORE_LINKS = [
  { href: "/store/login", label: "门店登录" },
  { href: "/customers", label: "客户" },
  { href: "/orders", label: "订单" },
  { href: "/players", label: "陪玩" },
  { href: "/catalog", label: "服务目录" },
  { href: "/finance", label: "财务" },
  { href: "/settings", label: "门店设置" },
];

export default function HomePage() {
  return (
    <main className="min-h-screen bg-[#f4f5f7] px-6 py-10">
      <div className="mx-auto max-w-4xl">
        <h1 className="text-2xl font-semibold tracking-tight">PW SaaS Admin</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          陪玩门店多租户 SaaS 管理后台
        </p>
        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>平台运营</CardTitle>
              <CardDescription>
                SaaS 平台管理员：创建/停用门店、开通增值功能。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {PLATFORM_LINKS.map((link) => (
                <Button key={link.href} asChild variant="outline">
                  <Link href={link.href}>{link.label}</Link>
                </Button>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>门店后台</CardTitle>
              <CardDescription>
                门店经营者：品牌、订单与业务管理。
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {STORE_LINKS.map((link) => (
                <Button key={link.href} asChild variant="outline">
                  <Link href={link.href}>{link.label}</Link>
                </Button>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}
