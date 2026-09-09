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
} from "./module-views";
import { getMonitorModule } from "./monitor-data";
import { MonitorModuleView } from "./monitor-view";
import { SettingsModuleView } from "./settings-view";

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
