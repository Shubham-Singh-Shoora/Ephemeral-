# Hospital publisher

Run `npm run dev:publisher` and open `/publisher/#/hospital` on the printed Vite URL. Build with `npm run build:publisher`; the static entry is `dist-publisher/publisher/index.html`. `npm run preview:publisher` previews that build at `/publisher/#/hospital`.

The existing frontend is an Astro static template with React integration, not the standalone SPA described in `.agents/agent.md`. This new Vite entry uses React, TypeScript, Tailwind, and HashRouter with `base: './'`. It does not change existing page sources or landing-page navigation. It has a separate build so existing template page-scoping and cleanup scripts cannot discard the publisher.

Connect an injected Ethereum wallet. The registry adapter is deliberately an in-memory mock keyed by wallet address. Registration does not send a transaction, validate accreditation, or survive a reload. There is no Hospital Registry contract or deployed registry address supplied in this repository. Replace the adapter with verified contract reads/writes when those are available.

Select CSV or TSV (maximum 10 MB, 100 columns). Parsing supports quoted delimiters and multiline fields. Ten synthetic rows preserve the header schema, generate numeric values inside observed ranges, and use invented category placeholders. Identifier-like columns and constant numeric columns use placeholders. Source records are never rendered, uploaded, or saved persistently. Headers and numeric ranges can still be sensitive: this is not a de-identification guarantee or the TEE preprocessing pipeline.

Encryption, ACT, Bee uploads, and dataset registration are intentionally absent. The publishing action remains disabled and explains this limitation.

The wallet provider targets local Foundry (chain 31337, `http://127.0.0.1:8545`) for future contract integration. Mock registration does not require a running node.

Wagmi 3 renamed `useAccount` to `useConnection`; the view aliases the installed `useConnection` hook as `useAccount`. Connection actions use `mutate` and the connector list comes from `useConnectors`, avoiding deprecated hook properties. These signatures were checked against the installed declaration files.

## Dependency cleanup

The npm audit originally reported 42 vulnerabilities (2 critical, 21 high, 16 moderate, 3 low). The updated lockfile reports zero. No lockfile package is marked deprecated.

Removed unused `@google/design.md` (and its obsolete `mdast` dependency), Husky without hooks, and patch-package without patches. Removed the shadcn scaffolding CLI while preserving its exact Tailwind stylesheet and MIT license under `src/styles/vendor`; existing page styles are retained. The unused design CLI scripts were removed from package.json.

Compatibility overrides replace Cheerio's deprecated encoding sniffer with the maintained 1.x API, use patched `postcss-selector-parser` 6.x for Tailwind typography, and keep Undici 7.x for Cheerio and Unifont to support the project's Node 22.12+ runtime. Buffer and stream decoding have explicit compatibility tests. Vite is aligned with Astro's Vite 8 dependency; Vitest explicitly transforms React JSX because Astro defaults to preserving it.

The installed npm 10 resolver crashed during updates. npm 11 was invoked temporarily through npx to regenerate the lockfile; the global npm installation was not changed.

## Verification and existing issues

- Publisher TypeScript check and production build pass.
- Existing Astro static site build passes.
- Publisher and encoding compatibility tests: 13 pass.
- Full regression suite: 877 pass, 3 fail (880 total).
- The existing template suite contains three unrelated failures: two AboutExpert assertions expect a LinkedIn anchor that the unchanged component does not render; the developer-thumbnail test expects a route currently stored in `src/pages/_disabled`. These pages were left unchanged as requested.
- Production publisher was inspected in the browser with no console errors. Wallet registration and file selection are tested with mocked wallet hooks; no real on-chain transaction was performed.
