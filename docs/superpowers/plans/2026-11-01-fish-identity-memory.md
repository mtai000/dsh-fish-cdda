# Fish Identity + CDDA Memory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Give every fish a stable identity file, scope CDDA experience by that identity, fall back to `shared`, and carry 3 lossy CDDA lessons into a child fish.

**Architecture:** fish-kin writes `identity.json` in the parent/child home and reads parent `cdda-lessons.json` at birth. CDDA reads `identityFile`, stores JSONL memory under `memory/<identityId>/` or `memory/shared/`, and exposes `cdda_learn`. Bundled knowledge is removed.

**Tech Stack:** Node 22 ESM, node:test, JSONL, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-01-fish-identity-memory-design.md`

## Global Constraints

- Identity format: `fish_` + 26 Crockford chars, produced by fish-kin `newId('fish')`.
- No identity file → `memory/shared`; valid identity → `memory/<identityId>`.
- Only `scope=skill`, `confidence>=0.6` may enter inheritance; max 3 lessons / 300 chars.
- Never read fish `events.jsonl` for identity; only `identity.json` / `cdda-lessons.json`.
- CDDA package must contain no `data/`, `vendor/`, `.sav`.
- Existing 29+ CDDA tests and fish-kin birth/ids tests must stay green; baseline fish-kin has 2 unrelated failures (`fish wake`, `大肥鱼的家`), report them.

## Review Focus

- Identity file corrupt or missing must not crash; fall back shared.
- Same identity must not read another identity's memory.
- Child without `cdda-lessons.json` must start empty.
- Lessons over 3/300 chars must be truncated/skipped, never break birth.
- Removing knowledge must not break `cdda_look`, MCP tool list, or prompt assembly.

---

### Task 1: fish-kin identity module

**Files:** Create `dsh-fish-kin/lib/identity.js`; create `dsh-fish-kin/test/identity.test.mjs`; modify `lib/locate.js` childPaths.

**Interfaces:**
- `identityPath(root) -> string`
- `readIdentity(root) -> Promise<object|null>`
- `ensureIdentity(root, { parentId=null, lineageId=null, childId=null, generation=1, now=Date.now() }) -> Promise<{ok, created, identity}>`

- [ ] Test new identity id `/^fish_[0-9A-Z]{26}$/`, parent fields, idempotence, corrupt file replaced/ignored.
- [ ] Run test, expect module missing.
- [ ] Implement with `newId('fish')`, `writeJson`/`readJson` from kinstore.
- [ ] Run test green.
- [ ] Commit.

### Task 2: fish-kin birth identity

**Files:** `lib/birth.js`, `lib/index.js`, `test/birth.test.mjs`, `lib/locate.js`.

- [ ] Test birth writes `children/<id>/identity.json` with `childId`, `parentId`, `lineageId`, generation; certificate contains identity; parent identity exists.
- [ ] Run fail.
- [ ] `ensureIdentity(parentRoot)` in boot and birth; write child identity before seed; return `identityId`.
- [ ] Run birth tests green; commit.

### Task 3: CDDA identity resolver

**Files:** `target_plugin/lib/identity.mjs`, `test/identity.test.mjs`.

**Interfaces:**
- `readIdentity(cfg) -> {identityId, childId, parentId, lineageId, generation}|null`
- `memoryDirOf(stateDir, identity) -> string`
- `identityPathOf(cfg) -> string`

- [ ] Tests: explicit file, env fallback, missing/corrupt → null/shared, path directory appends `identity.json`.
- [ ] Run fail.
- [ ] Implement; run green; commit.

### Task 4: CDDA memory store

**Files:** `lib/memory.mjs`, `test/memory.test.mjs`.

**Interfaces:**
- `appendMemory(dir, entry) -> {ok, count, merged}`
- `readMemories(dir) -> array`
- `selectMemories(dir, {goal, worldId, maxItems=10, maxChars=4000}) -> {items,text}`
- `clearMemories(dir) -> {ok, count}`

- [ ] Tests: exact duplicate merges/hits, cap 200, world scope filtered, no-identity shared path separate, injection caps.
- [ ] Run fail; implement; green; commit.

### Task 5: CDDA config/identity/memory tool

**Files:** `lib/state.mjs`, `index.js`, `lib/tools-core.mjs`, `lib/mcp-server.mjs`, `client.js`, `prompts/duty.md`, tests.

- [ ] Remove `knowledge*` fields; add `identityFile`, `memory`, `memoryMaxItems`, `memoryMaxChars`.
- [ ] Runtime reads identity/memory dir; `cdda_learn` tool writes; `cdda_status` shows `identityId`/`memoryCount`.
- [ ] Prompt injects selected memories with “假设，不是攻略” header.
- [ ] Tests for tool existence/write/status; run fail; implement; green; commit.

### Task 6: remove bundled knowledge

**Files:** delete `data/`, `lib/knowledge.mjs`, `test/knowledge.test.mjs`; remove `cdda_knowledge` and all imports/config/UI/docs/package refs.

- [ ] Test/verify `data/` absent, `cdda_knowledge` absent from host+MCP, package has no `data/`.
- [ ] Remove code/assets; update docs; run full tests.
- [ ] Commit.

### Task 7: fish-kin lossy inheritance

**Files:** create `lib/cdda.js`, test `test/cdda.test.mjs`; modify `lib/birth.js`, `lib/service.js` optional.

- [ ] Test parent `cdda-lessons.json` with 10 lessons → child gets 3/300 chars; no file → none; long text clipped.
- [ ] Run fail.
- [ ] Implement read/select/append section + child copy in birth.
- [ ] Run fish birth/cdda tests green; commit.

### Task 8: CDDA inherited lessons + integration

**Files:** `lib/memory.mjs` import helper, `index.js` startup, tests.

- [ ] CDDA reads `<identity dir>/cdda-lessons.json` and seeds `scope=inherited` once.
- [ ] Test child identity dir with 3 lessons → prompt includes them; parent memory not read.
- [ ] Run fail; implement; green; commit.

### Task 9: docs/version/push

- [ ] Version 0.5.0 (CDDA) / fish-kin 0.29.0; CHANGELOG/README/AGENTS.
- [ ] Run full suites; report baseline fish-kin 2 failures.
- [ ] Commit/push both repos (new `mtai000/dsh-play-cdda`, `mtai000/dsh-fish-kin`).
