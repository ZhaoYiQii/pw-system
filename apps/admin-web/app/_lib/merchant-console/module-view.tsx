"use client";

import { getMerchantModule, type MerchantModuleId } from "./modules";
import { ModuleGate } from "./module-gate";
import { getMonitorModule } from "./monitor-data";
import { MonitorModuleView } from "./monitor-view";
import { getRecordModule } from "./record-data";
import { RecordListView } from "./record-list-view";
import { SettingsModuleView } from "./settings-view";

/**
 * P0–P4 后所有已注册模块都由独立实现接管：
 * 工作台 / AI / 订单链路使用静态路由；其余模块在此按记录台 / 监控台 / 设置分发。
 * 未命中任何实现时返回空，由动态路由层不再渲染占位文案。
 */
export function ModuleView({ moduleId }: { moduleId: MerchantModuleId }) {
  if (!getMerchantModule(moduleId)) {
    return null;
  }

  const recordModule = getRecordModule(moduleId);
  if (recordModule) {
    return (
      <ModuleGate moduleId={moduleId}>
        <RecordListView moduleId={recordModule.id} />
      </ModuleGate>
    );
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
