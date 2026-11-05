import Database from 'better-sqlite3';
const db = new Database('/home/z/my-project/db/custom.db', { readonly: true });
const names = ['حسین جوان', 'یاشار ستاری', 'ناصر بلور', 'تینا کاظمی'];
for (const n of names) {
  const users = db.prepare("SELECT id, name, phone, email, role, createdAt FROM User WHERE name LIKE ?").all('%' + n + '%');
  console.log('=== search:', n, '=>', users.length, 'matches');
  for (const u of users) console.log(JSON.stringify(u));
}
// also find admins
const admins = db.prepare("SELECT id, name, phone, role FROM User WHERE role IN ('ADMIN','admin','Admin') LIMIT 10").all();
console.log('=== admins:', JSON.stringify(admins));
db.close();
