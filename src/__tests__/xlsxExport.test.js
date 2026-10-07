import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { buildWorkbook } from '../utils/xlsxExport';

// Round-trips through a real .xlsx buffer, so this checks what Excel will open, not just
// what the builder intended.
const rows = [
  { Key: 'CC-11', Summary: 'Δημιουργία εγγραφών', SP: '0.13', Created: '2026-09-08T10:34:10.500Z', Due: '2026-10-09' },
  { Key: 'CC-12', Summary: 'Second', SP: '', Created: '', Due: 'not a date' },
];
const columns = [
  { header: 'Key', value: r => r.Key, link: r => `https://jira.example/browse/${r.Key}` },
  { header: 'Summary', value: r => r.Summary },
  { header: 'Story Points', type: 'number', value: r => r.SP },
  { header: 'Created', type: 'datetime', value: r => r.Created },
  { header: 'Due Date', type: 'date', value: r => r.Due },
];

async function roundTrip(spec) {
  const buf = await buildWorkbook(ExcelJS, spec).xlsx.writeBuffer();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb.worksheets[0];
}

describe('xlsx export', () => {
  it('freezes the header row and puts filter dropdowns on every column', async () => {
    const ws = await roundTrip({ rows, columns, sheetName: 'Sprint 34 28-09-26 to 09-10-26' });
    expect(ws.name).toBe('Sprint 34 28-09-26 to 09-10-26');
    expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
    expect(ws.autoFilter).toBe('A1:E1');
    expect(ws.getRow(1).values.slice(1)).toEqual(['Key', 'Summary', 'Story Points', 'Created', 'Due Date']);
    expect(ws.getRow(1).font.bold).toBe(true);
  });

  it('links keys to Jira and keeps Greek text intact', async () => {
    const ws = await roundTrip({ rows, columns });
    expect(ws.getCell('A2').value).toEqual({ text: 'CC-11', hyperlink: 'https://jira.example/browse/CC-11' });
    expect(ws.getCell('B2').value).toBe('Δημιουργία εγγραφών');
  });

  it('writes numbers and dates as real Excel values, and blanks as empty cells', async () => {
    const ws = await roundTrip({ rows, columns });
    expect(ws.getCell('C2').value).toBe(0.13);
    expect(ws.getCell('D2').value).toEqual(new Date('2026-09-08T10:34:10.500Z'));
    expect(ws.getCell('D2').numFmt).toBe('dd/mm/yyyy hh:mm');
    expect(ws.getCell('E2').value).toEqual(new Date('2026-10-09T00:00:00Z'));
    expect(ws.getCell('C3').value).toBeNull();
    expect(ws.getCell('E3').value).toBe('not a date');   // left as text rather than guessed
  });

  it('cleans sheet names Excel would reject', async () => {
    const ws = await roundTrip({ rows, columns, sheetName: 'A/B: a very long sprint name that exceeds the limit' });
    expect(ws.name.length).toBeLessThanOrEqual(31);
    for (const ch of ['\\', '/', '?', '*', '[', ']', ':']) expect(ws.name).not.toContain(ch);
  });
});
