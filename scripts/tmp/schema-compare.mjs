import Database from 'better-sqlite3';
const db = new Database('/home/z/db-restore/fitup-prod.db', { readonly: true });
// Get prod schema
const cols = {};
for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all()) {
  cols[t.name] = db.prepare(`PRAGMA table_info("${t.name}")`).all().map(c => c.name);
}
console.log(JSON.stringify(cols, null, 0));
db.close();
