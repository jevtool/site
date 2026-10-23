// Copy an explicit public-file allowlist; this is packaging, not a site build.
import { cp, mkdir, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const root = new URL('../', import.meta.url);
const output = new URL('.deploy/', root);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = ['index.html', 'docs.html', 'eval.html', 'leaderboard.html', 'leaderboard.json', '404.html', 'cli-readme.md', 'favicon.svg', 'robots.txt', 'sitemap.xml', '_headers',
  'downloads/jevtool-0.2.2.tgz', 'downloads/SHA256SUMS.txt', 'examples/acceptance.json', 'examples/payments.jsonl',
  ...(await readdir(new URL('suites/', root))).filter(f => f.endsWith('.json')).map(f => `suites/${f}`)];
// The browser runs the same evaluation core as the CLI.
await mkdir(new URL('vendor/', output), { recursive: true });
await cp(new URL('node_modules/jevtool/src/eval-core.mjs', root), new URL('vendor/jevtool-eval-core.mjs', output));
for (const file of files) {
  await mkdir(new URL('./', new URL(file, output)), { recursive: true });
  await cp(new URL(file, root), new URL(file, output));
}
console.log(`Staged ${files.length + 1} public entries in ${fileURLToPath(output)}`);
