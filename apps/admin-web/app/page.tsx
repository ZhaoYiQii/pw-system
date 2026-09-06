import Link from "next/link";

export default function HomePage() {
  return (
    <main className="page">
      <h1 className="page-title">PW SaaS Admin</h1>
      <p className="page-desc">陪玩门店多租户 SaaS 管理后台（Slice 1-3 骨架与配置/套餐）</p>
      <div className="card">
        <h2 className="card-title">平台运营</h2>
        <p className="card-desc">SaaS 平台管理员：创建/停用门店、开通增值功能。</p>
        <div className="row-actions">
          <Link className="btn" href="/login">
            平台登录
          </Link>
          <Link className="btn" href="/tenants">
            租户管理
          </Link>
          <Link className="btn" href="/packages">
            套餐与功能开关
          </Link>
        </div>
      </div>
      <div className="card">
        <h2 className="card-title">门店后台</h2>
        <p className="card-desc">门店经营者：品牌主题、版本管理与回滚。</p>
        <div className="row-actions">
          <Link className="btn" href="/store/login">
            门店登录
          </Link>
          <Link className="btn" href="/settings">
            门店设置
          </Link>
        </div>
      </div>
    </main>
  );
}
