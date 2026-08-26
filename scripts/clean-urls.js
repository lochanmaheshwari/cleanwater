import fs from 'fs';
import path from 'path';

const rootFiles = fs.readdirSync('.').filter(f => f.endsWith('.html'));
const jsFiles = fs.readdirSync('./js').map(f => './js/' + f);
const apiFiles = fs.readdirSync('./api/_handlers').map(f => './api/_handlers/' + f);

const all = [...rootFiles, ...jsFiles, ...apiFiles];

const replacements = [
  { from: /href="index\.html#/g, to: 'href="/#' },
  { from: /href="index\.html"/g, to: 'href="/"' },
  { from: /href="about\.html"/g, to: 'href="/about"' },
  { from: /href="donations\.html"/g, to: 'href="/donations"' },
  { from: /href="fee\.html\?id=/g, to: 'href="/fee?id=' },
  { from: /href="product\.html\?slug=/g, to: 'href="/product?slug=' },
  { from: /href="rules\.html"/g, to: 'href="/rules"' },
  { from: /href="terms\.html"/g, to: 'href="/terms"' },
  { from: /href="privacy\.html"/g, to: 'href="/privacy"' },
  { from: /`\/done\.html\?id=/g, to: '`/done?id=' },
  { from: /`\/fee\.html\?id=/g, to: '`/fee?id=' },
  { from: /\/fee\.html\?id=/g, to: '/fee?id=' },
  { from: /\/done\.html\?id=/g, to: '/done?id=' }
];

for (const file of all) {
  if (!fs.existsSync(file)) continue;
  let content = fs.readFileSync(file, 'utf8');
  let changed = false;
  for (const { from, to } of replacements) {
    if (from.test(content)) {
      content = content.replace(from, to);
      changed = true;
    }
  }
  if (changed) {
    fs.writeFileSync(file, content, 'utf8');
    console.log('Cleaned URLs in:', file);
  }
}
console.log('Done cleaning URLs!');
