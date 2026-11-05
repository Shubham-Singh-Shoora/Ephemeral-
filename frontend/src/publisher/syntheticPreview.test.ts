import { describe, expect, it } from 'vitest';
import { generatePreview } from './syntheticPreview';
import { getHospital, registerHospital } from './mockRegistry';

describe('local synthetic preview', () => {
  it('parses quoted fields, BOM, CRLF and replaces private text and identifiers', () => {
    const result = generatePreview('\uFEFFpatient_id,note,vitals\r\n123,"private, note",10\r\n456,"other\nprivate note",20');
    expect(result.columns).toEqual(['patient_id', 'note', 'vitals']);
    expect(result.rows).toHaveLength(10);
    for (const row of result.rows) {
      expect(row[0]).toMatch(/^Sample_/);
      expect(row[1]).toMatch(/^Sample_/);
      expect(Number(row[2])).toBeGreaterThan(10);
      expect(Number(row[2])).toBeLessThan(20);
    }
    expect(JSON.stringify(result.rows)).not.toMatch(/private/);
  });
  it('handles TSV and does not reproduce constant values', () => {
    const result = generatePreview('age\tgroup\n41\tsecret\n41\tsecret', '\t');
    expect(result.rows[0]).toEqual(['Sample_1_A', 'Sample_2_A']);
  });
  it.each(['', 'a,b', 'a,a\n1,2', 'a,\n1,2', 'a,b\n1', 'a,b\n"unclosed,2'])('rejects malformed input %j', input => {
    expect(() => generatePreview(input)).toThrow();
  });
  it('does not generate Infinity for extreme values', () => {
    expect(generatePreview('x\n-1e308\n1e308').rows[0][0]).toMatch(/^Sample_/);
  });
});

it('isolates mock hospital registrations by wallet', async () => {
  expect(await getHospital('0xB')).toBeNull();
  await registerHospital('0xA', { name: ' Test Hospital ', license: ' DEMO ' });
  expect(await getHospital('0xa')).toEqual({ name: 'Test Hospital', license: 'DEMO' });
  expect(await getHospital('0xB')).toBeNull();
  await expect(registerHospital('0xC', { name: ' ', license: '' })).rejects.toThrow();
});
