# Contributing

## Development setup

Reference for Zotero requires a current Node.js release, npm and Zotero 9 for runtime validation.

```powershell
git clone https://github.com/Woif-sha/reference-for-zotro.git
cd reference-for-zotro
npm ci
```

## Quality gate

Run the complete gate before submitting a change:

```powershell
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

Reader UI changes must keep browser-like DOM coverage and pass the automated build gate on each implementation ticket. Installing the generated XPI and checking it in a real Zotero 9 Reader is deferred to the explicit final integration acceptance ticket, where XUL/XML runtime validation is performed once against the assembled feature set. Individual implementation tickets are not blocked on repeated manual XPI acceptance unless their issue explicitly requires it.

## Change guidelines

- Keep Reference entries tied to the exact current Reader attachment and validated MinerU cache.
- Do not open or label a provider result as resolved until its identity and landing page are confirmed.
- Preserve explicit provider, cache and network failures; do not convert them into silent empty results.
- Add a regression test for each bug fix at the closest production seam.
- Keep unrelated work out of commits and pull requests.

Use [GitHub Issues](https://github.com/Woif-sha/reference-for-zotro/issues) for reproducible bugs and scoped feature requests.
