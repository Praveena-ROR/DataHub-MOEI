// Renders a ReportModel to PDF with jsPDF + jspdf-autotable. Tables wrap long
// text, repeat their header row on every page and never clip; every page gets
// the report header line and "Page x of y".
import { jsPDF } from 'jspdf';
import { autoTable } from 'jspdf-autotable';
import type { ReportModel } from './reportModel.ts';

/** DEWA green used by the app theme (sampled from the supplied logo artwork). */
const GREEN: [number, number, number] = [0, 109, 92];
const GREEN_50: [number, number, number] = [232, 243, 239];
const TEXT: [number, number, number] = [29, 29, 27];
const MUTED: [number, number, number] = [102, 112, 133];
const MARGIN = 15;
const TOP = 30;
const BOTTOM = 16;

export interface ReportLogo {
  /** PNG data URL. */
  dataUrl: string;
  width: number;
  height: number;
}

type Doc = jsPDF & { lastAutoTable?: { finalY?: number } };

/** Build the PDF document. The logo is optional (the report is complete without it). */
export function renderReportPdf(model: ReportModel, logo?: ReportLogo): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true }) as Doc;
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const contentWidth = pageWidth - MARGIN * 2;
  doc.setProperties({ title: `${model.title} - ${model.requestKey}`, subject: model.title, creator: 'MOEI Yearly Datasets Integration' });

  let y = TOP;
  const finalY = () => doc.lastAutoTable?.finalY ?? y;
  const ensureSpace = (needed: number) => {
    if (y + needed > pageHeight - BOTTOM) {
      doc.addPage();
      y = TOP;
    }
  };

  // ----- Title block (first page only) -----
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...GREEN);
  doc.text(model.title, MARGIN, y + 4);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(...MUTED);
  doc.text(`Request ID: ${model.requestKey}    Final status: ${model.status}    Generated: ${model.generatedAt}`, MARGIN, y + 10);
  y += 16;

  const heading = (text: string) => {
    ensureSpace(18);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(...GREEN);
    doc.text(text, MARGIN, y + 5);
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.3);
    doc.line(MARGIN, y + 7, MARGIN + contentWidth, y + 7);
    y += 10;
  };
  const paragraph = (text: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    for (const line of doc.splitTextToSize(text, contentWidth) as string[]) {
      ensureSpace(5);
      doc.text(line, MARGIN, y + 3.5);
      y += 4.4;
    }
    y += 2;
  };
  const table = (head: string[] | null, body: string[][], columnStyles: Record<number, { cellWidth?: number | 'auto' | 'wrap'; fontStyle?: 'bold' | 'normal' }> = {}) => {
    autoTable(doc, {
      startY: y,
      head: head ? [head] : undefined,
      body,
      theme: 'grid',
      showHead: 'everyPage',
      rowPageBreak: 'auto',
      margin: { top: TOP, left: MARGIN, right: MARGIN, bottom: BOTTOM },
      styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 1.8, overflow: 'linebreak', valign: 'top', textColor: TEXT, lineColor: [228, 231, 236], lineWidth: 0.2 },
      headStyles: { fillColor: GREEN, textColor: 255, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 252, 251] },
      columnStyles,
    });
    y = finalY() + 6;
  };
  const keyValues = (rows: [string, string][]) =>
    table(null, rows.map(([k, v]) => [k, v]), { 0: { cellWidth: 48, fontStyle: 'bold' } });

  heading('A. Request summary');
  keyValues(model.summary);

  heading('B. Division submissions');
  table(['Division', 'Status', 'Submitted by', 'Submitted on'],
    model.divisions.map((d) => [d.division, d.status, d.submittedBy, d.submittedOn]));

  heading('C. Attributes and values by division');
  paragraph('Each division\'s value is stored and shown separately, including for attributes shared by more than one division.');
  table(['Attribute', 'Unit', 'Classification', 'Division', 'Value', 'Status', 'Submitted'],
    model.values.map((v) => [v.attribute, v.unit, v.classification, v.division, v.value, v.valueStatus, v.submitted]),
    { 0: { cellWidth: 38 }, 4: { cellWidth: 28 } });

  heading('D. Request timeline');
  table(['Date and time', 'Event'], model.timeline.map((e) => [e.on, e.event]), { 0: { cellWidth: 38 } });

  heading('E. Clarification history');
  if (model.clarifications.length === 0) paragraph('No clarifications were requested.');
  for (const [i, c] of model.clarifications.entries()) {
    ensureSpace(75); // keep a clarification block on one page when it fits
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...TEXT);
    doc.text(`${i + 1}. ${c.attribute} - ${c.division} (${c.status})`, MARGIN, y + 4);
    y += 6;
    keyValues([
      ['Clarification ID', c.id],
      ['Submitted value', c.submittedValue],
      ['Question', c.question],
      ['Asked by / on', `${c.askedBy} / ${c.askedOn}`],
      ['Response', c.response],
      ['Responded by / on', `${c.respondedBy} / ${c.respondedOn}`],
      ['Status', c.status],
      ['Resolved by / on', `${c.resolvedBy} / ${c.resolvedOn}`],
    ]);
  }

  heading('F. Final decision');
  keyValues(model.decision);

  heading('G. About this report');
  for (const n of model.notes) paragraph(n);

  // ----- Running header and page numbers on every page -----
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFillColor(...GREEN_50);
    doc.rect(0, 0, pageWidth, 20, 'F');
    if (logo) {
      const h = 12;
      const w = Math.min(60, (logo.width / logo.height) * h);
      doc.addImage(logo.dataUrl, 'PNG', MARGIN, 4, w, h, 'dewa-logo', 'FAST');
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...GREEN);
    doc.text('MOEI Yearly Datasets Integration', pageWidth - MARGIN, 9, { align: 'right' });
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...MUTED);
    doc.text(model.requestKey, pageWidth - MARGIN, 14, { align: 'right' });
    doc.setDrawColor(...GREEN);
    doc.setLineWidth(0.6);
    doc.line(0, 20, pageWidth, 20);
    doc.setFontSize(8);
    doc.text(`Generated ${model.generatedAt}`, MARGIN, pageHeight - 8);
    doc.text(`Page ${p} of ${pages}`, pageWidth - MARGIN, pageHeight - 8, { align: 'right' });
  }
  return doc;
}

export const reportFileName = (model: ReportModel) => `${model.requestKey}-report.pdf`.replace(/[^\w.-]+/g, '_');
