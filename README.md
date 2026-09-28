# ReasonableComp Studio

An offline, audit-workpaper application for documenting S-corporation shareholder-employee reasonable compensation.

This distribution is white labeled. On the client-library screen, use the
**Firm** and **Preparer** buttons to set the names that should appear on memos.

## Open the app

Windows: double-click **Launch ReasonableComp Studio.cmd**. Mac: double-click **Launch ReasonableComp Studio.command** (or open `index.html` in Chrome or Safari). On Windows, It opens in a dedicated Microsoft Edge application window. If Edge is unavailable, it opens in the default browser.

No installation, server, account, or internet connection is required for normal use. Client information remains in the browser's local storage. Export a tamper-evident `.rct.json` client file after meaningful work and retain it with the tax workpapers.

## Recommended workflow

1. Create the S-corporation client and select the principal OEWS work area.
2. Add the shareholder-employee and tax year.
3. Document training, credentials, duties, hours, and seasonality.
4. Split actual work into SOC-coded role components totaling 100%.
5. Enter company financials and multi-year salary/distribution history.
6. Reconcile the IRS source of gross receipts to 100% and document the support.
7. Run the analysis, address every high-severity flag, identify retained evidence, and approve the professional conclusion.
8. Generate a FINAL audit memo and export the client file.

The readiness panel prevents a memo from being labeled FINAL while material documentation items remain open. Draft memos are visibly watermarked.

## Methodology

The tool reconciles the three approaches described in the IRS *Reasonable Compensation Job Aid for IRS Valuation Professionals*:

- Cost / multiple components approach: primary role-by-role replacement-cost analysis.
- Market approach: direct comparable when one SOC occupation dominates the role.
- Income approach: independent-investor plausibility cross-check only.

It also documents the IRS source-of-gross-receipts analysis, facts-and-circumstances factors, compensation/distribution history, retained evidence, and preparer responses to automated review flags.

There is no percentage-of-profit shortcut or 60/40 rule.

## Data and record integrity

- Bundled BLS OEWS May 2025 release with national, all-state, and Idaho, Mississippi, Pennsylvania, and Washington detailed-area data (with a state → county picker).
- Automatic disclosed fallback from local area to state to national figures.
- Stored analysis input snapshot and SHA-256 fingerprint.
- SHA-256 fingerprint on exported client files; imports reject changed fingerprinted records.
- Current-input check invalidates an analysis whenever calculation inputs change.
- Audit memo contains the OEWS vintage, component wage bases, source manifest, workpaper fingerprint, evidence appendix, and approval record.

## Location and hours

- Pick the client's **state**, then the **county** where the work is performed. BLS does not publish wages by county, so each county maps to its BLS metro or nonmetro area (for example, Allegheny, Butler, and Washington counties, PA all map to Pittsburgh, PA). County detail is loaded for Idaho, Mississippi, Pennsylvania, and Washington; other states use statewide figures.
- Hours used for pricing are capped at 40 per week: each role is priced as a non-owner employee on a standard full-time schedule. Actual hours are still documented in the memo. Change `maxHoursScale` in `js/data/config.js` to alter this.

## Annual data refresh

BLS publishes new OEWS data each spring. With [Node.js](https://nodejs.org) installed, run:

```
node scripts/refresh-oews.js --email you@yourfirm.com
```

BLS requires a contact email on its download server. To add county detail for another state, add its FIPS code to `STATE_DETAIL` in `scripts/refresh-oews.js` and rerun.

## Tests

Run after calculation, readiness, integrity, or memo changes:

```powershell
node scripts/test-engine.js
node scripts/test-audit.js
node scripts/test-memo.js
```

Current suite: 75 checks.

## Important limitation

Reasonable compensation is a facts-and-circumstances determination. This tool provides structured decision support and documentation; it does not guarantee an IRS outcome and does not replace the tax professional's judgment.
