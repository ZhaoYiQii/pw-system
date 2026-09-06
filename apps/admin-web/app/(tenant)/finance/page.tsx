"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "../../_lib/api";
import { TenantNav } from "../../_lib/tenant-nav";
import { formatFenYuan, sumFen } from "../../_lib/money";

interface Rules {
  platformFeeBp: number;
  storeCutBp: number;
}
interface Split {
  platformFeeFen: string;
  storeCutFen: string;
  playerShareFen: string;
}

function pct(bp: number): string {
  return `${(bp / 100).toFixed(2)}%`;
}

export default function FinancePage() {
  const [rules, setRules] = useState<Rules | null>(null);
  const [storeCut, setStoreCut] = useState("");
  const [amount, setAmount] = useState("");
  const [split, setSplit] = useState<Split | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [unauth, setUnauth] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setRules(await apiFetch<Rules>("/api/v1/tenant/finance-rules"));
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) setUnauth(true);
        else setMsg(error instanceof Error ? error.message : String(error));
      }
    })();
  }, []);

  const saveStoreCut = async () => {
    setBusy(true);
    setMsg(null);
    setOk(null);
    try {
      const updated = await apiFetch<Rules>("/api/v1/tenant/finance-rules/store-cut", {
        method: "POST",
        body: JSON.stringify({ storeCutBp: Number(storeCut) })
      });
      setRules(updated);
      setOk("已保存门店抽成。");
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const preview = async () => {
    setBusy(true);
    setMsg(null);
    try {
      setSplit(await apiFetch<Split>("/api/v1/tenant/finance-rules/split-preview", {
        method: "POST",
        body: JSON.stringify({ amountFen: amount })
      }));
    } catch (error) {
      setMsg(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (unauth) {
    return (
      <main>
        <TenantNav />
        <div className="page">
          <div className="card">
            <p>尚未登录门店账号。</p>
            <Link className="btn btn-primary" href="/store/login">去登录</Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main>
      <TenantNav />
      <div className="page">
        <h1 className="page-title">财务 · 分成规则</h1>
        <p className="page-desc">平台费/门店抽成按“老板应付金额”拆分；陪玩到手为剩余（尾差归陪玩）。</p>
        {msg ? <p className="banner banner-error">{msg}</p> : null}
        {ok ? <p className="banner banner-success">{ok}</p> : null}

        <div className="card">
          <h2 className="card-title">当前费率（基点 bp，1% = 100bp）</h2>
          {rules ? (
            <table className="data-table">
              <tbody>
                <tr><td>平台服务费</td><td>{rules.platformFeeBp} bp（{pct(rules.platformFeeBp)}）</td><td className="muted">由平台后台调整</td></tr>
                <tr><td>门店抽成</td><td>{rules.storeCutBp} bp（{pct(rules.storeCutBp)}）</td><td className="muted">本店可调整</td></tr>
                <tr><td>陪玩到手</td><td>{10000 - rules.platformFeeBp - rules.storeCutBp} bp（{pct(10000 - rules.platformFeeBp - rules.storeCutBp)}）</td><td className="muted">剩余部分（尾差归陪玩）</td></tr>
              </tbody>
            </table>
          ) : (
            <p className="muted">加载中…</p>
          )}
          <div className="row-actions" style={{ marginTop: 12, alignItems: "flex-end" }}>
            <div className="field" style={{ margin: 0 }}>
              <label>门店抽成（bp，0-10000）</label>
              <input className="input" type="number" value={storeCut} onChange={(e) => setStoreCut(e.target.value)} placeholder="如 2000 = 20%" />
            </div>
            <button className="btn btn-primary" disabled={busy || !storeCut} onClick={() => void saveStoreCut()}>保存门店抽成</button>
          </div>
        </div>

        <div className="card">
          <h2 className="card-title">分账试算</h2>
          <div className="row-actions" style={{ alignItems: "flex-end" }}>
            <div className="field" style={{ margin: 0 }}>
              <label>老板应付金额（分，如 10000 = ¥100.00）</label>
              <input className="input" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="10000" />
            </div>
            <button className="btn" disabled={busy || !amount} onClick={() => void preview()}>试算</button>
          </div>
          {split ? (
            <table className="data-table" style={{ marginTop: 12 }}>
              <tbody>
                <tr><td>平台服务费</td><td>{formatFenYuan(split.platformFeeFen)}</td></tr>
                <tr><td>门店抽成</td><td>{formatFenYuan(split.storeCutFen)}</td></tr>
                <tr><td>陪玩到手（可提现口径）</td><td>{formatFenYuan(split.playerShareFen)}</td></tr>
                <tr><td>合计</td><td>{formatFenYuan(sumFen([split.platformFeeFen, split.storeCutFen, split.playerShareFen]))}</td></tr>
              </tbody>
            </table>
          ) : null}
        </div>
      </div>
    </main>
  );
}
