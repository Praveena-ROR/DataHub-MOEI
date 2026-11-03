// Browser side of the final report: read the request fresh from Dataverse,
// build the PDF and hand it to the user. The decision is never touched here, so
// a failure can simply be retried.
import logoUrl from '../assets/dewa-logo-light.svg';
import { formatDateTime } from '../components/format.ts';
import { loadReportState } from '../data/services.ts';
import { renderReportPdf, reportFileName, type ReportLogo } from './pdf.ts';
import { buildReportModel } from './reportModel.ts';

/** Rasterise the supplied DEWA SVG logo (jsPDF can't embed SVG), keeping its aspect ratio. */
async function loadLogo(): Promise<ReportLogo | undefined> {
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('logo'));
      img.src = logoUrl;
    });
    const width = img.naturalWidth || 400;
    const height = img.naturalHeight || 120;
    const scale = 600 / width;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height };
  } catch {
    return undefined;
  }
}

export interface DownloadedReport {
  fileName: string;
  /** Object URL of the PDF, so the page can offer an "open" link if the browser blocked the download. */
  url: string;
}

export async function downloadRequestReport(requestKey: string): Promise<DownloadedReport> {
  const state = await loadReportState(requestKey);
  const model = buildReportModel(state, new Date().toISOString(), formatDateTime);
  const doc = renderReportPdf(model, await loadLogo());
  const blob = doc.output('blob');
  const url = URL.createObjectURL(blob);
  const fileName = reportFileName(model);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  return { fileName, url };
}
