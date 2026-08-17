# Issue 52: recommendation and settings UI prototype

Throwaway UI prototype answering one question: where should one-click analysis,
recommendation states, the unified reading result, and plugin settings live in
Zotero 9?

The three variants deliberately disagree about information architecture:

- **A — Dedicated recommendation tab**: Reader gets a third peer tab; settings
  are one scrollable page grouped into Download, Cache, and Model sections.
- **B — Header analysis workspace**: analysis is a global Reader-header action;
  results sit above the current paper list; settings use a conventional category
  sidebar.
- **C — Reading queue and setup checklist**: analysis starts from a bottom dock;
  results become a single labelled queue; settings are an ordered setup flow.

Run from the repository root:

```powershell
npm run prototype:recommendation-settings
```

Open `http://127.0.0.1:4173/?variant=A`. The floating arrows or keyboard
Left/Right switch variants. The lab controls switch between Reader and
Preferences, resize the Reader to 320/360/420 px, and expose idle, cache-hit,
analyzing, completed, failed, and no-analyzable-paper states.

Everything is in memory. The prototype does not read Zotero data, call a model,
change paths, test a connection, or write a cache.
