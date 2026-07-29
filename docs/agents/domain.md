# Domain Docs

How engineering skills should consume this repo’s domain documentation.

## Before exploring, read these

- `CONTEXT.md` at the repo root.
- `docs/adr/` entries relevant to the area being changed.

If these files do not exist, proceed silently. The domain-modeling workflow creates them when terms or decisions are actually resolved.

## File structure

This is a single-context repository:

/
├── CONTEXT.md
├── docs/adr/
└── src/

## Use the glossary’s vocabulary

Use terms as defined in `CONTEXT.md`. Do not drift to synonyms the glossary explicitly avoids.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface the conflict explicitly instead of silently overriding it.
