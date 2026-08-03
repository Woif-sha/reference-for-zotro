# Contributing

## Development setup

Reference for Zotero requires a current Node.js release, npm and Zotero 9 for runtime validation.

```powershell
git clone https://github.com/Woif-sha/reference-for-zotro.git
cd reference-for-zotro
npm ci
```

## Quality gate

The stable `main` branch contains only release source, build configuration and maintained documentation. Run its reproducible release gate before submitting a change:

```powershell
npm run typecheck
npm run build
```

The full regression suites and UI prototypes stay on development branches and are not included in release-source commits. Run those suites before promoting a development commit. Reader UI changes must also be installed as the generated XPI and checked in a real Zotero 9 Reader; browser-like DOM tests do not replace XUL/XML runtime validation.

## Change guidelines

- Keep Reference entries tied to the exact current Reader attachment and validated MinerU cache.
- Do not open or label a provider result as resolved until its identity and landing page are confirmed.
- Preserve explicit provider, cache and network failures; do not convert them into silent empty results.
- Add a regression test for each bug fix at the closest production seam.
- Keep unrelated work out of commits and pull requests.

Use [GitHub Issues](https://github.com/Woif-sha/reference-for-zotro/issues) for reproducible bugs and scoped feature requests.
