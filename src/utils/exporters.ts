import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { formatINR } from './erpMath';

export interface PrintableInvoice {
  invoiceNo: string;
  financialYear: string;
  invoiceDate: string;
  dueDate: string;
  supplyType: string;
  customerName: string;
  customerGstin: string;
  customerAddress: string;
  customerState: string;
  customerStateCode: string;
  customerPhone: string;
  taxableValuePaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  grandTotalPaise: number;
  amountInWords: string;
  status: string;
  items: Array<{
    productName: string;
    hsnCode: string;
    quantity: number;
    unit: string;
    unitPricePaise: number;
    taxableValuePaise: number;
    gstPct: number;
    cgstPaise: number;
    sgstPaise: number;
    igstPaise: number;
    lineTotalPaise: number;
  }>;
}

export interface PrintableCompany {
  companyName: string;
  gstin: string;
  address: string;
  state: string;
  stateCode: string;
  phone: string;
  email: string;
}

function formatPdfINR(paise: number): string {
  // jsPDF standard Helvetica does not render ₹ glyph reliably; use Rs.
  const formatted = formatINR(paise).replace('₹', 'Rs. ');
  return formatted;
}

export function downloadGstInvoicePdf(invoice: PrintableInvoice, company: PrintableCompany) {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();

  // Header band
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, pageWidth, 84, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(17);
  doc.text(company.companyName, 40, 34);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`GSTIN: ${company.gstin}  |  State: ${company.state} (${company.stateCode})`, 40, 50);
  doc.text(`${company.address}  |  ${company.phone}`, 40, 64);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('TAX INVOICE', pageWidth - 40, 36, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(invoice.status === 'REVERSED' ? 'STATUS: REVERSED BY CREDIT NOTE' : 'Original for Recipient', pageWidth - 40, 52, {
    align: 'right',
  });

  // Meta & Bill-To Grid
  doc.setTextColor(15, 23, 42);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text('Billed To:', 40, 110);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(invoice.customerName, 40, 126);
  doc.text(`GSTIN: ${invoice.customerGstin}`, 40, 140);
  doc.text(invoice.customerAddress, 40, 154, { maxWidth: 270 });
  doc.text(`State: ${invoice.customerState} (Code ${invoice.customerStateCode})`, 40, 182);

  doc.setFont('helvetica', 'bold');
  doc.text('Invoice Details:', 345, 110);
  doc.setFont('helvetica', 'normal');
  doc.text(`Invoice No: ${invoice.invoiceNo}`, 345, 126);
  doc.text(`Financial Year: ${invoice.financialYear}`, 345, 140);
  doc.text(`Invoice Date: ${invoice.invoiceDate}`, 345, 154);
  doc.text(`Due Date: ${invoice.dueDate}`, 345, 168);
  doc.text(
    `Supply Type: ${invoice.supplyType === 'INTER_STATE' ? 'Inter-State (IGST)' : 'Intra-State (CGST + SGST)'}`,
    345,
    182
  );

  const isInter = invoice.supplyType === 'INTER_STATE';
  const head = isInter
    ? [['#', 'Description', 'HSN', 'Qty', 'Rate', 'Taxable', 'GST %', 'IGST', 'Line Total']]
    : [['#', 'Description', 'HSN', 'Qty', 'Rate', 'Taxable', 'GST %', 'CGST', 'SGST', 'Line Total']];

  const body = invoice.items.map((it, idx) =>
    isInter
      ? [
          String(idx + 1),
          it.productName,
          it.hsnCode,
          `${it.quantity} ${it.unit}`,
          formatPdfINR(it.unitPricePaise),
          formatPdfINR(it.taxableValuePaise),
          `${it.gstPct}%`,
          formatPdfINR(it.igstPaise),
          formatPdfINR(it.lineTotalPaise),
        ]
      : [
          String(idx + 1),
          it.productName,
          it.hsnCode,
          `${it.quantity} ${it.unit}`,
          formatPdfINR(it.unitPricePaise),
          formatPdfINR(it.taxableValuePaise),
          `${it.gstPct}%`,
          formatPdfINR(it.cgstPaise),
          formatPdfINR(it.sgstPaise),
          formatPdfINR(it.lineTotalPaise),
        ]
  );

  autoTable(doc, {
    startY: 204,
    head,
    body,
    theme: 'grid',
    headStyles: { fillColor: [30, 41, 59], fontSize: 8.5 },
    bodyStyles: { fontSize: 8.5 },
    margin: { left: 40, right: 40 },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY || 360;
  let y = finalY + 24;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text('Amount in Words:', 40, y);
  doc.setFont('helvetica', 'normal');
  doc.text(invoice.amountInWords, 40, y + 16, { maxWidth: 290 });

  const sumX = 365;
  const valX = pageWidth - 40;
  doc.setFont('helvetica', 'normal');
  doc.text('Taxable Value:', sumX, y);
  doc.text(formatPdfINR(invoice.taxableValuePaise), valX, y, { align: 'right' });
  y += 16;

  if (isInter) {
    doc.text('IGST:', sumX, y);
    doc.text(formatPdfINR(invoice.igstPaise), valX, y, { align: 'right' });
    y += 16;
  } else {
    doc.text('CGST:', sumX, y);
    doc.text(formatPdfINR(invoice.cgstPaise), valX, y, { align: 'right' });
    y += 16;
    doc.text('SGST:', sumX, y);
    doc.text(formatPdfINR(invoice.sgstPaise), valX, y, { align: 'right' });
    y += 16;
  }

  doc.setDrawColor(148, 163, 184);
  doc.line(sumX, y - 4, valX, y - 4);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text('Grand Total:', sumX, y + 12);
  doc.text(formatPdfINR(invoice.grandTotalPaise), valX, y + 12, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 116, 139);
  doc.text(`For ${company.companyName}`, valX, y + 66, { align: 'right' });
  doc.text('Authorised Signatory', valX, y + 98, { align: 'right' });
  doc.text('Computer-generated GST Tax Invoice under FactoryFlow ERP.', 40, y + 98);

  doc.save(`${invoice.invoiceNo.replace(/\//g, '-')}.pdf`);
}

export function exportReportCsv(filename: string, columns: string[], rows: Record<string, string | number>[]) {
  const escape = (v: unknown) => {
    const str = String(v ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const header = columns.map(escape).join(',');
  const lines = rows.map((r) => columns.map((c) => escape(r[c])).join(','));
  const csv = [header, ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportReportExcel(
  filename: string,
  sheetName: string,
  columns: string[],
  rows: Record<string, string | number>[]
) {
  const data = rows.map((r) => {
    const obj: Record<string, string | number> = {};
    for (const c of columns) obj[c] = r[c] ?? '';
    return obj;
  });
  const ws = XLSX.utils.json_to_sheet(data, { header: columns });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  XLSX.writeFile(wb, `${filename}.xlsx`);
}

export function exportReportPdf(
  filename: string,
  title: string,
  subtitle: string,
  columns: string[],
  rows: Record<string, string | number>[]
) {
  const doc = new jsPDF({ orientation: columns.length > 7 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(title, 36, 36);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text(subtitle, 36, 52);

  autoTable(doc, {
    startY: 66,
    head: [columns],
    body: rows.map((r) => columns.map((c) => String(r[c] ?? ''))),
    theme: 'striped',
    headStyles: { fillColor: [15, 23, 42], fontSize: 8 },
    bodyStyles: { fontSize: 7.5 },
    margin: { left: 36, right: 36 },
  });

  doc.save(`${filename}.pdf`);
}
