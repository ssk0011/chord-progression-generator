# Piano Roll Batch Implementation Plan (fix file items 1 to 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a piano roll for the melody in the full view, through the fix file's stages 1 to 3, with fit labels on every note and a Nashville number view. Everything must work on a 375px touch screen.

**Architecture:**
- The roll is a second view of `tune`, in its own card under the chart. It draws one inline SVG inside a scroll box, with a chord strip pinned above and a keyboard pinned at the left.
- All geometry, snapping, hit-testing and edit logic are pure functions on `tune`, tested without drawing. The SVG layer only renders their results and turns pointer events into calls to them.
- Fit labels and Nashville numbers are pure functions that the roll, the chart and the lead sheet read.

**Tech Stack:** Single-file vanilla JS in `index.html`, Playwright checks in `tests/smoke.mjs`.

**Spec:**
- `docs/superpowers/specs/2026-10-31-rhythm-grid-design.md`, sections "Advanced view piano roll" and "Round 2 decisions".
- The fix file `things-to-fix-melody-and-reference-check.md`, items 1 to 3 and "Touch and phone requirements" (not in the repo; the needed parts are copied below).

## Global Constraints

- 12 ticks per counted beat (`TICKS`). Snap sizes come from `GRID_TICKS` and `S.melGrid`. With Snap off, the step is 1 tick.
- The melody is one voice: no two `k:'mel'` notes overlap. Any edit that would overlap trims or removes the notes it covers, the way `tuneClear` does.
- The lane stays in Simple view, and the roll is in the full view.
  - A new view key `S.melView: 'lane'|'roll'` defaults to `'lane'`.
  - Simple view always shows the lane.
  - The Lane / Piano roll switch sits in `#gridBar`.
- Touch:
  - Note handles and the resize handle are at least 44px, using the hit slop on coarse pointers.
  - Pointer events only.
  - A bottom toolbar holds Draw / Select / Erase, Snap, Undo and Redo.
  - Pinch zooms time, and a two-finger drag scrolls.
  - Long-press adds a note to the selection.
  - Nothing depends on hover or right-click.
  - Every edit is possible at 375px with no keyboard.
- Fit is never shown by colour alone. Every note carries a label or pattern, and an `aria-label` that names its fit.
- Copy says "clash", never "wrong". Theory and maths, not AI.
- Synthetic fixtures only.
- The golden record stays identical, so the lane's classes and labels don't change. Old saves, links and library items open unchanged.
- Run `python3 docs-src/build.py . docs-src` after changing the app or help pages. Full check: `cd tests && node smoke.mjs`. Commit only after a green run. The user pushes.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions for the user to confirm

1. **Default view:** the roll is opt-in, using the Lane / Piano roll switch in the full view. The lane stays the default so nothing changes for anyone who doesn't switch.
2. **Nashville spelling:** minor is `m`, the rest of the chord symbol follows (`17`, `4m7`), and roots outside the key take `b` or `#` (`b7`). Slash chords are written `1/3`.
3. **Duplicate:** Duplicate places a copy of the selected notes straight after them. A whole selected bar goes into the next bar and replaces what's there. Chords don't move.
4. **Stage 4 stays out:** velocity, ties across bar lines, MIDI keyboard input into the roll, and MIDI import.

## Review Focus

1. **A note dragged across a chord change, a bar line or a fold:** it keeps its snapped start and length, and the next note is trimmed, never overlapped. Pinned in Task 4.
2. **The roll open while the chart changes underneath it** (Generate, undo, a key change, or deleting chords so the tune runs past the end): it redraws, and notes past the chart stay in `tune` and show as out of range. Pinned in Task 3.
3. **Pinch and two-finger scroll at 375px:** no note is added or moved, and the page never scrolls sideways. Pinned in Task 6.
4. **Triplet snap followed by a 16ths quantize:** every note lands on a 3-tick multiple with at least one slot of length, and none overlap. Pinned in Task 5.
5. **Redo after a new edit:** the redo stack clears, and redo never restores a state from another branch of edits. Pinned in Task 4.

---

### Task 1: Fit labels

**Files:** `index.html`, near `melRel` (line 3483). Test: `tests/smoke.mjs`, a new suite `rollSuite`.

**Interfaces:**
- Produces:
  - `noteFit(m, ci, b, d=TICKS) -> 'tone'|'ext'|'pass'|'chrom'|'clash'`, where `b` is the start in beats and `d` the length in ticks.
  - `NOTE_FIT` holds the names: `{tone:'chord tone', ext:'extension', pass:'passing note', chrom:'chromatic note', clash:'clash'}`.
  - `fitLetter` gives the short labels `T E P C !`.
  - `carries(ci, m) -> bool`.

The rules, in order:
1. `tone`: the note is in `pcsOf(c)` or is its bass.
2. `clash`: the note is a tritone above the root, or a half step above a chord tone, and it falls on `strongBeat(b)` or lasts at least `TICKS`.
3. `ext`: the note is 2, 5 or 9 semitones above the root.
4. `pass`: the note is in the key's scale.
5. `chrom`: anything else.

With no chord, the note is `pass` if it's in the scale and `chrom` if not.

`carries(ci,m)` is true when `analyze(c).kind` isn't `'dia'` and the note is a chord tone outside the key's scale.

`melRel` stays as it is, for the lane.

- [ ] **Step 1: Write the failing checks**
  - `fit: C# over Gm7 is a clash`: key F, chart `Gm7`, C#4 on beat 1 gives `'clash'`.
  - `fit: Bb over Gm7 is a chord tone`.
  - `fit: A over Gm7 is an extension`.
  - `fit: a quick off-beat half step is passing, not a clash`: key C, `C`, F on beat 1.5 with `d=3` gives `'pass'`.
  - `fit: Ab under Fm in C is carried`: `carries` is true. Bb under `C7` in C is true. E under `C` is false.
  - `fit: same results in any key`: transpose the chart and the note by 5, and every result matches.
- [ ] **Step 2: Run `python3 $SP/one.py rollSuite && cd tests && node _one.mjs`, expect FAIL**
- [ ] **Step 3: Implement, run the full suite, rebuild and commit** ("Add note fit labels")

### Task 2: Nashville view and degrees

**Files:** `index.html`: `LABEL_MODES` (line 1791), `slotName` and the `.cr` text in `renderChart`, the lead-sheet cells (line 5566), `#copy` (line 5785). Test: `rollSuite`.

**Interfaces:**
- Produces:
  - `nashville(c, i) -> string`, using `keyAt(i)` through `inKey`.
  - `LABEL_MODES.nashville = 'Nashville numbers'`.
  - `tuneDegrees() -> string[]`: each melody note's degree against the key at its bar, such as `'1' 'b3' '#4'`.

Nashville labels show wherever numerals-only labels show today, in the chart, the lead sheet and Copy chart. The secondary label underneath is the chord name, as with numerals.

- [ ] **Step 1: Write the failing checks**
  - `nashville: D D7 G Gm7 in D`: the labels are `['1','17','4','4m7']`. In Ab, the transposed chart gives the same list.
  - `numerals: D D7 G Gm7 in D`: `analyze(c).num` gives `I I7 IV iv7`, and the same in Ab.
  - `nashville: out-of-key roots`: `C` in D gives `'b7'`, and `D/F#` gives `'1/3'`.
  - `nashville: shows on the chart and lead sheet`: with `S.labels='nashville'`, the first `.slot .nr` text is `'1'`, and the lead sheet's first cell is `'1'`.
  - `degrees: the same tune in two keys gives the same degrees`: after `transpose(3)`, `tuneDegrees()` is unchanged.
  - `nashville: an old save with labels 'both' opens unchanged`: the golden record covers it.
- [ ] **Step 2: Run, expect FAIL, implement, run the full suite, rebuild and commit** ("Add Nashville numbers")

### Task 3: The roll, read-only (stage 1)

**Files:** `index.html`:
- `S` and `SANE` add `melView` and `rollSnap`. `VIEW_KEYS` gains both.
- `renderGridBar` adds the Lane / Piano roll switch, shown only when `!S.simple`.
- A new `<section class="card" id="rollCard" hidden>` sits after the chart card.
- CSS goes near `.glane`.
- `renderAll` calls `renderRoll()`.
- `renderChart` leaves out the melody lane row when the roll is showing.

Test: `rollSuite`.

**Interfaces:**
- Produces:
  - `rollOn() -> bool`: `S.showMel && !S.simple && S.melView==='roll'`.
  - `rollRange(notes) -> {lo, hi}`: the tune's lowest and highest notes, each padded by 3, at least 24 semitones apart, and clamped to 21 to 108. An empty tune gives 60 to 84.
  - `rollGeom() -> {lo, hi, ticks, px, rowH, keyW, laneH}`:
    - `px` is pixels per tick. It is the scroll box width ÷ `(S.zoomBars*barLen()*TICKS)` when zoomed. Otherwise it is 40px per beat times `rollScale`.
    - `rowH` is 16, or 28 on `(pointer:coarse)`.
    - `keyW` is 56, and `laneH` is 40.
  - `rollXY(t, m, g) -> {x, y}` and `rollTM(x, y, g) -> {t, m}`, inverses for points inside the grid.
  - `renderRoll() -> void`.
  - `rollScale = 1` is session-only.

The roll draws:
- Rows shaded in-scale or out-of-scale by the key under each chord's span.
- Guide stripes on the chord tones of each span.
- Bar and beat lines, and a tick ruler on top.
- Chord blocks in a sticky strip, labelled by `S.labels`.
- A sticky keyboard showing the note name and scale degree for each row.
- Notes as `<rect class="rn f-{fit}" data-ri="{index}">`, each with `fitLetter` text, an `aria-label` like "Bar 2, beat 3: D (clash)", and a `title` that adds "carried by this chord" when `carries` is true.
- Notes past the chart end, drawn with the `.oor` hatch.

- [ ] **Step 1: Write the failing checks**
  - `roll: the switch shows only in the full view`, with no switch in Simple view.
  - `roll: Simple view keeps the lane even when melView is 'roll'`.
  - `roll: one rect per note, at the right place`: for `tune=[{t:0,d:12,m:60},{t:18,d:6,m:64}]`, rect `x` and `width` match `rollXY` within 0.5px.
  - `roll: rows fit the tune`: `rollRange` gives `{lo:57,hi:81}` for notes 60 to 64, and `{lo:60,hi:84}` for an empty tune.
  - `roll: rollTM inverts rollXY` for 20 random points.
  - `roll: fit is labelled, not only coloured`: every `.rn` has a text letter and an `aria-label` naming its fit.
  - `roll: in-key rows are shaded`: in C, the C# row has the `.out` class and the D row doesn't.
  - `roll: redraws after Generate, undo and a key change`, with no page errors.
  - `roll: notes past the chart show as out of range`, and `tune` keeps them.
  - `roll: the lane row is gone while the roll shows`, and `S.melView='lane'` brings the lane back.
  - `roll: old saves open on the lane`: the golden record is identical, and a save with no `melView` gives `'lane'`.
- [ ] **Step 2: Run, expect FAIL, implement, run the full suite, rebuild and commit** ("Add a read-only piano roll")

### Task 4: Editing, playhead, loop and redo (stage 2)

**Files:** `index.html`:
- New roll pointer handlers, `pushHist`, `undo`, and a new `redo`.
- `playPass` gains a loop range.
- The chord strip edge drag reuses `resizeBeats`.
- The chord detail panel gets Split here.
- The roll toolbar.

Test: `rollSuite`.

**Interfaces:**
- Consumes: Task 3's geometry, plus `tuneClear`, `tuneAdd`, `resizeBeats`, `slotTicks()`.
- Produces:
  - `rollSnapT(t) -> int`: rounds to `slotTicks()`, or to 1 tick when `!S.rollSnap`.
  - `rollHit(x, y, g, coarse) -> {i, part:'body'|'end'} | {t, m}`:
    - `'end'` is the last 8px of a note, or 22px on coarse pointers, extended 22px beyond its end on coarse pointers.
    - On coarse pointers, `y` matches a note within 22px of its row centre.
    - A hit inside a note but far from its end is `'body'`.
  - `notePut(t, d, m) -> void`: clears `[t, t+d)` with `tuneClear`, then adds the note.
  - `noteMove(i, dt, dm) -> void` and `noteSize(i, d) -> void`, both one voice and clamped to `t>=0`, `d>=1` and `m` in 21 to 108.
  - `noteDel(i) -> void`.
  - `ROLL_MODE: 'draw'|'select'|'erase'`, session-only, `'draw'` by default.
  - `rollSel: Set<int>` of note starts.
  - `splitChordAt(t) -> bool`: splits the chord under tick `t` there, if it isn't the chord's own start.
  - `redo() -> void`. The `fut` stack is filled by `undo` and cleared by `pushHist`. The keys are Ctrl/Cmd+Shift+Z and Ctrl+Y.
  - `LOOP_SEL: {b0, b1} | null`, session-only. `playPass(t, out, from=0, to=null)` plays only `[from, to)`, and a loop restarts at `from`.
  - `rollHead()`: a requestAnimationFrame loop that places the playhead from the newest entry in `PASSES` while `playing`.

Behaviour:
- **Draw:** a tap on empty space adds a note one snap long, or up to the next note if that is sooner. Dragging while drawing stretches it.
- **Body drag:** moves the note in time and pitch. The preview follows the pointer, and the commit happens on pointerup.
- **End drag:** resizes the note.
- **Erase:** a tap removes the note.
- **Select:** a tap selects the note.
- Each finished gesture is one undo step.
- **Ruler:** drag to set `LOOP_SEL`, and double-tap to clear it.
- **Chord strip:** dragging a chord's edge snaps to the roll's snap step.

- [ ] **Step 1: Write the failing checks** (by pure calls, unless a check says "by pointer")
  - `roll: snap rounds to the grid`: on 8ths, `rollSnapT(8)` is 12 and `rollSnapT(4)` is 6. With Snap off, `rollSnapT(5)` is 5.
  - `roll: hit test finds body and end`, including the coarse slop: a tap 20px right of a note's end hits `'end'` on coarse pointers and empty space on fine ones.
  - `roll: drawing adds a note on the snapped tick` (by pointer at 1280px).
  - `roll: drawing never overlaps`: drawing over the middle of a held note trims it.
  - `roll: dragging a note to a new subdivision snaps` (by pointer). On 16ths, a drag of 1.3 slots moves it 1 slot.
  - `roll: moving a note over the next one trims the next note`, across a bar line.
  - `roll: resizing stops at 1 slot and at 108`, with no zero-length notes.
  - `roll: erase removes one note`.
  - `roll: one gesture is one undo step`, and undo restores `tune` exactly.
  - `roll: redo re-applies, and a new edit clears redo`.
  - `roll: split here splits the chord on an 8th`: `C:4` at tick 18 gives 1.5 and 2.5.
  - `roll: chord edge drag snaps on the roll`.
  - `roll: a loop plays only its bars`: with `playStyled` stubbed and `LOOP_SEL={b0:4,b1:8}`, only bar 2's chord is scheduled, and the next pass starts at bar 2 again.
  - `roll: the playhead moves while playing`: its `x` grows between two frames.
- [ ] **Step 2: Run, expect FAIL, implement, run the full suite, rebuild and commit** ("Edit notes and chords in the piano roll")

### Task 5: Comfort tools (stage 3)

**Files:** `index.html`: the roll handlers and toolbar, and a roll-scoped `keydown` handler. Test: `rollSuite`.

**Interfaces:**
- Consumes: Task 4's functions.
- Produces:
  - `rollBox(x0, y0, x1, y1, g) -> Set<int>`.
  - `selMove(dt, dm)`.
  - `selCopy()` copies to `ROLL_CLIP`, a session-only list of notes relative to the selection's start.
  - `selPaste(t)`.
  - `selDup()`: a copy straight after the selection. A selection covering whole bars is copied into the following bar or bars, replacing what's there.
  - `selTranspose(n, scale=false)`: with `scale` true, notes move by scale steps of the key at each note's bar.
  - `selQuantize()`: on the selection, or on every note when nothing is selected. It snaps starts and ends to `slotTicks()`, gives each note at least 1 slot, and keeps one voice, with a later note winning a collision.
  - `ROLL_KEYS`, a map of shortcuts:
    - `D` Draw, `S` Select, `E` Erase, `N` Snap toggle.
    - Arrows nudge by a snap step or a semitone. Shift+Up and Shift+Down move by an octave, and Alt+Up and Alt+Down by a scale step.
    - Ctrl/Cmd+C copies, Ctrl/Cmd+V pastes, Ctrl/Cmd+D duplicates.
    - `Q` quantizes, and Delete or Backspace deletes.
    - Escape clears the selection.
  - The shortcuts act only while focus is inside `#rollCard`, so the chart's own `E` is untouched.

Touch versions:
- In Select mode, a one-finger drag on empty space draws a box.
- Long-press (500ms) toggles a note in the selection.
- The toolbar gains Copy, Paste, Duplicate, Up and Down (by semitone, with a scale-step switch), and Quantize. These appear while something is selected.

- [ ] **Step 1: Write the failing checks**
  - `roll: box select picks the notes inside`.
  - `roll: multi-move keeps the spacing`.
  - `roll: copy and paste at bar 3` gives the same rhythm and pitches, shifted.
  - `roll: duplicate a bar fills the next bar`, and the bar after that is untouched.
  - `roll: transpose by scale step stays in the key`: C D E in C, up one step, gives D E F.
  - `roll: quantize snaps to the grid`: notes at ticks 1, 5 and 13 with lengths 2 give starts 0, 6 and 12 on 8ths, each at least 6 long and not overlapping.
  - `roll: triplets then 16ths quantize` (Review Focus 4).
  - `roll: shortcuts act only inside the roll`: `E` with focus in the roll sets Erase, and `E` on a chord still opens the picker.
  - `roll: long-press adds to the selection` (by pointer, using a touch context).
  - `roll: each tool is one undo step`.
- [ ] **Step 2: Run, expect FAIL, implement, run the full suite, rebuild and commit** ("Add selection, copy, transpose and quantize to the roll")

### Task 6: Phone, pinch and the guide

**Files:** `index.html`: roll CSS for `max-width:640px`, and the pointer handler's two-pointer path. Also `docs-src/guide.body.html`. Test: `rollSuite`, plus the `iphone` suite.

**Interfaces:**
- Consumes: `rollScale` and `rollGeom`.

Behaviour:
- The roll's SVG has `touch-action:none`.
- With two active pointers:
  - The change in distance scales `rollScale`, clamped to 0.25 to 4, keeping the midpoint's tick under the fingers.
  - The midpoint's movement sets `scrollLeft` and `scrollTop`.
  - No edit happens.
- An unfinished one-finger gesture is cancelled when a second finger lands.
- On phones the toolbar is sticky at the bottom of the card, the chord strip sticks to the top, and the default zoom is 2 bars when `S.zoomBars` is 0.

- [ ] **Step 1: Write the failing checks** (375×812, `hasTouch`, coarse pointer)
  - `roll: no sideways page scroll at 375px`.
  - `roll: note targets are at least 44px` by hit slop: `rollHit` at 21px from a note's centre still finds it.
  - `roll: toolbar buttons are at least 44px tall`.
  - `roll: pinch zooms and adds nothing`: two synthetic pointer streams move apart, `rollScale` grows, and `tune` is unchanged.
  - `roll: a two-finger drag scrolls`.
  - `roll: every stage 1 to 3 action works by touch alone`: one scripted pass with taps and drags only covers draw, move, resize, erase, select, box select, duplicate, transpose, quantize, undo, redo, chord edge and split. `tune` and `chords` end up as expected.
  - `roll: dark theme contrast`: each fit's letter against its fill is at least 4.5:1 in both themes.
- [ ] **Step 2: Run, expect FAIL, implement, and add the guide section "Piano roll"**

  The guide section covers:
  - The switch, and the three modes.
  - Snap.
  - Pinch, and two-finger scroll.
  - The loop ruler.
  - The fit letters: T chord tone, E extension, P passing, C chromatic, ! clash, and "carried by this chord".
  - The shortcuts.
  - Nashville numbers in the label menu.

- [ ] **Step 3: Run the full suite, rebuild and commit** ("Make the piano roll work on phones")
- [ ] **Step 4: Run a fresh opus review of the whole branch, make one fix pass with failing tests first, and write hand-test notes for the user, phone included**
