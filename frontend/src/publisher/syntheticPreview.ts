import Papa from 'papaparse';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export type Preview = { columns: string[]; rows: string[][]; sourceRows: number };

export function generatePreview(text: string, delimiter = ','): Preview {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { delimiter, skipEmptyLines: 'greedy' });
  if (result.errors.length) throw new Error('The file contains malformed delimited data. Check quotes and separators.');
  const [header, ...records] = result.data;
  const columns = header?.map(value => value.trim());
  if (!columns?.length || columns.some(value => !value) || new Set(columns).size !== columns.length) throw new Error('Use a non-empty, unique header for each column.');
  if (columns.length > 100) throw new Error('Please use a dataset with at most 100 columns.');
  if (!records.length || records.some(row => row.length !== columns.length)) throw new Error('Include data rows with the same number of fields as the header.');
  const numeric = columns.map((name, i) => {
    // Identifiers, dates, and free text always receive invented placeholders.
    if (/(^id$|id$|patient|name|email|phone|address|license|date|birth|zip|pin|aadhaar|abha|ssn)/i.test(name)) return null;
    const values = records.map(row => row[i].trim()).filter(Boolean);
    if (!values.length || !values.every(value => /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(value) && Number.isFinite(Number(value)))) return null;
    let min = Infinity, max = -Infinity;
    for (const value of values) { min = Math.min(min, Number(value)); max = Math.max(max, Number(value)); }
    // Never reproduce a constant source value.
    return min < max && Number.isFinite(max - min) ? { min, max } : null;
  });
  const rows = Array.from({ length: 10 }, (_, r) => columns.map((_, c) => {
    const range = numeric[c];
    return range ? (range.min + (0.05 + Math.random() * 0.9) * (range.max - range.min)).toFixed(2) : `Sample_${c + 1}_${String.fromCharCode(65 + r % 3)}`;
  }));
  return { columns, rows, sourceRows: records.length };
}
