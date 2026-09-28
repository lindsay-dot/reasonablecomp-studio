/*
 * memo.js — Audit-ready reasonable compensation memo.
 * Opens a print-optimized window; "Save as PDF" in the print dialog produces
 * the deliverable. Every figure shown traces to a visible OEWS row (SOC, area,
 * percentile, vintage) or a documented input — nothing is asserted bare.
 */
(function () {
  'use strict';

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function usd(n) { return n == null || !isFinite(n) ? '—' : '$' + Math.round(n).toLocaleString(); }

  function build(m) {
    var a = m.analysis;
    var yr = m.yearRec;
    var sh = m.shareholder;
    var today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    var html = [];
    html.push('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Reasonable Compensation Analysis — ' + esc(m.client.name) + ' — TY ' + esc(m.year) + '</title>');
    html.push('<style>' + CSS + '</style></head><body class="' + (m.draft ? 'draft' : 'final') + '">');
    html.push('<div class="page-footer">Reasonable compensation workpaper · ' + esc(m.client.name) + ' · TY ' + esc(m.year) + ' · ' + (m.draft ? 'DRAFT' : 'FINAL') + '</div>');
    if (m.draft) html.push('<div class="draft-banner">DRAFT - OPEN FINALIZATION ITEMS REMAIN</div>');

    // ---- 1. identification ----
    html.push('<div class="memo-head"><div><div class="firm">' + esc(m.firm) + '</div><h1>Reasonable Compensation Analysis</h1></div>' +
      '<table class="ident"><tr><td>Company</td><td>' + esc(m.client.name) + ' (' + esc(m.client.entityType || 'S-Corp') + ')</td></tr>' +
      '<tr><td>Shareholder-employee</td><td>' + esc(sh.name) + '</td></tr>' +
      '<tr><td>Tax year</td><td>' + esc(m.year) + '</td></tr>' +
      '<tr><td>Date prepared</td><td>' + today + '</td></tr>' +
      '<tr><td>Preparer</td><td>' + esc(m.preparer) + '</td></tr>' +
      '<tr><td>Record status</td><td><strong>' + (m.draft ? 'DRAFT' : 'FINAL') + '</strong> · readiness ' + esc(m.readiness.score) + '%</td></tr>' +
      '<tr><td>Wage data vintage</td><td>BLS OEWS ' + esc(a.oewsRelease) + ' release</td></tr></table></div>');

    // ---- summary conclusion up front ----
    html.push('<div class="conclusion"><div class="c-label">Reasonable compensation range — reconciled</div>' +
      '<div class="c-range"><span>' + usd(a.range.low) + '<em>low</em></span><span class="c-mid">' + usd(a.range.mid) + '<em>recommended</em></span><span>' + usd(a.range.high) + '<em>high</em></span></div>' +
      '<p class="c-note">Determined under Treas. Reg. §1.162-7(b)(3): the amount that would ordinarily be paid for like services by like enterprises under like circumstances, using the three-approach methodology of the IRS Reasonable Compensation Job Aid for IRS Valuation Professionals. No percentage-of-profit formula was used at any step.</p></div>');

    // ---- 2. source of receipts ----
    var rev = yr.revenueSources || {};
    var revTotal = (Number(rev.shareholderServicesPct) || 0) + (Number(rev.employeeServicesPct) || 0) + (Number(rev.capitalEquipmentPct) || 0);
    html.push('<h2>1 · Source of the corporation\'s gross receipts</h2>');
    html.push('<p>IRS S-corporation guidance begins with what the shareholder-employee actually did and the source of gross receipts. The allocation below is a factual cross-check; it is not a percentage-of-profit compensation formula.</p>');
    html.push('<table class="t"><tr><th>Source</th><th class="num">Allocation</th><th>Compensation relevance</th></tr>' +
      '<tr><td>Shareholder personal services</td><td class="num">' + Number(rev.shareholderServicesPct || 0).toFixed(1) + '%</td><td>Supports wage treatment for services rendered.</td></tr>' +
      '<tr><td>Non-shareholder employee services</td><td class="num">' + Number(rev.employeeServicesPct || 0).toFixed(1) + '%</td><td>May support corporate return not attributable to shareholder labor.</td></tr>' +
      '<tr><td>Capital and equipment</td><td class="num">' + Number(rev.capitalEquipmentPct || 0).toFixed(1) + '%</td><td>May support return on invested capital and operating assets.</td></tr>' +
      '<tr class="total"><td>Total</td><td class="num">' + revTotal.toFixed(1) + '%</td><td>Must reconcile to 100%.</td></tr></table>');
    html.push('<p><strong>Support and reasoning:</strong> ' + esc(rev.notes || 'Not documented.') + '</p>');

    // ---- 3. role breakdown ----
    html.push('<h2>2 · Role composition and market pricing (Cost / Multiple Components approach)</h2>');
    html.push('<p>' + esc(sh.name) + ' devotes approximately <strong>' + esc(yr.hoursPerWeek) + ' hours per week</strong>' +
      (yr.seasonality ? ' (' + esc(yr.seasonality) + ')' : '') + ' to the company. The role was decomposed into its component occupations, each priced against BLS OEWS ' + esc(a.oewsRelease) + ' data for the company’s principal work area (' + (m.client.countyName ? esc(m.client.countyName) + ', which BLS assigns to the ' + esc(m.areaName(m.client.areaCode)) + ' area' : esc(m.areaName(m.client.areaCode))) + '), at the wage percentile supported by the shareholder’s experience and credentials.</p>');
    html.push('<table class="t"><tr><th>Role component</th><th>SOC code &amp; occupation</th><th>Wage data area</th><th>Percentile — basis</th><th class="num">% time</th><th class="num">Low</th><th class="num">Mid</th><th class="num">High</th></tr>');
    a.costApproach.components.forEach(function (cc) {
      html.push('<tr><td>' + esc(cc.roleTitle || m.occTitle(cc.soc)) + '</td><td>' + esc(cc.socDisplay) + ' ' + esc(m.occTitle(cc.soc)) + '</td>' +
        '<td>' + (cc.missing ? 'no data' : esc(cc.areaUsedName) + (cc.fellBack ? '*' : '')) + '</td>' +
        '<td>' + esc(cc.percentile) + 'th — ' + esc(cc.percentileReason) + '</td>' +
        '<td class="num">' + esc(cc.pctTime) + '%</td><td class="num">' + usd(cc.low) + '</td><td class="num">' + usd(cc.mid) + '</td><td class="num">' + usd(cc.high) + '</td></tr>');
    });
    html.push('<tr class="total"><td colspan="4">Blended total, priced at ' + esc(a.costApproach.pricedHoursPerWeek != null ? a.costApproach.pricedHoursPerWeek : yr.hoursPerWeek) + ' hrs/week' + (a.costApproach.pricedHoursPerWeek != null && a.costApproach.pricedHoursPerWeek < Number(yr.hoursPerWeek) ? ' (actual ' + esc(yr.hoursPerWeek) + ')' : '') + '</td><td class="num">' + esc(a.costApproach.totalPctTime) + '%</td><td class="num">' + usd(a.costApproach.low) + '</td><td class="num">' + usd(a.costApproach.mid) + '</td><td class="num">' + usd(a.costApproach.high) + '</td></tr></table>');
    if (a.costApproach.components.some(function (cc) { return cc.fellBack; })) {
      html.push('<p class="fine">* No OEWS estimate published for the requested area at this occupation; the nearest broader geography (state, then national) was used, as noted.</p>');
    }
    a.costApproach.notes.forEach(function (n) { html.push('<p class="fine">• ' + esc(n) + '</p>'); });
    // per-component wage basis (traceability)
    html.push('<p class="fine">Wage basis per component (mid band): ' + a.costApproach.components.filter(function (cc) { return cc.midDetail; }).map(function (cc) {
      return esc(cc.socDisplay) + ': ' + esc(cc.midDetail.basis) + ' at the ' + esc(cc.midDetail.percentile) + 'th percentile';
    }).join('; ') + '.</p>');

    // ---- 4. market + income ----
    html.push('<h2>3 · Market approach</h2>');
    if (a.marketApproach.applicable) {
      html.push('<p>A single occupation — ' + esc(a.marketApproach.socDisplay) + ' ' + esc(m.occTitle(a.marketApproach.soc)) + ' — accounts for ' + esc(a.marketApproach.pctTime) + '% of the shareholder’s time. Priced directly as the full role at ' + esc(a.marketApproach.areaUsedName) + ': <strong>' + usd(a.marketApproach.low) + ' / ' + usd(a.marketApproach.mid) + ' / ' + usd(a.marketApproach.high) + '</strong> (low/mid/high).</p>');
    } else {
      html.push('<p>' + esc(a.marketApproach.reason || 'Not separately applicable.') + '</p>');
    }
    html.push('<h2>4 · Income approach (independent investor test)</h2>');
    if (a.incomeApproach.applicable) {
      html.push('<p>At the proposed compensation of ' + usd(a.incomeApproach.proposedSalary) + ', plus estimated employer payroll cost of ' + usd(a.incomeApproach.employerPayrollTax) + ', the company retains a residual return of <strong>' + usd(a.incomeApproach.residual) + '</strong>' +
        (a.incomeApproach.residualShare != null ? ' (' + (a.incomeApproach.residualShare * 100).toFixed(1) + '% of net income before officer compensation)' : '') + '. ' + esc(a.incomeApproach.narrative) + '</p>');
      html.push('<p class="fine">' + esc(a.incomeApproach.payrollTaxNote) + '</p>');
    } else {
      html.push('<p>' + esc(a.incomeApproach.reason || 'Not performed.') + '</p>');
    }
    html.push('<h2>Reconciliation of the three approaches</h2>');
    a.reconciliation.forEach(function (l) { html.push('<p>' + esc(l) + '</p>'); });

    // ---- 5. multi-factor narrative ----
    html.push('<h2>5 · Multi-factor facts and circumstances</h2><table class="t factors">');
    var factor = function (k, v) { html.push('<tr><td class="fk">' + k + '</td><td>' + v + '</td></tr>'); };
    factor('Training, education, licenses', esc([yr.education, yr.licenses].filter(Boolean).join('; ') || 'Not documented') + (yr.yearsExperience !== '' && yr.yearsExperience != null ? '; ' + esc(yr.yearsExperience) + ' years of relevant experience' : ''));
    factor('Duties and responsibilities', esc(yr.duties || 'See role composition table above.'));
    factor('Time and effort devoted', esc(yr.hoursPerWeek) + ' hours/week' + (yr.seasonality ? '; ' + esc(yr.seasonality) : '; year-round'));
    var hist = (sh.compHistory || []).slice().sort(function (x, y) { return x.taxYear - y.taxYear; });
    if (hist.length) {
      var rows = hist.map(function (h) {
        var s = Number(h.salaryPaid) || 0, d = Number(h.distributionsPaid) || 0;
        return h.taxYear + ': salary ' + usd(s) + ', distributions ' + usd(d) + ((s + d) > 0 ? ' (salary = ' + (s / (s + d) * 100).toFixed(0) + '% of total payout)' : '');
      }).join('<br>');
      factor('Dividend / distribution history', rows);
    } else {
      factor('Dividend / distribution history', 'Not provided.');
    }
    var f = yr.financials || {};
    factor('Compensation of non-shareholder employees', f.highestNonShareholderWage != null ? 'Highest non-shareholder wage: ' + usd(f.highestNonShareholderWage) + (f.highestNonShareholderRole ? ' (' + esc(f.highestNonShareholderRole) + ')' : '') : 'Not provided.');
    factor('Comparable-business pay for comparable services', 'BLS OEWS ' + esc(a.oewsRelease) + ' occupational wage data by SOC code and geography, per the tables above — the same market evidence courts weigh under this factor.');
    factor('Written compensation agreement', (yr.writtenAgreement ? 'Yes' : 'No') + (yr.setInAdvance ? '; figure was set in advance of the year' : '; not documented as set in advance'));
    factor('Formula or method used', 'This analysis: role decomposition priced against published occupational wage data, reconciled across the IRS Job Aid’s cost, market, and income approaches. This memo is the methodology artifact.');
    html.push('</table>');

    // ---- 6. flags ----
    html.push('<h2>6 · Review flags and how they were addressed</h2>');
    if (a.flags.length) {
      html.push('<table class="t"><tr><th>Flag</th><th>Detail</th><th>Preparer response</th></tr>');
      a.flags.forEach(function (fl) {
        var resp = (yr.flagResponses || {})[fl.id];
        html.push('<tr><td><strong>' + esc(fl.title) + '</strong><br><span class="sev sev-' + esc(fl.severity) + '">' + esc(fl.severity) + '</span></td><td>' + esc(fl.detail) + '</td><td>' + (resp ? esc(resp) : '<em>Unaddressed — resolve before finalizing.</em>') + '</td></tr>');
      });
      html.push('</table>');
    } else {
      html.push('<p>No automated review flags were raised on the facts provided.</p>');
    }

    // ---- 7. final figure + signature ----
    html.push('<h2>7 · Conclusion and approval</h2>');
    html.push('<p>Based on the analysis above, reasonable compensation for ' + esc(sh.name) + ' for services rendered to ' + esc(m.client.name) + ' in tax year ' + esc(m.year) + ' falls in the range of <strong>' + usd(a.range.low) + ' to ' + usd(a.range.high) + '</strong>, with a recommended figure of <strong class="big">' + usd(a.range.mid) + '</strong>.</p>');
    html.push('<p><strong>Professional-judgment record:</strong> ' + esc((yr.approval || {}).conclusionNotes || 'Not documented.') + '</p>');
    html.push('<div class="approval"><div><span>Approved by</span><strong>' + esc((yr.approval || {}).approvedBy || 'Not approved') + '</strong></div><div><span>Approval date</span><strong>' + esc((yr.approval || {}).approvedDate || 'Not dated') + '</strong></div><div><span>Status</span><strong>' + esc((yr.approval || {}).status || (m.draft ? 'Draft' : 'Final')) + '</strong></div></div>');

    // ---- 8. evidence ----
    html.push('<h2>8 · Evidence retained in the client file</h2><table class="t"><tr><th>Status</th><th>Evidence item</th></tr>');
    Object.keys(m.cfg.evidenceLabels).forEach(function (key) {
      var retained = !!(yr.evidence || {})[key];
      html.push('<tr><td><strong class="' + (retained ? 'retained' : 'missing') + '">' + (retained ? 'RETAINED' : 'MISSING / N/A') + '</strong></td><td>' + esc(m.cfg.evidenceLabels[key]) + '</td></tr>');
    });
    html.push('</table>');

    // ---- 9. citations, sources, integrity, disclaimer ----
    html.push('<h2>Authorities relied upon</h2><ul class="cites">');
    m.cfg.citations.forEach(function (ct) { html.push('<li><strong>' + esc(ct.cite) + '</strong> — ' + esc(ct.note) + '</li>'); });
    html.push('</ul>');
    html.push('<h2>Source manifest and reproducibility</h2><table class="t sources"><tr><th>Publisher / source</th><th>Use in this workpaper</th></tr>');
    (m.cfg.sourceManifest || []).forEach(function (source) {
      html.push('<tr><td><strong>' + esc(source.publisher) + '</strong><br><span class="source-url">' + esc(source.title) + '<br>' + esc(source.url) + '</span></td><td>' + esc(source.use) + '</td></tr>');
    });
    html.push('</table>');
    html.push('<div class="fingerprint"><strong>Workpaper SHA-256 fingerprint</strong><code>' + esc(m.workpaperFingerprint) + '</code>' +
      '<span>Analysis snapshot: ' + esc(a.analysisFingerprint || 'legacy analysis - re-run to fingerprint') + '</span></div>');
    html.push('<div class="disclaimer">' + esc(m.cfg.disclaimer) + '</div>');
    html.push('<div class="genline">Generated ' + today + ' · BLS OEWS ' + esc(a.oewsRelease) + ' release (data file generated ' + new Date(m.data.generatedAt).toLocaleDateString() + ') · analysis run ' + new Date(a.generatedAt).toLocaleString() + '</div>');

    html.push('<script>window.onload=function(){window.print();};<\/script></body></html>');

    return html.join('\n');
  }

  function open(m) {
    var rendered = build(m);
    var w = window.open('', '_blank');
    if (!w) { alert('Pop-up blocked — allow pop-ups for this page to generate the memo.'); return; }
    w.document.write(rendered);
    w.document.close();
  }

  var CSS = [
    '@page { size: letter; margin: 0.72in 0.72in 0.85in; }',
    'body { font: 11.5pt/1.55 Georgia, "Times New Roman", serif; color: #16202e; margin: 0; }',
    '.page-footer { position: fixed; left: 0; right: 0; bottom: -0.52in; border-top: .5pt solid #b9c4cf; padding-top: 4pt; font: 7.5pt/1.2 Arial, sans-serif; color: #607080; }',
    '.draft-banner { border: 1.5pt solid #b45309; color: #8a4b08; background: #fff7e8; text-align: center; font: bold 9pt/1.2 Arial, sans-serif; letter-spacing: .12em; padding: 5pt; margin-bottom: 12pt; }',
    'h1 { font-size: 19pt; margin: 2pt 0 0; } h2 { font-size: 13pt; margin: 18pt 0 6pt; border-bottom: 1.5pt solid #16202e; padding-bottom: 2pt; }',
    '.firm { font-size: 10pt; letter-spacing: .12em; text-transform: uppercase; color: #555; }',
    '.memo-head { display: flex; justify-content: space-between; gap: 20pt; align-items: flex-start; }',
    'table.ident { font-size: 9.5pt; border-collapse: collapse; } table.ident td { padding: 1.5pt 8pt 1.5pt 0; } table.ident td:first-child { color: #666; padding-right: 14pt; }',
    '.conclusion { border: 2pt solid #16202e; padding: 10pt 14pt; margin: 14pt 0; }',
    '.c-label { font-size: 9pt; text-transform: uppercase; letter-spacing: .1em; color: #555; }',
    '.c-range { display: flex; gap: 28pt; margin: 6pt 0; } .c-range span { font-size: 16pt; font-weight: bold; } .c-range .c-mid { font-size: 20pt; }',
    '.c-range em { display: block; font-size: 8.5pt; font-style: normal; font-weight: normal; color: #555; text-transform: uppercase; letter-spacing: .08em; }',
    '.c-note { font-size: 9.5pt; color: #333; margin: 4pt 0 0; }',
    'table.t { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 6pt 0; }',
    'table.t th, table.t td { border: 0.5pt solid #999; padding: 4pt 6pt; text-align: left; vertical-align: top; }',
    'table.t th { background: #eef1f5; font-size: 8.5pt; text-transform: uppercase; letter-spacing: .04em; }',
    'table.t td.num, table.t th.num { text-align: right; }',
    'table.t tr.total td { font-weight: bold; background: #f5f7fa; }',
    'table.factors td.fk { width: 170pt; font-weight: bold; }',
    '.fine { font-size: 8.5pt; color: #444; margin: 3pt 0; }',
    '.sev { font-size: 8pt; text-transform: uppercase; letter-spacing: .06em; padding: 1pt 6pt; border-radius: 8pt; }',
    '.sev-high { background: #fdeaea; color: #b91c1c; } .sev-medium { background: #fdf3e3; color: #b45309; } .sev-low { background: #eef1f5; color: #444; }',
    '.big { font-size: 14pt; }',
    '.approval { display: grid; grid-template-columns: 1.4fr 1fr .8fr; border: .5pt solid #9aa7b3; margin: 12pt 0; } .approval > div { padding: 7pt 9pt; border-right: .5pt solid #9aa7b3; } .approval > div:last-child { border-right: 0; } .approval span { display:block; font: 7.5pt Arial,sans-serif; color:#667; text-transform:uppercase; letter-spacing:.06em; } .approval strong { display:block; margin-top:2pt; }',
    '.retained { color: #147d78; } .missing { color: #b45309; }',
    '.source-url { font-size: 7.5pt; color: #365f78; overflow-wrap:anywhere; }',
    '.fingerprint { border: .75pt solid #9aa7b3; background: #f4f7f9; padding: 8pt 10pt; margin: 10pt 0; font: 8pt/1.4 Arial,sans-serif; } .fingerprint strong,.fingerprint code,.fingerprint span { display:block; } .fingerprint code { overflow-wrap:anywhere; color:#0e625e; margin:3pt 0; }',
    '.sig { display: flex; gap: 60pt; margin: 34pt 0 10pt; font-size: 10pt; } .sig > div { flex: 1; } .sigline { border-bottom: 1pt solid #16202e; height: 26pt; margin-bottom: 4pt; }',
    'ul.cites { font-size: 9pt; padding-left: 16pt; } ul.cites li { margin: 3pt 0; }',
    '.disclaimer { font-size: 8.5pt; color: #444; border-top: 0.75pt solid #999; margin-top: 14pt; padding-top: 6pt; font-style: italic; }',
    '.genline { font-size: 8pt; color: #777; margin-top: 8pt; }',
    'h2 { page-break-after: avoid; } table.t { page-break-inside: auto; } tr { page-break-inside: avoid; }',
  ].join('\n');

  var api = { open: open, build: build };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else window.RCTMemo = api;
})();
