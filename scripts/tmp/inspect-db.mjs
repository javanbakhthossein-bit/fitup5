import Database from 'better-sqlite3';
const db = new Database('/home/z/db-restore/fitup-prod.db', { readonly: true });
console.log('integrity:', db.pragma('integrity_check', { simple: true }));
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('tables:', tables.map(t=>t.name).join(', '));
try { console.log('User count:', db.prepare('SELECT count(*) c FROM User').get().c); } catch(e){ console.log('User table err:', e.message); }
db.close();
