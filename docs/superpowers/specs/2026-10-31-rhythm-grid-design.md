# Rhythm grid: design

Status: draft for approval. Linked note-and-chord ideas are a separate later project and are out of scope here.

## Why

A songwriter hears a melody with a real rhythm, then finds chords for it around a guitar neck. Today the rhythm has to be flattened to fit: the melody lane holds one note per beat plus an optional "and", and the Harmonize box fits typed notes into each bar by rule. People who can't read sheet music need a direct way to enter what's in their ear. They also need to work on one stretch of a song without disturbing the rest.

This grid is also the foundation for the later note-and-chord ideas, which need true note lengths and positions.

## Goals

1. **One shared grid.** Melody notes and chords can start on any grid slot and last any number of slots.
2. **Grid sizes.** 8ths, 16ths and triplets. The grid sets where new notes land.
3. **Zoom.** From the whole chart down to about two bars, to inspect a bar closely.
4. **Two views of the same melody.** A subdivided melody lane in Simple view and a piano roll in advanced view, driven by the existing Simple view switch.
5. **Write at any bar.** A tune can go in at any bar without touching other bars. This replaces the need for a separate "melody by section" project.
6. **Exact MIDI export.** Melody and chords export with the rhythm as written, the melody on its own track.
7. **Rhythm-aware Harmonize.** Suggestions weigh notes by real length and position, so a long note on a strong beat counts for more than a quick passing note.
8. **Longer melodies.** Harmonize works over a whole song, not only a short line typed into a box.
9. **Clear colours.** Chord tones, colour notes and clashes stand out in both views and both themes, and are never shown by colour alone.

## Non-goals

- Sheet music view.
- Note-and-chord ideas, the change-amount setting and genre melody rules (the next project).
- Audio or microphone input, and note velocity editing.
- Humanised timing.
- Swing playback. It's a possible later option, and it should change only how a song plays, never the written notes.
- Quantising or cleaning up played MIDI input.

## Anti-goals

This work has failed, even if it functions, if:

- Any saved song, shared link or library item opens with its rhythm or notes changed.
- A note moves because someone changed the grid size or zoom.
- Harmonize or any other action silently replaces melody outside the bars the person chose.
- The chart becomes harder to use on a phone.

## Behaviour

### Grid and zoom

- Grid size and zoom are view settings. They aren't undo steps and don't change the music.
- A coarser grid leaves existing finer notes exactly where they are. They stay visible and editable.
- At the widest zoom the chart looks much as it does today. A compact rendering is acceptable when a bar's notes are too small to label.
- Zoom applies to the chart rows and keeps the selected bar in view. Chords, melody and any shown parts line up on the same slots.

### Simple view lane

- One row of note blocks. Block width shows length, the label shows the note name, and the existing fit colouring applies.
- Selecting a slot uses the existing note pad and typed note entry, which write from that slot.
- Keyboard entry continues to work.

### Advanced view piano roll

- One row per pitch, higher notes higher, with in-key rows marked.
- Click or tap to add a note. Drag to move it in pitch or time, and drag its end to resize it.
- It shows real octaves.
- Vertical range scrolls and fits the tune by default.
- On a phone the roll stays usable through scrolling, or falls back to the lane, with no horizontal page scroll.

### Writing at any bar

- The Harmonize panel's **Put in melody lane** writes from the selected bar, and the panel says which bar.
- It replaces only the stretch it covers. Undo takes it back.
- If that stretch already holds notes, the app says so before replacing them.
- Text with `|` keeps working. With no selected bar it uses bar 1, stated before writing.

### Chords on the grid

- Dragging a chord's edge snaps to the current grid.
- Typed chart text stays readable and must round-trip chords that aren't on whole beats. The notation for that is left to the builder.
- A chord off the beat plays, exports and reports its length accurately everywhere.

### Harmonize

- Weight each note by length and metric position.
- Chord rate may follow the grid's rhythm as well as one or two per bar.
- Whole-song runs stay responsive. Long runs must not freeze the page.
- Existing typed note entry remains available as a quick way in.

### MIDI

- Melody on its own track at exact positions and lengths, alongside chords (and bass when chosen).
- Octaves as written.
- Section names and tempo as now.

### Octaves

- Harmony matching stays based on note names.
- Playback voicings stay below the melody where practical. This is a required outcome for the lane and roll. The fuller range and leap rules belong to the ideas project.

## Data

Decided by Claude, for review:

- Melody moves from `melody` and `melAnd` arrays to a list of notes `{t, d, m}`: start and length in ticks, and MIDI pitch.
- Use 12 ticks per counted beat, which covers 8ths, 16ths, 8th triplets and 16th triplets exactly. In x/8 metres a counted beat is an eighth, as it is today.
- Chords keep `beats`, widened from whole numbers to multiples of one tick. Timing comparisons use whole ticks, so rounding can't accumulate.
- A single load step converts every older form of a song to the new one: the current session, library items, undo history entries, Break away originals, imported files and shared links.
- Saved songs gain a version number. Sanitisers validate notes as strictly as they validate chords today.

Conversion is exact: each beat note, hold and "and" maps to one note with the same start, length and pitch.

## Code that must follow the change

Everything reading `melody`, `melAnd` or assuming whole-number `beats`, including:

- Playback: `playMelLine`, `playPass`, A/B and Break away's `baHear`, `playPart`, `styleEvents`.
- Melody tools: `melNotes`, `melRel`, `melPitch`, `melLaneHTML`, the note pad, typed entry, `tuneIdeas`, `melHarmonize`, `harmonize`, `parseMelody`.
- Form and arrangement: `sectionsOf`, `syncRepeats`, `repeatSection`, `moveSection`, `arrange`, `pianoPart`.
- Break away comparison: `baBars`, `baFlipped`, `baPutBar`, `baIdeas`.
- Text, files and printing: `serialize`, `parseProg`, `buildMidi`, the other exports, the lead sheet, shared links, `transpose`.

## Delivery

Each stage lands on its own branch and passes the full test suite. Stage 1 must change nothing a person can see or hear.

1. New note storage and conversion, with the app otherwise unchanged.
2. Lane on the grid: grid sizes, zoom, writing at any bar.
3. Chords on the grid, in playback, text and exports.
4. Piano roll in advanced view.
5. Exact melody in MIDI, and rhythm-aware, longer Harmonize.

## Testing

- Round-trip fixtures for every older save form, proving no note or rhythm changes.
- Sound and MIDI timing checks at each grid size, including triplets and 7/8.
- Writing at bar 5 leaves bars 1 to 4 and everything after the written stretch untouched.
- Drag checks for the roll, phone-width layout checks, and contrast checks in both themes.
- `python3 docs-src/build.py . docs-src` after any change to the app or help pages. The guide is updated as features land.

## Left to the builder

- Exact zoom steps and how they're controlled.
- The text notation for off-beat chords.
- The piano roll's rendering method and default pitch range.
- The exact Harmonize weighting, as long as long notes and strong beats count for more.
- Colour values that meet the contrast goal.
