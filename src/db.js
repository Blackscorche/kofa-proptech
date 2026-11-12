// File-based JSON database with atomic writes and Railway volume compatibility.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');

const empty = () => ({
  properties: [],
  publications: [],
  inspections: [],
  payments: [],
  users: [],
  complaints: [],
  meta: {},
});

let data = empty();
const dbPath = config.dbFile;

try {
  if (fs.existsSync(dbPath)) {
    data = Object.assign(empty(), JSON.parse(fs.readFileSync(dbPath, 'utf8')));
  }
} catch (e) {
  console.warn('Could not read existing database, starting fresh:', e.message);
  data = empty();
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    flush();
  }, 100);
}

function flush() {
  try {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const tmp = `${dbPath}.tmp-${Date.now()}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, dbPath);
  } catch (e) {
    console.error('Failed to flush database to disk:', e.message);
  }
}

const id = (prefix) => `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
const now = () => new Date().toISOString();

module.exports = {
  get data() { return data; },
  save,
  flush,
  id,
  now,
};
