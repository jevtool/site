# jevtool.dev

Static site plus two Cloudflare Pages Functions, no framework.

- `index.html`, `docs.html`, `eval.html`, `404.html`: the pages. Inline CSS/JS.
- `functions/api/judge.js`: relays one Jev request per call to TypeSafe with the visitor's own key (header `X-TypeSafe-Key`). Nothing is stored or logged. The online runner (`eval.html`) runs the evaluation itself in the browser using the vendored `jevtool/eval-core`, so the relay never sees expected labels.
- `functions/api/subscribe.js`: email signup into the `SUBSCRIBERS` KV namespace.
- `suites/*.json`: the example suites copied from the CLI by `npm run package:cli`, plus `index.json`.
- `scripts/stage.mjs`: copies the public allowlist into `.deploy/` and vendors `node_modules/jevtool/src/eval-core.mjs` to `/vendor/jevtool-eval-core.mjs`.

The `jevtool` devDependency pins the CLI version whose core and client the functions and page use. Bump it together with the CLI release, then run `npm run package:cli` to refresh the offline archive, suites and `cli-readme.md`.

## Local preview

Requires Node.js 22 or later. Wrangler runs through `npx`; it is deployment tooling, not a frontend dependency.

```sh
npm test
npm run dev
```

Open http://localhost:8788. The local `SUBSCRIBERS` KV persists under the ignored `.wrangler/` directory. Local development does not write to production KV.

## CI and deployment

`.github/workflows/ci.yml` runs the tests and staging on every push and pull request. `.github/workflows/deploy.yml` deploys `main` to production and needs two repository secrets: `CLOUDFLARE_ACCOUNT_ID` (set) and `CLOUDFLARE_API_TOKEN` (a token with *Cloudflare Pages: Edit* on this account). Until the token is added, deploy manually as below.

## Cloudflare deployment

Project: `jevtool-site`. Production branch: `main`. Public URL: https://jevtool.dev. Cloudflare fallback: https://jevtool-site.pages.dev.

```sh
npx wrangler@4.136.1 login --scopes account:read user:read pages:write workers_kv:write zone:read
npm run deploy
```

`scripts/stage.mjs` copies only the five public files to ignored `.deploy/`. This avoids publishing README, tests, source functions, configuration, or local subscriber records. Wrangler deploys `functions/` separately. Do not drag the source directory onto the dashboard: dashboard folder uploads do not compile Pages Functions.

The KV namespace ID in `wrangler.jsonc` is a resource identifier, not a credential. Never commit tokens, API keys, `.dev.vars`, `.env`, or subscriber exports. On this Mac, command-line tools may require the existing system proxy: `HTTPS_PROXY=http://127.0.0.1:1082 HTTP_PROXY=http://127.0.0.1:1082` (per command only).

## Domain setup

1. Add `jevtool.dev` to the same Cloudflare account using the Free plan. Preserve any existing mail and other DNS records.
2. In Namecheap → Domain List → Manage → Nameservers → Custom DNS, enter the two nameservers assigned by Cloudflare. This changes DNS hosting; the domain registration remains at Namecheap.
3. In Pages → `jevtool-site` → Custom domains, add `jevtool.dev` and `www.jevtool.dev`. Approve the corresponding DNS records and allow activation/TLS issuance.
4. The Pages middleware redirects every `www.jevtool.dev` path and query to the apex with HTTP 301.

The domain is registered at Namecheap and uses Cloudflare nameservers `dawn.ns.cloudflare.com` and `felipe.ns.cloudflare.com`. Both website DNS records point to `jevtool-site.pages.dev`; the existing mail records are preserved. Deployment checks and the latest certificate status are recorded in `../qa/verification.json`.

```sh
curl -I https://jevtool.dev/
curl -I https://www.jevtool.dev/
```

Expected: apex 200, www 301 with `Location: https://jevtool.dev/`. Adding only a CNAME without registering the Pages custom domain is insufficient.

## Email subscriptions

`POST /api/subscribe` accepts JSON or a standard HTML form and writes to the `SUBSCRIBERS` KV binding. Email addresses are normalized and deduplicated under SHA-256 key names. Actual addresses are stored only inside private KV values. The endpoint rejects invalid addresses, oversized requests and cross-origin browser submissions; a honeypot filters basic bots. It has no public subscriber-reading endpoint and sends no emails or third-party requests.

Honeypots are not comprehensive abuse protection. If the public form attracts automated spam, add Cloudflare Turnstile or an appropriate rate-limiting rule.

Inspect subscriptions in Cloudflare → Storage & databases → KV → `jevtool-subscribers`. Do not export or log real subscribers during QA. Use a clearly identified disposable test address and delete only that exact test record after verifying persistence.

## Content and checks

- The pink/black palette, retro windows, Google Fonts and three built-in Playground examples remain.
- Internal discussion content is removed. Tools, Playground and Docs navigate to in-page sections. GitHub points to `https://github.com/jevtool` as requested.
- The tools are identified as a preview; terminal commands and results are illustrative. No live Jev API is called.
- `npm test` covers KV persistence/deduplication, invalid input, cross-origin rejection, storage failure, no-JavaScript signup and canonical redirects.
- QA screenshots and Lighthouse reports are stored outside the deployable repository in `../qa/`.

Official references: [Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/), [Custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/), [KV bindings](https://developers.cloudflare.com/pages/functions/bindings/#kv-namespaces).
