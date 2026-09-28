#!/usr/bin/env node
/*
 * refresh-oews.js — Annual BLS OEWS data refresh for the Reasonable Comp Tool.
 *
 * Run once a year (BLS publishes the new OEWS release each spring, data vintage
 * "May <year>"). Downloads the OEWS flat files from download.bls.gov, filters to
 * the coverage set below, and regenerates js/data/oews-data.js, which the app
 * loads as a plain <script> tag (no server, no build step).
 *
 * Also downloads the BLS county-to-area crosswalk (area_definitions_m<year>.xlsx)
 * so the app can offer a state -> county picker for the STATE_DETAIL states.
 *
 * Usage:
 *   node scripts/refresh-oews.js --email you@firm.com   # download fresh files, then build
 *   node scripts/refresh-oews.js --local <dir>          # use already-downloaded files in <dir>
 *                                                       # (oe.* flat files + area_definitions_m<year>.xlsx)
 * The contact email can also be set with the BLS_CONTACT_EMAIL environment variable.
 *
 * Coverage (edit STATE_DETAIL to widen):
 *   - National
 *   - Every state, statewide
 *   - All metro + nonmetro areas within the states in STATE_DETAIL (Idaho, Mississippi, Pennsylvania, Washington)
 *
 * BLS requires a User-Agent with a contact email on download.bls.gov;
 * anonymous/bot-looking requests get 403. Each user supplies their own email.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const readline = require('readline');
const zlib = require('zlib');

let USER_AGENT = 'ReasonableCompStudio-WhiteLabel/2.0 (OEWS annual data refresh)';
const BASE_URL = 'https://download.bls.gov/pub/time.series/oe/';
const AREA_DEF_URL = 'https://www.bls.gov/oes/';
const FILES = ['oe.release', 'oe.area', 'oe.occupation', 'oe.data.0.Current'];

// FIPS state codes whose metro/nonmetro areas are included in full detail.
// 16 = Idaho, 28 = Mississippi, 42 = Pennsylvania, 53 = Washington. Every state's statewide figure is always included.
const STATE_DETAIL = new Set(['16', '28', '42', '53']);

// Datatypes we keep (see oe.datatype):
// 01 employment; 06-10 hourly 10/25/50/75/90; 11-15 annual 10/25/50/75/90.
// Slot = position in the output wage array.
const DATATYPE_SLOT = {
  '01': 0,
  '06': 1, '07': 2, '08': 3, '09': 4, '10': 5,
  '11': 6, '12': 7, '13': 8, '14': 9, '15': 10,
};
const WAGE_SLOTS = 11; // emp + 5 hourly + 5 annual
const TOPCODE_FOOTNOTE = '5'; // ">= $115.00/hr or $239,200/yr"

const OUT_PATH = path.join(__dirname, '..', 'js', 'data', 'oews-data.js');

function download(file, destDir, baseUrl) {
  const dest = path.join(destDir, file);
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(dest);
    https.get((baseUrl || BASE_URL) + file, { headers: { 'User-Agent': USER_AGENT } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`${file}: HTTP ${res.statusCode} — BLS may be blocking the request; check the User-Agent contact info.`));
        res.resume();
        return;
      }
      res.pipe(out);
      out.on('finish', () => out.close(() => resolve(dest)));
    }).on('error', reject);
  });
}

function readTsv(file) {
  // Small reference files: read whole, split on tabs, trim each cell.
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter((l) => l.trim());
  const header = lines[0].split('\t').map((c) => c.trim());
  return lines.slice(1).map((l) => {
    const cells = l.split('\t').map((c) => c.trim());
    const row = {};
    header.forEach((h, i) => { row[h] = cells[i] || ''; });
    return row;
  });
}

// Minimal .xlsx reader (no dependencies): unzips the workbook with zlib and
// returns the first sheet as an array of row arrays of strings. Sufficient for
// the BLS area-definitions file, which is a single plain sheet.
function readXlsxRows(file) {
  const buf = fs.readFileSync(file);
  let eocd = buf.length - 22;
  while (eocd >= 0 && buf.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error(`${file}: not a valid .xlsx (zip) file`);
  const entries = {};
  let p = buf.readUInt32LE(eocd + 16);
  const count = buf.readUInt16LE(eocd + 10);
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const dataStart = localOff + 30 + buf.readUInt16LE(localOff + 26) + buf.readUInt16LE(localOff + 28);
    const raw = buf.subarray(dataStart, dataStart + csize);
    entries[name] = () => (method === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
  }
  const unxml = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const shared = entries['xl/sharedStrings.xml']
    ? [...entries['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => unxml(m[1]))
    : [];
  const sheet = entries['xl/worksheets/sheet1.xml']();
  return [...sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)].map((rm) => {
    const row = [];
    for (const cm of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const col = cm[1].match(/r="([A-Z]+)/)[1];
      const idx = [...col].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
      const type = (cm[1].match(/t="(\w+)"/) || [])[1];
      const body = cm[2] || '';
      const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      row[idx] = type === 's' ? shared[Number(v)] : type === 'inlineStr' ? unxml(body) : (v == null ? '' : unxml(v));
    }
    return row;
  });
}

// County -> OEWS area crosswalk for the STATE_DETAIL states.
// Returns [[state_fips, county_code, county_name, area_code], ...].
function readCounties(file, areaSet) {
  const rows = readXlsxRows(file);
  const header = rows[0].map((h) => String(h || '').trim().toLowerCase());
  const col = (re) => {
    const i = header.findIndex((h) => re.test(h));
    if (i === -1) throw new Error(`${file}: column matching ${re} not found (header: ${header.join(' | ')})`);
    return i;
  };
  const cState = col(/^fips code$/), cArea = col(/area code$/), cCounty = col(/^county code$/), cName = col(/^county name$/);
  const out = [];
  rows.slice(1).forEach((r) => {
    const st = String(r[cState] || '').trim().padStart(2, '0');
    if (!STATE_DETAIL.has(st)) return;
    const area = String(r[cArea] || '').trim().padStart(7, '0');
    if (!areaSet.has(area)) throw new Error(`County ${r[cName]} maps to area ${area}, which is not in oe.area`);
    out.push([st, String(r[cCounty] || '').trim().padStart(3, '0'), String(r[cName] || '').trim(), area]);
  });
  out.sort((a, b) => a[0].localeCompare(b[0]) || a[2].localeCompare(b[2]));
  return out;
}

function areaDefFile(year) { return `area_definitions_m${year}.xlsx`; }

// SOC hierarchy level from the 6-digit OEWS occupation code.
function socLevel(code) {
  if (code === '000000') return 'total';
  if (code.slice(2) === '0000') return 'major';
  if (code.endsWith('000')) return 'minor';
  if (code.endsWith('0')) return 'broad';
  return 'detailed';
}

async function build(dir) {
  // ---- release vintage -------------------------------------------------
  const releaseRows = readTsv(path.join(dir, 'oe.release'));
  const release = releaseRows[0]; // e.g. { release_date: '2025A01', description: 'May 2025' }
  const releaseLabel = release.description;               // "May 2025"
  const releaseYear = parseInt(releaseLabel.match(/\d{4}/)[0], 10);
  console.log(`OEWS release: ${releaseLabel} (${release.release_date})`);

  // ---- counties -> area (for the state/county picker) --------------------
  const areaRows = readTsv(path.join(dir, 'oe.area'));
  const counties = readCounties(path.join(dir, areaDefFile(releaseYear)), new Set(areaRows.map((a) => a.area_code)));
  const countyAreas = new Set(counties.map((c) => c[3]));
  console.log(`Counties mapped: ${counties.length} (states ${[...STATE_DETAIL].join(', ')})`);

  // ---- areas ------------------------------------------------------------
  // Metro areas are kept when their primary state is a STATE_DETAIL state OR
  // any county in a STATE_DETAIL state belongs to them (cross-state metros such
  // as Memphis, TN-MS-AR, whose oe.area state code is the primary state only).
  const keptAreas = areaRows.filter((a) =>
    a.areatype_code === 'N' ||
    a.areatype_code === 'S' ||
    (a.areatype_code === 'M' && (STATE_DETAIL.has(a.state_code) || countyAreas.has(a.area_code)))
  );
  const areaSet = new Set(keptAreas.map((a) => a.area_code));
  console.log(`Areas kept: ${keptAreas.length} of ${areaRows.length}`);

  // ---- occupations -------------------------------------------------------
  const occRows = readTsv(path.join(dir, 'oe.occupation'));
  const keptOccs = occRows.filter((o) => o.selectable === 'T' && o.occupation_code !== '000000');
  const occSet = new Set(keptOccs.map((o) => o.occupation_code));
  console.log(`Occupations kept: ${keptOccs.length} of ${occRows.length}`);

  // ---- stream the data file ---------------------------------------------
  // series_id layout: OE U <areatype:1> <area:7> <industry:6> <occupation:6> <datatype:2>
  const wages = {};       // area_code -> { occ_code -> Array(WAGE_SLOTS) }
  const topcode = {};     // area_code -> { occ_code -> bitmask over slots 1..10 }
  let kept = 0, scanned = 0;

  const rl = readline.createInterface({
    input: fs.createReadStream(path.join(dir, 'oe.data.0.Current')),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    scanned++;
    if (!line.startsWith('OEU')) continue; // header
    const seriesId = line.slice(0, line.indexOf('\t')).trim();
    const industry = seriesId.slice(11, 17);
    if (industry !== '000000') continue; // cross-industry only
    const datatype = seriesId.slice(23, 25);
    const slot = DATATYPE_SLOT[datatype];
    if (slot === undefined) continue;
    const area = seriesId.slice(4, 11);
    if (!areaSet.has(area)) continue;
    const occ = seriesId.slice(17, 23);
    if (!occSet.has(occ)) continue;

    const cells = line.split('\t');
    const rawValue = cells[3].trim();
    const footnotes = (cells[4] || '').trim();
    if (footnotes.includes('8')) continue; // estimate not released
    const value = parseFloat(rawValue);
    if (!isFinite(value)) continue;

    (wages[area] = wages[area] || {});
    (wages[area][occ] = wages[area][occ] || new Array(WAGE_SLOTS).fill(null));
    wages[area][occ][slot] = value;
    if (slot > 0 && footnotes.includes(TOPCODE_FOOTNOTE)) {
      (topcode[area] = topcode[area] || {});
      topcode[area][occ] = (topcode[area][occ] || 0) | (1 << (slot - 1));
    }
    kept++;
  }
  console.log(`Data rows scanned: ${scanned.toLocaleString()}, kept: ${kept.toLocaleString()}`);

  // Drop occupation entries with no wage data at all in any kept area,
  // but keep the reference list intact for autocomplete honesty.
  const occsWithData = new Set();
  for (const area of Object.keys(wages)) {
    for (const occ of Object.keys(wages[area])) occsWithData.add(occ);
  }

  // ---- emit --------------------------------------------------------------
  const out = {
    release: releaseLabel,
    releaseCode: release.release_date,
    releaseYear,
    generatedAt: new Date().toISOString(),
    source: 'BLS OEWS flat files, download.bls.gov/pub/time.series/oe/',
    topcodeNote: 'Wage equal to or greater than $115.00/hour or $239,200/year (BLS top-code).',
    // areas: [area_code, name, type(N/S/M), state_fips]
    areas: keptAreas.map((a) => [a.area_code, a.area_name, a.areatype_code, a.state_code]),
    // counties: [state_fips, county_code, county_name, area_code] — BLS area definitions
    counties,
    // occupations: [code, title, level, description] — code is 6-digit; display as XX-XXXX
    occupations: keptOccs
      .filter((o) => occsWithData.has(o.occupation_code))
      .map((o) => [o.occupation_code, o.occupation_name, socLevel(o.occupation_code), o.occupation_description]),
    // wages[area][occ] = [emp, h10,h25,h50,h75,h90, a10,a25,a50,a75,a90] (null = suppressed)
    wages,
    // topcode[area][occ] = bitmask over the 10 wage slots (bit0 = h10 ... bit9 = a90)
    topcode,
  };

  const js = '// GENERATED by scripts/refresh-oews.js — do not edit by hand.\n' +
    `// BLS OEWS ${releaseLabel} release. Regenerate annually when BLS publishes the new release.\n` +
    'window.RCT_DATA = ' + JSON.stringify(out) + ';\n';
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, js);
  const mb = (fs.statSync(OUT_PATH).size / 1024 / 1024).toFixed(1);
  console.log(`Wrote ${OUT_PATH} (${mb} MB)`);

  // Quick sanity echoes so a refresh run is self-auditing.
  const nat = keptAreas.find((a) => a[2] === 'N' || a.areatype_code === 'N');
  const sample = (areaCode, occCode, label) => {
    const w = wages[areaCode] && wages[areaCode][occCode];
    console.log(`  ${label}: ${w ? `median $${(w[8] || 0).toLocaleString()}/yr, emp ${(w[0] || 0).toLocaleString()}` : 'NOT FOUND'}`);
  };
  console.log('Sanity checks:');
  sample('0000000', '132011', 'National 13-2011 Accountants & Auditors');
  sample('0017660', '132011', "Coeur d'Alene 13-2011 Accountants & Auditors");
  sample('0044060', '119199', 'Spokane 11-9199 Managers, All Other');
  sample('1600000', '472031', 'Idaho 47-2031 Carpenters');
  sample('0038300', '132011', 'Pittsburgh 13-2011 Accountants & Auditors');
  sample('0037980', '111021', 'Philadelphia 11-1021 General & Operations Managers');
  sample('0027140', '132011', 'Jackson MS 13-2011 Accountants & Auditors');
}

async function main() {
  const localIdx = process.argv.indexOf('--local');
  let dir;
  if (localIdx !== -1) {
    dir = process.argv[localIdx + 1];
    if (!dir || !fs.existsSync(dir)) throw new Error('--local <dir> must point to a folder holding the oe.* flat files');
    console.log(`Using local flat files in ${dir}`);
  } else {
    const emailIdx = process.argv.indexOf('--email');
    const email = (emailIdx !== -1 ? process.argv[emailIdx + 1] : process.env.BLS_CONTACT_EMAIL) || '';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error('BLS requires a contact email: run with --email you@firm.com (or set BLS_CONTACT_EMAIL)');
    }
    USER_AGENT = `ReasonableCompStudio-WhiteLabel/2.0 (OEWS annual data refresh; ${email})`;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oews-'));
    console.log(`Downloading OEWS flat files to ${dir} (the data file is ~330 MB; this can take a few minutes)…`);
    for (const f of FILES) {
      process.stdout.write(`  ${f} … `);
      await download(f, dir);
      console.log('done');
    }
    const year = parseInt(readTsv(path.join(dir, 'oe.release'))[0].description.match(/\d{4}/)[0], 10);
    process.stdout.write(`  ${areaDefFile(year)} … `);
    await download(areaDefFile(year), dir, AREA_DEF_URL);
    console.log('done');
  }
  await build(dir);
}

main().catch((e) => { console.error('REFRESH FAILED:', e.message); process.exit(1); });
