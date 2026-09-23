"use client";

import type { ReactNode } from "react";
import { getMerchantModule, type MerchantModuleId } from "./modules";
import { ModuleGate } from "./module-gate";
import {
  CustomersModuleView,
  PlayersModuleView,
  SessionsModuleView,
  FinanceModuleView,
  SettlementsModuleView,
  DisputesModuleView,
  AuditModuleView,
  CatalogModuleView,
  PlayerApplicationsModuleView,
} from "./module-views";
import { getMonitorModule } from "./monitor-data";
import { MonitorModuleView } from "./monitor-view";
import { PricingRulesModuleView } from "./pricing-rules-view";
import { ReviewConsoleView } from "./review-console-view";
import { SettingsModuleView } from "./settings-view";
import { BreachLedgerModuleView } from "./breach-ledger-view";
import { PaymentLedgerPanel } from "@/app/_lib/payments/payment-ledger-panel";
import { WalletPanel } from "@/app/_lib/payments/wallet-panel";
import { PaymentSettingsPanel } from "@/app/_lib/payments/payment-settings-panel";
import { ReconciliationPanel } from "@/app/_lib/payments/reconciliation-panel";

export function ModuleView({ moduleId }: { moduleId: MerchantModuleId }) {
  if (!getMerchantModule(moduleId)) {
    return null;
  }

  const record = (id: MerchantModuleId, element: ReactNode) => (
    <ModuleGate moduleId={id}>{element}</ModuleGate>
  );

  switch (moduleId) {
    case "customers":
      return record(moduleId, <CustomersModuleView />);
    case "players":
      return record(moduleId, <PlayersModuleView />);
    case "player-applications":
      return record(moduleId, <PlayerApplicationsModuleView />);
    case "breaches":
      // P3 / D3：陪玩违约只读台账（新栈页面）。
      return record(moduleId, <BreachLedgerModuleView />);
    case "catalog":
      return record(moduleId, <CatalogModuleView />);
    case "sessions":
      return record(moduleId, <SessionsModuleView />);
    case "finance":
      return record(moduleId, <FinanceModuleView />);
    case "settlements":
      return record(moduleId, <SettlementsModuleView />);
    case "disputes":
      return record(moduleId, <DisputesModuleView />);
    case "audit":
      return record(moduleId, <AuditModuleView />);
    case "review":
      // 订单中心列表 Slice 2：报单审核台（三栏队列）。
      return record(moduleId, <ReviewConsoleView />);
    case "pricing":
      return record(moduleId, <PricingRulesModuleView />);
    case "payments-ledger":
      // S4-8：支付台账（与门店后台 /payments/orders 同一份 panel）。
      // S5-2：页面骨架照 design-demos/finance-data-grid.html（大标题 + 一句说明）。
      return record(
        moduleId,
        <>
          <div className="mb-[14px]">
            <h1 className="text-xl font-bold leading-tight tracking-tight text-[var(--mc-ink)]">
              支付台账
            </h1>
            <p className="mt-1 text-[12.5px] text-[var(--mc-muted)]">
              客户充值支付单：金额、已退、可退，支持排序 / 筛选 / 区域选择复制 /
              粘贴 / 查找 / 导出；所有修改都写审计。
            </p>
          </div>
          <PaymentLedgerPanel />
        </>,
      );
    case "payments-reconciliation":
      // S4-8：对账差异（只读，与门店后台 /payments/reconciliation 同一份 panel）。
      return record(moduleId, <ReconciliationPanel />);
    case "payments-settings":
      // S4-8：支付设置（与门店后台 /payments/settings 同一份 panel）。
      return record(moduleId, <PaymentSettingsPanel />);
    case "payments-wallets":
      // S4-9a：客户钱包台账（与门店后台 /payments/wallets 同一份 panel）。
      return record(moduleId, <WalletPanel />);
    default:
      break;
  }

  const monitorModule = getMonitorModule(moduleId);
  if (monitorModule) {
    return (
      <ModuleGate moduleId={moduleId}>
        <MonitorModuleView moduleId={monitorModule.id} />
      </ModuleGate>
    );
  }

  if (moduleId === "settings") {
    return (
      <ModuleGate moduleId={moduleId}>
        <SettingsModuleView />
      </ModuleGate>
    );
  }

  return null;
}
