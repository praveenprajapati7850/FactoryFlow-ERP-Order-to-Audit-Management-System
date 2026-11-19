import React, { useEffect, useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  ReferenceLine,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from 'recharts';
import { Plus, Trash2, AlertTriangle, ArrowRightLeft, Play } from 'lucide-react';
import { apiFetch } from '../lib/api';
import {
  formatINR,
  calculateConsumptionVariancePct,
  calculateYieldVariancePct,
  isVarianceExceeded,
  convertUnit,
  roundQty,
  paiseToRupeesNumber,
} from '../utils/erpMath';
import { useAuth } from '../context/AuthContext';
import { PageHeader, StatusText, AlertBanner, Modal, LoadingSkeleton } from '../components/ui/DataPrimitives';

interface BomItemView {
  id: number;
  materialCategory: 'RAW' | 'PACKAGING';
  rawMaterialId: number | null;
  packagingMaterialId: number | null;
  materialName: string;
  materialCode: string;
  standardQty: number;
  unit: string;
  wastageTolerancePct: number;
  currentStock: number;
  stockUnit: string;
  weightedAvgRatePaise: number;
}

interface BomRecord {
  id: number;
  code: string;
  productId: number;
  productName: string;
  productSku: string;
  sellingPricePaise: number;
  name: string;
  batchSize: number;
  expectedOutputQty: number;
  outputUnit: string;
  standardWastageTolerancePct: number;
  standardLabourCostPaise: number;
  standardGasPowerCostPaise: number;
  standardOverheadCostPaise: number;
  items: BomItemView[];
}

interface MaterialOption {
  id: number;
  name: string;
  code: string;
  unit: string;
  currentStock: number;
  weightedAvgRatePaise: number;
}

interface ProductOption {
  id: number;
  name: string;
  sku: string;
  sellingPricePaise: number;
}

export const BomPage: React.FC = () => {
  const { user } = useAuth();
  const [boms, setBoms] = useState<BomRecord[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [raws, setRaws] = useState<MaterialOption[]>([]);
  const [packs, setPacks] = useState<MaterialOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Unit conversion helper state
  const [convQty, setConvQty] = useState(1.2);
  const [convFrom, setConvFrom] = useState('kg');
  const [convTo, setConvTo] = useState('g');

  // Create BOM modal
  const [createOpen, setCreateOpen] = useState(false);
  const [bomForm, setBomForm] = useState({
    code: '',
    productId: 0,
    name: '',
    batchSize: 1,
    expectedOutputQty: 200,
    outputUnit: 'packets',
    standardWastageTolerancePct: 3,
    standardLabourRupees: 600,
    standardGasPowerRupees: 350,
    standardOverheadRupees: 150,
    items: [] as Array<{
      materialCategory: 'RAW' | 'PACKAGING';
      materialId: number;
      standardQty: number;
      unit: string;
      wastageTolerancePct: number;
    }>,
  });

  const canWrite = user && ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'].includes(user.roleCode);

  const load = async () => {
    setLoading(true);
    try {
      const [bList, prods, inv] = await Promise.all([
        apiFetch<BomRecord[]>('/api/boms'),
        apiFetch<ProductOption[]>('/api/products'),
        apiFetch<{ rawMaterials: MaterialOption[]; packagingMaterials: MaterialOption[] }>('/api/inventory/summary'),
      ]);
      setBoms(bList);
      setProducts(prods);
      setRaws(inv.rawMaterials);
      setPacks(inv.packagingMaterials);
      if (prods.length > 0 && bomForm.productId === 0) {
        setBomForm((f) => ({
          ...f,
          productId: prods[0].id,
          items:
            inv.rawMaterials.length > 0
              ? [
                  {
                    materialCategory: 'RAW',
                    materialId: inv.rawMaterials[0].id,
                    standardQty: 40,
                    unit: inv.rawMaterials[0].unit,
                    wastageTolerancePct: 3,
                  },
                ]
              : [],
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load BOMs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreateBom = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/boms', {
        method: 'POST',
        body: {
          code: bomForm.code,
          productId: Number(bomForm.productId),
          name: bomForm.name,
          batchSize: Number(bomForm.batchSize),
          expectedOutputQty: Number(bomForm.expectedOutputQty),
          outputUnit: bomForm.outputUnit,
          standardWastageTolerancePct: Number(bomForm.standardWastageTolerancePct),
          standardLabourRupees: Number(bomForm.standardLabourRupees),
          standardGasPowerRupees: Number(bomForm.standardGasPowerRupees),
          standardOverheadRupees: Number(bomForm.standardOverheadRupees),
          items: bomForm.items.map((it) => ({
            materialCategory: it.materialCategory,
            rawMaterialId: it.materialCategory === 'RAW' ? it.materialId : null,
            packagingMaterialId: it.materialCategory === 'PACKAGING' ? it.materialId : null,
            standardQty: Number(it.standardQty),
            unit: it.unit,
            wastageTolerancePct: Number(it.wastageTolerancePct),
          })),
        },
      });
      setSuccess(`BOM "${bomForm.code}" created successfully.`);
      setCreateOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create BOM');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Bill of Materials (BOM)"
        subtitle="Standard batch recipes specifying raw materials, packaging, unit conversions, expected yield, and variance tolerance."
        actions={
          canWrite && (
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Create BOM Recipe
            </button>
          )
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      {/* Unit Conversion Bar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-800">
          <ArrowRightLeft className="w-4 h-4 text-indigo-600" aria-hidden="true" />
          Unit Conversion Calculator (kg ↔ g, litre ↔ ml, pieces, packets, cartons)
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            type="number"
            step="0.01"
            aria-label="Quantity to convert"
            value={convQty}
            onChange={(e) => setConvQty(Number(e.target.value))}
            className="w-24 px-2.5 py-1.5 font-mono border border-slate-300 rounded-md"
          />
          <select
            aria-label="From unit"
            value={convFrom}
            onChange={(e) => setConvFrom(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
          >
            {['kg', 'g', 'litre', 'ml', 'pieces', 'packets', 'cartons'].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
          <span className="text-slate-400">=</span>
          <span className="px-3 py-1.5 font-mono font-bold text-indigo-700 bg-indigo-50 rounded-md">
            {convertUnit(convQty, convFrom, convTo)} {convTo}
          </span>
          <select
            aria-label="To unit"
            value={convTo}
            onChange={(e) => setConvTo(e.target.value)}
            className="px-2.5 py-1.5 border border-slate-300 rounded-md bg-white"
          >
            {['g', 'kg', 'ml', 'litre', 'pieces', 'packets', 'cartons'].map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="space-y-5">
          {boms.map((b) => {
            const estMatCost = b.items.reduce(
              (acc, it) => acc + Math.round(it.standardQty * it.weightedAvgRatePaise),
              0
            );
            const estTotalCost =
              estMatCost +
              b.standardLabourCostPaise +
              b.standardGasPowerCostPaise +
              b.standardOverheadCostPaise;
            return (
              <div key={b.id} className="bg-white border border-slate-200 rounded-lg p-5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200">
                  <div>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-mono font-bold text-indigo-700">{b.code}</span>
                      <span className="text-slate-300">·</span>
                      <h2 className="font-bold text-slate-900">{b.name}</h2>
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Finished SKU: <strong className="text-slate-700">{b.productName} ({b.productSku})</strong> ·
                      Batch Size: <strong className="font-mono">{b.batchSize}</strong> · Expected Output:{' '}
                      <strong className="font-mono text-slate-800">
                        {b.expectedOutputQty} {b.outputUnit}
                      </strong>{' '}
                      · Wastage Tolerance: <strong className="font-mono">{b.standardWastageTolerancePct}%</strong>
                    </div>
                  </div>
                  <div className="text-right text-xs font-mono tabular-nums">
                    <div className="text-slate-500">Standard Batch Cost Est.</div>
                    <div className="text-base font-bold text-slate-900">{formatINR(estTotalCost)}</div>
                    <div className="text-slate-500">
                      Std {formatINR(Math.round(estTotalCost / Math.max(1, b.expectedOutputQty)))} / {b.outputUnit.slice(0, -1) || 'unit'}
                    </div>
                  </div>
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-3 font-semibold">Category</th>
                        <th className="py-2 pr-3 font-semibold">Material</th>
                        <th className="py-2 pr-3 font-semibold text-right">Standard Qty / Batch</th>
                        <th className="py-2 pr-3 font-semibold text-right">Converted Sub-Unit</th>
                        <th className="py-2 pr-3 font-semibold text-right">Live Stock</th>
                        <th className="py-2 pr-3 font-semibold text-right">Avg Rate</th>
                        <th className="py-2 font-semibold text-right">Tolerance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {b.items.map((it) => {
                        const subConverted =
                          it.unit === 'kg'
                            ? `${convertUnit(it.standardQty, 'kg', 'g')} g`
                            : it.unit === 'litre'
                              ? `${convertUnit(it.standardQty, 'litre', 'ml')} ml`
                              : `${it.standardQty} ${it.unit}`;
                        return (
                          <tr key={it.id} className="hover:bg-slate-50">
                            <td className="py-2.5 pr-3 font-medium text-slate-600">{it.materialCategory}</td>
                            <td className="py-2.5 pr-3 font-semibold text-slate-900">
                              {it.materialName} <span className="font-mono text-slate-400">({it.materialCode})</span>
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums font-semibold text-slate-900">
                              {it.standardQty} {it.unit}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-500">
                              {subConverted}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                              {it.currentStock} {it.stockUnit}
                            </td>
                            <td className="py-2.5 pr-3 text-right font-mono tabular-nums text-slate-700">
                              {formatINR(it.weightedAvgRatePaise)}
                            </td>
                            <td className="py-2.5 text-right font-mono tabular-nums text-slate-600">
                              ±{it.wastageTolerancePct}%
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex flex-wrap gap-6 text-xs text-slate-600 font-mono">
                  <span>Std Labour: {formatINR(b.standardLabourCostPaise)}</span>
                  <span>Std Gas & Power: {formatINR(b.standardGasPowerCostPaise)}</span>
                  <span>Std Overheads: {formatINR(b.standardOverheadCostPaise)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create BOM Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create Bill of Materials"
        maxWidthClass="max-w-3xl"
      >
        <form onSubmit={handleCreateBom} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">BOM Code</label>
              <input
                required
                placeholder="BOM-RBP-200"
                value={bomForm.code}
                onChange={(e) => setBomForm({ ...bomForm, code: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Finished Product</label>
              <select
                value={bomForm.productId}
                onChange={(e) => setBomForm({ ...bomForm, productId: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Expected Output</label>
              <input
                type="number"
                min={1}
                required
                value={bomForm.expectedOutputQty}
                onChange={(e) => setBomForm({ ...bomForm, expectedOutputQty: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Recipe Name</label>
              <input
                required
                placeholder="Ribbon Pakoda 200 g — Standard Batch"
                value={bomForm.name}
                onChange={(e) => setBomForm({ ...bomForm, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Wastage Tolerance (%)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={bomForm.standardWastageTolerancePct}
                onChange={(e) => setBomForm({ ...bomForm, standardWastageTolerancePct: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="space-y-2.5 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">Recipe Materials</span>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() =>
                    setBomForm({
                      ...bomForm,
                      items: [
                        ...bomForm.items,
                        {
                          materialCategory: 'RAW',
                          materialId: raws[0]?.id || 0,
                          standardQty: 10,
                          unit: raws[0]?.unit || 'kg',
                          wastageTolerancePct: 3,
                        },
                      ],
                    })
                  }
                  className="text-xs font-semibold text-indigo-600 hover:underline"
                >
                  + Add Raw Material
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setBomForm({
                      ...bomForm,
                      items: [
                        ...bomForm.items,
                        {
                          materialCategory: 'PACKAGING',
                          materialId: packs[0]?.id || 0,
                          standardQty: 100,
                          unit: packs[0]?.unit || 'pieces',
                          wastageTolerancePct: 3,
                        },
                      ],
                    })
                  }
                  className="text-xs font-semibold text-indigo-600 hover:underline"
                >
                  + Add Packaging
                </button>
              </div>
            </div>

            {bomForm.items.map((it, idx) => {
              const opts = it.materialCategory === 'RAW' ? raws : packs;
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-2 text-xs font-mono text-slate-500">{it.materialCategory}</div>
                  <div className="col-span-5">
                    <select
                      value={it.materialId}
                      onChange={(e) => {
                        const id = Number(e.target.value);
                        const mat = opts.find((m) => m.id === id);
                        const next = [...bomForm.items];
                        next[idx] = { ...it, materialId: id, unit: mat?.unit || it.unit };
                        setBomForm({ ...bomForm, items: next });
                      }}
                      className="w-full px-2 py-1.5 text-xs border border-slate-300 rounded bg-white"
                    >
                      {opts.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} ({m.unit})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input
                      type="number"
                      step="0.1"
                      min="0.1"
                      value={it.standardQty}
                      onChange={(e) => {
                        const next = [...bomForm.items];
                        next[idx] = { ...it, standardQty: Number(e.target.value) };
                        setBomForm({ ...bomForm, items: next });
                      }}
                      className="w-full px-2 py-1.5 text-xs font-mono border border-slate-300 rounded"
                    />
                  </div>
                  <div className="col-span-2 text-xs font-mono text-slate-600">{it.unit}</div>
                  <div className="col-span-1 text-right">
                    <button
                      type="button"
                      onClick={() =>
                        setBomForm({ ...bomForm, items: bomForm.items.filter((_, i) => i !== idx) })
                      }
                      className="text-slate-400 hover:text-red-600"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={() => setCreateOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Save BOM
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

// ===================== PRODUCTION RUNS PAGE =====================
interface ProductionRunView {
  id: number;
  runNo: string;
  productName: string;
  productSku: string;
  bomCode: string;
  bomName: string;
  runDate: string;
  batchQty: number;
  expectedOutputQty: number;
  actualGoodOutputQty: number;
  damagedPackagingQty: number;
  wastageQty: number;
  wastageUnit: string;
  yieldVariancePct: number;
  hasVarianceAlert: boolean;
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
  status: string;
  notes: string;
  createdByName: string;
  consumptions: Array<{
    id: number;
    materialCategory: string;
    materialName: string;
    plannedQty: number;
    actualQty: number;
    damagedQty: number;
    unit: string;
    variancePct: number;
    isFlagged: boolean;
    unitCostPaise: number;
    totalCostPaise: number;
  }>;
}

export const ProductionPage: React.FC = () => {
  const { user, company } = useAuth();
  const [runs, setRuns] = useState<ProductionRunView[]>([]);
  const [boms, setBoms] = useState<BomRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  // New Production Run Modal State
  const [runModalOpen, setRunModalOpen] = useState(false);
  const [selectedBomId, setSelectedBomId] = useState<number>(0);
  const [runDate, setRunDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [batchQty, setBatchQty] = useState(1);
  const [actualGoodOutputQty, setActualGoodOutputQty] = useState(195);
  const [wastageQty, setWastageQty] = useState(5);
  const [labourRupees, setLabourRupees] = useState(600);
  const [gasPowerRupees, setGasPowerRupees] = useState(350);
  const [overheadRupees, setOverheadRupees] = useState(150);
  const [runNotes, setRunNotes] = useState('');
  const [consumptionInputs, setConsumptionInputs] = useState<
    Array<{
      materialCategory: 'RAW' | 'PACKAGING';
      rawMaterialId: number | null;
      packagingMaterialId: number | null;
      materialName: string;
      plannedQty: number;
      actualQty: number;
      damagedQty: number;
      unit: string;
      availableStock: number;
    }>
  >([]);
  const [posting, setPosting] = useState(false);

  const canWrite = user && ['OWNER', 'ADMIN', 'PRODUCTION_SUPERVISOR'].includes(user.roleCode);
  const tolerancePct = company?.varianceTolerancePct ?? 3;

  const hydrateFromBom = (bom: BomRecord, qty: number) => {
    setSelectedBomId(bom.id);
    setBatchQty(qty);
    const exp = roundQty(bom.expectedOutputQty * qty);
    setActualGoodOutputQty(exp);
    setWastageQty(0);
    setLabourRupees(Math.round(paiseToRupeesNumber(bom.standardLabourCostPaise) * qty));
    setGasPowerRupees(Math.round(paiseToRupeesNumber(bom.standardGasPowerCostPaise) * qty));
    setOverheadRupees(Math.round(paiseToRupeesNumber(bom.standardOverheadCostPaise) * qty));
    setConsumptionInputs(
      bom.items.map((it) => {
        const planned = roundQty(it.standardQty * qty);
        return {
          materialCategory: it.materialCategory,
          rawMaterialId: it.rawMaterialId,
          packagingMaterialId: it.packagingMaterialId,
          materialName: it.materialName,
          plannedQty: planned,
          actualQty: planned,
          damagedQty: 0,
          unit: it.unit,
          availableStock: it.currentStock,
        };
      })
    );
  };

  const load = async () => {
    setLoading(true);
    try {
      const [runList, bomList] = await Promise.all([
        apiFetch<ProductionRunView[]>('/api/production-runs'),
        apiFetch<BomRecord[]>('/api/boms'),
      ]);
      setRuns(runList);
      setBoms(bomList);
      if (runList.length > 0 && !selectedRunId) {
        setSelectedRunId(runList[0].id);
      }
      if (bomList.length > 0 && selectedBomId === 0) {
        hydrateFromBom(bomList[0], 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load production runs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const activeBom = boms.find((b) => b.id === selectedBomId) || boms[0];
  const expectedOut = activeBom ? roundQty(activeBom.expectedOutputQty * batchQty) : 0;
  const previewYieldVar = calculateYieldVariancePct(expectedOut, actualGoodOutputQty);
  const totalDamagedPack = consumptionInputs
    .filter((c) => c.materialCategory === 'PACKAGING')
    .reduce((s, c) => s + (Number(c.damagedQty) || 0), 0);

  const handleStartNewRun = () => {
    if (boms.length > 0) {
      hydrateFromBom(boms[0], 1);
    }
    setRunNotes('');
    setRunModalOpen(true);
  };

  const handlePostRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeBom) return;
    setError(null);
    setSuccess(null);
    setPosting(true);
    try {
      const created = await apiFetch<{ id: number; runNo: string }>('/api/production-runs', {
        method: 'POST',
        body: {
          productId: activeBom.productId,
          bomId: activeBom.id,
          runDate,
          batchQty: Number(batchQty),
          actualGoodOutputQty: Number(actualGoodOutputQty),
          damagedPackagingQty: totalDamagedPack,
          wastageQty: Number(wastageQty),
          labourCostRupees: Number(labourRupees),
          gasPowerCostRupees: Number(gasPowerRupees),
          otherOverheadRupees: Number(overheadRupees),
          notes: runNotes,
          consumptions: consumptionInputs.map((c) => ({
            materialCategory: c.materialCategory,
            rawMaterialId: c.rawMaterialId,
            packagingMaterialId: c.packagingMaterialId,
            plannedQty: Number(c.plannedQty),
            actualQty: Number(c.actualQty),
            damagedQty: Number(c.damagedQty),
            unit: c.unit,
          })),
        },
      });
      setSuccess(
        `Production run ${created.runNo} posted. Raw/packaging stocks decreased, finished goods stock increased, and variance report generated.`
      );
      setRunModalOpen(false);
      await load();
      setSelectedRunId(created.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to post production run');
    } finally {
      setPosting(false);
    }
  };

  const activeRun = runs.find((r) => r.id === selectedRunId) || runs[0];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Production Runs & Variance Analysis"
        subtitle={`Execute BOM-driven batches with automatic inventory ledger deductions, finished output receipts, and ±${tolerancePct}% variance alerts.`}
        actions={
          canWrite && (
            <button
              type="button"
              onClick={handleStartNewRun}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
            >
              <Play className="w-3.5 h-3.5" aria-hidden="true" />
              Start Production Run
            </button>
          )
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <>
          {/* Runs Selector Table */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-3 px-4 font-semibold">Run No</th>
                  <th className="py-3 px-4 font-semibold">Date</th>
                  <th className="py-3 px-4 font-semibold">Product / BOM</th>
                  <th className="py-3 px-4 font-semibold text-right">Expected</th>
                  <th className="py-3 px-4 font-semibold text-right">Actual Good</th>
                  <th className="py-3 px-4 font-semibold text-right">Yield Var %</th>
                  <th className="py-3 px-4 font-semibold text-right">Damaged Pack</th>
                  <th className="py-3 px-4 font-semibold text-right">Total Cost</th>
                  <th className="py-3 px-4 font-semibold text-right">Cost / Pkt</th>
                  <th className="py-3 px-4 font-semibold">Variance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {runs.map((r) => {
                  const selected = activeRun?.id === r.id;
                  return (
                    <tr
                      key={r.id}
                      onClick={() => setSelectedRunId(r.id)}
                      className={`cursor-pointer transition-colors ${
                        selected ? 'bg-indigo-50/60' : 'hover:bg-slate-50'
                      }`}
                    >
                      <td className="py-3 px-4 font-mono font-bold text-indigo-700 whitespace-nowrap">{r.runNo}</td>
                      <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">{r.runDate}</td>
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900">{r.productName}</div>
                        <div className="text-slate-500 font-mono">{r.bomCode} · {r.batchQty} batch</div>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{r.expectedOutputQty}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                        {r.actualGoodOutputQty}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-mono tabular-nums font-semibold ${
                          isVarianceExceeded(r.yieldVariancePct, tolerancePct) ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {r.yieldVariancePct > 0 ? `+${r.yieldVariancePct}%` : `${r.yieldVariancePct}%`}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-700">
                        {r.damagedPackagingQty}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">{formatINR(r.totalCostPaise)}</td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                        {formatINR(r.costPerPacketPaise)}
                      </td>
                      <td className="py-3 px-4">
                        <StatusText status={r.hasVarianceAlert ? 'VARIANCE ALERT' : 'WITHIN TOLERANCE'} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Selected Production Run Detailed Variance & Visual Comparison */}
          {activeRun && (
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="xl:col-span-2 bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-200">
                  <div>
                    <h2 className="text-base font-bold text-slate-900">
                      Variance Report — {activeRun.runNo} ({activeRun.productName})
                    </h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Expected Yield: {activeRun.expectedOutputQty} · Actual Good: {activeRun.actualGoodOutputQty} ·
                      Wastage: {activeRun.wastageQty} {activeRun.wastageUnit} · Damaged Packaging: {activeRun.damagedPackagingQty} pcs
                    </p>
                  </div>
                  {activeRun.hasVarianceAlert && (
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
                      <AlertTriangle className="w-4 h-4" aria-hidden="true" />
                      Exceeds ±{tolerancePct}% Tolerance
                    </div>
                  )}
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-500">
                        <th className="py-2 pr-2 font-semibold">Material</th>
                        <th className="py-2 pr-2 font-semibold text-right whitespace-nowrap">Planned</th>
                        <th className="py-2 pr-2 font-semibold text-right whitespace-nowrap">Issued</th>
                        <th className="py-2 pr-2 font-semibold text-right whitespace-nowrap">Damaged</th>
                        <th className="py-2 pr-2 font-semibold text-right whitespace-nowrap">Diff</th>
                        <th className="py-2 pr-2 font-semibold text-right whitespace-nowrap">Var %</th>
                        <th className="py-2 pr-2 font-semibold text-right whitespace-nowrap">Cost</th>
                        <th className="py-2 font-semibold whitespace-nowrap">Flag</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {activeRun.consumptions.map((c) => {
                        const totalUsed = roundQty(c.actualQty + c.damagedQty);
                        const diff = roundQty(totalUsed - c.plannedQty);
                        const shortUnit = c.unit === 'pieces' ? 'pcs' : c.unit === 'litre' ? 'L' : c.unit;
                        return (
                          <tr key={c.id} className={c.isFlagged ? 'bg-red-50/40' : ''}>
                            <td className="py-2.5 pr-2">
                              <div className="font-semibold text-slate-900">{c.materialName}</div>
                              <div className="text-[11px] text-slate-500">{c.materialCategory}</div>
                            </td>
                            <td className="py-2.5 pr-2 text-right font-mono tabular-nums whitespace-nowrap">
                              {c.plannedQty} {shortUnit}
                            </td>
                            <td className="py-2.5 pr-2 text-right font-mono tabular-nums whitespace-nowrap">
                              {c.actualQty} {shortUnit}
                            </td>
                            <td className="py-2.5 pr-2 text-right font-mono tabular-nums text-amber-700 whitespace-nowrap">
                              {c.damagedQty > 0 ? `${c.damagedQty} ${shortUnit}` : '—'}
                            </td>
                            <td className="py-2.5 pr-2 text-right font-mono tabular-nums whitespace-nowrap">
                              {diff > 0 ? `+${diff}` : diff} {shortUnit}
                            </td>
                            <td
                              className={`py-2.5 pr-2 text-right font-mono tabular-nums font-bold whitespace-nowrap ${
                                c.isFlagged ? 'text-red-700' : 'text-emerald-700'
                              }`}
                            >
                              {c.variancePct > 0 ? `+${c.variancePct}%` : `${c.variancePct}%`}
                            </td>
                            <td className="py-2.5 pr-2 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                              {formatINR(c.totalCostPaise)}
                            </td>
                            <td className="py-2.5 whitespace-nowrap">
                              <StatusText status={c.isFlagged ? 'FLAGGED (>3%)' : 'WITHIN LIMIT'} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Production Cost Summary strip */}
                <div className="pt-3 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono tabular-nums">
                  <div>
                    <div className="text-slate-500 font-sans">Raw + Packaging</div>
                    <div className="font-semibold text-slate-900 mt-0.5">
                      {formatINR(activeRun.rawMaterialCostPaise + activeRun.packagingCostPaise)}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 font-sans">Labour + Gas + OH</div>
                    <div className="font-semibold text-slate-900 mt-0.5">
                      {formatINR(
                        activeRun.labourCostPaise + activeRun.gasPowerCostPaise + activeRun.otherOverheadPaise
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-slate-500 font-sans">Total Batch Cost</div>
                    <div className="font-bold text-slate-900 mt-0.5">{formatINR(activeRun.totalCostPaise)}</div>
                  </div>
                  <div>
                    <div className="text-slate-500 font-sans">Cost / Good Packet</div>
                    <div className="font-bold text-indigo-700 mt-0.5">
                      {formatINR(activeRun.costPerPacketPaise)} (Margin {activeRun.grossMarginPct}%)
                    </div>
                  </div>
                </div>
              </div>

              {/* Visual Consumption Variance % Chart */}
              <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col">
                <h3 className="text-sm font-semibold text-slate-900 mb-1">
                  Consumption Variance vs ±{tolerancePct}% Limit
                </h3>
                <p className="text-xs text-slate-500 mb-4">
                  Percentage deviation from BOM standard for {activeRun.runNo}
                </p>
                <div className="h-72 flex-1">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      margin={{ top: 8, right: 20, left: 4, bottom: 8 }}
                      data={activeRun.consumptions.map((c) => ({
                        name:
                          c.materialName.includes('Flour')
                            ? 'Flour'
                            : c.materialName.includes('Oil')
                              ? 'Cooking Oil'
                              : c.materialName.includes('Spice')
                                ? 'Spice Mix'
                                : c.materialName.includes('Pouch')
                                  ? '200 g Pouch'
                                  : c.materialName.includes('Carton')
                                    ? 'Cartons'
                                    : c.materialName.slice(0, 14),
                        variancePct: c.variancePct,
                        isFlagged: c.isFlagged,
                      }))}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" horizontal={false} />
                      <XAxis
                        type="number"
                        domain={[-12, 10]}
                        tickFormatter={(v) => `${v}%`}
                        tick={{ fontSize: 11 }}
                      />
                      <YAxis type="category" dataKey="name" width={82} tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(v) => [`${Number(v ?? 0) > 0 ? '+' : ''}${Number(v ?? 0)}%`, 'Variance']}
                      />
                      <ReferenceLine x={0} stroke="#64748b" />
                      <ReferenceLine x={tolerancePct} stroke="#dc2626" strokeDasharray="3 3" />
                      <ReferenceLine x={-tolerancePct} stroke="#dc2626" strokeDasharray="3 3" />
                      <Bar dataKey="variancePct" name="Variance %" radius={[0, 4, 4, 0]} isAnimationActive={false}>
                        {activeRun.consumptions.map((c) => (
                          <Cell key={c.id} fill={c.isFlagged ? '#dc2626' : '#16a34a'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <span className="text-red-700 font-medium">Red: Exceeds ±{tolerancePct}%</span>
                  <span className="text-emerald-700 font-medium">Green: Within limit</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Start Production Run Wizard Modal */}
      <Modal
        open={runModalOpen}
        onClose={() => setRunModalOpen(false)}
        title="Execute New Production Run"
        subtitle="Select BOM and batch size to auto-calculate planned consumption, then enter actual issued quantities, output, and damage."
        maxWidthClass="max-w-4xl"
      >
        <form onSubmit={handlePostRun} className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label htmlFor="pr-bom" className="block text-xs font-medium text-slate-700 mb-1">
                Product & Bill of Materials
              </label>
              <select
                id="pr-bom"
                value={selectedBomId}
                onChange={(e) => {
                  const found = boms.find((b) => b.id === Number(e.target.value));
                  if (found) hydrateFromBom(found, batchQty);
                }}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {boms.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.productName} — {b.code} (Expected {b.expectedOutputQty} {b.outputUnit}/batch)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="pr-date" className="block text-xs font-medium text-slate-700 mb-1">
                Production Date
              </label>
              <input
                id="pr-date"
                type="date"
                required
                value={runDate}
                onChange={(e) => setRunDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="pr-batches" className="block text-xs font-medium text-slate-700 mb-1">
                Batch Quantity
              </label>
              <input
                id="pr-batches"
                type="number"
                step="0.5"
                min="0.5"
                required
                value={batchQty}
                onChange={(e) => {
                  const nextQty = Math.max(0.5, Number(e.target.value) || 1);
                  if (activeBom) hydrateFromBom(activeBom, nextQty);
                }}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label htmlFor="pr-good" className="block text-xs font-medium text-slate-700 mb-1">
                Actual Good Output (Expected: {expectedOut})
              </label>
              <input
                id="pr-good"
                type="number"
                min={1}
                required
                value={actualGoodOutputQty}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setActualGoodOutputQty(val);
                  setWastageQty(Math.max(0, roundQty(expectedOut - val)));
                  // Keep primary pouch consumption aligned with actual good packets packed (damaged pouches tracked separately)
                  setConsumptionInputs((prev) =>
                    prev.map((item) =>
                      item.materialCategory === 'PACKAGING' &&
                      item.materialName.toLowerCase().includes('pouch')
                        ? { ...item, actualQty: Math.max(0, val) }
                        : item
                    )
                  );
                }}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
              <div
                className={`mt-1 text-xs font-mono ${
                  isVarianceExceeded(previewYieldVar, tolerancePct) ? 'text-red-700 font-semibold' : 'text-emerald-700'
                }`}
              >
                Yield Variance: {previewYieldVar > 0 ? `+${previewYieldVar}%` : `${previewYieldVar}%`}
              </div>
            </div>
            <div>
              <label htmlFor="pr-wastage" className="block text-xs font-medium text-slate-700 mb-1">
                Wastage / Scrap ({activeBom?.outputUnit || 'packets'})
              </label>
              <input
                id="pr-wastage"
                type="number"
                min={0}
                step="0.5"
                value={wastageQty}
                onChange={(e) => setWastageQty(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Consumption Inputs Table */}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                  <th className="py-2 px-3 font-semibold">Material</th>
                  <th className="py-2 px-3 font-semibold text-right">Available</th>
                  <th className="py-2 px-3 font-semibold text-right">Planned</th>
                  <th className="py-2 px-3 font-semibold text-right">Actual Good Used</th>
                  <th className="py-2 px-3 font-semibold text-right">Damaged</th>
                  <th className="py-2 px-3 font-semibold text-right">Live Var %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {consumptionInputs.map((c, idx) => {
                  const totalUsed = roundQty(c.actualQty + c.damagedQty);
                  const varPct = calculateConsumptionVariancePct(c.plannedQty, totalUsed);
                  const flagged = isVarianceExceeded(varPct, tolerancePct);
                  return (
                    <tr key={idx}>
                      <td className="py-2 px-3 font-medium text-slate-900">
                        {c.materialName} <span className="text-slate-400">({c.unit})</span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-600">{c.availableStock}</td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">{c.plannedQty}</td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="number"
                          step="0.1"
                          min="0"
                          aria-label={`Actual issued ${c.materialName}`}
                          value={c.actualQty}
                          onChange={(e) => {
                            const next = [...consumptionInputs];
                            next[idx] = { ...c, actualQty: Number(e.target.value) };
                            setConsumptionInputs(next);
                          }}
                          className="w-24 px-2 py-1 text-right font-mono border border-slate-300 rounded"
                        />
                      </td>
                      <td className="py-2 px-3 text-right">
                        {c.materialCategory === 'PACKAGING' ? (
                          <input
                            type="number"
                            step="1"
                            min="0"
                            aria-label={`Damaged ${c.materialName}`}
                            value={c.damagedQty}
                            onChange={(e) => {
                              const next = [...consumptionInputs];
                              next[idx] = { ...c, damagedQty: Number(e.target.value) };
                              setConsumptionInputs(next);
                            }}
                            className="w-20 px-2 py-1 text-right font-mono border border-slate-300 rounded"
                          />
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td
                        className={`py-2 px-3 text-right font-mono font-semibold ${
                          flagged ? 'text-red-700' : 'text-emerald-700'
                        }`}
                      >
                        {varPct > 0 ? `+${varPct}%` : `${varPct}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Overheads */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Labour Cost (₹)</label>
              <input
                type="number"
                min={0}
                value={labourRupees}
                onChange={(e) => setLabourRupees(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Gas & Power Cost (₹)</label>
              <input
                type="number"
                min={0}
                value={gasPowerRupees}
                onChange={(e) => setGasPowerRupees(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Other Overheads (₹)</label>
              <input
                type="number"
                min={0}
                value={overheadRupees}
                onChange={(e) => setOverheadRupees(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Batch Notes</label>
            <input
              value={runNotes}
              onChange={(e) => setRunNotes(e.target.value)}
              placeholder="Shift details or variance remarks"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRunModalOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={posting}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg"
            >
              {posting ? 'Posting Run...' : 'Post Production Run & Update Stock'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
