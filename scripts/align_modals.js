const fs = require('fs');

const frPath = './messages/fr.json';
const enPath = './messages/en.json';
const nlPath = './messages/nl.json';

const fr = JSON.parse(fs.readFileSync(frPath, 'utf-8'));
const en = JSON.parse(fs.readFileSync(enPath, 'utf-8'));
const nl = JSON.parse(fs.readFileSync(nlPath, 'utf-8'));

// If en has top-level modals and not dashboardBoutique.modals, move it
if (en.modals && (!en.dashboardBoutique.modals || Object.keys(en.dashboardBoutique.modals).length === 0)) {
  en.dashboardBoutique.modals = en.modals;
  delete en.modals;
}
// Same for nl
if (nl.modals && (!nl.dashboardBoutique.modals || Object.keys(nl.dashboardBoutique.modals).length === 0)) {
  nl.dashboardBoutique.modals = nl.modals;
  delete nl.modals;
}
// Same for fr just in case top-level modals exists
if (fr.modals) {
  delete fr.modals;
}

fs.writeFileSync(frPath, JSON.stringify(fr, null, 2) + '\n', 'utf-8');
fs.writeFileSync(enPath, JSON.stringify(en, null, 2) + '\n', 'utf-8');
fs.writeFileSync(nlPath, JSON.stringify(nl, null, 2) + '\n', 'utf-8');

console.log('Synchronized modals location across fr.json, en.json, nl.json');
