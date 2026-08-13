const fr = require('../messages/fr.json');
const en = require('../messages/en.json');
const nl = require('../messages/nl.json');

function getPaths(obj, prefix = '') {
  let paths = [];
  for (let k in obj) {
    const p = prefix ? prefix + '.' + k : k;
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      paths.push(...getPaths(obj[k], p));
    } else {
      paths.push(p);
    }
  }
  return paths;
}

const frPaths = getPaths(fr);
const enPaths = getPaths(en);
const nlPaths = getPaths(nl);

console.log('FR leaf key count:', frPaths.length);
console.log('EN leaf key count:', enPaths.length);
console.log('NL leaf key count:', nlPaths.length);

const frSet = new Set(frPaths);
const enSet = new Set(enPaths);
const nlSet = new Set(nlPaths);

const diff1 = frPaths.filter(p => !enSet.has(p));
const diff2 = enPaths.filter(p => !frSet.has(p));
const diff3 = frPaths.filter(p => !nlSet.has(p));
const diff4 = nlPaths.filter(p => !frSet.has(p));

console.log('Differences FR vs EN:', diff1.length, diff2.length);
console.log('Differences FR vs NL:', diff3.length, diff4.length);

function checkEmpty(obj, path = '') {
  let empty = [];
  for (let k in obj) {
    const p = path ? path + '.' + k : k;
    if (typeof obj[k] === 'object' && obj[k] !== null && !Array.isArray(obj[k])) {
      empty.push(...checkEmpty(obj[k], p));
    } else if (obj[k] === '' || obj[k] === undefined || obj[k] === null) {
      empty.push(p);
    }
  }
  return empty;
}

console.log('Empty in FR:', checkEmpty(fr).length);
console.log('Empty in EN:', checkEmpty(en).length);
console.log('Empty in NL:', checkEmpty(nl).length);
