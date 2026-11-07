import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
  XCircle,
} from 'lucide-react';
import { DRIVER_META } from '../lib/utils';
import { useAppStore } from '../store/appStore';
import type { Driver } from '../types';

export function Spinner({ size = 14, className = '' }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`spin ${className}`} />;
}

export function DriverBadge({ driver, size = 'md' }: { driver: Driver; size?: 'sm' | 'md' | 'lg' }) {
  const meta = DRIVER_META[driver];
  return (
    <span
      className={`driver-badge driver-badge-${size}`}
      style={{ '--driver-color': meta.color } as CSSProperties}
      title={meta.label}
    >
      {meta.short}
    </span>
  );
}

interface ModalProps {
  open: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
  className?: string;
  closeOnOverlay?: boolean;
  hideClose?: boolean;
}

export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 560,
  className = '',
  closeOnOverlay = true,
  hideClose = false,
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (closeOnOverlay && event.target === event.currentTarget) onClose();
      }}
    >
      <div className={`modal-card ${className}`} style={{ width }} role="dialog" aria-modal="true">
        <div className="modal-header">
          <div className="modal-title-block">
            <h2>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {!hideClose ? (
            <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
              <X size={16} />
            </button>
          ) : null}
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  disabled?: boolean;
  shortcut?: string;
  separator?: boolean;
  header?: boolean;
  checked?: boolean;
}

export function Dropdown({
  trigger,
  items,
  align = 'left',
  className = '',
  menuClassName = '',
}: {
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'left' | 'right';
  className?: string;
  menuClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handlePointer);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handlePointer);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div className={`dropdown ${className}`} ref={rootRef}>
      <div className="dropdown-trigger-wrap" onClick={() => setOpen((value) => !value)}>
        {trigger}
      </div>
      {open ? (
        <div className={`dropdown-menu ${align === 'right' ? 'dropdown-menu-right' : ''} ${menuClassName}`}>
          {items.map((item, index) => {
            if (item.separator) return <div className="menu-separator" key={`sep-${index}`} />;
            if (item.header) return <div className="menu-header" key={`header-${index}`}>{item.label}</div>;
            return (
              <button
                key={`${item.label}-${index}`}
                type="button"
                className={`menu-item ${item.danger ? 'danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
              >
                <span className="menu-item-icon">{item.icon}</span>
                <span className="menu-item-label">{item.label}</span>
                {item.checked ? <span className="menu-item-check">✓</span> : null}
                {item.shortcut ? <kbd className="menu-shortcut">{item.shortcut}</kbd> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const nextLeft = Math.min(x, window.innerWidth - rect.width - 8);
    const nextTop = Math.min(y, window.innerHeight - rect.height - 8);
    setPosition({ left: Math.max(8, nextLeft), top: Math.max(8, nextTop) });
  }, [x, y]);

  useEffect(() => {
    const close = () => onClose();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', close);
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      className="context-menu"
      style={{ left: position.left, top: position.top }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      {items.map((item, index) => {
        if (item.separator) return <div className="menu-separator" key={`sep-${index}`} />;
        if (item.header) return <div className="menu-header" key={`header-${index}`}>{item.label}</div>;
        return (
          <button
            key={`${item.label}-${index}`}
            type="button"
            className={`menu-item ${item.danger ? 'danger' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.onClick?.();
            }}
          >
            <span className="menu-item-icon">{item.icon}</span>
            <span className="menu-item-label">{item.label}</span>
            {item.shortcut ? <kbd className="menu-shortcut">{item.shortcut}</kbd> : null}
          </button>
        );
      })}
    </div>,
    document.body,
  );
}

export function ToastViewport() {
  const toasts = useAppStore((state) => state.toasts);
  const dismiss = useAppStore((state) => state.dismissToast);
  return createPortal(
    <div className="toast-stack">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.kind}`}>
          <span className="toast-icon">
            {toast.kind === 'success' ? <CheckCircle2 size={16} /> : null}
            {toast.kind === 'error' ? <XCircle size={16} /> : null}
            {toast.kind === 'warning' ? <AlertTriangle size={16} /> : null}
            {toast.kind === 'info' ? <Info size={16} /> : null}
          </span>
          <div className="toast-content">
            <strong>{toast.message}</strong>
            {toast.detail ? <span>{toast.detail}</span> : null}
          </div>
          <button type="button" className="icon-btn toast-close" onClick={() => dismiss(toast.id)} aria-label="关闭通知">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export function ConfirmDialog() {
  const confirm = useAppStore((state) => state.confirm);
  const clearConfirm = useAppStore((state) => state.clearConfirm);
  const toast = useAppStore((state) => state.toast);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setBusy(false);
  }, [confirm]);

  if (!confirm) return null;

  const handleConfirm = async () => {
    setBusy(true);
    try {
      await confirm.onConfirm();
      clearConfirm();
    } catch (error) {
      toast('error', '操作失败', error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={confirm.title}
      onClose={() => {
        if (!busy) clearConfirm();
      }}
      width={430}
      closeOnOverlay={!busy}
      hideClose={busy}
      footer={
        <>
          <button type="button" className="btn" onClick={clearConfirm} disabled={busy}>
            {confirm.cancelText ?? '取消'}
          </button>
          <button
            type="button"
            className={`btn ${confirm.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={handleConfirm}
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            {confirm.confirmText ?? '确认'}
          </button>
        </>
      }
    >
      <div className={`confirm-message ${confirm.danger ? 'danger' : ''}`}>
        <span className="confirm-icon">
          {confirm.danger ? <AlertTriangle size={20} /> : <Info size={20} />}
        </span>
        <p>{confirm.message}</p>
      </div>
    </Modal>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  return (
    <label className={`switch-wrap ${disabled ? 'disabled' : ''}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        className={`switch ${checked ? 'on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
        disabled={disabled}
      >
        <span className="switch-thumb" />
      </button>
      {label ? <span>{label}</span> : null}
    </label>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <div className={`empty-state ${compact ? 'compact' : ''}`}>
      <div className="empty-state-icon">{icon}</div>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state-actions">{action}</div> : null}
    </div>
  );
}
