import Papa from 'papaparse';
import { buildSyntheticSchema, type SyntheticSchema } from '@ephemeral/eth-swarm';
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export type Preview = SyntheticSchema;

export function generatePreview(text: string, delimiter = ','): Preview {
  const result = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { delimiter, skipEmptyLines: 'greedy' });
  if (result.errors.length) throw new Error('The file contains malformed delimited data. Check quotes and separators.');
  const [header, ...records] = result.data;
  const columns = header?.map(value => value.trim());
  if (!columns?.length || columns.some(value => !value) || new Set(columns).size !== columns.length) throw new Error('Use a non-empty, unique header for each column.');
  if (columns.length > 100) throw new Error('Please use a dataset with at most 100 columns.');
  if (!records.length || records.some(row => row.length !== columns.length)) throw new Error('Include data rows with the same number of fields as the header.');
  return buildSyntheticSchema(columns, records, 10);
}
