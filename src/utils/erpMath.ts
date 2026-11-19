/**
 * Pure deterministic ERP accounting, inventory valuation, BOM variance,
 * GST tax, costing, and ageing math utilities.
 * All monetary amounts use integer paise (1 INR = 100 paise) to prevent floating-point errors.
 */

export const INDIAN_STATES: ReadonlyArray<{ name: string; code: string }> = [
  { name: 'Tamil Nadu', code: '33' },
  { name: 'Karnataka', code: '29' },
  { name: 'Kerala', code: '32' },
  { name: 'Andhra Pradesh', code: '37' },
  { name: 'Telangana', code: '36' },
  { name: 'Maharashtra', code: '27' },
  { name: 'Gujarat', code: '24' },
  { name: 'Delhi', code: '07' },
  { name: 'West Bengal', code: '19' },
  { name: 'Rajasthan', code: '08' },
  { name: 'Uttar Pradesh', code: '09' },
  { name: 'Puducherry', code: '34' },
];

export function rupeesToPaise(val: number | string): number {
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return 0;
    return Math.round(val * 100);
  }
  const cleaned = String(val).replace(/[₹,\s]/g, '').trim();
  if (!cleaned) return 0;
  const neg = cleaned.startsWith('-');
  const unsigned = neg ? cleaned.slice(1) : cleaned;
  const [wholePart = '0', fracPart = ''] = unsigned.split('.');
  const whole = parseInt(wholePart || '0', 10) || 0;
  const fracPadded = (fracPart + '00').slice(0, 2);
  const frac = parseInt(fracPadded, 10) || 0;
  const result = whole * 100 + frac;
  return neg ? -result : result;
}

export function paiseToRupeesNumber(paise: number): number {
  return Math.round(paise) / 100;
}

export function formatINR(paise: number): string {
  const safe = Math.round(Number(paise) || 0);
  const neg = safe < 0;
  const abs = Math.abs(safe);
  const rupees = Math.floor(abs / 100);
  const remPaise = abs % 100;
  const formattedWhole = rupees.toLocaleString('en-IN');
  const formattedDec = String(remPaise).padStart(2, '0');
  return `${neg ? '-' : ''}₹${formattedWhole}.${formattedDec}`;
}

export function roundQty(qty: number): number {
  return Math.round((Number(qty) || 0) * 1000) / 1000;
}

/**
 * Multiply a physical quantity (up to 3 decimals) by an integer-paisa unit rate.
 */
export function multiplyQtyPaise(qty: number, unitRatePaise: number): number {
  const qtyMilli = Math.round(qty * 1000);
  return Math.round((qtyMilli * Math.round(unitRatePaise)) / 1000);
}

/**
 * Weighted average receipt: returns updated stock, valuation, and average rate in paise.
 */
export function applyWeightedAverageReceipt(params: {
  currentStock: number;
  currentValuationPaise: number;
  receiptQty: number;
  receiptRatePaise: number;
}): {
  newStock: number;
  newValuationPaise: number;
  newWeightedAvgRatePaise: number;
  receiptValuePaise: number;
} {
  const receiptValuePaise = multiplyQtyPaise(params.receiptQty, params.receiptRatePaise);
  const newStock = roundQty(params.currentStock + params.receiptQty);
  const newValuationPaise = Math.round(params.currentValuationPaise) + receiptValuePaise;
  const newWeightedAvgRatePaise =
    newStock > 0 ? Math.round((newValuationPaise * 1000) / Math.round(newStock * 1000)) : 0;

  return {
    newStock,
    newValuationPaise,
    newWeightedAvgRatePaise,
    receiptValuePaise,
  };
}

/**
 * Weighted average issue: computes exact integer-paisa issue cost proportionally from pool valuation.
 */
export function applyWeightedAverageIssue(params: {
  currentStock: number;
  currentValuationPaise: number;
  fallbackRatePaise: number;
  issueQty: number;
}): {
  newStock: number;
  newValuationPaise: number;
  issueCostPaise: number;
  effectiveUnitCostPaise: number;
} {
  const stockMilli = Math.round(params.currentStock * 1000);
  const issueMilli = Math.round(params.issueQty * 1000);
  let issueCostPaise: number;
  if (stockMilli > 0 && params.currentValuationPaise > 0) {
    issueCostPaise = Math.round((params.currentValuationPaise * issueMilli) / stockMilli);
  } else {
    issueCostPaise = multiplyQtyPaise(params.issueQty, params.fallbackRatePaise);
  }
  const newStock = roundQty(params.currentStock - params.issueQty);
  const newValuationPaise = Math.max(0, Math.round(params.currentValuationPaise) - issueCostPaise);
  const effectiveUnitCostPaise =
    issueMilli > 0 ? Math.round((issueCostPaise * 1000) / issueMilli) : params.fallbackRatePaise;

  return {
    newStock,
    newValuationPaise,
    issueCostPaise,
    effectiveUnitCostPaise,
  };
}

export interface GstLineResult {
  taxableValuePaise: number;
  totalTaxPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  lineTotalPaise: number;
}

export function calculateGstLine(params: {
  quantity: number;
  unitPricePaise: number;
  gstPct: number;
  isInterState: boolean;
}): GstLineResult {
  const taxableValuePaise = multiplyQtyPaise(params.quantity, params.unitPricePaise);
  const gstBps = Math.round(params.gstPct * 100); // e.g., 5% -> 500 bps
  const totalTaxPaise = Math.round((taxableValuePaise * gstBps) / 10000);

  if (params.isInterState) {
    return {
      taxableValuePaise,
      totalTaxPaise,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: totalTaxPaise,
      lineTotalPaise: taxableValuePaise + totalTaxPaise,
    };
  }

  const cgstPaise = Math.floor(totalTaxPaise / 2);
  const sgstPaise = totalTaxPaise - cgstPaise;
  return {
    taxableValuePaise,
    totalTaxPaise,
    cgstPaise,
    sgstPaise,
    igstPaise: 0,
    lineTotalPaise: taxableValuePaise + totalTaxPaise,
  };
}

export function convertUnit(qty: number, fromUnit: string, toUnit: string): number {
  const f = fromUnit.trim().toLowerCase();
  const t = toUnit.trim().toLowerCase();
  if (f === t) return roundQty(qty);

  // Mass
  if ((f === 'kg' || f === 'kilogram') && (t === 'g' || t === 'gram' || t === 'grams')) {
    return roundQty(qty * 1000);
  }
  if ((f === 'g' || f === 'gram' || f === 'grams') && (t === 'kg' || t === 'kilogram')) {
    return roundQty(qty / 1000);
  }

  // Volume
  if (
    (f === 'litre' || f === 'litres' || f === 'l' || f === 'liter') &&
    (t === 'ml' || t === 'millilitre' || t === 'millilitres')
  ) {
    return roundQty(qty * 1000);
  }
  if (
    (f === 'ml' || f === 'millilitre' || f === 'millilitres') &&
    (t === 'litre' || t === 'litres' || t === 'l' || t === 'liter')
  ) {
    return roundQty(qty / 1000);
  }

  return roundQty(qty);
}

export function calculateConsumptionVariancePct(plannedQty: number, actualQty: number): number {
  if (plannedQty <= 0) return 0;
  return Math.round(((actualQty - plannedQty) / plannedQty) * 10000) / 100;
}

export function calculateYieldVariancePct(expectedOutput: number, actualGoodOutput: number): number {
  if (expectedOutput <= 0) return 0;
  return Math.round(((actualGoodOutput - expectedOutput) / expectedOutput) * 10000) / 100;
}

export function isVarianceExceeded(variancePct: number, tolerancePct = 3): boolean {
  return Math.abs(variancePct) > tolerancePct;
}

export interface ProductionCostSummary {
  rawMaterialCostPaise: number;
  packagingCostPaise: number;
  labourCostPaise: number;
  gasPowerCostPaise: number;
  otherOverheadPaise: number;
  totalProductionCostPaise: number;
  costPerGoodPacketPaise: number;
  grossMarginPerPacketPaise: number;
  grossMarginPct: number;
}

export function calculateProductionCostSummary(params: {
  rawMaterialCostPaise: number;
  packagingCostPaise: number;
  labourCostPaise: number;
  gasPowerCostPaise: number;
  otherOverheadPaise: number;
  actualGoodPackets: number;
  sellingPricePaise: number;
}): ProductionCostSummary {
  const totalProductionCostPaise =
    Math.round(params.rawMaterialCostPaise) +
    Math.round(params.packagingCostPaise) +
    Math.round(params.labourCostPaise) +
    Math.round(params.gasPowerCostPaise) +
    Math.round(params.otherOverheadPaise);

  const costPerGoodPacketPaise =
    params.actualGoodPackets > 0
      ? Math.round(totalProductionCostPaise / params.actualGoodPackets)
      : 0;

  const grossMarginPerPacketPaise = Math.round(params.sellingPricePaise) - costPerGoodPacketPaise;
  const grossMarginPct =
    params.sellingPricePaise > 0
      ? Math.round((grossMarginPerPacketPaise / params.sellingPricePaise) * 10000) / 100
      : 0;

  return {
    rawMaterialCostPaise: Math.round(params.rawMaterialCostPaise),
    packagingCostPaise: Math.round(params.packagingCostPaise),
    labourCostPaise: Math.round(params.labourCostPaise),
    gasPowerCostPaise: Math.round(params.gasPowerCostPaise),
    otherOverheadPaise: Math.round(params.otherOverheadPaise),
    totalProductionCostPaise,
    costPerGoodPacketPaise,
    grossMarginPerPacketPaise,
    grossMarginPct,
  };
}

export function getFinancialYear(isoDate: string): string {
  const parts = isoDate.split('-').map(Number);
  const year = parts[0] || new Date().getFullYear();
  const month = parts[1] || new Date().getMonth() + 1;
  if (month >= 4) {
    return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
  }
  return `${year - 1}-${String(year % 100).padStart(2, '0')}`;
}

export function formatInvoiceNumber(prefix: string, fy: string, sequence: number): string {
  return `${prefix}/${fy}/${String(sequence).padStart(4, '0')}`;
}

export type AgeingBucket = '0-30' | '31-60' | '61-90' | '90+';

export function getAgeingBucket(invoiceDateStr: string, asOfDateStr?: string): AgeingBucket {
  const invDate = new Date(`${invoiceDateStr}T00:00:00Z`).getTime();
  const refDate = asOfDateStr
    ? new Date(`${asOfDateStr}T00:00:00Z`).getTime()
    : Date.now();
  const diffDays = Math.max(0, Math.floor((refDate - invDate) / (1000 * 60 * 60 * 24)));
  if (diffDays <= 30) return '0-30';
  if (diffDays <= 60) return '31-60';
  if (diffDays <= 90) return '61-90';
  return '90+';
}

export function calculateStockShortage(orderedQty: number, availableStock: number): number {
  const shortage = roundQty(orderedQty - Math.max(0, availableStock));
  return shortage > 0 ? shortage : 0;
}

export function calculateInvoiceOutstandingPaise(
  grandTotalPaise: number,
  paidPaise: number,
  status: string
): number {
  if (status === 'REVERSED') return 0;
  return Math.max(0, Math.round(grandTotalPaise) - Math.round(paidPaise));
}

export function applyInvoicePayment(params: {
  grandTotalPaise: number;
  currentPaidPaise: number;
  paymentAmountPaise: number;
  currentStatus: string;
}): {
  newPaidPaise: number;
  outstandingPaise: number;
  newStatus: 'PARTIALLY_PAID' | 'PAID';
} {
  if (params.currentStatus === 'REVERSED') {
    throw new Error('Cannot record payment against a reversed invoice');
  }
  const payment = Math.round(params.paymentAmountPaise);
  if (payment <= 0) {
    throw new Error('Payment amount must be greater than zero');
  }
  const remaining = Math.max(0, Math.round(params.grandTotalPaise) - Math.round(params.currentPaidPaise));
  if (payment > remaining) {
    throw new Error(`Payment (${formatINR(payment)}) exceeds invoice balance (${formatINR(remaining)})`);
  }
  const newPaidPaise = Math.round(params.currentPaidPaise) + payment;
  const outstandingPaise = Math.max(0, Math.round(params.grandTotalPaise) - newPaidPaise);
  const newStatus = outstandingPaise === 0 ? 'PAID' : 'PARTIALLY_PAID';
  return { newPaidPaise, outstandingPaise, newStatus };
}

const ONES = [
  '',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];

const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n];
  const t = Math.floor(n / 10);
  const o = n % 10;
  return o ? `${TENS[t]} ${ONES[o]}` : TENS[t];
}

function numberToIndianWords(num: number): string {
  if (num === 0) return 'Zero';
  const parts: string[] = [];
  let rem = Math.floor(num);

  const crore = Math.floor(rem / 10000000);
  rem %= 10000000;
  if (crore > 0) parts.push(`${numberToIndianWords(crore)} Crore`);

  const lakh = Math.floor(rem / 100000);
  rem %= 100000;
  if (lakh > 0) parts.push(`${twoDigitsToWords(lakh)} Lakh`);

  const thousand = Math.floor(rem / 1000);
  rem %= 1000;
  if (thousand > 0) parts.push(`${twoDigitsToWords(thousand)} Thousand`);

  const hundred = Math.floor(rem / 100);
  rem %= 100;
  if (hundred > 0) parts.push(`${ONES[hundred]} Hundred`);

  if (rem > 0) parts.push(twoDigitsToWords(rem));

  return parts.join(' ').trim();
}

export function amountInWordsINR(paise: number): string {
  const safe = Math.abs(Math.round(paise));
  const rupees = Math.floor(safe / 100);
  const remPaise = safe % 100;
  const rupeeWords = `Rupees ${numberToIndianWords(rupees)}`;
  if (remPaise > 0) {
    return `${rupeeWords} and ${twoDigitsToWords(remPaise)} Paise Only`;
  }
  return `${rupeeWords} Only`;
}
