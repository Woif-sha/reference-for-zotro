# Reference for Zotero

Test-build Zotero 9 plugin that shows a current paper's Reference entries and
Citing papers in one native Reader section.

## Build a test XPI

```powershell
npm install
npm test
npm run typecheck
npm run build
```

The test XPI is written under `build/`. It supports Zotero 9.0.6 through 9.0.x.

## Install and report feedback

In Zotero, open **Tools → Plugins**, choose **Install Plugin From File**, and
select the generated `.xpi`. Open a paper that already has valid
`llm-for-zotero` MinerU Markdown, then exercise References, Citations, refresh,
paper details, and Ctrl+click on a resolved title.

Treat every artifact as a test build. Report the Zotero version, current paper
state, visible error text, and the action that produced the problem. Do not
publish a tag, GitHub Release, or stable-channel update until the build is
explicitly accepted through real Zotero use.
