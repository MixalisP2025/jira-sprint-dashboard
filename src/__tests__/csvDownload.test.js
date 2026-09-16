import { describe, it, expect } from 'vitest';
import { toCsvBlob, CSV_BOM } from '../utils/csvDownload';

// The bug this guards: a CSV without the byte-order mark opens in Excel as the system
// codepage, and Greek text arrives as mojibake ("ΕΙΣΑΓΩΓΗ" -> "Î•Î™Î£Î‘Î“Î©Î“Î—").
describe('toCsvBlob', () => {
  it('starts the file with the UTF-8 byte-order mark', async () => {
    // Checked on the bytes: reading a blob as text decodes UTF-8 and drops the BOM,
    // which is exactly what a correct reader does with it.
    const bytes = new Uint8Array(await toCsvBlob('Key,Summary\nCSR-1034,x').arrayBuffer());
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xEF, 0xBB, 0xBF]);
    expect(new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes).startsWith(CSV_BOM)).toBe(true);
  });

  it('keeps Greek text intact as UTF-8', async () => {
    const greek = 'EVENT INTR 63600 (PRODEA) ΜΗ ΠΑΡΑΚΡΑΤΗΣΗ ΦΟΡΩΝ';
    const blob = toCsvBlob(`Key,Summary\nCSR-1034,"${greek}"`);
    const text = await blob.text();
    expect(text).toContain(greek);
    // decoded as UTF-8 the Greek survives; as windows-1252 it would not
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(new TextDecoder('utf-8').decode(bytes)).toContain(greek);
    expect(new TextDecoder('windows-1252').decode(bytes)).not.toContain(greek);
  });

  it('declares the charset on the blob type', () => {
    expect(toCsvBlob('a').type).toContain('charset=utf-8');
  });
});
