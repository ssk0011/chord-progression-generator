// Headless smoke test for index.html (Chord Changes Workbench). Run: cd tests && npm test   (or: node smoke.mjs 1 2 3 to pick phases)
import { chromium, webkit, devices } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'out');
fs.mkdirSync(OUT, { recursive: true });
const PHASES = process.argv.slice(2).length ? process.argv.slice(2).map(Number) : [1, 2, 3];

// ---------- tiny static server ----------
const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0].split('#')[0]));
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html'); // as GitHub Pages serves a folder
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': p.endsWith('.html') ? 'text/html; charset=utf-8' : p.endsWith('.js') ? 'text/javascript' : p.endsWith('.png') ? 'image/png' : 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html`;

// ---------- MIDI parser (enough for files this app writes) ----------
export function parseMidi(buf) {
  const b = Buffer.from(buf); let o = 0;
  const str = n => { const s = b.toString('latin1', o, o + n); o += n; return s; };
  const u32 = () => { const v = b.readUInt32BE(o); o += 4; return v; };
  const u16 = () => { const v = b.readUInt16BE(o); o += 2; return v; };
  if (str(4) !== 'MThd') throw new Error('no MThd');
  if (u32() !== 6) throw new Error('bad header length');
  const format = u16(), ntrk = u16(), ppq = u16(), tracks = [];
  for (let t = 0; t < ntrk; t++) {
    if (str(4) !== 'MTrk') throw new Error('no MTrk ' + t);
    const len = u32(), end = o + len, evs = []; let tick = 0, status = 0;
    const vlq = () => { let v = 0, c; do { c = b[o++]; v = (v << 7) | (c & 0x7f); } while (c & 0x80); return v; };
    while (o < end) {
      tick += vlq(); let st = b[o];
      if (st & 0x80) { o++; status = st; } else st = status;
      if (st === 0xff) { const type = b[o++], l = vlq(); evs.push({ tick, meta: type, data: b.subarray(o, o + l) }); o += l; if (type === 0x2f) break; }
      else { const hi = st & 0xf0, n = hi === 0xc0 || hi === 0xd0 ? 1 : 2; evs.push({ tick, st: hi, ch: st & 15, d: [...b.subarray(o, o + n)] }); o += n; }
    }
    o = end; tracks.push(evs);
  }
  if (o !== b.length) throw new Error('trailing bytes');
  return { format, ntrk, ppq, tracks };
}

// ---------- harness ----------
const results = []; let failures = 0;
/* on GitHub Actions a failure is also written as an error annotation, so it shows on the run's summary page */
const annotate = (name, detail) => { if (!process.env.GITHUB_ACTIONS) return; const esc = t => String(t).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');
  console.log(`::error title=${esc(name).replace(/[:,]/g, ' ').slice(0, 200)}::${esc(detail || name).slice(0, 2000)}`); };
const check = (name, ok, detail = '') => { results.push(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) { failures++; annotate(name, detail); } };
// headless Chromium on a machine with no audio device can stall creating an AudioContext; this flag gives it a silent output
const browser = await chromium.launch({ args: ['--disable-audio-output'] });
async function openPage(opts = {}) {
  const { noReveal, firstVisit, ...o } = opts;
  const ctx = await browser.newContext({ acceptDownloads: true, serviceWorkers: 'block', ...o });
  /* most checks start from the screens a returning visitor sees; firstVisit opts into a brand-new visitor's first screen */
  if (!opts.firstVisit) await ctx.addInitScript(() => { try { if (!localStorage.getItem('changes-tabs-v1')) localStorage.setItem('changes-tabs-v1', '{}'); } catch (e) {} });
  const page = await ctx.newPage(); page.errors = []; page.setDefaultTimeout(5000);
  // controls now live in tabs, the Create drawer and popovers: reveal one the way a person would before using it
  if (!noReveal) for (const m of ['click', 'fill', 'selectOption', 'check', 'uncheck', 'dblclick', 'setInputFiles', 'press']) {
    const orig = page[m].bind(page);
    page[m] = async (sel, ...rest) => { if (typeof sel === 'string' && !/>>|:has|text=/.test(sel)) await page.evaluate(q => { try { const el = document.querySelector(q); if (el && window.revealEl) revealEl(el); } catch (e) {} }, sel).catch(() => {}); return orig(sel, ...rest); };
  }
  page.on('console', m => { if (m.type() === 'error') page.errors.push(m.text()); });
  page.on('pageerror', e => page.errors.push(String(e)));
  return { ctx, page };
}
// toasts sit at the bottom edge and can cover a button Playwright scrolls into view; dismiss them before clicking
const tap = async (page, sel) => { await page.evaluate(() => { document.querySelector('#toast').hidden = true; }); 
  // export actions live in the Export menu: open it first, as a person would
  if (!/>>|:has|text=/.test(sel) && await page.evaluate(s => { const el = document.querySelector(s); return !!(el && el.closest('#exportMenu') && document.querySelector('#exportMenu').hidden); }, sel)) await page.click('#exportBtn');
  await page.click(sel); };
const noHScroll = page => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

// ===================================================== PHASE 1
async function phase1() {
  const { ctx, page } = await openPage();
  // an old-format save (no genres, "blues" as a mood, no library yet) must still load
  await page.goto(URL_);
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('changes-v1', JSON.stringify({ S: { tonic: 2, mode: 'dorian', meter: '4/4', tempo: 100, level: 2, mood: 'blues' }, chords: [{ id: 'x1', root: 2, q: 'm7', bass: null, beats: 4 }, { id: 'x2', root: 7, q: '7', bass: null, beats: 4 }], sel: 'x1' })); });
  await page.reload();
  const old = await page.evaluate(() => ({ n: chords.length, names: chords.map(c => chordName(c)).join(' '), g: S.genres, mood: S.mood, lib: JSON.parse(localStorage.getItem('changes-library-v1')) }));
  check('old changes-v1 save loads', old.n === 2 && old.names === 'Dm7 G7', old.names);
  check('old Bluesy mood becomes the Blues genre', old.g.includes('blues') && old.mood === '');
  check('old save migrated into library as "Untitled"', old.lib && old.lib.version === 1 && old.lib.items[0]?.name === 'Untitled');

  check('all eight moods are offered', await page.evaluate(() => MOODS.map(m => m.name).join() === 'Uplifting,Melancholy,Dreamy,Dark,Tense,Nostalgic,Epic,Mysterious'));
  // generate, edit, play
  await tap(page, '#gen');
  check('generate makes a progression', await page.evaluate(() => chords.length > 0 && chords.every(c => c.beats > 0)));
  await page.evaluate(() => stopAll()); // Generate plays what it made
  await page.fill('#prog', '[Verse]\nC | Am | F | G:2 G7:2\n[Chorus]\nF | G | C | C');
  await tap(page, '#load');
  const loaded = await page.evaluate(() => ({ text: document.querySelector('#prog').value, n: chords.length }));
  check('typed chart loads', loaded.n === 9 && loaded.text.includes('[Chorus]'), loaded.text.replace(/\n/g, ' / '));
  await tap(page, '#play'); await page.waitForTimeout(700);
  check('play highlights a chord', await page.evaluate(() => !!document.querySelector('.slot.playing')));
  await tap(page, '#play');
  check('stop clears playback', await page.evaluate(() => !playing && !document.querySelector('.slot.playing')));

  // MIDI export: parse the generated bytes and compare with the chart and the player's voicings
  for (const withBass of [false, true]) {
    const r = await page.evaluate(wb => ({ bytes: [...buildMidi(wb)], tempo: S.tempo, num: barLen(), den: den(),
      voices: chords.filter(real).map(c => { const v = chartPlan().get(c.id); return { all: v.all.length, rh: v.rh.length, bass: v.bass }; }),
      beats: chords.map(c => c.beats), real: chords.map(real) }), withBass);
    const m = parseMidi(r.bytes), tpb = m.ppq * 4 / r.den;
    const tempoEv = m.tracks[0].find(e => e.meta === 0x51), ts = m.tracks[0].find(e => e.meta === 0x58);
    const bpm = 60e6 / ((tempoEv.data[0] << 16) | (tempoEv.data[1] << 8) | tempoEv.data[2]);
    const ons = t => m.tracks[t].filter(e => e.st === 0x90 && e.d[1] > 0), offs = t => m.tracks[t].filter(e => e.st === 0x80 || (e.st === 0x90 && e.d[1] === 0));
    const starts = []; let acc = 0; r.beats.forEach((b, i) => { if (r.real[i]) starts.push(acc * tpb); acc += b; });
    const onTicks = [...new Set(ons(1).map(e => e.tick))];
    const label = withBass ? 'chords + bass' : 'chords only';
    check(`MIDI ${label}: format 1, ${withBass ? 3 : 2} tracks`, m.format === 1 && m.ntrk === (withBass ? 3 : 2));
    check(`MIDI ${label}: tempo ${r.tempo} bpm`, Math.abs(bpm - r.tempo) < 0.01, bpm.toFixed(2));
    check(`MIDI ${label}: time signature ${r.num}/${r.den}`, ts.data[0] === r.num && 2 ** ts.data[1] === r.den);
    const expectOn = r.voices.reduce((a, v) => a + (withBass ? v.rh : v.all), 0);
    check(`MIDI ${label}: chord note count matches the voicings`, ons(1).length === expectOn && offs(1).length === expectOn, `${ons(1).length}/${expectOn}`);
    check(`MIDI ${label}: chord onsets match the chart order and durations`, JSON.stringify(onTicks) === JSON.stringify(starts), onTicks.join(','));
    check(`MIDI ${label}: last note ends with the chart`, Math.max(...offs(1).map(e => e.tick)) === acc * tpb);
    if (withBass) check('MIDI bass track: one note per chord, matching the bass line', ons(2).length === r.voices.length && ons(2).every((e, i) => e.d[0] === r.voices[i].bass));
    check(`MIDI ${label}: section markers`, m.tracks[0].filter(e => e.meta === 0x06).map(e => e.data.toString()).join(',') === 'Verse,Chorus');
  }
  const dlP = page.waitForEvent('download');
  await tap(page, '#midiExport');
  const dl = await dlP, dlPath = path.join(OUT, dl.suggestedFilename()); await dl.saveAs(dlPath);
  check('Export MIDI button downloads <key>-<mode>-<tempo>bpm.mid', /^[A-G](sharp|flat)?-[a-z]+-\d+bpm\.mid$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  let parsedOk = true; try { parseMidi(fs.readFileSync(dlPath)); } catch (e) { parsedOk = false; }
  check('downloaded .mid parses', parsedOk);
  // notation export: the Export menu downloads MusicXML that parses, with one bar per chart bar and a symbol per chord
  const xdlP = page.waitForEvent('download'); await tap(page, '#xmlExport'); const xdl = await xdlP, xpath = path.join(OUT, xdl.suggestedFilename()); await xdl.saveAs(xpath);
  const xml = fs.readFileSync(xpath, 'utf8');
  const xr = await page.evaluate(x => { const d = new DOMParser().parseFromString(x, 'application/xml'); const L = barLen(), total = chords.reduce((a, c) => a + c.beats, 0);
    return { err: !!d.querySelector('parsererror'), measures: d.querySelectorAll('measure').length, bars: Math.ceil(total / L), harm: d.querySelectorAll('harmony').length, real: chords.filter(real).length, reh: [...d.querySelectorAll('rehearsal')].map(r => r.textContent).join(',') }; }, xml);
  check('Export notation downloads MusicXML (.musicxml)', /\.musicxml$/.test(xdl.suggestedFilename()) && xml.startsWith('<?xml') && /score-partwise/.test(xml), xdl.suggestedFilename());
  check('MusicXML parses with a bar per chart bar, a chord symbol per chord and section marks', !xr.err && xr.measures === xr.bars && xr.harm === xr.real && xr.reh === 'Verse,Chorus', JSON.stringify(xr));
  // the zip wrapper used inside the artifact viewer
  const zip = Buffer.from(await page.evaluate(() => [...zipStore([{ name: 'a.mid', data: buildMidi(false) }])]));
  check('zip wrapper has a valid end record and CRC', zip.readUInt32LE(zip.length - 22) === 0x06054b50 && zip.readUInt32LE(14) === await page.evaluate(() => crc32(buildMidi(false))));

  // share link round trip, in a fresh browser profile
  const link = await page.evaluate(() => shareLinkURL());
  const before = await page.evaluate(() => ({ text: serialize(), k: S.tonic, m: S.mode, t: S.meter, b: S.tempo }));
  const { ctx: ctx2, page: p2 } = await openPage();
  await p2.goto(link); await p2.waitForTimeout(200);
  const after = await p2.evaluate(() => ({ text: serialize(), k: S.tonic, m: S.mode, t: S.meter, b: S.tempo, hash: location.hash, toast: document.querySelector('#toast').textContent }));
  check('share link restores key, mode, meter, tempo and chart with sections', JSON.stringify({ ...after, hash: 0, toast: 0 }) === JSON.stringify({ ...before, hash: 0, toast: 0 }), after.text.replace(/\n/g, ' / '));
  check('share link shows a toast and clears the hash', /shared/.test(after.toast) && after.hash === '');
  await p2.evaluate(() => { document.querySelector('#library').open = true; });
  await p2.fill('#shareIn', 'not a link'); await tap(p2, '#shareOpen');
  check('bad share code is rejected with a message', /not a Chord Changes/.test(await p2.textContent('#toast')));
  check('no console errors (share page)', p2.errors.length === 0, p2.errors.join(' | '));
  await ctx2.close();
  await tap(page, '#shareLink'); await page.waitForTimeout(150);
  check('Share link button copies or shows the copy box', await page.evaluate(() => /copied/.test(document.querySelector('#toast').textContent) || !document.querySelector('#copybox').hidden));
  if (await page.evaluate(() => !document.querySelector('#copybox').hidden)) await page.click('#copyboxDone');

  // library: save, save again (update), open, rename, duplicate, delete with undo, export and import
  await tap(page, '#library summary');
  await page.fill('#libName', 'Verse idea'); await tap(page, '#libSaveBtn');
  await page.fill('#libName', 'Verse idea'); await tap(page, '#libSaveBtn');
  let lib = await page.evaluate(() => LIB.items.map(i => i.name));
  check('library saves by name and updates on the same name', lib.filter(n => n === 'Verse idea').length === 1 && lib.includes('Untitled'), lib.join(', '));
  await tap(page, '[data-lib] >> text=Untitled'); // open
  check('opening an item loads it', await page.evaluate(() => chords.map(c => chordName(c)).join(' ') === 'Dm7 G7'));
  check('opening an item closes the Library so the chart shows', await page.evaluate(() => !document.querySelector('#library').open));
  await page.evaluate(() => { document.querySelector('#library').open = true; });
  await tap(page, '[data-lib]:has-text("Verse idea") [data-la="rename"]');
  await page.fill('[data-lib] input', 'Verse A'); await page.press('[data-lib] input', 'Enter');
  await tap(page, '[data-lib]:has-text("Verse A") [data-la="dup"]');
  await tap(page, '[data-lib]:has-text("Verse A copy") [data-la="del"]');
  lib = await page.evaluate(() => LIB.items.map(i => i.name));
  check('rename, duplicate and delete work', lib.includes('Verse A') && !lib.includes('Verse A copy'), lib.join(', '));
  await page.click('#toast .toast-act');
  lib = await page.evaluate(() => JSON.parse(localStorage.getItem('changes-library-v1')).items.map(i => i.name));
  check('delete can be undone and is stored', lib.includes('Verse A copy'), lib.join(', '));
  const jdl = page.waitForEvent('download'); await tap(page, '#libExport'); const jd = await jdl; const jpath = path.join(OUT, jd.suggestedFilename()); await jd.saveAs(jpath);
  const exported = JSON.parse(fs.readFileSync(jpath, 'utf8'));
  check('library exports as versioned JSON', exported.version === 1 && exported.items.length === lib.length);
  await page.evaluate(() => { LIB.items = []; libSave(); renderLibrary(); });
  await page.setInputFiles('#libImport', jpath);
  await page.waitForTimeout(200);
  check('library imports from the exported JSON', await page.evaluate(n => LIB.items.length === n, exported.items.length));

  // print stylesheet: only the lead sheet shows, black on white
  await page.evaluate(() => { document.querySelector('#printSheet').innerHTML = leadSheetHTML(); });
  await page.emulateMedia({ media: 'print' });
  const pr = await page.evaluate(() => ({ sheet: getComputedStyle(document.querySelector('#printSheet')).display, wrap: getComputedStyle(document.querySelector('.wrap')).display,
    bars: document.querySelectorAll('#printSheet .bar').length, sec: [...document.querySelectorAll('#printSheet h2')].map(h => h.textContent).join(','), bg: getComputedStyle(document.body).backgroundColor, num: !!document.querySelector('#printSheet .cell i') }));
  check('print shows only the lead sheet', pr.sheet === 'block' && pr.wrap === 'none');
  check('lead sheet has bars, numerals, white page', pr.bars > 0 && pr.num && pr.bg === 'rgb(255, 255, 255)', `${pr.bars} bars, sections ${pr.sec}`);
  await page.pdf({ path: path.join(OUT, 'lead-sheet.pdf') }).catch(() => {});
  await page.emulateMedia({ media: 'screen' });

  // live MIDI out: picking "Connect" must either list devices or explain the block, never throw
  if (await page.evaluate(() => 'requestMIDIAccess' in navigator)) {
    await page.selectOption('#midiOut', '__connect'); await page.waitForTimeout(800);
    const mo = await page.evaluate(() => ({ opts: [...document.querySelector('#midiOut').options].map(o => o.text), toast: document.querySelector('#toast').textContent }));
    check('MIDI out connect lists outputs or explains a block', mo.opts.length >= 1 && (mo.opts.includes('Off') || /blocked/.test(mo.toast)), mo.opts.join(' / '));
    await tap(page, '#play'); await page.waitForTimeout(300); await tap(page, '#play');
  }
  // reload keeps the last state
  const lastText = await page.evaluate(() => serialize());
  await page.reload();
  check('reload restores the last progression', await page.evaluate(t => serialize() === t, lastText));
  check('no console errors (main page)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}


// ===================================================== PHASE 2
async function phase2() {
  const { ctx, page } = await openPage();
  await page.goto(URL_); await page.evaluate(() => { localStorage.clear(); }); await page.reload();
  await page.fill('#prog', 'C | Am | F | G | Em | ? | Dm | G7'); await tap(page, '#load');

  // 2.1 every idea on every slot has theory name, specific sentence, voice-leading line and A/B
  const audit = await page.evaluate(() => {
    const out = { items: 0, missing: [], generic: [], dupes: 0 };
    for (const c of chords) {
      sel = c.id; renderAll(); openGroups.clear(); document.querySelectorAll('#subs [data-more]').forEach(b => openGroups.add(b.dataset.more)); renderSubs();
      const items = [...document.querySelectorAll('#subs .item')], seen = new Set();
      for (const it of items) {
        out.items++;
        const tn = it.querySelector('.tn')?.textContent.trim(), why = it.querySelector('.why')?.textContent.trim(), vl = it.querySelector('.vl')?.textContent.trim(), ab = it.querySelector('[data-ab]');
        const names = [...it.querySelectorAll('.names .nm')].map(n => n.textContent);
        if (!tn || !why || why.length < tn.length + 20 || !vl || !ab) out.missing.push(chordName(c) + ' → ' + names.join(' '));
        // specific, not filler: the sentence names the idea (and the original when there is one), the VL line names a neighbour
        const body = why.slice(tn.length);
        if (!names.some(n => body.includes(n)) || (real(c) && names.length === 1 && !body.includes(chordName(c)) && !/fills the gap/.test(body))) out.generic.push(names.join(' ') + ': ' + body);
        if (seen.has(body)) out.dupes++; seen.add(body);
      }
    }
    return out;
  });
  check('2.1 every suggestion has theory name, sentence, voice-leading and A/B', audit.items > 50 && audit.missing.length === 0, `${audit.items} ideas; missing: ${audit.missing.slice(0, 3).join(' | ')}`);
  check('2.1 explanations name the specific chords (no generic filler)', audit.generic.length === 0, audit.generic.slice(0, 2).join(' | '));
  check('2.1 no two ideas for a slot share an explanation', audit.dupes === 0, String(audit.dupes));
  const vlLine = await page.evaluate(() => { sel = chords[1].id; renderAll(); return document.querySelector('#subs .item .vl').textContent; });
  check('2.1 voice-leading line lists held notes and semitone moves', /From C:/.test(vlLine) && /semitone/.test(vlLine) && /[+−]\d/.test(vlLine), vlLine);
  const chartBefore = await page.evaluate(() => serialize());
  await tap(page, '#subs [data-ab]'); await page.waitForTimeout(400);
  const abOn = await page.evaluate(() => ({ pressed: document.querySelector('#subs [data-ab][aria-pressed="true"]') != null, stat: document.querySelector('.abstat')?.textContent || '' }));
  check('2.1 A/B plays original then substitute and shows which', abOn.pressed && /Playing A: Am/.test(abOn.stat), abOn.stat);
  await page.waitForTimeout(Math.ceil(60 / 88 * 4 * 1000) + 300);
  check('2.1 A/B moves on to B', /Playing B:/.test(await page.evaluate(() => document.querySelector('.abstat')?.textContent || '')));
  await tap(page, '#subs [data-ab][aria-pressed="true"]');
  check('2.1 A/B never changes the chart and stops on a second click', await page.evaluate(b => serialize() === b && !document.querySelector('.abstat') && !document.querySelector('#subs [data-ab][aria-pressed="true"]'), chartBefore));
  await tap(page, '#subs [data-use]');
  check('2.1 Put in this slot replaces the chord', await page.evaluate(b => serialize() !== b, chartBefore));
  await page.evaluate(() => undo());

  // 2.2 voice-leading X-ray
  await page.check('#vlToggle');
  const x = await page.evaluate(() => ({ shown: !document.querySelector('#vlx').hidden, lines: document.querySelectorAll('#vlx svg line').length, held: document.querySelectorAll('#vlx line[stroke="var(--accent)"][stroke-width="5"]').length, cap: document.querySelector('#vlx .cap').textContent }));
  check('2.2 voice-leading X-ray draws voices with held tones marked', x.shown && x.lines > 20 && x.held > 0, `${x.lines} lines, ${x.held} held`);
  check('2.2 caption names smoothest and roughest transitions', /Smoothest: .+ → .+Roughest: .+ → /.test(x.cap), x.cap);
  const sameEngine = await page.evaluate(() => { const c = chords.find(real), v = chartPlan().get(c.id); const ys = [...document.querySelectorAll('#vlx svg line title')].filter(t => t.textContent.startsWith(chordName(c) + ':')).length; return ys === v.all.length; });
  check('2.2 the picture uses the playback voicings', sameEngine);

  // 2.3 surprise dial: outside-chord rate rises with the dial; vocabulary and Keep my mode still hold
  const rates = await page.evaluate(() => {
    const r = {}; S.vocab = [...PRESETS.Simple]; S.genres = []; S.mood = 'uplift'; S.lock = true; S.mode = 'ionian';
    for (const v of [0, 100]) { S.surprise = v; let out = 0, tot = 0, vocabBad = 0, modeMoved = 0;
      for (let k = 0; k < 60; k++) { generate(); if (S.mode !== 'ionian') modeMoved++; for (const c of chords) if (real(c)) { tot++; if (analyze(c).kind !== 'dia') out++; if (!qOn(c.q) || (c.bass != null && !famOn('slash'))) vocabBad++; } }
      r[v] = { rate: out / tot, vocabBad, modeMoved }; }
    return r;
  });
  check('2.3 dial at Surprising gives far more outside chords than Predictable', rates[100].rate > rates[0].rate + 0.2, `${(rates[0].rate * 100).toFixed(0)}% → ${(rates[100].rate * 100).toFixed(0)}%`);
  check('2.3 dial respects the vocabulary cap and Keep my mode', rates[0].vocabBad + rates[100].vocabBad === 0 && rates[0].modeMoved + rates[100].modeMoved === 0);
  const tens = await page.evaluate(() => ({ dots: document.querySelectorAll('#tension circle').length, n: chords.filter(real).length }));
  check('2.3 tension curve has one point per chord', tens.dots === tens.n && tens.n > 0, `${tens.dots}/${tens.n}`);

  // 2.4 lock and regenerate
  await page.evaluate(() => { S.lock = false; S.surprise = 30; S.vocab = [...PRESETS.Color]; });
  await page.fill('#prog', '[A]\nC | Am:2 ? | F | G7\n[B]\nDm | G | C | C'); await tap(page, '#load');
  await page.evaluate(() => { chords[0].lock = true; chords[3].lock = true; chords[2].lock = true; sel = chords[3].id; renderAll(); });
  check('2.4 lock icon shows on locked slots', await page.evaluate(() => document.querySelectorAll('#rows .slot .lk').length === 2));
  const before = await page.evaluate(() => ({ names: chords.map(c => chordName(c)), beats: chords.map(c => c.beats).join(), text: serialize() }));
  let lockOk = true, lenOk = true, qFilled = true, changed = false;
  for (let k = 0; k < 8; k++) {
    await tap(page, '#regen');
    const a = await page.evaluate(() => ({ names: chords.map(c => chordName(c)), beats: chords.map(c => c.beats).join(), secs: chords.map(c => c.sec || '').join(), empty: chords.filter(c => !real(c)).length }));
    if (a.names[0] !== before.names[0] || a.names[3] !== before.names[3]) lockOk = false;
    if (a.beats !== before.beats || a.secs !== ',,,,,B,,,'.replace(/^/, 'A') && a.secs !== 'A,,,,,B,,,') lenOk = false;
    if (a.empty) qFilled = false;
    if (a.names.join() !== before.names.join()) changed = true;
  }
  check('2.4 locked chords survive Regenerate unlocked', lockOk);
  check('2.4 slot lengths and sections are kept', lenOk);
  check('2.4 ? slots count as unlocked and get filled (even if flagged)', qFilled);
  check('2.4 unlocked slots do change', changed);
  await page.evaluate(() => { const b = document.querySelector('#rows .slot.locked .lk'); b.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
  check('2.4 clicking the lock icon unlocks', await page.evaluate(() => document.querySelectorAll('#rows .slot .lk').length === 1));
  await page.evaluate(() => { sel = chords[3].id; renderAll(); });
  await tap(page, '#detail [data-act="lock"]');
  check('2.4 Lock button in the detail panel toggles', await page.evaluate(() => !chords[3].lock && document.querySelector('#detail [data-act="lock"]').textContent === 'Lock'));
  check('no console errors (phase 2)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}


// ===================================================== PHASE 3
async function phase3() {
  const { ctx, page } = await openPage();
  await page.goto(URL_); await page.evaluate(() => { localStorage.clear(); }); await page.reload();
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; S.vocab = [...PRESETS.Color]; renderAll(); });
  await page.fill('#prog', 'C | E7 | Am | D♭7 | C | A♭ | F | G7'); await tap(page, '#load');

  // 3.1 quiz
  await page.check('#quizOn');
  const hidden = await page.evaluate(() => ({ on: document.body.classList.contains('quiz-on'), num: getComputedStyle(document.querySelector('#rows .slot .cr')).visibility, legend: getComputedStyle(document.querySelector('.legend')).display, tint: getComputedStyle(document.querySelectorAll('#rows .slot')[1]).getPropertyValue('--k').trim() === getComputedStyle(document.querySelectorAll('#rows .slot')[0]).getPropertyValue('--k').trim() }));
  check('3.1 quiz hides numerals, colours and legend', hidden.on && hidden.num === 'hidden' && hidden.legend === 'none' && hidden.tint);
  const answers = await page.evaluate(() => chords.map(c => quizAnswer(c)));
  check('3.1 answer key covers all five functions in this chart', ['dia', 'sec', 'tri', 'bor'].every(k => answers.includes(k)), answers.join(','));
  await page.evaluate(() => { sel = chords[1].id; renderAll(); });
  check('3.1 clicking a chord asks "What function is this?" with five choices', await page.evaluate(() => /What function is E7/.test(document.querySelector('.quiz h3').textContent) && document.querySelectorAll('[data-quiz]').length === 5 && getComputedStyle(document.querySelector('#detail .pill')).visibility === 'hidden'));
  await tap(page, '[data-quiz="sec"]');
  const right = await page.evaluate(() => ({ h: document.querySelector('.quiz h3').textContent, p: document.querySelector('.quiz p').textContent, pill: getComputedStyle(document.querySelector('#detail .pill')).visibility, score: JSON.parse(localStorage.getItem('changes-quiz-v1')) }));
  check('3.1 a right answer is confirmed with the 2.1 explanation and the labels come back', /^Right/.test(right.h) && /Secondary dominant \(V7\/vi\)/.test(right.p) && right.pill === 'visible', right.p);
  await page.evaluate(() => { sel = chords[3].id; renderAll(); });
  await tap(page, '[data-quiz="chr"]');
  const wrong = await page.evaluate(() => ({ h: document.querySelector('.quiz h3').textContent, score: JSON.parse(localStorage.getItem('changes-quiz-v1')) }));
  check('3.1 a wrong answer shows the right one', /^Not quite: it’s tritone sub/.test(wrong.h), wrong.h);
  check('3.1 score is tracked in localStorage', wrong.score.correct === 1 && wrong.score.total === 2, JSON.stringify(wrong.score));
  await page.reload();
  check('3.1 score survives a reload', await page.evaluate(() => quizScore.correct === 1 && quizScore.total === 2 && S.quiz));
  await page.uncheck('#quizOn');

  // 3.2 talam / taal grids
  await page.selectOption('#meter', '8/4 adi');
  const adi = await page.evaluate(() => ({ L: barLen(), marks: [...document.querySelectorAll('#rows .bar')[0].querySelectorAll('.ticks i[data-m]')].map(i => i.dataset.m).join(','), note: document.querySelector('#cycleNote').hidden ? '' : document.querySelector('#cycleNote').textContent, tag: document.querySelector('#keytag').textContent, opt: document.querySelector('#meter').selectedOptions[0].textContent }));
  check('3.2 Adi talam grid: 8 beats marked I4 O O', adi.L === 8 && adi.marks === 'I4,O,O', adi.marks);
  check('3.2 cycles are labelled as sketching aids', /sketching aid/.test(adi.note) && /sketching aids/.test(await page.evaluate(() => document.querySelector('#meter optgroup').label)), adi.note.slice(0, 80));
  check('3.2 key line names the cycle', /Adi talam \(4\+2\+2\)/.test(adi.tag), adi.tag);
  const m8 = parseMidi(Buffer.from(await page.evaluate(() => [...buildMidi(false)]))), ts8 = m8.tracks[0].find(e => e.meta === 0x58);
  check('3.2 MIDI export writes the cycle length as the time signature', ts8.data[0] === 8 && 2 ** ts8.data[1] === 4);
  await page.selectOption('#meter', '16/4 teental');
  check('3.2 Teental grid: 16 beats marked X 2 0 3, two bars a row', await page.evaluate(() => barLen() === 16 && [...document.querySelector('#rows .bar').querySelectorAll('[data-m]')].map(i => i.dataset.m).join('') === 'X203' && document.querySelector('#rows .row').querySelectorAll('.bar').length <= 2));
  await page.evaluate(() => { S.drone = true; S.droneMode = 'dorian'; S.tonic = 2; renderAll(); });
  await tap(page, '#gen');
  const dr = await page.evaluate(() => ({ mode: S.mode, pedal: chords.every(c => c.root === S.tonic || c.bass === S.tonic || !famOn('slash')), recipe: document.querySelector('#recipe').textContent, names: chords.map(c => chordName(c)).join(' ') }));
  check('3.2 drone vamp: chosen mode, tonic pedal, explained', dr.mode === 'dorian' && dr.pedal && /Sa–Pa drone/.test(dr.recipe), dr.names);
  await tap(page, '#play'); await page.waitForTimeout(500); await tap(page, '#play');
  await page.evaluate(() => { S.drone = false; S.meter = '4/4'; S.tonic = 0; S.mode = 'ionian'; renderAll(); });

  // 3.3 melody in, chords out
  await page.fill('#melIn', 'E D C D | E E E - | D D D - | E G G - | E D C D | E E E E | D D E D | C - - -');
  await tap(page, '#melGo');
  const mel = await page.evaluate(() => ({ n: MEL.results.length, rows: [...document.querySelectorAll('.mel-row')].map(r => r.querySelector('.mc').textContent + ' :: ' + r.querySelector('.ms').textContent), ratios: MEL.results.map(r => r.hits / r.strong) }));
  check('3.3 suggests 3 to 5 progressions', mel.n >= 3 && mel.n <= 5, mel.rows.join(' || '));
  check('3.3 ranked by strong-beat chord tones', mel.ratios.every((r, i) => i === 0 || r <= mel.ratios[i - 1]) && mel.ratios[0] >= 0.75, mel.ratios.map(r => r.toFixed(2)).join(','));
  check('3.3 a sensible harmonization starts and ends on the tonic', /^C(maj7)? \|.*\| C(maj7|6|add9|6\/9)?$/.test(mel.rows[0].split(' :: ')[0]), mel.rows[0]);
  await tap(page, '[data-mplay="0"]'); await page.waitForTimeout(300); await page.evaluate(() => stopAll());
  // where the chords go: never a silent replace
  const H = () => page.evaluate(() => MEL.results[0].list.map(c => chordName(c)).join(' '));
  const h0 = await H();
  await page.evaluate(() => { chords = parseProg('Am | F | G | E').chords; sel = chords[1].id; renderAll(); });
  check('3.3 the default puts the chords at the end and keeps the chart', await page.evaluate(() => S.melPlace === 'end' && document.querySelector('#melPlace').value === 'end'));
  await tap(page, '[data-muse="0"]');
  const e1 = await page.evaluate(() => ({ names: chords.map(c => chordName(c)).join(' '), br: !!chords[4].br, toast: document.querySelector('#toast').textContent }));
  check('3.3 Add to chart appends after what is there, on a new line, with Undo', e1.names === 'Am F G E ' + h0 && e1.br && /at the end, bars 5–12/.test(e1.toast) && /Undo/.test(e1.toast), JSON.stringify(e1));
  await page.click('#toast button');
  check('3.3 Undo takes it back out', await page.evaluate(() => serialize() === 'Am | F | G | E'));
  await page.evaluate(() => { sel = chords[1].id; renderAll(); }); await page.selectOption('#melPlace', 'before'); await tap(page, '[data-muse="0"]');
  check('3.3 Before the selected chord inserts it there', await page.evaluate(h => chords.map(c => chordName(c)).join(' ') === 'Am ' + h + ' F G E', h0), await page.evaluate(() => chords.map(c => chordName(c)).join(' ')));
  await page.evaluate(() => { chords = parseProg('Am | F | G | E | Am | F | G | E | Dm | E').chords; sel = chords[1].id; renderAll(); }); await page.selectOption('#melPlace', 'over'); await tap(page, '[data-muse="0"]');
  check('3.3 Over the selected chord replaces just that many bars', await page.evaluate(h => chords.map(c => chordName(c)).join(' ') === 'Am ' + h + ' E', h0), await page.evaluate(() => chords.map(c => chordName(c)).join(' ')));
  await page.selectOption('#melPlace', 'all'); await tap(page, '[data-muse="0"]');
  check('3.3 In place of the whole chart replaces it, one chord per bar', await page.evaluate(() => chords.length === 8 && chords.every(c => c.beats === 4)));
  await page.reload(); await page.evaluate(() => revealEl(document.querySelector('#melIn')));
  check('3.3 the placement choice is remembered', await page.evaluate(() => S.melPlace === 'all'));
  await page.evaluate(() => { S.melPlace = 'end'; save(); });
  await page.selectOption('#melRate', '2'); await tap(page, '#melGo');
  check('3.3 two chords per bar works', await page.evaluate(() => MEL.results.length >= 3 && MEL.results[0].list.length === 16));
  await page.fill('#melIn', 'E D X9 C'); await tap(page, '#melGo');
  check('3.3 bad notes get a clear message', /Couldn’t read “X9”/.test(await page.textContent('#melOut')));

  // alternate guitar tunings
  await page.fill('#prog', 'G | C | D | G'); await tap(page, '#load');
  await page.evaluate(() => { sel = chords[0].id; renderAll(); });
  await page.selectOption('#tuneSel', 'openG');
  const og = await page.evaluate(() => ({ t: S.tuning, std: guitarShapes(chords[0]).filter(v => v.common).map(v => v.fr.map(x => x < 0 ? 'x' : x).join('')), badge: !!document.querySelector('#detail .badge.std'), hint: document.querySelector('#detail').textContent.includes('searched for Open G'), strings: [...document.querySelectorAll('#finder .fb .sl')].map(e => e.textContent).join('') }));
  check('tunings: Open G shows x00000 as the standard grip for G', og.t === 'openG' && og.std.includes('x00000') && og.badge && og.hint, og.std.join(' '));
  check('tunings: finder fretboard relabels its strings', og.strings === 'dBGDGD', og.strings);
  const valid = await page.evaluate(() => { let bad = 0; for (const id of Object.keys(TUNINGS)) { setTuning(id); for (const n of ['C', 'G', 'D', 'Am', 'Em', 'F', 'Bb', 'E7', 'Dsus4', 'D5']) { const c = parseChord(n); for (const v of guitarShapes(c)) { const ps = v.fr.map((f, i) => f < 0 ? null : TUNING[i] + f).filter(x => x != null); if (mod(Math.min(...ps)) !== c.root || !ps.every(m => pcsOf(c).includes(mod(m)))) bad++; } } } setTuning('openG'); return bad; });
  check('tunings: every shape in every tuning sounds the chord with its root as the lowest note', valid === 0, String(valid));
  await page.reload();
  check('tunings: the chosen tuning is remembered', await page.evaluate(() => S.tuning === 'openG' && TUNING[0] === 38));
  await page.evaluate(() => { setTuning('standard'); renderAll(); });
  // sound: guitar playback follows the smoothest guitar path, with capo; pins override per chord
  await page.fill('#prog', 'G | Em | C | D'); await tap(page, '#load');
  await page.evaluate(() => { setTuning('standard'); S.capo = 2; renderAll(); });
  await page.selectOption('#instrument', 'guitar');
  const gs = await page.evaluate(() => chords.map(c => { const v = playedVoicing(c), sh = guitarPlan().get(c.id); return { gtr: !!v.gtr, ok: mod(v.bass) === c.root && v.all.every(m => pcsOf(c).includes(mod(m))), match: JSON.stringify(v.all) === JSON.stringify(sh.fr.map((f, i) => f < 0 ? null : TUNING[i] + f + 2).filter(m => m != null).sort((a, b) => a - b)) }; }));
  check('sound: guitar playback uses the smoothest-path shapes at concert pitch with the capo', gs.every(x => x.gtr && x.ok && x.match), JSON.stringify(gs));
  await tap(page, '#play'); await page.waitForTimeout(400); await tap(page, '#play');
  const gm = parseMidi(Buffer.from(await page.evaluate(() => [...buildMidi(false)])));
  const gExpect = await page.evaluate(() => chords.reduce((a, c) => a + playedVoicing(c).all.length, 0));
  check('sound: MIDI export follows the guitar voicings (program 25)', gm.tracks[1].filter(e => e.st === 0x90).length === gExpect && gm.tracks[1].some(e => e.st === 0xc0 && e.d[0] === 25));
  await page.evaluate(() => { S.showVL = true; renderAll(); });
  check('sound: voice-leading picture shows the guitar notes', await page.evaluate(() => { const c = chords[0]; return [...document.querySelectorAll('#vlx svg line title')].filter(t => t.textContent.startsWith(chordName(c) + ':')).length === playedVoicing(c).all.length; }));
  // pin a different guitar shape on the first chord
  await page.evaluate(() => { sel = chords[0].id; renderAll(); });
  const alt = await page.evaluate(() => { const cards = [...document.querySelectorAll('#detail [data-shape]')]; return cards.findIndex(b => !b.classList.contains('ctx')); });
  await page.evaluate(i => document.querySelectorAll('#detail [data-shape]')[i].click(), alt);
  check('sound: clicking a shape selects it with In context and Use for this chord', await page.evaluate(() => !!document.querySelector('#detail .pickbar [data-gctx]') && !!document.querySelector('#detail .pickbar [data-gpin]')));
  await tap(page, '#detail .pickbar [data-gctx]'); await page.waitForTimeout(200);
  await tap(page, '#detail .pickbar [data-gpin]');
  const pin = await page.evaluate(() => ({ pin: chords[0].gpin, plan: guitarPlan().get(chords[0].id).fr, badge: document.querySelector('#detail .shape.ctx .badge')?.textContent }));
  check('sound: pinned shape drives playback and is marked Your pick', pin.pin && JSON.stringify(pin.pin.fr) === JSON.stringify(pin.plan) && /^Your pick · capo 2$/.test(pin.badge), JSON.stringify(pin));
  await page.reload();
  check('sound: pins and sound choice survive a reload', await page.evaluate(() => S.instrument === 'guitar' && gpinOk(chords[0]) && guitarPlan().get(chords[0].id).pinned));
  await page.evaluate(() => { S.capo = 0; sel = chords[0].id; renderAll(); });
  check('sound: a pin for another capo is set aside, with a note', await page.evaluate(() => !guitarPlan().get(chords[0].id).pinned && /pinned shape for Standard/.test(document.querySelector('#detail').textContent)));
  await page.evaluate(() => { S.capo = 2; renderAll(); });
  await tap(page, '#detail .pickbar [data-gunpin]');
  check('sound: unpin returns to the smoothest path', await page.evaluate(() => !chords[0].gpin && !guitarPlan().get(chords[0].id).pinned));
  // piano voicing pin
  await page.selectOption('#instrument', 'piano');
  await page.evaluate(() => { sel = chords[1].id; renderAll(); });
  await page.evaluate(() => document.querySelectorAll('#detail [data-pv]')[3].click());
  await tap(page, '#detail .pickbar [data-pctx]'); await page.waitForTimeout(200);
  await tap(page, '#detail .pickbar [data-ppin]');
  check('sound: pinned piano voicing drives playback', await page.evaluate(() => { const c = chords[1], v = chartPlan().get(c.id); return ppinOk(c) && v.bass === c.ppin.bass && v.rh.join() === c.ppin.rh.join() && /Your pick/.test(document.querySelector('#detail .pv.ctx .ty').textContent); }));
  await page.selectOption('#instrument', 'guitar');
  await page.evaluate(() => { const it = document.querySelector('#subs [data-aud]'); it.click(); document.querySelector('#subs [data-ab]').click(); stopAll(); setTuning('standard'); S.capo = 0; S.instrument = 'piano'; chords.forEach(c => { delete c.gpin; delete c.ppin; }); renderAll(); });
  check('sound: idea auditions and A/B run with guitar sound', page.errors.length === 0, page.errors.join(' | '));
  // resize chords by dragging their right edge
  await page.fill('#prog', 'C | Am | F | G'); await tap(page, '#load');
  await page.evaluate(() => { document.querySelector('#toast').hidden = true; document.querySelector('#rows').scrollIntoView({ block: 'center' }); });
  const geo = async id => page.evaluate(i => { const s = document.querySelectorAll('#rows .slot')[i], h = s.querySelector('.rz').getBoundingClientRect(), row = s.closest('.row'); return { x: h.left + h.width / 2, y: h.top + h.height / 2, beat: row.getBoundingClientRect().width / +row.dataset.rb }; }, id);
  let g = await geo(0);
  await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x + g.beat * 1.1, g.y, { steps: 4 }); await page.mouse.move(g.x + g.beat * 2.1, g.y, { steps: 4 });
  const tip = await page.evaluate(() => document.querySelector('.rztip').textContent); await page.mouse.up();
  const r1 = await page.evaluate(() => ({ beats: chords.map(c => c.beats).join(), text: document.querySelector('#prog').value, rt: parseProg(document.querySelector('#prog').value).chords.map(c => c.beats).join() }));
  check('resize: dragging the right edge lengthens the chord by whole beats', r1.beats === '6,4,4,4' && /C: 6 beats/.test(tip), `${r1.beats}; tip "${tip}"`);
  check('resize: the text box is rewritten and reads back the same lengths', r1.rt === r1.beats, r1.text.replace(/\n/g, ' / '));
  g = await geo(1);
  await page.keyboard.down('Shift'); await page.mouse.move(g.x, g.y); await page.mouse.down(); await page.mouse.move(g.x - g.beat * 1.1, g.y, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Shift');
  const r2 = await page.evaluate(() => chords.map(c => c.beats).join());
  check('resize: Shift trades beats with the next chord so later chords stay put', r2 === '6,3,5,4', r2);
  await page.evaluate(() => { undo(); });
  check('resize: each drag is one undo step', await page.evaluate(() => chords.map(c => c.beats).join() === '6,4,4,4'));
  await page.evaluate(() => { undo(); });
  check('resize: undo returns to the original lengths', await page.evaluate(() => chords.map(c => c.beats).join() === '4,4,4,4'));
  const mid = await page.evaluate(() => { const r = document.querySelectorAll('#rows .slot')[0].getBoundingClientRect(), t = document.querySelectorAll('#rows .slot')[2].getBoundingClientRect(); return { x: r.left + r.width / 3, y: r.top + r.height / 2, tx: t.left + t.width * .75, ty: t.top + t.height / 2 }; });
  await page.mouse.move(mid.x, mid.y); await page.mouse.down(); await page.mouse.move(mid.tx, mid.ty, { steps: 6 }); await page.mouse.up();
  check('resize: dragging the middle of a chord still reorders', await page.evaluate(() => chords.map(c => chordName(c)).join(' ') === 'Am F C G'));
  // in-chart picker and the + Add chord tile
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; S.vocab = [...PRESETS.Color]; });
  await page.fill('#prog', '[Verse]\nC | Am | F | G'); await tap(page, '#load');
  await page.evaluate(() => { chords[0].lock = true; renderAll(); document.querySelector('#rows').scrollIntoView({ block: 'center' }); });
  check('picker: the chart ends with a + Add chord tile', await page.evaluate(() => /Add chord/.test(document.querySelector('#rows .addtile')?.textContent || '')));
  await tap(page, '#rows .addtile');
  const added = await page.evaluate(() => ({ n: chords.length, last: chords[chords.length - 1], open: !document.querySelector('#cpick').hidden, text: document.querySelector('#prog').value }));
  check('picker: + Add chord appends a blank bar and opens the picker on it', added.n === 5 && added.last.root === null && added.last.beats === 4 && added.open && /\?/.test(added.text), added.text.replace(/\n/g, ' / '));
  await page.click('#cpick [data-cpq] >> text=Dm');
  const chipped = await page.evaluate(() => ({ name: chordName(chords[4]), closed: document.querySelector('#cpick').hidden, text: document.querySelector('#prog').value }));
  check('picker: a chip applies straight away and closes the picker', /^Dm/.test(chipped.name) && chipped.closed && chipped.text.includes(chipped.name.replace('♭', 'b')), `${chipped.name}; ${chipped.text.replace(/\n/g, ' / ')}`);
  await page.click('#rows .slot >> nth=0 >> .cpk');
  check('picker: the ▾ on a chord opens its picker', await page.evaluate(() => cpFor === chords[0].id && !document.querySelector('#cpick').hidden));
  await page.selectOption('#cpRoot', '2'); await page.selectOption('#cpQual', '7'); await page.selectOption('#cpBass', '6');
  check('picker: the header previews the chord being built', (await page.textContent('#cpName')) === 'D7/F♯');
  await page.click('#cpick [data-cpapply]');
  const applied = await page.evaluate(() => ({ c: chords[0], name: chordName(chords[0]), text: document.querySelector('#prog').value }));
  check('picker: Apply sets the chord and keeps its length, section and lock', applied.name === 'D7/F♯' && applied.c.beats === 4 && applied.c.sec === 'Verse' && applied.c.lock && applied.text.startsWith('[Verse]\nD7/F#'), applied.text.replace(/\n/g, ' / '));
  await page.evaluate(() => { sel = chords[1].id; renderAll(); document.querySelector('#rows .slot.sel').focus(); });
  await page.keyboard.press('e');
  check('picker: E opens the picker for the selected chord', await page.evaluate(() => cpFor === chords[1].id));
  await page.keyboard.press('Escape');
  check('picker: Escape closes it', await page.evaluate(() => document.querySelector('#cpick').hidden));
  await page.dblclick('#rows .slot >> nth=2 >> .cn');
  check('picker: double-clicking a chord opens its picker', await page.evaluate(() => cpFor === chords[2].id));
  await page.click('#cpick [data-cpblank]');
  check('picker: Make blank turns the chord into a ? slot', await page.evaluate(() => !real(chords[2]) && /\| \? \|/.test(document.querySelector('#prog').value)));
  await page.click('#rows .slot >> nth=1 >> .cpk'); await page.mouse.click(5, 5);
  check('picker: clicking elsewhere closes it', await page.evaluate(() => document.querySelector('#cpick').hidden));
  await page.evaluate(() => { undo(); undo(); undo(); undo(); });
  check('picker: every pick is one undo step', await page.evaluate(() => document.querySelector('#prog').value === '[Verse]\nC | Am | F | G'), await page.evaluate(() => document.querySelector('#prog').value.replace(/\n/g, ' / ')));
  // genre chords, separate from Chords allowed
  await page.evaluate(() => { S.tonic = 7; S.mode = 'ionian'; S.mood = ''; S.genres = ['blues']; S.genreVocab = false; S.vocab = [...PRESETS.Simple]; S.lock = false; renderAll(); });
  const gc = await page.evaluate(() => ({ shown: !document.querySelector('#genreChords').hidden, row: document.querySelector('#genreChords .gc-row b')?.textContent, chips: [...document.querySelectorAll('#genreChords [data-gchord]')].map(b => b.firstChild.textContent + (b.classList.contains('off') ? '(off)' : '')), title: document.querySelector('.vocabp h2').textContent }));
  check('genre chords: Blues shows its own chords in the key, greyed where Chords allowed excludes them', gc.shown && gc.row === 'Blues' && gc.chips.some(c => /^G7.*\(off\)$/.test(c)), gc.chips.join(' '));
  check('genre chords: the limits panel is now called Chords allowed', gc.title === 'Chords allowed');
  await page.evaluate(() => document.querySelector('#genreChords [data-gchord]').click());
  const gen = async () => page.evaluate(() => { let sev = 0, n = 0; for (let k = 0; k < 20; k++) { generate(); chords.forEach(c => { if (real(c)) { n++; if (Q[c.q].iv.length > 3) sev++; } }); } return sev / n; });
  const off = await gen();
  await page.check('#genreVocab');
  const on = await gen();
  check('genre chords: off keeps Blues within Chords allowed; on lets Blues use its 7ths', off === 0 && on > 0.5 && /genre chooses the chords/.test(await page.textContent('#recipe')), `7th-or-richer share: off ${off.toFixed(2)}, on ${on.toFixed(2)}`);
  await page.evaluate(() => { S.genreVocab = false; S.genres = []; S.vocab = [...PRESETS.Color]; S.tonic = 0; renderAll(); });
  // playing styles: the picker follows the instrument; MIDI export writes the pattern on the grid
  await page.fill('#prog', 'G | C | D | G'); await tap(page, '#load');
  await page.evaluate(() => { S.meter = '4/4'; S.instrument = 'piano'; S.pstyle = 'block'; S.gstyle = 'strum1'; S.capo = 0; setTuning('standard'); renderAll(); });
  const pOpts = await page.evaluate(() => [...document.querySelectorAll('#pstyle option')].map(o => o.value).join());
  await page.selectOption('#instrument', 'guitar');
  const gOpts = await page.evaluate(() => [...document.querySelectorAll('#pstyle option')].map(o => o.value).join());
  check('styles: the style picker offers piano and guitar styles to match the sound', pOpts === 'block,ballad,pulse,arp,stride,evans' && gOpts === 'strum1,strum,pick', `${pOpts} / ${gOpts}`);
  await page.selectOption('#pstyle', 'strum');
  const sm = parseMidi(Buffer.from(await page.evaluate(() => [...buildMidi(false)]))), onsTicks = [...new Set(sm.tracks[1].filter(e => e.st === 0x90).map(e => e.tick % (480 * 4)))].sort((a, b) => a - b);
  check('styles: guitar strum pattern exports D DU UDU on the eighth-note grid', JSON.stringify(onsTicks) === JSON.stringify([0, 480, 720, 1200, 1440, 1680]), onsTicks.join(','));
  await page.selectOption('#instrument', 'piano'); await page.selectOption('#pstyle', 'arp');
  const am = parseMidi(Buffer.from(await page.evaluate(() => [...buildMidi(true)])));
  const arpOK = am.tracks[2].filter(e => e.st === 0x90).length === 4 && am.tracks[1].filter(e => e.st === 0x90).length === 4 * 8;
  check('styles: piano arpeggio exports one bass note per chord and eight broken-chord notes per bar', arpOK, `${am.tracks[2].filter(e => e.st === 0x90).length} bass, ${am.tracks[1].filter(e => e.st === 0x90).length} treble`);
  await tap(page, '#play'); await page.waitForTimeout(500); await tap(page, '#play');
  check('styles: the chosen style is remembered', await page.evaluate(() => { save(); return JSON.parse(localStorage.getItem('changes-v1')).S.pstyle === 'arp' && S.gstyle === 'strum'; }));
  await page.evaluate(() => { S.pstyle = 'block'; S.gstyle = 'strum1'; S.instrument = 'piano'; renderAll(); });
  // restyle an existing chart in a genre's style; clear the chart
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; S.genres = ['blues']; S.genreVocab = true; S.vocab = [...PRESETS.Simple]; renderAll(); });
  await page.fill('#prog', 'C | Am | F | G'); await tap(page, '#load');
  await page.evaluate(() => { chords[1].lock = true; renderAll(); });
  const before3 = await page.evaluate(() => chords.map(c => chordName(c)).join(' '));
  await tap(page, '#genreChords [data-restyle]');
  const rs = await page.evaluate(() => ({ names: chords.map(c => chordName(c)), roots: chords.map(c => c.root).join(), sevenths: chords.filter((c, i) => i !== 1 && Q[c.q].iv.length > 3).length, toast: document.querySelector('#toast').textContent }));
  check('restyle: Blues turns the unlocked chords into 7th chords on the same roots and keeps the locked one', rs.roots === '0,9,5,7' && rs.sevenths === 3 && rs.names[1] === 'Am' && /Restyled 3 chords in the Blues style/.test(rs.toast), `${before3} → ${rs.names.join(' ')}`);
  await page.evaluate(() => undo());
  check('restyle: one undo step restores the chart', await page.evaluate(b => chords.map(c => chordName(c)).join(' ') === b, before3));
  await page.evaluate(() => { S.genres = []; S.genreVocab = false; S.vocab = [...PRESETS.Color]; renderAll(); });
  await tap(page, '#clearChart');
  const cl = await page.evaluate(() => ({ n: chords.length, tile: !!document.querySelector('#rows .addtile'), text: serialize() }));
  await page.evaluate(() => document.querySelector('#toast').hidden = true);
  await page.click('#play'); await page.waitForTimeout(300);
  const cp = await page.evaluate(() => ({ playing, toast: document.querySelector('#toast').textContent, xml: !new DOMParser().parseFromString(buildMusicXML(), 'application/xml').querySelector('parsererror') }));
  check('clear: Clear chart empties it and leaves + Add chord', cl.n === 0 && cl.tile && cl.text === '', JSON.stringify(cl));
  check('clear: Play on an empty chart explains instead of looping, and exports still work', !cp.playing && /Add a chord to play/.test(cp.toast) && cp.xml, JSON.stringify(cp));
  await page.evaluate(() => undo());
  check('clear: Undo brings the chart back', await page.evaluate(b => chords.map(c => chordName(c)).join(' ') === b, before3));
  // swap ideas stack their buttons under the text in the sidebar
  await page.evaluate(() => { sel = chords[0].id; renderAll(); revealEl(document.querySelector('#subs')); });
  const sw2 = await page.evaluate(() => { const it = document.querySelector('#subs .item'), why = it.querySelector('.why').getBoundingClientRect(), btn = it.querySelector('.btns').getBoundingClientRect(), box = it.getBoundingClientRect(); return { whyWidth: Math.round(why.width / box.width * 100), below: btn.top >= why.bottom - 1 }; });
  check('layout: swap ideas give the text the full width with buttons underneath', sw2.whyWidth > 85 && sw2.below, JSON.stringify(sw2));
  // easiest tuning for the chart: musically expected answers
  const expect = [['G | C | D | G', /^Standard tuning is the practical choice/], ['G | Am | C | D | Em', /^Standard tuning is the practical choice/],
    ['F | B♭ | E♭ | Cm', /^Standard tuning with a capo on \d/], ['Dsus4 | Gsus2 | Asus4 | Dsus4', /^DADGAD is the easiest/], ['D5 | C5 | G5 | A5 | F5', /^Drop [CD]/]];
  for (const [chart, re] of expect) {
    await page.fill('#prog', chart); await tap(page, '#load');
    await page.evaluate(() => { S.capo = 0; setTuning('standard'); sel = chords[0].id; renderAll(); });
    await tap(page, '[data-tunefind]'); await page.waitForSelector('#detail .tunes', { timeout: 15000 });
    const lead = await page.textContent('#detail .tunes p');
    check(`easiest tuning: ${chart}`, re.test(lead), lead);
  }
  await tap(page, '#detail .tunes [data-usetune]');
  check('easiest tuning: Use this switches tuning and capo', await page.evaluate(() => { const b = document.querySelector('#detail .tunes li .hint:last-child'); return S.tuning !== 'standard' || S.capo > 0 || !!b; }));
  await page.evaluate(() => { setTuning('standard'); S.capo = 0; renderAll(); });
  // export + reload with the new state
  const dlP = page.waitForEvent('download'); await tap(page, '#midiExport'); await dlP;
  const keep = await page.evaluate(() => serialize()); await page.reload();
  check('3.x reload after phase 3 features restores the chart', await page.evaluate(k => serialize() === k, keep));
  check('no console errors (phase 3)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// editing: one full app for everyone, deleting chords, Harmonize under Create, gapless looping
async function editing() {
  const { ctx, page } = await openPage({ noReveal: true });
  await page.goto(URL_);
  const v0 = await page.evaluate(() => ({ toggle: !!document.querySelector('.viewtoggle'), quick: !!document.querySelector('#quick'), simple: document.body.classList.contains('simple') }));
  check('editing: a first visit opens the full app, with no Simple/Advanced switch', !v0.toggle && !v0.quick && !v0.simple, JSON.stringify(v0));
  await page.evaluate(() => revealEl(document.querySelector('#gen')));
  const before = await page.evaluate(() => serialize());
  await tap(page, '#gen'); await page.waitForTimeout(200);
  check('editing: Generate makes a progression and plays it', await page.evaluate(b => serialize() !== b && playing, before));
  await page.evaluate(() => stopAll());

  await page.evaluate(() => { chords = parseProg('C | F | G | Am').chords; sel = chords[1].id; renderAll(); document.querySelector(`#rows .slot[data-id="${sel}"]`).focus(); });
  await page.keyboard.press('Delete');
  const d1 = await page.evaluate(() => ({ text: serialize(), sel: chordName(chords.find(c => c.id === sel)), toast: document.querySelector('#toast').textContent }));
  check('editing: Delete removes the selected chord and selects the next one', d1.text === 'C | G | Am' && d1.sel === 'G' && /Deleted F/.test(d1.toast), JSON.stringify(d1));
  await page.keyboard.press('Backspace');
  check('editing: Backspace removes it too', await page.evaluate(() => serialize() === 'C | Am'));
  await page.click('#toast button');
  check('editing: Undo in the toast brings the chord back', await page.evaluate(() => serialize() === 'C | G | Am'));
  await page.evaluate(() => { const i = document.querySelector('#libName'); revealEl(i); i.focus(); });
  await page.keyboard.press('Backspace');
  check('editing: Backspace while typing in a box leaves the chart alone', await page.evaluate(() => serialize() === 'C | G | Am'));
  await page.evaluate(() => { document.querySelector('#library').open = false; openPicker(chords[0].id); });
  await page.click('#cpick [data-cpdel]');
  check('editing: the in-chart picker has a Delete button', await page.evaluate(() => serialize() === 'G | Am' && document.querySelector('#cpick').hidden));

  const h = await page.evaluate(() => { const t = document.querySelector('#tab-melody'); return { inCreate: !!t.closest('#sideLeft'), tools: [...document.querySelectorAll('#tools [role=tab]')].map(b => b.textContent).join('/') }; });
  check('editing: Harmonize is a Create tab, beside Generate and Key and limits', h.inCreate && h.tools === 'Chord finder/Keys and modes', JSON.stringify(h));
  await page.evaluate(() => revealEl(document.querySelector('#melIn')));
  await page.click('#melody [data-goto="setkey"]');
  check('editing: Harmonize links to the Chords allowed it follows', await page.evaluate(() => document.querySelector('#presets').checkVisibility()));
  // key, mode and time open from the key line under the chart title; tempo lives only in the Play bar
  await page.click('#keyMenu summary');
  check('editing: the key line under Chart opens key, mode and time', await page.evaluate(() => document.querySelector('#keyMenu').open && document.querySelector('#key').checkVisibility() && document.querySelector('#meter').checkVisibility()));
  await page.selectOption('#key', '2');
  check('editing: changing the key there updates the key line', await page.evaluate(() => /^D /.test(document.querySelector('#keytag').textContent)), await page.evaluate(() => document.querySelector('#keytag').textContent + ' ' + S.tonic + ' ' + document.querySelector('#key').value));
  await page.click('#chartTitle');
  check('editing: clicking elsewhere closes it', await page.evaluate(() => !document.querySelector('#keyMenu').open));
  await page.fill('#tempo', '132'); await page.press('#tempo', 'Enter'); await page.click('#tempoUp');
  check('editing: tempo has one control, in the Play bar, typed or nudged', await page.evaluate(() => document.querySelectorAll('input#tempo,#tempoShow').length === 1 && !!document.querySelector('.dock #tempo') && S.tempo === 136 && document.querySelector('#tempo').value === '136'), await page.evaluate(() => S.tempo));

  // a loop pass starts exactly where the last one ended on the audio clock, without a new session cutting the tails
  await page.evaluate(() => { S.tempo = 240; S.meter = '4/4'; S.loop = true; S.gstyle = 'pick'; S.instrument = 'guitar'; chords = parseProg('C | G').chords; renderAll();
    window.__passes = []; const orig = playPass; window.playPass = (t, out) => { __passes.push({ t, out }); return orig(t, out); }; playChart(); });
  await page.waitForTimeout(2600);
  const lp = await page.evaluate(() => { stopAll(); const p = __passes; return { n: p.length, gap: p.length > 1 ? +(p[1].t - p[0].t).toFixed(6) : null, same: p.length > 1 && p[0].out === p[1].out }; });
  check('editing: looping is gapless: the next pass starts on the exact end time, in the same session', lp.n >= 2 && lp.gap === 2 && lp.same, JSON.stringify(lp));
  check('no console errors (editing)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// key changes: per-bar key and mode changes, read from text, analysed locally, kept through edits and exports
async function keyChanges() {
  const { ctx, page } = await openPage();
  await page.goto(URL_); await page.evaluate(() => { stopAll(); S.tonic = 0; S.mode = 'ionian'; renderAll(); });
  await page.fill('#prog', 'C | F | G | C\n[Bridge]\n[Key: D major]\nD | G | A | D'); await tap(page, '#load');
  const a = await page.evaluate(() => ({ kc: chords[4].kc, home: [S.tonic, S.mode], nums: chords.map(c => analyze(c).num).join(' '), kinds: chords.map(c => analyze(c).kind).join(' '), tag: document.querySelector('#keytag').textContent, label: document.querySelector('#rows .sec-label')?.textContent, text: serialize() }));
  check('keys: [Key: D major] starts a key change at that bar', a.kc && a.kc.t === 2 && a.kc.m === 'ionian' && a.home.join() === '0,ionian', JSON.stringify(a));
  check('keys: chords after the change are analysed in the new key', a.nums === 'I IV V I I IV V I' && a.kinds.split(' ').every(k => k === 'dia'), a.nums + ' / ' + a.kinds);
  check('keys: the key line and the chart label show the change', /^C major → D major/.test(a.tag) && /Bridge\s*Key: D major/.test(a.label), a.tag + ' / ' + a.label);
  check('keys: the text form round-trips', a.text === 'C | F | G | C\n[Bridge]\n[Key: D major]\nD | G | A | D', JSON.stringify(a.text));
  const sp = await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; chords = parseProg('C | G\n[Key: Eb major]\nEb | Ab | Bb7 | Cm\n[Key: E Dorian]\nEm | A | D#m7b5').chords; renderAll(); return { names: chords.map(c => chordName(c)).join(' '), nums: chords.map(c => analyze(c).num).join(' '), modes: chords.filter(c => c.kc).map(c => c.kc.m).join() }; });
  check('keys: names are spelled and numbered in their own key, and a key can change mode', sp.names === 'C G E♭ A♭ B♭7 Cm Em A D♯m7♭5' && sp.nums.startsWith('I V I IV V7 vi i IV ') && sp.modes === 'ionian,dorian', JSON.stringify(sp));
  await page.fill('#prog', '[Key: A minor]\nAm | Dm | E7 | Am'); await tap(page, '#load');
  check('keys: a key marker at the top sets the opening key', await page.evaluate(() => S.tonic === 9 && S.mode === 'aeolian' && !chords[0].kc && analyze(chords[1]).num === 'iv'));
  await page.fill('#prog', 'C | F\n[Key: H major]\nG | C'); await tap(page, '#load');
  check('keys: an unreadable key name is reported', await page.evaluate(() => /H major/.test(document.querySelector('#err').textContent) && !document.querySelector('#err').hidden));

  // the Chord panel sets and clears a key change; the swap ideas then speak in the new key
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; chords = parseProg('C | F | G | C | F | G').chords; sel = chords[3].id; renderAll(); });
  await page.selectOption('#kcT', '7');
  const k1 = await page.evaluate(() => ({ kc: chords[3].kc, tag: document.querySelector('#keytag').textContent, num: analyze(chords[3]).num, dnum: document.querySelector('#detail .dnum').textContent, hint: document.querySelector('#detail .keychg .hint').textContent }));
  check('keys: the Chord panel sets a key change on a bar', k1.kc && k1.kc.t === 7 && k1.kc.m === 'ionian' && /C major → G major/.test(k1.tag) && k1.num === 'IV' && k1.dnum === 'IV' && /dominant/.test(k1.hint), JSON.stringify(k1));
  await page.selectOption('#kcM', 'mixolydian');
  check('keys: and its mode', await page.evaluate(() => chords[3].kc.m === 'mixolydian' && /G Mixolydian/.test(document.querySelector('#keytag').textContent)));
  await page.evaluate(() => { sel = chords[1].id; renderAll(); });
  check('keys: a chord that starts mid-bar offers no key change', await page.evaluate(() => { chords[1].beats = 2; sel = chords[2].id; renderAll(); return !document.querySelector('#kcT'); }));
  await page.evaluate(() => { chords[1].beats = 4; sel = chords[3].id; renderAll(); });
  await page.selectOption('#kcT', '');
  check('keys: choosing No change removes it', await page.evaluate(() => !chords[3].kc && /^C major ·/.test(document.querySelector('#keytag').textContent)));

  // edits, exports and storage keep it
  await page.evaluate(() => { chords = parseProg('C | F\n[Key: D major]\nD | G').chords; renderAll(); });
  const t = await page.evaluate(() => { transpose(2); return { home: S.tonic, kc: chords[2].kc.t, names: chords.map(c => chordName(c)).join(' ') }; });
  check('keys: transposing moves the key changes too', t.home === 2 && t.kc === 4 && t.names === 'D G E A', JSON.stringify(t));
  const x = await page.evaluate(() => { const xml = buildMusicXML(); return [...xml.matchAll(/<fifths>(-?\d+)<\/fifths>/g)].map(m => m[1]).join(); });
  check('keys: MusicXML gets a new key signature at the change', x === '2,4', x);
  const sv = await page.evaluate(() => { const lib = sanitizeChords(JSON.parse(JSON.stringify(chords))); const code = shareCode(); applyShare(JSON.parse(atob(code.replace(/-/g, '+').replace(/_/g, '/')))); return { lib: lib && lib[2].kc && lib[2].kc.t, share: chords[2].kc && chords[2].kc.t, sheet: /Key: E major/.test(leadSheetHTML()) }; });
  check('keys: library items, share links and the lead sheet keep key changes', sv.lib === 4 && sv.share === 4 && sv.sheet, JSON.stringify(sv));
  await page.evaluate(() => { sel = chords[2].id; renderAll(); document.querySelector(`#rows .slot[data-id="${sel}"]`).focus(); });
  await page.keyboard.press('Delete');
  check('keys: deleting the chord that changes key hands the change to the next chord', await page.evaluate(() => chords.length === 3 && chords[2].kc && chords[2].kc.t === 4));
  await page.evaluate(() => { chords = parseProg('C | F | G | C\n[Key: D major]\nD | G | A | D').chords; renderAll(); regenUnlocked(); });
  const rg = await page.evaluate(() => ({ kc: chords[4].kc && chords[4].kc.t, inKey: chords.slice(4).filter(c => ['dia', 'bor', 'sec'].includes(analyze(c).kind)).length }));
  check('keys: Regenerate unlocked keeps the key change and writes the new chords in that key', rg.kc === 2 && rg.inKey >= 3, JSON.stringify(rg));
  check('keys: S keeps the opening key after all that', await page.evaluate(() => S.tonic === 2 && keyStack.length === 0));
  check('no console errors (key changes)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// notation: chord symbol styles and what the chart shows, on screen and in exports; Help → About
async function notation() {
  const { ctx, page } = await openPage();
  await page.goto(URL_);
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; chords = parseProg('Cmaj7 | Dm7 | Bm7b5 | Bdim | Caug | G7#5 | Am(maj7)').chords; renderAll(); });
  const names = await page.evaluate(() => { const o = {}; for (const st of ['classic', 'written', 'jazz']) { S.sym = st; o[st] = chords.map(c => chordName(c)).join(' '); } S.sym = 'classic'; return o; });
  check('notation: three chord symbol styles', names.classic === 'Cmaj7 Dm7 Bm7♭5 B° C+ G7♯5 Am(maj7)' && names.written === 'Cmaj7 Dm7 Bm7♭5 Bdim Caug G7♯5 Am(maj7)' && names.jazz === 'CΔ7 D−7 Bø7 B° C+ G+7 A−Δ7', JSON.stringify(names));
  check('notation: every chord type in every style reads back from text', await page.evaluate(() => { const bad = []; for (const st of ['classic', 'written', 'jazz']) { S.sym = st; for (const q of Object.keys(Q)) { const n = chordName({ root: 0, q, bass: null }, 'sym'); const r = parseChord(n); if (!r || r.q !== q) bad.push(st + ':' + n); } } S.sym = 'classic'; return bad.length === 0 || bad.join(' '); }) === true);
  await page.selectOption('#symStyle', 'jazz');
  const j = await page.evaluate(() => ({ chart: document.querySelector('#rows .slot .cn').textContent, text: serialize(), xml: /<kind text="Δ7" use-symbols="yes">major-seventh<\/kind>/.test(buildMusicXML()), sheet: /CΔ7/.test(leadSheetHTML()) }));
  check('notation: Jazz symbols show in the chart, lead sheet and MusicXML; the text editor keeps the standard spelling', j.chart.startsWith('CΔ7') && j.text.startsWith('Cmaj7 |') && j.xml && j.sheet, JSON.stringify(j));
  await page.evaluate(() => { navigator.clipboard.writeText = async t => { window.__copied = t; }; });
  await tap(page, '#copy');
  check('notation: Copy chart uses the chosen symbols', await page.evaluate(() => /\| CΔ7 \| D−7 \| Bø7/.test(window.__copied || '')), await page.evaluate(() => window.__copied));
  await page.selectOption('#labelMode', 'numerals');
  const n = await page.evaluate(() => { const s = document.querySelector('#rows .slot'); return { big: s.querySelector('.cn').textContent, small: s.querySelector('.cr')?.textContent, xml: (buildMusicXML().match(/<words>[^<]*<\/words>/g) || []).slice(0, 2).join(), sheet: /Imaj7/.test(leadSheetHTML()) }; });
  check('notation: Roman numerals only puts numerals first in the chart, the lead sheet and under the MusicXML staff', n.big.startsWith('Imaj7') && n.small === 'CΔ7' && n.xml === '<words>Imaj7</words>,<words>ii7</words>' && n.sheet, JSON.stringify(n));
  await page.selectOption('#labelMode', 'names');
  check('notation: Chord names only hides the numerals', await page.evaluate(() => !document.querySelector('#rows .slot .cr') && !/<words>/.test(buildMusicXML())));
  await page.reload();
  check('notation: the choices are remembered', await page.evaluate(() => S.sym === 'jazz' && S.labels === 'names' && document.querySelector('#symStyle').value === 'jazz' && document.querySelector('#labelMode').value === 'names'));
  const about = await page.evaluate(() => [...document.querySelectorAll('#helpMenu .help-about a')].map(a => a.href + (a.target === '_blank' ? ' new tab' : '')));
  check('help: About links to the project, its author and the licence on GitHub', about.join() === 'https://github.com/ssk0011/chord-progression-generator new tab,https://github.com/ssk0011 new tab,https://github.com/ssk0011/chord-progression-generator/blob/main/LICENSE new tab', about.join());
  check('no console errors (notation)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// polish: names fit their slots, a clear picker arrow, the metronome in the Play bar, tension framed as a map,
// bigger diagrams with a Zoom switch and a visible capo, and a side panel you can drag wider
async function polish() {
  const LONG = 'Bbm9 | Dbmaj7#11:2 Dbm7:1 Dbm:1 | Abadd9:8\nC#m7b5:1 Ebmaj13:1 F#13#11:1 Gm(maj9):1 | ?:1 G:1 Bbm7(add11):2 | C7sus4 | ?';
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [1100, 800, 'laptop'], [390, 844, 'phone']]) {
    const { ctx, page } = await openPage({ viewport: { width: w, height: h } });
    await page.goto(URL_);
    const r = await page.evaluate(t => { S.tonic = 10; S.mode = 'ionian'; chords = parseProg(t).chords; if (innerWidth < 760) selectTab('phone', 'p-chart'); renderAll();
      return [...document.querySelectorAll('#rows .slot:not(.tie)')].map(s => { const sr = s.getBoundingClientRect(), right = Math.max(...[...s.querySelectorAll('.nr,.nq,.cpk')].filter(e => e.offsetWidth).map(e => e.getBoundingClientRect().right)); return { t: s.querySelector('.cn').textContent.trim(), over: Math.round(right - (sr.right - 8)) }; }).filter(x => x.over > 0); }, LONG);
    check(`polish: every chord name fits its slot (${tag})`, r.length === 0, JSON.stringify(r));
    await ctx.close();
  }
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL_);
  const a = await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; chords = parseProg('C | ? | G | C').chords; renderAll(); const k = document.querySelector('#rows .slot .cpk').getBoundingClientRect(), e = document.querySelector('#rows .slot.empty .cpk'); return { w: k.width, h: k.height, pick: getComputedStyle(e, '::after').content }; });
  check('polish: the picker arrow is a 24px button, and an empty slot says Pick', a.w >= 24 && a.h >= 24 && a.pick === '"Pick"', JSON.stringify(a));
  await page.click('#click');
  check('polish: the metronome is a toggle in the Play bar', await page.evaluate(() => S.click && !!document.querySelector('.dock #click[aria-pressed="true"]') && !document.querySelector('#chartTools #click')));
  await page.click('#click');
  check('polish: the tension curve says higher is not better', await page.evaluate(() => /not better/.test(document.querySelector('#tension .tl').title) && /map, not a score/.test(document.querySelector('#tension .tl').textContent)));
  await page.evaluate(() => { S.instrument = 'guitar'; S.capo = 3; sel = chords[0].id; renderAll(); selectTab('right', 'chord'); });
  const g = await page.evaluate(() => ({ capo: /CAPO 3/.test(document.querySelector('#detail .shape svg').outerHTML), badge: document.querySelector('#detail .shape .badge')?.textContent, w: document.querySelector('#detail .shape svg').getBoundingClientRect().width }));
  check('polish: chord boxes show the capo, and the smoothest-path badge names it', g.capo && /Smoothest path · capo 3/.test(g.badge) && g.w >= 118, JSON.stringify(g));
  await page.click('#detail [data-zoom]');
  const z = await page.evaluate(() => ({ on: document.body.classList.contains('zoomdiag'), w: document.querySelector('#detail .shape svg').getBoundingClientRect().width }));
  check('polish: Zoom makes the diagrams about twice the size', z.on && z.w >= 200, JSON.stringify(z));
  await page.reload();
  check('polish: Zoom is remembered', await page.evaluate(() => document.body.classList.contains('zoomdiag')));
  await page.evaluate(() => { document.body.classList.remove('zoomdiag'); try { localStorage.removeItem('changes-zoom-v1'); } catch (e) {} });
  // drag the side panel's edge
  const sw = () => page.evaluate(() => Math.round(document.querySelector('#sideRight').getBoundingClientRect().width));
  const w0 = await sw(), box = await page.locator('#sizer').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x - 150, box.y + 200, { steps: 6 }); await page.mouse.up();
  const w1 = await sw();
  check('polish: dragging the side panel edge makes it wider', w1 >= w0 + 140 && w1 <= w0 + 160, `${w0} → ${w1}`);
  await page.focus('#sizer'); await page.keyboard.press('ArrowRight');
  check('polish: the arrow keys nudge it', await sw() === w1 - 16, String(await sw()));
  await page.reload();
  check('polish: the width is remembered', await sw() === w1 - 16, String(await sw()));
  await page.mouse.move(box.x + box.width / 2, box.y + 200); await page.mouse.down(); await page.mouse.move(100, box.y + 200, { steps: 4 }); await page.mouse.up();
  const lim = await page.evaluate(() => ({ chart: document.querySelector('.chart-card').getBoundingClientRect().width, h: document.documentElement.scrollWidth <= innerWidth }));
  check('polish: it stops while the chart still has room, with no sideways scroll', lim.chart >= 400 && lim.h, JSON.stringify(lim));
  await page.dblclick('#sizer');
  check('polish: double-click resets it', await sw() === w0, String(await sw()));
  await page.setViewportSize({ width: 390, height: 844 });
  check('polish: no resize handle on a phone', await page.evaluate(() => !document.querySelector('#sizer').checkVisibility()));
  check('no console errors (polish)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// with 9ths allowed, 7ths stay common: allowed is a ceiling, not a target
async function ceilings() {
  const { ctx, page } = await openPage();
  await page.goto(URL_);
  const g = await page.evaluate(() => { S.vocab = FAMS.map(f => f.id); S.genres = []; S.tonic = 0; S.mode = 'ionian'; const n = {}; for (let k = 0; k < 200; k++) { S.mood = MOODS[k % MOODS.length].id; generate(); chords.forEach(c => { if (real(c)) n[c.q] = (n[c.q] || 0) + 1; }); } return { maj7: n.maj7 || 0, maj9: n.maj9 || 0, m7: n.m7 || 0, m9: n.m9 || 0 }; });
  check('ceilings: Generate with Everything allowed uses maj7 and m7 about as often as maj9 and m9', g.maj7 > 0.3 * (g.maj7 + g.maj9) && g.m7 > 0.25 * (g.m7 + g.m9), JSON.stringify(g));
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; chords = parseProg('C | Am | F | G').chords; sel = chords[2].id; renderAll(); openPicker(chords[2].id); });
  const pk = await page.evaluate(() => [...document.querySelectorAll('#cpick .cp-row')].map(r => r.getAttribute('aria-label') + ':' + [...r.querySelectorAll('.chip')].map(c => c.firstChild.textContent).join(',')));
  check('ceilings: the picker shows the key’s 7ths and its 9ths in separate rows', pk.some(r => /^Sevenths:.*Fmaj7/.test(r)) && pk.some(r => /^Ninths and beyond:.*Fmaj9/.test(r) && !/m7♭5/.test(r)), pk.join(' | '));
  await page.evaluate(() => closePicker());
  check('ceilings: swap ideas offer 7th chords from the key, not only 9ths', await page.evaluate(() => suggestions(2).groups.flatMap(g => g.items).some(it => it.chords.length === 1 && ['maj7', 'm7', '7'].includes(it.chords[0].q))));
  check('ceilings: Apply chords allowed still takes the richest', await page.evaluate(() => { chords = parseProg('C | Am | F | G').chords; renderAll(); document.querySelector('#recolor').click(); return chords.every(c => Q[c.q].iv.length >= 5); }), await page.evaluate(() => chords.map(c => chordName(c)).join(' ')));
  check('no console errors (ceilings)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// melody lane: one note per beat under the chords, coloured against them, played with them, harmonized from a selection
async function melodyLane() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL_);
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; S.melPlace = 'end'; chords = parseProg('C | Am | F | G').chords; melody = []; renderAll(); });
  await page.click('#melToggle');
  const t0 = await page.evaluate(() => ({ cells: document.querySelectorAll('#rows .mcell').length, pad: !document.querySelector('#melPad').hidden, cur: document.activeElement?.dataset?.mb }));
  check('melody: the switch shows one lane cell per beat and opens the note pad on beat 1', t0.cells === 16 && t0.pad && t0.cur === '0', JSON.stringify(t0));
  for (const k of ['e', 'd', 'c', 'd', 'e', 'e', 'e', '-', 'd', 'd', 'd', '-', 'e', 'g', 'g', '-']) await page.keyboard.press(k);
  check('melody: typing A–G enters notes beat by beat, – holds', await page.evaluate(() => JSON.stringify(melody) === '[64,62,60,62,64,64,64,-1,62,62,62,-1,64,67,67,-1]'), await page.evaluate(() => JSON.stringify(melody)));
  check('melody: E keys in the lane do not open the chord picker', await page.evaluate(() => document.querySelector('#cpick').hidden));
  const rel = await page.evaluate(() => [...document.querySelectorAll('#rows .mcell')].slice(0, 4).map(c => (c.className.match(/r-\w+/) || [''])[0]).join(','));
  check('melody: notes are coloured against the chord: E and C over C are chord tones, D is a colour note', rel === 'r-tone,r-color,r-tone,r-color', rel);
  await page.click('#rows .mcell[data-mb="8"]'); await page.keyboard.press('f'); await page.keyboard.press('#');
  const cl = await page.evaluate(() => ({ m: melody[8], cls: document.querySelector('#rows .mcell[data-mb="8"]').className }));
  check('melody: # raises the note just typed; F♯ on the downbeat of F is marked as a clash', cl.m === 66 && /r-clash/.test(cl.cls), JSON.stringify(cl));
  await page.click('#melPad [data-mp="prev"]'); await page.click('#melPad [data-mp="up"]');
  check('melody: the pad moves the cursor and shifts the octave', await page.evaluate(() => melody[8] === 78));
  await page.keyboard.press('Meta+z');
  check('melody: ⌘Z undoes melody edits from the lane', await page.evaluate(() => melody[8] === 66), await page.evaluate(() => String(melody[8])));
  await page.evaluate(() => { melody[8] = 62; renderAll(); });
  await page.click('#melPad [data-mpn="0"]');
  check('melody: tapping a note on the pad enters it in a nearby octave', await page.evaluate(() => melody.some((x, i) => x === 60 || x === 72)));
  await page.evaluate(() => { melody = [64, 62, 60, 62, 64, 64, 64, -1, 62, 62, 62, -1, 64, 67, 67, -1]; renderAll(); });
  // playback
  const pb = await page.evaluate(() => { let used = 0; const om = playMelLine; window.playMelLine = (...a) => { used++; return om(...a); }; S.loop = false; playChart(); stopAll(); window.playMelLine = om; const calls = []; const orig = tone; window.tone = (m, t, d) => { calls.push([m, +d.toFixed(2)]); }; S.tempo = 88; playMelLine(0, .5, previewOut()); window.tone = orig; return { used, calls }; });
  check('melody: it plays with the chart, a held note for its full length', pb.used === 1 && pb.calls.length === 13 && pb.calls[6][0] === 64 && pb.calls[6][1] > pb.calls[5][1] * 1.8, JSON.stringify(pb));
  await page.click('#melPad [data-mp="close"]');
  check('melody: the pad closes and the lane stays', await page.evaluate(() => document.querySelector('#melPad').hidden && document.querySelectorAll('#rows .mcell').length === 16));
  // harmonize a selection
  await page.click('#rows .mcell[data-mb="0"]'); await page.click('#rows .mcell[data-mb="6"]', { modifiers: ['Shift'] });
  check('melody: Shift-click selects across bars and offers chords for them', await page.evaluate(() => /Suggest chords for bars 1–2/.test(document.querySelector('#melPad').textContent)));
  await page.click('#melPad [data-mp="harm"]');
  const hz = await page.evaluate(() => ({ n: MEL.results.length, t: MEL.target, place: document.querySelector('#melPlace')?.value, label: document.querySelector('#melPlace option[value="bars"]')?.textContent, vis: document.querySelector('#melOut').checkVisibility() }));
  check('melody: the ideas open in Harmonize, set to go over those bars', hz.n >= 3 && hz.t.s0 === 0 && hz.t.e0 === 8 && hz.place === 'bars' && /bars 1–2/.test(hz.label) && hz.vis, JSON.stringify(hz));
  const want = await page.evaluate(() => MEL.results[0].list.map(c => chordName(c)).join(' '));
  await page.click('[data-muse="0"]');
  check('melody: Add to chart replaces just those bars', await page.evaluate(w => chords.map(c => chordName(c)).join(' ') === w + ' F G', want), await page.evaluate(() => chords.map(c => chordName(c)).join(' ')));
  check('melody: the melody itself is untouched', await page.evaluate(() => JSON.stringify(melody.slice(0, 4)) === '[64,62,60,62]'));
  // keeping it
  await page.reload();
  check('melody: it is saved with the chart, lane and all', await page.evaluate(() => S.showMel && melody[0] === 64 && document.querySelectorAll('#rows .mcell.note').length > 5));
  const kept = await page.evaluate(() => { const code = shareCode(); melody = []; applyShare(JSON.parse(atob(code.replace(/-/g, '+').replace(/_/g, '/')))); const viaShare = melody[0]; const it = newItem('m', curSnap()); melody = []; libOpen(it); return { viaShare, viaLib: melody[0] }; });
  check('melody: share links and the Library carry it', kept.viaShare === 64 && kept.viaLib === 64, JSON.stringify(kept));
  check('melody: transposing moves it', await page.evaluate(() => { transpose(2); return melody[0] === 66; }));
  await page.evaluate(() => { revealEl(document.querySelector('#melIn')); document.querySelector('#melIn').value = 'G A B C'; });
  await page.click('#melToLane');
  check('melody: Put in melody lane writes the typed tune from bar 1', await page.evaluate(() => melody.length === 4 && mod(melody[0]) === 7 && mod(melody[3]) === 0 && /in the lane/.test(document.querySelector('#toast').textContent)));
  await page.evaluate(() => { const c = document.querySelector('#chartTools'); revealEl(document.querySelector('#clearChart')); });
  await page.click('#clearChart');
  check('melody: Clear chart clears the melody too', await page.evaluate(() => !melody.some(x => x != null)));
  check('no console errors (melody)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
  // phone
  const ph = await openPage({ viewport: { width: 390, height: 844 } });
  await ph.page.goto(URL_);
  await ph.page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; S.showMel = true; chords = parseProg('C | Am | F | G').chords; melody = [64, 62, 60, 62]; melSel = { a: 4, b: 4 }; selectTab('phone', 'p-chart'); renderAll(); });
  const pz = await ph.page.evaluate(() => ({ h: document.querySelector('#melPad').getBoundingClientRect().height, noH: document.documentElement.scrollWidth <= innerWidth, cells: document.querySelectorAll('#rows .mcell').length }));
  check('melody: on a phone the lane fits and the pad stays short', pz.h < 240 && pz.noH && pz.cells === 16, JSON.stringify(pz));
  await ph.ctx.close();
}

async function arranging() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL_);
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; S.showMel = false; S.arrShow = false; S.arr = 'strings'; S.arrSeed = 0; chords = parseProg('C | Am | Dm7 G7 | C').chords; melody = [64, 62, 60, 62, 64, 64, 64, -1, 65, 65, 62, 62, 60, -1, -1, -1]; renderAll(); });
  await page.click('#arrToggle');
  const on = await page.evaluate(() => ({ mel: S.showMel, bar: !document.querySelector('#arrBar').hidden, lanes: document.querySelectorAll('#rows .acell').length, mcells: document.querySelectorAll('#rows .mcell').length, pressed: document.querySelector('#arrToggle').getAttribute('aria-pressed') }));
  check('arrange: the switch shows the melody lane, the Arrange bar and three more lanes of parts', on.mel && on.bar && on.lanes === 48 && on.mcells === 16 && on.pressed === 'true', JSON.stringify(on));
  // every style: parts stay in order top to bottom, and the tune is the melody lane
  const order = await page.evaluate(() => Object.keys(ARR_STYLES).filter(k => k !== 'orch').map(k => { S.arr = k; const ar = arrange(); const ok = ar.picks.every((v, i) => !v || (v[ar.mel] === ar.events[i].m && v.filter(x => x != null).every((x, j, a) => j === 0 || a[j - 1] > x))); return k + ':' + ok; }));
  check('arrange: in every style the parts never cross and the tune stays the tune', order.every(x => /true$/.test(x)), order.join(' '));
  const strings = await page.evaluate(() => { S.arr = 'strings'; const ar = arrange(), st = chordStarts(); let par = 0;
    const bassOk = ar.events.every((e, i) => !st.includes(e.b) || mod(ar.picks[i][3]) === (chords[e.ci].bass ?? chords[e.ci].root));
    for (let k = 1; k < ar.picks.length; k++) { const a = ar.picks[k - 1], b = ar.picks[k]; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const mi = b[i] - a[i], mj = b[j] - a[j], ia = mod(a[i] - a[j]), ib = mod(b[i] - b[j]); if (mi && mj && Math.sign(mi) === Math.sign(mj) && ia === ib && (ia === 7 || ia === 0)) par++; } }
    const held = ar.lines[1].some(n => n.n > 1); return { bassOk, par, held }; });
  check('arrange: strings put the cello on each chord’s bass, hold inner notes, and avoid parallel fifths and octaves', strings.bassOk && strings.par === 0 && strings.held, JSON.stringify(strings));
  const barber = await page.evaluate(() => { S.arr = 'barber'; const ar = arrange(), last = ar.picks[ar.picks.length - 1], c = chords[chords.length - 1];
    const tenorUp = ar.picks.every(v => !v || v[0] > v[1]);
    /* where the tune is a chord tone, the bass sings the chord's root or fifth */
    const rootFifth = ar.picks.every((v, i) => { const ch = chords[ar.events[i].ci]; return !v || !corePcs(ch).includes(mod(ar.events[i].m)) || [ch.root, mod(ch.root + 7)].includes(mod(v[3])); });
    return { lead: ar.mel, tenorUp, rootFifth, end: mod(last[3]) === c.root, full: ar.picks.every(v => !v || v.every(x => x != null)) }; });
  check('arrange: barbershop has the tune second from the top, the tenor above it, the bass on root or fifth, and ends on the root', barber.lead === 1 && barber.tenorUp && barber.rootFifth && barber.end && barber.full, JSON.stringify(barber));
  const jazz = await page.evaluate(() => { S.arr = 'close'; const a = arrange(); const close = a.picks.every(v => v[0] - v[3] < 12 && new Set(v.map(mod)).size === 4);
    S.arr = 'drop2'; const d = arrange(); const drop = d.picks.every((v, i) => v[3] === a.picks[i][1] - 12 && v[1] === a.picks[i][2]);
    const avoid = jazzSet(chords[0], 5, () => 1); const ten = jazzSet(chords[0], 2, () => 1).pcs.map(p => mod(p)).sort((x, y) => x - y).join(',');
    return { close, drop, avoid: !!avoid.dim && avoid.pcs.includes(5), ten }; });
  check('arrange: close harmony packs four different notes inside the octave; drop 2 moves the second voice down an octave', jazz.close && jazz.drop, JSON.stringify(jazz));
  check('arrange: an avoid note gets a passing diminished chord, a 9th replaces the root (C6/9 without C)', jazz.avoid && jazz.ten === '2,4,7,9', JSON.stringify(jazz));
  // Try another and back
  await page.click('#arrBar [data-astyle="strings"]');
  const v0 = await page.evaluate(() => JSON.stringify(arrange().picks));
  let changed = false; for (let i = 0; i < 4 && !changed; i++) { await page.click('#arrBar [data-aact="again"]'); changed = await page.evaluate(v => JSON.stringify(arrange().picks) !== v, v0); }
  check('arrange: Try another gives a different arrangement and says which version it is', changed && await page.evaluate(() => /Version \d/.test(document.querySelector('#arrBar').textContent)));
  await page.click('#arrBar [data-aact="first"]');
  check('arrange: First version brings the first one back exactly', await page.evaluate(v => JSON.stringify(arrange().picks) === v && S.arrSeed === 0, v0));
  // hearing it
  const pb = await page.evaluate(() => { const calls = []; const ov = voiceNote, os = playStyled, ot = playMelLine; let styled = 0, mel = 0;
    window.voiceNote = (m, t, d, vel) => calls.push(m); window.playStyled = () => { styled++; }; window.playMelLine = () => { mel++; };
    S.loop = false; playChart(); stopAll(); const all = calls.length, ch1 = styled; calls.length = 0; styled = 0;
    S.arrMute = [false, false, false, false, true]; playChart(); stopAll(); const noCh = styled;
    arrSolo = 3; calls.length = 0; playChart(); stopAll(); const solo = calls.slice(); arrSolo = null; S.arrMute = [false, false, false, false, false];
    window.voiceNote = ov; window.playStyled = os; window.playMelLine = ot;
    const ar = arrange(); return { all, n: ar.lines.reduce((a, l) => a + l.length, 0), ch1, noCh, mel, solo: solo.length === ar.lines[3].length && solo.every((m, i) => m === ar.lines[3][i].m) }; });
  check('arrange: Play sounds every part with the chords; muting the chords or soloing a part leaves just the rest', pb.all === pb.n && pb.ch1 > 0 && pb.noCh === 0 && pb.mel === 0 && pb.solo, JSON.stringify(pb));
  await page.click('#arrBar [data-amute="1"]');
  check('arrange: tapping a part mutes it and greys its lane', await page.evaluate(() => S.arrMute[1] && document.querySelectorAll('#rows .acell.muted').length === 16 && document.querySelector('#arrBar .vchip.off')));
  await page.click('#arrBar [data-amute="1"]');
  // the arrangement follows the tune as it is written
  await page.evaluate(() => { melSel = { a: 0, b: 0 }; renderAll(); focusMelCell(); });
  const before = await page.evaluate(() => JSON.stringify(arrange().picks[0]));
  await page.keyboard.press('a');
  check('arrange: changing a tune note re-voices the parts under it', await page.evaluate(b => melody[0] === 69 && JSON.stringify(arrange().picks[0]) !== b && arrange().picks[0][0] === 69, before), await page.evaluate(() => JSON.stringify([melody[0], arrange().picks[0]])));
  // exports
  await page.click('#exportBtn');
  check('arrange: the Export menu offers the arrangement', await page.evaluate(() => !document.querySelector('#arrExport').hidden));
  const xdlP = page.waitForEvent('download'); await page.click('#arrExport'); const xdl = await xdlP, xpath = path.join(OUT, xdl.suggestedFilename()); await xdl.saveAs(xpath);
  const xml = fs.readFileSync(xpath, 'utf8');
  const xr = await page.evaluate(x => { const d = new DOMParser().parseFromString(x, 'application/xml'); const parts = [...d.querySelectorAll('part')];
    const len = p => [...p.querySelectorAll('measure')].map(m => [...m.querySelectorAll('note')].filter(n => !n.querySelector('chord')).reduce((a, n) => a + +n.querySelector('duration').textContent, 0));
    return { err: !!d.querySelector('parsererror'), names: [...d.querySelectorAll('part-name')].map(n => n.textContent), bars: parts.map(p => len(p).every(v => v === 16)), clefs: parts.map(p => p.querySelector('clef sign').textContent + p.querySelector('clef line').textContent), harm: parts[0].querySelectorAll('harmony').length }; }, xml);
  check('arrange: the arrangement MusicXML has one staff per part, full bars, violin, alto and bass clefs, chord symbols on top', !xr.err && /strings\.musicxml$/.test(xdl.suggestedFilename()) && xr.names.join() === 'Violin 1,Violin 2,Viola,Cello' && xr.bars.every(Boolean) && xr.clefs.join() === 'G2,G2,C3,F4' && xr.harm === 5, JSON.stringify(xr));
  const md = await page.evaluate(() => [...buildMidi(false)]);
  const mid = parseMidi(Uint8Array.from(md));
  const names = mid.tracks.map(t => { const e = t.find(e => e.meta === 3); return e ? Buffer.from(e.data).toString() : ''; });
  check('arrange: MIDI gets a track for each part', names.join() === 'Chord Changes,Chords,Violin 1,Violin 2,Viola,Cello', names.join());
  const md2 = await page.evaluate(() => { S.arrShow = false; renderAll(); return [...buildMidi(false)]; });
  const names2 = parseMidi(Uint8Array.from(md2)).tracks.map(t => { const e = t.find(e => e.meta === 3); return e ? Buffer.from(e.data).toString() : ''; });
  check('melody: MIDI and MusicXML now carry the melody lane', names2.join() === 'Chord Changes,Chords,Melody' && await page.evaluate(() => /<part-name>Melody<\/part-name>/.test(buildMusicXML())), names2.join());
  await page.evaluate(() => { S.arrShow = true; S.arr = 'barber'; commit(); });
  await page.reload();
  check('arrange: the style and the switch are kept with the chart', await page.evaluate(() => arrOn() && S.arr === 'barber' && document.querySelectorAll('#rows .acell').length === 48));
  await page.click('#arrBar [data-aact="close"]');
  check('arrange: closing it leaves the melody lane', await page.evaluate(() => !arrOn() && S.showMel && !document.querySelector('#rows .acell') && document.querySelector('#arrBar').hidden));
  check('no console errors (arrange)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
  const ph = await openPage({ viewport: { width: 390, height: 844 } });
  await ph.page.goto(URL_);
  await ph.page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; S.showMel = true; S.arrShow = true; S.arr = 'close'; chords = parseProg('C | Am | F | G').chords; melody = [64, 62, 60, 62, 64, -1, 65, 64, 62, 60, 59, 60, 62, -1, -1, -1]; selectTab('phone', 'p-chart'); renderAll(); });
  const pz = await ph.page.evaluate(() => ({ noH: document.documentElement.scrollWidth <= innerWidth, bar: document.querySelector('#arrBar').getBoundingClientRect().width <= innerWidth, lanes: document.querySelectorAll('#rows .acell').length }));
  check('arrange: on a phone the bar and lanes fit the width', pz.noH && pz.bar && pz.lanes === 48, JSON.stringify(pz));
  await ph.page.screenshot({ path: path.join(OUT, 'arrange-phone.png'), fullPage: false });
  await ph.ctx.close();
}

async function voicesExplained() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  const tune = [64, 62, 60, 62, 64, 64, 64, -1, 65, 65, 62, 62, 60, -1, -1, -1];
  await page.evaluate(t => { S.tonic = 0; S.mode = 'ionian'; S.showMel = true; S.arrShow = true; S.arr = 'choir'; S.arrGroup = ''; S.arrSeed = 0; chords = parseProg('C | Am | Dm7 G7 | C').chords; melody = t.slice(); renderAll(); }, tune);
  const ch = await page.evaluate(() => { const ar = arrange(); let par = 0; for (let k = 1; k < ar.picks.length; k++) { const a = ar.picks[k - 1], b = ar.picks[k]; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { const mi = b[i] - a[i], mj = b[j] - a[j], ia = mod(a[i] - a[j]), ib = mod(b[i] - b[j]); if (mi && mj && Math.sign(mi) === Math.sign(mj) && ia === ib && (ia === 7 || ia === 0)) par++; } }
    return { group: ar.group, names: ar.voices.map(v => v.name).join(), bad: arrOutOfRange(ar).length, par, root: ar.picks.every((v, i) => mod(v[3]) === chords[ar.events[i].ci].root), ok: /within its range for mixed choir/.test(document.querySelector('#arrBar').textContent) }; });
  check('voices: Choir is SATB by default, in range, roots in the bass, no parallel fifths or octaves', ch.group === 'satb' && ch.names === 'Soprano (tune),Alto,Tenor,Bass' && ch.bad === 0 && ch.par === 0 && ch.root && ch.ok, JSON.stringify(ch));
  await page.click('#arrBar [data-agroup="ssaa"]');
  const ss = await page.evaluate(t => { melody = t.map(x => x > 0 ? x + 7 : x); renderAll(); const ar = arrange(); return { g: S.arrGroup, names: ar.voices.map(v => v.name).join(), inR: ar.lines.every((l, k) => k === ar.mel || l.every(n => n.m >= ar.voices[k].range[0] - 3 && n.m <= ar.voices[k].range[1] + 3)), title: document.querySelector('#arrBar [data-amute="1"]').title }; }, tune);
  check('voices: choosing SSAA renames the parts and keeps them near their ranges; a chip shows its range', ss.g === 'ssaa' && ss.names === 'Soprano 1 (tune),Soprano 2,Alto 1,Alto 2' && ss.inR && /Range C4–F5/.test(ss.title), JSON.stringify(ss));
  // barbershop picks men's or women's voices to fit the tune
  const auto = await page.evaluate(t => { S.arr = 'barber'; S.arrGroup = ''; melody = t.map(x => x > 0 ? x - 7 : x); const low = arrange().group; melody = t.map(x => x > 0 ? x + 7 : x); const high = arrange().group; melody = t.slice(); renderAll(); return { low, high }; }, tune);
  check('voices: barbershop chooses TTBB for a low tune and SSAA for a high one', auto.low === 'ttbb' && auto.high === 'ssaa', JSON.stringify(auto));
  // range trouble, flagged and fixed
  await page.evaluate(t => { S.arr = 'choir'; S.arrGroup = 'ttbb'; melody = t.map(x => x > 0 ? x + 12 : x); renderAll(); }, tune);
  const rg = await page.evaluate(() => ({ text: document.querySelector('#arrBar .ab-range')?.textContent || '', dots: document.querySelectorAll('#rows .mcell.oor').length, fix: [...document.querySelectorAll('#arrBar [data-afix]')].map(b => b.dataset.afix + '|' + b.textContent) }));
  check('voices: notes out of a singer’s range are counted, named and marked in the lanes', /outside their singer’s range/.test(rg.text) && /Tenor 1: \d+ notes above D3–A4, F5 at worst \(bar 3\)/.test(rg.text) && rg.dots > 5, JSON.stringify(rg));
  check('voices: it offers to move the tune down an octave', rg.fix.some(f => f.startsWith('oct:-12|Move the tune down')), JSON.stringify(rg.fix));
  await page.click('#arrBar [data-afix="oct:-12"]');
  check('voices: the fix moves the tune and clears the flags (and can be undone)', await page.evaluate(t => melody[0] === t[0] && !document.querySelector('#rows .oor') && /within its range/.test(document.querySelector('#arrBar').textContent), tune));
  await page.evaluate(() => { undo(); });
  check('voices: undo puts the tune back up', await page.evaluate(() => melody[0] === 76));
  const kf = await page.evaluate(() => { const b = document.querySelector('#arrBar [data-afix^="key:"]'); return b ? { t: +b.dataset.afix.split(':')[1], label: b.textContent, before: arrOutOfRange(arrange()).length } : null; });
  if (kf) { await page.click('#arrBar [data-afix^="key:"]'); }
  check('voices: when a key would suit the singers better, it offers it, and transposing helps', kf && /^Transpose to /.test(kf.label) && await page.evaluate(n => arrOutOfRange(arrange()).length < n, kf.before), JSON.stringify(kf));
  // the why card
  await page.evaluate(t => { S.tonic = 0; S.mode = 'ionian'; chords = parseProg('C | Am | Dm7 G7 | C').chords; S.arr = 'barber'; S.arrGroup = ''; melody = t.slice(); melody[3] = 62; renderAll(); }, tune);
  await page.click('#rows .acell[data-ab="1"][data-av="3"]');
  const why = await page.evaluate(() => { const el = document.querySelector('#arrWhy'); return { vis: !el.hidden, head: el.querySelector('.mp-head').textContent, rows: [...el.querySelectorAll('.aw-row')].map(r => r.querySelector('.aw-n').textContent + '=' + r.querySelector('.aw-p').textContent + '/' + r.querySelector('.aw-role').textContent), why: el.querySelector('.aw-why').textContent, alt: el.querySelector('.aw-alt')?.textContent || '', col: document.querySelectorAll('#rows .awhy').length }; });
  check('why: tapping a part’s note opens a card for that moment and outlines its column', why.vis && /Bar 1, beat 2 · over C · tune D/.test(why.head) && why.rows.length === 4 && why.col === 4, JSON.stringify(why));
  check('why: it names each note’s job and says why the chord was chosen', why.rows[0] === 'Tenor=F4/the 7th of G7' && /The tune’s D is not in C, so it gets G7, the chord’s own dominant/.test(why.why) && /Bass sings the root/.test(why.why), JSON.stringify(why));
  check('why: it shows the next-best voicing and what it loses on', /^Next best: .*It loses because it /.test(why.alt), why.alt);
  check('why: a dominant borrowed from another key is spelled in its own key (E7 has G♯, not A♭)', /G♯4[^(]*\(E7\)/.test(why.alt) && !/A♭/.test(why.alt), why.alt);
  const hear = await page.evaluate(() => { const o = voiceNote, n = []; window.voiceNote = m => n.push(m); document.querySelector('#arrWhy [data-aw="hear"]').click(); const one = n.length; document.querySelector('#arrWhy [data-aw="move"]').click(); window.voiceNote = o; return { one, move: n.length - one }; });
  check('why: Hear it plays the voicing, Hear the move plays the one before and then this one', hear.one === 4 && hear.move === 8, JSON.stringify(hear));
  await page.click('#arrWhy [data-aw="next"]');
  check('why: the arrows step to the next change', await page.evaluate(() => /beat 3/.test(document.querySelector('#arrWhy .mp-head').textContent)));
  const jz = await page.evaluate(() => { S.arr = 'close'; renderAll(); const ar = arrange(); return arrWhy(ar, 1).reasons.join(' '); });
  check('why: close harmony explains how it built the chord (a 9th taking the root’s place)', /The tune’s D is the chord’s 9th, a colour note\. It takes the place of the root/.test(jz) && /a fourth note is added, its 6th/.test(jz), jz);
  await page.click('#rows .mcell[data-mb="5"]');
  check('why: opening the note pad closes the card', await page.evaluate(() => document.querySelector('#arrWhy').hidden && !document.querySelector('#melPad').hidden));
  await page.click('#rows .acell[data-ab="0"][data-av="1"]');
  await page.keyboard.press('Escape');
  check('why: Escape closes the card', await page.evaluate(() => document.querySelector('#arrWhy').hidden));
  // the score names the parts plainly and sets a tenor's clef an octave down
  const xr = await page.evaluate(() => { S.arr = 'choir'; S.arrGroup = 'satb'; renderAll(); const d = new DOMParser().parseFromString(buildArrXML(), 'application/xml');
    return { names: [...d.querySelectorAll('part-name')].map(n => n.textContent).join(), clefs: [...d.querySelectorAll('part')].map(p => p.querySelector('clef sign').textContent + (p.querySelector('clef clef-octave-change')?.textContent || '')).join() }; });
  check('voices: the choir score names Soprano, Alto, Tenor, Bass, with the tenor in octave treble clef', xr.names === 'Soprano,Alto,Tenor,Bass' && xr.clefs === 'G,G,G-1,F' && await page.evaluate(() => { S.arrGroup = 'ttbb'; const d = new DOMParser().parseFromString(buildArrXML(), 'application/xml'); return [...d.querySelectorAll('part')].map(p => p.querySelector('clef sign').textContent).join() === 'G,G,F,F'; }), JSON.stringify(xr));
  check('no console errors (voices and why)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
  const ph = await openPage({ viewport: { width: 390, height: 844 } });
  await ph.page.goto(URL_);
  await ph.page.evaluate(t => { S.tonic = 0; S.mode = 'ionian'; S.showMel = true; S.arrShow = true; S.arr = 'choir'; S.arrGroup = ''; chords = parseProg('C | Am | Dm7 G7 | C').chords; melody = t.slice(); selectTab('phone', 'p-chart'); renderAll(); }, tune);
  await ph.page.click('#rows .acell[data-ab="4"][data-av="2"]');
  const pw = await ph.page.evaluate(() => { const r = document.querySelector('#arrWhy').getBoundingClientRect(); return { w: r.width <= innerWidth, h: r.height < innerHeight * .6, noH: document.documentElement.scrollWidth <= innerWidth }; });
  check('why: on a phone the card fits the width and leaves the chart visible', pw.w && pw.h && pw.noH, JSON.stringify(pw));
  await ph.page.screenshot({ path: path.join(OUT, 'why-phone.png') });
  await ph.ctx.close();
}

async function pianoParts() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  const tune = [64, -1, -1, -1, 65, 64, 62, -1, 62, -1, -1, -1, 64, 67, 72, -1, -1, -1, 69, -1, 67, -1, 65, -1, 64, -1, -1, -1];
  const setup = (st, t) => page.evaluate(([st, t]) => { S.tonic = 0; S.mode = 'ionian'; S.meter = '4/4'; S.instrument = 'piano'; S.pstyle = st; S.arrShow = false; S.showMel = !!t; chords = parseProg('C | Dm7 | G7 | Am | F | G7 | C').chords; melody = t ? t.slice() : []; partAt = null; renderAll(); }, [st, t]);
  await setup('stride', tune);
  const sd = await page.evaluate(() => { const p = pianoPart(), first = p.ev.filter(e => e.at < 3); const dv = p.dev.L.map(d => d.kind + (d.label ? ':' + d.label : '')).join(' ');
    return { pat: first.filter(e => e.h !== 'R').map(e => e.h + Math.round(e.at)).join(' '), dv, rh: p.dev.R.map(d => d.kind).join(' ') }; });
  check('piano: Broadway stride puts the bass on beats 1 and 3 and a chord on 2 and 4', sd.pat === 'B0 L1 B2', JSON.stringify(sd));
  check('piano: between chords it adds a passing C♯°7 (C to Dm7), walk-ups, an approach C7 (into F) and a big finish', /pass:C♯°7/.test(sd.dv) && /walk/.test(sd.dv) && /approach:C7/.test(sd.dv) && /finish$/.test(sd.dv), sd.dv);
  const rh = await page.evaluate(() => { const p = pianoPart(); const clash = p.ev.filter(e => e.h === 'R' && e.dev !== 'trem').filter(e => { const b = Math.floor(e.at + 1e-6); return melody[b] > 0 && Math.abs(e.at - b) < 1e-6 && e.dur > .5; });
    const runs = p.dev.R.filter(d => d.kind === 'run'), lands = runs.map(d => { const land = p.ev.find(e => e.h === 'R' && Math.abs(e.at - (d.b + d.n - 1)) < 1e-6); const ci = chordIdxAt(d.b + d.n - 1); return land && mod(land.notes[0]) === mod(chords[ci].root + (Q[chords[ci].q].iv.includes(3) ? 3 : 4)); });
    const pass = p.dev.L.filter(d => d.kind === 'pass').every(d => { const m = melPitch(d.b); return m == null || [0, 3, 6, 9].map(x => mod(d.root + x)).includes(mod(m)); });
    return { clash: clash.length, runs: runs.length, lands, pass, trem: p.dev.R.some(d => d.kind === 'tremolo' && d.tune === 72) }; });
  check('piano: the right hand stays out of the singer’s way, filling the gaps with runs that land on the next chord’s 3rd', rh.clash === 0 && rh.runs >= 2 && rh.lands.every(Boolean), JSON.stringify(rh));
  check('piano: a passing chord is only used where the tune fits it; the tune’s top note gets a tremolo', rh.pass && rh.trem, JSON.stringify(rh));
  const w34 = await page.evaluate(() => { S.meter = '3/4'; chords = parseProg('C | G7 | C').chords; melody = []; renderAll(); const p = pianoPart(); const r = p.ev.filter(e => e.at < 3 && e.h !== 'R').map(e => e.h + Math.round(e.at)).join(' '); S.meter = '4/4'; return r; });
  check('piano: in 3/4 the stride becomes a waltz: bass, chord, chord', w34 === 'B0 L1 L2', w34);
  const noTune = await page.evaluate(() => { chords = parseProg('C | Dm7 | G7 | Am | F | G7 | C | C').chords; melody = []; renderAll(); return pianoPart().dev.R.map(d => d.kind + '@' + d.b).join(' '); });
  check('piano: with no tune, fills come at the ends of two-bar phrases', /run@6/.test(noTune) && /run@14/.test(noTune), noTune);
  // jazz ballad
  await setup('evans', tune);
  const jz = await page.evaluate(() => { const p = pianoPart(), L = p.dev.L, rootless = L.filter(d => d.kind === 'rootless');
    const noRoot = rootless.every(d => !d.notes.some(m => mod(m) === mod(d.croot)));
    let move = 0; for (let k = 1; k < rootless.length; k++) move += vlMove(rootless[k - 1].notes, rootless[k].notes); move /= Math.max(1, rootless.length - 1);
    const types = new Set(rootless.map(d => d.type)), sub = L.find(d => d.kind === 'tritone'), end = L.find(d => d.kind === 'jend');
    const lines = p.dev.R.filter(d => d.kind === 'line').every(d => { const n = d.notes, t = d.target; return n[n.length - 1] === t - 1 && n[n.length - 2] > t && n[n.length - 2] - t <= 2; });
    return { noRoot, move: +move.toFixed(2), types: [...types].join(), sub: sub && sub.label, end: end && end.sharp11 && end.notes.some(m => mod(m) === 6), lines }; });
  check('piano: jazz ballad leaves the root out of the left hand, mixing A and B forms that move by small steps (total half steps per change)', jz.noRoot && jz.move <= 6 && jz.types.includes('A') && jz.types.includes('B'), JSON.stringify(jz));
  check('piano: G7 to C gets a tritone substitute (D♭7); the ending adds a ♯11; lines enclose the next chord’s 3rd', jz.sub === 'D♭7' && jz.end && jz.lines, JSON.stringify(jz));
  // hearing it, and the lanes
  const pb = await page.evaluate(() => { let part = 0, styled = 0; const op = playPart, os = playStyled; window.playPart = (...a) => { part++; }; window.playStyled = () => { styled++; }; S.loop = false; playChart(); stopAll(); window.playPart = op; window.playStyled = os; return { part, styled }; });
  check('piano: Play uses the whole-chart part instead of chord-by-chord styles', pb.part === 1 && pb.styled === 0, JSON.stringify(pb));
  const lanes = await page.evaluate(() => ({ lh: document.querySelectorAll('#rows .pcell[data-ph="L"]').length, rh: document.querySelectorAll('#rows .pcell[data-ph="R"]').length, tags: [...document.querySelectorAll('#rows .pcell')].map(c => c.textContent).join('|') }));
  check('piano: two lanes under the chart name what each hand does', lanes.lh >= 7 && lanes.rh >= 2 && /Rootless/.test(lanes.tags) && /D♭7/.test(lanes.tags) && /Line/.test(lanes.tags), JSON.stringify(lanes));
  await page.click('#rows .pcell[data-ph="L"][data-pb="22"]');
  const card = await page.evaluate(() => ({ vis: !document.querySelector('#partWhy').hidden, t: document.querySelector('#partWhy').textContent }));
  check('piano: tapping a tag explains it in plain words', card.vis && /Tritone substitution · D♭7/.test(card.t) && /share the same two guide tones/.test(card.t), card.t.slice(0, 200));
  const hear = await page.evaluate(() => { const ot = tone, os = strum; let tones = 0, strums = 0; window.tone = () => { tones++; }; window.strum = () => { strums++; };
    document.querySelector('#partWhy [data-pw="hear"]').click(); const a = tones; tones = 0; document.querySelector('#partWhy [data-pw="plain"]').click(); window.tone = ot; window.strum = os; return { a, plainStrums: strums, plainTune: tones }; });
  check('piano: Hear it plays that stretch with the tune; Hear it plain plays block chords to compare', hear.a > 4 && hear.plainStrums >= 1 && hear.plainTune >= 1, JSON.stringify(hear));
  await page.click('#partWhy [data-pw="next"]');
  check('piano: the arrows step to the next thing that hand does', await page.evaluate(() => /Ending · C/.test(document.querySelector('#partWhy').textContent)));
  await page.click('#rows .pcell[data-ph="R"]');
  check('piano: a right-hand fill explains when and why it plays', await page.evaluate(() => /While the singer holds E4/.test(document.querySelector('#partWhy').textContent) && /encloses/.test(document.querySelector('#partWhy').textContent)));
  await page.click('#rows .mcell[data-mb="5"]');
  check('piano: opening the note pad closes the card', await page.evaluate(() => document.querySelector('#partWhy').hidden));
  await page.click('#rows .pcell[data-ph="L"][data-pb="0"]'); await page.keyboard.press('Escape');
  check('piano: Escape closes the card', await page.evaluate(() => document.querySelector('#partWhy').hidden));
  // MIDI follows the part
  const md = await page.evaluate(() => { S.pstyle = 'stride'; renderAll(); return [...buildMidi(true)]; });
  const mid = parseMidi(Uint8Array.from(md)), notesOn = t => mid.tracks[t].filter(e => e.st === 0x90 && e.d[1] > 0).map(e => e.d[0]);
  check('piano: MIDI writes the part as planned, the stride bass on its own track', notesOn(2).includes(37) && notesOn(2).includes(36) && notesOn(1).length > 20, JSON.stringify({ ch: notesOn(1).slice(0, 12), bass: notesOn(2).slice(0, 8) }));
  const gt = await page.evaluate(() => { S.instrument = 'guitar'; renderAll(); const n = document.querySelectorAll('#rows .pcell').length; S.instrument = 'piano'; renderAll(); return n; });
  check('piano: the lanes are only there for the piano parts', gt === 0);
  check('no console errors (piano parts)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
  const ph = await openPage({ viewport: { width: 390, height: 844 } });
  await ph.page.goto(URL_);
  await ph.page.evaluate(t => { S.tonic = 0; S.mode = 'ionian'; S.instrument = 'piano'; S.pstyle = 'stride'; S.showMel = true; S.arrShow = false; chords = parseProg('C | Dm7 | G7 | Am').chords; melody = t.slice(0, 16); selectTab('phone', 'p-chart'); renderAll(); }, tune);
  const pz = await ph.page.evaluate(() => ({ noH: document.documentElement.scrollWidth <= innerWidth, cells: document.querySelectorAll('#rows .pcell').length }));
  check('piano: on a phone the lanes fit the width', pz.noH && pz.cells > 4, JSON.stringify(pz));
  await ph.ctx.close();
}

async function orchestra() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1100 } });
  await page.goto(URL_);
  const tune = [64, -1, -1, -1, 67, 65, 64, -1, 65, -1, -1, -1, 64, -1, -1, -1];
  await page.evaluate(t => { S.tonic = 0; S.mode = 'ionian'; S.instrument = 'piano'; S.pstyle = 'block'; S.showMel = true; S.arrShow = true; S.arr = 'strings'; S.arrSeed = 0; chords = parseProg('C | Am | Dm7 G7 | C').chords; melody = t.slice(); renderAll(); }, tune);
  await page.click('#arrBar [data-astyle="orch"]');
  const o = await page.evaluate(() => { const ar = arrange(), q = arrange('strings'), L = ar.lines, same = (a, b, d = 0) => a.length === b.length && a.every((n, i) => n.b === b[i].b && n.m === b[i].m + d);
    const guide = ar.events.every((e, k) => { const set = ar.sets[k], h = arrBeatMap(ar, 2)[e.b]; return !set || !h || [3, 4, 10, 11, 7].includes(mod(h.m - set.root)); });
    const pulse = L[5].every(n => n.n === 1) && L[5].length === 16;
    const cl = L[1].filter(n => n.counter), gapsOnly = cl.every(n => !(melody[n.b] > 0) || n.land);
    return { names: ar.voices.map(v => v.short).join(), tune: same(L[3], q.lines[q.mel]), fl: same(L[0], L[3], 12), vn2: same(L[4], q.lines[1]), vc: same(L[6], q.lines[3]), cb: L[7].every((n, i) => n.m === (L[6][i].m - 12 >= 28 ? L[6][i].m - 12 : L[6][i].m)) && L[7].length === L[6].length, guide, pulse, cl: cl.length, gapsOnly, lanes: [...new Set([...document.querySelectorAll('#rows .acell')].map(c => c.dataset.av))].join(), tags: [...document.querySelectorAll('#rows [data-v]')].map(c => c.dataset.v).join(), chips: document.querySelectorAll('#arrBar .vchip').length }; });
  check('orchestra: eight parts in score order, with the flute doubling the violins’ tune an octave up and the basses the cellos an octave down', o.names === 'Fl,Cl,Hn,Vn1,Vn2,Vla,Vc,Cb' && o.tune && o.fl && o.cb && o.vn2 && o.vc, JSON.stringify(o));
  check('orchestra: the horn holds guide tones, the violas pulse on every beat, the clarinet plays only in the tune’s gaps', o.guide && o.pulse && o.cl >= 4 && o.gapsOnly, JSON.stringify(o));
  check('orchestra: doubling parts share a lane (Vn1+Fl, Vc+Cb) and every part gets a mute chip', o.lanes === '1,2,4,5,6' && /Vn1\+Fl/.test(o.tags) && /Vc\+Cb/.test(o.tags) && o.chips === 9, JSON.stringify(o));
  const noUnison = await page.evaluate(() => { const ar = arrange(); return ar.events.every((e, k) => { const h = arrBeatMap(ar, 2)[e.b], v2 = arrBeatMap(ar, 4)[e.b]; return !h || !v2 || h.m !== v2.m; }); });
  check('orchestra: the horn doesn’t sit in unison with the second violins', noUnison);
  const clRange = await page.evaluate(() => { const ar = arrange(); return ar.lines[1].every(n => n.m >= 50 && n.m <= 91) && ar.lines[1].every(n => { const t = melPitch(n.b); return t == null || Math.abs(n.m - t) > 1; }); });
  check('orchestra: the countermelody stays in the clarinet’s range and never rubs a half step against the tune', clRange);
  await page.click('#rows .acell[data-ab="10"][data-av="1"]');
  const card = await page.evaluate(() => ({ head: document.querySelector('#arrWhy .mp-head').textContent, rows: [...document.querySelectorAll('#arrWhy .aw-n')].map(n => n.textContent).join(','), t: document.querySelector('#arrWhy').textContent }));
  check('orchestra: the card is for the tapped beat and gives every section’s job', /Bar 3, beat 3/.test(card.head) && card.rows === 'Flute,Clarinet,Horn,Violins I (tune),Violins II,Violas,Cellos,Double basses' && /clarinet moves/.test(card.t) && /horn holds/.test(card.t) && /Inside the strings/i.test(card.t) && /Cello plays the root/.test(card.t), JSON.stringify(card).slice(0, 400));
  const hear = await page.evaluate(() => { const o = voiceNote, n = []; window.voiceNote = m => n.push(m); document.querySelector('#arrWhy [data-aw="hear"]').click(); window.voiceNote = o; return n.length; });
  check('orchestra: Hear it plays every part sounding at that beat', hear === 8, String(hear));
  const pb = await page.evaluate(() => { const ov = voiceNote; let n = 0; window.voiceNote = () => { n++; }; S.loop = false; playChart(); stopAll(); window.voiceNote = ov; const ar = arrange(); return { n, want: ar.lines.reduce((a, l) => a + l.length, 0) }; });
  check('orchestra: Play sounds all eight parts', pb.n === pb.want, JSON.stringify(pb));
  const xr = await page.evaluate(() => { const d = new DOMParser().parseFromString(buildArrXML(), 'application/xml'), parts = [...d.querySelectorAll('part')];
    return { err: !!d.querySelector('parsererror'), names: [...d.querySelectorAll('part-name')].map(n => n.textContent).join(), clefs: parts.map(p => p.querySelector('clef sign').textContent + (p.querySelector('clef clef-octave-change')?.textContent || '')).join(), full: parts.every(p => [...p.querySelectorAll('measure')].every(m => [...m.querySelectorAll('note')].filter(n => !n.querySelector('chord')).reduce((a, n) => a + +n.querySelector('duration').textContent, 0) === 16)) }; });
  check('orchestra: the score has eight staves in score order, viola in alto clef and double basses in octave bass clef, every bar full', !xr.err && xr.names === 'Flute,Clarinet,Horn,Violins I,Violins II,Violas,Cellos,Double basses' && xr.clefs === 'G,G,G,G,G,C,F,F-1' && xr.full, JSON.stringify(xr));
  const mid = parseMidi(Uint8Array.from(await page.evaluate(() => [...buildMidi(false)])));
  const chans = mid.tracks.slice(2).map(t => (t.find(e => e.st === 0x90) || {}).ch);
  check('orchestra: MIDI puts each part on its own channel and keeps channel 10 free for drums', chans.length === 8 && !chans.includes(9) && new Set(chans).size === 8, JSON.stringify(chans));
  await page.click('#arrBar [data-astyle="strings"]');
  check('orchestra: switching back to the quartet clears the parts’ mutes', await page.evaluate(() => S.arrMute.every(x => !x) && arrange().voices.length === 4));
  check('no console errors (orchestra)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

async function songForm() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  const song = '[Verse 1]\nC | Am | F | G\n[Chorus]\nF | G | C | C\n[Verse 2]\nC | Am | F | G\n[Chorus]\nF | G | C | C\n[Bridge]\nAm | F | C | G\n[Chorus]\nF | G | C | C';
  const load = (txt, tune) => page.evaluate(([txt, tune]) => { S.tonic = 0; S.mode = 'ionian'; S.showMel = !!tune; S.arrShow = false; S.pstyle = 'block'; S.foldForm = true; S.linkForm = true; chords = parseProg(txt).chords; melody = tune || []; hist = []; sel = chords[0].id; unfolded.clear(); formEdit = null; renderAll(); }, [txt, tune]);
  await load(song);
  const f = await page.evaluate(() => ({ chips: [...document.querySelectorAll('#formBar .fchip')].map(c => c.querySelector('b').textContent + (c.classList.contains('rep') ? '*' : '')).join(','), slots: document.querySelectorAll('#rows .slot').length, folds: [...document.querySelectorAll('#rows .fold-row')].map(r => r.textContent.trim().split(' · ')[0]).join('|') }));
  check('form: the strip lists the sections in order and marks the repeats', f.chips === 'Verse 1,Chorus,Verse 2*,Chorus*,Bridge,Chorus*', f.chips);
  check('form: repeats fold to one line each, so 24 bars show as 12', f.slots === 12 && f.folds === 'Same as bar 1 (Verse 1)|Same as bar 5|Same as bar 5', JSON.stringify(f));
  await page.click('#rows .fold-row [data-unfold]');
  check('form: Show opens a folded repeat', await page.evaluate(() => document.querySelectorAll('#rows .slot').length === 16 && document.querySelectorAll('#rows .fold-row').length === 2));
  await page.click('#foldForm');
  check('form: turning Fold repeats off shows every bar', await page.evaluate(() => document.querySelectorAll('#rows .slot').length === 24 && !document.querySelector('#rows .fold-row')));
  await page.click('#foldForm');
  // linked repeats
  const lk = await page.evaluate(() => { const s = sectionsOf()[1]; pushHist(); chords[s.i0].root = 2; chords[s.i0].q = 'm'; commit(); return sectionsOf().map(x => chords[x.i0] && chordName(chords[x.i0])).join(' '); });
  await page.waitForTimeout(30);
  check('form: changing a chord in one Chorus changes every Chorus that matched it, and says so', lk === 'C Dm C Dm Am Dm' && await page.evaluate(() => /Also changed the other 2 Choruses/.test(document.querySelector('#toast').textContent)), lk);
  await page.evaluate(() => undo());
  check('form: one Undo puts them all back', await page.evaluate(() => sectionsOf().map(x => chordName(chords[x.i0])).join(' ') === 'C F C F Am F'));
  const verse = await page.evaluate(() => { const s = sectionsOf()[4]; pushHist(); chords[s.i0].root = 9; chords[s.i0].q = '7'; commit(); return serialize(); });
  check('form: a section with no copies changes alone', /\[Bridge\]\nA7 \| F \| C \| G/.test(verse) && (verse.match(/F \| G \| C \| C/g) || []).length === 3, verse);
  const off = await page.evaluate(() => { S.linkForm = false; const s = sectionsOf()[1]; pushHist(); chords[s.i0 + 1].q = '7'; commit(); S.linkForm = true; return (serialize().match(/F \| G7 \| C \| C/g) || []).length; });
  check('form: with Link repeats off, only the one you change changes', off === 1, String(off));
  // with a tune, a change of length stays local so the melody never shifts
  await load(song, Array.from({ length: 96 }, (_, i) => i % 4 === 0 ? 60 + (i / 4) % 5 : -1));
  const ln = await page.evaluate(() => { const s = sectionsOf()[1]; pushHist(); chords.splice(s.i0 + 1, 0, { id: uid(), root: 7, q: '7', bass: null, beats: 4 }); commit(); return (serialize().match(/G7/g) || []).length; });
  await page.waitForTimeout(30);
  check('form: with a tune, a section that changes length doesn’t drag its copies along', ln === 1 && await page.evaluate(() => /Only this Chorus changed/.test(document.querySelector('#toast').textContent)), String(ln));
  // repeating sections
  await load('[Verse]\nC | G\n[Chorus]\nF | C', [60, -1, -1, -1, 62, -1, -1, -1, 64, -1, -1, -1, 65, -1, -1, -1]);
  await page.click('#formBar [data-fk="1"]'); await page.click('#formBar [data-fa="end"]');
  const re = await page.evaluate(() => ({ txt: serialize(), mel: melody.slice(16, 24).join(), folds: document.querySelectorAll('#rows .fold-row').length }));
  check('form: Repeat at the end copies the section, its tune too, and folds the copy', /\[Chorus\]\nF \| C\n\[Chorus\]\nF \| C$/.test(re.txt) && re.mel === '64,-1,-1,-1,65,-1,-1,-1' && re.folds === 1, JSON.stringify(re));
  await page.click('#formBar [data-fk="0"]'); await page.click('#formBar [data-fa="after"]');
  const ra = await page.evaluate(() => ({ txt: serialize().replace(/\n/g, ' / '), mel: melody.slice(8, 20).join() }));
  check('form: Repeat after it inserts the copy and moves the rest of the tune along', ra.txt === '[Verse] / C | G / [Verse] / C | G / [Chorus] / F | C / [Chorus] / F | C' && ra.mel === '60,-1,-1,-1,62,-1,-1,-1,64,-1,-1,-1', JSON.stringify(ra));
  // naming sections
  await load('C | Am | F | G | C | Am | F | G');
  await page.evaluate(() => { sel = chords[4].id; renderAll(); });
  await page.click('#formBar [data-fa="mark"]');
  check('form: + Name a section offers common names for the selected bar', await page.evaluate(() => /Start a section at bar 5/.test(document.querySelector('#formBar').textContent) && !!document.querySelector('#formBar [data-fm="Chorus"]')));
  await page.click('#formBar [data-fm="Chorus"]');
  check('form: naming it splits the form', await page.evaluate(() => sectionsOf().map(s => s.name || '-').join() === '-,Chorus' && /\[Chorus\]\nC \| Am \| F \| G/.test(serialize())));
  await page.click('#formBar [data-fk="1"]');
  await page.fill('#formBar [data-fn="1"]', 'Verse 2'); await page.keyboard.press('Enter');
  check('form: a section can be renamed', await page.evaluate(() => sectionsOf()[1].name === 'Verse 2'));
  await page.click('#formBar [data-fa="unmark"]');
  check('form: and its label removed', await page.evaluate(() => sectionsOf().length === 1));
  const mid = await page.evaluate(() => { chords = parseProg('C D | G').chords; sel = chords[1].id; hist = []; renderAll(); markSection('Hook'); return { secs: sectionsOf().length, toast: document.querySelector('#toast').textContent }; });
  check('form: a section starts at a bar line: naming from mid-bar names that bar', mid.secs === 1 || /beginning of a bar/.test(mid.toast), JSON.stringify(mid));
  // the melody cursor opens a folded repeat
  await load(song, []);
  await page.evaluate(() => { S.showMel = true; melSel = { a: 36, b: 36 }; renderAll(); });
  check('form: moving the melody cursor into a folded repeat opens it', await page.evaluate(() => !!document.querySelector('#rows .mcell[data-mb="36"]') && document.querySelectorAll('#rows .fold-row').length === 2));
  // saved and played
  await page.evaluate(() => { melSel = null; S.showMel = false; S.foldForm = false; commit(); });
  await page.reload();
  check('form: the fold and link switches are kept', await page.evaluate(() => S.foldForm === false && S.linkForm === true && !document.querySelector('#rows .fold-row')));
  check('no console errors (song form)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
  const ph = await openPage({ viewport: { width: 390, height: 844 } });
  await ph.page.goto(URL_);
  await ph.page.evaluate(txt => { S.tonic = 0; S.mode = 'ionian'; S.showMel = false; S.foldForm = true; chords = parseProg(txt).chords; selectTab('phone', 'p-chart'); renderAll(); }, song);
  const pz = await ph.page.evaluate(() => ({ noH: document.documentElement.scrollWidth <= innerWidth, chips: document.querySelectorAll('#formBar .fchip').length, folds: document.querySelectorAll('#rows .fold-row').length }));
  check('form: on a phone the strip scrolls sideways and the folds fit', pz.noH && pz.chips === 6 && pz.folds === 3, JSON.stringify(pz));
  await ph.page.screenshot({ path: path.join(OUT, 'form-phone.png') });
  await ph.ctx.close();
}

/* the app's name lives in one constant: the page, the exports, the messages and the help pages all follow it */
/* slash basses and chord tones are spelled up from the chord's root, so E7/G♯ never comes out as E7/A♭ */
async function spelling() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  const names = await page.evaluate(() => [['C','ionian','E7/G# C/E D7/F# Ab/C Bb7/D C/Bb Gaug F#m7b5 B7/D#'],['F','ionian','A7/C# Bb/D'],['E','aeolian','B7/D# Am/C'],['Eb','ionian','Cm/Eb G7/B']].map(([k, m, list]) => { const kk = parseKeyName(k + ' ' + (m === 'ionian' ? 'major' : 'minor')); S.tonic = kk.t; S.mode = kk.m;
    return list.split(' ').map(t => chordName(parseChord(t))).join(' '); }));
  check('spelling: slash basses follow the chord, not the key', names.join(' | ') === 'E7/G♯ C/E D7/F♯ A♭/C B♭7/D C/B♭ G+ F♯m7♭5 B7/D♯ | A7/C♯ B♭/D | B7/D♯ Am/C | Cm/E♭ G7/B', names.join(' | '));
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; chords = parseProg('C | E7 | Am | Am').chords; sel = chords[1].id; commit(); });
  const tones = await page.evaluate(() => [...document.querySelectorAll('.tones .tone')].map(t => t.firstChild.textContent).join(' '));
  check('spelling: the Chord panel spells E7 in C as E G♯ B D', tones === 'E G♯ B D', tones);
  await ctx.close();
}
/* faster input: number keys add the key's chords, and a MIDI keyboard names and records what it plays */
async function fastInput() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  const load = txt => page.evaluate(txt => { S.tonic = 0; S.mode = 'ionian'; S.showMel = false; chords = parseProg(txt).chords; melody = []; melAnd = []; sel = chords[chords.length - 1].id; commit(); }, txt);
  const chart = () => page.evaluate(() => chords.map(c => chordName(c) + ':' + c.beats).join(' '));
  await load('C | Am');
  await page.focus(`#rows .slot[data-id="${await page.evaluate(() => sel)}"]`);
  await page.keyboard.press('4'); await page.keyboard.press('Shift+5'); await page.keyboard.press('Numpad2');
  check('keys: 4, Shift+5 and keypad 2 add F, G7 and Dm after the selected chord, a bar each', await chart() === 'C:4 Am:4 F:4 G7:4 Dm:4', await chart());
  await page.evaluate(() => { sel = chords[0].id; commit(); }); await page.focus(`#rows .slot[data-id="${await page.evaluate(() => sel)}"]`);
  await page.keyboard.press('6');
  check('keys: a number goes in after the selected chord, not at the end', await chart() === 'C:4 Am:4 Am:4 F:4 G7:4 Dm:4', await chart());
  await page.keyboard.press('Control+z');
  check('keys: one undo removes it', await chart() === 'C:4 Am:4 F:4 G7:4 Dm:4', await chart());
  await load('C | ?');
  await page.focus(`#rows .slot[data-id="${await page.evaluate(() => sel)}"]`); await page.keyboard.press('5');
  check('keys: an empty slot is filled rather than added after', await chart() === 'C:4 G:4', await chart());
  await load('C | G\n[Key: A minor]\nAm | E');
  await page.focus(`#rows .slot[data-id="${await page.evaluate(() => sel)}"]`); await page.keyboard.press('Shift+5'); await page.keyboard.press('3');
  check('keys: numbers follow the key in force at the selected bar (A minor: v7, then III)', await chart() === 'C:4 G:4 Am:4 E:4 Em7:4 C:4', await chart());
  await page.click('#prog'); await page.keyboard.press('1');
  check('keys: typing a number in a text box does not add a chord', await chart() === 'C:4 G:4 Am:4 E:4 Em7:4 C:4', await chart());

  /* MIDI in, with a stand-in input since headless browsers have no devices */
  check('midi in: the MIDI in control shows where Web MIDI exists', await page.evaluate(() => !document.querySelector('#midiInWrap').hidden));
  await load('C | G');
  const send = msgs => page.evaluate(msgs => msgs.forEach(m => midiInMessage(m)), msgs);
  await page.evaluate(() => midiInUse({ id: 'test', name: 'Test keys' }));
  await send([[0x90, 57, 90], [0x90, 60, 90], [0x90, 64, 90], [0x90, 67, 90]]);
  const holding = await page.evaluate(() => document.querySelector('#midiHeard').textContent);
  await send([[0x80, 64, 0], [0x90, 67, 0], [0x80, 60, 0], [0x80, 57, 0]]);
  const fin = await page.evaluate(() => ({ keys: FINDER.keys.join(), mode: FINDER.mode, first: document.querySelector('#finder .fres.best .nm')?.textContent, heard: document.querySelector('#midiHeard').textContent }));
  check('midi in: a held chord is named live, and when the keys come up it lands in the Chord finder with its names', holding === 'Holding Am7' && fin.keys === '57,60,64,67' && fin.mode === 'piano' && fin.first === 'Am7' && fin.heard === 'Played Am7', JSON.stringify({ holding, fin }));
  check('midi in: playing chords adds nothing to the chart by itself', await chart() === 'C:4 G:4', await chart());
  const add = () => page.evaluate(async () => { await new Promise(r => setTimeout(r, 120)); sel = chords[chords.length - 1].id; document.querySelector('#live [data-live-add]').click(); });
  await send([[0x90, 53, 90], [0x90, 57, 90], [0x90, 60, 90], [0x80, 57, 0], [0x80, 53, 0], [0x80, 60, 0]]); await add();
  await send([[0x90, 55, 90], [0x90, 59, 90], [0x90, 62, 90], [0x90, 65, 90], [0x80, 55, 0], [0x80, 59, 0], [0x80, 62, 0], [0x80, 65, 0]]); await add();
  check('midi in: Add to chart adds the chord just played, after the selected one', await chart() === 'C:4 G:4 F:4 G7:4', await chart());
  await send([[0x90, 52, 90], [0x90, 60, 90], [0x90, 55, 90], [0x80, 52, 0], [0x80, 55, 0], [0x80, 60, 0]]); await add();
  check('midi in: the lowest note played sets the bass (C/E)', await chart() === 'C:4 G:4 F:4 G7:4 C/E:4', await chart());
  await page.evaluate(() => midiInUse(null));
  await ctx.close();
}
/* the front door: an example with colour, "I have chords" first, numerals, the progression's why, ideas, Start over, Hear from */
async function frontDoor() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 }, firstVisit: true });
  await page.goto(URL_);
  const first = await page.evaluate(() => ({ chart: chords.map(c => chordName(c)).join(' '), kinds: [...new Set(chords.map(c => analyze(c).kind))].length, ex: !document.querySelector('#exampleNote').hidden, tab: document.querySelector('#tab-mine').getAttribute('aria-selected'), why: document.querySelector('#progWhy').textContent }));
  check('door: a first visit opens on a labelled example with more than one colour, and on I have chords', first.chart === 'G B7 Em Cm' && first.kinds >= 3 && first.ex && first.tab === 'true' && await page.evaluate(() => document.querySelector('#doorIn').checkVisibility()), JSON.stringify(first));
  check('door: the example explains itself in a sentence', /B7 \(bar 2\) is the V7 of vi/.test(first.why) && /Cm \(bar 4\) is borrowed from G minor/.test(first.why), first.why);
  const nums = await page.evaluate(() => { const go = (k, m, t) => { S.tonic = k; S.mode = m; const r = parseProg(t); return r.chords.map(c => chordName(c)).join(' ') + (r.bad.length ? ' BAD' : ''); };
    const out = [go(0, 'ionian', 'I vi IV V'), go(7, 'ionian', 'ii7 V7 Imaj7 viiø7'), go(0, 'ionian', 'V7/V V7/vi bVII iv I/E'), go(0, 'ionian', '1 6m 4 5 | 2m7 5/7 b7 4maj7'), go(9, 'aeolian', 'i bVI bIII bVII'), go(2, 'ionian', 'C | G\n[Key: E major]\nI | IV'), go(0, 'ionian', 'C Am b7 F')];
    S.tonic = 7; S.mode = 'ionian'; return out; });
  check('numerals: Roman numerals, secondary dominants, Nashville numbers and key changes read in the key', nums.join(' | ') === 'C Am F G | Am7 D7 Gmaj7 F♯m7♭5 | D7 E7 B♭ Fm C/E | C Am F G Dm7 G/B B♭ Fmaj7 | Am F C G | C G E A | C Am B7 F', nums.join(' | '));
  await page.fill('#doorIn', 'C Am F G');
  const read = await page.textContent('#doorRead');
  check('door: the box says how it reads the chords and the likeliest key before adding', /Reads as C Am F G, in C major/.test(read) && /replaces the example/.test(read), read);
  await page.press('#doorIn', 'Enter');
  const after = await page.evaluate(() => ({ chart: chords.map(c => chordName(c) + ':' + c.beats).join(' '), key: keyName(), ex: document.querySelector('#exampleNote').hidden, box: document.querySelector('#doorIn').value }));
  check('door: Add replaces the example and sets the key', after.chart === 'C:4 Am:4 F:4 G:4' && after.key === 'C major' && after.ex && after.box === '', JSON.stringify(after));
  await page.fill('#doorIn', 'ii7 V7'); await page.click('#doorAdd');
  check('door: numerals are added at the end, in the key', await page.evaluate(() => chords.map(c => chordName(c)).join(' ')) === 'C Am F G Dm7 G7');
  await page.fill('#doorIn', 'C Xyz');
  check('door: an unreadable chord is named and nothing is added', /Can’t read “Xyz”/.test(await page.textContent('#doorRead')) && await page.evaluate(() => chords.length) === 6);
  await page.fill('#doorIn', '');
  await page.evaluate(() => { sel = chords[1].id; commit(); });
  await page.check('#doorSev'); await page.click('#doorKeys [data-deg="3"]');
  check('door: tapping a key chord adds it after the selected one', await page.evaluate(() => chords.map(c => chordName(c)).join(' ')) === 'C Am Fmaj7 F G Dm7 G7');
  const why = await page.evaluate(() => { chords = parseProg('C | Am | Fm | G').chords; sel = chords[0].id; commit(); const a = document.querySelector('#progWhy').textContent; chords = parseProg('C | Am | F | G').chords; commit(); return [a, document.querySelector('#progWhy').textContent]; });
  check('why: borrowed chords and the ending are explained', /Fm \(bar 3\) is borrowed from C minor/.test(why[0]) && /ends on the V/.test(why[0]), why[0]);
  check('why: an all-in-key chart says so', /^Every chord comes from C major/.test(why[1]), why[1]);
  await page.evaluate(() => { chords = parseProg('C | Am | F | G').chords; sel = chords[0].id; commit(); });
  const id0 = await page.evaluate(() => ({ n: document.querySelectorAll('#ideas .item').length, first: document.querySelector('#ideas .item .why').textContent, kinds: new Set(document.querySelector('#ideas')._shown.map(x => x.g)).size, chords: new Set(document.querySelector('#ideas')._shown.map(x => x.idx)).size }));
  await page.click('#ideas [data-idea="more"]');
  const id1 = await page.evaluate(() => document.querySelector('#ideas .item .why').textContent);
  check('ideas: three ideas of different kinds, for different chords, and Other ideas moves on', id0.n === 3 && id0.kinds === 3 && id0.chords === 3 && id1 !== id0.first, JSON.stringify({ id0, id1 }));
  const before = await page.evaluate(() => chords.map(c => chordName(c)).join(' '));
  await page.click('#ideas [data-idea="use"][data-k="0"]');
  const used = await page.evaluate(() => chords.map(c => chordName(c)).join(' '));
  check('ideas: Use swaps the idea in, and undo puts it back', used !== before && (await page.keyboard.press('Control+z'), await page.evaluate(() => chords.map(c => chordName(c)).join(' '))) === before, `${before} → ${used}`);
  await page.evaluate(() => { S.quiz = true; renderAll(); });
  check('quiz: the why line and ideas hide while quizzing', await page.evaluate(() => !document.querySelector('#progWhy').checkVisibility() && !document.querySelector('#ideas').checkVisibility()));
  await page.evaluate(() => { S.quiz = false; renderAll(); melody = [64, -1, 62, null]; commit(); });
  check('start over: the button says Start over', (await page.textContent('#clearChart')).trim() === 'Start over');
  await page.evaluate(() => document.querySelector('#clearChart').click());
  const empty = await page.evaluate(() => ({ n: chords.length, mel: melody.length, note: document.querySelector('#exampleNote').textContent }));
  await page.keyboard.press('Control+z');
  check('start over: clears the chords and the tune, says what to do next, and undo brings both back', empty.n === 0 && empty.mel === 0 && /An empty chart/.test(empty.note) && await page.evaluate(() => chords.length === 4 && melody[0] === 64), JSON.stringify(empty));
  const ctxs = await page.evaluate(() => { chords = parseProg('C | Am | F | G').chords; commit(); const last = ctxAround(3), firstC = ctxAround(0); S.hearBack = 2; const two = ctxAround(3); S.hearBack = 4; const four = ctxAround(2); S.hearBack = 1;
    const nm = l => l.map(c => chordName(c)).join(' '); return { last: nm(last.before) + '|' + (last.after ? chordName(last.after) : '-'), first: nm(firstC.before) + '|' + chordName(firstC.after), two: nm(two.before), four: nm(four.before) + '|' + chordName(four.after), seq: contextSeq(3, [{ root: 7, q: '7', bass: null }]).length }; });
  check('hear in context: the last chord is not followed by the first, and Hear from sets how far back', ctxs.last === 'F|-' && ctxs.first === '|Am' && ctxs.two === 'Am F' && ctxs.four === 'C Am|G' && ctxs.seq === 2, JSON.stringify(ctxs));
  await page.evaluate(() => { sel = chords[3].id; renderAll(); selectTab('right', 'swaps'); });
  await page.selectOption('#hearBack', '4');
  const hb = await page.evaluate(() => ({ s: S.hearBack, ctx: document.querySelector('#subs .ctx').textContent }));
  check('hear in context: the Swap ideas selector saves Hear from, and the last chord says it is at the end', hb.s === 4 && /After F, at the end/.test(hb.ctx), JSON.stringify(hb));
  const keep = await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; const was = S.vocab; S.vocab = [...PRESETS.Everything];
    chords = parseProg('C | ? | G').chords; sel = chords[1].id; keepNotes = [7]; const g = keepGroup(1), names = g.items.map(it => chordName(it.chords[0])), allG = g.items.every(it => allPcs(it.chords[0]).includes(7));
    const noSlash = (S.vocab = S.vocab.filter(f => f !== 'slash'), keepGroup(1).items.filter(it => it.chords[0].bass != null).length); S.vocab = was; keepNotes = []; return { n: names.length, names, noSlash, allG, blurb: g.blurb }; });
  check('keep note: every chord with G is listed, slash chords over G included, and none when slash chords are off', keep.n > 40 && ['C/G', 'Am/G', 'F/G', 'Em/G', 'D/G'].every(x => keep.names.includes(x)) && keep.allG && keep.noSlash === 0 && /including slash chords over G/.test(keep.blurb), JSON.stringify({ n: keep.n, first: keep.names.slice(0, 12), noSlash: keep.noSlash }));
  await page.evaluate(() => { S.tonic = 7; S.mode = 'ionian'; });
  await page.evaluate(() => { S.hearBack = 1; selectTab('left', 'gen'); });
  await page.reload();
  check('door: the last door chosen opens next time', await page.evaluate(() => document.querySelector('#tab-gen').getAttribute('aria-selected') === 'true' && document.querySelector('#tab-gen').textContent === 'Generate'));
  await ctx.close();
}
/* hearing the arrangement a bar or a chord at a time */
async function hearArr() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; chords = parseProg('C | F | G | C').chords; melody = [64, 65, 67, 64, 65, -1, 69, 65, 67, -1, 71, 74, 72, -1, -1, -1]; melAnd = []; S.showMel = true; S.arrShow = true; S.arr = 'strings'; S.arrMute = [false, false, false, false, false, false, false, false, false]; sel = chords[0].id; commit();
    window.heard = []; const vn = voiceNote; window.voiceNote = (m, t, d, ...r) => { heard.push({ m, t, d }); return vn(m, t, d, ...r); }; const st = strum; window.strummed = 0; window.strum = (...a) => { strummed++; return st(...a); }; window.played1 = 0; const p1 = playOne; window.playOne = (...a) => { played1++; return p1(...a); }; });
  await page.click(`#rows .slot[data-id="${await page.evaluate(() => chords[1].id)}"]`);
  const tap = await page.evaluate(() => { const ar = arrange(), notes = ar.lines.reduce((a, l) => a + l.filter(n => n.b < 8 && n.b + n.n > 4).length, 0); return { n: heard.length, notes, strummed, played1, span: Math.max(...heard.map(h => h.t + h.d)) - Math.min(...heard.map(h => h.t)), bar: 4 * 60 / S.tempo }; });
  check('arrange: tapping a chord plays its bar of the arrangement (every part, and the chord), not just the chord', tap.n === tap.notes && tap.n >= 4 && tap.strummed === 1 && tap.played1 === 0 && Math.abs(tap.span - tap.bar) < 0.05, JSON.stringify(tap));
  await page.evaluate(() => { heard.length = 0; strummed = 0; S.arrMute[0] = true; S.arrMute[arrange().voices.length] = true; renderAll(); });
  await page.click(`#rows .slot[data-id="${await page.evaluate(() => chords[2].id)}"]`);
  const muted = await page.evaluate(() => ({ n: heard.length, strummed, top: heard.some(h => h.m > 80) }));
  check('arrange: a muted part, and muted chords, stay silent when you tap', muted.strummed === 0 && muted.n > 0, JSON.stringify(muted));
  await page.evaluate(() => { S.arrMute = [false, false, false, false, false, false, false, false, false]; renderAll(); heard.length = 0; strummed = 0; });
  await page.click('#rows .acell[data-ab="13"]');
  await page.click('#arrWhy [data-aw="bar"]');
  const bar = await page.evaluate(() => ({ n: heard.length, strummed, span: Math.max(...heard.map(h => h.t + h.d)) - Math.min(...heard.map(h => h.t)), bar: 4 * 60 / S.tempo }));
  check('arrange: Hear the bar in the why card plays the whole bar it is in', bar.n >= 4 && bar.strummed === 1 && Math.abs(bar.span - bar.bar) < 0.05, JSON.stringify(bar));
  await page.evaluate(() => { S.arrShow = true; S.showMel = true; chords = parseProg('C | F | G | C').chords; melody = [64, 65, 67, 64, 65, -1, 69, 65, 67, -1, 71, 74, 72, -1, -1, -1]; sel = chords[0].id; commit(); });
  const errs0 = page.errors.length;
  await page.click('#rows .acell[data-ab="5"]');
  await page.evaluate(() => document.querySelector('#clearChart').click());
  const cleared = await page.evaluate(() => ({ n: chords.length, rows: document.querySelectorAll('#rows .slot').length, bar: document.querySelector('#arrBar').hidden, toast: document.querySelector('#toast').textContent, on: S.arrShow }));
  await page.keyboard.press('Control+z');
  check('arrange: Start over works with the arrangement open, and undo brings the arrangement back', cleared.n === 0 && cleared.rows === 0 && cleared.bar && /fresh start/.test(cleared.toast) && cleared.on && page.errors.length === errs0 && await page.evaluate(() => chords.length === 4 && !document.querySelector('#arrBar').hidden), JSON.stringify(cleared));
  await page.evaluate(() => { S.arrShow = false; renderAll(); played1 = 0; });
  await page.click(`#rows .slot[data-id="${await page.evaluate(() => chords[0].id)}"]`);
  check('arrange: with the arrangement off, tapping a chord plays the chord as before', await page.evaluate(() => played1 === 1));
  await ctx.close();
}
/* Simple view: plain chords, Home / Away / Pull / Surprise, and what could come next */
async function simpleView() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  const JAZZ = await page.evaluate(() => PRESETS.Jazz.join());
  await page.evaluate(() => { S.vocab = [...PRESETS.Jazz]; selectTab('right', 'swaps'); renderAll(); });
  await page.click('[data-simple]');
  const on = await page.evaluate(() => ({ cls: document.body.classList.contains('simple'), pressed: document.querySelector('#simpleToggle').getAttribute('aria-pressed'), vocab: S.vocab.length, saved: (S.vocabFull || []).join(), hidden: ['.arr-toggle', '.mel-toggle', '#tension', '#tab-swaps', '#tab-melody', '#tab-setkey', '#ideas', '#textEdit'].filter(q => document.querySelector(q)?.checkVisibility()), right: document.querySelector('#tab-chord').getAttribute('aria-selected'), next: document.querySelector('#nextPick').checkVisibility(), legend: document.querySelector('.simple-legend').checkVisibility() }));
  check('simple: the switch hides the advanced tools, keeps plain triads, and shows the jobs legend and next-chord chooser', on.cls && on.pressed === 'true' && on.vocab === 0 && on.saved === JAZZ && on.hidden.length === 0 && on.right === 'true' && on.next && on.legend, JSON.stringify(on));
  await page.evaluate(() => { S.tonic = 7; S.mode = 'ionian'; chords = parseProg('G | C | D | Em | Am | Bm | B7 | Cm').chords; sel = chords[2].id; commit(); });
  const jobs = await page.evaluate(() => ({ jobs: chords.map(c => jobOf(c)).join(' '), labels: [...document.querySelectorAll('#rows .slot .cr')].map(e => e.textContent).join(' '), cls: document.querySelector('#rows .slot').classList.contains('j-home') }));
  check('simple: each chord gets its job (Home, Away, Pull, Surprise) as its colour and label', jobs.jobs === 'home away pull home away home pull surprise' && jobs.labels === 'Home Away Pull Home Away Home Pull Surprise' && jobs.cls, JSON.stringify(jobs));
  const why = await page.evaluate(() => [2, 6, 7].map(i => jobSentence(chords[i])));
  check('simple: the Chord panel says what the chord does in plain words', /^D is Pull in G major: it leans back toward G/.test(why[0]) && /B7 is a Pull, but not toward home: it leans toward Em/.test(why[1]) && /borrowed from G minor/.test(why[2]) && await page.evaluate(() => /D is Pull/.test(document.querySelector('#detail .simple-why').textContent) && !document.querySelector('#detail .dnum').checkVisibility()), why.join(' | '));
  const n1 = await page.evaluate(() => ({ title: document.querySelector('#nextPick h3').textContent, names: document.querySelector('#nextPick')._opts.map(o => o.job + ':' + o.name).join(' ') }));
  check('simple: after D (Pull) it offers G (Home), C (Away) and D7 (Pull)', n1.title === 'What comes after D?' && n1.names === 'home:G away:C pull:D7', JSON.stringify(n1));
  await page.evaluate(() => { sel = chords[6].id; renderAll(); });
  const n2 = await page.evaluate(() => document.querySelector('#nextPick')._opts.map(o => o.name).join(' ') + ' | ' + document.querySelector('#nextPick .np p').textContent);
  check('simple: after B7 the Home choice is Em, where it leans', /^Em C D \| B7 → Em: the pull resolves where it was leaning/.test(n2), n2);
  await page.evaluate(() => { chords = parseProg('G').chords; sel = chords[0].id; commit(); });
  await page.click('#nextPick [data-np="add"][data-k="1"]');
  await page.click('#nextPick [data-np="add"][data-k="2"]');
  await page.click('#nextPick [data-np="add"][data-k="0"]');
  check('simple: Add builds the song one chord at a time (G → C → D → G)', await page.evaluate(() => chords.map(c => chordName(c)).join(' ')) === 'G C D G');
  await page.check('#simpleTheory');
  const th = await page.evaluate(() => ({ label: document.querySelector('#rows .slot:nth-of-type(3) .cr')?.textContent || [...document.querySelectorAll('#rows .slot .cr')].map(e => e.textContent)[2], why: jobSentence(chords[2]), dnum: document.querySelector('#detail .dnum').checkVisibility() }));
  check('simple: Show me the theory adds the numerals and the theory terms', th.label === 'Pull · V' && /In theory terms it’s V\./.test(th.why) && th.dnum, JSON.stringify(th));
  await page.uncheck('#simpleTheory');
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press('Control+z');
  check('simple: undo takes back the chord but keeps you in Simple view', await page.evaluate(() => S.simple && chords.length === 3));
  await page.evaluate(() => { selectTab('left', 'gen'); });
  await page.click('#gen');
  const gen = await page.evaluate(() => ({ simple: S.simple, triads: chords.filter(real).every(c => Q[c.q].iv.length === 3 && c.bass == null), n: chords.length }));
  check('simple: Generate makes plain triads', gen.simple && gen.triads && gen.n >= 4, JSON.stringify(gen));
  await page.click('#simpleToggle');
  const off = await page.evaluate(() => ({ cls: document.body.classList.contains('simple'), vocab: S.vocab.join(), saved: S.vocabFull, swaps: getComputedStyle(document.querySelector('#tab-swaps')).display !== 'none', labels: document.querySelector('#rows .slot .cr').textContent }));
  check('simple: switching back restores the chord families and the full tools', !off.cls && off.vocab === JAZZ && off.saved === null && off.swaps && !/Home|Away|Pull/.test(off.labels), JSON.stringify(off));
  await page.reload();
  check('simple: the choice is remembered', await page.evaluate(() => !S.simple && !document.body.classList.contains('simple')));
  await ctx.close();
}
/* tune ideas: clash fixes, filled leaps and decorated long notes, heard before they are used */
async function tuneIdeasSuite() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  /* C major: F♯ clashes with C on beat 1; E to G is a 3rd; G held 2 beats; C up to A is a 6th; A held 4 beats */
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; S.showMel = true; S.arrShow = false; chords = parseProg('C | F | G | C').chords; melody = [66, -1, 64, 67, -1, 60, 69, -1, -1, -1, 67, 65, 64, -1, -1, -1]; melAnd = []; sel = chords[0].id; melSel = { a: 0, b: 0, h: 0 }; commit(); renderMelPad(); });
  await page.click('#melPad [data-mp="tune"]');
  const list = await page.evaluate(() => $('#melPad')._tune.map(x => `${x.b}|${x.title}`));
  check('tune ideas: a clash gets the nearest chord tones and a lean-in, and is not decorated', list.length === 5 && /^2\.5\|Fill the 3rd/.test(list[3]) && /^3\|Give the long G/.test(list[4]) && /^0\|Move F♯ (up to G|down to E)$/.test(list[0]) && /^0\|Move F♯ (up to G|down to E)$/.test(list[1]) && /^0\|Lean in: (G|E) on the beat, then F♯$/.test(list[2]), list.join(' / '));
  await page.click('#melPad [data-mp="tunewhole"]');
  const all = await page.evaluate(() => $('#melPad')._tune.map(x => `${x.b}|${x.title}`).join(' / '));
  check('tune ideas: across the whole tune it finds the 3rd, the 6th and the long notes', /2\.5\|Fill the 3rd from E up to G with F/.test(all) && /5\.5\|Fill the 6th from C up to A with (E|F)/.test(all) && /6\|Give the long A a neighbour: A B A/.test(all) && /3\|Give the long G a neighbour/.test(all), all);
  const heard = await page.evaluate(() => { const got = []; const t = tone; window.tone = (m, at, d) => { got.push(m); }; const x = $('#melPad')._tune[0]; tuneHear(x, false); const now = got.slice(); got.length = 0; tuneHear(x, true); window.tone = t; return { now: now.join(), with: got.join() }; });
  check('tune ideas: Now and With it play the bar as it is and with the change', heard.now.split(',').includes('66') && !heard.with.split(',').includes('66') && heard.with.split(',').includes('67'), JSON.stringify(heard));
  const k3 = await page.evaluate(() => $('#melPad')._tune.findIndex(x => /Fill the 3rd/.test(x.title)));
  await page.click(`#melPad [data-ti="use"][data-k="${k3}"]`);
  const used = await page.evaluate(() => ({ and: melAnd[2], mel: melody.slice(0, 4).join(), lane: document.querySelector('#rows .mcell[data-mb="2"]').classList.contains('split'), still: $('#melPad')._tune.some(x => /Fill the 3rd/.test(x.title)) }));
  check('tune ideas: Use puts the passing note on the “and”, splits the cell, and the idea leaves the list', used.and === 65 && used.mel === '66,-1,64,67' && used.lane && !used.still, JSON.stringify(used));
  await page.keyboard.press('Control+z').catch(() => {});
  await page.evaluate(() => { document.activeElement.blur(); });
  await page.keyboard.press('Control+z');
  check('tune ideas: undo takes it back', await page.evaluate(() => !(melAnd[2] > 0)));
  const kc = await page.evaluate(() => $('#melPad')._tune.findIndex(x => /^Lean in/.test(x.title)));
  await page.click(`#melPad [data-ti="use"][data-k="${kc}"]`);
  const lean = await page.evaluate(() => ({ on: melody[0], and: melAnd[0], rel: melRel(mod(melody[0]), 0, 0), relAnd: melRel(66 % 12, 0, 0.5) }));
  check('tune ideas: Lean in puts a chord tone on the beat and the clash just after, as a passing note', [64, 67].includes(lean.on) && lean.and === 66 && lean.rel === 'tone' && lean.relAnd === 'pass', JSON.stringify(lean));
  await page.evaluate(() => { melody = [60, 62, 64, 65, 67, 65, 64, 62, 60, -1, 62, 64, 60, -1, -1, -1]; melAnd = []; commit(); tuneFor = { b0: 0, b1: 4 }; renderMelPad(); });
  check('tune ideas: a smooth stretch says there is nothing to suggest', await page.evaluate(() => $('#melPad')._tune.length === 0 && /Nothing to suggest here/.test(document.querySelector('.tune-ideas').textContent)));
  await page.click('#melPad [data-mp="close"]');
  check('tune ideas: closing the note pad closes the ideas', await page.evaluate(() => tuneFor === null && !document.querySelector('.tune-ideas')));
  await ctx.close();
}
/* the note pad: typing notes with sharps and flats, and picking a note or octave from menus */
async function melodyInput() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  await page.evaluate(() => { S.tonic = 0; S.mode = 'ionian'; S.showMel = true; S.arrShow = false; chords = parseProg('C | F | G | C').chords; melody = []; melAnd = []; sel = chords[0].id; melSel = { a: 0, b: 0, h: 0 }; commit(); renderMelPad(); });
  await page.fill('#mpType', 'F# G Bb A');
  const read = await page.textContent('#mpTypeRead');
  await page.press('#mpType', 'Enter');
  const put = await page.evaluate(() => ({ mel: melody.slice(0, 4).join(), sel: melSel.b, box: document.querySelector('#mpType').value }));
  check('melody input: Type notes reads sharps and flats, says how it reads them, and Enter puts them in, moving on to the next beat', /Reads as F♯ +G +B♭ +A from bar 1, beat 1/.test(read) && put.mel === '66,67,70,69' && put.sel === 4 && put.box === '', JSON.stringify({ read, put }));
  await page.evaluate(() => { melSel = { a: 5, b: 5, h: 0 }; renderMelPad(); });
  await page.fill('#mpType', 'E♭ - . D | (C D) E');
  await page.click('#melPad [data-mp="type"]');
  const bars = await page.evaluate(() => ({ mel: melody.slice(4, 12).join(), and8: melAnd[8] }));
  check('melody input: with bars it starts at the bar, fits each bar, and reads ♭ and (pairs)', bars.mel === '63,-1,,62,60,64,-1,-1' && bars.and8 === 62, JSON.stringify(bars));
  await page.fill('#mpType', 'F# H2 Bb');
  check('melody input: an unreadable note is named and nothing is put in', /Can’t read “H2”/.test(await page.textContent('#mpTypeRead')) && (await page.click('#melPad [data-mp="type"]'), await page.evaluate(() => melody.slice(0, 4).join())) === '66,67,70,69');
  await page.fill('#mpType', 'g');
  check('melody input: typing in the box doesn’t type into the lane', await page.evaluate(() => melody[melSel.b]) !== 67 || await page.evaluate(() => document.activeElement.id === 'mpType'));
  await page.fill('#mpType', '');
  await page.evaluate(() => { melSel = { a: 0, b: 0, h: 0 }; renderMelPad(); });
  const opts = await page.evaluate(() => [...document.querySelectorAll('#mpNoteSel option')].map(o => o.textContent).join(' '));
  await page.selectOption('#mpNoteSel', { label: 'G♭' });
  const pick = await page.evaluate(() => ({ m: melody[0], sel: melSel.b, shown: document.querySelector('#mpNoteSel').selectedOptions[0].textContent }));
  await page.selectOption('#mpOctSel', '5');
  const oct = await page.evaluate(() => ({ m: melody[0], sel: melSel.b }));
  check('melody input: the Note menu lists every spelling and keeps the octave; the Octave menu moves it; neither moves on', /rest C C♯ D♭ D D♯ E♭ E F F♯ G♭ G G♯ A♭ A A♯ B♭ B$/.test(opts) && pick.m === 66 && pick.sel === 0 && pick.shown === 'F♯' && oct.m === 78 && oct.sel === 0, JSON.stringify({ opts, pick, oct }));
  const btns = await page.evaluate(() => [...document.querySelectorAll('#melPad .mp-n')].map(b => b.textContent).join(' '));
  check('melody input: black-key buttons show both names', /D♭C♯/.test(btns) && /F♯G♭/.test(btns) && /B♭A♯/.test(btns), btns);
  await ctx.close();
}
/* the job colours (Home, Away, Pull, Surprise) as an option in the full view */
async function colorByJob() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  await page.evaluate(() => { S.tonic = 7; S.mode = 'ionian'; chords = parseProg('G | C | D | Cm').chords; sel = chords[2].id; selectTab('phone', 'p-chord'); commit(); });
  const before = await page.evaluate(() => ({ job: document.querySelector('#rows .slot').classList.contains('j-home'), legend: document.querySelector('.legend:not(.simple-legend)').checkVisibility(), pressed: (document.querySelector('#colorMenu').open = true, renderColorMenu(), document.querySelector('[data-colorby="kind"]').getAttribute('aria-pressed')) }));
  await page.click('#colorMenu summary'); await page.click('[data-colorby="job"]');
  const after = await page.evaluate(() => { const sl = [...document.querySelectorAll('#rows .slot')]; return { cls: sl.map(x => [...x.classList].find(c => c.startsWith('j-'))).join(' '), colors: sl.map(x => getComputedStyle(x).getPropertyValue('--k').trim()).join(' '), nums: sl.map(x => x.querySelector('.cr').textContent).join(' '), jl: document.querySelector('.simple-legend').checkVisibility(), kl: document.querySelector('.legend:not(.simple-legend)').checkVisibility(), theory: document.querySelector('#simpleTheory').checkVisibility(), pill: document.querySelector('#detail .job-line')?.textContent, swaps: getComputedStyle(document.querySelector('#tab-swaps')).display !== 'none', simple: S.simple }; });
  check('colour by job: the full view can colour chords Home / Away / Pull / Surprise and keep its numerals and tools', !before.job && before.legend && before.pressed === 'true' && after.cls === 'j-home j-away j-pull j-surprise' && /var\(--t-home\)|#34C77B/i.test(after.colors.split(' ')[0]) && after.nums === 'I IV V iv' && after.jl && !after.kl && !after.theory && /^Pull D is Pull in G major/.test(after.pill) && after.swaps && !after.simple, JSON.stringify({ before, after }));
  await page.reload();
  check('colour by job: the choice is remembered', await page.evaluate(() => S.colorBy === 'job' && document.body.classList.contains('jobcolors')));
  await page.evaluate(() => { S.quiz = true; renderAll(); });
  check('colour by job: the quiz still hides the colours', await page.evaluate(() => getComputedStyle(document.querySelector('#rows .slot')).getPropertyValue('--k').trim() === getComputedStyle(document.documentElement).getPropertyValue('--t-dia').trim() || /t-dia/.test(getComputedStyle(document.querySelector('#rows .slot')).getPropertyValue('--k'))));
  await page.evaluate(() => { S.quiz = false; renderAll(); });
  await page.evaluate(() => { document.querySelector('#colorMenu').open = true; renderColorMenu(); }); await page.click('[data-colorby="kind"]');
  check('colour by job: Where it’s from brings the source colours back', await page.evaluate(() => !document.body.classList.contains('jobcolors') && document.querySelector('.legend:not(.simple-legend)').checkVisibility()));
  await ctx.close();
}
/* your own colours, readable text on any of them, and Home following the key */
async function customColours() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  await page.evaluate(() => { S.colorBy = 'job'; S.tonic = 0; S.mode = 'ionian'; chords = parseProg('C | F | G | C\n[Key: D major]\nD | G | A | D').chords; sel = chords[0].id; selectTab('phone', 'p-chord'); commit(); });
  await page.click('[data-opencolors]');
  check('colours: Change the colours under the key opens the Colours menu', await page.evaluate(() => document.querySelector('#colorMenu').open && !!document.querySelector('#colorPop [data-col="away"]')));
  await page.evaluate(() => { const i = document.querySelector('#colorPop [data-col="away"]'); i.value = '#1f3a93'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  const own = await page.evaluate(() => { const f = document.querySelector('#rows .slot.j-away'), cs = getComputedStyle(f); return { bg: cs.backgroundColor, ink: cs.color, saved: S.colors.away, sw: getComputedStyle(document.querySelector('.simple-legend .j-away'), '::before').backgroundColor }; });
  check('colours: a colour you choose is used in the chart and the key, with white text where dark text would be hard to read', own.bg === 'rgb(31, 58, 147)' && own.ink === 'rgb(255, 255, 255)' && own.saved === '#1f3a93' && own.sw === 'rgb(31, 58, 147)', JSON.stringify(own));
  const pale = await page.evaluate(() => { S.colors = { ...S.colors, pull: '#ffe4a0' }; renderAll(); return getComputedStyle(document.querySelector('#rows .slot.j-pull')).color; });
  check('colours: a pale colour keeps dark text', pale === 'rgb(20, 20, 20)', pale);
  await page.check('#keyHomeOn');
  const kh = await page.evaluate(() => { const sl = [...document.querySelectorAll('#rows .slot.j-home')].map(x => getComputedStyle(x).backgroundColor), hex = h => `rgb(${[1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(', ')})`; return { sl, c: hex(keyColor(0)), d: hex(keyColor(2)), keys: document.querySelectorAll('#colorPop [data-keycol]').length, homeSw: !!document.querySelector('#colorPop [data-col="home"]') }; });
  check('colours: with Home following the key, Home chords take their key’s colour, so the change to D shows', kh.sl.length === 4 && kh.sl[0] === kh.c && kh.sl[1] === kh.c && kh.sl[2] === kh.d && kh.sl[3] === kh.d && kh.c !== kh.d && kh.keys === 12 && !kh.homeSw, JSON.stringify(kh));
  await page.evaluate(() => { const i = document.querySelector('#colorPop [data-keycol="0"]'); i.value = '#0044cc'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); });
  const c0 = await page.evaluate(() => ({ slot: getComputedStyle(document.querySelector('#rows .slot.j-home')).backgroundColor, legend: getComputedStyle(document.documentElement).getPropertyValue('--t-home').trim() }));
  check('colours: giving C its own colour (blue) recolours C’s Home chords and the key', c0.slot === 'rgb(0, 68, 204)' && c0.legend === '#0044cc', JSON.stringify(c0));
  await page.evaluate(() => { document.activeElement.blur(); chords[1] = { ...chords[1], root: 2, q: 'm' }; pushHist(); commit(); });
  await page.keyboard.press('Control+z');
  await page.reload();
  check('colours: your colours are remembered and survive undo', await page.evaluate(() => S.colors.away === '#1f3a93' && S.keyHome && S.keyColors[0] === '#0044cc'));
  await page.evaluate(() => { document.querySelector('#colorMenu').open = true; renderColorMenu(); });
  await page.click('[data-colreset]'); await page.click('[data-keyreset]');
  check('colours: Reset brings back the starting colours', await page.evaluate(() => Object.keys(S.colors).length === 0 && S.keyColors === null && getComputedStyle(document.documentElement).getPropertyValue('--t-away').trim().toLowerCase() === '#3d86ff'));
  await page.keyboard.press('Escape');
  check('colours: Escape closes the menu', await page.evaluate(() => !document.querySelector('#colorMenu').open));
  await ctx.close();
}
/* reading comfort: Text size, nothing under 12px, controls big enough to hit, and a Play bar that keeps out of the way */
async function textSize() {
  const sizes = page => page.evaluate(() => { const els = [...document.querySelectorAll('body *')].filter(e => e.checkVisibility() && [...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim()) && !e.closest('svg')); return els.map(e => parseFloat(getComputedStyle(e).fontSize)); });
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL_);
  const n0 = await sizes(page);
  check('text size: at Normal nothing on screen is under 12px', Math.min(...n0) >= 12, String(Math.min(...n0)));
  const hint0 = await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.hint')).fontSize));
  await page.click('#textSize');
  const l = await page.evaluate(() => ({ fs: getComputedStyle(document.documentElement).getPropertyValue('--fs').trim(), label: document.querySelector('#textSizeLabel').textContent, hint: parseFloat(getComputedStyle(document.querySelector('.hint')).fontSize), btn: document.querySelector('#play').getBoundingClientRect().height }));
  await page.click('#textSize');
  const xl = await page.evaluate(() => ({ label: document.querySelector('#textSizeLabel').textContent, hint: parseFloat(getComputedStyle(document.querySelector('.hint')).fontSize), hs: document.documentElement.scrollWidth > innerWidth, compact: document.body.classList.contains('dock-compact'), dockRow: Math.abs(document.querySelector('#play').getBoundingClientRect().top - document.querySelector('#exportBtn').getBoundingClientRect().top) < 20 }));
  check('text size: Text cycles Normal → Large → Largest, scaling the text', l.label === 'Text: Large' && l.fs === '1.2' && Math.abs(l.hint - hint0 * 1.2) < .6 && xl.label === 'Text: Largest' && Math.abs(xl.hint - hint0 * 1.4) < .6, JSON.stringify({ hint0, l, xl }));
  check('text size: at Largest the laptop layout has no sideways scroll and the Play bar keeps to one row', !xl.hs && xl.compact && xl.dockRow, JSON.stringify(xl));
  await page.reload();
  check('text size: the choice is remembered', await page.evaluate(() => S.textSize === 1.4 && document.querySelector('#textSizeLabel').textContent === 'Text: Largest'));
  await page.click('#textSize');
  check('text size: and goes back round to Normal', await page.evaluate(() => S.textSize === 1));
  const small = await page.evaluate(() => { selectTab('phone', 'p-chord'); renderAll(); return [...document.querySelectorAll('.chip,.io-pair select,#detail select,.stepper button,.cp-x,.keytag,#tempo')].filter(e => e.checkVisibility()).filter(e => e.getBoundingClientRect().height < 35.5).map(e => (e.id || e.className) + ':' + Math.round(e.getBoundingClientRect().height)); });
  check('text size: chips, small menus, steppers and close buttons are at least 36px tall', small.length === 0, small.join(' '));
  await ctx.close();
  /* a laptop zoomed to 200%: a short window */
  const z = await openPage({ viewport: { width: 720, height: 450 } });
  await z.page.goto(URL_);
  const zr = await z.page.evaluate(() => ({ compact: document.body.classList.contains('dock-compact'), dock: document.querySelector('#dock').getBoundingClientRect().height, inst: document.querySelector('#instrument').checkVisibility(), hs: document.documentElement.scrollWidth > innerWidth }));
  await z.page.click('#dockMore');
  const zo = await z.page.evaluate(() => ({ inst: document.querySelector('#instrument').checkVisibility(), style: document.querySelector('#pstyle').checkVisibility(), label: document.querySelector('#dockMore').textContent, exp: document.querySelector('#dockMore').getAttribute('aria-expanded') }));
  check('short screen: the Play bar shrinks to one row (Play, tempo, More, Export), and More shows the rest', zr.compact && zr.dock < 70 && !zr.inst && !zr.hs && zo.inst && zo.style && zo.label === 'Less' && zo.exp === 'true', JSON.stringify({ zr, zo }));
  await z.ctx.close();
  /* a phone with Largest text */
  const ph = await openPage({ viewport: { width: 390, height: 844 } });
  await ph.page.goto(URL_);
  await ph.page.evaluate(() => { S.textSize = 1.4; renderAll(); });
  await ph.page.waitForTimeout(100);
  const pr = await ph.page.evaluate(() => ({ hs: document.documentElement.scrollWidth > innerWidth, compact: document.body.classList.contains('dock-compact') }));
  const pn = await ph.page.evaluate(() => { S.textSize = 1; renderAll(); return new Promise(r => requestAnimationFrame(() => r(document.body.classList.contains('dock-compact')))); });
  check('text size: on a phone, Largest fits the width and uses the one-row Play bar; Normal keeps the usual two rows', !pr.hs && pr.compact && !pn, JSON.stringify({ pr, pn }));
  await ph.ctx.close();
}
async function playbackFeedback() {
  const { ctx, page } = await openPage();
  await page.goto(URL_);
  /* every note the synth is asked for, with its start relative to now */
  const rec = () => page.evaluate(() => { window.__log = []; for (const f of ['tone', 'pluck']) { const o = window['__' + f] || (window['__' + f] = window[f]); window[f] = (m, t, ...x) => { window.__log.push({ m, t: t - actx.currentTime }); return o(m, t, ...x); }; } });
  await rec();
  const pins = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms)), first = () => { const t0 = Math.min(...__log.map(e => e.t)); return __log.filter(e => e.t < t0 + .2).map(e => e.m).sort((a, b) => a - b).join(); };
    chords = parseProg('C | G | Am | F').chords; S.instrument = 'piano'; S.pstyle = 'block'; renderAll();
    const c = chords[0], sh = guitarShapes({ root: c.root, q: c.q, bass: null })[2]; c.gpin = { t: S.tuning, cp: 0, fr: sh.fr.slice() }; renderAll();
    __log = []; playChart(); await wait(150); stopAll(); const gOnPiano = first(), gWant = shapeVoicing(sh.fr).all.sort((a, b) => a - b).join();
    delete c.gpin; const pv = pianoVoicings(c)[3]; c.ppin = { bass: pv.bass, rh: pv.rh.slice() }; S.instrument = 'guitar'; renderAll();
    __log = []; playChart(); await wait(150); stopAll(); const pOnGuitar = first(), pWant = [pv.bass, ...pv.rh].sort((a, b) => a - b).join();
    S.instrument = 'piano'; delete c.ppin; renderAll(); return { gOnPiano, gWant, pOnGuitar, pWant };
  });
  check('feedback: a pinned guitar shape is what the piano plays when the sound is Piano', pins.gOnPiano === pins.gWant, JSON.stringify(pins));
  check('feedback: a pinned piano voicing is what the guitar plays when the sound is Guitar', pins.pOnGuitar === pins.pWant, JSON.stringify(pins));
  const live = await page.evaluate(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms));
    chords = parseProg('C | G | Am | F').chords; S.tempo = 120; S.loop = true; S.meter = '4/4'; renderAll();
    playChart(); await wait(700); __log = [];
    sel = chords[0].id; addChordHere(parseProg('E7').chords[0]); await wait(120);
    const e7 = __log.some(e => e.t > .9 && e.t < 1.6 && e.m % 12 === 8), restruck = __log.some(e => e.t < .2 && e.m % 12 === 0), hl = document.querySelector('.slot.playing')?.dataset.id === chords[0].id;
    __log = []; sel = chords[2].id; renderAll(); await wait(50); const quiet = __log.length === 0, hl2 = !!document.querySelector('.slot.playing');
    stopAll(); return { e7, restruck, hl, quiet, hl2 };
  });
  check('feedback: a chord added while playing is heard in this pass, not only after the loop comes round', live.e7 && live.restruck, JSON.stringify(live));
  check('feedback: the playing chord stays lit through an edit, and selecting a chord does not restart playback', live.hl && live.quiet && live.hl2, JSON.stringify(live));
  const meter = await page.evaluate(() => { S.meter = '7/8'; chords = parseProg('C | G').chords; renderAll(); const a = styleEvents(playedVoicing(chords[0]), chords[0].beats, 0).map(e => e.at).join();
    S.meter = '4/4'; chords = parseProg('C | G').chords; renderAll(); const b = styleEvents(playedVoicing(chords[0]), chords[0].beats, 0).map(e => e.at).join(); return { a, b }; });
  check('feedback: in 7/8 block chords are struck on each group (2+2+3); 4/4 still holds one chord per bar', meter.a === '0,2,4' && meter.b === '0', JSON.stringify(meter));
  const keys = await page.evaluate(() => ['C G', 'C | G | C | G', 'Am G', 'Dm G C'].map(t => { const k = guessKey(parseProg(t).chords); return SHARP[k.t] + ' ' + k.m; }).join('; '));
  check('feedback: a two-chord loop reads from its first chord (C G is I V in C), and ii V I still finds C', keys === 'C ionian; C ionian; A aeolian; C ionian', keys);
  check('feedback: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}
async function liveChord() {
  const { ctx, page } = await openPage();
  await page.goto(URL_);
  check('live: the live chord bar is hidden until a MIDI input is chosen', await page.evaluate(() => document.querySelector('#live').hidden));
  const r = await page.evaluate(async () => {
    const w = ms => new Promise(r => setTimeout(r, ms)), on = m => midiInMessage([0x90, m, 90]), off = m => midiInMessage([0x80, m, 0]), ped = v => midiInMessage([0xB0, 64, v]);
    const name = () => document.querySelector('#live .lv-name')?.textContent || '', o = {};
    chords = parseProg('C | Am | F | G').chords; S.tonic = 0; S.mode = 'ionian'; sel = chords[3].id; renderAll();
    midiInUse({ name: 'Test keyboard', onmidimessage: null });
    o.shown = !document.querySelector('#live').hidden; o.idle = document.querySelector('#live').textContent;
    on(48); on(52); await w(20); o.early = name(); on(55); on(58); await w(150);
    o.held = name(); o.num = document.querySelector('#live .lv-num')?.textContent; o.lit = document.querySelector('#live').classList.contains('on'); o.bg = document.querySelector('#live').style.getPropertyValue('--k');
    [48, 52, 55, 58].forEach(off); await w(150); o.last = name(); o.tag = document.querySelector('#live .lv-tag').textContent;
    ped(127); on(48); on(52); on(55); on(57); await w(150); o.c6 = name(); o.also = document.querySelector('#live small')?.textContent || ''; [48, 52, 55, 57].forEach(off); on(41); await w(150); o.pedal = name();
    off(41); ped(0); on(43); on(47); on(50); await w(150); o.lifted = name();
    const n = chords.length; document.querySelector('#live [data-live-add]').click(); o.added = chords.length === n + 1 && chordName(chords.find(c => c.id === sel)) === 'G';
    [43, 47, 50].forEach(off); midiInUse(null); o.gone = document.querySelector('#live').hidden; return o;
  });
  check('live: choosing an input shows the bar, asking for a chord', r.shown && /Play a chord/.test(r.idle), JSON.stringify(r));
  check('live: the name waits for the chord to settle, then shows it, lit, with its numeral in the key and its colour', r.early === '' && r.held === 'C7' && r.num === 'V7/IV' && r.lit && !!r.bg, JSON.stringify(r));
  check('live: after the keys are let go the last chord stays, marked Last', r.last === 'C7' && r.tag === 'Last', JSON.stringify(r));
  check('live: notes held by the sustain pedal count, with other names for the same notes', r.c6 === 'C6' && /Also could be Am7\/C/.test(r.also) && r.pedal === 'Fmaj9', JSON.stringify(r));
  check('live: lifting the pedal drops the sustained notes', r.lifted === 'G', JSON.stringify(r));
  check('live: Add to chart puts the chord after the selected one, and the bar goes when MIDI in is off', r.added && r.gone, JSON.stringify(r));
  check('live: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}
  /* Hear what I play: keys sound through the app while held, the pedal holds them, and the switch turns it off */
  { const { ctx, page } = await openPage(); await page.goto(URL_);
    const r = await page.evaluate(async () => {
      const w = ms => new Promise(r => setTimeout(r, ms)), o = {}; let log = [];
      const ot = window.tone, op = window.pluck; window.tone = (m, t, d, v, out) => { log.push({ f: 't', m, v }); return ot(m, t, d, v, out); }; window.pluck = (m, t, d, v, out) => { log.push({ f: 'p', m, v }); return op(m, t, d, v, out); };
      const on = (m, v = 100) => midiInMessage([0x90, m, v]), off = m => midiInMessage([0x80, m, 0]), ped = v => midiInMessage([0xB0, 64, v]);
      S.instrument = 'piano'; midiInUse({ name: 'Test keyboard', onmidimessage: null }); await w(50);
      o.def = S.hearIn && document.querySelector('#midiHear').checked;
      on(60, 120); on(64, 30); o.sounded = log.map(e => e.f + e.m).join(); o.louder = log[0].v > log[1].v; o.voices = MIDIIN.voices.size;
      off(60); o.afterOff = MIDIIN.voices.has(60) ? 'still' : 'gone';
      ped(127); off(64); o.pedalHeld = MIDIIN.voices.has(64); ped(0); o.pedalLift = MIDIIN.voices.has(64);
      S.instrument = 'guitar'; log = []; on(52); off(52); o.guitar = log.map(e => e.f).join();
      S.instrument = 'piano'; document.querySelector('#midiHear').click(); log = []; on(62); off(62); o.offSilent = log.length === 0 && !S.hearIn;
      document.querySelector('#midiHear').click(); midiInUse(null); window.tone = ot; window.pluck = op; return o;
    });
    check('hear: on by default, each key sounds as it is pressed, louder when struck harder', r.def && r.sounded === 't60,t64' && r.louder && r.voices === 2, JSON.stringify(r));
    check('hear: letting go stops the note; the sustain pedal holds it until it lifts', r.afterOff === 'gone' && r.pedalHeld && !r.pedalLift, JSON.stringify(r));
    check('hear: keys use the Play bar’s sound, and the switch turns them off', r.guitar === 'p' && r.offSilent, JSON.stringify(r));
    check('hear: no page errors', page.errors.length === 0, page.errors.join(' | '));
    await ctx.close(); }
  /* MIDI in and out live in Chart tools; a browser without Web MIDI says so there instead */
  { const { ctx, page } = await openPage(); await page.goto(URL_);
    const r = await page.evaluate(() => ({ inTools: !!document.querySelector('#chartTools #midiInWrap') && !!document.querySelector('#chartTools #midiOutWrap'), none: document.querySelector('#midiNone').hidden }));
    check('midi place: MIDI in and out are in Chart tools, with no "can’t connect" note where Web MIDI exists', r.inTools && r.none, JSON.stringify(r));
    await ctx.close(); }
  { const { ctx, page } = await openPage(); await ctx.addInitScript(() => { delete Navigator.prototype.requestMIDIAccess; }); await page.goto(URL_);
    await page.click('#chartTools #midiNone').catch(() => {});
    const r = await page.evaluate(() => ({ note: !document.querySelector('#midiNone').hidden && document.querySelector('#midiNone').checkVisibility(), pairs: document.querySelector('#midiInWrap').hidden && document.querySelector('#midiOutWrap').hidden }));
    check('midi place: without Web MIDI, Chart tools says MIDI keyboards need Chrome or Edge', r.note && r.pairs, JSON.stringify(r));
    await ctx.close(); }
async function focusMode() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL_);
  const look = () => page.evaluate(() => ({ focus: document.body.classList.contains('focus'), rail: document.querySelector('.topbar').checkVisibility(), pane: [...document.querySelectorAll('.pane')].some(p => p.checkVisibility()), chartW: Math.round(document.querySelector('.center').getBoundingClientRect().width), dockL: Math.round(document.querySelector('#dock').getBoundingClientRect().left), label: document.querySelector('#focusLabel').textContent, pressed: document.querySelector('#focusBtn').getAttribute('aria-pressed') }));
  const before = await look();
  await page.click('#focusBtn'); const on = await look();
  check('focus: Focus hides the menus and side panel, and the chart and Play bar take the whole width', !before.focus && before.rail && on.focus && !on.rail && !on.pane && on.chartW > before.chartW + 300 && on.dockL === 0 && on.label === 'Show panels' && on.pressed === 'true', JSON.stringify({ before, on }));
  await page.reload(); await page.waitForTimeout(200);
  check('focus: it is remembered after a reload', (await look()).focus);
  await page.evaluate(() => document.querySelector('#rows .slot').focus()); await page.keyboard.press('\\');
  const off = await look();
  check('focus: \\ brings the panels back', !off.focus && off.rail && off.pane && off.label === 'Focus', JSON.stringify(off));
  await page.keyboard.press('\\'); await page.evaluate(() => revealEl(document.querySelector('#sideRight .panel') || document.querySelector('#sideRight')));
  check('focus: asking for something in a side panel brings the panels back', !(await look()).focus);
  await ctx.close();
  const p2 = await openPage({ viewport: { width: 390, height: 844 } }); await p2.page.goto(URL_);
  check('focus: phones have no Focus button (they show one screen at a time already)', await p2.page.evaluate(() => !document.querySelector('#focusBtn').checkVisibility()));
  check('focus: no page errors', page.errors.length === 0 && p2.page.errors.length === 0, page.errors.concat(p2.page.errors).join(' | '));
  await p2.ctx.close();
}
async function feedbackRound2() {
  const { ctx, page } = await openPage();
  await page.goto(URL_);
  const r = await page.evaluate(() => {
    const o = {}; chords = parseProg('C | G').chords; sel = chords[0].id; S.tonic = 0; S.mode = 'ionian'; renderAll();
    document.querySelector('#dia [data-pal]:nth-child(6)').click();
    o.untouched = chords.map(c => chordName(c)).join(' '); o.bar = !document.querySelector('#palPick').hidden && /Picked: Am/.test(document.querySelector('#palPick').textContent);
    document.querySelector('#palPick [data-palput="after"]').click(); o.after = chords.map(c => chordName(c)).join(' ');
    document.querySelector('#dia [data-pal]:nth-child(4)').click(); document.querySelector('#palPick [data-palput="in"]').click(); o.into = chords.map(c => chordName(c)).join(' ');
    const lens = []; S.drone = false; S.bars = 16;
    for (const g of [['jazz'], ['blues'], ['funk', 'jazz', 'film']]) { S.genres = g; for (let i = 0; i < 12; i++) { generate(); lens.push(chords.reduce((a, c) => a + c.beats, 0) / barLen()); } }
    S.bars = 4; S.genres = ['blues']; for (let i = 0; i < 12; i++) { generate(); lens.push(chords.reduce((a, c) => a + c.beats, 0) / barLen() * 4); }
    o.lens = [...new Set(lens)].join(); S.genres = []; S.bars = 4;
    o.tab = document.querySelector('#tab-gen').textContent;
    return o;
  });
  check('round 2: tapping a chord in Keys and modes plays it and holds it; the chart changes only on Add after or Put in', r.untouched === 'C G' && r.bar && r.after === 'C Am G' && r.into === 'C F G', JSON.stringify(r));
  check('round 2: Generate fills the chosen length, whichever genres are picked (16 bars with Jazz or Blues; 4 with Blues)', r.lens === '16', r.lens);
  check('round 2: the Create tab for new chords is called Generate', r.tab === 'Generate', r.tab);
  const strip = await page.evaluate(async () => { chords = parseProg('G | C').chords; S.tonic = 7; renderAll(); markPlaying(chords[0].id); await new Promise(r => setTimeout(r, 600)); const el = document.querySelector('.slot.playing'), sh = getComputedStyle(el).boxShadow, ink = getComputedStyle(document.body).color; markPlaying(null); return { sh, ink }; });
  check('round 2: the playing strip is drawn in the ink colour, not the play green that matched Home', strip.sh.startsWith(strip.ink.replace('rgb(', 'rgb(')) && /-8px/.test(strip.sh), JSON.stringify(strip));
  const empty = await page.evaluate(() => { chords = parseProg('G | B7 | Em | Cm | G | F#m7b5 | Am7 | Cmaj7 | Bm | D7 | F#dim7 | ?').chords; S.tonic = 7; S.mode = 'ionian'; renderAll(); const gs = suggestions(11).groups.filter(g => g.id === 'dia' || g.id === 'after'); return [...new Set(gs.flatMap(g => g.items.map(i => chordName(i.chords[0]))))].filter(n => /^(G|A|B|C|D|E|F♯)m?(maj7|7|m7|m7♭5)?$/.test(n)).join(' '); });
  check('round 2: an empty slot offers every chord of the key (Em7 after F♯°7 included)', new Set(empty.split(' ').map(n => n.match(/^[A-G]♯?/)[0])).size === 7 && /Em/.test(empty), empty);
  const noTune = await page.evaluate(() => { chords = parseProg('C | Am | F | G7').chords; melody = []; melAnd = []; S.tonic = 0; S.mode = 'ionian'; S.showMel = true; S.arrShow = true; const o = {};
    for (const k of ['close', 'barber', 'choir', 'drop2']) { S.arr = k; arrCache = {}; const ar = arrange(k); o[k] = ar.lines.every(l => l.length >= 4); }
    S.arr = 'close'; renderAll(); o.ghost = document.querySelectorAll('#rows .mcell .ghost').length; o.hint = /No tune yet/.test(document.querySelector('#arrBar').textContent); o.untouched = melody.length === 0;
    S.arrShow = false; S.showMel = false; renderAll(); return o; });
  check('round 2: close harmony, barbershop, choir and drop 2 arrange a chart with no tune, singing a chord-tone line shown in grey', noTune.close && noTune.barber && noTune.choir && noTune.drop2 && noTune.ghost >= 4 && noTune.hint && noTune.untouched, JSON.stringify(noTune));
  check('round 2: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}
async function keyCentresSuite() {
  const { ctx, page } = await openPage({ viewport: { width: 1400, height: 1000 } });
  await page.goto(URL_);
  const r = await page.evaluate(() => {
    const read = t => { chords = parseProg(t).chords; renderAll(); return chords.map((c, i) => chordName(c) + ':' + analyze(c).num + ':' + analyze(c).kind).join(' '); };
    const o = {}; S.tonic = 3; S.mode = 'ionian'; S.centres = true;
    o.gs = read('B D7 | G Bb7 | Eb | Am7 D7\nG Bb7 | Eb F#7 | B | Fm7 Bb7\nEb | Am7 D7 | G | C#m7 F#7\nB | Fm7 Bb7 | Eb | C#m7 F#7');
    o.tags = [...document.querySelectorAll('#rows .kc-auto')].map(x => x.textContent).slice(0, 5).join(' ');
    o.why = document.querySelector('#progWhy').textContent;
    S.tonic = 0; o.lone = read('C | Bb7 | Eb | G7'); o.dia = read('C | Gm7 C7 | F | G7'); o.iiV = read('C | Ebm7 Ab7 | Db | G7');
    o.plainTags = document.querySelectorAll('#rows .kc-auto').length;
    S.tonic = 7; o.parallel = read('Gmaj7 | D7 | Gm7 | C7'); o.chain = read('Gmaj7 | E7 A7 | Dm7 G7 | Cmaj7'); S.tonic = 0;
    S.centres = false; o.off = read('C | Ebm7 Ab7 | Db | G7'); S.centres = true;
    chords = parseProg('C | F\n[Key: Eb major]\nEb | Bb7 | Eb').chords; renderAll(); o.written = chords.map(c => analyze(c).num).join(' ');
    return o;
  });
  check('centres: Giant Steps reads as V7–I and ii–V–I into B, G and E♭, every chord in its key, spelled E♭ not D♯', !/sec|bor|chr/.test(r.gs) && /E♭:I:dia/.test(r.gs) && !/D♯/.test(r.gs) && /^B:I:dia D7:V7:dia G:I:dia B♭7:V7:dia/.test(r.gs), r.gs);
  check('centres: the chart marks where each centre starts, as in Roman-numeral analysis (B: I, G: V7, E♭: V7 …)', r.tags === 'B: G: E♭: G: E♭:', r.tags);
  check('centres: the summary names the centres and calls them Coltrane changes', /3 key centres/.test(r.why) && /Coltrane changes/.test(r.why), r.why);
  check('centres: a lone V7 of ♭III in a pop song stays a secondary dominant, not a key change', /E♭:♭III:bor/.test(r.lone) && !/E♭:I:/.test(r.lone), r.lone);
  check('centres: a ii–V to a chord already in the key changes nothing', /Gm7:v7:bor C7:V7\/IV:sec F:IV:dia/.test(r.dia) || !/D♭|G♭/.test(r.dia), r.dia);
  check('centres: a ii–V–I to a chord outside the key is read in that key (D♭: ii7 V7 I)', /E♭m7:ii7:dia A♭7:V7:dia D♭:I:dia G7:V7:dia/.test(r.iiV), r.iiV);
  check('centres: borrowing from the parallel minor (D7 → Gm7 in G) is not a key change', !/G:i|harmonic/.test(r.parallel) && /Gm7:i7:bor|Gm7:i7/.test(r.parallel), r.parallel);
  check('centres: a minor 7th that is the ii of the next ii–V (E7 A7 Dm7 G7 C) is not taken as a new home', !/Dm7:i7:dia/.test(r.chain), r.chain);
  check('centres: turning Find key centres off reads everything in the key set for it', !/D♭:I:dia/.test(r.off), r.off);
  check('centres: a written key change still decides the key', r.written === 'I IV I V7 I', r.written);
  check('centres: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}
async function dragSuite() {
  const { ctx, page } = await openPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(URL_);
  const load = txt => page.evaluate(txt => { S.tonic = 0; S.mode = 'ionian'; S.showMel = false; S.foldForm = false; S.focus = true; applyFocus(); chords = parseProg(txt).chords; melody = []; melAnd = []; hist = []; sel = chords[0].id; formEdit = null; commit(); scrollTo(0, 0); }, txt);
  const names = () => page.evaluate(() => chords.map(c => (real(c) ? chordName(c) : '?') + ':' + c.beats).join(' '));
  const form = () => page.evaluate(() => sectionsOf().map(s => s.name || '-').join(','));
  const box = sel => page.locator(sel).first().boundingBox();
  /* a real mouse drag from the middle of one element to a fraction across another */
  const drag = async (from, to, fx = .5, { alt = false, fy = .5 } = {}) => {
    const a = await box(from), b = typeof to === 'string' ? await box(to) : to;
    await page.mouse.move(a.x + 12, a.y + a.height / 2); await page.mouse.down();
    await page.mouse.move(a.x + 30, a.y + a.height / 2 + 4, { steps: 3 });
    if (alt) await page.keyboard.down('Alt');
    await page.mouse.move(b.x + b.width * fx, b.y + b.height * fy, { steps: 8 }); await page.mouse.up();
    if (alt) await page.keyboard.up('Alt');
    await page.waitForTimeout(60);
  };
  const slot = i => `#rows .slot:not(.tie) >> nth=${i}`;
  await load('C | Am | F | ?');
  await drag(slot(0), slot(3), .5, { alt: true });
  check('drag: Option/Alt-dropping a chord on a blank fills the blank, so later bars stay put', await names() === 'C:4 Am:4 F:4 C:4', await names());
  await load('C | Am | F | ?');
  await drag(slot(3), slot(1), .5, { alt: true });
  check('drag: copying a blank onto a chord clears that chord, keeping its length', await names() === 'C:4 ?:4 F:4 ?:4', await names());
  await load('C | Am | F | G');
  await drag(slot(0), slot(2), .95, { alt: true });
  check('drag: a copy dropped on a chord’s edge goes in between', await names() === 'C:4 Am:4 F:4 C:4 G:4', await names());
  await load('C | Am | F | G');
  await drag(slot(0), slot(2), .7);
  check('drag: a plain drag still moves the chord', await names() === 'Am:4 F:4 C:4 G:4', await names());
  await load('C | Am | F | G');
  await drag(slot(0), { x: 1390, y: 10, width: 1, height: 1 });
  check('drag: letting go away from the chart changes nothing', await names() === 'C:4 Am:4 F:4 G:4', await names());
  await load('C | Am | F | G');
  await drag(slot(0), '#dock', .5);
  check('drag: letting go over the Play bar changes nothing', await names() === 'C:4 Am:4 F:4 G:4', await names());

  const T = '[Verse] C | Am | F | G\n[Chorus] F | G | C | C\n[Bridge] Am | Em | F | G';
  await load(T); await page.evaluate(() => { melody = [60]; commit(); });
  await drag('#formBar [data-fk="0"]', '#formBar [data-fk="2"]', .95);
  const moved = await page.evaluate(() => ({ f: sectionsOf().map(s => s.name).join(','), mel: melody.indexOf(60), open: !!formEdit }));
  check('section drag: a Song form chip dragged past another moves the section, its tune going with it', moved.f === 'Chorus,Bridge,Verse' && moved.mel === 32 && !moved.open, JSON.stringify(moved));
  await load(T);
  await drag('#formBar [data-fk="2"]', '#formBar [data-fk="0"]', .05, { alt: true });
  check('section drag: holding Option/Alt copies the section instead', await form() === 'Bridge,Verse,Chorus,Bridge', await form());
  await load(T);
  await drag('#rows .sec-label[data-sec="2"]', '#rows .row >> nth=0', .3, { fy: .2 });
  check('section drag: a section’s name in the chart drags too, dropping over the chart', await form() === 'Bridge,Verse,Chorus', await form());
  await load('C | Am | F | G\n[Chorus] F | G | C | C');
  await drag('#formBar [data-fk="0"]', '#formBar [data-fk="1"]', .95);
  check('section drag: an unnamed opening section that moves gets a name, so it stays its own section', await form() === 'Chorus,Section', await form());
  await page.evaluate(() => undo()); check('section drag: one Undo puts it back', await form() === '-,Chorus', await form());

  /* empty-slot ideas follow the chord before; bar 1 only matters for the loop back */
  const ideas = await page.evaluate(() => { S.tonic = 0; S.mode = 'aeolian'; chords = parseProg('Cm7 | D7/C | Ab7 Gm | Dm7b5 G7 | ?').chords; sel = chords.at(-1).id; commit();
    const { groups } = suggestions(chords.length - 1); return groups.map(g => ({ id: g.id, title: g.title, items: g.items.map(i => i.chords.map(chordName).join(' ')) })); });
  check('gap ideas: the last slot leads with what follows G7 (resolution, deceptive)', ideas[0].id === 'after' && ideas[0].title === 'After G7' && ideas[0].items.includes('Cm7') && ideas[0].items.includes('A♭maj7'), JSON.stringify(ideas[0]));
  const lead = ideas.find(g => g.id === 'lead');
  check('gap ideas: leading back to bar 1 is labelled as the loop back and comes later', lead && /at the top/.test(lead.title) && ideas.indexOf(lead) > 1, lead && lead.title);
  const all = ideas.flatMap(g => g.items);
  check('gap ideas: every chord of the key is still offered somewhere', ['Cm7', 'Dm7♭5', 'E♭maj7', 'Fm7', 'Gm7', 'A♭maj7', 'B♭7'].every(c => all.includes(c)), all.join(' '));
  const mid = await page.evaluate(() => { S.mode = 'ionian'; chords = parseProg('C | ? | F | G').chords; const { groups } = suggestions(1); return groups.map(g => g.id); });
  check('gap ideas: mid-chart, the key’s chords ranked against both neighbours still come first', mid[0] === 'dia', mid.join(','));
  await ctx.close();
}

async function launchSuite() {
  // 1.6 tap targets
  {
    const { ctx, page } = await openPage({ viewport: { width: 360, height: 740 }, hasTouch: true, isMobile: true, noReveal: true });
    await page.goto(URL_); const small = [];
    await page.click('#moreBtn');
    for (const t of ['p-create', 'p-chart', 'p-chord', 'p-tools']) { await page.click('#tab-' + t); await page.waitForTimeout(100);
      small.push(...await page.evaluate(() => [...document.querySelectorAll('button,a,summary,select,input,label.check')].filter(e => e.checkVisibility() && !(e.matches('input[type=checkbox]') && e.closest('label'))).map(e => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width > 0 && r.height < 32).map(([e, r]) => (e.id || e.className || e.tagName) + ':' + Math.round(r.height)))); }
    check('tap targets: nothing on any phone screen is under 32px tall', !small.length, [...new Set(small)].join(' '));
    await ctx.close();
  }
  // 1.7 support and feedback links, off until set
  {
    const { ctx, page } = await openPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(URL_);
    const extra = sel => page.evaluate(s => [...document.querySelectorAll(s)].map(a => a.textContent), sel);
    check('About: with no addresses set, no support or feedback links appear', !(await extra('.help-about a')).some(t => /Support|feedback/.test(t)));
    await page.route('**/index.html', async r => { const res = await r.fetch(); await r.fulfill({ response: res, body: (await res.text()).replace("SUPPORT_URL='', FEEDBACK_URL=''", "SUPPORT_URL='https://example.test/s', FEEDBACK_URL='https://example.test/f'") }); });
    const off = []; page.on('request', q => { if (q.url().includes('example.test')) off.push(q.url()); });
    await page.reload(); await page.waitForSelector('#rows .slot');
    const links = await page.evaluate(() => [...document.querySelectorAll('.help-about a')].filter(a => /example\.test/.test(a.href)).map(a => [a.textContent, a.target, a.rel].join('|')));
    check('About: set addresses show as safe new-tab links, and the app itself requests nothing from them', links.length === 2 && links.every(l => /Support|feedback/.test(l) && l.includes('_blank|noopener noreferrer')) && !off.length, links.join(' / '));
    await ctx.close();
  }
  // 1.5 MIDI for the newer names
  {
    const { ctx, page } = await openPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(URL_);
    const bytes = await page.evaluate(() => { chords = parseProg('C7b9#5 | Fmaj13#11 | Dm11b5 | G7sus4b9').chords; commit(); return Array.from(buildMidi(false)); });
    const ons = parseMidi(Uint8Array.from(bytes)).tracks.flat().filter(e => e.st === 0x90 && e.d[1] > 0).length;
    check('chord names: altered chords export to MIDI with all their voices', ons >= 12, String(ons));
    await ctx.close();
  }
  // 1.5 extended and altered chord names
  {
    const { ctx, page } = await openPage({ viewport: { width: 1280, height: 800 } });
    await page.goto(URL_);
    const names = '9 11 13 maj9 maj11 maj13 m9 m11 m13 7b9 7#9 7#11 7b13 7alt 7b9#5 7#5b9 7#5#9 7b5b9 7b5#9 7#9#11 7b9#11 9b5 9b13 13#9 13b5 13b9 13#11 maj9#11 maj13#11 maj7#11 maj7b5 m7#5 m9b5 m11b5 mMaj11 mMaj13 9sus4 13sus4 7sus4b9 6/9 add9 add11 add13 m(maj7) dim7 m7b5 ø9'.split(' ');
    const r = await page.evaluate(names => { S.tonic = 0; S.mode = 'ionian'; S.symStyle = 'standard'; const bad = [], ok = [];
      for (const q of names) for (const t of ['C' + q, 'F#' + q + '/Bb']) { const c = parseChord(t); if (!c) { bad.push(t + ':parse'); continue; }
        const c2 = { ...c, id: uid(), beats: 4 }, back = parseChord(chordName(c2).replace(/\s/g, ''));
        if (!back || back.q !== c.q || back.root !== c.root || (back.bass ?? null) !== (c.bass ?? null)) bad.push(t + ':roundtrip ' + chordName(c2));
        const a = analyze(c2); if (!a || !a.kind || !a.num) bad.push(t + ':analyze');
        if (Q[c.q].iv.length < 2) bad.push(t + ':iv'); if (!MXL_KIND[c.q]) bad.push(t + ':xml');
        if (!(NUMSFX[c.q] != null)) bad.push(t + ':numeral'); if (!Q[c.q].fam) bad.push(t + ':family'); ok.push(c2); }
      chords = ok; sel = ok[0].id; S.bars = ok.length; commit();
      let xml = ''; try { xml = buildMusicXML(); } catch (e) { bad.push('xml threw ' + e); }
      const harm = (xml.match(/<harmony/g) || []).length; return { bad, n: ok.length, harm, cn: document.querySelectorAll('#rows .slot').length, xmlOk: !new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror') }; }, names);
    check('chord names: extended and altered names parse, name back the same, and get a numeral, a family and a MusicXML kind', !r.bad.length, r.bad.slice(0, 12).join(' | '));
    check('chord names: every one reaches the MusicXML as a chord symbol, in valid XML', r.harm >= r.n && r.xmlOk && r.cn >= r.n, JSON.stringify({ harm: r.harm, n: r.n, xmlOk: r.xmlOk }));
    const safe = await page.evaluate(async () => { const out = []; for (const id of ['#rows .slot']) { const els = [...document.querySelectorAll(id)].slice(0, 40); for (const e of els) { e.click(); await new Promise(r => setTimeout(r, 8)); } } return out; });
    check('chord names: selecting each one, with its guitar and piano panels, raises no errors', !page.errors.length, page.errors.slice(0, 3).join(' | '));
    const limit = await page.evaluate(() => { S.vocab = ['sus', 'add']; const q = fitQ('7b9#5'), q2 = fitQ('maj13#11'); return { q, q2 }; });
    check('chord names: Chords allowed still limits them (they step down to a plainer chord)', limit.q !== '7b9#5' && limit.q2 !== 'maj13#11', JSON.stringify(limit));
    await ctx.close();
  }
  // 1.2 shared links
  {
    const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), head = src.slice(0, src.indexOf('</title>') + 2000);
    const need = ['name="description"', 'property="og:title"', 'property="og:description"', 'property="og:type"', 'property="og:url"', 'property="og:image"', 'name="twitter:card"', 'name="theme-color"', 'rel="icon"', 'rel="manifest"'];
    check('share tags: description, Open Graph, Twitter card, theme colour, icon and manifest are all in the head', need.every(t => head.includes(t)), need.filter(t => !head.includes(t)).join());
    const img = head.match(/og:image" content="https:\/\/[^/]+\/[^/]+\/([^"]+)"/)[1], r = await fetch(new URL(img, URL_));
    check('share tags: the preview image is served, 1200x630', r.status === 200 && (b => b.readUInt32BE(16) === 1200 && b.readUInt32BE(20) === 630)(Buffer.from(await r.arrayBuffer())), img);
  }
  // 1.3 install and offline
  {
    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8')), name = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/APP_NAME='([^']+)'/)[1];
    check('install: the manifest takes its name from the app, and all its icons exist', man.short_name === name && man.name === name + ' Workbench' && man.icons.every(i => fs.existsSync(path.join(ROOT, i.src))) && man.icons.some(i => i.purpose === 'maskable'));
    const hash = (await import('node:crypto')).createHash('sha256'); for (const f of ['index.html', 'guide.html', 'how-it-works.html', 'manifest.webmanifest']) hash.update(fs.readFileSync(path.join(ROOT, f)));
    check('offline: sw.js carries the current version (run docs-src/build.py after changing the app)', fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').includes(`VERSION='${hash.digest('hex').slice(0, 12)}'`));
    const { ctx, page } = await openPage({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'allow' });
    await page.goto(URL_);
    await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((_, no) => setTimeout(() => no(new Error('service worker never became ready')), 8000))]));
    await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true); await page.reload(); await page.waitForSelector('#rows .slot');
    await page.click('#play'); await page.waitForTimeout(300);
    const on = await page.evaluate(() => ({ slots: document.querySelectorAll('#rows .slot').length, playing: !!document.querySelector('.slot.playing') }));
    check('offline: the app loads and plays with no network', on.slots > 0 && on.playing && !page.errors.length, JSON.stringify({ ...on, e: page.errors }));
    await page.click('#play');
    const guide = await ctx.newPage(); const g = await guide.goto(URL_.replace('index.html', 'guide.html')).catch(() => null);
    check('offline: the help pages are there too', !!g && g.ok()); await ctx.close();
    const { ctx: c2, page: p2 } = await openPage({ viewport: { width: 1280, height: 800 } });
    await p2.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'serviceWorker', { get: () => undefined }); });
    await p2.goto(URL_); await p2.waitForSelector('#rows .slot');
    check('offline: with no service worker available the app loads with no errors', !p2.errors.length, p2.errors.join()); await c2.close();
  }
  // 1.1 phones open on the chart
  for (const [w, h] of [[360, 640], [320, 640], [390, 844]]) {
    const { ctx, page } = await openPage({ viewport: { width: w, height: h }, noReveal: true });
    await page.goto(URL_); await page.waitForTimeout(200);
    const r = await page.evaluate(() => { const a = document.querySelector('#rows .slot').getBoundingClientRect(), d = document.querySelector('#dock').getBoundingClientRect(); return { top: a.top, bottom: a.bottom, dock: d.top, over: document.documentElement.scrollWidth - innerWidth }; });
    check(`phone first screen (${w}x${h}): the first chord is fully above the Play bar, with no sideways scroll`, r.top >= 0 && r.bottom <= r.dock && r.over <= 0, JSON.stringify(r));
    if (w === 360) {
      const shut = await page.evaluate(() => !document.querySelector('#searchBtn').checkVisibility() && !document.querySelector('#library').checkVisibility());
      await page.click('#moreBtn');
      const open = await page.evaluate(() => ['#searchBtn', '#textSize', '#simpleToggle', '#library', '#helpMenu'].every(s => document.querySelector(s).checkVisibility()) && document.querySelector('#moreBtn').getAttribute('aria-expanded') === 'true');
      check('phone first screen: Search, Text, Simple view, Library and Help fold behind More', shut && open);
      const order = await page.evaluate(() => { const y = s => document.querySelector(s).getBoundingClientRect().top; return y('#rows') < y('#formBar') && y('#rows') < y('#exampleNote'); });
      check('phone first screen: Song form and the example note come after the chords', order);
      await page.evaluate(() => { document.querySelector('#formBar [data-fa="hidehint"]').click(); });
      await page.reload();
      check('Song form explainer: Got it dismisses it for good', await page.evaluate(() => !document.querySelector('.form-hint')));
    }
    await ctx.close();
  }
}

async function breakAway() {
  const { ctx, page } = await openPage({ viewport: { width: 1280, height: 800 } });
  await page.goto(URL_);
  const set = (txt, mel) => page.evaluate(([t, m]) => { pushHist(); S.tonic = 0; S.mode = 'ionian'; S.meter = '4/4'; chords = parseProg(t).chords; melody = m || []; melAnd = []; sel = chords[0].id; commit(); }, [txt, mel]);
  const rep = () => page.evaluate(() => { const r = baReport(); return { still: r.still, total: r.total, c: r.c, n: r.n, bars: r.bars }; });
  await set('C | G | Am | F', [60, 62, 64, 65, 67, 65, 64, 62, 69, 67, 65, 64, 65, 64, 62, 60]);
  check('break away: off until asked for', await page.evaluate(() => document.querySelector('#breakaway').hidden));
  await page.click('[data-fa=breakaway]');
  check('break away: an untouched chart follows the original in every bar', (await rep()).still === 4 && (await page.textContent('#breakaway')).includes('4 of 4 bars'));
  check('break away: bars are tagged in the chart with words', await page.evaluate(() => [...document.querySelectorAll('.ba-tag')].every(e => e.textContent === 'chords + notes')) && await page.locator('.ba-tag').count() === 4);
  await page.evaluate(() => transpose(5));
  check('break away: transposing does not count as moving away', (await rep()).still === 4 && (await rep()).n === 4);
  await page.evaluate(() => transpose(-5));
  await page.evaluate(() => { pushHist(); chords[0].q = 'maj7'; commit(); });
  check('break away: adding colour to a chord is not a change', (await rep()).c === 4);
  await set('F | G | Am | C', [60, 62, 64, 65, 67, 65, 64, 62, 69, 67, 65, 64, 65, 64, 62, 60]);
  const r1 = await rep();
  check('break away: changing a bar’s chord leaves its notes counted', !r1.bars[0].c && r1.bars[0].n && r1.c === 2 && r1.still === 4, JSON.stringify(r1));
  await set('Db | Ab | Bbm | Gb');
  const r2 = await rep();
  check('break away: all bars changed and no tune reads as moved away', r2.still === 0 && (await page.textContent('#breakaway')).includes('None of your 4 bars'), JSON.stringify(r2));
  await set('Am | F | C | G');
  const r3 = await rep();
  check('break away: a run moved elsewhere in the song still counts', r3.bars[0].c && r3.bars[1].c, JSON.stringify(r3.bars));
  await set('C | G | Am | F', [60, 62, 64, 65, 67, 65, 64, 62, 69, 67, 65, 64, 65, 64, 62, 60]);
  await page.click('#breakaway [data-ba=chord]');
  check('break away: Try swaps in a chord that moves that bar', !(await rep()).bars[0].c);
  check('break away: the swapped chord keeps the tune’s note', await page.evaluate(() => pcsOf(chords[0]).includes(0)));
  check('break away: bar 1 now reports notes only', (await page.textContent('#breakaway')).includes('Chords match in 3'));
  await page.evaluate(() => undo());
  await page.click('#breakaway li:first-child [data-ba=flip]');
  check('break away: flipping a bar takes it away from the original’s notes', !(await rep()).bars[0].n);
  check('break away: the flipped tune keeps its first note and stays in the key', await page.evaluate(() => melody[0] === 60 && melody.slice(0, 4).every(m => scaleSet().has(mod(m)))));
  await page.evaluate(() => undo());
  const li = page.locator('#breakaway li:first-child');
  await li.locator('[data-ba=late]').click();
  const r4 = await rep();
  check('break away: starting a bar a beat later keeps its notes but gives it a new rhythm', r4.bars[0].n && !r4.bars[0].r, JSON.stringify(r4.bars[0]));
  const before = await page.evaluate(() => JSON.stringify([chords, melody, S.tonic]));
  await page.click('#breakaway [data-ba=hear]');
  check('break away: the original plays and the chart is left alone', await page.evaluate(() => playing && baHearing) && before === await page.evaluate(() => JSON.stringify([chords, melody, S.tonic])));
  await page.click('#breakaway [data-ba=hear]');
  check('break away: the button stops the original', !(await page.evaluate(() => playing)));
  await page.reload();
  check('break away: the original survives a reload', (await page.locator('#breakaway').isVisible()) && (await page.evaluate(() => BA.chords.length === 4 && BA.melody.length === 16)));
  await page.click('#breakaway [data-ba=stop]');
  check('break away: stopping removes it and offers Undo', await page.evaluate(() => BA === null && !localStorage.getItem(BA_KEY)) && await page.locator('#toast button').isVisible());
  await page.click('#toast button');
  check('break away: Undo brings the original back', await page.evaluate(() => BA && !!localStorage.getItem(BA_KEY)));
  check('break away: no console errors', !page.errors.length, page.errors.join(' | '));
  await ctx.close();
}
async function tuneSuite() {
  const { ctx, page } = await openPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(URL_);
  const conv = (m, a) => page.evaluate(([m, a]) => JSON.stringify(tuneFromBeats(m, a)), [m, a]);
  const trim = l => { const o = l.map(x => x ?? null); while (o.length && o[o.length - 1] == null) o.pop(); return o; };
  const rt = (m, a) => page.evaluate(([m, a]) => beatsFromTune(tuneFromBeats(m, a)), [m, a]);
  check('tune: beat notes convert to timed notes', await conv([60, -1, null, 62], []) === '[{"t":0,"d":24,"m":60},{"t":36,"d":12,"m":62}]');
  check('tune: an "and" splits the beat', await conv([60], [64]) === '[{"t":0,"d":6,"m":60},{"t":6,"d":6,"m":64}]');
  check('tune: a hold carries the note on the "and"', await conv([60, -1], [64]) === '[{"t":0,"d":6,"m":60},{"t":6,"d":18,"m":64}]');
  check('tune: a hold after a rest becomes a rest', await conv([null, -1, 62], []) === '[{"t":24,"d":12,"m":62}]');
  check('tune: repeated pitches stay separate notes', JSON.parse(await conv([60, 60], [])).length === 2);
  const cases = [[[60, -1, null, 62, 64, -1, -1, null, 67, 65, null, 64], [null, 64, null, 65, null, null, null, null, 69]], [[69, -1, -1, 67, 65, -1, 65, null, 64, -1, 62, -1], [null, null, null, null, 67]], [[null, null, 60], [61]]];
  let same = true; for (const [m, a] of cases) { const r = await rt(m, a); if (JSON.stringify(trim(r.mel)) !== JSON.stringify(trim(m)) || JSON.stringify(trim(r.and)) !== JSON.stringify(trim(a))) same = false; }
  check('tune: holds, rests and split beats round-trip', same);
  check('tune: notes past the chart survive', (await rt([60, 62, 64, 65, 67], [])).mel.length === 5);
  check('tune: sanitize drops bad notes', await page.evaluate(() => JSON.stringify(sanitizeTune([{ t: 0, d: 12, m: 60 }, { t: -1, d: 12, m: 60 }, { t: 0, d: 0, m: 60 }, { t: 0, d: 12, m: 200 }, null]))) === '[{"t":0,"d":12,"m":60}]');
  // every saved form opens the same
  const M = [60, -1, 62, null, 64], A = [null, null, 63];
  const want = await page.evaluate(([m, a]) => JSON.stringify(tuneFromBeats(m, a)), [M, A]);
  const tuneNow = () => page.evaluate(() => JSON.stringify(tuneOfChart()));
  const CH = [{ root: 0, q: '', beats: 4 }, { root: 7, q: '', beats: 4 }];
  await page.evaluate(([c, m, a]) => localStorage.setItem('changes-v1', JSON.stringify({ S: { tonic: 0 }, chords: c, melody: m, melAnd: a })), [CH, M, A]);
  await page.reload();
  check('tune: an old session loads unchanged', await tuneNow() === want);
  await page.evaluate(() => save());
  const sv = await page.evaluate(() => JSON.parse(localStorage.getItem('changes-v1')));
  check('tune: new saves hold tune only', sv.v === 2 && Array.isArray(sv.tune) && !('melody' in sv) && !('melAnd' in sv));
  await page.reload();
  check('tune: a new save reloads unchanged', await tuneNow() === want);
  await page.evaluate(([c, m, a]) => libOpen(newItem('old', { S: { tonic: 0 }, chords: c, melody: m, melAnd: a })), [CH, M, A]);
  check('tune: an old library item opens unchanged', await tuneNow() === want);
  check('tune: library items save tune only', await page.evaluate(() => { const c = curSnap(); return c.v === 2 && Array.isArray(c.tune) && !('melody' in c); }));
  check('tune: an old share link opens unchanged', await page.evaluate(([m, a]) => { const d = readShare(b64url(JSON.stringify({ v: 1, k: 0, m: 'ionian', t: '4/4', b: 90, c: 'C | G', mel: m, ma: a }))); applyShare(d); return JSON.stringify(tuneOfChart()); }, [M, A]) === want);
  check('tune: a new share link round-trips', await page.evaluate(() => { const c = shareCode(), d = readShare(c); applyShare(d); return JSON.parse(unb64url(c)).v === 2 && JSON.stringify(tuneOfChart()); }) === want);
  await page.evaluate(([c, m, a]) => localStorage.setItem(BA_KEY, JSON.stringify({ S: { tonic: 0, meter: '4/4' }, chords: c, melody: m, melAnd: a })), [CH, M, A]);
  await page.reload();
  check('tune: a Break away original in the old form loads', await page.evaluate(() => !!BA && JSON.stringify(tuneOf(BA))) === want);
  check('tune: an imported library file keeps its melody', await page.evaluate(async ([c, m, a]) => { await libImportFile(new File([JSON.stringify({ items: [{ name: 'Imported tune', snap: { S: { tonic: 0 }, chords: c, melody: m, melAnd: a } }] })], 'x.json')); return JSON.stringify(readTune(LIB.items.find(i => i.name === 'Imported tune').snap)); }, [CH, M, A]) === want);
  check('tune: a damaged tune in a file keeps the good notes', await page.evaluate(() => readTune({ tune: [{ t: 0, d: 12, m: 60 }, 'x', { t: 12, d: 12, m: 999 }] }).length) === 1);
  await page.evaluate(() => { localStorage.clear(); });
  check('tune: no console errors', !page.errors.length, page.errors.join(' | '));
  await ctx.close();
}
async function searchSuite() {
  const { ctx, page } = await openPage({ viewport: { width: 1400, height: 900 } });
  await page.goto(URL_);
  const open = () => page.evaluate(() => !document.querySelector('#searchBox').hidden && document.activeElement === document.querySelector('#searchIn'));
  await page.click('#searchBtn'); const byBtn = await open(); await page.keyboard.press('Escape'); const closed = await page.evaluate(() => document.querySelector('#searchBox').hidden);
  await page.keyboard.press('Control+k'); const byKey = await open(); await page.keyboard.press('Escape');
  await page.evaluate(() => document.body.focus()); await page.keyboard.press('/'); const bySlash = await open();
  check('search: the Search button, Ctrl/⌘ K and / all open it with the cursor in the box; Esc closes it', byBtn && closed && byKey && bySlash);
  await page.keyboard.type('midi k'); const first = await page.evaluate(() => document.querySelector('#searchList [aria-selected=true]').textContent);
  check('search: words match by their starts, best first ("midi k" finds the MIDI keyboard)', /^MIDI keyboard in/.test(first), first);
  await page.keyboard.press('Enter'); await page.waitForTimeout(150);
  const went = await page.evaluate(() => ({ shut: document.querySelector('#searchBox').hidden, tools: document.querySelector('.chart-card').classList.contains('show-tools'), focus: document.activeElement.id, ring: !!document.querySelector('.found') }));
  check('search: Enter takes you to the control, opening Chart tools, focusing it and ringing it', went.shut && went.tools && went.focus === 'midiIn' && went.ring, JSON.stringify(went));
  await page.keyboard.press('Control+k'); await page.keyboard.type('tempo'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
  check('search: arrow keys move through the results', await page.evaluate(() => document.querySelector('#searchList [aria-selected=true]').textContent.startsWith('Tempo')));
  await page.fill('#searchIn', 'focus hide'); await page.keyboard.press('Enter');
  check('search: an action runs straight away (Focus hides the side menus)', await page.evaluate(() => document.body.classList.contains('focus')));
  await page.keyboard.press('\\');
  await page.keyboard.press('Control+k'); await page.keyboard.type('zzqx');
  check('search: no match says so', await page.evaluate(() => /Nothing called “zzqx”/.test(document.querySelector('#searchList').textContent)));
  await page.keyboard.press('Escape');
  const guide = await page.evaluate(() => { let url = null; const o = window.open; window.open = u => { url = u; }; goSearch(SEARCH.find(e => e[3] === 'guide#keys')); window.open = o; return url; });
  check('search: help topics open that part of the guide', guide === 'guide.html#keys', String(guide));
  const all = await page.evaluate(async () => { const bad = []; for (const e of SEARCH) { if (typeof e[3] !== 'string' || !e[3].startsWith('#')) continue; const el = document.querySelector(e[3]); if (!el) { bad.push(e[0]); continue; } goSearch(e); await new Promise(r => setTimeout(r, 30)); if (!el.checkVisibility()) bad.push(e[0]); } setSimple(false); return bad; });
  check('search: every place search can take you exists and is shown when you get there', all.length === 0, all.join(', '));
  check('search: no page errors', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}
async function appName() {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const name = src.match(/const APP_NAME='([^']+)'/)?.[1];
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  const got = await page.evaluate(() => ({ title: document.title, h1: document.querySelector('.brand h1').textContent, about: document.querySelector('#aboutRepo b').textContent, midi: APP_NAME, slug: APP_SLUG, xml: /<software>[^<]*<\/software>/.exec(buildMusicXML())?.[0] }));
  check('name: one constant names the page, header, About link and MusicXML', !!name && got.title === name + ' Workbench' && got.h1 === name && got.about === name + ' on GitHub' && got.xml === `<software>${name} Workbench</software>` && got.slug === name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), JSON.stringify(got));
  /* the text in the HTML before the script runs must match too, or a rename would flash the old name */
  const fallback = [src.match(/<title>([^<]*)<\/title>/)[1], src.match(/<meta property="og:title" content="([^"]*)"/)[1], src.match(/<h1 data-app-name>([^<]*)</)[1], ...[...src.matchAll(/<span data-app-name>([^<]*)</g)].map(m => m[1])];
  const stray = (src.match(new RegExp(name, 'g')) || []).length - 1 - fallback.length;
  check('name: the HTML fallbacks match the constant, and the name is written nowhere else', fallback[0] === name + ' Workbench' && fallback[1] === name + ' Workbench' && fallback.slice(2).every(f => f === name) && stray === 0, JSON.stringify({ fallback, stray }));
  const midiNames = await page.evaluate(() => { const b = buildMidi(false); const out = []; for (let i = 14; i < b.length - 3; i++) if (b[i] === 0xFF && b[i + 1] === 0x03) { out.push(new TextDecoder().decode(b.slice(i + 3, i + 3 + b[i + 2]))); break; } return out; });
  check('name: the MIDI file\'s first track carries the name', midiNames[0] === name, midiNames.join());
  for (const f of ['guide.html', 'how-it-works.html']) { const h = fs.readFileSync(path.join(ROOT, f), 'utf8'); check(`name: ${f} is built with the name and has no {APP} left`, h.includes(`<a class="name" href="./">${name}</a>`) && !h.includes('{APP}')); }
  await ctx.close();
}
async function eighthNotes() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 1000 } });
  await page.goto(URL_);
  await page.evaluate(() => { S.tonic = 9; S.mode = 'ionian'; S.meter = '4/4'; S.arrShow = false; S.pstyle = 'block'; S.showMel = false; chords = parseProg('A | D | A | E').chords; melody = []; melAnd = []; hist = []; renderAll(); });
  const fit = await page.evaluate(() => { const r = parseMelody('G# G# G# G# | G# A C# B A | A G# F# E C# E | A B A G# F#'), nm = pc => pc == null ? '' : prettyNote(spell(pc));
    return r.beats.map((b, i) => nm(b && b.pc) + (r.ands[i] != null ? '+' + nm(r.ands[i]) : '')).join(' '); });
  check('eighths: a bar with more notes than beats splits the weak beats, from beat 4 back (bar 2: beat 4; bar 3: beats 4 and 2)', fit === 'G♯ G♯ G♯ G♯ G♯ A C♯ B+A A G♯+F♯ E C♯+E A B A G♯+F♯', fit);
  const few = await page.evaluate(() => { const r = parseMelody('C E G | C'); return r.beats.map(b => b ? (b.onset ? prettyNote(spell(b.pc)) : '-') : '.').join(' '); });
  check('eighths: a bar with fewer notes puts them on the strong beats and holds them', few === 'C E G - C - - -', few);
  const grp = await page.evaluate(() => { const r = parseMelody('(C D) E F G | (E F) (G A) B C'); return r.beats.map((b, i) => prettyNote(spell(b.pc)) + (r.ands[i] != null ? '+' + prettyNote(spell(r.ands[i])) : '')).join(' '); });
  check('eighths: (A B) puts two notes in a beat where you say', grp === 'C+D E F G E+F G+A B C', grp);
  const legacy = await page.evaluate(() => parseMelody('C D E F G').beats.length);
  check('eighths: without bar lines it is still one note per beat', legacy === 5, String(legacy));
  await page.evaluate(() => { revealEl(document.querySelector('#melIn')); document.querySelector('#melIn').value = 'C D E F G A B C D | C'; });
  await page.click('#melGo');
  check('eighths: a bar with too many notes says which and how many fit', await page.evaluate(() => /Bar 1 has 9 notes; at most 8 fit in a bar of 4\/4/.test(document.querySelector('#melOut').textContent)));
  await page.evaluate(() => { document.querySelector('#melIn').value = 'G# G# G# G# | G# A C# B A | A G# F# E C# E | A B A G# F#'; });
  await page.click('#melToLane');
  const lane = await page.evaluate(() => ({ split: [...document.querySelectorAll('#rows .mcell.split')].map(c => c.dataset.mb).join(), notes: melNotes().length, halves: melNotes().filter(n => n.n === .5).length, top: Math.max(...melNotes().map(n => n.m)) }));
  check('eighths: Put in melody lane writes the split beats as split cells, all 20 notes, in a singable range', lane.split === '7,9,11,15' && lane.notes === 20 && lane.halves === 8 && lane.top <= 79, JSON.stringify(lane));
  // editing in the lane
  await page.click('#rows .mcell[data-mb="7"] [data-mh="1"]');
  check('eighths: tapping the second half of a split beat edits its “and”', await page.evaluate(() => melSel.h === 1 && /beat 4, the “and”/.test(document.querySelector('#melPad .mp-head').textContent)));
  await page.keyboard.press('g'); await page.keyboard.press('#');
  check('eighths: typing there sets that note (and # raises it)', await page.evaluate(() => mod(melAnd[7]) === 8 && melSel.b === 8 && melSel.h === 0));
  await page.click('#rows .mcell[data-mb="0"]'); await page.keyboard.press('/');
  check('eighths: / splits a beat, ready for its second note', await page.evaluate(() => melAnd[0] === melody[0] && melSel.h === 1 && !!document.querySelector('#rows .mcell[data-mb="0"].split')));
  await page.keyboard.press('b');
  check('eighths: the cursor then moves on to the next beat', await page.evaluate(() => mod(melAnd[0]) === 11 && melSel.b === 1));
  await page.keyboard.press('ArrowLeft');
  check('eighths: arrows step through the halves', await page.evaluate(() => melSel.b === 0 && melSel.h === 1));
  await page.keyboard.press('Delete');
  check('eighths: Delete on the “and” joins the beat again', await page.evaluate(() => !(melAnd[0] > 0) && !document.querySelector('#rows .mcell[data-mb="0"].split')));
  for (let i = 0; i < 5; i++) await page.keyboard.press('Meta+z');
  check('eighths: undo puts edits back, one step at a time', await page.evaluate(() => !(melAnd[0] > 0) && mod(melAnd[7]) === 9), await page.evaluate(() => JSON.stringify([melAnd[0], melAnd[7]])));
  // hearing it, harmonizing it, arranging it
  const pb = await page.evaluate(() => { const calls = []; const ot = tone; window.tone = (m, t, d) => calls.push(+d.toFixed(3)); playMelLine(0, .5, previewOut()); window.tone = ot; return { n: calls.length, short: calls.filter(d => d < .3).length }; });
  check('eighths: the melody plays its eighth notes at half a beat each', pb.n === 20 && pb.short === 8, JSON.stringify(pb));
  const ar = await page.evaluate(() => { S.showMel = true; S.arrShow = true; S.arr = 'strings'; renderAll(); const a = arrange(); return { tune: a.lines[a.mel].length, others: a.lines.every((l, k) => k === a.mel || l.every(n => Number.isInteger(n.b))) }; });
  check('eighths: in an arrangement the tune keeps its eighths and the other parts move on the beats', ar.tune === 20 && ar.others, JSON.stringify(ar));
  const xr = await page.evaluate(() => { S.arrShow = false; renderAll(); const d = new DOMParser().parseFromString(buildMusicXML(), 'application/xml'), mel = d.querySelector('part'); return { eighths: [...mel.querySelectorAll('note type')].filter(t => t.textContent === 'eighth').length, full: [...mel.querySelectorAll('measure')].every(m => [...m.querySelectorAll('note')].reduce((a, n) => a + +n.querySelector('duration').textContent, 0) === 16) }; });
  check('eighths: MusicXML writes real eighth notes in full bars', xr.eighths === 8 && xr.full, JSON.stringify(xr));
  const mid = parseMidi(Uint8Array.from(await page.evaluate(() => [...buildMidi(false)])));
  const mt = mid.tracks.find(t => t.some(e => e.meta === 3 && Buffer.from(e.data).toString() === 'Melody'));
  const offs = mt.filter(e => e.st === 0x90 && e.d[1] > 0).map(e => e.tick % 480);
  check('eighths: MIDI puts the second notes half a beat in', offs.filter(x => x === 240).length === 4 && offs.length === 20, JSON.stringify(offs));
  // keeping it
  await page.evaluate(() => { commit(); });
  await page.reload();
  check('eighths: split beats are saved with the chart', await page.evaluate(() => mod(melAnd[7]) === 9 && melNotes().length === 20));
  const kept = await page.evaluate(() => { const code = shareCode(); melAnd = []; applyShare(JSON.parse(atob(code.replace(/-/g, '+').replace(/_/g, '/')))); const viaShare = melNotes().length; const it = newItem('e', curSnap()); melAnd = []; libOpen(it); return { viaShare, viaLib: melNotes().length }; });
  check('eighths: share links and the Library carry them', kept.viaShare === 20 && kept.viaLib === 20, JSON.stringify(kept));
  check('eighths: transposing moves them', await page.evaluate(() => { const a = melAnd[7]; transpose(2); return melAnd[7] === a + 2; }));
  check('no console errors (eighth notes)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// the top-bar menus must be visible and on top at every width, not just "open"
async function menus() {
  for (const [w, h, tag] of [[1440, 900, 'desktop'], [1280, 720, 'small laptop'], [900, 900, 'tablet'], [390, 844, 'phone']]) {
    const { ctx, page } = await openPage({ viewport: { width: w, height: h }, noReveal: true });
    await page.goto(URL_);
    if (w < 760) await page.click('#moreBtn');
    for (const [id, inner] of [['library', '#libName'], ['helpMenu', '.helppop a']]) {
      await page.click(`#${id} > summary`);
      const r = await page.evaluate(s => { const e = document.querySelector(s), pop = e.closest('.libpop'), b = pop.getBoundingClientRect(), r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        return { onTop: !!hit && (e === hit || e.contains(hit)), inView: b.left >= 0 && b.right <= innerWidth + 0.5 && b.top >= 0 && b.bottom <= innerHeight + 0.5 }; }, inner);
      check(`menus: ${id === 'library' ? 'Library' : 'Help'} opens visibly and on top (${tag})`, r.onTop && r.inView, JSON.stringify(r));
      if (id === 'library') { await page.click(inner);  // reachable by a real click (Help's links would leave the page)
 await page.keyboard.press('Escape'); check(`menus: Escape closes the Library (${tag})`, await page.evaluate(() => !document.querySelector('#library').open)); }
      await page.evaluate(i => { document.getElementById(i).open = false; }, id);
    }
    await ctx.close();
  }
}

// layout: desktop columns, tablet drawer, phone screens, top bar, help pages
async function layout() {
  const { ctx, page } = await openPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(URL_);
  // one shell: the chart stays in the middle and the navigation rail picks what the side panel shows
  const vis = s => document.querySelector(s).checkVisibility();
  const panelState = () => page.evaluate(() => ({ chart: document.querySelector('#rows').checkVisibility(), create: document.querySelector('#sideLeft').checkVisibility(), chord: document.querySelector('#sideRight').checkVisibility(), tools: document.querySelector('#tools').checkVisibility(), chartX: document.querySelector('.chart-card').getBoundingClientRect().left, railRight: document.querySelector('#phoneTabs').getBoundingClientRect().right }));
  const d0 = await panelState();
  await page.click('#tab-p-create'); const d1 = await panelState();
  await page.click('#tab-p-tools'); const d2 = await page.evaluate(() => ({ tools: document.querySelector('#finder').checkVisibility(), chart: document.querySelector('#rows').checkVisibility() }));
  await page.click('#tab-p-chord');
  check('layout: desktop keeps the chart in view while the rail switches the side panel between Create, Chord and Tools', d0.chart && d0.chord && !d0.create && d1.chart && d1.create && !d1.chord && d2.tools && d2.chart && d0.railRight <= d0.chartX, JSON.stringify({ d0, d1, d2 }));
  check('layout: each screen is in the address, so it can be bookmarked', await page.evaluate(() => location.hash === '#chord'));
  await page.click('#library > summary');
  check('layout: Library opens from the navigation with save, list and import/export', await page.evaluate(() => document.querySelector('#libSaveBtn').checkVisibility() && document.querySelector('#libExport').checkVisibility() && !!document.querySelector('#topbar #library')));
  await page.mouse.click(700, 500);
  check('layout: clicking elsewhere closes the Library', await page.evaluate(() => !document.querySelector('#library').open));
  await page.click('#helpMenu > summary');
  const help = await page.evaluate(() => [...document.querySelectorAll('#helpMenu a:not(.help-about a)')].map(a => a.getAttribute('href')).join());
  check('layout: Help links to How to use and Under the hood', help === 'guide.html,how-it-works.html', help);
  for (const [f, h1] of [['guide.html', 'How to use Chord Changes'], ['how-it-works.html', 'How Chord Changes works']]) {
    const p2 = await ctx.newPage(); const errs = []; p2.on('pageerror', e => errs.push(String(e)));
    const r = await p2.goto(URL_.replace('index.html', f));
    const info = await p2.evaluate(() => ({ h1: document.querySelector('h1').textContent, back: !!document.querySelector('a[href="./"]'), toc: document.querySelectorAll('.toc a').length, missing: [...document.querySelectorAll('.toc a')].filter(a => !document.querySelector(a.getAttribute('href'))).length }));
    check(`help page ${f} loads with its contents list and a link back to the app`, r.ok() && info.h1 === h1 && info.back && info.toc >= 10 && info.missing === 0 && errs.length === 0, JSON.stringify(info));
    await p2.close();
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  const t0 = await page.evaluate(() => ({ chart: document.querySelector('#rows').checkVisibility(), chord: document.querySelector('#sideRight').checkVisibility(), navTop: document.querySelector('#phoneTabs').getBoundingClientRect().top }));
  await page.click('#tab-p-create'); await page.waitForTimeout(100);
  const t1 = await page.evaluate(() => ({ gen: [...document.querySelectorAll('#sideLeft [role=tabpanel]')].some(p => p.checkVisibility()), chart: document.querySelector('#rows').checkVisibility(), chord: document.querySelector('#sideRight').checkVisibility() }));
  await page.click('#tab-p-chord');
  check('layout: tablet keeps the chart beside the panel and switches panels from the top bar', t0.chart && t0.chord && t0.navTop < 80 && t1.gen && t1.chart && !t1.chord, JSON.stringify({ t0, t1 }));
  await page.setViewportSize({ width: 390, height: 844 });
  const seen = {};
  for (const tab of ['p-create', 'p-chord', 'p-tools', 'p-chart']) { await page.click(`#phoneTabs [data-tab="${tab}"]`); seen[tab] = await page.evaluate(() => ({ gen: [...document.querySelectorAll('#sideLeft [role=tabpanel]')].some(p => p.checkVisibility()), detail: document.querySelector('#detail').checkVisibility(), finder: document.querySelector('#finder').checkVisibility(), chart: document.querySelector('#rows').checkVisibility() })); }
  const one = Object.values(seen).every(v => Object.values(v).filter(Boolean).length === 1);
  const bars = await page.evaluate(() => ({ play: document.querySelector('#play').getBoundingClientRect().bottom, dock: document.querySelector('.dock').getBoundingClientRect().bottom, tabs: document.querySelector('#phoneTabs').getBoundingClientRect().top }));
  check('layout: phone Play bar sits fully above the tab bar', bars.dock <= bars.tabs + 1 && bars.play <= bars.tabs, JSON.stringify(bars));
  check('layout: phone shows one screen at a time from the tab bar', one && seen['p-create'].gen && seen['p-chord'].detail && seen['p-tools'].finder && seen['p-chart'].chart && await noHScroll(page), JSON.stringify(seen));
  check('no console errors (layout)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// hardening: untrusted input, regressions from the code review, and real click paths (no auto-reveal)
async function hardening() {
  const { ctx, page } = await openPage({ noReveal: true, viewport: { width: 1440, height: 900 } });
  await page.goto(URL_); await page.evaluate(() => localStorage.clear()); await page.reload();
  const noToast = () => page.evaluate(() => { document.querySelector('#toast').hidden = true; });
  // a poisoned library file: bad settings are dropped, a bad chord list rejects its item, names never become HTML
  const bad = { version: 1, items: [
    { name: '<img src=x onerror="window.__x1=1">Bad', snap: { S: { meter: '0/4', tempo: '<img src=x onerror="window.__x2=1">', mode: 'constructor', tonic: 1.5 }, chords: [{ root: 0, q: '', beats: 4 }, { root: 7, q: '', beats: 4 }] } },
    { name: 'proto', snap: { S: {}, chords: [{ root: 0, q: 'constructor', beats: 4 }] } }] };
  const badPath = path.join(OUT, 'bad-library.json'); fs.writeFileSync(badPath, JSON.stringify(bad));
  await page.click('#library > summary'); await page.setInputFiles('#libImport', badPath); await page.waitForTimeout(200);
  const imp = await page.evaluate(() => ({ n: LIB.items.length, img: !!document.querySelector('#libList img') }));
  check('hardening: a poisoned library imports only the sound item, and names never become HTML', imp.n === 1 && !imp.img, JSON.stringify(imp));
  await page.click('#libList .ln');
  const opened = await page.evaluate(() => { document.querySelector('#printSheet').innerHTML = leadSheetHTML(); return { meter: S.meter, mode: S.mode, tempo: S.tempo, tonic: S.tonic, x: !!(window.__x1 || window.__x2), chords: chords.length, xml: /<per-minute>\d+<\/per-minute>/.test(buildMusicXML()) }; });
  await page.waitForTimeout(100);
  check('hardening: opening it keeps sane settings and runs no injected code', opened.meter === '4/4' && opened.mode === 'ionian' && Number.isInteger(opened.tempo) && Number.isInteger(opened.tonic) && !opened.x && opened.chords === 2 && opened.xml && !(await page.evaluate(() => !!(window.__x1 || window.__x2))), JSON.stringify(opened));
  // prototype-key names in chord text and share codes
  await page.click('#textEdit > summary'); await page.fill('#prog', 'Cconstructor | G | C__proto__ | CtoString'); await page.click('#load');
  const pk = await page.evaluate(() => ({ err: document.querySelector('#err').textContent, names: chords.map(c => chordName(c)).join(' ') }));
  check('hardening: chord names like Cconstructor are rejected with a message, not a crash', /constructor/.test(pk.err) && pk.names === 'G', JSON.stringify(pk));
  const code = await page.evaluate(() => b64url(JSON.stringify({ v: 1, k: 3, m: 'constructor', t: '__proto__', b: 'x', c: 'C | G' })));
  if (!(await page.evaluate(() => document.querySelector('#library').open))) await page.click('#library > summary');
  await page.fill('#shareIn', code); await page.click('#shareOpen');
  check('hardening: a share code with prototype keys keeps the mode and meter', await page.evaluate(() => S.mode === 'ionian' && S.meter === '4/4' && S.tonic === 3 && serialize() === 'C | G'));
  await page.fill('#prog', '[<img src=x onerror="window.__x3=1">]\nC | G'); await page.click('#load'); await page.waitForTimeout(100);
  check('hardening: HTML in a section name is shown as text', await page.evaluate(() => !window.__x3 && /<img/.test(document.querySelector('#rows .sec-label').textContent)));
  // regressions from the review
  for (const [inst, style] of [['piano', 'arp'], ['guitar', 'strum'], ['guitar', 'pick']]) {
    await page.evaluate(([i, st]) => { S.instrument = i; if (i === 'guitar') S.gstyle = st; else S.pstyle = st; chords = parseProg('G | C | D | G').chords; renderAll(); }, [inst, style]);
    const m = parseMidi(Buffer.from(await page.evaluate(() => [...buildMidi(false)])));
    let overlaps = 0; const on = new Map();
    for (const e of m.tracks[1]) { if (e.st === 0x90 && e.d[1] > 0) { if (on.get(e.d[0])) overlaps++; on.set(e.d[0], true); } else if (e.st === 0x80 || (e.st === 0x90 && e.d[1] === 0)) on.set(e.d[0], false); }
    check(`hardening: MIDI ${inst} ${style} has no overlapping notes of the same pitch`, overlaps === 0, String(overlaps));
  }
  await page.evaluate(() => { S.instrument = 'piano'; S.pstyle = 'block'; S.gstyle = 'strum1'; setTuning('standard'); S.capo = 0; chords = parseProg('G | C | D | G').chords; sel = chords[0].id; renderAll(); save(); });
  const ts = await page.evaluate(async () => { const tick = setInterval(() => commit(), 0); await findEasiestTuning(); clearInterval(tick); return { s: S.tuning, low: TUNING[0], stored: JSON.parse(localStorage.getItem('changes-v1')).S.tuning }; });
  check('hardening: the easiest-tuning search never saves a temporary tuning', ts.s === 'standard' && ts.low === 40 && ts.stored === 'standard', JSON.stringify(ts));
  await page.evaluate(() => { pushHist(); chords[0].beats = 8; commit(); });
  await page.selectOption('#tuneSel', 'DADGAD');
  await page.evaluate(() => undo());
  check('hardening: Undo keeps the guitar strings in step with the tuning', await page.evaluate(() => S.tuning === 'standard' && TUNING.join() === '40,45,50,55,59,64'));
  await page.evaluate(() => { sel = chords[0].id; renderAll(); });
  await page.focus('#tab-chord'); await page.keyboard.press('ArrowRight');
  check('hardening: arrow keys on a tab bar switch tabs without moving the chord selection', await page.evaluate(() => sel === chords[0].id && document.querySelector('#tab-swaps').getAttribute('aria-selected') === 'true'));
  if (!(await page.evaluate(() => document.querySelector('#library').open))) await page.click('#library > summary');
  await page.fill('#libName', 'Keep me'); await page.click('#libSaveBtn');
  await page.click('[data-lib]:has-text("Keep me") [data-la="rename"]'); await page.fill('[data-lib] input', 'Changed'); await page.press('[data-lib] input', 'Escape');
  check('hardening: Escape cancels a library rename', await page.evaluate(() => LIB.items.some(i => i.name === 'Keep me') && !LIB.items.some(i => i.name === 'Changed')));
  await page.mouse.click(700, 600);
  await noToast(); await page.click('#play'); await page.waitForTimeout(200);
  const pv = await page.evaluate(() => { const s0 = session; playOne({ root: 0, q: 'maj7', bass: null }); return { same: session === s0, playing }; });
  await page.click('#play');
  check('hardening: hearing a chord during playback leaves the chart playing', pv.same && pv.playing, JSON.stringify(pv));
  const before = await page.evaluate(() => serialize());
  await page.click('#chartTools #clearChart').catch(async () => { await page.evaluate(() => document.querySelector('#clearChart').click()); });
  await page.evaluate(() => { pushHist(); chords.push({ id: uid(), root: 0, q: '', bass: null, beats: 4 }); commit(); });
  await page.click('#toast .toast-act');
  check('hardening: the toast Undo reverts its own action even after another edit', await page.evaluate(b => serialize() === b, before), await page.evaluate(() => serialize()));
  // real click paths: the Swap ideas tab, the tablet drawer, the phone screens
  await page.evaluate(() => { sel = chords[1].id; renderAll(); });
  await page.click('#tab-swaps'); await page.click('#subs [data-use] >> nth=0');
  check('real clicks: Swap ideas tab, then Put in this slot', await page.evaluate(b => serialize() !== b, before));
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.click('#tab-p-create'); await page.waitForTimeout(100); await noToast(); await page.click('#tab-gen'); await page.click('#gen');
  check('real clicks: tablet Create panel, then Generate', await page.evaluate(() => chords.length > 0));
  await page.keyboard.press('Escape'); await page.waitForTimeout(300);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#phoneTabs [data-tab="p-chord"]'); await page.click('#tab-chord'); await noToast(); await page.click('#detail [data-act="lock"]');
  check('real clicks: phone Chord screen, then Lock', await page.evaluate(() => chords.some(c => c.lock)));
  check('no console errors (hardening)', page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
  // a corrupted saved session must not lock the app
  const { ctx: c2, page: p2 } = await openPage({ noReveal: true });
  await p2.goto(URL_);
  await p2.evaluate(() => localStorage.setItem('changes-v1', JSON.stringify({ S: { meter: '0/4', mode: 'constructor', tempo: '<b>', tuning: '__proto__' }, chords: [{ root: 0, q: 'constructor', beats: 4 }], sel: null })));
  await p2.reload({ timeout: 8000 });
  const boot = await Promise.race([p2.evaluate(() => ({ meter: S.meter, mode: S.mode, tempo: S.tempo, tuning: S.tuning, n: chords.length })), new Promise(r => setTimeout(() => r('HANG'), 5000))]);
  check('hardening: a corrupted saved session starts cleanly instead of hanging', boot !== 'HANG' && boot.meter === '4/4' && boot.mode === 'ionian' && boot.tempo === 88 && boot.tuning === 'standard' && boot.n > 0 && p2.errors.length === 0, JSON.stringify(boot));
  await c2.close();
}

// phone width + dark mode for every panel
async function phoneDark(tag) {
  const { ctx, page } = await openPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  await page.goto(URL_); await page.evaluate(() => { document.querySelector('#library').open = true; S.showVL = true; S.quiz = true; S.meter = '16/4 teental'; chords = parseProg('Am | D').chords; sel = chords[0].id; document.querySelector('#melIn').value = 'E D C D | E E E -'; renderAll(); melodySuggest(); });
  await page.evaluate(async () => { await findEasiestTuning(); });
  check(`${tag}: no horizontal scroll at 390px (dark)`, await noHScroll(page));
  check(`${tag}: chord edges have resize handles at phone width`, await page.evaluate(() => [...document.querySelectorAll('#rows .slot:not(.tie)')].every(s => s.querySelector('.rz') || chords.find(c => c.id === s.dataset.id)?.beats > barLen() * 2)));
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  check(`${tag}: dark theme applies`, bg !== 'rgb(255, 255, 255)' && bg !== 'rgb(243, 244, 246)', bg);
  await page.evaluate(() => { document.querySelector('#rows').scrollIntoView(); openPicker(chords[chords.length - 1].id); });
  check(`${tag}: chord picker fits on a phone`, await page.evaluate(() => { const r = document.querySelector('#cpick').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; }));
  await page.evaluate(() => closePicker());
  await page.screenshot({ path: path.join(OUT, `${tag}-phone-dark.png`), fullPage: true });
  check(`${tag}: no console errors (phone)`, page.errors.length === 0, page.errors.join(' | '));
  await ctx.close();
}

// iPhone: sound must start from a tap, in the media-playback category so the silent switch doesn't mute it
async function iphone() {
  /* these check iOS Safari's audio quirks (the silent switch, the audio session). Playwright's WebKit behaves like Safari on
     macOS; its Linux build is a different browser with no sound device on CI, so there the checks are skipped, not failed */
  if (process.platform !== 'darwin' || process.env.SKIP_IPHONE) { results.push('SKIP  iPhone audio checks: they need WebKit on macOS (run the tests on a Mac to include them)'); return; }
  for (const old of [false, true]) {
    const b = await webkit.launch(), ctx = await b.newContext({ ...devices['iPhone 13'] });
    if (old) await ctx.addInitScript(() => { try { Object.defineProperty(Navigator.prototype, 'audioSession', { get: () => undefined, configurable: true }); } catch (e) {} });
    const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e)));
    await page.goto(URL_); await page.tap('#play'); await page.waitForTimeout(700);
    const st = await page.evaluate(() => ({ run: actx.state, t: actx.currentTime, session: navigator.audioSession ? navigator.audioSession.type : 'n/a', clip: silentEl && !silentEl.paused ? 'playing' : (silentEl && silentEl.lastError) || 'none' }));
    const tag = old ? 'iPhone (older iOS, no audio session API)' : 'iPhone (iOS 17+)';
    check(`${tag}: tapping Play starts the audio engine`, st.run === 'running' && st.t > 0.3, JSON.stringify(st));
    check(`${tag}: silent-switch workarounds are active (session ${old ? 'n/a' : 'playback'}, 16-bit clip playing)`, st.clip === 'playing' && st.session === (old ? 'n/a' : 'playback'), JSON.stringify(st));
    // Simple view opens on the one-tap card; Sound check lives on the Chart screen, one tab away
    await page.tap('#tab-p-chart'); await page.tap('#soundCheck'); await page.tap('[data-sb="web"]'); await page.waitForTimeout(500); await page.tap('[data-sb="media"]'); await page.waitForTimeout(500);
    const sb = await page.evaluate(() => ({ open: !document.querySelector('#soundbox').hidden, rows: [...document.querySelectorAll('#soundbox dd')].map(d => d.textContent), beep: beepEl ? (beepEl.lastError || (beepEl.paused && beepEl.currentTime === 0 ? 'not played' : 'played')) : 'none' }));
    check(`${tag}: Sound check shows the audio state and both beeps play`, sb.open && /running/.test(sb.rows[2]) && sb.beep === 'played', JSON.stringify(sb));
    await page.tap('[data-sb="close"]');
    await page.tap('#play'); check(`${tag}: no errors`, errs.length === 0, errs.join(' | '));
    await b.close();
  }
}
const phaseFns = { 1: phase1, 2: phase2, 3: phase3 };
try {
  for (const n of PHASES) { if (phaseFns[n]) { await phaseFns[n](); await phoneDark('phase' + n); } }
  await editing();
  await keyChanges();
  await notation();
  await polish();
  await ceilings();
  await melodyLane();
  await arranging();
  await voicesExplained();
  await pianoParts();
  await orchestra();
  await songForm();
  await eighthNotes();
  await appName();
  await spelling();
  await fastInput();
  await frontDoor();
  await hearArr();
  await simpleView();
  await tuneIdeasSuite();
  await melodyInput();
  await colorByJob();
  await customColours();
  await textSize();
  await playbackFeedback();
  await liveChord();
  await focusMode();
  await feedbackRound2();
  await keyCentresSuite();
  await searchSuite();
  await dragSuite();
  await launchSuite();
  await breakAway();
  await tuneSuite();
  await menus();
  await layout();
  await hardening();
  await iphone();
} catch (e) { check('test run finished without throwing', false, e.stack); }
await browser.close(); server.close();
console.log(results.join('\n'));
const skipped = results.filter(r => r.startsWith('SKIP')).length;
console.log(failures ? `\n${failures} FAILED` : `\nall ${results.length - skipped} checks passed${skipped ? `, ${skipped} skipped` : ''}`);
process.exit(failures ? 1 : 0);
