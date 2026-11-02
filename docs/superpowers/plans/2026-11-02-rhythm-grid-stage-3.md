# Rhythm Grid Stage 3 Implementation Plan (Timeline batch)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Chords can start and end on any grid subdivision, and every note carries a part label, with old songs opening unchanged.

**Architecture:** Chords keep their `beats` field, but it may now be any positive multiple of 1/12. Every position is added up in whole ticks and divided back only at the end, so thirds never drift. The chart uses tick columns only when some chord is off the beat, so charts on whole beats render exactly as today. Notes gain an optional `k`, defaulting to `'mel'`.

**Tech Stack:** Single-file vanilla JS in `index.html`, Playwright checks in `tests/smoke.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-31-rhythm-grid-design.md`, including "Round 2 decisions"

## Global Constraints

- 12 ticks per counted beat (`TICKS`). A chord's length in ticks is `Math.round(c.beats*TICKS)`, always at least 1 and at most `256*TICKS`.
- Never add up `c.beats` as floats to find a position. Add up ticks.
- Chord text: `C:1.5` and `C:0.25` for halves and quarters, and `C:4/3` for thirds. Whole beats are written as today.
- Every metre the app supports keeps working.
- The golden record and every existing check stay green. Old saves, links and library items open unchanged.
- Chords may start on any grid subdivision. Section labels and key changes still start on a bar line.
- Synthetic fixtures only.
- Run `python3 docs-src/build.py . docs-src` after changing the app or help pages. Full check: `cd tests && node smoke.mjs`. Commit only after a green run. The user pushes.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A chord off the beat across a bar line:** it renders in both bars, plays once and prints with `%` in the second. Pinned in Task 2.
2. **Guitar and piano styles, the piano part and arrangements on a 1.5-beat chord:** no errors, and nothing sounds past the chord's end. Pinned in Task 3.
3. **Linked repeats and folding with off-beat chords:** a section of off-beat chords repeats and folds like any other. Pinned in Task 2.
4. **Break away and Harmonize with off-beat chords:** the bar comparison works, and Harmonize still offers whole-beat chords. Pinned in Task 3.
5. **Three triplet chords in a beat:** together they add up to exactly one beat, and the next chord starts on the beat. Pinned in Task 1.

---

### Task 1: Off-beat chord lengths and part labels

**Files:** `index.html`: `sanitizeChords`, `validItem`, `parseProg` (the `:n` length), `serialize`, `splitBeats`, `sanitizeTune`, `readTune`. Test: `tests/smoke.mjs` (`timelineSuite`).

**Interfaces:**
- Produces:
  - `cTicks(c) -> int`.
  - `beatsOk(b) -> bool`: a positive multiple of 1/12, up to 256.
  - `fmtBeats(b) -> string`: `'2'`, `'1.5'`, `'0.25'` or `'4/3'`.
  - Notes `{t, d, m, k?}`, where `k` matches `/^[a-z0-9]{1,8}$/`. `'mel'` is dropped on save.

- [ ] **Step 1: Write failing checks**

- `timeline: half-beat chords parse`: `C:1.5 G:2.5` gives `beats` 1.5 and 2.5.
- `timeline: third-beat chords parse and add up`: `C:1/3 D:1/3 E:1/3 F:3` gives ticks `4,4,4,36`, and `chordStarts()` is `[0,1/3,2/3,1]` by ticks.
- `timeline: text round-trips`: `serialize()` then parse gives the same ticks for `C:1.5 G:2.5 | Am:4/3 F:8/3`.
- `timeline: bad lengths are rejected`: `0`, `0.1`, `-1` and `300` fail `sanitizeChords`.
- `timeline: old whole-beat saves open unchanged`: covered by the golden check.
- `timeline: notes keep a part label`: `readTune({tune:[{t:0,d:12,m:60,k:'alto'}]})[0].k === 'alto'`, and a bad `k` is dropped.

- [ ] **Step 2: Run, expect FAIL, implement, run the full suite, rebuild and commit**

### Task 2: Positions in ticks, and the chart on tick columns

**Files:** `index.html`: every site found by `grep -nE "\+=\s*c\.beats|\+c\.beats|reduce\(\(a,c\)=>a\+c\.beats" index.html`. That includes `chordStarts`, `renderChart`, `sectionsOf`, `chordIdxAt`, `leadSheetHTML`, `playPass`, `resyncPlay`, `buildMidi`, `buildMusicXML`, `baBars`, `formInfo` and `serialize`'s bar walk. Test: `tests/smoke.mjs`.

**Interfaces:**
- Consumes: `cTicks`.
- Produces:
  - `chartTicks() -> int`.
  - `startTicks() -> int[]`.
  - `chartUnit() -> 1|12`: 12 when any chord isn't a whole number of beats.

- [ ] **Step 1: Write failing checks**

- `timeline: two chords meet on an 8th`: `C:1.5 G:2.5` renders two slots with widths in the ratio 3:5, within 2px.
- `timeline: a chord crossing a bar line shows in both bars`: `C:3.5 G:4.5` has the `G` slot in bar 1 and a tie in bar 2.
- `timeline: whole-beat charts render as before`: the golden `rows` stays identical.
- `timeline: playback starts each chord at its tick`: with `playStyled` stubbed, start times for `C:1.5 G:2.5` at 60bpm are 0 and 1.5s apart.
- `timeline: MIDI places chords exactly`: the second chord's note-on is at tick `1.5*tpb`.
- `timeline: MusicXML keeps the offset`: the `<harmony>` for G has `<offset>` matching 1.5 beats, or sits in a measure split there.
- `timeline: lead sheet shows both chords in bar 1`.
- `timeline: off-beat sections repeat and fold`.

- [ ] **Step 2: Run, expect FAIL, implement, run the full suite, rebuild and commit**

### Task 3: Editing chords on the grid

**Files:** `index.html`: chord resize drag (`rsz` near the pointer handlers), Split in two, the length field in the chord detail panel, and the guitar and piano style events, `pianoPart` and `arrange` where they assume whole beats. Also `docs-src/guide.body.html`. Test: `tests/smoke.mjs`.

**Interfaces:**
- Consumes: `slotTicks()`, `cTicks`, `fmtBeats`.
- Produces: `resizeTo(i, ticks, trade)`, so a resize snaps to `slotTicks()`, and Quarters keeps whole beats.

- [ ] **Step 1: Write failing checks**

- `timeline: resize snaps to the grid`: on 8ths, dragging a 4-beat chord's edge 1.5 beats left gives 2.5.
- `timeline: Quarters keeps whole beats`: the same drag on Quarters gives 3 (rounded).
- `timeline: Split in two halves an odd length`: 3 beats gives 1.5 and 1.5.
- `timeline: the length field takes fractions`: entering `1.5` sets 1.5, and `4/3` sets 16 ticks.
- `timeline: styles and parts don't sound past a chord`: for every guitar and piano style, the piano part and each arrangement style on `C:1.5 G:2.5`, events stay within their chord and no page errors appear.
- `timeline: Break away compares off-beat bars`: a chart compared with itself has every bar following.
- `timeline: Harmonize still gives whole-beat chords`.

- [ ] **Step 2: Run, expect FAIL, implement, run the full suite, rebuild and commit**

Add to the guide under "Rhythm": chords can start on any grid slot by dragging their edge on a finer grid, by typing `C:1.5` or `C:4/3`, or by entering a fraction in Lasts.

- [ ] **Step 3: Final branch review, then hand-test notes for the user, phone width included**
