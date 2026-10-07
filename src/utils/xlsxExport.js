// Real .xlsx export: frozen header row, filter dropdowns, sensible column widths, numbers
// and dates as real Excel values (so they sort and sum), and links where a column has one.
//
// ExcelJS is loaded on demand. It is large, and nobody should download it just to open
// the dashboard — only when they press Export.

const HEADER_FILL = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
const HEADER_FONT = { bold: true, color: { argb: 'FFFFFFFF' } };
const LINK_FONT = { color: { argb: 'FF2563EB' }, underline: true };
const MAX_WIDTH = 60;

// Jira sends ISO timestamps; due dates arrive as YYYY-MM-DD. Anything else stays text.
function toDate(v) {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  // A bare date is a calendar day, not midnight somewhere: pin it to UTC so Excel shows
  // the same day in every timezone.
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T00:00:00Z` : v);
  return isNaN(d) ? null : d;
}

/**
 * Build the workbook (no download). `columns`: [{ header, value: row => any,
 * type?: 'text' | 'number' | 'date' | 'datetime', width?, link?: row => url }].
 */
export function buildWorkbook(ExcelJS, { rows, columns, sheetName = 'Export', title = null }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Sprint Analytics Dashboard';
  wb.created = new Date();
  // Excel caps sheet names at 31 characters and forbids a few symbols.
  const ws = wb.addWorksheet(sheetName.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = columns.map(c => ({ header: c.header, key: c.header }));
  const header = ws.getRow(1);
  header.font = HEADER_FONT;
  header.fill = HEADER_FILL;
  header.alignment = { vertical: 'middle' };
  header.height = 20;

  const widths = columns.map(c => c.header.length + 2);
  rows.forEach(r => {
    const row = ws.addRow(columns.map(c => {
      const v = c.value(r);
      if (v == null || v === '') return null;
      if (c.type === 'number') { const n = typeof v === 'number' ? v : parseFloat(v); return Number.isFinite(n) ? n : null; }
      if (c.type === 'date' || c.type === 'datetime') return toDate(v) ?? String(v);
      return String(v);
    }));
    columns.forEach((c, i) => {
      const cell = row.getCell(i + 1);
      if (c.type === 'date' && cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy';
      if (c.type === 'datetime' && cell.value instanceof Date) cell.numFmt = 'dd/mm/yyyy hh:mm';
      if (c.type === 'number' && typeof cell.value === 'number') cell.numFmt = '0.##';
      const url = c.link && cell.value != null ? c.link(r) : null;
      if (url) { cell.value = { text: String(cell.value), hyperlink: url }; cell.font = LINK_FONT; }
      const shown = c.type === 'date' ? 10 : c.type === 'datetime' ? 16 : String(c.value(r) ?? '').length;
      widths[i] = Math.max(widths[i], shown + 2);
    });
  });
  ws.columns.forEach((col, i) => { col.width = columns[i].width ?? Math.min(widths[i], MAX_WIDTH); });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  if (title) wb.title = title;
  return wb;
}

/** Build and download. Resolves once the browser has been handed the file. */
export async function downloadXlsx({ fileName, ...spec }) {
  const mod = await import('exceljs');
  const ExcelJS = mod.default ?? mod;
  const wb = buildWorkbook(ExcelJS, spec);
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
