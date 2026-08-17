#!/usr/bin/env node
// Потоковый подсчёт сообщений за последние N дней из выгрузки Telegram (result.json).
// Даты в дампе — локальные МСК (без таймзоны в строке). Считаем по календарным дням МСК.

const fs = require('fs');
const readline = require('readline');

const FILE = process.argv[2] || 'result.json';
const DAYS = Number(process.argv[3] || 10);
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000; // МСК = UTC+3

// "Сейчас" в МСК как календарная дата
const nowMskMs = Date.now() + MSK_OFFSET_MS;
const nowMsk = new Date(nowMskMs);
// Граница: начало дня (МСК) N-1 дней назад, т.е. окно из ровно DAYS календарных дней включая сегодня
const startMsk = new Date(Date.UTC(nowMsk.getUTCFullYear(), nowMsk.getUTCMonth(), nowMsk.getUTCDate()));
startMsk.setUTCDate(startMsk.getUTCDate() - (DAYS - 1));

// Ключ дня "YYYY-MM-DD" из строки даты дампа (уже МСК)
const dayOf = (s) => s.slice(0, 10);
const startDayKey = startMsk.toISOString().slice(0, 10);

const rl = readline.createInterface({
  input: fs.createReadStream(FILE, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});

let curType = null;     // тип текущего верхнеуровневого элемента
let curDate = null;     // "date" текущего элемента (МСК)
let sawUnixtime = false;

let totalInWindow = 0;
const perDay = new Map();      // day -> count
const perUser = new Map();     // from -> count
let maxDate = null;
let curFrom = null;

const typeRe = /^\s*"type":\s*"([^"]*)",/;
const dateRe = /^\s*"date":\s*"([^"]*)",/;
const fromRe = /^\s*"from":\s*"((?:[^"\\]|\\.)*)",/;
const unixRe = /^\s*"date_unixtime":/;

function flush() {
  // Элемент завершён (встретили date_unixtime — он есть только у верхнеуровневых записей)
  if (curType === 'message' && curDate) {
    if (!maxDate || curDate > maxDate) maxDate = curDate;
    const day = dayOf(curDate);
    if (day >= startDayKey) {
      totalInWindow++;
      perDay.set(day, (perDay.get(day) || 0) + 1);
      const u = curFrom || '(без имени)';
      perUser.set(u, (perUser.get(u) || 0) + 1);
    }
  }
  curType = null;
  curDate = null;
  curFrom = null;
}

rl.on('line', (line) => {
  let m;
  if ((m = typeRe.exec(line))) { curType = m[1]; return; }
  if (curDate === null && (m = dateRe.exec(line))) { curDate = m[1]; return; }
  if (curFrom === null && (m = fromRe.exec(line))) { curFrom = m[1]; return; }
  if (unixRe.test(line)) { flush(); }
});

rl.on('close', () => {
  console.log(`Файл: ${FILE}`);
  console.log(`Окно: последние ${DAYS} дней по МСК (с ${startDayKey} по ${dayOf(nowMsk.toISOString())})`);
  console.log(`Последнее сообщение в дампе: ${maxDate || '—'}`);
  console.log(`\nВсего сообщений за окно: ${totalInWindow}\n`);

  console.log('По дням:');
  [...perDay.keys()].sort().forEach((d) => {
    console.log(`  ${d}: ${perDay.get(d)}`);
  });

  console.log('\nТоп-10 авторов за окно:');
  [...perUser.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .forEach(([u, c]) => console.log(`  ${u}: ${c}`));
});
