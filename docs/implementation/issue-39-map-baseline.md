# Issue #39 Map delivery baseline

The implementation baseline is commit
`3f13921f9d1b845c461307783ec56b998b344aee`, the final delivery of issue #36.
That commit descends from the production deliveries below, so issue #39
converges the existing behavior instead of reimplementing it.

| Map source | Delivery on the baseline                     | Retained behavior in #39                                                                                                                               |
| ---------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #23        | `baa98ce`                                    | Default `E:\paper`, native destination picker, preference persistence. Its Reader-owned Python/venv/institution setup is removed.                      |
| #25        | `a6d20e7` (final fix in the linear baseline) | Paper Translate public API integration, selection anchoring, stale-result suppression, independent failure.                                            |
| #26        | `87ddf40`                                    | Confirmed-paper-only ordered selection across References and Citations, with tab-local select-all.                                                     |
| #27        | `1766ff1`                                    | Explicit one-paper dispatch, destination creation, request-local ScanSciCache and canonical no-overwrite final commit.                                 |
| #29        | `e79b02a`                                    | Second-stage manifest/build identity and XPI content audit rules. Issue #39 does not deliver an XPI.                                                   |
| #32        | `22ca7b1`                                    | Plugin-owned legal-only compatibility bridge, fixed arXiv/PMC routes, provenance manifest and source rules. Runtime installation branches are removed. |
| #35        | `ed2c638`                                    | Plugin-owned four-operation JSONL sidecar, bounded output, policy enforcement, batch progress and candidate institution route.                         |
| #36        | `3f13921`                                    | Production subprocess lifecycle, single/batch sidecar dispatch, cancellation, timeout, containment, failure isolation and scoped cleanup.              |
| #37        | decision recorded on Map #17                 | `institution-webvpn/ieee/one-click-single` remains an unavailable candidate pending complete real-world audit.                                         |

Issues #18, #21, #22, #31, #33 and #34 are research, specification, prototype or
architecture decisions rather than additional production commits to transplant.
Their effective constraints remain represented here: one injected `ScanSciPort`,
one plugin-owned sidecar contract, legal-only sources, paper-first Reader layout,
no external ScanSci control plane, and no candidate route presented as supported.

After #39, the only production capability path is:

1. Automatically enumerate existing Python commands.
2. Invoke the plugin-owned sidecar `probe` on each candidate.
3. Accept runtime identity, contract/result schema, upstream provenance,
   legal-only policy and route capabilities only from that response.
4. Re-probe immediately before `visibleLogin`, `downloadOne` or
   `downloadBatch`.

There is no executable preference, private venv, dependency installer,
institution configuration panel, direct TypeScript consumer of `bridge.py`, or
MCP/HTTP/external-repository fallback.
