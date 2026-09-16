// One way to hand a CSV to the browser.
//
// Excel does not detect UTF-8 on its own: without a byte-order mark it reads a .csv as
// the system's ANSI codepage, so Greek summaries arrived as "Î•Î™Î£Î‘Î“Î©Î“Î—". The BOM is
// three bytes at the start of the file that name the encoding; Excel, LibreOffice and
// Notepad all honour it, and anything reading the file as UTF-8 skips it as whitespace.
export const CSV_BOM = '﻿';

/** A UTF-8 CSV blob Excel opens correctly. */
export function toCsvBlob(csv) {
  return new Blob([CSV_BOM + csv], { type: 'text/csv;charset=utf-8;' });
}

/** Save `csv` as `filename`. */
export function downloadCsv(csv, filename) {
  const url = URL.createObjectURL(toCsvBlob(csv));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  // Firefox only follows the click for a link that is in the document.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
