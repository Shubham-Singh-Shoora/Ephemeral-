import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const frontendDirectory = path.resolve(scriptDirectory, '..');
const sourceDirectory = path.join(frontendDirectory, 'dist');
const outputDirectory = path.join(frontendDirectory, 'dist-swarm');

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(target)));
    else files.push(target);
  }
  return files;
}

function prefixFrom(file) {
  const relative = path.relative(path.dirname(file), outputDirectory).replaceAll('\\', '/');
  return relative ? `${relative}/` : './';
}

function rewriteHtml(source, prefix) {
  const rewritten = source
    .replace(
      /((?:src|srcset|href|action|component-url|renderer-url)=["'])\/(?!\/)/g,
      `$1${prefix}`,
    )
    .replace(/(content=["'][^"']*?url=)\/(?!\/)/gi, `$1${prefix}`)
    .replace(/url\((["']?)\/(?!\/)/g, `url($1${prefix}`)
    .replace(
      /(href=["'][^"']*\/(?:healthcare|marketplace|ai-company))(["'])/g,
      '$1/$2',
    );

  // Astro's client router normalizes directory links and drops the trailing
  // slash required by a Swarm manifest. Link role navigation directly to the
  // hash-routed workspace so it works through both path and ENS gateways.
  return rewritten.replace(
    /href=(["'])(?:\.\.\/|\.\/)+(healthcare|marketplace|ai-company)\/?\1/g,
    (_match, quote, role) => `href=${quote}${prefix}app/#/${role}${quote}`,
  );
}

function rewriteCss(source, prefix) {
  return source.replace(/url\((["']?)\/(?!\/)/g, `url($1${prefix}`);
}

function rewriteJavaScript(source, prefix) {
  return source
    .replace(/(["'`])\/(_assets|assets|fonts|js)\//g, `$1${prefix}$2/`)
    .replace(/href:"\/"/g, `href:"${prefix}"`);
}

async function main() {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  await cp(sourceDirectory, outputDirectory, { recursive: true });

  const files = await walk(outputDirectory);
  for (const file of files) {
    const extension = path.extname(file).toLowerCase();
    if (!['.html', '.css', '.js'].includes(extension)) continue;

    const prefix = prefixFrom(file);
    const source = await readFile(file, 'utf8');
    const rewritten =
      extension === '.html'
        ? rewriteHtml(source, prefix)
        : extension === '.css'
          ? rewriteCss(source, prefix)
          : rewriteJavaScript(source, prefix);
    await writeFile(file, rewritten, 'utf8');
  }

  console.log(`Prepared path-independent Swarm bundle at ${outputDirectory}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
