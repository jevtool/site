// Copy an explicit public-file allowlist; this is packaging, not a site build.
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const output = new URL('.deploy/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ['index.html', 'favicon.svg', 'robots.txt', 'sitemap.xml', '_headers']) {
  await cp(new URL(file, root), new URL(file, output));
}
console.log(`Staged 5 public files in ${fileURLToPath(output)}`);
