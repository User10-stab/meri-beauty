const fs = require('fs');
const path = require('path');

function checkFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*') || trimmed.includes('import ') || trimmed.includes('console.')) return;
    
    // Check for raw French strings in JSX text node
    const jsxTextMatches = line.matchAll(/>([^<>{}\n]+)</g);
    for (const match of jsxTextMatches) {
      const text = match[1].trim();
      if (text && text !== '—' && text !== '·' && text !== '*' && text !== '⚠' && !/^\d+$/.test(text) && !/^[A-Z0-9_-]+$/.test(text) && text !== '€' && text !== ':') {
        console.log(`${filePath}:${idx + 1}: JSX text: "${text}"`);
      }
    }

    // Check for string attributes like placeholder, title, hint, aria-label, alt, label
    const attrMatches = line.matchAll(/(placeholder|title|hint|aria-label|label)="([^"]+)"/g);
    for (const match of attrMatches) {
      const attr = match[1];
      const val = match[2].trim();
      if (!val.startsWith('t(') && !val.includes('{') && val !== '—') {
        console.log(`${filePath}:${idx + 1}: attribute ${attr}: "${val}"`);
      }
    }
  });
}

function checkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const list = fs.readdirSync(dir);
  for (const f of list) {
    const fullPath = path.join(dir, f);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      checkDir(fullPath);
    } else if (f.endsWith('.jsx') || f.endsWith('.js')) {
      checkFile(fullPath);
    }
  }
}

console.log('=== Checking components/dashboard/boutique ===');
checkDir('./components/dashboard/boutique');

console.log('\n=== Checking app/dashboard/boutique ===');
checkDir('./app/dashboard/boutique');

console.log('\n=== Checking components/boutique ===');
checkDir('./components/boutique');
