import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rupeesToPaise,
  formatINR,
  applyWeightedAverageReceipt,
  applyWeightedAverageIssue,
  calculateGstLine,
  convertUnit,
  calculateConsumptionVariancePct,
  calculateYieldVariancePct,
  isVarianceExceeded,
  calculateProductionCostSummary,
  calculateStockShortage,
  calculateInvoiceOutstandingPaise,
  applyInvoicePayment,
  getFinancialYear,
  formatInvoiceNumber,
  getAgeingBucket,
  amountInWordsINR,
  roundQty,
} from './erpMath.ts';

test('integer-paisa conversion and INR formatting avoid floating-point drift', () => {
  assert.equal(rupeesToPaise('2.50'), 250);
  assert.equal(rupeesToPaise(45), 4500);
  assert.equal(rupeesToPaise('1,234.56'), 123456);
  assert.equal(formatINR(172500), '₹1,725.00');
  assert.equal(formatINR(515500), '₹5,155.00');
  assert.equal(formatINR(787500), '₹7,875.00');
  assert.equal(formatINR(387500), '₹3,875.00');
});

test('NIT Trichy benchmark: weighted-average flour purchase, production consumption, pouch damage (306 closing), and batch costing', () => {
  // Opening flour: 100 kg @ ₹42/kg
  const openingStock = 100;
  const openingVal = openingStock * 4200; // 420,000 paise

  // Step 1: Purchase 60 kg flour @ ₹45/kg -> 160 kg @ ₹43.125/kg (690,000 paise)
  const flourAfterPurchase = applyWeightedAverageReceipt({
    currentStock: openingStock,
    currentValuationPaise: openingVal,
    receiptQty: 60,
    receiptRatePaise: 4500,
  });
  assert.equal(flourAfterPurchase.newStock, 160);
  assert.equal(flourAfterPurchase.newValuationPaise, 690000);
  assert.equal(flourAfterPurchase.newWeightedAvgRatePaise, 4313); // ₹43.125 rounded display

  // Step 2: Production run consumption — 1 batch Murukku 200 g (expected 200 pkts, actual 188 good pkts)
  // Flour: 160 - 40 = 120 kg, issue cost = 40 * ₹43.125 = ₹1,725.00 exact
  const flourIssue = applyWeightedAverageIssue({
    currentStock: flourAfterPurchase.newStock,
    currentValuationPaise: flourAfterPurchase.newValuationPaise,
    fallbackRatePaise: flourAfterPurchase.newWeightedAvgRatePaise,
    issueQty: 40,
  });
  assert.equal(flourIssue.newStock, 120);
  assert.equal(flourIssue.issueCostPaise, 172500);
  assert.equal(flourIssue.newValuationPaise, 517500); // 120 * ₹43.125 = ₹5,175.00

  // Oil: 30 - 10.5 = 19.5 litres
  const oilIssue = applyWeightedAverageIssue({
    currentStock: 30,
    currentValuationPaise: 30 * 14000,
    fallbackRatePaise: 14000,
    issueQty: 10.5,
  });
  assert.equal(oilIssue.newStock, 19.5);
  assert.equal(oilIssue.issueCostPaise, 147000); // ₹1,470.00

  // Spice: 5 - 1.2 = 3.8 kg
  const spiceIssue = applyWeightedAverageIssue({
    currentStock: 5,
    currentValuationPaise: 5 * 20000,
    fallbackRatePaise: 20000,
    issueQty: 1.2,
  });
  assert.equal(spiceIssue.newStock, 3.8);
  assert.equal(spiceIssue.issueCostPaise, 24000); // ₹240.00

  // Mandatory Pouch Benchmark:
  // Opening 500 -> 188 good packets consumed -> 6 damaged pouches -> 194 total consumed -> 306 closing
  const pouchGoodIssue = applyWeightedAverageIssue({
    currentStock: 500,
    currentValuationPaise: 500 * 250,
    fallbackRatePaise: 250,
    issueQty: 188,
  });
  assert.equal(pouchGoodIssue.newStock, 312);
  assert.equal(pouchGoodIssue.issueCostPaise, 47000); // ₹470.00

  const pouchDamageIssue = applyWeightedAverageIssue({
    currentStock: pouchGoodIssue.newStock,
    currentValuationPaise: pouchGoodIssue.newValuationPaise,
    fallbackRatePaise: 250,
    issueQty: 6,
  });
  assert.equal(pouchDamageIssue.newStock, 306);
  assert.equal(pouchDamageIssue.issueCostPaise, 1500); // ₹15.00
  const totalPouchCostPaise = pouchGoodIssue.issueCostPaise + pouchDamageIssue.issueCostPaise;
  assert.equal(totalPouchCostPaise, 48500); // 194 * ₹2.50 = ₹485.00

  // Cartons: 30 - 9 = 21 pieces
  const cartonIssue = applyWeightedAverageIssue({
    currentStock: 30,
    currentValuationPaise: 30 * 1500,
    fallbackRatePaise: 1500,
    issueQty: 9,
  });
  assert.equal(cartonIssue.newStock, 21);
  assert.equal(cartonIssue.issueCostPaise, 13500); // ₹135.00

  // Production Costing: Raw ₹3,435 + Packaging ₹620 + Labour/Gas/OH ₹1,100 = ₹5,155.00
  const rawTotal = flourIssue.issueCostPaise + oilIssue.issueCostPaise + spiceIssue.issueCostPaise;
  const packTotal = totalPouchCostPaise + cartonIssue.issueCostPaise;
  assert.equal(rawTotal, 343500);
  assert.equal(packTotal, 62000);

  const cost = calculateProductionCostSummary({
    rawMaterialCostPaise: rawTotal,
    packagingCostPaise: packTotal,
    labourCostPaise: 60000,
    gasPowerCostPaise: 35000,
    otherOverheadPaise: 15000,
    actualGoodPackets: 188,
    sellingPricePaise: 5000,
  });
  assert.equal(cost.totalProductionCostPaise, 515500); // ₹5,155.00
  assert.equal(cost.costPerGoodPacketPaise, 2742); // ₹27.42/pkt (515500 / 188 = 2742.02)
  assert.equal(cost.grossMarginPerPacketPaise, 2258); // ₹22.58/pkt
});

test('yield variance (-6%), oil consumption variance (+5%), pouch variance (-3%), and 3% tolerance flagging', () => {
  const yieldVar = calculateYieldVariancePct(200, 188);
  assert.equal(yieldVar, -6);
  assert.equal(isVarianceExceeded(yieldVar, 3), true);

  const oilVar = calculateConsumptionVariancePct(10, 10.5);
  assert.equal(oilVar, 5);
  assert.equal(isVarianceExceeded(oilVar, 3), true);

  const flourVar = calculateConsumptionVariancePct(40, 40);
  assert.equal(flourVar, 0);
  assert.equal(isVarianceExceeded(flourVar, 3), false);

  // Total pouch consumption = 188 good + 6 damaged = 194 vs 200 planned = -3.00% (within ±3% limit)
  const pouchVar = calculateConsumptionVariancePct(200, 194);
  assert.equal(pouchVar, -3);
  assert.equal(isVarianceExceeded(pouchVar, 3), false);

  const cartonVar = calculateConsumptionVariancePct(10, 9);
  assert.equal(cartonVar, -10);
  assert.equal(isVarianceExceeded(cartonVar, 3), true);
});

test('NIT Trichy benchmark: finished goods stock, Retailer A GST invoice (₹7,875), dispatch (88 pkts), payment (₹3,875), and Distributor B shortage (32 pkts)', () => {
  // Finished goods after production: 50 opening + 188 good produced = 238 packets
  const fgAfterProduction = roundQty(50 + 188);
  assert.equal(fgAfterProduction, 238);

  // Retailer A (Tamil Nadu — Intra-state 5% GST): 150 packets @ ₹50
  const retailerAInvoice = calculateGstLine({
    quantity: 150,
    unitPricePaise: 5000,
    gstPct: 5,
    isInterState: false,
  });
  assert.equal(retailerAInvoice.taxableValuePaise, 750000); // ₹7,500.00
  assert.equal(retailerAInvoice.cgstPaise, 18750); // ₹187.50
  assert.equal(retailerAInvoice.sgstPaise, 18750); // ₹187.50
  assert.equal(retailerAInvoice.igstPaise, 0);
  assert.equal(retailerAInvoice.lineTotalPaise, 787500); // ₹7,875.00

  // Dispatch 150 packets to Retailer A -> 238 - 150 = 88 packets remaining
  const fgAfterDispatch = roundQty(fgAfterProduction - 150);
  assert.equal(fgAfterDispatch, 88);

  // Retailer A partial payment ₹4,000.00 -> Outstanding ₹3,875.00
  const partialPayment = applyInvoicePayment({
    grandTotalPaise: retailerAInvoice.lineTotalPaise,
    currentPaidPaise: 0,
    paymentAmountPaise: 400000,
    currentStatus: 'POSTED',
  });
  assert.equal(partialPayment.newPaidPaise, 400000);
  assert.equal(partialPayment.outstandingPaise, 387500); // ₹3,875.00
  assert.equal(partialPayment.newStatus, 'PARTIALLY_PAID');

  // Distributor B orders 120 packets vs 88 available -> Shortage = 32 packets
  const distributorBShortage = calculateStockShortage(120, fgAfterDispatch);
  assert.equal(distributorBShortage, 32);
  assert.equal(calculateStockShortage(80, fgAfterDispatch), 0);

  // Distributor B Inter-state IGST (Tamil Nadu -> Karnataka): 120 packets @ ₹50, 5% IGST
  const distributorBGst = calculateGstLine({
    quantity: 120,
    unitPricePaise: 5000,
    gstPct: 5,
    isInterState: true,
  });
  assert.equal(distributorBGst.taxableValuePaise, 600000);
  assert.equal(distributorBGst.cgstPaise, 0);
  assert.equal(distributorBGst.sgstPaise, 0);
  assert.equal(distributorBGst.igstPaise, 30000); // ₹300.00
  assert.equal(distributorBGst.lineTotalPaise, 630000); // ₹6,300.00
});

test('payment settlement guards prevent overpayment and reversed-invoice collections', () => {
  // Full settlement transitions to PAID with 0 outstanding
  const settled = applyInvoicePayment({
    grandTotalPaise: 787500,
    currentPaidPaise: 400000,
    paymentAmountPaise: 387500,
    currentStatus: 'PARTIALLY_PAID',
  });
  assert.equal(settled.newPaidPaise, 787500);
  assert.equal(settled.outstandingPaise, 0);
  assert.equal(settled.newStatus, 'PAID');

  // Overpayment throws
  assert.throws(
    () =>
      applyInvoicePayment({
        grandTotalPaise: 787500,
        currentPaidPaise: 400000,
        paymentAmountPaise: 400000,
        currentStatus: 'PARTIALLY_PAID',
      }),
    /exceeds invoice balance/
  );

  // Payment against REVERSED invoice throws
  assert.throws(
    () =>
      applyInvoicePayment({
        grandTotalPaise: 787500,
        currentPaidPaise: 0,
        paymentAmountPaise: 100000,
        currentStatus: 'REVERSED',
      }),
    /reversed invoice/
  );

  // Reversed invoice reports 0 outstanding
  assert.equal(calculateInvoiceOutstandingPaise(787500, 0, 'REVERSED'), 0);
});

test('unit conversions handle mass and volume accurately', () => {
  assert.equal(convertUnit(1.2, 'kg', 'g'), 1200);
  assert.equal(convertUnit(500, 'g', 'kg'), 0.5);
  assert.equal(convertUnit(10.5, 'litre', 'ml'), 10500);
  assert.equal(convertUnit(250, 'ml', 'litre'), 0.25);
});

test('financial year, invoice numbering, ageing buckets, and amount in words', () => {
  assert.equal(getFinancialYear('2026-11-18'), '2026-27');
  assert.equal(getFinancialYear('2026-02-15'), '2025-26');
  assert.equal(formatInvoiceNumber('FF', '2026-27', 1), 'FF/2026-27/0001');
  assert.equal(getAgeingBucket('2026-11-01', '2026-11-18'), '0-30');
  assert.equal(getAgeingBucket('2026-10-01', '2026-11-18'), '31-60');
  assert.equal(getAgeingBucket('2026-09-01', '2026-11-18'), '61-90');
  assert.equal(getAgeingBucket('2026-07-01', '2026-11-18'), '90+');
  assert.equal(amountInWordsINR(787500), 'Rupees Seven Thousand Eight Hundred Seventy Five Only');
  assert.equal(amountInWordsINR(105050), 'Rupees One Thousand Fifty and Fifty Paise Only');
});
