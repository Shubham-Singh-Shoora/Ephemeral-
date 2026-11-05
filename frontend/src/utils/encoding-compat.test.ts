import { expect, it } from 'vitest';
import { loadBuffer, decodeStream } from 'cheerio';

it('keeps Cheerio buffer decoding compatible with the maintained encoding sniffer', () => {
  const html = Buffer.from('<meta charset="utf-8"><p>Clinical café</p>', 'utf8');
  expect(loadBuffer(html)('p').text()).toBe('Clinical café');
});

it('keeps Cheerio stream decoding compatible with the maintained encoding sniffer', async () => {
  const text = await new Promise<string>((resolve, reject) => {
    const stream = decodeStream({}, (error, document) => error ? reject(error) : resolve(document!('p').text()));
    stream.on('error', reject);
    stream.end(Buffer.from('<meta charset="utf-8"><p>Clinical café</p>', 'utf8'));
  });
  expect(text).toBe('Clinical café');
});
