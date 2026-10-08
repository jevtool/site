// Copy an explicit public-file allowlist; this is packaging, not a site build.
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const output = new URL('.deploy/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = ['index.html', 'docs.html', 'cli-readme.md', 'favicon.svg', 'robots.txt', 'sitemap.xml', '_headers',
  'downloads/jevtool-cli-0.1.0.tgz', 'downloads/SHA256SUMS.txt', 'examples/acceptance.json', 'examples/payments.jsonl'];
for (const file of files) {
  await mkdir(new URL('./', new URL(file, output)), { recursive: true });
  await cp(new URL(file, root), new URL(file, output));
}
console.log(`Staged ${files.length} public entries in ${fileURLToPath(output)}`);
