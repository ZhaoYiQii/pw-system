"use client";

import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import { DEMO_STATUS_META, type DemoOrderStatus } from "./demo-data";

export function DemoStatusBadge({ status }: { status: DemoOrderStatus }) {
  const meta = DEMO_STATUS_META[status];
  return <span className={`mc-status st-${meta.tone}`}>{meta.label}</span>;
}

export function useDemoToast(): {
  toast: ReactNode;
  showToast: (message: string) => void;
} {
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(null), 1800);
    return () => window.clearTimeout(timer);
  }, [message]);

  return {
    toast: message ? (
      <div className="mc-toast" role="status" aria-live="polite">
        {message}
      </div>
    ) : null,
    showToast: (text: string) => setMessage(text),
  };
}

export function DemoDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!open) return null;
  return (
    <div
      className="mc-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="mc-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="demo-dialog-title"
      >
        <h2 id="demo-dialog-title">{title}</h2>
        <div className="mc-dialog-body">{children}</div>
        <div className="mc-modal-actions">
          <button type="button" className="mc-btn" onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={`mc-btn mc-btn-primary${destructive ? " mc-btn-danger" : ""}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DemoEmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="mc-empty">
      <h3>{title}</h3>
      <p>{description}</p>
      {children}
    </div>
  );
}

export function DemoIconButton({
  label,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" className="mc-icon-btn" aria-label={label} {...props}>
      {props.children}
    </button>
  );
}
