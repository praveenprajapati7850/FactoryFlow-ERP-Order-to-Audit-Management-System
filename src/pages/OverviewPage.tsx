import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { RefreshCw, AlertTriangle, ArrowRight } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR } from '../utils/erpMath';
import { useAuth } from '../context/AuthContext';
import { PageHeader, MetricCard, LoadingSkeleton, AlertBanner, StatusText } from '../components/ui/DataPrimitives';
import type { NavKey } from '../components/Layout';

interface DashboardData {
  kpis: {
    todaysOrdersCount: number;
    totalOrdersCount: number;
    monthlySalesPaise: number;
    totalRevenuePaise: number;
    pendingOrdersCount: number;
    finishedGoodsStock: number;
    rawMaterialStockKgL: number;
    lowStockCount: number;
    productionRunsCount: number;
    productionYieldPct: number;
    wastagePct: number;
    avgCostPerPacketPaise: number;
    totalOutstandingPaise: number;
  };
  lowStockAlerts: Array<{ name: string; stock: number; min: number; unit: string; category: string }>;
  benchmarkSnapshot: {
    rawMaterials: Array<{ code: string; name: string; currentStock: number; unit: string; weightedAvgRatePaise: number }>;
    packagingMaterials: Array<{ code: string; name: string; currentStock: number; unit: string; weightedAvgRatePaise: number }>;
    finishedGoods: Array<{ sku: string; name: string; currentStock: number; unit: string; avgCostPaise: number; sellingPricePaise: number }>;
  };
  charts: {
    monthlySalesTrend: Array<{ month: string; salesRupees: number }>;
    productWiseSales: Array<{ name: string; salesRupees: number; qty: number }>;
    productionVsSales: Array<{ product: string; producedQty: number; soldQty: number }>;
    rawMaterialConsumption: Array<{ material: string; planned: number; actual: number; unit: string }>;
    stockMovements: Array<{ type: string; qtyIn: number; qtyOut: number }>;
    outstandingPayments: Array<{ customer: string; collectedRupees: number; outstandingRupees: number }>;
  };
  recentTransactions: Array<{
    id: number;
    transactionId: string;
    itemCategory: string;
    itemName: string;
    movementType: string;
    qtyIn: number;
    qtyOut: number;
    runningBalance: number;
    unit: string;
    referenceNo: string;
    createdAt: string;
  }>;
}

export const OverviewPage: React.FC<{ onNavigate: (key: NavKey) => void }> = ({ onNavigate }) => {
  const { user } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<DashboardData>('/api/dashboard');
      setData(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load dashboard');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !data) {
    return (
      <div className="space-y-6">
        <PageHeader title="Operations Overview" subtitle="Real-time order, production, inventory, and financial telemetry" />
        <LoadingSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Operations Overview"
        subtitle="Live database metrics across orders, production yield, weighted-average costing, inventory, and receivables."
        actions={
          <>
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              Refresh
            </button>
            {user?.roleCode === 'SALESMAN' ? (
              <button
                type="button"
                onClick={() => onNavigate('orders')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
              >
                New Sales Order
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : user?.roleCode === 'PRODUCTION_SUPERVISOR' ? (
              <button
                type="button"
                onClick={() => onNavigate('production')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
              >
                New Production Run
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onNavigate('reports')}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
              >
                Auditor Reports
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </>
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}

      {data && (
        <>
          {/* Primary KPI Grid — All 12 required owner metrics */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
            <MetricCard
              label="Total Revenue (Posted)"
              value={formatINR(data.kpis.totalRevenuePaise)}
              detail={`This month: ${formatINR(data.kpis.monthlySalesPaise)}`}
              tone="success"
            />
            <MetricCard
              label="Outstanding Receivables"
              value={formatINR(data.kpis.totalOutstandingPaise)}
              detail="Across active GST invoices"
              tone={data.kpis.totalOutstandingPaise > 0 ? 'warning' : 'success'}
            />
            <MetricCard
              label="Orders Today / Pending"
              value={`${data.kpis.todaysOrdersCount} / ${data.kpis.pendingOrdersCount}`}
              detail={`Total orders recorded: ${data.kpis.totalOrdersCount}`}
            />
            <MetricCard
              label="Finished Goods Stock"
              value={`${data.kpis.finishedGoodsStock} pkts`}
              detail={`Raw materials: ${data.kpis.rawMaterialStockKgL} kg/L`}
            />
            <MetricCard
              label="Production Runs"
              value={data.kpis.productionRunsCount}
              detail={`Yield: ${data.kpis.productionYieldPct.toFixed(2)}%`}
            />
            <MetricCard
              label="Production Yield vs Wastage"
              value={`${data.kpis.productionYieldPct.toFixed(1)}%`}
              detail={`Wastage: ${data.kpis.wastagePct.toFixed(1)}% of expected`}
              tone={data.kpis.wastagePct > 3 ? 'danger' : 'success'}
            />
            <MetricCard
              label="Avg Cost per Packet"
              value={formatINR(data.kpis.avgCostPerPacketPaise)}
              detail="Weighted average valuation"
            />
            <MetricCard
              label="Low Stock Alerts"
              value={data.kpis.lowStockCount}
              detail={data.kpis.lowStockCount > 0 ? 'Reorder required immediately' : 'All stock above minimum'}
              tone={data.kpis.lowStockCount > 0 ? 'danger' : 'success'}
            />
          </div>

          {/* Live Benchmark Inventory Verification Strip */}
          <section className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-slate-200">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Live Closing Stock Balances (Benchmark Verification)
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  Computed from permanent stock ledger: Opening + Purchases + Production Receipts − Production Issues − Dispatches
                </p>
              </div>
              {user?.roleCode !== 'SALESMAN' && (
                <button
                  type="button"
                  onClick={() => onNavigate('inventory')}
                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 whitespace-nowrap"
                >
                  Open Stock Ledger →
                </button>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {data.benchmarkSnapshot.rawMaterials.map((rm) => {
                const u = rm.unit === 'litre' ? 'L' : rm.unit;
                return (
                  <div key={rm.code} className="border-r last:border-r-0 border-slate-100 pr-3 min-w-0">
                    <div className="text-xs text-slate-500 truncate" title={rm.name}>{rm.name}</div>
                    <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {rm.currentStock} <span className="text-xs font-normal text-slate-500">{rm.unit}</span>
                    </div>
                    <div className="text-xs font-mono text-slate-500 whitespace-nowrap">
                      Avg {formatINR(rm.weightedAvgRatePaise)}/{u}
                    </div>
                  </div>
                );
              })}
              {data.benchmarkSnapshot.packagingMaterials.map((pk) => {
                const u = pk.unit === 'pieces' ? 'pc' : pk.unit;
                return (
                  <div key={pk.code} className="border-r last:border-r-0 border-slate-100 pr-3 min-w-0">
                    <div className="text-xs text-slate-500 truncate" title={pk.name}>{pk.name}</div>
                    <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-slate-900 whitespace-nowrap">
                      {pk.currentStock} <span className="text-xs font-normal text-slate-500">{pk.unit}</span>
                    </div>
                    <div className="text-xs font-mono text-slate-500 whitespace-nowrap">
                      Avg {formatINR(pk.weightedAvgRatePaise)}/{u}
                    </div>
                  </div>
                );
              })}
              {data.benchmarkSnapshot.finishedGoods
                .filter((p) => p.sku === 'FG-MRK-200')
                .map((fg) => (
                  <div key={fg.sku} className="pr-1 min-w-0">
                    <div className="text-xs font-medium text-indigo-700 truncate" title={fg.name}>{fg.name}</div>
                    <div className="mt-1 text-lg font-semibold font-mono tabular-nums text-indigo-700 whitespace-nowrap">
                      {fg.currentStock} <span className="text-xs font-normal text-indigo-500">{fg.unit}</span>
                    </div>
                    <div className="text-xs font-mono text-slate-500 whitespace-nowrap">
                      Sell {formatINR(fg.sellingPricePaise)} · Avg {formatINR(fg.avgCostPaise)}
                    </div>
                  </div>
                ))}
            </div>
          </section>

          {/* 6 Interactive Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* 1. Monthly Sales Trend */}
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Monthly Sales Trend (INR)</h3>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.charts.monthlySalesTrend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`} />
                    <Area type="monotone" dataKey="salesRupees" name="Sales (₹)" stroke="#4f46e5" fill="#e0e7ff" strokeWidth={2} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 2. Product-wise Sales */}
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Product-wise Sales Revenue (INR)</h3>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.charts.productWiseSales}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`} />
                    <Bar dataKey="salesRupees" name="Revenue (₹)" fill="#0f172a" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 3. Production vs Sales */}
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Production vs Sales (Packets)</h3>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.charts.productionVsSales}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="product" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="producedQty" name="Produced" fill="#16a34a" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="soldQty" name="Invoiced" fill="#4f46e5" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 4. Raw Material Consumption: Planned vs Actual */}
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Raw Material Consumption (Planned vs Actual)</h3>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.charts.rawMaterialConsumption}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="material" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="planned" name="Planned Qty" fill="#64748b" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="actual" name="Actual Issued" fill="#d97706" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 5. Stock Movement Summary */}
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Stock Movement Volume (In vs Out)</h3>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.charts.stockMovements}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="type" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="qtyIn" name="Qty In" fill="#16a34a" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="qtyOut" name="Qty Out" fill="#dc2626" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* 6. Outstanding Payments */}
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <h3 className="text-sm font-semibold text-slate-900 mb-4">Collected vs Outstanding Payments (INR)</h3>
              <div className="h-60">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.charts.outstandingPayments}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="customer" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(v) => `₹${Number(v ?? 0).toLocaleString('en-IN')}`} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Bar dataKey="collectedRupees" name="Collected (₹)" fill="#16a34a" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                    <Bar dataKey="outstandingRupees" name="Outstanding (₹)" fill="#dc2626" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Bottom Split: Low Stock Alerts + Recent Stock Transactions */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">Low Stock Alerts</h3>
                <AlertTriangle className="w-4 h-4 text-red-600" aria-hidden="true" />
              </div>
              {data.lowStockAlerts.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">All materials and finished SKUs are above minimum threshold.</p>
              ) : (
                <div className="divide-y divide-slate-100 mt-2">
                  {data.lowStockAlerts.map((a, idx) => (
                    <div key={idx} className="py-2.5 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">{a.name}</div>
                        <div className="text-xs text-slate-500">
                          {a.category} · Min {a.min} {a.unit}
                        </div>
                      </div>
                      <div className="text-right font-mono tabular-nums shrink-0">
                        <div className="text-sm font-semibold text-red-700">
                          {a.stock} {a.unit}
                        </div>
                        <div className="text-xs text-red-600">Low Stock</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="xl:col-span-2 bg-white border border-slate-200 rounded-lg p-5 overflow-x-auto">
              <div className="flex items-center justify-between pb-3 border-b border-slate-200">
                <h3 className="text-sm font-semibold text-slate-900">Recent Inventory Ledger Transactions</h3>
                {user?.roleCode !== 'SALESMAN' && (
                  <button
                    type="button"
                    onClick={() => onNavigate('inventory')}
                    className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
                  >
                    View Full Ledger
                  </button>
                )}
              </div>
              <table className="w-full text-left border-collapse mt-2 text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-medium">Txn ID</th>
                    <th className="py-2 pr-3 font-medium">Item</th>
                    <th className="py-2 pr-3 font-medium">Movement</th>
                    <th className="py-2 pr-3 font-medium text-right">In / Out</th>
                    <th className="py-2 pr-3 font-medium text-right">Balance</th>
                    <th className="py-2 font-medium">Ref</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.recentTransactions.map((t) => (
                    <tr key={t.id} className="hover:bg-slate-50">
                      <td className="py-2 pr-3 font-mono text-slate-600 whitespace-nowrap">{t.transactionId}</td>
                      <td className="py-2 pr-3 font-medium text-slate-900">{t.itemName}</td>
                      <td className="py-2 pr-3">
                        <StatusText status={t.movementType} />
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums text-right whitespace-nowrap">
                        {t.qtyIn > 0 ? (
                          <span className="text-emerald-700">+{t.qtyIn}</span>
                        ) : (
                          <span className="text-red-700">-{t.qtyOut}</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 font-mono tabular-nums text-right whitespace-nowrap font-semibold text-slate-900">
                        {t.runningBalance} {t.unit}
                      </td>
                      <td className="py-2 font-mono text-slate-600 whitespace-nowrap">{t.referenceNo}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
