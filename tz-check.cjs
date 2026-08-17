const fs = require('fs');
const readline = require('readline');
const FILE = process.argv[2] || 'result.json';

const rl = readline.createInterface({
  input: fs.createReadStream(FILE, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

let curType = null, curDate = null, curUnix = null;
const byDateStr = new Map();   // по строке "date" (МСК как в дампе)
const byUtc = new Map();       // по date_unixtime, интерпретация UTC
const byMskUnix = new Map();   // по date_unixtime + 3ч

const add = (m, k) => m.set(k, (m.get(k) || 0) + 1);
const dayUtc = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);
const dayMsk = (sec) => new Date(sec * 1000 + 3 * 3600 * 1000).toISOString().slice(0, 10);

const typeRe = /^\s*"type":\s*"([^"]*)",/;
const dateRe = /^\s*"date":\s*"([^"]*)",/;
const unixRe = /^\s*"date_unixtime":\s*"(\d+)"/;

function flush() {
  if (curType === 'message' && curDate && curUnix != null) {
    add(byDateStr, curDate.slice(0, 10));
    add(byUtc, dayUtc(curUnix));
    add(byMskUnix, dayMsk(curUnix));
  }
  curType = null; curDate = null; curUnix = null;
}

rl.on('line', (line) => {
  let m;
  if ((m = typeRe.exec(line))) { curType = m[1]; return; }
  if (curDate === null && (m = dateRe.exec(line))) { curDate = m[1]; return; }
  if ((m = unixRe.exec(line))) { curUnix = Number(m[1]); flush(); }
});

rl.on('close', () => {
  const days = ['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07',
                '2026-08-08','2026-08-09','2026-08-10','2026-08-11','2026-08-12','2026-08-13'];
  const ref = {'2026-08-03':222,'2026-08-04':639,'2026-08-05':729,'2026-08-06':647,
    '2026-08-07':580,'2026-08-08':298,'2026-08-09':258,'2026-08-10':1104,
    '2026-08-11':1307,'2026-08-12':2454};
  const p = (n) => String(n == null ? '-' : n).padStart(6);
  console.log('день         ref  dateМСК   UTC   unixМСК');
  for (const d of days) {
    console.log(`${d} ${p(ref[d])} ${p(byDateStr.get(d))} ${p(byUtc.get(d))} ${p(byMskUnix.get(d))}`);
  }
});
