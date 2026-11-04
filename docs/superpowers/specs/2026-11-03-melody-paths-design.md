# Melody paths: design

Status: draft for approval. Carnatic and Hindustani paths, and a second melodic line (riff or counter-melody), are later projects and are out of scope here.

## Why

A songwriter hears a melody they love, such as Hey Jude, Fly Me to the Moon, Peg, Anthony's Song or a Carnatic kriti, and wants to write something with the same pull. They tweak the tune and write their own words to it. When this fails, it almost always fails one way: **the result still sounds like the original.**

The real case behind this design is a song that came out too close to Steely Dan's Peg. The word rhythm stayed close to Peg's, and so did the back-and-forth between the two chords it leans on (roughly IV ↔ I). Changing individual pitches didn't help. Listeners know a tune mostly by its **rhythm** and its **contour** (the up-and-down shape), and much less by its exact notes. So pitch edits left the song's fingerprint where it was.

Anthony's Song shows the other half of the problem. The verse is mostly repeated notes and isn't very melodic on its own, but it works because the chords move under it. The same pitch keeps changing its job against the chord (root, then 3rd, then a 9th or a suspension), so the tension moves while the note stays put. The person wants to **see why a melody works like that**, and then get understandable ways to change it. They call these **paths of subversion**.

**Success** is a friend hearing the new song and wondering "have I heard this before?" without being able to name it. The song is catchy and not basic. Familiar but new is the target. "Sounds like Peg" is a miss on one side. Different but forgettable, or different but gimmicky, is a miss on the other.

## Goals

1. **A source and a working copy, built on Break away.** The app already has **Break away** (`BA`, `changes-breakaway-v1`, the "Break away" button in the Song form strip, and the guide section "Break away from another song"). It keeps a chart and its tune as the original, tags the bars that still follow it, plays the original and yours A/B, and offers a few ideas: Try another chord, Flip the tune's shape, Start a beat later. This work **grows Break away**. Its original *is* the source, and the why-view, paths and per-layer closeness are added to its panel. There is no second "original" anywhere in the app. The source stays unchanged, so everything compares against it.
2. **The why-view.** Shows in plain words and simple graphics why the working melody works:
   - **Contour:** the shape, where each phrase peaks, and how often the line repeats itself (motifs).
   - **Rhythm fingerprint:** where phrases start against the beat (on it, before it, after it), how long phrases are, which notes land on strong beats, and how busy each phrase is.
   - **Tension line:** each note's job against its chord, drawn as a line over time. Anthony's Song-style "same note, moving tension" should be plain to see.
   - **Pull within the key:** which notes lean toward resolving (for example the 7th degree toward 1, 4 toward 3), and whether and where they resolve. This works even with no chords.
   - **Harmonic rhythm:** how often the chords change and which chord pairs the song leans on, such as IV ↔ I.
3. **Paths for both rhythm and notes.** Each path is one named, understandable change. It states which layers it **keeps** and which it **changes**. For example: "Keep the IV ↔ I pull and the tension line. Start each phrase half a beat later and move the peak from bar 2 to bar 3."
4. **Every path shown two ways, side by side:**
   - the idea in words, with a one-line reason in theory terms;
   - a ghost rewrite in the piano roll that plays A/B against the current working melody.
5. **Take, edit or toss.** Taking a path makes it the working melody, which the person keeps editing by hand. Paths stack, so a path can run on the result of the last one. Undo backs out of each one.
6. **Per-layer closeness.** One bar per layer (rhythm, contour, intervals, tension line, harmonic rhythm) shows how close the working copy is to the source. The layer that is "giving it away" is named in plain words. It is a guide, not a verdict, and it stays quiet when nothing stands out.
7. **Paths respect the source's style.** Paths come from context: the source's own limits and the chords the person is keeping (see "Style limits").

## Non-goals (v1)

- Carnatic and Hindustani melody: raga phrases (sancharas), gamakas, and tala-aware rhythm paths. This is the next version and its own design.
- A second melodic line (riff, counter-melody, bass line) and how it answers the melody. The roll stays one voice.
- Lyrics entry or syllable stress. "Syllables on strong beats" is read as "note onsets on strong beats" in v1.
- Audio or microphone input, and MIDI import. Melody comes in through the piano roll.
- Any bundled melodies from real songs. The person enters their own source. Tests use synthetic fixtures only.
- Generating whole new melodies from scratch. Paths always start from a melody the person has.

## Anti-goals

This work has failed, even if it functions, if:

- **Gimmick subversion.** A path breaks the style just to be different, like putting a folk tune in 7/8 on the offbeats. Technically different but wrong for the song is a failure.
- **Overthinking.** The person has to read a wall of analysis before they can try anything. The quickest route should be: open it, pick a path, hear it.
- **Nothing really moves.** Paths that only shuffle pitches and leave rhythm and contour intact repeat the Peg problem. Every list of paths must include rhythm and contour changes.
- **Black box.** A rewrite arrives with no plain reason, or the reason doesn't match what changed.
- **Lost work.** The source or the working melody changes without the person asking, or an old save, link or library item opens differently.
- The chart or roll becomes harder to use on a phone.

## Constraints

These are the app's existing rules, in `PRODUCT.md` and earlier plans:

- One HTML file (`index.html`), plain JavaScript, no libraries and no build step for the app. Help pages are rebuilt with `python3 docs-src/build.py . docs-src`.
- Theory and maths, not AI. Paths and analysis are rule-based and deterministic: the same input gives the same paths.
- No server and no tracking. State lives in localStorage. New saved fields are additive, and old saves open unchanged.
- Works at 375px on touch with no keyboard, hover or right-click. Fit and tension are never shown by colour alone.
- Copy says "clash", never "wrong".
- The melody is `tune` (notes `{t,d,m,...}` in ticks, `TICKS=12` per beat), one voice, with no overlaps. The rhythm-grid and piano-roll specs and plans already define how edits trim neighbouring notes. Paths must follow the same rules.
- `tests/smoke.mjs` stays green and the golden record stays identical.
- The piano roll (`S.melView==='roll'`, the full view) is the input path and the place the ghost rewrite is drawn. The person still needs to test the roll more. This work depends on it, and roll bugs found along the way are fixed as part of it.

## Decided

These are the person's own calls:

- Western song melody first. Carnatic and Hindustani come next.
- Both rhythm and notes are in play for v1.
- Paths show the rewrite and tell the person what to try, side by side, so they can compare.
- The person plays with suggestions and ideas and keeps editing by hand. Paths are starting points, not answers.
- One melodic line in v1. A second line comes later.
- The closeness check is in v1. The person asked to "make sure it's different".
- Grow Break away rather than build a separate source system.

## Calls made in writing this (check these)

- **Storage stays where Break away keeps it today.** That's one browser-wide slot (`changes-breakaway-v1`), outside undo and the library. A saved Break-away original opens unchanged and becomes the source. Any new fields are additive, and the `v` number goes up only if the reader still accepts v2. Saving the source per chart, in the library and in links, is a possible later step and not part of v1.
- **The existing bar tags and ideas stay.** Try, Flip the tune's shape and Start a beat later become paths in the new list (Flip → Bend the contour, Start a beat later → Shift the phrase start), with the same results for the same input. The golden record and the guide's promises keep holding.
- **Rhythm now counts.** Today a bar's notes "follow" when three quarters of them run in the same order, so a new rhythm alone never counts as moving away. That is the blind spot behind the Peg problem. The bar tags stay as they are, so old behaviour doesn't shift. The new per-layer closeness reports rhythm separately, and the guide explains the difference.
- **Timing paths stay inside their own stretch.** Shift the phrase start, Phrase length, and Stretch or squash never move chords, change the bar count or push later notes along. They work within the room around the phrase and trim neighbours by the existing no-overlap rules. This keeps the bar-by-bar comparison fair.
- **Link repeats:** paths follow the same rule as every other edit (`S.linkForm` / `syncRepeats`). When taking a path will change every matching section, the path card says so before the person taps Take, for example "Changes all 3 Choruses". The ghost shows only the section being worked on.
- **"Same note, new job"** suggests chords from the existing swap-ideas engine, limited by Chords allowed, and lets the person hear each one A/B. It never changes the chart unless the person picks a chord. This is the one path that touches harmony.
- **The tension line measures each melody against its own chords**, because that's what you hear. Closeness compares the two tension lines. Style limits are read from the source. "The chords you're keeping" means the current working chords.
- **The guide's caution stays:** closeness measures notes, rhythm and chords, not how the song sounds, and can't tell anyone a song is legally safe.

## Style limits

Before suggesting anything, the app reads a small set of limits from the source melody. A path may not leave them, apart from a small tolerance the builder sets:

- **Meter and tempo:** never changed by a path.
- **Syncopation level:** the share of onsets that fall off the beat. A path may move it a little, but never from "almost none" to "heavy".
- **Note-length set:** the lengths the source actually uses. A path doesn't introduce 16ths into a tune of quarters and 8ths, or triplets into a straight tune unless the source has them.
- **Range:** the source's lowest and highest note, plus a step or so.
- **Largest leap:** a path doesn't add leaps much bigger than the source's own.
- **Pitch set:** the scale notes the source uses. Chromatic notes appear only if the source uses them, and then in the same kind of spot.
- **Phrase lengths:** the source's phrase lengths, plus or minus a beat or two.

The why-view shows these limits as the song's "style" in a short readable line, so the person can see why a path wasn't offered.

## Paths for v1

This is the starting set. Each one says what it keeps and what it changes, and each runs on a whole phrase or a chosen stretch.

**Rhythm paths**

- **Shift the phrase start:** start a phrase earlier (pickup) or later (after the downbeat), within the syncopation limit.
- **Re-split:** merge repeated notes into one longer note, or split a long note into repeated ones. This changes how many syllables a phrase holds, which suits the person writing new words.
- **Move the landing:** change which notes fall on strong beats, so a different note gets the weight.
- **Stretch or squash a motif:** play a short motif at double or half speed, using the source's note lengths only.
- **Phrase length:** extend or cut a phrase ending by a beat or two.

**Note paths**

- **Move the peak:** put the phrase's high point somewhere else in the phrase.
- **Same job, new note:** swap a chord tone for another tone of the same chord. The tension line stays the same and the pitch changes.
- **Same note, new job:** keep a repeated note and show what it becomes against different chords. This is the Anthony's Song move. It's offered as a note in words and doesn't change the chords on its own, since harmony stays the person's call.
- **Bend the contour:** turn a motif upside down or play it backwards, kept in the key.
- **Widen or narrow:** keep the up-and-down shape but make the steps bigger or smaller, within the range and leap limits.
- **Sequence:** repeat a motif starting on a different scale degree.
- **New cadence target:** end a phrase on a different chord tone (3rd instead of root, say) to change how settled it sounds.

Each path can offer a few variants, picked in a fixed, repeatable order with "Another one". Every variant must pass the style limits, and must lower closeness on at least one layer the path claims to change.

## Closeness

The working copy is compared with the source layer by layer, aligned bar by bar from the start. Roughly:

- **Rhythm:** how many onsets match in each bar.
- **Contour:** a match of each phrase's up / down / same sequence.
- **Intervals:** exact steps between notes.
- **Tension line:** the sequence of note fits against the chords.
- **Harmonic rhythm:** chord-change positions and the chord pairs the song leans on.

Each layer shows as a short bar from "very close" to "far". When one layer is much closer than the rest, a single line names it, for example: "The rhythm is still almost the same as the source's in bars 1 to 4." Layers the person is deliberately keeping, such as the IV ↔ I pull, can be pinned as **kept**, so the check doesn't keep flagging them.

## What the person sees (sketch)

This is the Break away panel, grown. It stays reached from the Break away button, and the full view adds the parts below. The bar count and Hear the original / Hear yours stay where they are. Pressing Break away still sets the source, and Stop comparing still clears it.

1. **Source:** the original as Break away keeps it today: tune, chords, key and meter.
2. **Why:** the contour, rhythm, tension and pull readouts above, plus the style line. The first look is collapsed to a few plain sentences, and detail sits one tap away.
3. **Paths:** a list of the paths that apply, each showing what it keeps and changes. Tapping one draws the ghost in the roll and shows its words. Buttons: Hear before / Hear after (A/B), Take, Another one, Toss. Closeness bars sit with the paths and update for the ghost, so the person sees what the path would do before taking it.

Simple view keeps today's Break away panel and doesn't show the why-view or the new paths. That keeps "Simple first, depth on demand". The ghost needs the roll, so in the lane, a path offers Hear before / Hear after and the words, plus a one-tap switch to the roll to see it.

## Left to the builder

- Exact maths for each closeness layer and its thresholds. Keep it simple and explainable in one sentence each.
- Exact tolerances on the style limits.
- How phrases are found: rests, long notes and bar lines are a reasonable start.
- How the tension line is scored from `noteFit` / `melRel` plus beat strength and length.
- Card layout, naming and copy, following the existing house style (DESIGN.md, plain language, "clash" not "wrong").
- How this card and the existing "Tune ideas" (clash fixes, leap fills, neighbours) sit together. They are different jobs: tune ideas fix a melody, while paths move it away from a source.
