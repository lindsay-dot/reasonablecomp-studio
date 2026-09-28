/*
 * comp-engine.js — Reasonable compensation calculation engine.
 *
 * Implements and reconciles the three approaches from the IRS Reasonable
 * Compensation Job Aid for IRS Valuation Professionals:
 *   1. Cost / Multiple Components — blend of per-"hat" market wages
 *   2. Market — direct comparable where one SOC code dominates
 *   3. Income — independent investor plausibility test (flags, never the number)
 *
 * Pure functions, no DOM, no globals mutated: runs identically in the browser
 * (window.RCTEngine) and under Node for unit tests (module.exports). Every
 * figure returned carries the trace of the OEWS row and assumptions behind it —
 * nothing in the memo may be untraceable.
 *
 * There is deliberately NO percentage-of-profit shortcut anywhere in this file.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RCTEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PCTS = [10, 25, 50, 75, 90];
  // Wage row layout (see refresh-oews.js): [emp, h10,h25,h50,h75,h90, a10,a25,a50,a75,a90]
  var H_SLOT = { 10: 1, 25: 2, 50: 3, 75: 4, 90: 5 };
  var A_SLOT = { 10: 6, 25: 7, 50: 8, 75: 9, 90: 10 };

  function socDisplay(code) { return code.slice(0, 2) + '-' + code.slice(2); }

  // ---------------------------------------------------------------- data access

  // Wage lookup with MSA -> state -> national fallback. `data` is the object
  // produced by refresh-oews.js (window.RCT_DATA) or a test fixture of the same
  // shape. Returns null only if the SOC is absent even nationally. `stateFips`
  // (optional) is the client's own state: a cross-state metro (e.g. Memphis,
  // TN-MS-AR for a DeSoto County, MS client) falls back to the client's state
  // rather than the metro's primary state.
  function lookupWage(data, areaCode, soc, stateFips) {
    var areaById = {};
    data.areas.forEach(function (a) { areaById[a[0]] = a; });
    var chain = [];
    var cur = areaCode;
    while (cur) {
      chain.push(cur);
      var rec = areaById[cur];
      if (!rec) break;
      if (rec[2] === 'M') cur = (stateFips || rec[3]) + '00000'; // metro -> client's state
      else if (rec[2] === 'S') cur = '0000000';        // state -> national
      else cur = null;                                  // national -> stop
    }
    if (chain[chain.length - 1] !== '0000000') chain.push('0000000');

    for (var i = 0; i < chain.length; i++) {
      var row = data.wages[chain[i]] && data.wages[chain[i]][soc];
      if (row) {
        return {
          row: row,
          topcodeMask: (data.topcode[chain[i]] && data.topcode[chain[i]][soc]) || 0,
          areaUsed: chain[i],
          areaUsedName: areaById[chain[i]] ? areaById[chain[i]][1] : chain[i],
          fellBack: chain[i] !== areaCode,
          requestedArea: areaCode,
          requestedAreaName: areaById[areaCode] ? areaById[areaCode][1] : areaCode,
        };
      }
    }
    return null;
  }

  // Annual wage at a percentile, scaled to actual hours. Prefers the hourly
  // percentile x hours x 52 (exact for part-time); falls back to the annual
  // figure pro-rated on a 40-hour week for annual-only occupations.
  function annualAtPercentile(lookup, percentile, hoursPerWeek, cfg) {
    var row = lookup.row;
    var ft = cfg.fullTimeHoursPerWeek;
    var effHours = Math.min(hoursPerWeek, cfg.maxHoursScale);
    var hoursCapped = hoursPerWeek > cfg.maxHoursScale;
    var hSlot = H_SLOT[percentile], aSlot = A_SLOT[percentile];
    var hourly = row[hSlot], annual = row[aSlot];
    var topcoded = !!(lookup.topcodeMask & ((1 << (hSlot - 1)) | (1 << (aSlot - 1))));
    var value, basis;
    if (hourly != null) {
      value = hourly * effHours * cfg.weeksPerYear;
      basis = 'hourly $' + hourly.toFixed(2) + ' × ' + effHours + ' hrs/wk × ' + cfg.weeksPerYear + ' wks';
    } else if (annual != null) {
      value = annual * (effHours / ft);
      basis = 'annual $' + Math.round(annual).toLocaleString() + ' × ' + effHours + '/' + ft + ' hrs (annual-only occupation)';
    } else {
      return null; // this percentile suppressed
    }
    return { value: value, percentile: percentile, basis: basis, topcoded: topcoded, hoursCapped: hoursCapped };
  }

  // Wage at the requested percentile, falling back to the nearest PUBLISHED
  // percentile when BLS suppressed the requested one — lower percentiles first
  // (the conservative direction), then higher. The percentile actually used is
  // recorded on the result so the memo never claims a percentile it didn't use.
  function availableAt(lookup, percentile, hoursPerWeek, cfg) {
    var start = PCTS.indexOf(percentile);
    var order = [percentile];
    for (var d = 1; d < PCTS.length; d++) {
      if (start - d >= 0) order.push(PCTS[start - d]);
      if (start + d < PCTS.length) order.push(PCTS[start + d]);
    }
    for (var i = 0; i < order.length; i++) {
      var r = annualAtPercentile(lookup, order[i], hoursPerWeek, cfg);
      if (r) { r.substituted = order[i] !== percentile; r.requestedPercentile = percentile; return r; }
    }
    return null;
  }

  // ------------------------------------------------------------- tier defaults

  function defaultPercentile(shareholder, cfg) {
    var yrs = Number(shareholder.yearsExperience) || 0;
    var pct = cfg.experienceTiers[cfg.experienceTiers.length - 1].percentile;
    var label = '';
    for (var i = 0; i < cfg.experienceTiers.length; i++) {
      if (yrs < cfg.experienceTiers[i].maxYears) { pct = cfg.experienceTiers[i].percentile; label = cfg.experienceTiers[i].label; break; }
    }
    var licensed = !!(shareholder.licenses && String(shareholder.licenses).trim());
    if (licensed && pct < cfg.licensedMinimumPercentile) {
      pct = cfg.licensedMinimumPercentile;
      label = 'Licensed/certified (' + shareholder.licenses + ') — floored at ' + pct + 'th percentile';
    }
    return { percentile: pct, reason: label || (yrs + ' years relevant experience') };
  }

  function pctStep(p, step) {
    var i = PCTS.indexOf(p) + step;
    return PCTS[Math.max(0, Math.min(PCTS.length - 1, i))];
  }

  // ------------------------------------------------------------- cost approach

  // components: [{ roleTitle, soc, pctTime (0-100), percentileOverride?, overrideReason? }]
  function costApproach(input, data, cfg) {
    var sh = input.shareholder;
    var hours = Number(sh.hoursPerWeek) || cfg.fullTimeHoursPerWeek;
    var def = defaultPercentile(sh, cfg);
    var totalPct = 0;
    var out = { components: [], notes: [], low: 0, mid: 0, high: 0, hoursPerWeek: hours, defaultTier: def };

    input.roleComponents.forEach(function (rc) {
      var share = (Number(rc.pctTime) || 0) / 100;
      totalPct += Number(rc.pctTime) || 0;
      var lk = lookupWage(data, input.client.areaCode, rc.soc, input.client.stateFips);
      var comp = {
        roleTitle: rc.roleTitle,
        soc: rc.soc,
        socDisplay: socDisplay(rc.soc),
        pctTime: Number(rc.pctTime) || 0,
        percentile: rc.percentileOverride ? Number(rc.percentileOverride) : def.percentile,
        percentileReason: rc.percentileOverride ? (rc.overrideReason || 'Preparer override (no reason recorded)') : def.reason,
        overridden: !!rc.percentileOverride,
      };
      if (!lk) {
        comp.missing = true;
        out.notes.push('No OEWS wage data found for ' + socDisplay(rc.soc) + ' at any geographic level — component excluded; total is understated until resolved.');
        out.components.push(comp);
        return;
      }
      comp.areaUsed = lk.areaUsed;
      comp.areaUsedName = lk.areaUsedName;
      comp.fellBack = lk.fellBack;
      if (lk.fellBack) out.notes.push(socDisplay(rc.soc) + ' (' + rc.roleTitle + '): no published estimate for ' + lk.requestedAreaName + '; used ' + lk.areaUsedName + ' data.');

      ['low', 'mid', 'high'].forEach(function (band, bi) {
        var p = pctStep(comp.percentile, bi - 1);
        var r = availableAt(lk, p, hours, cfg);
        if (r) {
          comp[band] = r.value * share;
          comp[band + 'Detail'] = { percentile: r.percentile, basis: r.basis, topcoded: r.topcoded, substituted: r.substituted };
          if (r.substituted) out.notes.push(socDisplay(rc.soc) + ' (' + rc.roleTitle + '): ' + r.requestedPercentile + 'th percentile not published; nearest published percentile (' + r.percentile + 'th) used for the ' + band + ' band.');
          if (r.topcoded) comp.topcoded = true;
          if (r.hoursCapped) comp.hoursCapped = true;
          out[band] += r.value * share;
        }
      });
      if (comp.topcoded) out.notes.push(socDisplay(rc.soc) + ' (' + rc.roleTitle + '): BLS top-coded wage (' + data.topcodeNote + ') — true market wage may be higher; figure is a floor.');
      out.components.push(comp);
    });

    out.totalPctTime = totalPct;
    out.pricedHoursPerWeek = Math.min(hours, cfg.maxHoursScale);
    if (hours > cfg.maxHoursScale) out.notes.push('Hours per week capped at ' + cfg.maxHoursScale + ' for wage pricing: each role is priced as a non-owner employee on a standard full-time schedule, who would not be expected to work more. Actual hours (' + hours + '/week) are documented as a facts-and-circumstances factor.');
    if (Math.round(totalPct) !== 100) out.notes.push('Role components sum to ' + totalPct + '% of time, not 100% — the blend covers only the allocated share.');
    return out;
  }

  // ----------------------------------------------------------- market approach

  function marketApproach(input, data, cfg, defTier) {
    var rcs = input.roleComponents.slice().sort(function (a, b) { return (b.pctTime || 0) - (a.pctTime || 0); });
    var top = rcs[0];
    var res = { applicable: false };
    if (!top) return res;
    var share = (Number(top.pctTime) || 0) / 100;
    if (share < cfg.dominantShareThreshold) {
      res.reason = 'No single role reaches ' + Math.round(cfg.dominantShareThreshold * 100) + '% of time (largest: ' + socDisplay(top.soc) + ' at ' + top.pctTime + '%). Cost approach controls.';
      return res;
    }
    var lk = lookupWage(data, input.client.areaCode, top.soc, input.client.stateFips);
    if (!lk) { res.reason = 'Dominant role ' + socDisplay(top.soc) + ' has no published OEWS data.'; return res; }
    var hours = Number(input.shareholder.hoursPerWeek) || cfg.fullTimeHoursPerWeek;
    var pct = top.percentileOverride ? Number(top.percentileOverride) : defTier.percentile;
    res.applicable = true;
    res.soc = top.soc; res.socDisplay = socDisplay(top.soc); res.roleTitle = top.roleTitle;
    res.pctTime = top.pctTime; res.percentile = pct;
    res.areaUsedName = lk.areaUsedName; res.fellBack = lk.fellBack;
    ['low', 'mid', 'high'].forEach(function (band, bi) {
      var r = availableAt(lk, pctStep(pct, bi - 1), hours, cfg);
      if (r) { res[band] = r.value; res[band + 'Detail'] = { percentile: r.percentile, basis: r.basis, topcoded: r.topcoded, substituted: r.substituted }; if (r.topcoded) res.topcoded = true; }
    });
    return res;
  }

  // ----------------------------------------------------------- income approach

  function incomeApproach(input, proposedSalary, cfg) {
    var f = input.financials || {};
    var nibc = Number(f.netIncomeBeforeOfficerComp);
    var res = { applicable: isFinite(nibc), proposedSalary: proposedSalary };
    if (!res.applicable) { res.reason = 'Net income before officer compensation not provided.'; return res; }
    var payrollTax = proposedSalary * cfg.employerPayrollTaxRate;
    res.employerPayrollTax = payrollTax;
    res.payrollTaxNote = 'Employer payroll cost estimated at ' + (cfg.employerPayrollTaxRate * 100).toFixed(2) + '% flat (no wage-base ceiling, no FUTA/SUTA) — conservative simplification.';
    res.residual = nibc - proposedSalary - payrollTax;
    res.residualShare = nibc > 0 ? res.residual / nibc : null;
    if (res.residual < 0) {
      res.verdict = 'negative';
      res.narrative = 'The proposed salary exceeds what net income before officer compensation can support; an unrelated investor would retain a negative return. The market-based figure still controls, but the company’s capacity constraint must be documented (e.g., salary set at capacity with the shortfall explained).';
    } else if (res.residualShare !== null && res.residualShare < cfg.thinResidualShare) {
      res.verdict = 'thin';
      res.narrative = 'After the proposed salary, the residual return to the company is under ' + Math.round(cfg.thinResidualShare * 100) + '% of pre-compensation earnings. An independent investor test is strained but not failed; document why the owner’s services account for substantially all of the enterprise’s earnings.';
    } else {
      res.verdict = 'plausible';
      res.narrative = 'After the proposed salary and employer payroll cost, the company retains a residual return an unrelated investor could find acceptable. The independent investor test does not contradict the market-based figure.';
    }
    return res;
  }

  // -------------------------------------------------------------------- flags

  function computeFlags(input, range, cfg) {
    var flags = [];
    var f = input.financials || {};
    var hist = (input.compHistory || []).slice().sort(function (a, b) { return a.taxYear - b.taxYear; });
    var salary = Number(f.totalOfficerWages);
    var dist = Number(f.totalDistributions);
    var fc = cfg.flags;

    // 1. Distributions-to-salary ratio (current year, then trailing 3-year aggregate)
    if (isFinite(dist) && dist > 0) {
      if (!salary || salary <= 0) {
        flags.push({ id: 'ZERO_SALARY_WITH_DISTRIBUTIONS', severity: 'high',
          title: 'Distributions with zero officer wages',
          detail: 'Distributions of $' + Math.round(dist).toLocaleString() + ' with no officer wages — the Grey / Nu-Look pattern the IRS reclassifies first. Establish wages before any further distributions.' });
      } else if (dist / salary > fc.distributionsToSalaryRatio) {
        flags.push({ id: 'DIST_RATIO_CURRENT', severity: 'medium',
          title: 'Distributions-to-salary ratio ' + (dist / salary).toFixed(1) + 'x (current year)',
          detail: 'Current-year distributions are ' + (dist / salary).toFixed(1) + '× officer wages (threshold ' + fc.distributionsToSalaryRatio + '×). Not unlawful by itself, but it is the profile examiners screen for.' });
      }
    }
    var last3 = hist.slice(-3);
    if (last3.length === 3) {
      var s3 = last3.reduce(function (s, y) { return s + (Number(y.salaryPaid) || 0); }, 0);
      var d3 = last3.reduce(function (s, y) { return s + (Number(y.distributionsPaid) || 0); }, 0);
      if (s3 > 0 && d3 / s3 > fc.distributionsToSalaryRatio) {
        flags.push({ id: 'DIST_RATIO_TRAILING', severity: 'medium',
          title: 'Distributions-to-salary ratio ' + (d3 / s3).toFixed(1) + 'x (trailing 3 years)',
          detail: 'Aggregate distributions over the last three years are ' + (d3 / s3).toFixed(1) + '× aggregate salary (threshold ' + fc.distributionsToSalaryRatio + '×).' });
      }
    }

    // 2. Recommended salary exceeds earnings capacity
    var nibc = Number(f.netIncomeBeforeOfficerComp);
    if (isFinite(nibc) && range && range.mid > nibc) {
      flags.push({ id: 'EXCEEDS_CAPACITY', severity: 'high',
        title: 'Recommended salary exceeds pre-compensation earnings',
        detail: 'Market-based mid recommendation ($' + Math.round(range.mid).toLocaleString() + ') exceeds net income before officer compensation ($' + Math.round(nibc).toLocaleString() + '). The company’s ability to pay is a relevant factor, not a legal cap — document why salary was set below the market figure (if it was), and revisit as earnings recover.' });
    }

    // 3. Watson drift: salary flat/down while distributions climb
    if (hist.length >= fc.watson.minYears) {
      var first = hist[0], last = hist[hist.length - 1];
      var n = hist.length - 1;
      var cagr = function (a, b) { return (a > 0 && b > 0) ? Math.pow(b / a, 1 / n) - 1 : null; };
      var sC = cagr(Number(first.salaryPaid), Number(last.salaryPaid));
      var dC = cagr(Number(first.distributionsPaid), Number(last.distributionsPaid));
      var shareOf = function (y) {
        var s = Number(y.salaryPaid) || 0, d = Number(y.distributionsPaid) || 0;
        return (s + d) > 0 ? s / (s + d) * 100 : null;
      };
      var sh0 = shareOf(first), sh1 = shareOf(last);
      var drifted = (sC !== null && dC !== null && sC <= fc.watson.salaryStallCagr && dC >= fc.watson.distributionGrowthCagr) ||
                    (sh0 !== null && sh1 !== null && (sh0 - sh1) >= fc.watson.compShareErosionPoints);
      if (drifted) {
        flags.push({ id: 'WATSON_DRIFT', severity: 'high',
          title: 'Watson pattern: salary stalled while distributions grew',
          detail: 'From ' + first.taxYear + ' to ' + last.taxYear + ', salary ' + (sC === null ? 'is not computable' : 'grew ' + (sC * 100).toFixed(1) + '%/yr') +
            ' while distributions ' + (dC === null ? 'are not computable' : 'grew ' + (dC * 100).toFixed(1) + '%/yr') +
            (sh0 !== null && sh1 !== null ? '; salary share of total owner payout moved from ' + sh0.toFixed(0) + '% to ' + sh1.toFixed(0) + '%' : '') +
            '. A salary that was reasonable when set can become unreasonable as the business grows (Watson v. Commissioner). Reset the salary to current market data.' });
      }
    }

    // 4. Shareholder paid below comparable non-shareholder staff
    var staffWage = Number(f.highestNonShareholderWage);
    if (isFinite(staffWage) && staffWage > 0 && isFinite(salary) && salary > 0 && salary < staffWage) {
      flags.push({ id: 'BELOW_STAFF', severity: 'medium',
        title: 'Officer paid less than highest non-shareholder employee',
        detail: 'Officer wages ($' + Math.round(salary).toLocaleString() + ') are below the highest non-shareholder wage ($' + Math.round(staffWage).toLocaleString() + '). Courts treat internal comparables as strong evidence; be prepared to explain the differential in duties.' });
    }

    // 5. Near-zero salary with more than de minimis services
    var hours = Number(input.shareholder.hoursPerWeek) || 0;
    if (isFinite(salary) && salary < fc.nearZeroSalary && hours >= fc.deMinimisHoursPerWeek) {
      flags.push({ id: 'NEAR_ZERO_SALARY', severity: 'high',
        title: 'Near-zero salary with substantial services',
        detail: 'Officer wages under $' + fc.nearZeroSalary.toLocaleString() + ' while performing ~' + hours + ' hours/week of services. This is the fact pattern of Grey and Nu-Look; wages must reflect services actually rendered.' });
    }

    return flags;
  }

  // ------------------------------------------------------------ reconciliation

  function reconcile(cost, market, income, cfg) {
    var range = { low: Math.round(cost.low), mid: Math.round(cost.mid), high: Math.round(cost.high) };
    var lines = [];
    lines.push('Primary figure: cost (multiple components) approach — the shareholder’s role is priced as its component occupations, each at the percentile supported by experience and licensure, weighted by documented time allocation.');
    if (market.applicable) {
      var div = cost.mid > 0 ? (market.mid - cost.mid) / cost.mid : 0;
      lines.push('Market approach cross-check: ' + market.socDisplay + ' (' + market.roleTitle + ', ' + market.pctTime + '% of time) prices the full role at $' +
        Math.round(market.low).toLocaleString() + ' / $' + Math.round(market.mid).toLocaleString() + ' / $' + Math.round(market.high).toLocaleString() +
        ' (low/mid/high), ' + (Math.abs(div) < 0.10
          ? 'within 10% of the cost-approach blend — the approaches corroborate each other.'
          : (div > 0 ? 'above' : 'below') + ' the cost-approach blend by ' + Math.abs(div * 100).toFixed(0) + '% — the blend reflects time spent in ' + (div > 0 ? 'lower' : 'higher') + '-paid supporting roles, which is exactly what the components document.'));
    } else if (market.reason) {
      lines.push('Market approach: ' + market.reason);
    }
    if (income.applicable) {
      lines.push('Income approach (independent investor test): ' + income.narrative);
    } else if (income.reason) {
      lines.push('Income approach not performed: ' + income.reason);
    }
    return { range: range, narrative: lines };
  }

  // -------------------------------------------------------------------- main

  // input: { client:{areaCode,...}, shareholder:{...}, roleComponents:[...],
  //          financials:{...}, compHistory:[...], proposedSalary? }
  function analyze(input, data, cfg) {
    if (!input.roleComponents || !input.roleComponents.length) {
      throw new Error('At least one role component is required.');
    }
    var defTier = defaultPercentile(input.shareholder, cfg);
    var cost = costApproach(input, data, cfg);
    var market = marketApproach(input, data, cfg, defTier);
    var proposed = Number(input.proposedSalary) || Math.round(cost.mid);
    var income = incomeApproach(input, proposed, cfg);
    var rec = reconcile(cost, market, income, cfg);
    var flags = computeFlags(input, rec.range, cfg);
    if (income.verdict === 'negative') {
      flags.unshift({ id: 'RESIDUAL_NEGATIVE', severity: 'high', title: 'Income approach: negative residual return', detail: income.narrative });
    } else if (income.verdict === 'thin') {
      flags.push({ id: 'RESIDUAL_THIN', severity: 'low', title: 'Income approach: thin residual return', detail: income.narrative });
    }
    return {
      oewsRelease: data.release,
      oewsReleaseYear: data.releaseYear,
      defaultTier: defTier,
      costApproach: cost,
      marketApproach: market,
      incomeApproach: income,
      range: rec.range,
      reconciliation: rec.narrative,
      flags: flags,
      generatedAt: null, // stamped by the caller at save time
    };
  }

  return {
    analyze: analyze,
    lookupWage: lookupWage,
    annualAtPercentile: annualAtPercentile,
    defaultPercentile: defaultPercentile,
    costApproach: costApproach,
    marketApproach: marketApproach,
    incomeApproach: incomeApproach,
    computeFlags: computeFlags,
    socDisplay: socDisplay,
    PCTS: PCTS,
  };
});
