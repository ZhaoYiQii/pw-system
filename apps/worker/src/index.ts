export interface QueueCapability {
  ready: false;
  reason: "QUEUE_NOT_CONFIGURED_IN_SLICE_0";
}

export interface WorkerRuntime {
  queue: QueueCapability;
}

/**
 * Slice 0 只建立 worker 骨架。队列/Outbox/AI 消费能力由后续切片
 * （Slice 9 通知与重试、Slice 10 AI）实现；未实现能力返回 typed unsupported，
 * 不得伪装成功。
 */
export function inspectRuntime(): WorkerRuntime {
  return {
    queue: { ready: false, reason: "QUEUE_NOT_CONFIGURED_IN_SLICE_0" },
  };
}
