import { execFileSync } from 'node:child_process';
import { mkdir, copyFile, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const site = fileURLToPath(new URL('../', import.meta.url));
const cli = fileURLToPath(new URL('../../cli/', import.meta.url));
const downloads = join(site, 'downloads');
await mkdir(downloads, { recursive: true });
const output = execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--cache', join(tmpdir(), 'jevtool-npm-cache'), '--pack-destination', downloads], { cwd: cli, encoding: 'utf8' });
const [packed] = JSON.parse(output);
const bytes = await readFile(join(downloads, packed.filename));
const checksum = createHash('sha256').update(bytes).digest('hex');
await writeFile(join(downloads, 'SHA256SUMS.txt'), `${checksum}  ${packed.filename}\n`);
await copyFile(join(cli, 'README.md'), join(site, 'cli-readme.md'));
await mkdir(join(site, 'examples'), { recursive: true });
for (const file of ['acceptance.json', 'payments.jsonl']) await copyFile(join(cli, 'examples', file), join(site, 'examples', file));
await mkdir(join(site, 'examples', 'suites'), { recursive: true });
const index = [];
for (const file of (await readdir(join(cli, 'examples', 'suites'))).filter(f => f.endsWith('.json')).sort()) {
  await copyFile(join(cli, 'examples', 'suites', file), join(site, 'examples', 'suites', file));
  const suite = JSON.parse(await readFile(join(cli, 'examples', 'suites', file), 'utf8'));
  index.push({ name: file.replace(/\.json$/, ''), description: suite.description ?? '', cases: suite.cases.length });
}
await writeFile(join(site, 'examples', 'suites', 'index.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`Packaged ${packed.filename} (${bytes.length} bytes); copied CLI reference and examples.`);
