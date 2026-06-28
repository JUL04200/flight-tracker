const { db, save } = require('./db');
const { DURATIONS_MONTHS } = require('./config');

// Charset sans 0/O et 1/I pour éviter les confusions à la lecture
const CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomSegment(len) {
  let s = '';
  for (let i = 0; i < len; i++) s += CHARSET[Math.floor(Math.random() * CHARSET.length)];
  return s;
}

function generateCode(plan, durationKey, expiresInDays) {
  let code;
  do {
    code = `FT-${randomSegment(4)}-${randomSegment(4)}`;
  } while (db.codes[code]);

  const entry = {
    code, plan, durationMonths: DURATIONS_MONTHS[durationKey],
    createdAt: new Date().toISOString(),
    expiresAt: expiresInDays ? new Date(Date.now() + expiresInDays * 86400000).toISOString() : null,
    status: 'unused', usedBy: null, usedAt: null
  };
  db.codes[code] = entry;
  save();
  return entry;
}

function deleteCode(code) {
  if (!db.codes[code]) return false;
  delete db.codes[code];
  save();
  return true;
}

module.exports = { generateCode, deleteCode };
