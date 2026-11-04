# Melody Paths Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow Break away so that its original becomes a *source*. The full view gains three things: a why-view of the working melody, per-layer closeness to the source, and rhythm and note paths. Each path is explained in words, previewed as a ghost in the roll, heard A/B, and taken, edited or tossed.

**Architecture:**
- All analysis, closeness and path logic are pure functions on a tune (`[{t,d,m}]` in ticks) plus a chart. They are prefixed `mp` and live in a new `/* ============ melody paths ============ */` block in `index.html`, straight after the Break away block (which ends at `baClick`, around line 3460).
- Anything measured against chords runs inside `mpAs(chart, fn)`. It swaps `chords`, `tune` and the key and meter fields of `S` the way `baHear` does, and always restores them.
- The UI is extra markup inside `renderBreak()`, shown only when `!S.simple`. The roll gains a ghost layer.

**Tech Stack:** Single-file vanilla JS in `index.html`. Playwright checks in `tests/smoke.mjs`. Help pages in `docs-src/`.

**Spec:** `docs/superpowers/specs/2026-11-03-melody-paths-design.md`

## Global Constraints

- One HTML file, plain JavaScript, no libraries. Theory and maths, not AI. Every function here is deterministic: the same input gives the same output, with no `Math.random`.
- The tune is one voice: no two notes overlap, and `TICKS=12` per beat. A path returns a whole new tune that obeys this. Use `sliceNotes`, `tuneSlice` and `tuneMoved` rather than new trimming code.
- **Timing paths stay inside their own stretch.** They never move chords, change the bar count or move a note outside `[t0,t1)`.
- **Meter and tempo never change.** Style limits are read from the **source**. Tension is measured against **each melody's own chords**.
- Old saves open unchanged. `changes-breakaway-v1` keeps `v:2`, and new fields are additive (`kept`). `tests/golden-tune.json` stays identical. The existing Break away bar tags, the `ba-list` ideas, and their tests and wording don't change.
- Simple view shows today's Break away panel only.
- Fit and closeness are never shown by colour alone. Copy says "clash", never "wrong". Plain words, with no jargon in user-facing copy: "contour" is shown as "shape".
- Phone: everything works at 375px with no keyboard, hover or right-click. Buttons are at least 44px on coarse pointers (the existing `.btn.small` coarse rule).
- Synthetic fixtures only. No real-song melodies in tests or docs.
- Run `python3 docs-src/build.py . docs-src` after changing the app or help pages. Full check: `cd tests && node smoke.mjs`. Commit only after a green run, and the user pushes. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The source and working copy are in different keys or meters.** Closeness compares by intervals and scale degrees, so a transposed copy reads as identical. A source in 3/4 against a 4/4 working copy compares bar by bar using each one's own bar length, and doesn't throw. This is pinned in Task 3.
2. **A source with no tune, or a working tune that's empty or past the chart's end.** The why-view and paths say "Add a tune to see its shape" and offer nothing. Closeness skips the note layers and shows harmony only. Nothing throws. This is pinned in Tasks 3 and 6.
3. **Taking a path inside a linked Chorus with Link repeats on.** The card shows the exact number of sections that will change before Take. Take is one undo step, and Undo restores every copy. This is pinned in Task 6.
4. **Every path, on every fixture, keeps the tune legal.** No overlaps, no zero-length notes, nothing outside `[t0,t1)`, and nothing that breaks the source's style limits. This is pinned in Task 5 by a sweep over all paths × all fixtures.
5. **The ghost goes stale.** If the tune or chart changes while a ghost is showing (an edit, undo, Generate, a key change), the ghost clears and the roll never shows an outdated preview. This is pinned in Task 6.

## Fixtures (tests only)

Add these to `tests/smoke.mjs` as `const MP_FIX = {...}`. Each is `[progression, meter, tonic, tune]`:

- `steps`: `'C | G | Am | F'`, `'4/4'`, `0`, quarter notes `60 62 64 65 | 67 65 64 62 | 69 67 65 64 | 65 64 62 60` (the Break away suite's tune, as ticks).
- `repeat`: `'C | Am | F | G'`, `'4/4'`, `0`. The tune is `67` as eight 8ths per bar for bars 1 to 3, and `67 65 64 62` quarters in bar 4. This is the same-note-moving-tension case.
- `sync`: `'F | C | F | C'`, `'4/4'`, `0`. The phrases start on the "and" of 1: `t=6`, with note lengths drawn from {6,12,18}. Pitches move by step within C4 to A4.
- `waltz`: `'C | G7 | C'`, `'3/4'`, `0`, quarters `64 62 60 | 62 -rest- 67 | 64 -rest- -rest-`. The rest in bar 2 splits it into two phrases.

`mpLoad(name)` is a test helper. It sets `S.tonic`, `S.mode='ionian'`, `S.meter`, `chords=parseProg(...)`, `tune=...`, `S.showMel=true`, `S.simple=false`, then calls `commit()`.

---

### Task 1: Phrases, shape and rhythm fingerprint

**Files:**
- Modify: `index.html`, a new block after `baClick`.
- Test: `tests/smoke.mjs`, a new `async function pathsSuite()` called after `await breakAway();` in the run list.

**Interfaces:**
- Produces:
  - `mpPhrases(notes, L) -> [{t0, t1, idx:[i...]}]`. `L` is beats per bar. A phrase ends after a rest of at least 12 ticks, or after a note at least 24 ticks long. A phrase is never longer than 4 bars, so it breaks at the bar line. `t1` is the end of the phrase's last note.
  - `mpShape(notes, ph) -> {steps:'uds…', peak:i, low:i}`. One letter per interval: `u` up, `d` down, `s` same. `peak` and `low` are note indexes, and ties go to the earliest.
  - `mpRhythm(notes, L) -> {sync:0..1, lengths:[d…sorted unique], phrases:[{start:'on'|'before'|'after', offset:ticks, beats, density}], strong:[i…]}`. `sync` is the share of onsets with `t%12!==0`. `start` compares a phrase's `t0` with the nearest bar line: `before` when within 1 beat before it (a pickup), `after` when after it, `on` when exactly on it. `strong` lists the notes whose onset is on a strong beat (`strongBeat` of that beat).

- [ ] **Step 1: Write failing tests in `pathsSuite`.**
  - `paths: steps tune is one 4-bar phrase`: it has no rests and no long notes, so `mpPhrases(tune,4)` gives `length===1` with `t0===0` and `t1===192`.
  - `paths: a rest of a beat splits a phrase`: the `waltz` tune gives 2 phrases.
  - `paths: shape of bar 1 of steps is uuu`: `mpShape` on the bar-1 slice gives `steps==='uuu'` and `peak===3`.
  - `paths: sync tune reads as syncopated, steps as not`: `mpRhythm` gives `sync>0.4` for `sync` and `sync===0` for `steps`. The `sync` phrases have `start==='after'` and `offset===6`.
  - `paths: lengths are the ones used`: `steps` gives `[12]`, and `sync` gives `[6,12,18]`.
- [ ] **Step 2: Run `cd tests && node smoke.mjs 1` and confirm the new checks FAIL with `mpPhrases is not defined`.**
- [ ] **Step 3: Implement `mpPhrases`, `mpShape` and `mpRhythm` as specified.**
- [ ] **Step 4: Run it again and confirm everything PASSES.**
- [ ] **Step 5: Commit** with the message `Add melody phrase, shape and rhythm readers`.

### Task 2: Style limits, tension line and pull

**Files:** `index.html` (the melody paths block). Test: `pathsSuite`.

**Interfaces:**
- Consumes: Task 1's three readers.
- Produces:
  - `mpAs(chart, fn)`. `chart = {chords, tune, S}` in the shape `BA` uses. It swaps `chords`, `tune` and `S.tonic`, `mode`, `meter` and `tempo`, then resets `PLAN=null` and `guitarPlan.cache=null`. It runs `fn()` and restores everything in `finally`, the same as `baHear`. It returns `fn()`'s value.
  - `mpChart() -> {chords, tune, S}`: the current working chart, in the same shape.
  - `mpStyle(chart) -> {meter, band:'none'|'some'|'heavy', lengths:Set, lo, hi, maxLeap, degs:Set, chrom:boolean, phraseBeats:[…]}`. `band` comes from `sync`: below 0.1 is `none`, below 0.35 is `some`, otherwise `heavy`. `degs` holds each note's `degOf` in its key. `chrom` is true when any degree is outside the scale.
  - `mpFits(notes, style, L) -> {ok, why}`. It fails when any of these hold:
    - the band is two steps away from `style.band`;
    - any note length is not in `style.lengths`;
    - any pitch is below `lo-2` or above `hi+2`;
    - any leap is greater than `maxLeap+2`;
    - a chromatic degree appears when `!style.chrom`;
    - a phrase length is outside `min(phraseBeats)-2 … max(phraseBeats)+2`.
    `why` names the first limit that failed, in plain words.
  - `mpStyleLine(style) -> string`, for example: `"4/4 · almost no off-beat notes · quarters and eighths · C4 to A4 · leaps up to a 5th · stays in the scale"`.
  - `mpTension(chart) -> [{t, v, fit}]`, one entry per note. `v` comes from `noteFit` and `roleOf`: root 0, 3rd or 5th 1, other chord tone or `ext` 2, `pass` 3, `chrom` 4, `clash` 5. Notes with no chord are 3 when in the scale and 4 when not.
  - `mpPull(chart) -> [{i, deg, toward, resolved}]` for tendency degrees. These are `7→1`, `4→3`, `2→1`, `♭6→5` and `♯4→5`, read from `degOf` labels. `resolved` is true when the next note within 2 notes is the `toward` degree.

- [ ] **Step 1: Write failing tests.**
  - `paths: mpAs restores the chart even when fn throws`: compare `JSON.stringify([chords,tune,S.tonic,S.meter])` before and after a call to `mpAs(other, ()=>{throw 1})` caught in a try block.
  - `paths: repeat tune's G is root, 3rd, 9th-ish, then 5th`: `mpTension` of `repeat` at bar starts gives `v` = `[1 (G is the 5th of C), 2 (G is the 7th of Am), 2 (G is the 9th of F, ext), 0 (G is the root of G)]`. Assert `[1,2,2,0]`.
  - `paths: style of steps`: `band==='none'`, `lengths` is `{12}`, `lo===60`, `hi===69`, `maxLeap===4`, `chrom===false`.
  - `paths: style line reads plainly`: `mpStyleLine(mpStyle(steps))` includes `'almost no off-beat notes'` and `'stays in the scale'`.
  - `paths: fits rejects 16ths in a quarter-note tune, accepts the tune itself`.
  - `paths: pull finds B resolving to C`: in a `C | G | C` chart with tune `71 72`, gives `[{deg:'7', toward:'1', resolved:true}]`.
  - `paths: tension is the same in any key`: run `repeat` at tonic 0 and at tonic 7 (chords and tune transposed) and get the same `v` array.
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement the Task 2 functions as specified.**
- [ ] **Step 4: Run them and confirm they PASS.**
- [ ] **Step 5: Commit** with the message `Add style limits, tension line and pull for melodies`.

### Task 3: Closeness by layer

**Files:** `index.html` (the melody paths block, plus `baLoad` and `baStore`). Test: `pathsSuite`.

**Interfaces:**
- Consumes: `mpAs`, `mpTension`, `mpShape`.
- Produces:
  - `MP_LAYERS=['rhythm','shape','steps','tension','harmony']` with labels `{rhythm:'Rhythm', shape:'Shape', steps:'Exact steps', tension:'Tension against the chords', harmony:'Chord changes'}`.
  - `mpClose(src, work) -> {layers:{[k]:0..1|null}, bars:{[k]:[0..1…]}, giveaway:{layer,b0,b1}|null}`. Both are charts.
    - Bars are aligned from bar 0, using each chart's own bar length.
    - Only bars where either chart has notes count for the note layers. A layer is `null` when neither chart has any notes.
    - Per bar:
      - **rhythm** is the Jaccard overlap of onset positions, as fractions of the bar.
      - **shape** is `1 - lev(a,b)/max(len)` over the bar's `u/d/s` letters.
      - **steps** is the same measure over the exact semitone intervals.
      - **tension** is `1 - mean|va-vb|/5`, sampled at each beat start using the sounding note.
      - **harmony** is the mean of two Jaccard overlaps: chord-change positions, and the set of `analyze(c).num` numerals.
    - `layers[k]` is the mean of `bars[k]`.
    - `giveaway` is the layer, not in `BA.kept`, with the highest value. Ties go to `MP_LAYERS` order. It only counts when that value is at least `0.8` and at least `0.25` above the mean of the other non-null layers. `b0` and `b1` give the longest run of bars where that layer's bar value is at least `0.8`.
  - `mpWord(v) -> 'very close'|'close'|'some way off'|'far'`, with cut-offs at ≥0.85, ≥0.6 and ≥0.35.
  - `BA.kept`: an array of layer keys, read and written by `baLoad` and `baStore` as an extra `kept` field. Unknown keys are dropped. `v` stays 2.

- [ ] **Step 1: Write failing tests.**
  - `paths: a chart against itself is 1 on every layer`.
  - `paths: transposed copy is still 1 on every layer`: the source is `steps` at tonic 0, and the working copy is `steps` after `transpose(5)`.
  - `paths: same rhythm new pitches is the Peg problem`: keep `steps`' rhythm, swap every pitch for another scale tone, and keep the chords. `rhythm===1`, `steps<0.5`, and `giveaway.layer==='rhythm'`, since it ties with harmony and comes first. Then with `BA.kept=['rhythm']`, `giveaway.layer==='harmony'`. With `BA.kept=['harmony']`, `giveaway` is `{layer:'rhythm', b0:0, b1:3}`.
  - `paths: 3/4 source against 4/4 work does not throw`: `waltz` as the source against `steps` returns numbers for every layer.
  - `paths: no tune means note layers are null`: the source has chords only, so `layers.rhythm===null` and `harmony` is a number.
  - `paths: kept survives a reload, old v2 record without kept still loads`: set `BA.kept=['harmony']`, call `baStore()`, reload the page, and check that `BA.kept` deep-equals `['harmony']`. Then write a record with no `kept` field, reload, and check that `BA.kept` deep-equals `[]` and the existing Break away checks still pass.
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement `MP_LAYERS`, `mpClose` and `mpWord`, and the `kept` field in `baLoad` and `baStore`.** `lev` is a plain two-row Levenshtein, written once as `mpLev(a,b)`.
- [ ] **Step 4: Run them and confirm they PASS, including the whole existing `breakAway()` suite and the golden checks.**
- [ ] **Step 5: Commit** with the message `Add per-layer closeness to the Break away original`.

### Task 4: The path engine and rhythm paths

**Files:** `index.html` (the melody paths block). Test: `pathsSuite`.

**Interfaces:**
- Consumes: Tasks 1 to 3.
- Produces:
  - `MP_PATHS`, an ordered array of `{id, kind:'rhythm'|'notes', name, keeps:[layer…], changes:[layer…], variants(ctx) -> number, run(ctx, v) -> {notes, words}|null}`.
    - `ctx = {tune, t0, t1, L, style, k}`, where `k` is `keyAt` at `t0`.
    - `run` returns a whole new tune whose notes outside `[t0,t1)` are untouched. It also returns `words`: one sentence that names what changed, with bar numbers and note names.
  - `mpPathsFor(t0, t1) -> [{id, name, kind, keeps, changes, v, of, notes, words, close}]`.
    - For each path, the first variant (from `v=0` upward) that passes all of these: it's non-null; its notes differ from `tune`; `mpFits(notes, mpStyle(BA), L).ok`; and on at least one layer in `changes`, `mpClose(BA, with notes)` is strictly lower than `mpClose(BA, mpChart())`.
    - `of` is that path's variant count. `close` is the full closeness result.
    - Each path appears at most once. The list keeps `MP_PATHS` order.
  - `mpNext(id, t0, t1, from) -> same item | null`: the next passing variant after `from`, wrapping around once ("Another one").
  - Rhythm paths, with their ids and variants:
    - `shift` (keeps shape, steps, harmony; changes rhythm). Variants, in order: half a beat later, half a beat earlier, a beat later, a beat earlier. A later shift trims the phrase's last note so the phrase still ends by `t1`. An earlier shift needs that much rest before the phrase. On a one-bar stretch, "a beat later" must equal `baLater(i)`.
    - `resplit` (keeps shape, harmony; changes rhythm). Merge the first run of repeated pitches into one note, or split the longest note into two repeats of lengths that are both in `style.lengths`.
    - `landing` (keeps shape, steps, harmony; changes rhythm, tension). Swap the lengths of two neighbouring notes, so that a different note starts on the strong beat between them.
    - `motif` (keeps shape, steps, harmony; changes rhythm). Play the phrase's first motif at half or double speed. The motif is its notes within the first bar. Every new length must be in `style.lengths`, and the result must fit in the phrase's room.
    - `phraselen` (keeps shape, steps, harmony; changes rhythm). Extend the phrase's last note one beat into the following rest, or cut it by one beat.

- [ ] **Step 1: Write failing tests.**
  - `paths: every path leaves notes outside the stretch alone`: for `steps` with stretch bar 2 (`t0=48`, `t1=96`), every returned item's notes outside the stretch deep-equal `tune`'s.
  - `paths: shift a beat later on one bar equals Start a beat later`: with `steps`, `MP_PATHS.find(p=>p.id==='shift').run({...bar 1 ctx},2).notes` deep-equals the tune that `baLater(0)` produces after being put in place with `tuneClear` and `tuneAdd`.
  - `paths: steps never gets 8ths`: no item for `steps` contains a note with `d!==12`.
  - `paths: shift lowers rhythm closeness and keeps shape`: on `steps` (source = work), the `shift` item has `close.layers.rhythm<1` and `close.layers.shape===1`.
  - `paths: Another one wraps and repeats deterministically`: calling `mpNext` twice from the same item gives the same result both times.
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement `MP_PATHS` (the rhythm entries), `mpPathsFor` and `mpNext`.**
- [ ] **Step 4: Run them and confirm they PASS.**
- [ ] **Step 5: Commit** with the message `Add the melody path engine and rhythm paths`.

### Task 5: Note paths, and the legality sweep

**Files:** `index.html` (the melody paths block). Test: `pathsSuite`.

**Interfaces:**
- Consumes: Task 4's engine.
- Produces:
  - `mpStep(m, k, n) -> midi`: move `n` scale steps in key `k`, where a negative `n` moves down. A note outside the scale snaps to the nearest scale tone first, and ties go down.
  - Note paths, added to `MP_PATHS` after the rhythm paths:
    - `peak` (keeps rhythm, harmony; changes shape, steps). Swap the phrase's peak pitch with the pitch on another strong-beat note. There is one variant per such note, in time order.
    - `samejob` (keeps rhythm, tension, harmony; changes steps, shape). Replace a strong-beat chord tone with the nearest other tone of the same chord that has the same `mpTension` value. For example, 3rd and 5th swap; a root stays only when there is no other root.
    - `bend` (keeps rhythm, harmony; changes shape, steps). Variant 0 turns the stretch upside down around its first note, kept in the key. On a one-bar stretch it must equal `baFlipped(i)`. Variant 1 plays the pitches backwards with the rhythm kept.
    - `widen` (keeps rhythm, shape, harmony; changes steps). Every interval grows (variant 0) or shrinks (variant 1) by one scale step, with directions kept. Repeated notes stay repeated.
    - `sequence` (keeps rhythm, shape, harmony; changes tension, steps). The motif's pitches move `+1`, `-1`, `+2` or `-2` scale steps, one variant each.
    - `cadence` (keeps rhythm, harmony; changes tension). The phrase's last note moves to another tone of its chord: the nearest one first, then the next.
  - `newjob` is not in `MP_PATHS`. It comes in Task 6, because it changes chords, not notes.

- [ ] **Step 1: Write failing tests.**
  - `paths: bend on one bar equals Flip the tune's shape`: with `steps` on bar 1, it deep-equals what `baFlipped(0)` puts in place.
  - `paths: samejob keeps the tension line`: on `steps`, the `samejob` item gives `mpTension` `v` values equal to the original's, and at least one pitch differs.
  - `paths: widen keeps the shape letters`: `mpShape` steps are equal before and after.
  - `paths: legality sweep`: for every fixture × every phrase stretch × every path × every variant, `run` gives `null` or a tune that meets all of these: sorted; no overlap (`n.t+n.d<=next.t`); every `d>0`; nothing outside `[t0,t1)` changed; and, for results that `mpPathsFor` would offer, `mpFits(...).ok`. Report the first failure in the check's detail.
- [ ] **Step 2: Run them and confirm they FAIL.**
- [ ] **Step 3: Implement `mpStep` and the six note paths.**
- [ ] **Step 4: Run them and confirm they PASS.**
- [ ] **Step 5: Commit** with the message `Add note paths and check every path stays legal`.

### Task 6: The grown Break away panel, the ghost and A/B

**Files:**
- Modify: `index.html`. That covers `renderBreak`, `baClick`, `renderRoll`, `commit` (to clear the ghost), and new CSS next to `.breakaway` (around line 1026).
- Test: `pathsSuite`, run at 1280px and at 375px (with `openPage({ viewport:{width:375,height:812}, hasTouch:true, isMobile:true })`).

**Interfaces:**
- Consumes: everything above.
- Produces:
  - State: `mpAt={t0,t1}|null`, the stretch being worked on, which defaults to the giveaway run's phrase, else phrase 1. Also `mpItem`, the path item being previewed or null, and `rollGhost`, an array of notes or null, stamped with `rollGhostFor=JSON.stringify([tune,chords])`.
  - `mpHear(notes, t0, t1)`: plays the bars covering `[t0,t1)` with the current chords and the given notes. It follows `tuneHear`'s pattern, but in ticks.
  - `mpLinked(notes) -> number`: how many named sections taking `notes` would change. It works out the answer on a copy: `snapshot()`, set the tune, `pushHist`, run `syncRepeats`, count the sections whose `melSlice` changed, then restore the snapshot and `hist` exactly.
  - `mpNewJob(t0, t1) -> [{idx, c, why}]`: for the stretch's longest repeated or held note, up to 3 single-chord swaps from `suggestions(idx)`. Each one has `!it.outside`, contains the note's pitch class, and gives a different `mpTension` value for that note. The `why` reads like: "G becomes the 9th of F: same note, more lift."
  - Markup, added inside `renderBreak()` after `.ba-list` when `!S.simple && BA`:
    - `<details class="mp-why">`. The summary is three plain sentences: the shape of the stretch, its rhythm (on, before or after the beat), and the note with the most tension. The detail holds `mpStyleLine` and the pull list.
    - `<div class="mp-close">`. One row per non-null layer: the label; a `role="meter"` bar with `aria-valuenow` (0 to 100) and its `mpWord` as visible text; and a Keep toggle (`data-mp="keep"`, `aria-pressed`). If there's a giveaway, a line follows: `"The {label lowercase} is still {word} to the original in bars {b0+1}–{b1+1}."`
    - A "Work on" `<select data-mp="at">`, listing each phrase ("Bars 1–2") and "Whole tune".
    - `<ul class="mp-paths">`. Each item shows its name; "Keeps: …" and "Changes: …" in plain labels; its words; and buttons Show (draws the ghost), Hear before, Hear after, Take, Another one and Toss. When `mpLinked>1`, Take reads `Take (changes all {n} {section name}s)`. The `newjob` chords are listed last, as `Hear` and `Try {chord}`, reusing `audition(contextSeq(...))` and `replaceAt`.
    - With no tune in the stretch, show the line `Add a tune to see its shape and paths.` and no list.
  - Roll: when `rollGhost` is set and `rollGhostFor` matches the current state, `renderRoll` draws each ghost note as `<g class="rn ghost" aria-label="Path preview: {name}">` with a dashed outline and no fill. Otherwise it clears `rollGhost`. In the lane (`S.melView==='lane'`), Show instead switches `S.melView='roll'`, and shows a toast with no Undo button: "Showing the path in the piano roll".
  - Take: `pushHist(); tune=item.notes; rollGhost=null; commit();` then a toast `"{name}: done"` with Undo, the same as `tuneUse`.

- [ ] **Step 1: Write failing tests (1280px).**
  - `paths: panel hidden in Simple view`: with `S.simple=true`, `#breakaway .mp-close` has count 0, and the existing `ba-head` text is unchanged.
  - `paths: closeness rows show words, not just colour`: every `.mp-close [role=meter]` has text matching `/very close|close|some way off|far/`.
  - `paths: Peg problem names rhythm`: load `steps`, press Break away, re-pitch every note, keep Chords changes. The giveaway line includes `'rhythm is still very close'`.
  - `paths: Show draws a ghost, an edit clears it`: Show the first item, and `#roll .ghost` count is above 0. Then `pushHist(); tune[0].m++; commit();` and the ghost count is 0.
  - `paths: Take is one undo step`: take the first item, then `undo()`, and `tune` deep-equals what it was before.
  - `paths: linked Chorus says how many change`: build `[Chorus] C G | [Verse] F C | [Chorus] C G` with one tune per Chorus and `S.linkForm=true`. The Take label includes `all 2 Choruses`. After Take and one `undo()`, both Choruses' tunes are back.
  - `paths: newjob suggests a chord that keeps the note`: on `repeat` with bar 1 picked, `mpNewJob` gives at least one item, and that item's chord contains pitch class 7.
  - `paths: empty stretch says add a tune`: Break away with chords only shows the text `Add a tune to see its shape and paths.`
- [ ] **Step 2: Write the 375px checks.**
  - `paths phone: no sideways page scroll`: `document.documentElement.scrollWidth<=375`.
  - `paths phone: path buttons are at least 44px tall`.
  - `paths phone: Show then Take works by tap`.
- [ ] **Step 3: Run them and confirm they FAIL.**
- [ ] **Step 4: Implement the state, `mpHear`, `mpLinked`, `mpNewJob`, the markup and the `baClick` handlers for `data-mp`, the ghost layer, and the CSS.** The CSS covers `.mp-why`, `.mp-close`, `.mp-paths` and `.rn.ghost` in both themes, using existing tokens only.
- [ ] **Step 5: Run the full suite and confirm it PASSES**, including `breakAway()`, the golden checks, `rollSuite`, `layout` and `iphone`.
- [ ] **Step 6: Commit** with the message `Show why, closeness and paths in Break away`.

### Task 7: The guide and the explainer

**Files:**
- Modify: `docs-src/guide.body.html`, in the section `#breakaway`.
- Modify: `docs-src/hood.body.html`, adding a short "Melody paths" section next to Break away's.
- Rebuild `guide.html` and `how-it-works.html`.

- [ ] **Step 1: Guide.** Keep the existing paragraphs. Add a sub-list "In the full view" covering:
  - the why summary;
  - closeness by layer, explaining that the bar count above still treats a new rhythm as matching, while the Rhythm row doesn't;
  - Keep;
  - Work on;
  - each path's buttons;
  - the ghost in the piano roll;
  - the Take warning for linked repeats.
  End with one line telling people to trust their ear. The legal-safety caution stays.
- [ ] **Step 2: Explainer.** In about 150 words, give the layer maths in plain sentences, one per layer, and explain how style limits decide which paths appear.
- [ ] **Step 3: Run `python3 docs-src/build.py . docs-src`, then `cd tests && node smoke.mjs`.** Expect everything to pass, including any guide-link checks.
- [ ] **Step 4: Commit** with the message `Explain melody paths in the guide and explainer`.
