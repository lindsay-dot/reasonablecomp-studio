/*
 * config.js — Every judgment threshold, tier rule, and citation in one place.
 * Nothing in the engine hard-codes a number that appears in a memo; if a figure
 * drives a recommendation or a red flag, it lives here where it can be seen,
 * defended, and changed deliberately.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RCT_CONFIG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  return {

    // ---- Experience → wage percentile tiers (Cost / Multiple Components approach) ----
    // Default percentile for each role component, from the shareholder's profile.
    // Any component can be overridden with a documented reason; the override and
    // reason are reproduced verbatim in the memo. The 90th percentile is never a
    // default — it is available only as a per-component override (senior
    // owner-operator with management scope for that component).
    percentiles: [10, 25, 50, 75, 90],
    experienceTiers: [
      { maxYears: 3,        percentile: 25, label: 'Less than 3 years relevant experience' },
      { maxYears: 8,        percentile: 50, label: '3–8 years relevant experience' },
      { maxYears: Infinity, percentile: 75, label: 'More than 8 years relevant experience, or licensed specialist' },
    ],
    licensedMinimumPercentile: 75, // holding a professional license floors the default tier here

    // ---- Market approach ----
    // A single SOC code "plainly dominates" the role at or above this share of time;
    // below it the market approach is reported as not separately applicable.
    dominantShareThreshold: 0.60,

    // ---- Full-time equivalency ----
    fullTimeHoursPerWeek: 40,
    weeksPerYear: 52,
    // Hours used for wage pricing are capped here. The cost approach prices each
    // role as a non-owner employee, who would not be expected to work more than a
    // standard full-time week; owner hours above the cap are documented as a
    // facts-and-circumstances factor, not monetized. Part-time (< 40) still pro-rates down.
    maxHoursScale: 40,

    // ---- Income approach (independent investor test) ----
    // Employer payroll cost on the proposed salary. SIMPLIFICATION: flat 7.65%
    // (employer OASDI + Medicare) with no Social Security wage-base ceiling and no
    // FUTA/SUTA — slightly overstates employer cost at high salaries, which is the
    // conservative direction for this test. Stated in the memo where used.
    employerPayrollTaxRate: 0.0765,
    // Residual return below this share of net income before officer comp raises
    // the "thin residual" plausibility flag (not a veto of the market/cost figures).
    thinResidualShare: 0.10,

    // ---- Red-flag thresholds ----
    flags: {
      // Distributions-to-salary ratio, current year and trailing 3-year aggregate.
      distributionsToSalaryRatio: 2.0,
      // Watson-pattern drift: over the comp history window, salary growing at or
      // below salaryStallCagr while distributions grow at or above distributionGrowthCagr,
      // OR salary's share of (salary + distributions) eroding by compShareErosionPoints.
      watson: {
        minYears: 3,
        salaryStallCagr: 0.02,
        distributionGrowthCagr: 0.10,
        compShareErosionPoints: 15,
      },
      // "Zero or near-zero salary with more than de minimis services."
      nearZeroSalary: 10000,
      deMinimisHoursPerWeek: 10,
    },

    // ---- Annual refresh staleness (dashboard) ----
    analysisStaleMonths: 11,

    // ---- Audit-workpaper completion gate (documentation, not a tax-law threshold) ----
    auditRequiredEvidence: [
      'jobDescription',
      'timeSupport',
      'financialStatements',
      'payrollRecords',
      'distributionLedger',
      'compensationResolution',
    ],
    auditReadinessWeights: {
      profile: 12,
      roles: 18,
      overrides: 8,
      revenue: 16,
      analysis: 18,
      flags: 12,
      approval: 10,
      evidence: 6,
    },

    evidenceLabels: {
      jobDescription: 'Contemporaneous job description and duty narrative',
      timeSupport: 'Calendar, time study, or other hours support',
      resumeCredentials: 'Resume, licenses, and credentials',
      financialStatements: 'Financial statements and gross-receipts support',
      payrollRecords: 'Payroll register, Forms 941, and Form W-2',
      distributionLedger: 'Distribution, loan, and shareholder account ledger',
      employeeComp: 'Non-shareholder employee compensation records',
      capitalAssets: 'Asset list and capital/equipment contribution support',
      compensationResolution: 'Compensation agreement or board/shareholder minutes',
    },

    // ---- Citations reproduced in every memo (name/holding only, no quoted text) ----
    citations: [
      { cite: 'IRC §162(a)(1)', note: 'Deduction allowed for a reasonable allowance for salaries or other compensation for personal services actually rendered.' },
      { cite: 'Treas. Reg. §1.162-7(b)(3)', note: 'Reasonable compensation is the amount that would ordinarily be paid for like services by like enterprises under like circumstances.' },
      { cite: 'IRS Fact Sheet FS-2008-25', note: 'Wage compensation for S corporation officers: shareholder-employees performing services must receive reasonable wages before non-wage distributions.' },
      { cite: 'IRS Reasonable Compensation Job Aid for IRS Valuation Professionals', note: 'Describes the cost (multiple components), market, and income approaches applied in this analysis.' },
      { cite: 'Watson v. Commissioner, 668 F.3d 1008 (8th Cir. 2012)', note: 'Distributions reclassified as wages where salary was low relative to substantial services; comparable-wage evidence controlled.' },
      { cite: 'Joseph M. Grey, Public Accountant, P.C. v. Commissioner, 119 T.C. 121 (2002)', note: 'Zero salary while taking distributions reclassified as wages.' },
      { cite: 'Sean McAlary Ltd., Inc. v. Commissioner, T.C. Summ. Op. 2013-62', note: 'Court accepted a third-party valuation methodology using occupational wage data to set reasonable compensation.' },
      { cite: 'Nu-Look Design, Inc. v. Commissioner, 356 F.3d 290 (3d Cir. 2004)', note: 'Zero-salary pattern rejected; payments to controlling shareholder for services treated as wages.' },
    ],

    sourceManifest: [
      {
        publisher: 'Internal Revenue Service',
        title: 'S corporation compensation and medical insurance issues',
        url: 'https://www.irs.gov/businesses/small-businesses-self-employed/s-corporation-compensation-and-medical-insurance-issues',
        use: 'Primary IRS guidance for the source-of-gross-receipts analysis and reasonable-compensation factors.',
      },
      {
        publisher: 'Internal Revenue Service',
        title: 'Instructions for Form 1120-S',
        url: 'https://www.irs.gov/instructions/i1120s',
        use: 'Primary form instructions on officer payments and reasonable compensation.',
      },
      {
        publisher: 'Internal Revenue Service',
        title: 'Reasonable Compensation Job Aid for IRS Valuation Professionals',
        url: 'https://www.irs.gov/pub/irs-lbi/Reasonable%20Compensation%20Job%20Aid%20for%20IRS%20Valuation%20Professionals.pdf',
        use: 'IRS reference material for valuation approaches; not an official IRS position or legal authority.',
      },
      {
        publisher: 'U.S. Bureau of Labor Statistics',
        title: 'Occupational Employment and Wage Statistics',
        url: 'https://www.bls.gov/oes/',
        use: 'Federal occupational wage evidence by occupation and geography.',
      },
      {
        publisher: 'U.S. Bureau of Labor Statistics',
        title: 'OEWS methodology and documentation',
        url: 'https://www.bls.gov/oes/oes_doc.htm',
        use: 'Survey methodology, reliability, scope, and release documentation.',
      },
    ],

    disclaimer:
      'This analysis applies IRS-published reasonable compensation methodology (Reasonable Compensation ' +
      'Job Aid for IRS Valuation Professionals) and BLS Occupational Employment and Wage Statistics (OEWS) ' +
      'wage data. Final determination reflects the preparer’s professional judgment applied to this ' +
      'client’s specific facts and circumstances.',

    educationLevels: [
      'High school / GED',
      'Some college',
      'Associate degree',
      'Bachelor’s degree',
      'Master’s degree',
      'Doctorate / professional degree',
    ],
  };
});
