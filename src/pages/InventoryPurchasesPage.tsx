import React, { useEffect, useState } from 'react';
import { Plus, SlidersHorizontal, AlertTriangle, Pencil } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR, INDIAN_STATES } from '../utils/erpMath';
import { useAuth } from '../context/AuthContext';
import { PageHeader, StatusText, AlertBanner, Modal, LoadingSkeleton } from '../components/ui/DataPrimitives';

interface RawMat {
  id: number;
  name: string;
  code: string;
  unit: string;
  minStockLevel: number;
  currentStock: number;
  weightedAvgRatePaise: number;
  totalValuationPaise: number;
}

interface PackMat {
  id: number;
  name: string;
  code: string;
  unit: string;
  minStockLevel: number;
  currentStock: number;
  weightedAvgRatePaise: number;
  totalValuationPaise: number;
}

interface FinProd {
  id: number;
  name: string;
  sku: string;
  unit: string;
  minStockLevel: number;
  currentStock: number;
  avgCostPaise: number;
  sellingPricePaise: number;
}

interface LedgerRow {
  id: number;
  transactionId: string;
  itemCategory: string;
  itemName: string;
  unit: string;
  movementType: string;
  qtyIn: number;
  qtyOut: number;
  unitCostPaise: number;
  runningBalance: number;
  referenceType: string;
  referenceNo: string;
  notes: string;
  userName: string;
  createdAt: string;
}

export const InventoryPage: React.FC = () => {
  const { user } = useAuth();
  const [tab, setTab] = useState<'RAW' | 'PACKAGING' | 'FINISHED' | 'LEDGER'>('RAW');
  const [summary, setSummary] = useState<{
    rawMaterials: RawMat[];
    packagingMaterials: PackMat[];
    finishedGoods: FinProd[];
    lowStockAlerts: Array<{ category: string; code: string; name: string; currentStock: number; minStockLevel: number; unit: string }>;
  } | null>(null);
  const [ledger, setLedger] = useState<LedgerRow[]>([]);
  const [ledgerCat, setLedgerCat] = useState('ALL');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Stock Adjustment Modal (NEVER overwrites stock directly — posts permanent ledger entry!)
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjForm, setAdjForm] = useState({
    itemCategory: 'RAW' as 'RAW' | 'PACKAGING' | 'FINISHED',
    itemId: 0,
    direction: 'IN' as 'IN' | 'OUT',
    quantity: 1,
    unitCostRupees: 0,
    movementType: 'ADJUSTMENT' as 'ADJUSTMENT' | 'SALES_RETURN' | 'OPENING',
    reason: '',
  });

  const canWrite = user && ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'].includes(user.roleCode);

  const load = async () => {
    setLoading(true);
    try {
      const [sum, led] = await Promise.all([
        apiFetch<NonNullable<typeof summary>>('/api/inventory/summary'),
        apiFetch<LedgerRow[]>('/api/inventory/ledger'),
      ]);
      setSummary(sum);
      setLedger(led);
      if (sum.rawMaterials.length > 0 && adjForm.itemId === 0) {
        setAdjForm((f) => ({ ...f, itemId: sum.rawMaterials[0].id }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inventory');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const currentItemsForCategory = (cat: 'RAW' | 'PACKAGING' | 'FINISHED') => {
    if (!summary) return [];
    if (cat === 'RAW') return summary.rawMaterials.map((r) => ({ id: r.id, label: `${r.name} (${r.currentStock} ${r.unit})` }));
    if (cat === 'PACKAGING') return summary.packagingMaterials.map((p) => ({ id: p.id, label: `${p.name} (${p.currentStock} ${p.unit})` }));
    return summary.finishedGoods.map((f) => ({ id: f.id, label: `${f.name} (${f.currentStock} ${f.unit})` }));
  };

  const handlePostAdjustment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/inventory/adjust', {
        method: 'POST',
        body: {
          ...adjForm,
          quantity: Number(adjForm.quantity),
          unitCostRupees: adjForm.unitCostRupees > 0 ? Number(adjForm.unitCostRupees) : undefined,
        },
      });
      setSuccess('Stock movement recorded permanently in the inventory ledger.');
      setAdjOpen(false);
      setAdjForm((f) => ({ ...f, reason: '', quantity: 1 }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adjustment failed');
    }
  };

  const visibleLedger =
    ledgerCat === 'ALL' ? ledger : ledger.filter((l) => l.itemCategory === ledgerCat);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Inventory & Permanent Stock Ledger"
        subtitle="Independent balances for raw materials, packaging, and finished goods. Balances update exclusively through permanent ledger entries."
        actions={
          canWrite && (
            <button
              type="button"
              onClick={() => setAdjOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              Post Stock Adjustment
            </button>
          )
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      {/* Stock equation banner */}
      <div className="bg-white border border-slate-200 rounded-lg px-4 py-3 text-xs text-slate-600 flex flex-wrap items-center justify-between gap-2">
        <span>
          <strong className="text-slate-900">Ledger Invariant:</strong> Opening Stock + Purchases + Production Receipts − Production Issues − Sales Dispatches ± Adjustments = Closing Stock
        </span>
        {summary && summary.lowStockAlerts.length > 0 && (
          <span className="inline-flex items-center gap-1.5 font-semibold text-red-700">
            <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
            {summary.lowStockAlerts.length} Low Stock Alert(s)
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg w-fit overflow-x-auto">
        {[
          { key: 'RAW', label: `Raw Materials (${summary?.rawMaterials.length ?? 0})` },
          { key: 'PACKAGING', label: `Packaging (${summary?.packagingMaterials.length ?? 0})` },
          { key: 'FINISHED', label: `Finished Goods (${summary?.finishedGoods.length ?? 0})` },
          { key: 'LEDGER', label: `Stock Ledger (${ledger.length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key as typeof tab)}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap ${
              tab === t.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loading || !summary ? (
        <LoadingSkeleton rows={5} />
      ) : tab === 'RAW' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-semibold">Code</th>
                <th className="py-3 px-4 font-semibold">Raw Material</th>
                <th className="py-3 px-4 font-semibold text-right">Closing Stock</th>
                <th className="py-3 px-4 font-semibold text-right">Min Level</th>
                <th className="py-3 px-4 font-semibold text-right">Weighted Avg Rate</th>
                <th className="py-3 px-4 font-semibold text-right">Total Valuation</th>
                <th className="py-3 px-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.rawMaterials.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono text-slate-600">{r.code}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{r.name}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                    {r.currentStock} {r.unit}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                    {r.minStockLevel} {r.unit}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                    {formatINR(r.weightedAvgRatePaise)}/{r.unit}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {formatINR(r.totalValuationPaise)}
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={r.currentStock <= r.minStockLevel ? 'LOW STOCK' : 'NOMINAL'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'PACKAGING' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-semibold">Code</th>
                <th className="py-3 px-4 font-semibold">Packaging Material</th>
                <th className="py-3 px-4 font-semibold text-right">Closing Stock</th>
                <th className="py-3 px-4 font-semibold text-right">Min Level</th>
                <th className="py-3 px-4 font-semibold text-right">Weighted Avg Rate</th>
                <th className="py-3 px-4 font-semibold text-right">Total Valuation</th>
                <th className="py-3 px-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.packagingMaterials.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono text-slate-600">{p.code}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{p.name}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                    {p.currentStock} {p.unit}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                    {p.minStockLevel} {p.unit}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                    {formatINR(p.weightedAvgRatePaise)}/{p.unit}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {formatINR(p.totalValuationPaise)}
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={p.currentStock <= p.minStockLevel ? 'LOW STOCK' : 'NOMINAL'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : tab === 'FINISHED' ? (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-semibold">SKU</th>
                <th className="py-3 px-4 font-semibold">Finished Product</th>
                <th className="py-3 px-4 font-semibold text-right">Closing Stock</th>
                <th className="py-3 px-4 font-semibold text-right">Min Level</th>
                <th className="py-3 px-4 font-semibold text-right">Avg Production Cost</th>
                <th className="py-3 px-4 font-semibold text-right">Selling Price</th>
                <th className="py-3 px-4 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.finishedGoods.map((f) => (
                <tr key={f.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono text-slate-600">{f.sku}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{f.name}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-indigo-700">
                    {f.currentStock} {f.unit}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                    {f.minStockLevel} {f.unit}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-800">
                    {formatINR(f.avgCostPaise)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-900">
                    {formatINR(f.sellingPricePaise)}
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={f.currentStock <= f.minStockLevel ? 'LOW STOCK' : 'NOMINAL'} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {['ALL', 'RAW', 'PACKAGING', 'FINISHED'].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setLedgerCat(c)}
                className={`px-3 py-1 text-xs font-medium rounded border ${
                  ledgerCat === c
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3 font-semibold">Transaction ID</th>
                  <th className="py-2.5 px-3 font-semibold">Timestamp</th>
                  <th className="py-2.5 px-3 font-semibold">Item</th>
                  <th className="py-2.5 px-3 font-semibold">Movement</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Qty In</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Qty Out</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Running Balance</th>
                  <th className="py-2.5 px-3 font-semibold">Reference</th>
                  <th className="py-2.5 px-3 font-semibold">User</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleLedger.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">{m.transactionId}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 whitespace-nowrap">
                      {m.createdAt.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="font-medium text-slate-900">{m.itemName}</div>
                      <div className="text-[11px] text-slate-500">{m.notes}</div>
                    </td>
                    <td className="py-2.5 px-3">
                      <StatusText status={m.movementType} />
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-emerald-700">
                      {m.qtyIn > 0 ? `+${m.qtyIn}` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-red-700">
                      {m.qtyOut > 0 ? `-${m.qtyOut}` : '—'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 whitespace-nowrap">
                      {m.runningBalance} {m.unit}
                    </td>
                    <td className="py-2.5 px-3 font-mono text-slate-600 whitespace-nowrap">{m.referenceNo}</td>
                    <td className="py-2.5 px-3 text-slate-600 whitespace-nowrap">{m.userName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stock Adjustment Modal */}
      <Modal
        open={adjOpen}
        onClose={() => setAdjOpen(false)}
        title="Post Permanent Stock Adjustment"
        subtitle="Stock balances are never overwritten directly; this creates a permanent ledger transaction and audit entry."
      >
        <form onSubmit={handlePostAdjustment} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Inventory Category</label>
              <select
                value={adjForm.itemCategory}
                onChange={(e) => {
                  const cat = e.target.value as 'RAW' | 'PACKAGING' | 'FINISHED';
                  const items = currentItemsForCategory(cat);
                  setAdjForm({ ...adjForm, itemCategory: cat, itemId: items[0]?.id || 0 });
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="RAW">Raw Material</option>
                <option value="PACKAGING">Packaging Material</option>
                <option value="FINISHED">Finished Goods</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Item</label>
              <select
                value={adjForm.itemId}
                onChange={(e) => setAdjForm({ ...adjForm, itemId: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {currentItemsForCategory(adjForm.itemCategory).map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Movement Type</label>
              <select
                value={adjForm.movementType}
                onChange={(e) => setAdjForm({ ...adjForm, movementType: e.target.value as 'ADJUSTMENT' | 'SALES_RETURN' | 'OPENING' })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="ADJUSTMENT">Physical Audit Adjustment</option>
                <option value="SALES_RETURN">Sales Return</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Direction</label>
              <select
                value={adjForm.direction}
                onChange={(e) => setAdjForm({ ...adjForm, direction: e.target.value as 'IN' | 'OUT' })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="IN">Stock In (+)</option>
                <option value="OUT">Stock Out (-)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Quantity</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                required
                value={adjForm.quantity}
                onChange={(e) => setAdjForm({ ...adjForm, quantity: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            {adjForm.direction === 'IN' && (
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">Unit Cost Override (₹, optional)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={adjForm.unitCostRupees}
                  onChange={(e) => setAdjForm({ ...adjForm, unitCostRupees: Number(e.target.value) })}
                  className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                />
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Audit Reason (Required)</label>
            <input
              required
              minLength={3}
              value={adjForm.reason}
              onChange={(e) => setAdjForm({ ...adjForm, reason: e.target.value })}
              placeholder="e.g., Physical cycle count reconciliation"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAdjOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Record Ledger Movement
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

// ===================== PURCHASES PAGE =====================
interface SupplierRec {
  id: number;
  name: string;
  gstin: string;
  phone: string;
  email: string;
  address: string;
  state: string;
  stateCode: string;
  isActive: boolean;
}

interface PurchaseRec {
  id: number;
  purchaseNo: string;
  supplierName: string;
  supplierGstin: string;
  purchaseDate: string;
  invoiceRef: string;
  status: string;
  subtotalPaise: number;
  gstPaise: number;
  totalPaise: number;
  notes: string;
  items: Array<{
    id: number;
    materialCategory: string;
    materialName: string;
    quantity: number;
    unit: string;
    ratePaise: number;
    gstPct: number;
    lineTotalPaise: number;
  }>;
}

export const PurchasesPage: React.FC = () => {
  const { user } = useAuth();
  const [purchases, setPurchases] = useState<PurchaseRec[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierRec[]>([]);
  const [raws, setRaws] = useState<RawMat[]>([]);
  const [packs, setPacks] = useState<PackMat[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [poModalOpen, setPoModalOpen] = useState(false);
  const [supModalOpen, setSupModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<SupplierRec | null>(null);

  const [poForm, setPoForm] = useState({
    supplierId: 0,
    purchaseDate: new Date().toISOString().slice(0, 10),
    invoiceRef: '',
    notes: '',
    materialCategory: 'RAW' as 'RAW' | 'PACKAGING',
    materialId: 0,
    quantity: 60,
    unit: 'kg',
    rateRupees: 45,
    gstPct: 5,
  });

  const [supForm, setSupForm] = useState({
    name: '',
    gstin: '',
    phone: '',
    email: '',
    address: '',
    state: 'Tamil Nadu',
    stateCode: '33',
  });

  const canWrite = user && ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'].includes(user.roleCode);
  const canManageSupplierStatus = user && ['OWNER', 'ADMIN'].includes(user.roleCode);

  const load = async () => {
    setLoading(true);
    try {
      const [pos, sups, inv] = await Promise.all([
        apiFetch<PurchaseRec[]>('/api/purchases'),
        apiFetch<SupplierRec[]>('/api/suppliers'),
        apiFetch<{ rawMaterials: RawMat[]; packagingMaterials: PackMat[] }>('/api/inventory/summary'),
      ]);
      setPurchases(pos);
      setSuppliers(sups);
      setRaws(inv.rawMaterials);
      setPacks(inv.packagingMaterials);
      const firstActiveSupplier = sups.find((s) => s.isActive) || sups[0];
      if (firstActiveSupplier && poForm.supplierId === 0) {
        setPoForm((f) => ({
          ...f,
          supplierId: firstActiveSupplier.id,
          materialId: inv.rawMaterials[0]?.id || 0,
          unit: inv.rawMaterials[0]?.unit || 'kg',
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load purchases');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRecordPurchase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/purchases', {
        method: 'POST',
        body: {
          supplierId: Number(poForm.supplierId),
          purchaseDate: poForm.purchaseDate,
          invoiceRef: poForm.invoiceRef,
          notes: poForm.notes,
          items: [
            {
              materialCategory: poForm.materialCategory,
              materialId: Number(poForm.materialId),
              quantity: Number(poForm.quantity),
              unit: poForm.unit,
              rateRupees: Number(poForm.rateRupees),
              gstPct: Number(poForm.gstPct),
            },
          ],
        },
      });
      setSuccess('Purchase receipt posted. Weighted-average material rate and stock ledger updated.');
      setPoModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Purchase posting failed');
    }
  };

  const openAddSupplier = () => {
    setEditingSupplier(null);
    setSupForm({ name: '', gstin: '', phone: '', email: '', address: '', state: 'Tamil Nadu', stateCode: '33' });
    setSupModalOpen(true);
  };

  const openEditSupplier = (s: SupplierRec) => {
    setEditingSupplier(s);
    setSupForm({
      name: s.name,
      gstin: s.gstin,
      phone: s.phone,
      email: s.email || '',
      address: s.address,
      state: s.state,
      stateCode: s.stateCode,
    });
    setSupModalOpen(true);
  };

  const handleSaveSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      if (editingSupplier) {
        await apiFetch(`/api/suppliers/${editingSupplier.id}`, { method: 'PUT', body: supForm });
        setSuccess(`Supplier "${supForm.name}" updated.`);
      } else {
        await apiFetch('/api/suppliers', { method: 'POST', body: supForm });
        setSuccess(`Supplier "${supForm.name}" added.`);
      }
      setSupModalOpen(false);
      setEditingSupplier(null);
      setSupForm({ name: '', gstin: '', phone: '', email: '', address: '', state: 'Tamil Nadu', stateCode: '33' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save supplier');
    }
  };

  const handleToggleSupplierStatus = async (s: SupplierRec) => {
    setError(null);
    setSuccess(null);
    try {
      const nextStatus = !s.isActive;
      const res = await apiFetch<SupplierRec & { historicalPurchaseCount?: number }>(
        `/api/suppliers/${s.id}/status`,
        {
          method: 'PATCH',
          body: { isActive: nextStatus },
        }
      );
      setSuccess(
        nextStatus
          ? `Supplier "${s.name}" reactivated.`
          : `Supplier "${s.name}" safely deactivated (${res.historicalPurchaseCount ?? 0} historical purchase(s) preserved).`
      );
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update supplier status');
    }
  };

  const materialOptions = poForm.materialCategory === 'RAW' ? raws : packs;
  const activeSuppliers = suppliers.filter((s) => s.isActive);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchases & Supplier Receipts"
        subtitle="Record raw material and packaging purchase receipts. Automatically recalculates weighted-average rates and posts ledger inflows."
        actions={
          canWrite && (
            <>
              <button
                type="button"
                onClick={openAddSupplier}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
              >
                Add Supplier
              </button>
              <button
                type="button"
                onClick={() => setPoModalOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                Record Purchase Receipt
              </button>
            </>
          )
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="xl:col-span-2 bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-200 text-sm font-semibold text-slate-900">
              Purchase Register ({purchases.length})
            </div>
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3 font-semibold">PO No</th>
                  <th className="py-2.5 px-3 font-semibold">Date</th>
                  <th className="py-2.5 px-3 font-semibold">Supplier & Items</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Subtotal</th>
                  <th className="py-2.5 px-3 font-semibold text-right">GST</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {purchases.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-3 px-3 font-mono font-semibold text-slate-900 whitespace-nowrap">{p.purchaseNo}</td>
                    <td className="py-3 px-3 font-mono text-slate-600 whitespace-nowrap">{p.purchaseDate}</td>
                    <td className="py-3 px-3">
                      <div className="font-semibold text-slate-900">{p.supplierName}</div>
                      {p.items.map((it) => (
                        <div key={it.id} className="text-slate-600 mt-0.5 font-mono">
                          {it.materialName}: {it.quantity} {it.unit} @ {formatINR(it.ratePaise)}/{it.unit}
                        </div>
                      ))}
                    </td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{formatINR(p.subtotalPaise)}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums">{formatINR(p.gstPaise)}</td>
                    <td className="py-3 px-3 text-right font-mono tabular-nums font-bold text-slate-900">
                      {formatINR(p.totalPaise)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <h3 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-200">
              Supplier Master ({suppliers.length})
            </h3>
            <div className="divide-y divide-slate-100 mt-1">
              {suppliers.map((s) => (
                <div key={s.id} className="py-3 text-xs">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-semibold ${s.isActive ? 'text-slate-900' : 'text-slate-400 line-through'}`}>
                          {s.name}
                        </span>
                        <StatusText status={s.isActive ? 'ACTIVE' : 'INACTIVE'} />
                      </div>
                      <div className="font-mono text-slate-500 mt-0.5">{s.gstin}</div>
                      <div className="text-slate-500 mt-0.5">
                        {s.state} ({s.stateCode}) · {s.phone}
                      </div>
                    </div>
                    {canWrite && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openEditSupplier(s)}
                          aria-label={`Edit supplier ${s.name}`}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded"
                        >
                          <Pencil className="w-3 h-3" aria-hidden="true" />
                          Edit
                        </button>
                        {canManageSupplierStatus && (
                          <button
                            type="button"
                            onClick={() => handleToggleSupplierStatus(s)}
                            aria-label={`${s.isActive ? 'Deactivate' : 'Reactivate'} supplier ${s.name}`}
                            className={`px-2 py-1 text-[11px] font-medium border rounded ${
                              s.isActive
                                ? 'text-amber-700 border-amber-300 hover:bg-amber-50'
                                : 'text-emerald-700 border-emerald-300 hover:bg-emerald-50'
                            }`}
                          >
                            {s.isActive ? 'Deactivate' : 'Reactivate'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Record Purchase Modal */}
      <Modal
        open={poModalOpen}
        onClose={() => setPoModalOpen(false)}
        title="Record Purchase Receipt"
        subtitle="Automatically updates stock balances, weighted-average unit rate, and permanent stock ledger."
      >
        <form onSubmit={handleRecordPurchase} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Supplier</label>
              <select
                value={poForm.supplierId}
                onChange={(e) => setPoForm({ ...poForm, supplierId: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {activeSuppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Purchase Date</label>
              <input
                type="date"
                required
                value={poForm.purchaseDate}
                onChange={(e) => setPoForm({ ...poForm, purchaseDate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Category</label>
              <select
                value={poForm.materialCategory}
                onChange={(e) => {
                  const cat = e.target.value as 'RAW' | 'PACKAGING';
                  const opts = cat === 'RAW' ? raws : packs;
                  setPoForm({
                    ...poForm,
                    materialCategory: cat,
                    materialId: opts[0]?.id || 0,
                    unit: opts[0]?.unit || 'kg',
                  });
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="RAW">Raw Material</option>
                <option value="PACKAGING">Packaging Material</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Material</label>
              <select
                value={poForm.materialId}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  const found = materialOptions.find((m) => m.id === id);
                  setPoForm({ ...poForm, materialId: id, unit: found?.unit || poForm.unit });
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {materialOptions.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} (Stock: {m.currentStock} {m.unit})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Quantity ({poForm.unit})</label>
              <input
                type="number"
                step="0.1"
                min="0.1"
                required
                value={poForm.quantity}
                onChange={(e) => setPoForm({ ...poForm, quantity: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Purchase Rate (₹ / {poForm.unit})</label>
              <input
                type="number"
                step="0.01"
                min="0.1"
                required
                value={poForm.rateRupees}
                onChange={(e) => setPoForm({ ...poForm, rateRupees: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">GST %</label>
              <input
                type="number"
                step="0.5"
                min="0"
                max="28"
                value={poForm.gstPct}
                onChange={(e) => setPoForm({ ...poForm, gstPct: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Supplier Bill Ref</label>
              <input
                value={poForm.invoiceRef}
                onChange={(e) => setPoForm({ ...poForm, invoiceRef: e.target.value })}
                placeholder="e.g., INV-2026-991"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={() => setPoModalOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Post Receipt & Update Stock
            </button>
          </div>
        </form>
      </Modal>

      {/* Add / Edit Supplier Modal */}
      <Modal
        open={supModalOpen}
        onClose={() => {
          setSupModalOpen(false);
          setEditingSupplier(null);
        }}
        title={editingSupplier ? `Edit Supplier — ${editingSupplier.name}` : 'Add Supplier'}
        subtitle={
          editingSupplier
            ? 'Updates supplier master details in PostgreSQL and records an audit entry.'
            : 'Registers a new vendor for raw material and packaging procurement.'
        }
      >
        <form onSubmit={handleSaveSupplier} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Supplier Name</label>
              <input
                required
                value={supForm.name}
                onChange={(e) => setSupForm({ ...supForm, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">GSTIN</label>
              <input
                required
                value={supForm.gstin}
                onChange={(e) => setSupForm({ ...supForm, gstin: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input
                required
                value={supForm.phone}
                onChange={(e) => setSupForm({ ...supForm, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Email (optional)</label>
              <input
                type="email"
                value={supForm.email}
                onChange={(e) => setSupForm({ ...supForm, email: e.target.value })}
                placeholder="vendor@example.in"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">State</label>
              <select
                value={supForm.state}
                onChange={(e) => {
                  const st = INDIAN_STATES.find((s) => s.name === e.target.value);
                  setSupForm({ ...supForm, state: e.target.value, stateCode: st?.code || '33' });
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {INDIAN_STATES.map((s) => (
                  <option key={s.code} value={s.name}>
                    {s.name} ({s.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
              <input
                required
                value={supForm.address}
                onChange={(e) => setSupForm({ ...supForm, address: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => {
                setSupModalOpen(false);
                setEditingSupplier(null);
              }}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              {editingSupplier ? 'Update Supplier' : 'Save Supplier'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
