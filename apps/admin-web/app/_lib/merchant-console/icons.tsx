import type { ComponentType } from "react";
import {
  AlertTriangle,
  Banknote,
  Bell,
  BookOpen,
  ClipboardList,
  Gauge,
  Home,
  Radio,
  ScrollText,
  Settings,
  Shield,
  ShieldAlert,
  Sparkles,
  Timer,
  User,
  Users,
  Wallet,
} from "lucide-react";
import type { MerchantModuleId } from "./modules";

export type ModuleIcon = ComponentType<{ className?: string; size?: number }>;

export const MODULE_ICONS: Record<MerchantModuleId, ModuleIcon> = {
  work: Home,
  ai: Sparkles,
  dispatch: ClipboardList,
  sessions: Timer,
  customers: Users,
  players: User,
  catalog: BookOpen,
  finance: Wallet,
  settlements: Banknote,
  disputes: ShieldAlert,
  audit: ScrollText,
  overview: Gauge,
  live: Radio,
  risk: AlertTriangle,
  finrisk: Shield,
  health: Bell,
  settings: Settings,
};
