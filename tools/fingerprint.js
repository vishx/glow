// Prints the build fingerprint Settings shows for the current checkout of public/:
// the first 8 hex digits of SHA-256 over index.html, app.js, engine.js and styles.css.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const root = path.join(__dirname, '../public');
const text = ['index.html', 'app.js', 'engine.js', 'styles.css'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
console.log(crypto.createHash('sha256').update(text).digest('hex').slice(0, 8));
