# AGENTS.md — catalog app

Guidance for an Agentic IDE working inside `app/`.

## Stack

- TypeScript (ES2022, NodeNext modules), Node 22+
- vitest for tests, colocated as `*.test.ts`
- No framework, no runtime dependencies — this is a plain domain library

## Commands

```bash
npm install
npm test          # vitest run
npm run typecheck # tsc, no emit
npm run build     # tsc -> dist/  (needed before mcp-server/ can import it)
```

## Architecture

- `data/catalog.json` — the seeded product data (synthetic, 24 items).
- `src/catalog.ts` — **pure** functions over a `Product[]` passed in. No I/O.
- `src/loader.ts` — the only file that touches the filesystem (`loadCatalog`).
- `src/index.ts` — public surface; everything external imports from here.

The split is deliberate: pure logic stays trivially testable, and the MCP
server in `mcp-server/` imports the same functions rather than reimplementing
them.

## Conventions

- Named exports only, no default exports.
- No `any`. Prefer `unknown` plus narrowing if a type is genuinely open.
- Keep `src/catalog.ts` free of imports from `node:*` — it must stay pure.
- Every exported function gets a colocated test case in `src/catalog.test.ts`.
- Import paths carry the `.js` extension (NodeNext), even from `.ts` sources.

## Guardrails

- **Do not change the signatures** of the exported catalog functions —
  `mcp-server/` depends on them, and so does the graded homework.
- **Do not edit `data/catalog.json`.** The A/B exercise in Task D compares
  against the seeded numbers; changing the data invalidates it.
- Never add real business data, PII, or secrets here. Everything is synthetic
  on purpose.

## MCPs

Servers this project expects to have connected. Configured at project scope in
[`.mcp.json`](../.mcp.json) (committed — it is meant for the team); full
rationale, observed tool lists and scope notes in
[`docs/mcp/servers.md`](../docs/mcp/servers.md).

| Server | What it is for here | Scope it gets |
|---|---|---|
| `filesystem` | Read `data/catalog.json` and `src/` together — most changes here need the data and the function side by side (tweak `lowStock`, check the `stock <= reorderLevel` boundary against real rows; add a test, use a real `sku` and its actual price) | `./app` only — not the repo root, not `$HOME` |
| `memory` | Knowledge graph for the constraints that are not visible in the code: which signatures are frozen and what breaks if they change, which `sku`s the tests already pin, which values are the interesting edge cases | One file, `./.claude/mcp-memory.json`. No repo access |
| `sequential-thinking` | Step-through for the silent-failure spots — `inventoryValue` rounding, the `<=` boundary in `lowStock`, and the `catalog.ts → index.ts → dist/ → mcp-server/` chain — where a wrong answer looks plausible instead of throwing | None — no filesystem, no network |

All three run over stdio via `npx`, need no tokens, and are pinned to exact
versions — this server set has changed its tool surface between releases
(`read_file` is already deprecated in favour of `read_text_file`), and a
floating `@latest` would let that shift under you between sessions.

### Two things to know before using them

- **`filesystem` is not read-only.** It ships `write_file`, `edit_file`,
  `move_file` and `create_directory`, all inside `app/`. That includes
  `data/catalog.json` — the file the Guardrails above forbid editing, because
  the tests and every recorded comparison are pinned to its numbers. The
  narrow scope protects the rest of the disk; it does not protect `app/` from
  itself. Treat the guardrail as binding regardless of which tool is doing the
  writing.
- **The path argument is a fallback, not a guarantee.** If the host supports
  MCP `roots`, the host decides the scope and the `./app` argument is ignored.
  `roots` is a coordination mechanism, not a security boundary (servers
  *SHOULD* honour it, not *MUST*) and is deprecated as of revision
  `2026-07-28`. The real boundary is OS permissions.

By contrast, the project's own server in `mcp-server/` is read-only by design:
it imports the functions from `src/` rather than reimplementing them, and
exposes no tool that writes, deletes, or makes network calls. Anything that
mutates the catalog goes through code review, not through a tool call.
