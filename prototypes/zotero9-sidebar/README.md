# Zotero 9 sidebar prototype

Throwaway UI prototype for the decision ticket “验证 Zotero 9 双标签侧边栏与悬浮信息卡交互”.

Run from the repository root:

```powershell
python -m http.server 4173 --directory prototypes/zotero9-sidebar
```

Open `http://127.0.0.1:4173/?variant=A`. Use the bottom switcher or left/right
arrow keys to compare:

- A — compact bibliography list
- B — chronological scan with a preview dock
- C — reading-queue cards

The data-state selector exercises ready/loading/error/no-MD states. Switch to
Citations to exercise the 10/30/50 control. In variant A, a blue bold title
means a paper landing page was resolved. Click any paper title for its detail
card; only resolved titles respond to Ctrl+click. Card text is selectable and
contains no action copy. Click the highlighted PDF sentence to show translation.
