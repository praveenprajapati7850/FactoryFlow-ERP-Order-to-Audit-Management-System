import React, { useEffect, useState } from 'react';
import { Download, Truck, RotateCcw, Eye, Plus } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR, paiseToRupeesNumber } from '../utils/erpMath';
import { downloadGstInvoicePdf, PrintableCompany, PrintableInvoice } from '../utils/exporters';
import { useAuth } from '../context/AuthContext';
import { PageHeader, MetricCard, StatusText, AlertBanner, Modal, LoadingSkeleton } from '../components/ui/DataPrimitives';

interface InvoiceRecord extends PrintableInvoice {
  id: number;
  orderId: number | null;
  orderNo: string | null;
  paidPaise: number;
  outstandingPaise: number;
  dispatchStatus: string;
  items: Array<
    PrintableInvoice['items'][number] & {
      id: number;
      productId: number;
      dispatchedQty: number;
    }
  >;
  creditNotes: Array<{
    id: number;
    creditNoteNo: string;
    issueDate: string;
    reason: string;
    totalPaise: number;
  }>;
}

export const InvoicesPage: React.FC = () => {
  const { user } = useAuth();
  const [company, setCompany] = useState<PrintableCompany | null>(null);
  const [invoices, setInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [previewInv, setPreviewInv] = useState<InvoiceRecord | null>(null);
  const [dispatchInv, setDispatchInv] = useState<InvoiceRecord | null>(null);
  const [dispatchQtys, setDispatchQtys] = useState<Record<number, number>>({});
  const [dispatchNotes, setDispatchNotes] = useState('');

  const [cnInv, setCnInv] = useState<InvoiceRecord | null>(null);
  const [cnReason, setCnReason] = useState('');

  const canManage = user && ['OWNER', 'ADMIN'].includes(user.roleCode);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ company: PrintableCompany | null; invoices: InvoiceRecord[] }>('/api/invoices');
      setCompany(res.company);
      setInvoices(res.invoices);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load GST invoices');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openDispatch = (inv: InvoiceRecord) => {
    const initial: Record<number, number> = {};
    for (const item of inv.items) {
      initial[item.id] = Math.max(0, item.quantity - item.dispatchedQty);
    }
    setDispatchQtys(initial);
    setDispatchNotes('');
    setDispatchInv(inv);
  };

  const handleConfirmDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dispatchInv) return;
    setError(null);
    setSuccess(null);
    const items = Object.entries(dispatchQtys)
      .filter(([, q]) => Number(q) > 0)
      .map(([id, q]) => ({ invoiceItemId: Number(id), dispatchQty: Number(q) }));
    if (items.length === 0) {
      setError('Enter at least one quantity to dispatch.');
      return;
    }
    try {
      await apiFetch(`/api/invoices/${dispatchInv.id}/dispatch`, {
        method: 'POST',
        body: { items, notes: dispatchNotes },
      });
      setSuccess(`Dispatch recorded for ${dispatchInv.invoiceNo}. Finished goods stock & ledger updated.`);
      setDispatchInv(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Dispatch failed');
    }
  };

  const handleIssueCreditNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cnInv) return;
    setError(null);
    setSuccess(null);
    try {
      const cn = await apiFetch<{ creditNoteNo: string }>(`/api/invoices/${cnInv.id}/credit-note`, {
        method: 'POST',
        body: { reason: cnReason },
      });
      setSuccess(`Credit Note ${cn.creditNoteNo} issued. Original invoice ${cnInv.invoiceNo} preserved as Reversed.`);
      setCnInv(null);
      setCnReason('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Credit Note reversal failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="GST Tax Invoices & Dispatch"
        subtitle="Sequential financial-year invoices with automatic CGST+SGST (intra-state) vs IGST (inter-state), PDF download, dispatch tracking, and Credit Note reversals."
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-semibold">Invoice No</th>
                <th className="py-3 px-4 font-semibold">Date / FY</th>
                <th className="py-3 px-4 font-semibold">Customer & Supply</th>
                <th className="py-3 px-4 font-semibold text-right">Taxable</th>
                <th className="py-3 px-4 font-semibold text-right">CGST / SGST / IGST</th>
                <th className="py-3 px-4 font-semibold text-right">Grand Total</th>
                <th className="py-3 px-4 font-semibold">Payment / Dispatch</th>
                <th className="py-3 px-4 font-semibold text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono font-bold text-indigo-700 whitespace-nowrap">
                    {inv.invoiceNo}
                    {inv.orderNo && <div className="text-[11px] font-normal text-slate-400">{inv.orderNo}</div>}
                  </td>
                  <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                    {inv.invoiceDate}
                    <div className="text-[11px] text-slate-400">FY {inv.financialYear}</div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{inv.customerName}</div>
                    <div className="text-[11px] text-slate-500">
                      {inv.customerState} · {inv.supplyType === 'INTER_STATE' ? 'Inter-State (IGST)' : 'Intra-State (CGST+SGST)'}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums">{formatINR(inv.taxableValuePaise)}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                    {inv.supplyType === 'INTER_STATE'
                      ? `IGST ${formatINR(inv.igstPaise)}`
                      : `C ${formatINR(inv.cgstPaise)} · S ${formatINR(inv.sgstPaise)}`}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-bold text-slate-900">
                    {formatINR(inv.grandTotalPaise)}
                  </td>
                  <td className="py-3 px-4 space-y-0.5">
                    <div>
                      <StatusText status={inv.status} />
                    </div>
                    <div className="text-[11px] text-slate-500">Dispatch: {inv.dispatchStatus}</div>
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                    <button
                      type="button"
                      onClick={() => setPreviewInv(inv)}
                      className="inline-flex items-center gap-1 text-slate-700 hover:text-indigo-700 font-medium"
                    >
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                      View
                    </button>
                    {company && (
                      <button
                        type="button"
                        onClick={() => downloadGstInvoicePdf(inv, company)}
                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-semibold"
                      >
                        <Download className="w-3.5 h-3.5" aria-hidden="true" />
                        PDF
                      </button>
                    )}
                    {canManage && inv.status !== 'REVERSED' && inv.dispatchStatus !== 'DISPATCHED' && (
                      <button
                        type="button"
                        onClick={() => openDispatch(inv)}
                        className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900 font-semibold"
                      >
                        <Truck className="w-3.5 h-3.5" aria-hidden="true" />
                        Dispatch
                      </button>
                    )}
                    {canManage && inv.status !== 'REVERSED' && (
                      <button
                        type="button"
                        onClick={() => setCnInv(inv)}
                        className="inline-flex items-center gap-1 text-red-700 hover:text-red-900 font-medium"
                      >
                        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                        Credit Note
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Tax Invoice Preview Modal */}
      <Modal
        open={Boolean(previewInv)}
        onClose={() => setPreviewInv(null)}
        title={`Tax Invoice ${previewInv?.invoiceNo || ''}`}
        maxWidthClass="max-w-3xl"
      >
        {previewInv && company && (
          <div className="space-y-5 text-xs">
            <div className="flex flex-col sm:flex-row justify-between gap-4 pb-4 border-b border-slate-200">
              <div>
                <div className="text-base font-bold text-slate-900">{company.companyName}</div>
                <div className="font-mono text-slate-600">GSTIN: {company.gstin}</div>
                <div className="text-slate-600 mt-0.5">{company.address}</div>
                <div className="text-slate-600">
                  State: {company.state} ({company.stateCode}) · {company.phone}
                </div>
              </div>
              <div className="sm:text-right font-mono">
                <div className="text-sm font-bold text-indigo-700">{previewInv.invoiceNo}</div>
                <div>FY: {previewInv.financialYear}</div>
                <div>Date: {previewInv.invoiceDate}</div>
                <div>Due: {previewInv.dueDate}</div>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3.5">
              <div className="font-semibold text-slate-900">Billed To: {previewInv.customerName}</div>
              <div className="font-mono text-slate-600 mt-0.5">
                GSTIN: {previewInv.customerGstin} · State: {previewInv.customerState} ({previewInv.customerStateCode})
              </div>
              <div className="text-slate-600 mt-0.5">{previewInv.customerAddress}</div>
            </div>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="py-2 pr-2 font-semibold">Item</th>
                  <th className="py-2 pr-2 font-semibold">HSN</th>
                  <th className="py-2 pr-2 font-semibold text-right">Qty</th>
                  <th className="py-2 pr-2 font-semibold text-right">Rate</th>
                  <th className="py-2 pr-2 font-semibold text-right">Taxable</th>
                  <th className="py-2 pr-2 font-semibold text-right">GST</th>
                  <th className="py-2 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {previewInv.items.map((it) => (
                  <tr key={it.id}>
                    <td className="py-2 pr-2 font-medium text-slate-900">{it.productName}</td>
                    <td className="py-2 pr-2 font-mono text-slate-600">{it.hsnCode}</td>
                    <td className="py-2 pr-2 text-right font-mono">{it.quantity} {it.unit}</td>
                    <td className="py-2 pr-2 text-right font-mono">{formatINR(it.unitPricePaise)}</td>
                    <td className="py-2 pr-2 text-right font-mono">{formatINR(it.taxableValuePaise)}</td>
                    <td className="py-2 pr-2 text-right font-mono">{it.gstPct}%</td>
                    <td className="py-2 text-right font-mono font-semibold">{formatINR(it.lineTotalPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex flex-col sm:flex-row justify-between gap-4 pt-3 border-t border-slate-200">
              <div>
                <div className="text-slate-500">Amount in Words</div>
                <div className="font-semibold text-slate-900 mt-0.5">{previewInv.amountInWords}</div>
                {previewInv.creditNotes.length > 0 && (
                  <div className="mt-2 text-red-700 font-semibold">
                    Reversed by Credit Note {previewInv.creditNotes[0].creditNoteNo}: {previewInv.creditNotes[0].reason}
                  </div>
                )}
              </div>
              <div className="w-full sm:w-64 space-y-1 font-mono tabular-nums">
                <div className="flex justify-between">
                  <span className="text-slate-500">Taxable Value</span>
                  <span>{formatINR(previewInv.taxableValuePaise)}</span>
                </div>
                {previewInv.supplyType === 'INTER_STATE' ? (
                  <div className="flex justify-between">
                    <span className="text-slate-500">IGST</span>
                    <span>{formatINR(previewInv.igstPaise)}</span>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-slate-500">CGST</span>
                      <span>{formatINR(previewInv.cgstPaise)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">SGST</span>
                      <span>{formatINR(previewInv.sgstPaise)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between pt-2 border-t border-slate-200 text-sm font-bold text-slate-900">
                  <span>Grand Total</span>
                  <span>{formatINR(previewInv.grandTotalPaise)}</span>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => downloadGstInvoicePdf(previewInv, company)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Download GST Invoice PDF
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Dispatch Modal */}
      <Modal
        open={Boolean(dispatchInv)}
        onClose={() => setDispatchInv(null)}
        title={`Record Dispatch — ${dispatchInv?.invoiceNo || ''}`}
        subtitle="Supports full or partial dispatch. Automatically deducts finished goods stock and posts a SALES_DISPATCH ledger entry."
      >
        {dispatchInv && (
          <form onSubmit={handleConfirmDispatch} className="space-y-4">
            {dispatchInv.items.map((it) => {
              const rem = Math.max(0, it.quantity - it.dispatchedQty);
              return (
                <div key={it.id} className="flex items-center justify-between gap-4 border-b border-slate-100 pb-3">
                  <div>
                    <div className="text-sm font-semibold text-slate-900">{it.productName}</div>
                    <div className="text-xs text-slate-500 font-mono">
                      Invoiced: {it.quantity} · Already Dispatched: {it.dispatchedQty} · Remaining: {rem} {it.unit}
                    </div>
                  </div>
                  <input
                    type="number"
                    min={0}
                    max={rem}
                    value={dispatchQtys[it.id] ?? 0}
                    onChange={(e) =>
                      setDispatchQtys({ ...dispatchQtys, [it.id]: Number(e.target.value) })
                    }
                    className="w-28 px-3 py-1.5 text-sm font-mono border border-slate-300 rounded-lg"
                  />
                </div>
              );
            })}
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Transport / Dispatch Notes</label>
              <input
                value={dispatchNotes}
                onChange={(e) => setDispatchNotes(e.target.value)}
                placeholder="e.g., Vehicle TN-38-AB-4412, E-Way Bill ref"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setDispatchInv(null)}
                className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg"
              >
                Confirm Dispatch & Deduct Stock
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Credit Note Reversal Modal */}
      <Modal
        open={Boolean(cnInv)}
        onClose={() => setCnInv(null)}
        title={`Issue Credit Note Reversal — ${cnInv?.invoiceNo || ''}`}
        subtitle="Posted GST invoices are never deleted. Issuing a Credit Note reverses the financial balance and restores dispatched stock."
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleIssueCreditNote} className="space-y-4">
          <div>
            <label htmlFor="cn-reason" className="block text-xs font-medium text-slate-700 mb-1">
              Reversal / Return Reason (Required)
            </label>
            <input
              id="cn-reason"
              required
              minLength={3}
              value={cnReason}
              onChange={(e) => setCnReason(e.target.value)}
              placeholder="e.g., Goods returned or billing rate correction"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setCnInv(null)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-lg"
            >
              Post Credit Note
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

// ===================== PAYMENTS & RECEIVABLES PAGE =====================
interface PaymentResponse {
  summary: {
    totalInvoicedPaise: number;
    totalCollectedPaise: number;
    totalOutstandingPaise: number;
    ageing: { '0-30': number; '31-60': number; '61-90': number; '90+': number };
  };
  customerOutstanding: Array<{
    customerId: number;
    customerName: string;
    state: string;
    invoicedPaise: number;
    collectedPaise: number;
    outstandingPaise: number;
    bucket0_30: number;
    bucket31_60: number;
    bucket61_90: number;
    bucket90Plus: number;
  }>;
  payments: Array<{
    id: number;
    paymentNo: string;
    invoiceNo: string;
    customerName: string;
    paymentDate: string;
    amountPaise: number;
    paymentMode: string;
    referenceNo: string;
    notes: string;
    status: string;
    recordedByName: string;
  }>;
}

export const PaymentsPage: React.FC = () => {
  const { user } = useAuth();
  const [data, setData] = useState<PaymentResponse | null>(null);
  const [openInvoices, setOpenInvoices] = useState<InvoiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({
    invoiceId: 0,
    paymentDate: new Date().toISOString().slice(0, 10),
    amountRupees: 0,
    paymentMode: 'NEFT' as 'UPI' | 'NEFT' | 'RTGS' | 'CHEQUE' | 'CASH',
    referenceNo: '',
    notes: '',
  });

  const canManage = user && ['OWNER', 'ADMIN'].includes(user.roleCode);

  const load = async () => {
    setLoading(true);
    try {
      const [payData, invData] = await Promise.all([
        apiFetch<PaymentResponse>('/api/payments'),
        apiFetch<{ invoices: InvoiceRecord[] }>('/api/invoices'),
      ]);
      setData(payData);
      const unpaid = invData.invoices.filter((i) => i.status !== 'REVERSED' && i.outstandingPaise > 0);
      setOpenInvoices(unpaid);
      if (unpaid.length > 0) {
        setPayForm((f) => ({
          ...f,
          invoiceId: unpaid[0].id,
          amountRupees: paiseToRupeesNumber(unpaid[0].outstandingPaise),
        }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load payments');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      await apiFetch('/api/payments', {
        method: 'POST',
        body: {
          ...payForm,
          invoiceId: Number(payForm.invoiceId),
          amountRupees: Number(payForm.amountRupees),
        },
      });
      setSuccess('Payment receipt posted and invoice balance updated.');
      setPayOpen(false);
      setPayForm((f) => ({ ...f, referenceNo: '', notes: '' }));
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment entry failed');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments & Receivables Ageing"
        subtitle="Record full or partial receipts against GST invoices and monitor 0–30, 31–60, 61–90, and 90+ day ageing buckets."
        actions={
          canManage &&
          openInvoices.length > 0 && (
            <button
              type="button"
              onClick={() => setPayOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Record Payment
            </button>
          )
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      {loading || !data ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <MetricCard label="Total Invoiced" value={formatINR(data.summary.totalInvoicedPaise)} />
            <MetricCard label="Total Collected" value={formatINR(data.summary.totalCollectedPaise)} tone="success" />
            <MetricCard
              label="Total Outstanding"
              value={formatINR(data.summary.totalOutstandingPaise)}
              tone={data.summary.totalOutstandingPaise > 0 ? 'warning' : 'success'}
            />
            <MetricCard
              label="Over 30 Days Due"
              value={formatINR(
                data.summary.ageing['31-60'] + data.summary.ageing['61-90'] + data.summary.ageing['90+']
              )}
              tone={
                data.summary.ageing['31-60'] + data.summary.ageing['61-90'] + data.summary.ageing['90+'] > 0
                  ? 'danger'
                  : 'success'
              }
            />
          </div>

          {/* Ageing Buckets Strip */}
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h2 className="text-sm font-semibold text-slate-900 pb-3 border-b border-slate-200">
              Receivables Ageing Analysis
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4 font-mono tabular-nums">
              <div>
                <div className="text-xs font-sans text-slate-500">0–30 Days</div>
                <div className="text-lg font-bold text-slate-900 mt-1">{formatINR(data.summary.ageing['0-30'])}</div>
              </div>
              <div>
                <div className="text-xs font-sans text-slate-500">31–60 Days</div>
                <div className="text-lg font-bold text-amber-700 mt-1">{formatINR(data.summary.ageing['31-60'])}</div>
              </div>
              <div>
                <div className="text-xs font-sans text-slate-500">61–90 Days</div>
                <div className="text-lg font-bold text-red-600 mt-1">{formatINR(data.summary.ageing['61-90'])}</div>
              </div>
              <div>
                <div className="text-xs font-sans text-slate-500">Above 90 Days</div>
                <div className="text-lg font-bold text-red-700 mt-1">{formatINR(data.summary.ageing['90+'])}</div>
              </div>
            </div>

            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 pr-3 font-semibold">Customer</th>
                    <th className="py-2 pr-3 font-semibold text-right">Invoiced</th>
                    <th className="py-2 pr-3 font-semibold text-right">Collected</th>
                    <th className="py-2 pr-3 font-semibold text-right">Outstanding</th>
                    <th className="py-2 pr-3 font-semibold text-right">0–30d</th>
                    <th className="py-2 pr-3 font-semibold text-right">31–60d</th>
                    <th className="py-2 pr-3 font-semibold text-right">61–90d</th>
                    <th className="py-2 font-semibold text-right">90+d</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.customerOutstanding.map((c) => (
                    <tr key={c.customerId}>
                      <td className="py-2.5 pr-3 font-semibold text-slate-900">
                        {c.customerName} <span className="font-normal text-slate-500">({c.state})</span>
                      </td>
                      <td className="py-2.5 pr-3 text-right font-mono">{formatINR(c.invoicedPaise)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-emerald-700">{formatINR(c.collectedPaise)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono font-bold text-slate-900">{formatINR(c.outstandingPaise)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono">{formatINR(c.bucket0_30)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-amber-700">{formatINR(c.bucket31_60)}</td>
                      <td className="py-2.5 pr-3 text-right font-mono text-red-600">{formatINR(c.bucket61_90)}</td>
                      <td className="py-2.5 text-right font-mono text-red-700">{formatINR(c.bucket90Plus)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Payment History */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
            <div className="px-5 py-3.5 border-b border-slate-200 text-sm font-semibold text-slate-900">
              Payment History ({data.payments.length})
            </div>
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-4 font-semibold">Receipt No</th>
                  <th className="py-2.5 px-4 font-semibold">Date</th>
                  <th className="py-2.5 px-4 font-semibold">Invoice</th>
                  <th className="py-2.5 px-4 font-semibold">Customer</th>
                  <th className="py-2.5 px-4 font-semibold">Mode / Reference</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Amount</th>
                  <th className="py-2.5 px-4 font-semibold">Recorded By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.payments.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="py-2.5 px-4 font-mono font-semibold text-slate-900">{p.paymentNo}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">{p.paymentDate}</td>
                    <td className="py-2.5 px-4 font-mono text-indigo-700">{p.invoiceNo}</td>
                    <td className="py-2.5 px-4 font-medium text-slate-900">{p.customerName}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-600">
                      {p.paymentMode} · {p.referenceNo}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono tabular-nums font-bold text-emerald-700">
                      {formatINR(p.amountPaise)}
                    </td>
                    <td className="py-2.5 px-4 text-slate-600">{p.recordedByName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Record Payment Modal */}
      <Modal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        title="Record Customer Payment"
        subtitle="Supports partial or full settlement against any open GST invoice."
      >
        <form onSubmit={handleRecordPayment} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Open Invoice</label>
            <select
              value={payForm.invoiceId}
              onChange={(e) => {
                const inv = openInvoices.find((i) => i.id === Number(e.target.value));
                setPayForm({
                  ...payForm,
                  invoiceId: Number(e.target.value),
                  amountRupees: inv ? paiseToRupeesNumber(inv.outstandingPaise) : 0,
                });
              }}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
            >
              {openInvoices.map((inv) => (
                <option key={inv.id} value={inv.id}>
                  {inv.invoiceNo} — {inv.customerName} (Balance: {formatINR(inv.outstandingPaise)})
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Payment Date</label>
              <input
                type="date"
                required
                value={payForm.paymentDate}
                onChange={(e) => setPayForm({ ...payForm, paymentDate: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Amount Received (₹)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={payForm.amountRupees}
                onChange={(e) => setPayForm({ ...payForm, amountRupees: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Payment Mode</label>
              <select
                value={payForm.paymentMode}
                onChange={(e) => setPayForm({ ...payForm, paymentMode: e.target.value as typeof payForm.paymentMode })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                {['UPI', 'NEFT', 'RTGS', 'CHEQUE', 'CASH'].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">UTR / Reference No</label>
              <input
                required
                value={payForm.referenceNo}
                onChange={(e) => setPayForm({ ...payForm, referenceNo: e.target.value })}
                placeholder="e.g., NEFT/20261118/9921"
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
            <input
              value={payForm.notes}
              onChange={(e) => setPayForm({ ...payForm, notes: e.target.value })}
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setPayOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              Post Payment Receipt
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
