import React from 'react';
import { X, AlertCircle, CheckCircle2, AlertTriangle, Info } from 'lucide-react';

export const PageHeader: React.FC<{
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}> = ({ title, subtitle, actions }) => (
  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-5 border-b border-slate-200">
    <div className="min-w-0">
      <h1 className="text-2xl font-bold tracking-tight text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-600">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2.5 shrink-0 flex-wrap">{actions}</div>}
  </div>
);

export const MetricCard: React.FC<{
  label: string;
  value: string | number;
  detail?: string;
  tone?: 'default' | 'success' | 'warning' | 'danger';
}> = ({ label, value, detail, tone = 'default' }) => {
  const valueTone =
    tone === 'success'
      ? 'text-emerald-700'
      : tone === 'warning'
        ? 'text-amber-700'
        : tone === 'danger'
          ? 'text-red-700'
          : 'text-slate-900';

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1.5 text-2xl font-semibold font-mono tabular-nums tracking-tight ${valueTone}`}>
        {value}
      </div>
      {detail && <div className="mt-1 text-xs text-slate-500 truncate">{detail}</div>}
    </div>
  );
};

export const StatusText: React.FC<{
  status: string;
}> = ({ status }) => {
  const norm = status.toUpperCase();
  let cls = 'text-slate-700';
  if (['APPROVED', 'PAID', 'DISPATCHED', 'COMPLETED', 'RECEIVED', 'NOMINAL', 'ACTIVE', 'WITHIN TOLERANCE', 'WITHIN LIMIT'].includes(norm)) {
    cls = 'text-emerald-700';
  } else if (['SUBMITTED', 'PARTIALLY_PAID', 'PARTIAL', 'PENDING', 'INVOICED', 'POSTED', 'DRAFT'].includes(norm)) {
    cls = 'text-amber-700';
  } else if (['REJECTED', 'REVERSED', 'CANCELLED', 'LOW STOCK', 'VARIANCE ALERT', 'EXCEEDS TOLERANCE', 'FLAGGED (>3%)', 'INACTIVE'].includes(norm)) {
    cls = 'text-red-700';
  }
  const label = status.replace(/_/g, ' ');
  return <span className={`text-xs font-semibold tracking-tight whitespace-nowrap ${cls}`}>{label}</span>;
};

export const AlertBanner: React.FC<{
  tone: 'error' | 'success' | 'warning' | 'info';
  message: string;
  onDismiss?: () => void;
}> = ({ tone, message, onDismiss }) => {
  const styles = {
    error: 'bg-red-50 border-red-200 text-red-800',
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-900',
    info: 'bg-indigo-50 border-indigo-200 text-indigo-900',
  }[tone];

  const Icon =
    tone === 'error'
      ? AlertCircle
      : tone === 'success'
        ? CheckCircle2
        : tone === 'warning'
          ? AlertTriangle
          : Info;

  return (
    <div
      role="alert"
      className={`flex items-start justify-between gap-3 px-4 py-3 text-sm border rounded-lg ${styles}`}
    >
      <div className="flex items-start gap-2.5">
        <Icon className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
        <span>{message}</span>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="p-0.5 opacity-70 hover:opacity-100"
        >
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
};

export const Modal: React.FC<{
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidthClass?: string;
  children: React.ReactNode;
}> = ({ open, onClose, title, subtitle, maxWidthClass = 'max-w-2xl', children }) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`w-full ${maxWidthClass} bg-white border border-slate-200 rounded-xl shadow-xl max-h-[92vh] flex flex-col overflow-hidden`}>
        <div className="flex items-start justify-between gap-4 px-5 sm:px-6 py-4 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="p-1.5 text-slate-500 hover:text-slate-800 rounded-md hover:bg-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5 sm:p-6 overflow-y-auto flex-1">{children}</div>
      </div>
    </div>
  );
};

export const LoadingSkeleton: React.FC<{ rows?: number }> = ({ rows = 5 }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-3" aria-busy="true">
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />
    ))}
  </div>
);

export const EmptyState: React.FC<{
  title: string;
  description: string;
  action?: React.ReactNode;
}> = ({ title, description, action }) => (
  <div className="bg-white border border-slate-200 rounded-lg p-10 text-center">
    <h3 className="text-base font-semibold text-slate-900">{title}</h3>
    <p className="mt-1 text-sm text-slate-500 max-w-md mx-auto">{description}</p>
    {action && <div className="mt-4">{action}</div>}
  </div>
);
