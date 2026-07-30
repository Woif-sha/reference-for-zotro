# Reference for Zotero

Test-build Zotero 9 plugin that shows a current paper's Reference entries and
Citing papers in one native Reader section.

## Build a test XPI

```powershell
npm ci
npm test
npm run lint
npm run typecheck
npm run format:check
npm run build
```

The test XPI is written to `build/reference-for-zotero.xpi`. It supports Zotero
9.0.6 through 9.0.x.

## Install, update, and report feedback

In Zotero, open **Tools → Plugins**, choose **Install Plugin From File**, and
select the generated `.xpi`. Open a paper that already has valid
`llm-for-zotero` MinerU Markdown, then exercise References, Citations, refresh,
paper details, and Ctrl+click on a resolved title.

To update, install the newer `.xpi` from the same Plugins window and restart
Zotero if prompted. This is test build `0.1.0-test.2`; keep the previous XPI
available so you can reinstall it if needed.

Report problems in [GitHub Issues](https://github.com/Woif-sha/reference-for-zotro/issues)
with the Zotero version, plugin version, current paper state, visible error
text, and the action that produced the problem. Do not publish a tag, GitHub
Release, or stable-channel update until the build is explicitly accepted
through real Zotero use.
