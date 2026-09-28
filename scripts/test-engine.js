#!/usr/bin/env node
/*
 * test-engine.js — Hand-calculated unit tests for the reasonable comp engine.
 *
 * Run: node scripts/test-engine.js
 *
 * The fixture wage data below is invented so every expected value can be (and
 * was) worked out by hand arithmetic in the comments. A final integration
 * section runs the engine against the real generated oews-data.js and checks
 * internal consistency (not specific dollar values, which change each release).
 */

'use strict';

const path = require('path');
const engine = require(path.join(__dirname, '..', 'js', 'engine', 'comp-engine.js'));
const cfg = require(path.join(__dirname, '..', 'js', 'data', 'config.js'));

let failures = 0, passes = 0;
function check(label, actual, expected, tol) {
  tol = tol === undefined ? 0.51 : tol; // default: within a dollar of hand math
  const ok = typeof expected === 'number'
    ? Math.abs(actual - expected) <= tol
    : actual === expected;
  if (ok) { passes++; console.log(`  ok   ${label}`); }
  else { failures++; console.log(`  FAIL ${label}: expected ${expected}, got ${actual}`); }
}
function checkTrue(label, cond) { check(label, !!cond, true); }

// ---------------------------------------------------------------- fixture data
// Hourly percentiles chosen so annual = hourly x 2080 is clean arithmetic.
// Wage row layout: [emp, h10,h25,h50,h75,h90, a10,a25,a50,a75,a90]
const FIX = {
  release: 'May 2025 (fixture)',
  releaseYear: 2025,
  topcodeNote: '>= $115.00/hr or $239,200/yr',
  areas: [
    ['0000000', 'National', 'N', '00'],
    ['1600000', 'Idaho', 'S', '16'],
    ['0017660', "Coeur d'Alene, ID", 'M', '16'],
  ],
  wages: {
    '0017660': {
      // Accountants: h = 20/25/30/40/50 -> annual 41,600/52,000/62,400/83,200/104,000
      '132011': [100, 20, 25, 30, 40, 50, 41600, 52000, 62400, 83200, 104000],
      // Suppression case: ONLY the median published (h50 = 30)
      '292011': [50, null, null, 30, null, null, null, null, 62400, null, null],
    },
    '1600000': {
      // General managers: h = 25/30/40/50/60 -> annual 52,000/62,400/83,200/104,000/124,800
      '111021': [500, 25, 30, 40, 50, 60, 52000, 62400, 83200, 104000, 124800],
      '132011': [800, 18, 22, 27, 35, 45, 37440, 45760, 56160, 72800, 93600],
    },
    '0000000': {
      // Annual-only occupation (no hourly published), like teachers/pilots
      '434051': [9000, null, null, null, null, null, 30000, 35000, 40000, 45000, 50000],
      '132011': [1000000, 22, 27, 33, 42, 55, 45760, 56160, 68640, 87360, 114400],
    },
  },
  topcode: {},
};

const client = { name: 'Test Co', areaCode: '0017660' };

// ============================================================ Scenario 1
// Licensed CPA, 10 yrs experience -> default 75th percentile. 40 hrs/wk.
// 60% Accountant (CdA), 30% GM (CdA missing -> Idaho fallback), 10% annual-only (national).
//
// Hand math (mid, 75th):
//   132011: $40/hr x 40 x 52 = 83,200 x 60% = 49,920
//   111021: $50/hr x 40 x 52 = 104,000 x 30% = 31,200   (Idaho fallback)
//   434051: $45,000 x (40/40) x 10% = 4,500             (annual-only)
//   mid = 85,620
// low (50th): 62,400x.6 + 83,200x.3 + 40,000x.1 = 37,440+24,960+4,000 = 66,400
// high (90th): 104,000x.6 + 124,800x.3 + 50,000x.1 = 62,400+37,440+5,000 = 104,840
// Market approach: 132011 at 60% >= 60% threshold -> full-role 62,400/83,200/104,000
// Income: NIBC 150,000; proposed 85,620; payroll 85,620x.0765=6,549.93;
//   residual = 150,000-85,620-6,549.93 = 57,830.07 (share .3855 -> plausible)
console.log('Scenario 1: multi-hat licensed CPA, full-time');
{
  const input = {
    client,
    shareholder: { name: 'A', yearsExperience: 10, licenses: 'CPA', hoursPerWeek: 40 },
    roleComponents: [
      { roleTitle: 'Accounting/professional services', soc: '132011', pctTime: 60 },
      { roleTitle: 'General management', soc: '111021', pctTime: 30 },
      { roleTitle: 'Administrative', soc: '434051', pctTime: 10 },
    ],
    financials: { netIncomeBeforeOfficerComp: 150000, totalDistributions: 50000, totalOfficerWages: 60000 },
    compHistory: [],
  };
  const r = engine.analyze(input, FIX, cfg);
  check('default tier is 75th (licensed)', r.defaultTier.percentile, 75);
  check('cost mid = 85,620', r.costApproach.mid, 85620);
  check('cost low = 66,400', r.costApproach.low, 66400);
  check('cost high = 104,840', r.costApproach.high, 104840);
  check('range.mid rounded', r.range.mid, 85620);
  checkTrue('GM component fell back to Idaho', r.costApproach.components[1].fellBack && r.costApproach.components[1].areaUsedName === 'Idaho');
  checkTrue('fallback disclosed in notes', r.costApproach.notes.some(n => n.includes('Idaho')));
  check('market approach applicable', r.marketApproach.applicable, true);
  check('market mid = 83,200', r.marketApproach.mid, 83200);
  check('market low = 62,400', r.marketApproach.low, 62400);
  check('market high = 104,000', r.marketApproach.high, 104000);
  check('income residual = 57,830.07', r.incomeApproach.residual, 57830.07, 0.01);
  check('income verdict plausible', r.incomeApproach.verdict, 'plausible');
  checkTrue('reconciliation mentions corroboration (within 10%)', r.reconciliation.join(' ').includes('corroborate'));
  checkTrue('no capacity flag', !r.flags.some(f => f.id === 'EXCEEDS_CAPACITY'));
}

// ============================================================ Scenario 2
// Part-time, 20 hrs/wk, 2 yrs experience (-> 25th pct), single 100% role.
// 132011 CdA 25th: $25/hr x 20 x 52 = 26,000 (mid)
// low (10th): 20 x 20 x 52 = 20,800; high (50th): 30 x 20 x 52 = 31,200
console.log('Scenario 2: part-time junior, single role');
{
  const input = {
    client,
    shareholder: { name: 'B', yearsExperience: 2, licenses: '', hoursPerWeek: 20 },
    roleComponents: [{ roleTitle: 'Bookkeeper-owner', soc: '132011', pctTime: 100 }],
    financials: { netIncomeBeforeOfficerComp: 90000, totalDistributions: 0, totalOfficerWages: 26000 },
    compHistory: [],
  };
  const r = engine.analyze(input, FIX, cfg);
  check('default tier is 25th', r.defaultTier.percentile, 25);
  check('cost mid = 26,000', r.costApproach.mid, 26000);
  check('cost low = 20,800', r.costApproach.low, 20800);
  check('cost high = 31,200', r.costApproach.high, 31200);
  checkTrue('no flags on clean part-timer', r.flags.length === 0);
}

// ============================================================ Scenario 3
// Percentile override + hours cap. 8+ yrs (75th default), override to 90th with reason.
// 80 hrs/wk claimed -> capped at 40 (non-owner full-time week). 132011 CdA 90th: $50 x 40 x 52 = 104,000 (mid).
// high band requests pctStep(90,+1) -> stays 90 -> also 104,000.
// low band = 75th: 40 x 40 x 52 = 83,200.
console.log('Scenario 3: override to 90th, hours capped at 40');
{
  const input = {
    client,
    shareholder: { name: 'C', yearsExperience: 15, licenses: '', hoursPerWeek: 80 },
    roleComponents: [{ roleTitle: 'Owner-operator', soc: '132011', pctTime: 100, percentileOverride: 90, overrideReason: 'Senior owner-operator with full management scope' }],
    financials: { netIncomeBeforeOfficerComp: 400000, totalDistributions: 100000, totalOfficerWages: 150000 },
    compHistory: [],
  };
  const r = engine.analyze(input, FIX, cfg);
  check('cost mid = 104,000 (90th, 40 hr cap)', r.costApproach.mid, 104000);
  check('cost low = 83,200 (75th)', r.costApproach.low, 83200);
  check('cost high = 104,000 (clamped at 90th)', r.costApproach.high, 104000);
  checkTrue('override reason preserved', r.costApproach.components[0].percentileReason.includes('management scope'));
  checkTrue('hours-cap note present', r.costApproach.notes.some(n => n.includes('capped at 40')));
}

// ============================================================ Scenario 4
// Red flags: Watson drift, ratio, below-staff, zero-salary patterns.
console.log('Scenario 4: red flags');
{
  const input = {
    client,
    shareholder: { name: 'D', yearsExperience: 10, licenses: '', hoursPerWeek: 40 },
    roleComponents: [{ roleTitle: 'Accountant', soc: '132011', pctTime: 100 }],
    financials: { netIncomeBeforeOfficerComp: 200000, totalDistributions: 90000, totalOfficerWages: 30000, highestNonShareholderWage: 45000 },
    // salary CAGR 0%; distributions 40k->90k over 2 steps = 50%/yr; share 42.9% -> 25.0%
    compHistory: [
      { taxYear: 2023, salaryPaid: 30000, distributionsPaid: 40000 },
      { taxYear: 2024, salaryPaid: 30000, distributionsPaid: 70000 },
      { taxYear: 2025, salaryPaid: 30000, distributionsPaid: 90000 },
    ],
  };
  const r = engine.analyze(input, FIX, cfg);
  const ids = r.flags.map(f => f.id);
  checkTrue('DIST_RATIO_CURRENT (90k/30k = 3.0x > 2.0x)', ids.includes('DIST_RATIO_CURRENT'));
  checkTrue('DIST_RATIO_TRAILING (200k/90k = 2.2x > 2.0x)', ids.includes('DIST_RATIO_TRAILING'));
  checkTrue('WATSON_DRIFT', ids.includes('WATSON_DRIFT'));
  checkTrue('BELOW_STAFF (30k < 45k)', ids.includes('BELOW_STAFF'));
  checkTrue('Watson detail names both years', (r.flags.find(f => f.id === 'WATSON_DRIFT') || {}).detail.includes('2023'));
}

// ============================================================ Scenario 5
// Zero salary with distributions; and capacity/income-approach failure.
// 132011 75th mid = 83,200 > NIBC 40,000 -> EXCEEDS_CAPACITY + negative residual.
console.log('Scenario 5: zero salary, capacity exceeded');
{
  const input = {
    client,
    shareholder: { name: 'E', yearsExperience: 12, licenses: '', hoursPerWeek: 40 },
    roleComponents: [{ roleTitle: 'Accountant', soc: '132011', pctTime: 100 }],
    financials: { netIncomeBeforeOfficerComp: 40000, totalDistributions: 50000, totalOfficerWages: 0 },
    compHistory: [],
  };
  const r = engine.analyze(input, FIX, cfg);
  const ids = r.flags.map(f => f.id);
  checkTrue('ZERO_SALARY_WITH_DISTRIBUTIONS', ids.includes('ZERO_SALARY_WITH_DISTRIBUTIONS'));
  checkTrue('NEAR_ZERO_SALARY', ids.includes('NEAR_ZERO_SALARY'));
  checkTrue('EXCEEDS_CAPACITY', ids.includes('EXCEEDS_CAPACITY'));
  check('income verdict negative', r.incomeApproach.verdict, 'negative');
  check('residual = 40,000 - 83,200 - 6,364.80 = -49,564.80', r.incomeApproach.residual, -49564.80, 0.01);
}

// ============================================================ Scenario 6
// Suppressed percentiles: 292011 has ONLY the median. Requested 75th must
// substitute the published 50th (nearest, conservative) and disclose it.
// mid = 30 x 40 x 52 = 62,400.
console.log('Scenario 6: suppressed percentile substitution');
{
  const input = {
    client,
    shareholder: { name: 'F', yearsExperience: 20, licenses: 'RN', hoursPerWeek: 40 },
    roleComponents: [{ roleTitle: 'Nurse-owner', soc: '292011', pctTime: 100 }],
    financials: { netIncomeBeforeOfficerComp: 120000, totalDistributions: 0, totalOfficerWages: 70000 },
    compHistory: [],
  };
  const r = engine.analyze(input, FIX, cfg);
  check('mid uses published median = 62,400', r.costApproach.mid, 62400);
  check('mid detail shows percentile actually used (50th)', r.costApproach.components[0].midDetail.percentile, 50);
  checkTrue('substitution disclosed in notes', r.costApproach.notes.some(n => n.includes('nearest published percentile')));
}

// ============================================================ Scenario 7
// Market approach NOT applicable when largest role is under the 60% threshold.
console.log('Scenario 7: no dominant role');
{
  const input = {
    client,
    shareholder: { name: 'G', yearsExperience: 10, licenses: '', hoursPerWeek: 40 },
    roleComponents: [
      { roleTitle: 'Accountant', soc: '132011', pctTime: 50 },
      { roleTitle: 'GM', soc: '111021', pctTime: 50 },
    ],
    financials: { netIncomeBeforeOfficerComp: 300000, totalDistributions: 0, totalOfficerWages: 100000 },
    compHistory: [],
  };
  const r = engine.analyze(input, FIX, cfg);
  check('market not applicable', r.marketApproach.applicable, false);
  checkTrue('reason names the threshold', r.marketApproach.reason.includes('60%'));
}

// ============================================================ Integration
// Run against the REAL generated data file: internal consistency only.
console.log('Integration: real May-release OEWS data');
{
  global.window = {};
  require(path.join(__dirname, '..', 'js', 'data', 'oews-data.js'));
  const DATA = global.window.RCT_DATA;
  checkTrue('release label present', /May \d{4}/.test(DATA.release));
  checkTrue('has Coeur d\'Alene', DATA.areas.some(a => a[1].includes("Coeur d'Alene")));
  checkTrue('has Spokane MSA', DATA.areas.some(a => a[1].includes('Spokane-Spokane Valley')));
  checkTrue('has all-state coverage (>= 50 S areas)', DATA.areas.filter(a => a[2] === 'S').length >= 50);

  const input = {
    client: { name: 'Real Co', areaCode: '0017660' },
    shareholder: { name: 'H', yearsExperience: 12, licenses: 'CPA', hoursPerWeek: 45 },
    roleComponents: [
      { roleTitle: 'Accounting', soc: '132011', pctTime: 55 },
      { roleTitle: 'General management', soc: '111021', pctTime: 30 },
      { roleTitle: 'Office administration', soc: '434051', pctTime: 15 },
    ],
    financials: { netIncomeBeforeOfficerComp: 250000, totalDistributions: 120000, totalOfficerWages: 80000 },
    compHistory: [],
  };
  const r = engine.analyze(input, DATA, cfg);
  checkTrue('low < mid < high', r.range.low < r.range.mid && r.range.mid < r.range.high);
  checkTrue('mid in a sane band ($60k–$250k)', r.range.mid > 60000 && r.range.mid < 250000);
  checkTrue('every component traces to an area', r.costApproach.components.every(c => c.missing || c.areaUsedName));
  checkTrue('vintage propagated to result', r.oewsRelease === DATA.release);

  // County picker data: Pennsylvania and Mississippi counties map to their BLS areas.
  const county = (st, name) => DATA.counties.find(c => c[0] === st && c[2] === name);
  checkTrue('PA has all 67 counties', DATA.counties.filter(c => c[0] === '42').length === 67);
  checkTrue('MS has all 82 counties', DATA.counties.filter(c => c[0] === '28').length === 82);
  ['Allegheny County', 'Washington County', 'Butler County'].forEach(n =>
    checkTrue(n + ', PA -> Pittsburgh MSA', county('42', n) && county('42', n)[3] === '0038300'));
  checkTrue('DeSoto County, MS -> Memphis MSA', county('28', 'DeSoto County') && county('28', 'DeSoto County')[3] === '0032820');
  checkTrue('every mapped county has wage data', DATA.counties.every(c => DATA.wages[c[3]]));

  // Cross-state metro falls back to the CLIENT's state, not the metro's primary state.
  const fakeSoc = Object.keys(DATA.wages['2800000']).find(s => !DATA.wages['0032820'][s]);
  if (fakeSoc) {
    const lk = engine.lookupWage(DATA, '0032820', fakeSoc, '28');
    checkTrue('Memphis metro gap falls back to Mississippi', lk && lk.areaUsed === '2800000');
  }
  const pgh = engine.analyze(Object.assign({}, input, { client: { name: 'PA Co', areaCode: '0038300', stateFips: '42' } }), DATA, cfg);
  checkTrue('Pittsburgh analysis prices from Pittsburgh data', pgh.costApproach.components.some(c => c.areaUsed === '0038300'));
  console.log(`  info: real-data recommendation for the test CPA scenario: $${r.range.low.toLocaleString()} / $${r.range.mid.toLocaleString()} / $${r.range.high.toLocaleString()} (${r.oewsRelease})`);
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures ? 1 : 0);
