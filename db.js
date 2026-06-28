const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'data.json');

let db = { users: {}, codes: {}, watchers: {} };

function load() {
  if (!fs.existsSync(DATA_FILE)) return;
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8').replace(/^﻿/, '');
    const parsed = JSON.parse(raw);
    db.users = parsed.users || {};
    db.codes = parsed.codes || {};
    db.watchers = parsed.watchers || {};
  } catch (e) {
    console.error('[DB] Erreur chargement:', e.message);
  }
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

module.exports = { db, load, save };
