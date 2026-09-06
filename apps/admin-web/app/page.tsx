import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <h1>PW SaaS Admin</h1>
      <p>陪玩门店多租户 SaaS 管理后台 — Slice 1。</p>
      <ul>
        <li>
          <Link href="/tenants">平台租户管理</Link>
        </li>
      </ul>
    </main>
  );
}
