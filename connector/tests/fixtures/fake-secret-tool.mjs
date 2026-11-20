// Acts like libsecret's `secret-tool` for tests on machines without a keyring.
// Keeps secrets in the JSON file named by FAKE_SECRET_STORE.
//   store --label=L application A key K   (secret on stdin)
//   lookup application A key K            (prints the secret)
//   clear application A key K
import fs from 'node:fs';
const file = process.env.FAKE_SECRET_STORE;
const db = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const [cmd, ...rest] = process.argv.slice(2);
const attrs = rest.filter(a => !a.startsWith('--')).join('|');
if (cmd === 'store') { db[attrs] = fs.readFileSync(0, 'utf8'); fs.writeFileSync(file, JSON.stringify(db)); }
else if (cmd === 'lookup') { if (!(attrs in db)) process.exit(1); process.stdout.write(db[attrs]); }
else if (cmd === 'clear') { delete db[attrs]; fs.writeFileSync(file, JSON.stringify(db)); }
else process.exit(2);
