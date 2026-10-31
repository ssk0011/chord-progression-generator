# Rhythm Grid Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store the melody as a list of timed notes, and convert every older save, with nothing a person can see or hear changing.

**Architecture:** One new global, `tune`, becomes the only stored melody. Code that still thinks in beats reads a cached beat view through `melBeats()` and writes through `melPut()`, so roughly 50 call sites change mechanically and later stages can replace them one at a time. A golden record of today's output, captured first, proves the app is unchanged.

**Tech Stack:** Single-file vanilla JS in `index.html`, Playwright checks in `tests/smoke.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-31-rhythm-grid-design.md`

**Later stages:** Stages 2 to 5 of the spec each get their own plan once the previous stage has landed.

## Global Constraints

- 12 ticks per counted beat.
- Note shape: `{t, d, m}` with integer `t >= 0`, integer `d >= 1`, and integer `m` from 21 to 108.
- Saved songs gain a version number: `v:2` with a `tune` field. New share links use `v:2`.
- Any saved song, shared link or library item must open with its rhythm and notes unchanged.
- Chords keep whole-number `beats` in this stage. Off-beat chords are stage 3.
- Work on branch `feat/rhythm-grid-1`. Run `python3 docs-src/build.py . docs-src` after changing `index.html`. The full check is `cd tests && node smoke.mjs`, and the user pushes.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Tune longer than the chart** (chords deleted after writing notes): the extra notes survive saving and return when the chart grows. Pinned in Task 1.
2. **A hold following a rest** in old saves: it was never audible and converts to a rest, with no crash. Pinned in Task 1.
3. **A hold after a split beat:** the note on the "and" keeps sounding through the hold. Pinned in Task 1.
4. **A damaged `tune` in a file or link:** bad notes are dropped and the rest loads. Pinned in Task 2.
5. **Library files exported before this change and re-imported:** today's import keeps chords and drops the melody, which breaks the spec's anti-goal. Task 2 keeps the melody. This is the one deliberate behaviour change in the stage.

---

### Task 1: Golden record and converters

**Files:**
- Modify: `index.html` (next to `sanitizeMelody`, line 1571)
- Create: `tests/golden-tune.json`
- Modify: `tests/smoke.mjs` (new `tuneSuite`, called after `breakAway`)

**Interfaces:**
- Produces: `TICKS=12`; `tuneFromBeats(mel:Array, and:Array) -> [{t,d,m}]`; `beatsFromTune(tune) -> {mel:Array, and:Array}`; `sanitizeTune(list) -> [{t,d,m}] | null`.

- [ ] **Step 1: Capture the golden record on unchanged code**

Add `tests/capture-golden.mjs`, run it once on `main`, and commit its output as `tests/golden-tune.json`. It loads the fixtures below and records, for each: `serialize()`, `shareCode()` decoded, the `#rows` HTML with the melody lane on, `melNotes()`, `buildMidi(false)` as hex, and `arrange()` lines with Arrange on.

Fixtures, all as `[chart text, meter, mel, and]`:
- `'C | G | Am | F'`, 4/4, sixteen beat notes.
- Same chart with holds, rests and split beats, including `[60,-1,null,62]` with `and[1]=64`.
- A 7/8 chart and a 6/8 chart with holds.
- A tune four beats longer than its chart.

- [ ] **Step 2: Write the failing converter checks**

```js
const rt = (m, a) => page.evaluate(([m, a]) => { const r = beatsFromTune(tuneFromBeats(m, a)); return [r.mel, r.and]; }, [m, a]);
check('tune: beat notes convert to timed notes', JSON.stringify(await page.evaluate(() => tuneFromBeats([60,-1,null,62],[]))) === '[{"t":0,"d":24,"m":60},{"t":36,"d":12,"m":62}]');
check('tune: an "and" splits the beat', JSON.stringify(await page.evaluate(() => tuneFromBeats([60],[64]))) === '[{"t":0,"d":6,"m":60},{"t":6,"d":6,"m":64}]');
check('tune: a hold carries the note on the "and"', JSON.stringify(await page.evaluate(() => tuneFromBeats([60,-1],[64]))) === '[{"t":0,"d":6,"m":60},{"t":6,"d":18,"m":64}]');
check('tune: a hold after a rest becomes a rest', JSON.stringify(await page.evaluate(() => tuneFromBeats([null,-1,62],[]))) === '[{"t":24,"d":12,"m":62}]');
check('tune: repeated pitches stay separate notes', (await page.evaluate(() => tuneFromBeats([60,60],[]).length)) === 2);
check('tune: every fixture round-trips', ...); // each fixture's mel and and, compared after dropping trailing nulls
check('tune: notes past the chart survive', (await rt([60,62,64,65,67],[]))[0].length === 5);
check('tune: sanitize drops bad notes', JSON.stringify(await page.evaluate(() => sanitizeTune([{t:0,d:12,m:60},{t:-1,d:12,m:60},{t:0,d:0,m:60},{t:0,d:12,m:200},null]))) === '[{"t":0,"d":12,"m":60}]');
```

- [ ] **Step 3: Run them to verify they fail**

Run the suite with only `tuneSuite` enabled, as the earlier `_ba.mjs` method did: a temporary copy of `smoke.mjs` that runs one suite.
Expected: FAIL, `tuneFromBeats is not defined`.

- [ ] **Step 4: Implement the three functions**

`tuneFromBeats` follows `notesOf` (line 4993), but walks the array's own length, not the chart's, and multiplies by `TICKS`. `beatsFromTune` is its inverse. A note starting on a half beat sets `and`, a note starting on a whole beat sets `mel`, and each further whole beat it covers sets `-1`. In this stage every note sits on a whole or half beat. `sanitizeTune` filters, sorts by `t`, and caps the list at 4096 notes.

- [ ] **Step 5: Run the checks, expect PASS, and commit**

```bash
git add index.html tests/smoke.mjs tests/capture-golden.mjs tests/golden-tune.json sw.js
git commit -m "Add timed note converters and a golden record of today's output"
```

### Task 2: Reading and writing every save form

**Files:**
- Modify: `index.html`: `snapshot`, `restoreSnap`, `curSnap`, `libOpen`, `libImportFile`, `shareCode`, `readShare`, `applyShare`, `baLoad`, `baStore`, `baToggle`, and the boot load at line 5503.
- Modify: `tests/smoke.mjs`

**Interfaces:**
- Consumes: Task 1's functions.
- Produces: `readTune(d) -> [{t,d,m}]`, accepting `{tune}`, `{melody,melAnd}` or `{mel,ma}`, with `tune` winning.

In this task `melody` and `melAnd` stay in memory. Saves write `tune` only, and load converts to arrays.

- [ ] **Step 1: Write the failing checks**

- `tune: an old session loads unchanged`: seed `changes-v1` with `melody` and `melAnd`, reload, compare to the golden `melNotes()`.
- `tune: new saves hold tune only`: after `save()`, the parsed `changes-v1` has `tune`, `v:2`, and no `melody`.
- `tune: old library item opens unchanged`.
- `tune: old share link opens unchanged`: a stored `v:1` code from the golden record passes through `readShare` and `applyShare`.
- `tune: new share link round-trips`: `shareCode()` has `v:2`, and `readShare` accepts it.
- `tune: Break away original in the old form loads`.
- `tune: an imported library file keeps its melody`.
- `tune: a damaged tune in a file loads the good notes`.

- [ ] **Step 2: Run them, expect FAIL**

- [ ] **Step 3: Implement `readTune` and route all listed save and load code through it**

`readShare` accepts `d.v===1||d.v===2`. `validItem` stays as it is, because it checks chords only. `libImportFile` passes melody through `readTune`.

- [ ] **Step 4: Run the checks, expect PASS, and run the full suite**

Expected: `all N checks passed`.

- [ ] **Step 5: Commit**

### Task 3: `tune` becomes the only melody in memory

**Files:**
- Modify: `index.html`: every remaining `melody` and `melAnd` use (`grep -nE "\b(melody|melAnd)\b" index.html`).
- Modify: `tests/smoke.mjs`: its 103 lines that read or set those globals.

**Interfaces:**
- Consumes: Task 1 and Task 2.
- Produces: `let tune=[]`; `melBeats() -> {mel,and}`, cached until `tune` changes, and read-only by contract; `melPut(mel,and)`, which replaces `tune` from arrays.

- [ ] **Step 1: Add the golden check, expected to pass before and after**

`tune: output matches the golden record`, comparing every recorded field for every fixture.

- [ ] **Step 2: Add `melBeats` and `melPut`, and make test helpers use them**

Replace direct test access with `melBeats().mel` and `melPut(...)`. Run the full suite, expected to PASS.

- [ ] **Step 3: Move readers**

Each reading function starts with `const {mel,and}=melBeats();`. Hot per-cell helpers (`melPitch`, `melOnsetPitch`, `melOnset`, `melAt`, `melSplit`) call `melBeats()` directly and rely on the cache. `playSig` uses `tune`. Run the golden check after each group: playback, lane and pad, form, arrangement, exports.

- [ ] **Step 4: Move writers**

Each writer copies with `const {mel,and}=melBeats(), m=mel.slice(), a=and.slice();`, mutates its copies, then calls `melPut(m,a)`. Writers: `melSet`, `melToggleSplit`, `melClearRange`, `melNudgeAt`, `melTypePut`, `tuneUse`, `transpose`, `repeatSection`, `moveSection`, `syncRepeats`, `baPutBar`, `#melToLane`, `#clearChart`, and the Generate and restyle paths found by the grep. `baHear` swaps `tune` instead of the two arrays.

- [ ] **Step 5: Remove the globals**

Delete `let melody` and `let melAnd`. `grep -nE "\bmelody\[|\bmelAnd\b" index.html` should only find the old-form field names in `readTune` and comments.

- [ ] **Step 6: Run the full suite and golden check**

Expected: `all N checks passed`, with golden fields identical.

- [ ] **Step 7: Rebuild and commit**

```bash
python3 docs-src/build.py . docs-src
git add index.html sw.js guide.html how-it-works.html tests/smoke.mjs
git commit -m "Store the melody as timed notes, with no change to what plays or shows"
```
