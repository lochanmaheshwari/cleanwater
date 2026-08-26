import fs from 'fs';

const rootFiles = fs.readdirSync('.').filter(f => f.endsWith('.html'));
const jsFiles = fs.readdirSync('./js').map(f => './js/' + f);
const apiFiles = fs.readdirSync('./api/_handlers').map(f => './api/_handlers/' + f);

const all = [...rootFiles, ...jsFiles, ...apiFiles];

const replacements = [
  { from: /href="\/#/g, to: 'href="index.html#' },
  { from: /href="\/"/g, to: 'href="index.html"' },
  { from: /href="\/about"/g, to: 'href="about.html"' },
  { from: /href="\/donations"/g, to: 'href="donations.html"' },
  { from: /href="\/fee\?id=/g, to: 'href="fee.html?id=' },
  { from: /href="\/product\?slug=/g, to: 'href="product.html?slug=' },
  { from: /href="\/rules"/g, to: 'href="rules.html"' },
  { from: /href="\/terms"/g, to: 'href="terms.html"' },
  { from: /href="\/privacy"/g, to: 'href="privacy.html"' },
  { from: /`\/done\?id=/g, to: '`/done.html?id=' },
  { from: /`\/fee\?id=/g, to: '`/fee.html?id=' },
  { from: /\/fee\?id=/g, to: '/fee.html?id=' },
  { from: /\/done\?id=/g, to: '/done.html?id=' }
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
    console.log('Restored links in:', file);
  }
}
console.log('Done restoring links!');
