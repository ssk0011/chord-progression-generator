// Records what the app shows and exports for a set of tunes, so a storage change can be proved to change nothing.
// Run on the code to compare against: node capture-golden.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const FIXTURES = {
  plain: ['C | G | Am | F', '4/4', [60, 62, 64, 65, 67, 65, 64, 62, 69, 67, 65, 64, 65, 64, 62, 60], []],
  mixed: ['C | G | Am | F', '4/4', [60, -1, null, 62, 64, -1, -1, null, 67, 65, null, 64, 65, -1, 62, 60], [null, 64, null, 65, null, null, null, null, 69]],
  seven: ['C | G', '7/8', [60, -1, 62, 64, -1, 65, 67, 69, -1, -1, 67, null, 65, 64], []],
  six: ['Am | F', '6/8', [69, -1, -1, 67, 65, -1, 65, null, 64, -1, 62, -1], [null, null, null, null, 67]],
  long: ['C | G', '4/4', [60, 62, 64, 65, 67, 69, 71, 72, 74, 72, 71, 69], []],
};
export async function record(page) {
  return page.evaluate(F => { const out = {};
    for (const [k, [txt, meter, mel, and]] of Object.entries(F)) {
      S.tonic = 0; S.mode = 'ionian'; S.meter = meter; S.tempo = 96; S.showMel = true; S.melPlay = true; S.arrShow = false; S.arr = 'strings';
      chords = parseProg(txt).chords; sel = chords[0].id; if (typeof melPut === 'function') melPut(mel, and); else { melody = mel.slice(); melAnd = and.slice(); }
      melSel = null; commit();
      const clean = h => h.replace(/ data-ids?="[^"]*"/g, '');
      const r = { text: serialize(), rows: clean(document.querySelector('#rows').innerHTML), notes: melNotes(), midi: Array.from(buildMidi(false)).join(',') };
      S.arrShow = true; commit(); r.arr = JSON.stringify(arrange().lines); r.arrRows = clean(document.querySelector('#rows').innerHTML); S.arrShow = false; commit();
      out[k] = r; }
    return out; }, FIXTURES);
}
if (process.argv[1].endsWith('capture-golden.mjs')) {
  const b = await chromium.launch(); const p = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await p.goto(pathToFileURL('../index.html').href);
  fs.writeFileSync('golden-tune.json', JSON.stringify(await record(p))); await b.close(); console.log('saved');
}
