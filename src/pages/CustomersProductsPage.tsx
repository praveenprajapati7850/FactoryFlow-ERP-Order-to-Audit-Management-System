import React, { useEffect, useState } from 'react';
import { Plus, Edit2 } from 'lucide-react';
import { apiFetch } from '../lib/api';
import { formatINR, INDIAN_STATES, paiseToRupeesNumber } from '../utils/erpMath';
import { useAuth } from '../context/AuthContext';
import { PageHeader, StatusText, AlertBanner, Modal, LoadingSkeleton } from '../components/ui/DataPrimitives';

interface CustomerRecord {
  id: number;
  name: string;
  customerType: 'RETAILER' | 'DISTRIBUTOR';
  gstin: string;
  phone: string;
  address: string;
  state: string;
  stateCode: string;
  creditLimitPaise: number;
  assignedSalesmanId: number | null;
  assignedSalesmanName: string;
  isActive: boolean;
}

interface SalesmanOption {
  id: number;
  name: string;
  roleCode: string;
}

export const CustomersPage: React.FC = () => {
  const { user } = useAuth();
  const [customers, setCustomers] = useState<CustomerRecord[]>([]);
  const [salesmen, setSalesmen] = useState<SalesmanOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRecord | null>(null);
  const [form, setForm] = useState({
    name: '',
    customerType: 'RETAILER' as 'RETAILER' | 'DISTRIBUTOR',
    gstin: '',
    phone: '',
    address: '',
    state: 'Tamil Nadu',
    stateCode: '33',
    creditLimitRupees: 50000,
    assignedSalesmanId: '' as string,
  });

  const canManage = user && ['OWNER', 'ADMIN'].includes(user.roleCode);

  const load = async () => {
    setLoading(true);
    try {
      const custs = await apiFetch<CustomerRecord[]>('/api/customers');
      setCustomers(custs);
      if (canManage) {
        const userResp = await apiFetch<{ users: SalesmanOption[] }>('/api/users');
        setSalesmen(userResp.users.filter((u) => u.roleCode === 'SALESMAN'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load customers');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({
      name: '',
      customerType: 'RETAILER',
      gstin: '',
      phone: '',
      address: '',
      state: 'Tamil Nadu',
      stateCode: '33',
      creditLimitRupees: 50000,
      assignedSalesmanId: salesmen[0] ? String(salesmen[0].id) : '',
    });
    setModalOpen(true);
  };

  const openEdit = (c: CustomerRecord) => {
    setEditing(c);
    setForm({
      name: c.name,
      customerType: c.customerType,
      gstin: c.gstin,
      phone: c.phone,
      address: c.address,
      state: c.state,
      stateCode: c.stateCode,
      creditLimitRupees: paiseToRupeesNumber(c.creditLimitPaise),
      assignedSalesmanId: c.assignedSalesmanId ? String(c.assignedSalesmanId) : '',
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        ...form,
        creditLimitRupees: Number(form.creditLimitRupees),
        assignedSalesmanId: form.assignedSalesmanId ? Number(form.assignedSalesmanId) : null,
      };
      if (editing) {
        await apiFetch(`/api/customers/${editing.id}`, { method: 'PUT', body: payload });
        setSuccess(`Customer "${form.name}" updated.`);
      } else {
        await apiFetch('/api/customers', { method: 'POST', body: payload });
        setSuccess(`Customer "${form.name}" added.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const filtered = customers.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.gstin.toLowerCase().includes(search.toLowerCase()) ||
      c.state.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Customers & Trade Partners"
        subtitle="Manage Retailers and Distributors with GSTIN jurisdiction (intra-state vs inter-state), credit limits, and assigned salesmen."
        actions={
          canManage && (
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add Customer
            </button>
          )
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      <div className="flex items-center justify-between gap-4">
        <input
          type="search"
          aria-label="Search customers"
          placeholder="Search customer name, GSTIN, or state..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-sm px-3 py-2 text-sm bg-white border border-slate-300 rounded-lg"
        />
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-semibold">Customer Name</th>
                <th className="py-3 px-4 font-semibold">Type</th>
                <th className="py-3 px-4 font-semibold">GSTIN</th>
                <th className="py-3 px-4 font-semibold">State / Code</th>
                <th className="py-3 px-4 font-semibold">Salesman</th>
                <th className="py-3 px-4 font-semibold text-right">Credit Limit</th>
                {canManage && <th className="py-3 px-4 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4">
                    <div className="font-semibold text-slate-900">{c.name}</div>
                    <div className="text-slate-500">{c.phone} · {c.address}</div>
                  </td>
                  <td className="py-3 px-4 font-medium text-slate-700">{c.customerType}</td>
                  <td className="py-3 px-4 font-mono text-slate-700 whitespace-nowrap">{c.gstin}</td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {c.state} <span className="font-mono text-slate-500">({c.stateCode})</span>
                  </td>
                  <td className="py-3 px-4 text-slate-700">{c.assignedSalesmanName}</td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-medium text-slate-900">
                    {formatINR(c.creditLimitPaise)}
                  </td>
                  {canManage && (
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(c)}
                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add New Customer'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Customer Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Customer Type</label>
              <select
                value={form.customerType}
                onChange={(e) => setForm({ ...form, customerType: e.target.value as 'RETAILER' | 'DISTRIBUTOR' })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="RETAILER">Retailer</option>
                <option value="DISTRIBUTOR">Distributor</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">GSTIN</label>
              <input
                required
                value={form.gstin}
                onChange={(e) => setForm({ ...form, gstin: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
              <input
                required
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">State</label>
              <select
                value={form.state}
                onChange={(e) => {
                  const st = INDIAN_STATES.find((s) => s.name === e.target.value);
                  setForm({ ...form, state: e.target.value, stateCode: st?.code || '33' });
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
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Credit Limit (INR)</label>
              <input
                type="number"
                min={0}
                value={form.creditLimitRupees}
                onChange={(e) => setForm({ ...form, creditLimitRupees: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-slate-700 mb-1">Address</label>
              <input
                required
                value={form.address}
                onChange={(e) => setForm({ ...form, address: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Assigned Salesman</label>
              <select
                value={form.assignedSalesmanId}
                onChange={(e) => setForm({ ...form, assignedSalesmanId: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
              >
                <option value="">Unassigned</option>
                {salesmen.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              {editing ? 'Update Customer' : 'Save Customer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

// ===================== PRODUCTS PAGE =====================
interface ProductRecord {
  id: number;
  name: string;
  sku: string;
  packSize: string;
  hsnCode: string;
  gstPct: number;
  sellingPricePaise: number;
  unit: string;
  minStockLevel: number;
  currentStock: number;
  avgCostPaise: number;
  isActive: boolean;
}

export const ProductsPage: React.FC = () => {
  const { user } = useAuth();
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ProductRecord | null>(null);
  const [form, setForm] = useState({
    name: '',
    sku: '',
    packSize: '200 g',
    hsnCode: '21069099',
    gstPct: 5,
    sellingPriceRupees: 50,
    unit: 'packets',
    minStockLevel: 40,
    isActive: true,
  });

  const canManage = user && ['OWNER', 'ADMIN'].includes(user.roleCode);

  const load = async () => {
    setLoading(true);
    try {
      setProducts(await apiFetch<ProductRecord[]>('/api/products'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load products');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const openNew = () => {
    setEditing(null);
    setForm({
      name: '',
      sku: '',
      packSize: '200 g',
      hsnCode: '21069099',
      gstPct: 5,
      sellingPriceRupees: 50,
      unit: 'packets',
      minStockLevel: 40,
      isActive: true,
    });
    setModalOpen(true);
  };

  const openEdit = (p: ProductRecord) => {
    setEditing(p);
    setForm({
      name: p.name,
      sku: p.sku,
      packSize: p.packSize,
      hsnCode: p.hsnCode,
      gstPct: p.gstPct,
      sellingPriceRupees: paiseToRupeesNumber(p.sellingPricePaise),
      unit: p.unit,
      minStockLevel: p.minStockLevel,
      isActive: p.isActive,
    });
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    try {
      const payload = {
        ...form,
        gstPct: Number(form.gstPct),
        sellingPriceRupees: Number(form.sellingPriceRupees),
        minStockLevel: Number(form.minStockLevel),
      };
      if (editing) {
        await apiFetch(`/api/products/${editing.id}`, { method: 'PUT', body: payload });
        setSuccess(`Product "${form.name}" updated.`);
      } else {
        await apiFetch('/api/products', { method: 'POST', body: payload });
        setSuccess(`Product "${form.name}" created.`);
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save product');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products & Active Price List"
        subtitle="Finished goods catalog with HSN codes, GST percentages, selling prices, weighted average unit cost, and live ledger stock."
        actions={
          canManage && (
            <button
              type="button"
              onClick={openNew}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg whitespace-nowrap"
            >
              <Plus className="w-4 h-4" aria-hidden="true" />
              Add Product
            </button>
          )
        }
      />

      {error && <AlertBanner tone="error" message={error} onDismiss={() => setError(null)} />}
      {success && <AlertBanner tone="success" message={success} onDismiss={() => setSuccess(null)} />}

      {loading ? (
        <LoadingSkeleton rows={4} />
      ) : (
        <div className="bg-white border border-slate-200 rounded-lg overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-3 px-4 font-semibold">SKU</th>
                <th className="py-3 px-4 font-semibold">Product Name</th>
                <th className="py-3 px-4 font-semibold">Pack Size</th>
                <th className="py-3 px-4 font-semibold">HSN / GST</th>
                <th className="py-3 px-4 font-semibold text-right">Selling Price</th>
                <th className="py-3 px-4 font-semibold text-right">Avg Cost</th>
                <th className="py-3 px-4 font-semibold text-right">Live Stock</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                {canManage && <th className="py-3 px-4 font-semibold text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {products.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <td className="py-3 px-4 font-mono font-semibold text-slate-700 whitespace-nowrap">{p.sku}</td>
                  <td className="py-3 px-4 font-semibold text-slate-900">{p.name}</td>
                  <td className="py-3 px-4 text-slate-600">{p.packSize}</td>
                  <td className="py-3 px-4 font-mono text-slate-600 whitespace-nowrap">
                    {p.hsnCode} · {p.gstPct}%
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {formatINR(p.sellingPricePaise)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-600">
                    {formatINR(p.avgCostPaise)}
                  </td>
                  <td
                    className={`py-3 px-4 text-right font-mono tabular-nums font-semibold ${
                      p.currentStock <= p.minStockLevel ? 'text-red-700' : 'text-emerald-700'
                    }`}
                  >
                    {p.currentStock} {p.unit}
                  </td>
                  <td className="py-3 px-4">
                    <StatusText status={p.isActive ? 'ACTIVE' : 'INACTIVE'} />
                  </td>
                  {canManage && (
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openEdit(p)}
                        className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium"
                      >
                        <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editing ? `Edit ${editing.name}` : 'Add Finished Product'}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Product Name</label>
              <input
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">SKU</label>
              <input
                required
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Pack Size</label>
              <input
                required
                value={form.packSize}
                onChange={(e) => setForm({ ...form, packSize: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">HSN Code</label>
              <input
                required
                value={form.hsnCode}
                onChange={(e) => setForm({ ...form, hsnCode: e.target.value })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">GST Percentage (%)</label>
              <input
                type="number"
                step="0.5"
                min={0}
                max={28}
                value={form.gstPct}
                onChange={(e) => setForm({ ...form, gstPct: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Selling Price before tax (₹)</label>
              <input
                type="number"
                step="0.01"
                min={1}
                value={form.sellingPriceRupees}
                onChange={(e) => setForm({ ...form, sellingPriceRupees: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Unit</label>
              <input
                required
                value={form.unit}
                onChange={(e) => setForm({ ...form, unit: e.target.value })}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">Minimum Stock Level</label>
              <input
                type="number"
                min={0}
                value={form.minStockLevel}
                onChange={(e) => setForm({ ...form, minStockLevel: Number(e.target.value) })}
                className="w-full px-3 py-2 text-sm font-mono border border-slate-300 rounded-lg"
              />
            </div>
          </div>
          <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-700">
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
            />
            Product is Active for ordering
          </label>
          <div className="flex justify-end gap-2 pt-3">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="px-3.5 py-2 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              {editing ? 'Update Product' : 'Save Product'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
