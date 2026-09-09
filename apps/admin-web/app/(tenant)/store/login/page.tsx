"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { apiFetch, setAccessToken, setCsrfToken } from "../../../_lib/api";

interface LoginResult {
  accessToken: string;
  csrfToken?: string;
  principal?: { role?: string; username?: string };
}

export default function TenantLoginPage() {
  const router = useRouter();
  const [tenantCode, setTenantCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await apiFetch<LoginResult>("/api/v1/auth/login", {
        method: "POST",
        credentials: "include",
        body: JSON.stringify({
          kind: "tenant",
          tenantCode,
          username,
          password,
        }),
      });
      setAccessToken(data.accessToken);
      if (data.csrfToken) setCsrfToken(data.csrfToken);
      router.push("/merchant-console/work");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f5f7] px-4">
      <div className="w-full max-w-sm">
        <Card>
          <CardHeader>
            <CardTitle>门店登录</CardTitle>
            <CardDescription>
              门店后台（owner / 管理员 / 客服等）
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="flex flex-col gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="tenant-code">
                  门店 code
                </label>
                <Input
                  id="tenant-code"
                  value={tenantCode}
                  onChange={(e) => setTenantCode(e.target.value)}
                  autoComplete="organization"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="username">
                  账号
                </label>
                <Input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="password">
                  密码
                </label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
              {message ? (
                <p className="text-sm text-destructive">{message}</p>
              ) : null}
              <Button type="submit" disabled={busy}>
                {busy ? "登录中…" : "登录"}
              </Button>
            </form>
          </CardContent>
        </Card>
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link href="/" className="hover:underline">
            ← 返回首页
          </Link>
        </p>
      </div>
    </main>
  );
}
