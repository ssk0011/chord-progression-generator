# Rhythm Grid Stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let people write and edit melody notes on 8th, 16th and triplet grids, zoom in on bars, and put a tune in at any bar without touching the rest.

**Architecture:** Notes can now sit on any tick, so the beat view stops being a safe way to edit. Task 1 makes every tune edit safe for off-beat notes and makes playback read `tune` directly. Task 2 adds the view settings. Task 3 adds a block lane, used when a finer grid is chosen or the tune has finer notes. The existing lane stays unchanged at the Quarters default. Task 4 makes Put in melody lane write from the selected bar.

**Tech Stack:** Single-file vanilla JS in `index.html`, Playwright checks in `tests/smoke.mjs`.

**Spec:** `docs/superpowers/specs/2026-10-31-rhythm-grid-design.md`

## Global Constraints

- 12 ticks per counted beat. `TICKS` already exists.
- Grid sizes and slot lengths: `beat` 12, `2` 6, `3` 4, `4` 3 ticks.
- Labels in x/4: Quarters, 8ths, Triplets, 16ths. In x/8: 8ths, 16ths, Triplets, 32nds.
- Grid and zoom are view settings: not undo steps, and they never change notes.
- A coarser grid leaves finer notes exactly where they are, visible and editable.
- No action may replace melody outside the bars it names.
- With the default Quarters grid and a tune on whole and half beats, the golden record stays identical.
- Stage 3 owns off-beat chords and stage 4 owns the piano roll. Exact melody in MIDI and rhythm-aware Harmonize are stage 5.
- Colours: chord tone, colour note and clash stay distinct in both themes, and never by colour alone.
- Run `python3 docs-src/build.py . docs-src` after changing the app or help pages. Full check: `cd tests && node smoke.mjs`. Stop on failure before committing. The user pushes.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Editing with the note pad on a Quarters grid when a 16th note is nearby:** the 16th stays. Pinned in Task 1.
2. **Moving or repeating a section holding triplets:** the notes move intact. Pinned in Task 1.
3. **Switching grid sizes back and forth:** `tune` is byte-identical. Pinned in Task 2.
4. **Zoom on a phone:** no horizontal page scroll, and slots stay at least 24px wide, with the row scrolling if needed. Pinned in Task 2 and Task 3.
5. **Put in melody lane with a tune longer than the chart:** only what fits is written, and the app says how much was left out. Pinned in Task 4.

---

### Task 1: Tune edits that keep every note

**Files:**
- Modify: `index.html`: `melNotes`, `melEdit`, `melSlice`, `repeatSection`, `moveSection`, `tuneHear`
- Test: `tests/smoke.mjs` (`gridSuite`)

**Interfaces:**
- Consumes: `tune`, `melBeats()`, `tuneFromBeats`.
- Produces:
  - `tuneClear(t0, t1) -> void`: removes the span, trimming notes that cross an edge.
  - `tuneCut(t0, t1) -> notes`: removes the span, closes the gap, and returns the notes relative to `t0`.
  - `tuneOpen(at, len) -> void`: moves notes at or after `at` later, splitting any note that crosses `at`.
  - `tuneAdd(at, notes) -> void`: inserts already relative notes.

- [ ] **Step 1: Write failing checks**

Each starts from `tune=[{t:0,d:3,m:60},{t:3,d:3,m:62},{t:12,d:12,m:64}]` over `'C | G'`, unless stated.

- `grid: pad edits leave finer notes alone`: `melSet(1,67,false,0)` keeps both 16ths at their ticks.
- `grid: clearing a beat leaves other beats alone`.
- `grid: playback keeps 16ths`: `melNotes()` gives `b:0, n:.25` and `b:.25, n:.25`.
- `grid: repeating a section keeps triplets`: a section with `d:4` notes keeps its `t` and `d` in the copy.
- `grid: moving a section keeps 16ths`.
- `grid: sections with different 16ths don't count as repeats`: same beat view, different ticks, `formInfo()[1].of` is null.

- [ ] **Step 2: Run, expect FAIL, implement**

`melNotes` builds from `tune`, clipped to the chart. `melEdit` keeps today's path when every note is on a half beat. Otherwise it compares view before and after, and replaces only the changed beats, through `tuneClear`. `repeatSection` and `moveSection` use the four helpers on `tune`. `melSlice` compares relative notes. `tuneHear` plays from the idea's tune.

- [ ] **Step 3: Run full suite, expect PASS with golden identical, rebuild and commit**

### Task 2: Grid and zoom settings

**Files:**
- Modify: `index.html`: `S`, `SANE`, `VIEW_KEYS`, `barsPerRow`, a new `#gridBar` above `#rows`, `renderAll`
- Test: `tests/smoke.mjs`

**Interfaces:**
- Produces: `S.melGrid: 'beat'|'2'|'3'|'4'`, default `'beat'`; `S.zoomBars: 0|4|2|1`, default `0` for automatic; `slotTicks() -> number`; `renderGridBar() -> void`.

- [ ] **Step 1: Write failing checks**

- `grid: controls appear with the melody lane`, and are hidden with it off.
- `grid: 7/8 and 6/8 label the sizes from 8ths`: the first label is `8ths`.
- `grid: changing size leaves the tune identical`: `JSON.stringify(tune)` is the same after every size and back.
- `grid: settings aren't undo steps`: `undo()` keeps `S.melGrid`.
- `grid: zoom sets bars per row`: `S.zoomBars=2` gives two `.bar` in the first row at 1280px.
- `grid: zoom keeps the selected bar in view`.
- `grid: zoom fits a phone`: at 390px, `scrollWidth<=innerWidth`.

- [ ] **Step 2: Run, expect FAIL, implement, run full suite, rebuild and commit**

`barsPerRow` returns `S.zoomBars` when set, capped by width only on the existing 40px-per-beat rule at automatic. Two select controls labelled **Grid** and **Zoom**: All bars, 4, 2, 1 bar.

### Task 3: Block lane

**Files:**
- Modify: `index.html`: `melLaneHTML` caller in `renderChart`, CSS near `.mcell`, `#rows` click and keydown handlers, `renderMelPad`
- Test: `tests/smoke.mjs`

**Interfaces:**
- Consumes: `slotTicks()`, Task 1's helpers.
- Produces: `gridLaneOn() -> boolean`, true when `S.showMel` and (`S.melGrid!=='beat'` or any note is off a half beat); `gridLaneHTML(r0, r1) -> string`, one `.glane` spanning the row; `gridSel: {t} | {n} | null`; `gridPut(t, m) -> void`; `gridLen(i, delta) -> void`; `gridDel(i) -> void`; `renderGridPad() -> void`.

**Behaviour:**
- `.glane` is a nested grid of `(r1-r0)*TICKS` columns. Above row content, in grid mode, a ruler shows `1 e & a`, `1 & a` for 8ths, and `1 trip let` for triplets.
- Empty slots are `button.gslot[data-gt]`. Notes are `button.gnote[data-gn]`, placed by ticks, labelled with the note name, and classed `r-tone`, `r-color`, `r-pass` or `r-clash` from `melRel`.
- Clicking an empty slot selects it. Clicking a note selects it.
- The pad offers the 12 note buttons, Shorter, Longer, Octave up and down, Delete, previous and next slot.
- A new note lasts one slot, or up to the next note if that is sooner. A note picked with a note selected changes pitch only.
- Keyboard: letters and accidentals as today, arrows by slot, Delete, and `[` `]` keep their accidental meaning.
- Type notes writes one note per slot from the cursor, with `-` extending and `.` resting.

- [ ] **Step 1: Write failing checks**

- `grid: 16ths show sixteen slots a bar`.
- `grid: triplets show twelve slots a bar`.
- `grid: a note lands on the clicked slot`: click `[data-gt="3"]`, pick D, and `tune` has `{t:3,d:3,m:...}`.
- `grid: Longer adds a slot, and stops at the next note`.
- `grid: a coarse grid still shows a finer note`: a 16th at tick 3 under `8ths` has one `.gnote`.
- `grid: Quarters keeps the existing lane`: with a tune on half beats, `.mcell` count equals beats and there is no `.glane`.
- `grid: note labels and fit states don't rely on colour`: `.gnote` has a label, and `aria-label` names the fit.
- `grid: fit colours stand out`: contrast of `r-tone` background to label is at least 4.5:1 in light and dark.
- `grid: slots stay usable on a phone`: at 390px with 16ths, `.gslot` width is at least 24px and the page doesn't scroll sideways.

- [ ] **Step 2: Run, expect FAIL, implement, run full suite, rebuild and commit**

Update `docs-src/guide.body.html` under a new heading `Rhythm: grid sizes and zoom`.

### Task 4: Put a tune in at any bar

**Files:**
- Modify: `index.html`: `#melToLane` handler, new `#melToLaneRead` hint, `renderDoorRead`-style update on input
- Test: `tests/smoke.mjs`

**Interfaces:**
- Consumes: `tuneClear`, `tuneAdd`.
- Produces: `lanePlan(text) -> {bar, b0, b1, replaces, lost, notes} | {bad} | null`.

**Behaviour:**
- Start bar is the bar of the lane cursor, otherwise of the selected chord, otherwise bar 1.
- Hint before writing: `Goes in from bar 5, through bar 6.`, adding `Replaces the notes already there.` when it does, and `The last 2 bars won’t fit.` when it must.
- Only that stretch changes. Undo restores it.

- [ ] **Step 1: Write failing checks**

- `grid: a tune goes in at bar 5`: bars 1 to 4 and everything after the stretch are unchanged.
- `grid: the hint names the bars before writing`.
- `grid: the hint warns about replacing notes`.
- `grid: the hint warns about what won’t fit`, and nothing past the chart is written.
- `grid: with nothing selected it uses bar 1`.

- [ ] **Step 2: Run, expect FAIL, implement, run full suite, rebuild and commit**

The toast names the bar. The old `from bar 1` check updates to match.
