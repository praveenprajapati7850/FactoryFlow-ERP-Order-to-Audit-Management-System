import React, { useEffect, useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { Download, FileSpreadsheet, FileText, ArrowUpDown, RotateCcw, Plus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR, INDIAN_STATES } from '../utils/erpMath';
import { exportReportCsv, exportReportExcel, exportReportPdf } from '../utils/exporters';
import { useAuth, RoleCode } from '../context/AuthContext';
import { PageHeader, MetricCard, StatusText, AlertBanner, Modal, LoadingSkeleton } from '../components/ui/DataPrimitives';

// ===================== COSTING PAGE =====================
interface CostingRun {
  id: number;
  runNo: string;
  runDate: string;
  productName: string;
  actualGoodOutputQty: number;
  rawMaterialCostPaise: number;
  packagingCostPaise: number;
  labourCostPaise: number;
  gasPowerCostPaise: number;
  otherOverheadPaise: number;
  totalCostPaise: number;
  costPerPacketPaise: number;
  sellingPricePaise: number;
  grossMarginPaise: number;
  grossMarginPct: number;
}

export const CostingPage: React.FC = () => {
  const { company } = useAuth();
  const [runs, setRuns] = useState<CostingRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<CostingRun[]>('/api/production-runs')
      .then(setRuns)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load costing'))
      .finally(() => setLoading(false));
  }, []);

  const totalCostPaise = runs.reduce((s, r) => s + r.totalCostPaise, 0);
  const totalGoodPkts = runs.reduce((s, r) => s + r.actualGoodOutputQty, 0);
  const weightedCostPerPkt = totalGoodPkts > 0 ? Math.round(totalCostPaise / totalGoodPkts) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production Costing Engine"
        subtitle="Integer-paisa weighted average inventory valuation across raw materials, packaging, labour, gas/power, and overheads."
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}

      <div className="bg-white border border-slate-200 rounded-lg p-4 text-xs text-slate-600 space-y-1">
        <div>
          <strong className="text-slate-900">Valuation Method:</strong>{' '}
          {company?.costingMethod === 'STANDARD_COST' ? 'Standard Costing' : 'Weighted Average Cost (Default)'} ·{' '}
          <strong className="text-slate-900">Arithmetic:</strong> Exact Integer Paise (zero floating-point drift)
        </div>
        <div>
          <strong className="text-slate-900">Formula:</strong> Total Production Cost = Raw Material + Packaging + Labour + Gas/Power + Other Overheads · Cost per Good Packet = Total Production Cost ÷ Actual Good Output
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <MetricCard label="Cumulative Production Cost" value={formatINR(totalCostPaise)} />
            <MetricCard label="Total Good Output" value={`${totalGoodPkts} pkts`} />
            <MetricCard label="Weighted Avg Cost / Packet" value={formatINR(weightedCostPerPkt)} tone="success" />
          </div>

          {runs.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h2 className="text-sm font-semibold text-slate-900 mb-4">Batch Cost Composition (INR)</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={runs.map((r) => ({
                      runNo: r.runNo,
                      RawMaterial: r.rawMaterialCostPaise / 100,
                      Packaging: r.packagingCostPaise / 100,
                      Labour: r.labourCostPaise / 100,
                      GasPower: r.gasPowerCostPaise / 100,
                      Overheads: r.otherOverheadPaise / 100,
                    }))}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="runNo" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="RawMaterial" stackId="a" fill="#0f172a" name="Raw Material" />
                    <Bar dataKey="Packaging" stackId="a" fill="#4f46e5" name="Packaging" />
                    <Bar dataKey="Labour" stackId="a" fill="#0891b2" name="Labour" />
                    <Bar dataKey="GasPower" stackId="a" fill="#d97706" name="Gas & Power" />
                    <Bar dataKey="Overheads" stackId="a" fill="#94a3b8" name="Overheads" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-3 px-3 font-semibold">Run No</th>
                  <th className="py-3 px-3 font-semibold">Product</th>
                  <th className="py-3 px-3 font-semibold text-right">Raw Mat</th>
                  <th className="py-3 px-3 font-semibold text-right">Packaging</th>
                  <th className="py-3 px-3 font-semibold text-right">Labour</th>
                  <th className="py-3 px-3 font-semibold text-right">Gas/Power</th>
                  <th className="py-3 px-3 font-semibold text-right">Overheads</th>
                  <th className="py-3 px-3 font-semibold text-right">Total Cost</th>
                  <th className="py-3 px-3 font-semibold text-right">Good Pkts</th>
                  <th className="py-3 px-3 font-semibold text-right">Cost / Pkt</th>
                  <th className="py-3 px-3 font-semibold text-right">Selling</th>
                  <th className="py-3 px-3 font-semibold text-right">Gross Margin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                {runs.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-3 px-3 font-bold text-indigo-700 whitespace-nowrap">{r.runNo}</td>
                    <td className="py-3 px-3 font-sans font-semibold text-slate-900">{r.productName}</td>
                    <td className="py-3 px-3 text-right">{formatINR(r.rawMaterialCostPaise)}</td>
                    <td className="py-3 px-3 text-right">{formatINR(r.packagingCostPaise)}</td>
                    <td className="py-3 px-3 text-right">{formatINR(r.labourCostPaise)}</td>
                    <td className="py-3 px-3 text-right">{formatINR(r.gasPowerCostPaise)}</td>
                    <td className="py-3 px-3 text-right">{formatINR(r.otherOverheadPaise)}</td>
                    <td className="py-3 px-3 text-right font-bold text-slate-900">{formatINR(r.totalCostPaise)}</td>
                    <td className="py-3 px-3 text-right">{r.actualGoodOutputQty}</td>
                    <td className="py-3 px-3 text-right font-bold text-indigo-700">{formatINR(r.costPerPacketPaise)}</td>
                    <td className="py-3 px-3 text-right">{formatINR(r.sellingPricePaise)}</td>
                    <td className="py-3 px-3 text-right font-bold text-emerald-700">
                      {formatINR(r.grossMarginPaise)} ({r.grossMarginPct}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
};

// ===================== 15 AUDITOR REPORTS PAGE =====================
const REPORT_CATALOG = [
  { key: 'sales-register', label: '1. Sales Register' },
  { key: 'customer-sales', label: '2. Customer-wise Sales' },
  { key: 'product-sales', label: '3. Product-wise Sales' },
  { key: 'gst-summary', label: '4. GST Summary (GSTR-1/3B)' },
  { key: 'purchase-register', label: '5. Purchase Register' },
  { key: 'raw-stock', label: '6. Raw Material Stock Summary' },
  { key: 'packaging-stock', label: '7. Packaging Stock Summary' },
  { key: 'finished-stock', label: '8. Finished Goods Stock Summary' },
  { key: 'stock-ledger', label: '9. Stock Ledger' },
  { key: 'production-report', label: '10. Production Report' },
  { key: 'planned-vs-actual', label: '11. Planned vs Actual Consumption' },
  { key: 'yield-wastage', label: '12. Yield and Wastage Report' },
  { key: 'product-costing', label: '13. Product Costing Report' },
  { key: 'payments-collections', label: '14. Payments and Collections' },
  { key: 'customer-outstanding', label: '15. Customer Outstanding Report' },
];

interface ReportPayload {
  key: string;
  title: string;
  disclaimer: string;
  from: string;
  to: string;
  columns: string[];
  rows: Record<string, string | number>[];
}

export const ReportsPage: React.FC = () => {
  const [activeKey, setActiveKey] = useState(REPORT_CATALOG[0].key);
  const [fromDate, setFromDate] = useState('2026-04-01');
  const [toDate, setToDate] = useState('2027-03-31');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string>('');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const pageSize = 12;

  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = async (key: string, from: string, to: string) => {
    setLoading(true);
    setError(null);
    setPage(1);
    setSortCol('');
    try {
      const data = await apiFetch<ReportPayload>(
        `/api/reports/${key}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      setReport(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate report');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadReport(activeKey, fromDate, toDate);
  }, [activeKey, fromDate, toDate]);

  const processedRows = useMemo(() => {
    if (!report) return [];
    let list = report.rows;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((r) => Object.values(r).some((v) => String(v).toLowerCase().includes(q)));
    }
    if (sortCol) {
      list = [...list].sort((a, b) => {
        const av = a[sortCol];
        const bv = b[sortCol];
        if (typeof av === 'number' && typeof bv === 'number') {
          return sortDir === 'asc' ? av - bv : bv - av;
        }
        return sortDir === 'asc'
          ? String(av ?? '').localeCompare(String(bv ?? ''))
          : String(bv ?? '').localeCompare(String(av ?? ''));
      });
    }
    return list;
  }, [report, search, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(processedRows.length / pageSize));
  const paginatedRows = processedRows.slice((page - 1) * pageSize, page * pageSize);

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statutory & Auditor Reporting Suite"
        subtitle="15 filterable, sortable, and paginated financial, GST, production, costing, and inventory reports with CSV, Excel, and PDF export."
        actions={
          report && (
            <>
              <button
                type="button"
                onClick={() => exportReportCsv(`factoryflow-${report.key}`, report.columns, processedRows)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                CSV
              </button>
              <button
                type="button"
                onClick={() =>
                  exportReportExcel(`factoryflow-${report.key}`, report.title, report.columns, processedRows)
                }
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg whitespace-nowrap"
              >
                <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                Excel
              </button>
              <button
                type="button"
                onClick={() =>
                  exportReportPdf(
                    `factoryflow-${report.key}`,
                    report.title,
                    `Period: ${fromDate} to ${toDate}${report.disclaimer ? ` | ${report.disclaimer}` : ''}`,
                    report.columns,
                    processedRows
                  )
                }
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                PDF
              </button>
            </>
          )
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
        {/* Report Selector List */}
        <div className="bg-white border border-slate-200 rounded-lg p-3 space-y-0.5 h-fit">
          <div className="px-2.5 py-2 text-xs font-semibold text-slate-500">Select Report (15)</div>
          {REPORT_CATALOG.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => setActiveKey(item.key)}
              className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                activeKey === item.key
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-700 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Active Report Table */}
        <div className="lg:col-span-3 space-y-4 min-w-0">
          <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="rep-from" className="block text-xs text-slate-600 mb-1">
                From Date
              </label>
              <input
                id="rep-from"
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div>
              <label htmlFor="rep-to" className="block text-xs text-slate-600 mb-1">
                To Date
              </label>
              <input
                id="rep-to"
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                className="px-2.5 py-1.5 text-xs font-mono border border-slate-300 rounded-md"
              />
            </div>
            <div className="flex-1 min-w-[200px]">
              <label htmlFor="rep-search" className="block text-xs text-slate-600 mb-1">
                Search rows
              </label>
              <input
                id="rep-search"
                type="search"
                placeholder="Filter by invoice, material, customer..."
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                className="w-full px-3 py-1.5 text-xs border border-slate-300 rounded-md"
              />
            </div>
          </div>

          {report?.disclaimer && <AlertBanner tone="info" message={report.disclaimer} />}

          {loading || !report ? (
            <LoadingSkeleton rows={6} />
          ) : (
            <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">{report.title}</h2>
                <span className="text-xs font-mono text-slate-500">{processedRows.length} record(s)</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                      {report.columns.map((col) => (
                        <th key={col} className="py-2.5 px-3 font-semibold whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => toggleSort(col)}
                            className="inline-flex items-center gap-1 hover:text-slate-900"
                          >
                            {col}
                            <ArrowUpDown className="w-3 h-3 opacity-50" aria-hidden="true" />
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paginatedRows.length === 0 ? (
                      <tr>
                        <td colSpan={report.columns.length} className="py-8 text-center text-slate-500">
                          No records found for this period or search filter.
                        </td>
                      </tr>
                    ) : (
                      paginatedRows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-slate-50">
                          {report.columns.map((col) => {
                            const val = row[col];
                            const isNum = typeof val === 'number';
                            return (
                              <td
                                key={col}
                                className={`py-2.5 px-3 whitespace-nowrap ${
                                  isNum ? 'font-mono tabular-nums text-right text-slate-900' : 'text-slate-700'
                                }`}
                              >
                                {isNum ? val.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(val ?? '')}
                              </td>
                            );
                          })}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between text-xs">
                  <span className="text-slate-500">
                    Page {page} of {totalPages}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                      className="px-2.5 py-1 border border-slate-300 rounded disabled:opacity-40"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                      className="px-2.5 py-1 border border-slate-300 rounded disabled:opacity-40"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// ===================== AUDIT TRAIL PAGE =====================
interface AuditRow {
  id: number;
  userName: string;
  userRole: string;
  action: string;
  entity: string;
  referenceId: string;
  previousValue: string | null;
  newValue: string | null;
  createdAt: string;
}

export const AuditTrailPage: React.FC = () => {
  const [logs, setLogs] = useState<AuditRow[]>([]);
  const [entityFilter, setEntityFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    apiFetch<AuditRow[]>(`/api/audit-logs?entity=${entityFilter}`)
      .then(setLogs)
      .finally(() => setLoading(false));
  }, [entityFilter]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Immutable Audit Trail"
        subtitle="Append-only operational history capturing user, action, entity, before/after snapshots, reference ID, and timestamp."
      />

      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto w-fit">
        {['ALL', 'Order', 'Invoice', 'Purchase', 'Stock', 'BOM', 'ProductionRun', 'Payment', 'User', 'Auth'].map(
          (ent) => (
            <button
              key={ent}
              type="button"
              onClick={() => setEntityFilter(ent)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
                entityFilter === ent ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {ent}
            </button>
          )
        )}
      </div>

      {loading ? (
        <LoadingSkeleton rows={6} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-semibold">Timestamp</th>
                <th className="py-3 px-4 font-semibold">User / Role</th>
                <th className="py-3 px-4 font-semibold">Action</th>
                <th className="py-3 px-4 font-semibold">Entity / Ref</th>
                <th className="py-3 px-4 font-semibold">Previous Value</th>
                <th className="py-3 px-4 font-semibold">New Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50 align-top">
                  <td className="py-2.5 px-4 font-mono text-slate-500 whitespace-nowrap">
                    {l.createdAt.slice(0, 19).replace('T', ' ')}
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    <div className="font-semibold text-slate-900">{l.userName}</div>
                    <div className="text-[11px] font-mono text-slate-500">{l.userRole}</div>
                  </td>
                  <td className="py-2.5 px-4 font-mono font-semibold text-indigo-700 whitespace-nowrap">
                    {l.action}
                  </td>
                  <td className="py-2.5 px-4 whitespace-nowrap">
                    <span className="font-medium text-slate-900">{l.entity}</span>
                    <div className="font-mono text-[11px] text-slate-500">{l.referenceId}</div>
                  </td>
                  <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500 max-w-xs break-all">
                    {l.previousValue || '—'}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-[11px] text-slate-800 max-w-xs break-all">
                    {l.newValue || '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ===================== USER MANAGEMENT PAGE =====================
interface UserRow {
  id: number;
  email: string;
  name: string;
  roleCode: RoleCode;
  phone: string;
  isActive: boolean;
}

interface RoleRow {
  id: number;
  code: string;
  name: string;
  description: string;
}

export const UsersPage: React.FC = () => {
  const { user } = useAuth();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<RoleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: 'Password@123',
    roleCode: 'SALESMAN' as RoleCode,
    phone: '',
  });

  const [pendingRoleDrafts, setPendingRoleDrafts] = useState<Record<number, RoleCode>>({});
  const canManage = user && ['OWNER', 'ADMIN'].includes(user.roleCode);
  const isOwner = user?.roleCode === 'OWNER';
  const assignableRoles: RoleCode[] = isOwner
    ? ['SALESMAN', 'PRODUCTION_SUPERVISOR', 'AUDITOR', 'ADMIN', 'OWNER']
    : ['SALESMAN', 'PRODUCTION_SUPERVISOR', 'AUDITOR', 'ADMIN'];

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ users: UserRow[]; roles: RoleRow[] }>('/api/users');
      setUsers(res.users);
      setRoles(res.roles);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load users');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/users', { method: 'POST', body: form });
      setSuccess(`User "${form.name}" created with role ${form.roleCode}.`);
      setAddOpen(false);
      setForm({ name: '', email: '', password: 'Password@123', roleCode: 'SALESMAN', phone: '' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create user');
    }
  };

  const handleApprovePending = async (u: UserRow) => {
    setError(null);
    setSuccess(null);
    const chosenRole = pendingRoleDrafts[u.id] || 'SALESMAN';
    try {
      await apiFetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: { roleCode: chosenRole, isActive: true },
      });
      setSuccess(`Approved ${u.name} (${u.email}) with role ${chosenRole}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const handleRoleChange = async (u: UserRow, nextRole: RoleCode) => {
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: { roleCode: nextRole },
      });
      setSuccess(`Updated role for ${u.name} to ${nextRole}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Role update failed');
    }
  };

  const handleToggleActive = async (u: UserRow) => {
    setError(null);
    setSuccess(null);
    try {
      await apiFetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        body: { isActive: !u.isActive },
      });
      setSuccess(`Updated active status for ${u.name}.`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const pendingUsers = users.filter((u) => u.roleCode === 'PENDING');

  return (
    <div className="space-y-6">
      <PageHeader
        title="User Management & Role Access Control"
        subtitle="Manage ERP operators, approve pending Google sign-in accounts, and enforce backend role permissions."
        actions={
          canManage && (
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add User
            </button>
          )
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      {pendingUsers.length > 0 && canManage && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-3">
          <div className="text-sm font-semibold text-amber-950">
            Pending Registration Approvals ({pendingUsers.length})
          </div>
          <p className="text-xs text-amber-800">
            New Google Sign-In users are blocked from authentication until an administrator assigns an operational role and activates the account.
          </p>
          <div className="divide-y divide-amber-200/70">
            {pendingUsers.map((pu) => (
              <div key={pu.id} className="py-2.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-semibold text-slate-900">{pu.name}</span>
                  <span className="mx-2 text-amber-400">·</span>
                  <span className="font-mono text-slate-700">{pu.email}</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    aria-label={`Assign role for ${pu.email}`}
                    value={pendingRoleDrafts[pu.id] || 'SALESMAN'}
                    onChange={(e) =>
                      setPendingRoleDrafts({ ...pendingRoleDrafts, [pu.id]: e.target.value as RoleCode })
                    }
                    className="px-2.5 py-1.5 text-xs border border-amber-300 rounded-md bg-white"
                  >
                    {assignableRoles.map((r) => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => handleApprovePending(pu)}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md whitespace-nowrap"
                  >
                    Approve & Activate
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-3 px-4 font-semibold">Name</th>
                  <th className="py-3 px-4 font-semibold">Email</th>
                  <th className="py-3 px-4 font-semibold">Role</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  {canManage && <th className="py-3 px-4 font-semibold text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((u) => {
                  const lockedOwner = u.roleCode === 'OWNER' && !isOwner;
                  const isSelf = u.id === user?.id;
                  return (
                    <tr key={u.id} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-semibold text-slate-900">{u.name}</td>
                      <td className="py-3 px-4 font-mono text-slate-600">{u.email}</td>
                      <td className="py-3 px-4 font-mono font-medium text-indigo-700">
                        {canManage && !lockedOwner && u.roleCode !== 'PENDING' ? (
                          <select
                            aria-label={`Change role for ${u.email}`}
                            value={u.roleCode}
                            onChange={(e) => handleRoleChange(u, e.target.value as RoleCode)}
                            className="px-2 py-1 text-xs font-mono border border-slate-200 rounded bg-white text-indigo-700"
                          >
                            {assignableRoles.map((r) => (
                              <option key={r} value={r}>
                                {r}
                              </option>
                            ))}
                          </select>
                        ) : (
                          u.roleCode
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText
                          status={u.roleCode === 'PENDING' ? 'PENDING APPROVAL' : u.isActive ? 'ACTIVE' : 'INACTIVE'}
                        />
                      </td>
                      {canManage && (
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          {u.roleCode === 'PENDING' ? (
                            <button
                              type="button"
                              onClick={() => handleApprovePending(u)}
                              className="text-emerald-700 hover:text-emerald-900 font-semibold"
                            >
                              Approve
                            </button>
                          ) : lockedOwner || isSelf ? (
                            <span className="text-slate-400">Protected</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleActive(u)}
                              className="text-indigo-600 hover:text-indigo-800 font-medium"
                            >
                              {u.isActive ? 'Deactivate' : 'Activate'}
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
            <h2 className="text-sm font-semibold text-slate-900 pb-2 border-b border-slate-200">
              Backend RBAC Role Matrix
            </h2>
            {roles.map((r) => (
              <div key={r.id} className="text-xs pb-2 border-b last:border-b-0 border-slate-100">
                <div className="font-semibold text-slate-900">
                  {r.name} <span className="font-mono text-indigo-700">({r.code})</span>
                </div>
                <p className="text-slate-500 mt-0.5">{r.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Create ERP User">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Role</label>
              <select
                value={form.roleCode}
                onChange={(e) => setForm({ ...form, roleCode: e.target.value as RoleCode })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="SALESMAN">Salesman</option>
                <option value="ADMIN">Admin</option>
                <option value="PRODUCTION_SUPERVISOR">Production Supervisor</option>
                {isOwner && <option value="OWNER">Owner</option>}
                <option value="AUDITOR">Auditor (Read-Only)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Initial Password</label>
              <input
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAddOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Create User
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

// ===================== SETTINGS & BENCHMARK CONTROL PAGE =====================
export const SettingsPage: React.FC = () => {
  const { user, refreshProfile } = useAuth();
  const [form, setForm] = useState({
    companyName: '',
    gstin: '',
    address: '',
    state: 'Tamil Nadu',
    stateCode: '33',
    phone: '',
    email: '',
    varianceTolerancePct: 3,
    costingMethod: 'WEIGHTED_AVERAGE' as 'WEIGHTED_AVERAGE' | 'STANDARD_COST',
    invoicePrefix: 'FF',
    financialYear: '2026-27',
  });
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canManage = user && ['OWNER', 'ADMIN'].includes(user.roleCode);

  useEffect(() => {
    apiFetch<typeof form>('/api/settings')
      .then((res) => {
        if (res) setForm(res);
      })
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/settings', {
        method: 'PUT',
        body: { ...form, varianceTolerancePct: Number(form.varianceTolerancePct) },
      });
      await refreshProfile();
      setSuccess('Factory and statutory settings saved.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleResetBenchmark = async () => {
    setResetting(true);
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/benchmark/reset', { method: 'POST' });
      await refreshProfile();
      setSuccess(
        'Database reset to Mandatory Benchmark: Flour 120 kg, Oil 19.5 L, Spice 3.8 kg, Pouches 306 pcs, Cartons 21 pcs, Murukku 238 → 88 pkts (after Retailer A 150-pkt dispatch), Retailer A Outstanding ₹3,875, Distributor B Shortage 32 pkts.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed');
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Company & ERP Configuration"
        subtitle="Configure factory GSTIN, home state for CGST/SGST vs IGST determination, variance alert threshold, and benchmark seed state."
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <form onSubmit={handleSave} className="xl:col-span-2 bg-white border border-slate-200 rounded-lg p-6 space-y-4">
            <h2 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-200">
              Factory & Tax Jurisdiction Profile
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Company Legal Name</label>
                <input
                  disabled={!canManage}
                  value={form.companyName}
                  onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">GSTIN</label>
                <input
                  disabled={!canManage}
                  value={form.gstin}
                  onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Factory State</label>
                <select
                  disabled={!canManage}
                  value={form.state}
                  onChange={(e) => {
                    const st = INDIAN_STATES.find((s) => s.name === e.target.value);
                    setForm({ ...form, state: e.target.value, stateCode: st?.code || '33' });
                  }}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
                >
                  {INDIAN_STATES.map((s) => (
                    <option key={s.code} value={s.name}>
                      {s.name} ({s.code})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Variance Alert Tolerance (%)</label>
                <input
                  type="number"
                  step="0.5"
                  disabled={!canManage}
                  value={form.varianceTolerancePct}
                  onChange={(e) => setForm({ ...form, varianceTolerancePct: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-50"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Inventory Costing Method</label>
                <select
                  disabled={!canManage}
                  value={form.costingMethod}
                  onChange={(e) => setForm({ ...form, costingMethod: e.target.value as 'WEIGHTED_AVERAGE' | 'STANDARD_COST' })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white disabled:bg-slate-50"
                >
                  <option value="WEIGHTED_AVERAGE">Weighted Average (Recommended)</option>
                  <option value="STANDARD_COST">Standard Cost</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Invoice Prefix & FY</label>
                <div className="flex gap-2">
                  <input
                    disabled={!canManage}
                    value={form.invoicePrefix}
                    onChange={(e) => setForm({ ...form, invoicePrefix: e.target.value })}
                    className="w-24 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-50"
                  />
                  <input
                    disabled={!canManage}
                    value={form.financialYear}
                    onChange={(e) => setForm({ ...form, financialYear: e.target.value })}
                    className="flex-1 px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg disabled:bg-slate-50"
                  />
                </div>
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-slate-700 mb-1">Factory Address</label>
                <input
                  disabled={!canManage}
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg disabled:bg-slate-50"
                />
              </div>
            </div>
            {canManage && (
              <div className="pt-2">
                <button
                  type="submit"
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
                >
                  Save Settings
                </button>
              </div>
            )}
          </form>

          {/* Mandatory Benchmark Scenario Control */}
          <div className="bg-white border border-slate-200 rounded-lg p-6 space-y-4 h-fit">
            <h2 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-200">
              Mandatory Benchmark Demo Seed
            </h2>
            <p className="text-xs text-slate-600 leading-relaxed">
              Reloads the NIT Tiruchirappalli Murukku 200 g Order-to-Audit benchmark inside a single PostgreSQL transaction:
              Opening Stock → Step 1 Purchase (60 kg flour @ ₹45/kg) → Step 2 Production Run (188 good pkts, 6 damaged pouches, 10.5 L oil) → Step 3 Retailer A Invoice/Dispatch/Partial Payment & Distributor B Shortage Check.
            </p>
            <div className="text-xs font-mono text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-1">
              <div>Flour: 100 + 60 − 40 = <strong>120 kg</strong> (avg ₹43.125/kg)</div>
              <div>Cooking Oil: 30 − 10.5 = <strong>19.5 L</strong> (+5% variance)</div>
              <div>Spice Mix: 5 − 1.2 = <strong>3.8 kg</strong></div>
              <div>200 g Pouches: 500 − 188 − 6 = <strong>306 pcs</strong></div>
              <div>Cartons: 30 − 9 = <strong>21 pcs</strong></div>
              <div>Murukku after Prod: 50 + 188 = <strong>238 pkts</strong> (₹27.42/pkt)</div>
              <div>Murukku after Dispatch: 238 − 150 = <strong>88 pkts</strong></div>
              <div>Retailer A Invoice: <strong>₹7,875</strong> (CGST ₹187.50 + SGST ₹187.50)</div>
              <div>Retailer A Outstanding: ₹7,875 − ₹4,000 = <strong>₹3,875</strong></div>
              <div>Distributor B Shortage: 120 − 88 = <strong>32 pkts</strong></div>
            </div>
            {canManage && (
              <button
                type="button"
                disabled={resetting}
                onClick={handleResetBenchmark}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:opacity-50 rounded-lg"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                {resetting ? 'Resetting Database...' : 'Reset to Benchmark State'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
