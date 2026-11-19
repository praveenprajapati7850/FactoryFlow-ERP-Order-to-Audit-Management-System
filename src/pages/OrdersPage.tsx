import React, { useEffect, useState, useMemo } from 'react';
import { Plus, Trash2, Check, X, FileSpreadsheet, Edit3, CloudUpload, WifiOff } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR, calculateGstLine, paiseToRupeesNumber } from '../utils/erpMath';
import { useAuth } from '../context/AuthContext';
import { PageHeader, StatusText, AlertBanner, Modal, LoadingSkeleton, EmptyState } from '../components/ui/DataPrimitives';
import type { NavKey } from '../components/Layout';

interface CustomerItem {
  id: number;
  name: string;
  customerType: string;
  gstin: string;
  state: string;
  stateCode: string;
  creditLimitPaise: number;
}

interface ProductItem {
  id: number;
  name: string;
  sku: string;
  packSize: string;
  gstPct: number;
  sellingPricePaise: number;
  unit: string;
  currentStock: number;
  isActive: boolean;
}

interface OrderRecord {
  id: number;
  orderNo: string;
  customerId: number;
  customerName: string;
  customerState: string;
  customerGstin: string;
  customerType: string;
  salesmanName: string;
  orderDate: string;
  status: string;
  subtotalPaise: number;
  taxPaise: number;
  totalPaise: number;
  notes: string;
  rejectionReason: string | null;
  invoiceId: number | null;
  invoiceNo: string | null;
  items: Array<{
    id: number;
    productId: number;
    productName: string;
    sku: string;
    quantity: number;
    unit: string;
    unitPricePaise: number;
    gstPct: number;
    taxablePaise: number;
    taxPaise: number;
    lineTotalPaise: number;
    availableStock: number;
    shortageQty?: number;
  }>;
}

interface OfflineDraft {
  localId: string;
  customerId: number;
  customerName: string;
  orderDate: string;
  notes: string;
  items: Array<{ productId: number; quantity: number }>;
  savedAt: string;
}

const OFFLINE_DRAFTS_KEY = 'factoryflow_offline_order_drafts';

export const OrdersPage: React.FC<{ onNavigate: (key: NavKey) => void }> = ({ onNavigate }) => {
  const { user, company } = useAuth();
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [customers, setCustomers] = useState<CustomerItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Create order modal / mobile panel
  const [showCreate, setShowCreate] = useState(false);
  const [selectedCustomerId, setSelectedCustomerId] = useState<number>(0);
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [orderNotes, setOrderNotes] = useState('');
  const [draftLines, setDraftLines] = useState<Array<{ productId: number; quantity: number }>>([]);
  const [submitting, setSubmitting] = useState(false);

  // Offline drafts
  const [offlineDrafts, setOfflineDrafts] = useState<OfflineDraft[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(OFFLINE_DRAFTS_KEY) || '[]');
    } catch {
      return [];
    }
  });

  // Admin Edit Order before approval
  const [editingOrder, setEditingOrder] = useState<OrderRecord | null>(null);
  const [editLines, setEditLines] = useState<Array<{ productId: number; productName: string; quantity: number; unitPriceRupees: number; availableStock: number }>>([]);
  const [editNotes, setEditNotes] = useState('');

  // Reject Modal
  const [rejectingOrder, setRejectingOrder] = useState<OrderRecord | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const canCreate = user && ['SALESMAN', 'ADMIN', 'OWNER'].includes(user.roleCode);
  const canVerify = user && ['ADMIN', 'OWNER'].includes(user.roleCode);

  const loadAll = async () => {
    setLoading(true);
    setError(null);
    try {
      const [ords, custs, prods] = await Promise.all([
        apiFetch<OrderRecord[]>('/api/orders'),
        apiFetch<CustomerItem[]>('/api/customers'),
        apiFetch<ProductItem[]>('/api/products'),
      ]);
      setOrders(ords);
      setCustomers(custs);
      setProducts(prods.filter((p) => p.isActive));
      if (custs.length > 0 && !selectedCustomerId) {
        setSelectedCustomerId(custs[0].id);
      }
      if (prods.length > 0 && draftLines.length === 0) {
        setDraftLines([{ productId: prods[0].id, quantity: 20 }]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load orders');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const persistOffline = (next: OfflineDraft[]) => {
    setOfflineDrafts(next);
    localStorage.setItem(OFFLINE_DRAFTS_KEY, JSON.stringify(next));
  };

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const factoryState = company?.state || 'Tamil Nadu';
  const isInterState = selectedCustomer
    ? selectedCustomer.state.toLowerCase() !== factoryState.toLowerCase()
    : false;

  const orderPreview = useMemo(() => {
    let subtotalPaise = 0;
    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;
    let totalPaise = 0;
    const prodMap = new Map(products.map((p) => [p.id, p]));
    const computedLines = draftLines.map((line) => {
      const prod = prodMap.get(line.productId);
      if (!prod) return null;
      const calc = calculateGstLine({
        quantity: line.quantity,
        unitPricePaise: prod.sellingPricePaise,
        gstPct: prod.gstPct,
        isInterState,
      });
      subtotalPaise += calc.taxableValuePaise;
      cgstPaise += calc.cgstPaise;
      sgstPaise += calc.sgstPaise;
      igstPaise += calc.igstPaise;
      totalPaise += calc.lineTotalPaise;
      return { ...line, prod, calc };
    });
    return { subtotalPaise, cgstPaise, sgstPaise, igstPaise, totalPaise, computedLines };
  }, [draftLines, products, isInterState]);

  const handleSaveOrder = async (mode: 'SUBMITTED' | 'DRAFT' | 'OFFLINE') => {
    setError(null);
    setSuccess(null);
    if (!selectedCustomerId) {
      setError('Please select a customer.');
      return;
    }
    const validLines = draftLines.filter((l) => l.productId > 0 && l.quantity > 0);
    if (validLines.length === 0) {
      setError('Add at least one product with a quantity greater than zero.');
      return;
    }

    if (mode === 'OFFLINE') {
      const draft: OfflineDraft = {
        localId: `OFF-${Date.now().toString().slice(-6)}`,
        customerId: selectedCustomerId,
        customerName: selectedCustomer?.name || 'Customer',
        orderDate,
        notes: orderNotes,
        items: validLines,
        savedAt: new Date().toLocaleTimeString(),
      };
      persistOffline([draft, ...offlineDrafts]);
      setSuccess(`Offline order draft ${draft.localId} stored locally. Sync whenever connected.`);
      setShowCreate(false);
      return;
    }

    setSubmitting(true);
    try {
      await apiFetch('/api/orders', {
        method: 'POST',
        body: {
          customerId: selectedCustomerId,
          orderDate,
          status: mode,
          notes: orderNotes,
          items: validLines,
        },
      });
      setSuccess(
        mode === 'SUBMITTED'
          ? 'Order submitted and queued immediately for Admin verification.'
          : 'Order saved as Draft.'
      );
      setOrderNotes('');
      setShowCreate(false);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create order');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSyncOfflineDraft = async (draft: OfflineDraft) => {
    setError(null);
    try {
      await apiFetch('/api/orders', {
        method: 'POST',
        body: {
          customerId: draft.customerId,
          orderDate: draft.orderDate,
          status: 'SUBMITTED',
          notes: draft.notes ? `${draft.notes} [Synced offline draft]` : 'Synced from offline draft',
          items: draft.items,
        },
      });
      persistOffline(offlineDrafts.filter((d) => d.localId !== draft.localId));
      setSuccess(`Offline draft ${draft.localId} synchronized and submitted to Admin.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    }
  };

  const handleApprove = async (ord: OrderRecord) => {
    setError(null);
    try {
      await apiFetch(`/api/orders/${ord.id}/approve`, { method: 'POST' });
      setSuccess(`Order ${ord.orderNo} approved. Ready for GST invoicing.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Approval failed');
    }
  };

  const handleRejectConfirm = async () => {
    if (!rejectingOrder) return;
    setError(null);
    try {
      await apiFetch(`/api/orders/${rejectingOrder.id}/reject`, {
        method: 'POST',
        body: { reason: rejectReason || 'Rejected during verification' },
      });
      setSuccess(`Order ${rejectingOrder.orderNo} marked as Rejected.`);
      setRejectingOrder(null);
      setRejectReason('');
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rejection failed');
    }
  };

  const handleSubmitDraft = async (ord: OrderRecord) => {
    setError(null);
    try {
      await apiFetch(`/api/orders/${ord.id}/submit`, { method: 'POST' });
      setSuccess(`Draft order ${ord.orderNo} submitted to Admin.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submit failed');
    }
  };

  const handleGenerateInvoice = async (ord: OrderRecord) => {
    setError(null);
    try {
      const inv = await apiFetch<{ invoiceNo: string }>(`/api/invoices/from-order/${ord.id}`, {
        method: 'POST',
        body: { invoiceDate: new Date().toISOString().slice(0, 10) },
      });
      setSuccess(`GST Invoice ${inv.invoiceNo} generated for ${ord.orderNo}.`);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invoice generation failed');
    }
  };

  const openEditModal = (ord: OrderRecord) => {
    setEditingOrder(ord);
    setEditNotes(ord.notes);
    setEditLines(
      ord.items.map((i) => ({
        productId: i.productId,
        productName: i.productName,
        quantity: i.quantity,
        unitPriceRupees: paiseToRupeesNumber(i.unitPricePaise),
        availableStock: i.availableStock,
      }))
    );
  };

  const handleSaveEdit = async () => {
    if (!editingOrder) return;
    setError(null);
    try {
      await apiFetch(`/api/orders/${editingOrder.id}`, {
        method: 'PUT',
        body: {
          notes: editNotes,
          items: editLines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            unitPriceRupees: l.unitPriceRupees,
          })),
        },
      });
      setSuccess(`Order ${editingOrder.orderNo} updated before approval.`);
      setEditingOrder(null);
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update order');
    }
  };

  const filteredOrders =
    statusFilter === 'ALL' ? orders : orders.filter((o) => o.status === statusFilter);

  // Customer-wise sales summary for Salesman view
  const customerSalesSummary = useMemo(() => {
    const map = new Map<string, { orders: number; totalPaise: number }>();
    for (const o of orders) {
      if (o.status === 'REJECTED') continue;
      const cur = map.get(o.customerName) || { orders: 0, totalPaise: 0 };
      cur.orders += 1;
      cur.totalPaise += o.totalPaise;
      map.set(o.customerName, cur);
    }
    return Array.from(map.entries()).map(([name, v]) => ({ name, ...v }));
  }, [orders]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={user?.roleCode === 'SALESMAN' ? 'Salesman Order Portal' : 'Order Management & Verification'}
        subtitle={
          user?.roleCode === 'SALESMAN'
            ? 'Mobile-ready order entry with live finished stock visibility, automatic price list rates, and offline draft sync.'
            : 'Verify incoming salesman orders, adjust quantities or prices before approval, and post sequential GST invoices.'
        }
        actions={
          canCreate && (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              New Sales Order
            </button>
          )
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      {/* Offline Draft Queue */}
      {offlineDrafts.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <WifiOff className="w-4 h-4" aria-hidden="true" />
              Offline Order Drafts Waiting for Sync ({offlineDrafts.length})
            </div>
          </div>
          <div className="divide-y divide-amber-200/70">
            {offlineDrafts.map((d) => (
              <div key={d.localId} className="py-2 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div>
                  <span className="font-mono font-semibold text-amber-950">{d.localId}</span>
                  <span className="mx-2 text-amber-400">·</span>
                  <span className="text-amber-900 font-medium">{d.customerName}</span>
                  <span className="mx-2 text-amber-400">·</span>
                  <span className="text-amber-800">{d.items.length} item(s) · Saved {d.savedAt}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleSyncOfflineDraft(d)}
                    className="inline-flex items-center gap-1.5 px-3 py-1 font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded"
                  >
                    <CloudUpload className="w-3.5 h-3.5" aria-hidden="true" />
                    Sync & Submit
                  </button>
                  <button
                    type="button"
                    onClick={() => persistOffline(offlineDrafts.filter((x) => x.localId !== d.localId))}
                    className="px-2 py-1 text-red-700 hover:underline"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Salesman Customer-wise Summary */}
      {user?.roleCode === 'SALESMAN' && customerSalesSummary.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {customerSalesSummary.map((c) => (
            <div key={c.name} className="bg-white border border-slate-200 rounded-lg p-4">
              <div className="text-xs text-slate-500 truncate">{c.name}</div>
              <div className="mt-1 text-xl font-semibold font-mono tabular-nums text-slate-900">
                {formatINR(c.totalPaise)}
              </div>
              <div className="mt-0.5 text-xs text-slate-500">{c.orders} active order(s)</div>
            </div>
          ))}
        </div>
      )}

      {/* Segmented Status Filter Bar */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto w-full sm:w-fit">
        {['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'INVOICED', 'DISPATCHED', 'REJECTED'].map((st) => (
          <button
            key={st}
            type="button"
            onClick={() => setStatusFilter(st)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              statusFilter === st ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {st === 'ALL' ? `All (${orders.length})` : st}
          </button>
        ))}
      </div>

      {/* Orders List / Table */}
      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : filteredOrders.length === 0 ? (
        <EmptyState
          title="No orders match this status"
          description="Create a new sales order or select a different status filter."
        />
      ) : (
        <div className="space-y-4">
          {filteredOrders.map((ord) => (
            <div key={ord.id} className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4 border-b border-slate-100">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono font-bold text-slate-900">{ord.orderNo}</span>
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <StatusText status={ord.status} />
                    <span className="text-slate-300" aria-hidden="true">·</span>
                    <span className="text-xs font-mono text-slate-500">{ord.orderDate}</span>
                    {ord.invoiceNo && (
                      <>
                        <span className="text-slate-300" aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={() => onNavigate('invoices')}
                          className="text-xs font-mono font-semibold text-indigo-600 hover:underline"
                        >
                          Invoice {ord.invoiceNo}
                        </button>
                      </>
                    )}
                  </div>
                  <div className="mt-1 text-sm font-semibold text-slate-900">
                    {ord.customerName}
                    <span className="ml-2 text-xs font-normal text-slate-500">
                      {ord.customerType} · {ord.customerState} · GSTIN {ord.customerGstin}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-slate-500">
                    Salesman: {ord.salesmanName}
                    {ord.notes ? ` · ${ord.notes}` : ''}
                    {ord.rejectionReason ? ` · Rejected: ${ord.rejectionReason}` : ''}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {ord.status === 'DRAFT' && canCreate && (
                    <button
                      type="button"
                      onClick={() => handleSubmitDraft(ord)}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md whitespace-nowrap"
                    >
                      Submit Order
                    </button>
                  )}
                  {canVerify && ['DRAFT', 'SUBMITTED'].includes(ord.status) && (
                    <button
                      type="button"
                      onClick={() => openEditModal(ord)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-md whitespace-nowrap"
                    >
                      <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                      Edit Qty / Price
                    </button>
                  )}
                  {canVerify && ord.status === 'SUBMITTED' && (
                    <>
                      <button
                        type="button"
                        onClick={() => handleApprove(ord)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-md whitespace-nowrap"
                      >
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectingOrder(ord)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-red-700 bg-red-50 hover:bg-red-100 rounded-md whitespace-nowrap"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                        Reject
                      </button>
                    </>
                  )}
                  {canVerify && ord.status === 'APPROVED' && (
                    <button
                      type="button"
                      onClick={() => handleGenerateInvoice(ord)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-md whitespace-nowrap"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                      Generate GST Invoice
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-100">
                      <th className="py-1.5 pr-3 font-medium">Product</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Order Qty</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Avail. Stock</th>
                      <th className="py-1.5 pr-3 font-medium text-right">Unit Price</th>
                      <th className="py-1.5 pr-3 font-medium text-right">GST %</th>
                      <th className="py-1.5 font-medium text-right">Line Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ord.items.map((item) => {
                      const computedShortage =
                        typeof item.shortageQty === 'number'
                          ? item.shortageQty
                          : !['DISPATCHED', 'REJECTED'].includes(ord.status)
                            ? Math.max(0, item.quantity - item.availableStock)
                            : 0;
                      const lowForOrder = computedShortage > 0 && !['DISPATCHED', 'REJECTED'].includes(ord.status);
                      return (
                        <tr key={item.id} className={lowForOrder ? 'bg-red-50/40' : ''}>
                          <td className="py-2 pr-3 font-medium text-slate-900">
                            {item.productName} <span className="font-mono text-slate-400">({item.sku})</span>
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">
                            {item.quantity} {item.unit}
                          </td>
                          <td className={`py-2 pr-3 text-right font-mono tabular-nums ${lowForOrder ? 'text-red-700 font-semibold' : 'text-emerald-700'}`}>
                            <div>{item.availableStock} {item.unit}</div>
                            {lowForOrder && (
                              <div className="text-[11px] font-semibold text-red-700">
                                Shortage: {computedShortage} {item.unit}
                              </div>
                            )}
                          </td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{formatINR(item.unitPricePaise)}</td>
                          <td className="py-2 pr-3 text-right font-mono tabular-nums">{item.gstPct}%</td>
                          <td className="py-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                            {formatINR(item.lineTotalPaise)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap justify-end gap-6 text-xs font-mono tabular-nums">
                  <span className="text-slate-600">Subtotal: {formatINR(ord.subtotalPaise)}</span>
                  <span className="text-slate-600">Estimated GST: {formatINR(ord.taxPaise)}</span>
                  <span className="font-bold text-slate-900">Grand Total: {formatINR(ord.totalPaise)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create Sales Order Modal (Mobile-first ergonomic layout) */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Sales Order"
        subtitle="Prices auto-populate from the active price list with real-time finished goods stock check."
      >
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="ord-customer" className="block text-xs font-medium text-slate-700 mb-1">
                Customer
              </label>
              <select
                id="ord-customer"
                value={selectedCustomerId}
                onChange={(e) => setSelectedCustomerId(Number(e.target.value))}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.state})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ord-date" className="block text-xs font-medium text-slate-700 mb-1">
                Order Date
              </label>
              <input
                id="ord-date"
                type="date"
                value={orderDate}
                onChange={(e) => setOrderDate(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {selectedCustomer && (
            <div className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-3 flex flex-wrap gap-x-4 gap-y-1">
              <span>GSTIN: <strong className="font-mono">{selectedCustomer.gstin}</strong></span>
              <span>Supply: <strong>{isInterState ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}</strong></span>
              <span>Credit Limit: <strong className="font-mono">{formatINR(selectedCustomer.creditLimitPaise)}</strong></span>
            </div>
          )}

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-800">Order Line Items</span>
              <button
                type="button"
                onClick={() =>
                  setDraftLines([
                    ...draftLines,
                    { productId: products[0]?.id || 0, quantity: 10 },
                  ])
                }
                className="text-xs font-semibold text-indigo-600 hover:text-indigo-800"
              >
                + Add Product
              </button>
            </div>

            {draftLines.map((line, idx) => {
              const prod = products.find((p) => p.id === line.productId);
              const stockInsufficient = prod && line.quantity > prod.currentStock;
              return (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end border-b border-slate-100 pb-3">
                  <div className="col-span-12 sm:col-span-6">
                    <label className="block text-xs text-slate-600 mb-1">Product</label>
                    <select
                      aria-label={`Product line ${idx + 1}`}
                      value={line.productId}
                      onChange={(e) => {
                        const next = [...draftLines];
                        next[idx] = { ...line, productId: Number(e.target.value) };
                        setDraftLines(next);
                      }}
                      className="w-full px-2.5 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                    >
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} — {formatINR(p.sellingPricePaise)} (Stock: {p.currentStock})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-6 sm:col-span-3">
                    <label className="block text-xs text-slate-600 mb-1">Quantity</label>
                    <input
                      aria-label={`Quantity line ${idx + 1}`}
                      type="number"
                      min={1}
                      step={1}
                      value={line.quantity}
                      onChange={(e) => {
                        const next = [...draftLines];
                        next[idx] = { ...line, quantity: Number(e.target.value) };
                        setDraftLines(next);
                      }}
                      className="w-full px-2.5 py-2 text-sm font-mono border border-slate-300 rounded-lg"
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2 text-right font-mono text-xs pb-2">
                    <div className="font-semibold text-slate-900">
                      {prod ? formatINR(prod.sellingPricePaise * line.quantity) : '—'}
                    </div>
                    <div className={stockInsufficient ? 'text-red-600 font-semibold' : 'text-emerald-700'}>
                      {prod
                        ? stockInsufficient
                          ? `Avail: ${prod.currentStock} (Short ${line.quantity - prod.currentStock})`
                          : `Avail: ${prod.currentStock}`
                        : ''}
                    </div>
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex justify-end pb-1">
                    {draftLines.length > 1 && (
                      <button
                        type="button"
                        aria-label={`Remove line ${idx + 1}`}
                        onClick={() => setDraftLines(draftLines.filter((_, i) => i !== idx))}
                        className="p-2 text-slate-400 hover:text-red-600"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div>
            <label htmlFor="ord-notes" className="block text-xs font-medium text-slate-700 mb-1">
              Delivery / Order Notes
            </label>
            <input
              id="ord-notes"
              type="text"
              value={orderNotes}
              onChange={(e) => setOrderNotes(e.target.value)}
              placeholder="Optional delivery instructions"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>

          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-1.5 text-xs font-mono tabular-nums">
            <div className="flex justify-between">
              <span className="text-slate-600">Taxable Subtotal</span>
              <span>{formatINR(orderPreview.subtotalPaise)}</span>
            </div>
            {isInterState ? (
              <div className="flex justify-between">
                <span className="text-slate-600">Estimated IGST</span>
                <span>{formatINR(orderPreview.igstPaise)}</span>
              </div>
            ) : (
              <>
                <div className="flex justify-between">
                  <span className="text-slate-600">Estimated CGST</span>
                  <span>{formatINR(orderPreview.cgstPaise)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Estimated SGST</span>
                  <span>{formatINR(orderPreview.sgstPaise)}</span>
                </div>
              </>
            )}
            <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-bold text-slate-900">
              <span>Estimated Grand Total</span>
              <span>{formatINR(orderPreview.totalPaise)}</span>
            </div>
          </div>

          <div className="sticky bottom-0 bg-white -mx-5 sm:-mx-6 px-5 sm:px-6 pt-3 pb-1 border-t border-slate-200 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() => handleSaveOrder('OFFLINE')}
              className="px-3 py-2 text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 hover:bg-amber-100 rounded-lg whitespace-nowrap"
            >
              Offline Draft
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleSaveOrder('DRAFT')}
              className="px-3 py-2 text-xs font-medium text-slate-700 border border-slate-300 hover:bg-slate-50 rounded-lg whitespace-nowrap"
            >
              Save Draft
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => handleSaveOrder('SUBMITTED')}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-lg whitespace-nowrap"
            >
              {submitting ? 'Submitting...' : 'Submit Order'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Admin Edit Order Modal */}
      <Modal
        open={Boolean(editingOrder)}
        onClose={() => setEditingOrder(null)}
        title={`Edit Order ${editingOrder?.orderNo || ''}`}
        subtitle="Admin can revise quantities and unit selling prices before approval."
      >
        <div className="space-y-4">
          {editLines.map((line, idx) => (
            <div key={line.productId} className="grid grid-cols-12 gap-3 items-end">
              <div className="col-span-6">
                <div className="text-xs font-semibold text-slate-800">{line.productName}</div>
                <div className="text-xs text-slate-500">Available stock: {line.availableStock}</div>
              </div>
              <div className="col-span-3">
                <label className="block text-xs text-slate-600 mb-1">Qty</label>
                <input
                  type="number"
                  min={1}
                  value={line.quantity}
                  onChange={(e) => {
                    const next = [...editLines];
                    next[idx] = { ...line, quantity: Number(e.target.value) };
                    setEditLines(next);
                  }}
                  className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-300 rounded-md"
                />
              </div>
              <div className="col-span-3">
                <label className="block text-xs text-slate-600 mb-1">Unit Price (₹)</label>
                <input
                  type="number"
                  min={1}
                  step="0.01"
                  value={line.unitPriceRupees}
                  onChange={(e) => {
                    const next = [...editLines];
                    next[idx] = { ...line, unitPriceRupees: Number(e.target.value) };
                    setEditLines(next);
                  }}
                  className="w-full px-2.5 py-1.5 text-sm font-mono border border-slate-300 rounded-md"
                />
              </div>
            </div>
          ))}
          <div>
            <label className="block text-xs text-slate-600 mb-1">Notes</label>
            <input
              type="text"
              value={editNotes}
              onChange={(e) => setEditNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditingOrder(null)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSaveEdit}
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Save Changes
            </button>
          </div>
        </div>
      </Modal>

      {/* Reject Reason Modal */}
      <Modal
        open={Boolean(rejectingOrder)}
        onClose={() => setRejectingOrder(null)}
        title={`Reject Order ${rejectingOrder?.orderNo || ''}`}
        maxWidthClass="max-w-md"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="reject-reason" className="block text-xs font-medium text-slate-700 mb-1">
              Rejection Reason
            </label>
            <input
              id="reject-reason"
              type="text"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g., Credit limit exceeded or stock unavailable"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setRejectingOrder(null)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRejectConfirm}
              className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
            >
              Confirm Rejection
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};
