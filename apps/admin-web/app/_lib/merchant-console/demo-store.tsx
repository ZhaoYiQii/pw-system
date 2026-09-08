"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  INITIAL_DEMO_ORDERS,
  type AiDraftSpec,
  type DemoOrder,
  type DemoSeatRole,
  type DemoStatusTone,
} from "./demo-data";
import type { RecordModuleId } from "./record-data";

export interface NewDraftSpec {
  customer: string;
  game: string;
  mode: string;
  durationMinutes: number;
  roles: DemoSeatRole[];
}

interface DemoStoreValue {
  orders: DemoOrder[];
  aiDraft: AiDraftSpec | null;
  recordOverrides: Record<string, RecordStatusOverride | undefined>;
  setAiDraft: (draft: AiDraftSpec | null) => void;
  setRecordStatus: (
    moduleId: RecordModuleId,
    recordId: string,
    statusLabel: string,
    tone: DemoStatusTone,
  ) => void;
  publishOrder: (orderId: string) => void;
  completeOrder: (orderId: string) => void;
  confirmSelections: (orderId: string, applicantIds: string[]) => void;
  removeApplicant: (orderId: string, applicantId: string) => void;
  createDraft: (spec: NewDraftSpec) => DemoOrder;
  resetData: () => void;
}

export interface RecordStatusOverride {
  statusLabel: string;
  tone: DemoStatusTone;
}

const DemoStoreContext = createContext<DemoStoreValue | null>(null);

function nextDemoOrderNumber(orders: DemoOrder[]): number {
  return Math.max(...orders.map((order) => Number.parseInt(order.id, 10))) + 1;
}

function recordKey(moduleId: RecordModuleId, recordId: string): string {
  return `${moduleId}:${recordId}`;
}

export function DemoStoreProvider({ children }: { children: ReactNode }) {
  const [orders, setOrders] = useState<DemoOrder[]>(INITIAL_DEMO_ORDERS);
  const [aiDraft, setAiDraftState] = useState<AiDraftSpec | null>(null);
  const [recordOverrides, setRecordOverrides] = useState<
    Record<string, RecordStatusOverride>
  >({});
  const nextOrderNumberRef = useRef(nextDemoOrderNumber(INITIAL_DEMO_ORDERS));

  const setAiDraft = useCallback((draft: AiDraftSpec | null) => {
    setAiDraftState(draft);
  }, []);

  const setRecordStatus = useCallback(
    (
      moduleId: RecordModuleId,
      recordId: string,
      statusLabel: string,
      tone: DemoStatusTone,
    ) => {
      const key = recordKey(moduleId, recordId);
      setRecordOverrides((prev) => ({
        ...prev,
        [key]: { statusLabel, tone },
      }));
    },
    [],
  );

  const publishOrder = useCallback((orderId: string) => {
    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? { ...order, status: "DISPATCHING" as const }
          : order,
      ),
    );
  }, []);

  const completeOrder = useCallback((orderId: string) => {
    setOrders((prev) =>
      prev.map((order) =>
        order.id === orderId
          ? { ...order, status: "COMPLETED" as const }
          : order,
      ),
    );
  }, []);

  const confirmSelections = useCallback(
    (orderId: string, applicantIds: string[]) => {
      setOrders((prev) =>
        prev.map((order) => {
          if (order.id !== orderId) return order;
          const nextPlayers = order.players.map((player) =>
            applicantIds.includes(player.id)
              ? { ...player, status: "SELECTED" as const }
              : player,
          );
          const allFilled = order.roles.every((role) => {
            const occupied = nextPlayers.filter(
              (player) =>
                player.role === role.name && player.status === "SELECTED",
            ).length;
            return occupied >= role.need;
          });
          return {
            ...order,
            players: nextPlayers,
            status: allFilled
              ? ("ASSIGNED" as const)
              : ("DISPATCHING" as const),
          };
        }),
      );
    },
    [],
  );

  const removeApplicant = useCallback(
    (orderId: string, applicantId: string) => {
      setOrders((prev) =>
        prev.map((order) =>
          order.id === orderId
            ? {
                ...order,
                players: order.players.filter(
                  (player) => player.id !== applicantId,
                ),
              }
            : order,
        ),
      );
    },
    [],
  );

  const createDraft = useCallback((spec: NewDraftSpec) => {
    const nextNumber = nextOrderNumberRef.current;
    nextOrderNumberRef.current += 1;
    const draft: DemoOrder = {
      id: String(nextNumber),
      game: spec.game,
      mode: spec.mode,
      customer: spec.customer,
      status: "DRAFT",
      duration: spec.durationMinutes,
      time: "待定",
      roles: spec.roles.map((role) => ({ ...role })),
      players: [],
    };
    setOrders((prev) => [draft, ...prev]);
    return draft;
  }, []);

  const resetData = useCallback(() => {
    setOrders(INITIAL_DEMO_ORDERS);
    setRecordOverrides({});
  }, []);

  const value = useMemo(
    () => ({
      orders,
      aiDraft,
      recordOverrides,
      setAiDraft,
      setRecordStatus,
      publishOrder,
      completeOrder,
      confirmSelections,
      removeApplicant,
      createDraft,
      resetData,
    }),
    [
      orders,
      aiDraft,
      recordOverrides,
      setAiDraft,
      setRecordStatus,
      publishOrder,
      completeOrder,
      confirmSelections,
      removeApplicant,
      createDraft,
      resetData,
    ],
  );

  return (
    <DemoStoreContext.Provider value={value}>
      {children}
    </DemoStoreContext.Provider>
  );
}

export function useDemoStore(): DemoStoreValue {
  const ctx = useContext(DemoStoreContext);
  if (!ctx) {
    throw new Error("useDemoStore 必须在 DemoStoreProvider 内使用");
  }
  return ctx;
}
