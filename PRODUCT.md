# Developer tools preview — 2026-10-08

This change preserves the existing static pink/black site and signup function. The main product is now a delivery checker, paired with a semantic line/JSONL filter. The existing Playground remains a labeled educational fixture, not a live model endpoint.

## Source and public assets

- CLI source is in the sibling `../cli/` Git repository.
- `docs.html` is the install/use guide.
- `downloads/jevtool-cli-0.1.0.tgz` contains the installable package and MIT source.
- `downloads/SHA256SUMS.txt` verifies the archive.
- `cli-readme.md` and `examples/` are copied from the CLI source.
- `scripts/stage.mjs` keeps an explicit public-file allowlist. Neither internal planning notes nor CLI test fixtures are staged.

After editing CLI source, rebuild the package before staging/deploying the site:

```sh
npm run package:cli
npm test
npm run stage
```

The packaging command requires the sibling CLI checkout. The committed public assets can be staged from the standalone site checkout without it. Staging is not production deployment. Existing Cloudflare functions and signup behavior are retained.

## Verification scope

The CLI's isolated demo and automated tests exercise real test execution and evidence handling. Model responses in automated tests are fixtures, not live Jev results. No API key was present in the implementation environment, so live model quality and latency remain unverified. No npm publication, remote Git push, subscription or automatic agent-hook installer is part of this release.

Start with advisory delivery checks. Semantic thresholds are initial settings, not calibrated guarantees. `--judge` sends selected code/test evidence to TypeSafe; grep sends supplied records.
