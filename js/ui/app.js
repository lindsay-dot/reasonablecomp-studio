/*
 * app.js — UI shell for the Reasonable Comp Tool.
 * Plain JS, no build step. State lives in localStorage and is exported/imported
 * as per-client .rct.json files (same workflow as the tax-strategy tool).
 * All calculation happens in RCTEngine; this file only collects inputs and
 * renders results — no numbers are computed here.
 */
(function () {
  'use strict';

  var DATA = window.RCT_DATA;
  var CFG = window.RCT_CONFIG;
  var ENG = window.RCTEngine;
  var INTEGRITY = window.RCTIntegrity;
  var READINESS = window.RCTReadiness;
  // A distinct storage key prevents a white-label copy from reading data saved
  // by a firm-branded installation on the same computer.
  var LS_KEY = 'reasonablecomp-studio-whitelabel-v1';

  var fmt = {
    usd: function (n) { return n == null || !isFinite(n) ? '—' : '$' + Math.round(n).toLocaleString(); },
    usd2: function (n) { return n == null || !isFinite(n) ? '—' : '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
    pct: function (n) { return n == null ? '—' : (n * 100).toFixed(1) + '%'; },
  };

  // ------------------------------------------------------------------ store

  function newId() { return 'id' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); }

  function loadStore() {
    try { var s = JSON.parse(localStorage.getItem(LS_KEY)); if (s && s.clients) return s; } catch (e) {}
    return { version: 2, preparer: '', firm: 'Your Firm Name', clients: [] };
  }
  var store = loadStore();
  function save() { localStorage.setItem(LS_KEY, JSON.stringify(store)); }

  function findClient(id) { return store.clients.find(function (c) { return c.id === id; }); }
  function findShareholder(c, id) { return (c.shareholders || []).find(function (s) { return s.id === id; }); }
  function yearRec(sh, year) {
    sh.years = sh.years || {};
    if (!sh.years[year]) {
      sh.years[year] = {
        education: '', licenses: '', yearsExperience: '', hoursPerWeek: 40,
        seasonality: '', duties: '', writtenAgreement: false, setInAdvance: false, formulaNote: '',
        roleComponents: [], financials: {}, flagResponses: {}, analysis: null,
        revenueSources: { shareholderServicesPct: 0, employeeServicesPct: 0, capitalEquipmentPct: 0, notes: '' },
        evidence: {},
        approval: { approvedBy: '', approvedDate: '', conclusionNotes: '' },
      };
    }
    var rec = sh.years[year];
    rec.revenueSources = rec.revenueSources || { shareholderServicesPct: 0, employeeServicesPct: 0, capitalEquipmentPct: 0, notes: '' };
    rec.evidence = rec.evidence || {};
    rec.approval = rec.approval || { approvedBy: '', approvedDate: '', conclusionNotes: '' };
    return rec;
  }

  // ------------------------------------------------------------------ data helpers

  var occByCode = {};
  DATA.occupations.forEach(function (o) { occByCode[o[0]] = o; });
  var areaByCode = {};
  DATA.areas.forEach(function (a) { areaByCode[a[0]] = a; });

  function occTitle(code) { return occByCode[code] ? occByCode[code][1] : code; }

  // Client's state: stored explicitly for new/edited clients; derived from the
  // area for clients created before the state/county picker existed.
  function clientStateFips(c) {
    if (c.stateFips) return c.stateFips;
    var a = areaByCode[c.areaCode];
    return a && a[2] !== 'N' ? a[3] : '';
  }
  function areaLabel(c) {
    var name = areaByCode[c.areaCode] ? areaByCode[c.areaCode][1] : 'no area set';
    return c.countyName ? c.countyName + ' → ' + name : name;
  }

  function searchOccupations(q) {
    q = q.trim().toLowerCase();
    if (q.length < 2) return [];
    var terms = q.split(/\s+/);
    var res = [];
    for (var i = 0; i < DATA.occupations.length && res.length < 400; i++) {
      var o = DATA.occupations[i];
      var hay = (o[0] + ' ' + ENG.socDisplay(o[0]) + ' ' + o[1] + ' ' + (o[3] || '')).toLowerCase();
      var hit = terms.every(function (t) { return hay.indexOf(t) !== -1; });
      if (hit) res.push(o);
    }
    // detailed occupations first, then title matches before description-only matches
    res.sort(function (a, b) {
      var ad = a[2] === 'detailed' ? 0 : 1, bd = b[2] === 'detailed' ? 0 : 1;
      if (ad !== bd) return ad - bd;
      var at = a[1].toLowerCase().indexOf(terms[0]) !== -1 ? 0 : 1;
      var bt = b[1].toLowerCase().indexOf(terms[0]) !== -1 ? 0 : 1;
      return at - bt || a[1].localeCompare(b[1]);
    });
    return res.slice(0, 25);
  }

  // ------------------------------------------------------------------ dom helpers

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'class') e.className = attrs[k];
      else if (k === 'html') e.innerHTML = attrs[k];
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) {
      if (c == null) return;
      e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return e;
  }
  function esc(s) { var d = document.createElement('div'); d.textContent = s == null ? '' : String(s); return d.innerHTML; }
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg; t.classList.add('show');
    setTimeout(function () { t.classList.remove('show'); }, 2200);
  }

  var root = document.getElementById('app');

  // ------------------------------------------------------------------ router

  function nav(hash) { location.hash = hash; }
  window.addEventListener('hashchange', render);

  function render() {
    var h = location.hash.replace(/^#\/?/, '');
    var parts = h.split('/');
    root.innerHTML = '';
    if (parts[0] === 'client' && parts[1]) {
      var c = findClient(parts[1]);
      if (!c) return renderDashboard();
      if (parts[2] === 'sh' && parts[3]) {
        var sh = findShareholder(c, parts[3]);
        if (sh) return renderWorkspace(c, sh, parts[4] || String(new Date().getFullYear()));
      }
      return renderClient(c);
    }
    renderDashboard();
  }

  // ------------------------------------------------------------------ dashboard

  function analysisStatus(sh, client) {
    // Most recent analyzed year drives the status pill.
    var years = Object.keys(sh.years || {}).sort();
    if (!years.length) return { cls: 'stale', txt: 'no data' };
    var latest = null;
    var latestYear = null;
    for (var i = years.length - 1; i >= 0; i--) {
      if (sh.years[years[i]].analysis) { latest = sh.years[years[i]].analysis; latestYear = years[i]; break; }
    }
    if (!latest) return { cls: 'stale', txt: 'not analyzed' };
    var flags = (latest.flags || []).filter(function (f) { return f.severity === 'high'; });
    var ageMs = Date.now() - new Date(latest.generatedAt).getTime();
    var staleMs = CFG.analysisStaleMonths * 30.4 * 24 * 3600 * 1000;
    if (latest.oewsRelease !== DATA.release) return { cls: 'stale', txt: 'old data vintage (' + latest.oewsRelease + ')' };
    if (!latest.inputFingerprint || latest.inputFingerprint !== INTEGRITY.fingerprint(buildEngineInput(client, sh, latestYear))) return { cls: 'stale', txt: 'inputs changed - re-run' };
    if (ageMs > staleMs) return { cls: 'stale', txt: 'overdue for refresh' };
    if (flags.length) return { cls: 'high', txt: flags.length + ' high flag' + (flags.length > 1 ? 's' : '') };
    if ((latest.flags || []).length) return { cls: 'medium', txt: (latest.flags || []).length + ' flag(s)' };
    return { cls: 'ok', txt: 'current' };
  }

  function renderDashboard() {
    var shareholderCount = 0, analyzedCount = 0, attentionCount = 0;
    store.clients.forEach(function (client) {
      (client.shareholders || []).forEach(function (shareholder) {
        shareholderCount++;
        var status = analysisStatus(shareholder, client);
        if (status.cls === 'ok') analyzedCount++;
        if (status.cls === 'high' || status.cls === 'stale') attentionCount++;
      });
    });
    var hero = el('section', { class: 'hero' });
    hero.appendChild(el('div', { class: 'hero-copy' }, [
      el('div', { class: 'eyebrow' }, ['AUDIT-READY S-CORP WORKPAPERS']),
      el('h2', {}, ['Reasonable compensation, with every dollar traceable.']),
      el('p', {}, ['Decompose actual duties, price verified OEWS comparables, reconcile three approaches, and preserve the record an examiner can reproduce.']),
    ]));
    var heroStats = el('div', { class: 'hero-stats' });
    [[store.clients.length, 'Clients'], [shareholderCount, 'Shareholders'], [analyzedCount, 'Current'], [attentionCount, 'Need review']].forEach(function (stat) {
      heroStats.appendChild(el('div', { class: 'hero-stat' }, [el('strong', {}, [String(stat[0])]), el('span', {}, [stat[1]])]));
    });
    hero.appendChild(heroStats);
    root.appendChild(hero);
    root.appendChild(el('h2', {}, ['Clients']));
    var card = el('div', { class: 'card' });
    if (!store.clients.length) {
      card.appendChild(el('p', { class: 'muted' }, ['No clients yet. Add your first S-Corp client, or import a saved client file.']));
    }
    store.clients.forEach(function (c) {
      var shs = c.shareholders || [];
      var row = el('div', { class: 'clientrow', onclick: function () { nav('#/client/' + c.id); } });
      row.appendChild(el('div', { class: 'cname' }, [c.name || '(unnamed)']));
      var meta = el('div', { class: 'cmeta' }, [
        (c.entityType || 'S-Corp') + ' · ' + areaLabel(c) + ' · ' + shs.length + ' shareholder' + (shs.length === 1 ? '' : 's'),
      ]);
      shs.forEach(function (sh) {
        var st = analysisStatus(sh, c);
        meta.appendChild(el('span', { class: 'pill ' + st.cls }, [sh.name + ': ' + st.txt]));
      });
      row.appendChild(meta);
      card.appendChild(row);
    });
    root.appendChild(card);

    root.appendChild(el('div', { class: 'btnrow' }, [
      el('button', { onclick: addClient }, ['+ Add client']),
      el('button', { class: 'secondary', onclick: importClientFile }, ['Import client file']),
      el('button', { class: 'ghost', onclick: editFirm }, ['Firm: ' + (store.firm || 'not set')]),
      el('button', { class: 'ghost', onclick: editPreparer }, ['Preparer: ' + (store.preparer || 'not set')]),
    ]));

    root.appendChild(el('p', { class: 'muted' }, [
      'Wage data: BLS OEWS ' + DATA.release + ' release (generated ' + new Date(DATA.generatedAt).toLocaleDateString() + '). ' +
      'Refresh annually each May: node scripts/refresh-oews.js --email you@yourfirm.com',
    ]));
  }

  function addClient() {
    var name = prompt('Client (company) name:');
    if (!name) return;
    var c = { id: newId(), name: name, entityType: 'S-Corp', stateFips: '42', countyCode: '', countyName: '', areaCode: '4200000', fiscalYearEnd: '12/31', shareholders: [] };
    store.clients.push(c); save(); nav('#/client/' + c.id);
  }

  function editPreparer() {
    var p = prompt('Preparer name (appears on every memo):', store.preparer);
    if (p) { store.preparer = p; save(); render(); }
  }

  function editFirm() {
    var firm = prompt('Firm name (appears on every memo):', store.firm || '');
    if (firm != null && firm.trim()) { store.firm = firm.trim(); save(); render(); }
  }

  // ------------------------------------------------------------------ client view

  function renderClient(c) {
    root.appendChild(el('div', { class: 'crumb' }, [el('a', { href: '#/' }, ['Clients']), ' / ' + c.name]));
    root.appendChild(el('h2', {}, [c.name]));

    var card = el('div', { class: 'card' });
    var grid = el('div', { class: 'grid c4' });
    grid.appendChild(field('Company name', c.name, function (v) { c.name = v; }));
    grid.appendChild(selectField('Entity type', c.entityType, ['S-Corp', 'LLC taxed as S-Corp'], function (v) { c.entityType = v; }));
    grid.appendChild(field('Fiscal year end', c.fiscalYearEnd, function (v) { c.fiscalYearEnd = v; }));
    var stateFips = clientStateFips(c);
    var stateSel = el('select', {
      onchange: function () {
        c.stateFips = stateSel.value || undefined;
        c.countyCode = ''; c.countyName = '';
        c.areaCode = stateSel.value ? stateSel.value + '00000' : '0000000';
        save(); render();
      },
    });
    stateSel.appendChild(el('option', { value: '' }, ['National (no state)']));
    DATA.areas.filter(function (a) { return a[2] === 'S'; }).sort(function (a, b) { return a[1].localeCompare(b[1]); }).forEach(function (a) {
      var o = el('option', { value: a[3] }, [a[1]]);
      if (a[3] === stateFips) o.selected = true;
      stateSel.appendChild(o);
    });
    grid.appendChild(el('div', {}, [el('label', {}, ['State']), stateSel]));

    var stateCounties = (DATA.counties || []).filter(function (k) { return k[0] === stateFips; });
    if (stateCounties.length) {
      var countySel = el('select', {
        onchange: function () {
          var k = stateCounties.find(function (x) { return x[1] === countySel.value; });
          c.countyCode = k ? k[1] : ''; c.countyName = k ? k[2] : '';
          c.areaCode = k ? k[3] : stateFips + '00000';
          save(); render();
        },
      });
      countySel.appendChild(el('option', { value: '' }, ['(statewide — no county)']));
      stateCounties.forEach(function (k) {
        var o = el('option', { value: k[1] }, [k[2]]);
        if (k[1] === c.countyCode) o.selected = true;
        countySel.appendChild(o);
      });
      grid.appendChild(el('div', {}, [el('label', {}, ['County where the work is performed']), countySel]));
    }
    card.appendChild(grid);
    card.appendChild(el('p', {}, [el('strong', {}, ['OEWS wage area: ']), areaLabel(c)]));
    card.appendChild(el('p', { class: 'muted' }, [
      'BLS does not publish wages by county; each county belongs to one metro or nonmetro area, and that area’s wages are used. ' +
      (stateFips && !stateCounties.length ? 'County detail is not loaded for this state, so statewide wages are used (add the state to STATE_DETAIL in scripts/refresh-oews.js to enable it). ' : '') +
      'If an occupation has no published figure for the area, the tool falls back to the state, then national figure — and says so in the memo.']));
    root.appendChild(card);

    root.appendChild(el('h3', {}, ['Shareholder-employees']));
    var shCard = el('div', { class: 'card' });
    (c.shareholders || []).forEach(function (sh) {
      var st = analysisStatus(sh, c);
      var row = el('div', { class: 'clientrow', onclick: function () { nav('#/client/' + c.id + '/sh/' + sh.id); } });
      row.appendChild(el('div', { class: 'cname' }, [sh.name]));
      row.appendChild(el('div', { class: 'cmeta' }, [el('span', { class: 'pill ' + st.cls }, [st.txt])]));
      shCard.appendChild(row);
    });
    if (!(c.shareholders || []).length) shCard.appendChild(el('p', { class: 'muted' }, ['No shareholder-employees yet.']));
    root.appendChild(shCard);

    root.appendChild(el('div', { class: 'btnrow' }, [
      el('button', { onclick: function () { var n = prompt('Shareholder-employee name:'); if (!n) return; c.shareholders.push({ id: newId(), name: n, years: {}, compHistory: [] }); save(); render(); } }, ['+ Add shareholder-employee']),
      el('button', { class: 'secondary', onclick: function () { exportClient(c); } }, ['Export client file']),
      el('button', { class: 'danger', onclick: function () {
        if (confirm('Delete client "' + c.name + '" and all analyses? Export a client file first if you want a backup.')) {
          store.clients = store.clients.filter(function (x) { return x.id !== c.id; }); save(); nav('#/');
        }
      } }, ['Delete client']),
    ]));

    function field(lbl, val, set) {
      return el('div', {}, [el('label', {}, [lbl]), el('input', { value: val || '', onchange: function (e) { set(e.target.value); save(); } })]);
    }
    function selectField(lbl, val, opts, set) {
      var s = el('select', { onchange: function (e) { set(e.target.value); save(); } });
      opts.forEach(function (o) { var op = el('option', { value: o }, [o]); if (o === val) op.selected = true; s.appendChild(op); });
      return el('div', {}, [el('label', {}, [lbl]), s]);
    }
  }

  // ------------------------------------------------------------------ workspace

  function renderWorkspace(c, sh, year) {
    var yr = yearRec(sh, year);
    root.appendChild(el('div', { class: 'crumb' }, [
      el('a', { href: '#/' }, ['Clients']), ' / ',
      el('a', { href: '#/client/' + c.id }, [c.name]), ' / ' + sh.name,
    ]));

    var head = el('div', { style: 'display:flex;align-items:baseline;gap:14px;flex-wrap:wrap' });
    head.appendChild(el('h2', {}, [sh.name + ' — tax year ' + year]));
    var yearSel = el('select', { style: 'width:auto', onchange: function (e) { nav('#/client/' + c.id + '/sh/' + sh.id + '/' + e.target.value); } });
    var thisYear = new Date().getFullYear();
    var yearsList = Object.keys(sh.years || {});
    for (var y = thisYear + 1; y >= thisYear - 6; y--) if (yearsList.indexOf(String(y)) === -1) yearsList.push(String(y));
    yearsList.sort().reverse().forEach(function (y2) {
      var o = el('option', { value: y2 }, [y2]); if (y2 === year) o.selected = true; yearSel.appendChild(o);
    });
    head.appendChild(yearSel);
    root.appendChild(head);

    var currentInputFingerprint = INTEGRITY.fingerprint(buildEngineInput(c, sh, year));
    var readiness = READINESS.evaluate(yr, yr.analysis, DATA, CFG, currentInputFingerprint);
    var health = el('section', { class: 'readiness-card ' + (readiness.finalizable ? 'ready' : 'open') });
    var ring = el('div', { class: 'score-ring', style: '--score:' + readiness.score }, [
      el('strong', {}, [readiness.score + '%']),
      el('span', {}, ['complete']),
    ]);
    health.appendChild(ring);
    var healthCopy = el('div', { class: 'readiness-copy' });
    healthCopy.appendChild(el('div', { class: 'eyebrow' }, [readiness.finalizable ? 'READY TO FINALIZE' : readiness.blockers.length + ' FINALIZATION ITEM' + (readiness.blockers.length === 1 ? '' : 'S') + ' OPEN']));
    healthCopy.appendChild(el('h3', {}, [readiness.finalizable ? 'Audit package is internally complete' : 'Finish the record before issuing a final memo']));
    var chips = el('div', { class: 'readiness-chips' });
    readiness.items.forEach(function (item) {
      chips.appendChild(el('span', { class: 'readiness-chip ' + (item.complete ? 'done' : item.blocking ? 'block' : 'review') }, [(item.complete ? '✓ ' : '○ ') + item.label]));
    });
    healthCopy.appendChild(chips);
    health.appendChild(healthCopy);
    root.appendChild(health);

    // ---- facts & circumstances (structured multi-factor inputs) ----
    var fc = el('div', { class: 'card' });
    fc.appendChild(el('h3', { style: 'margin-top:0' }, ['Facts & circumstances (multi-factor test inputs)']));
    var g = el('div', { class: 'grid c3' });
    g.appendChild(selField('Education', yr.education, [''].concat(CFG.educationLevels), function (v) { yr.education = v; }));
    g.appendChild(txtField('Licenses / certifications', yr.licenses, function (v) { yr.licenses = v; }, 'e.g. CPA, PE, RN — raises the default wage percentile'));
    g.appendChild(numField('Years of relevant experience', yr.yearsExperience, function (v) { yr.yearsExperience = v; }));
    g.appendChild(numField('Hours per week devoted', yr.hoursPerWeek, function (v) { yr.hoursPerWeek = v; }));
    g.appendChild(txtField('Seasonality / part-year note', yr.seasonality, function (v) { yr.seasonality = v; }, 'blank = year-round'));
    fc.appendChild(g);
    fc.appendChild(el('label', { style: 'margin-top:10px' }, ['Duties and responsibilities actually performed (reported verbatim in the memo; tie to the role components below)']));
    fc.appendChild(el('textarea', { onchange: function (e) { yr.duties = e.target.value; save(); } }, [yr.duties || '']));
    fc.appendChild(checkLine('A written compensation agreement / board resolution exists', yr.writtenAgreement, function (v) { yr.writtenAgreement = v; }));
    fc.appendChild(checkLine('The compensation figure was set in advance of the year', yr.setInAdvance, function (v) { yr.setInAdvance = v; }));
    root.appendChild(fc);

    // ---- role components ----
    var rcCard = el('div', { class: 'card' });
    rcCard.appendChild(el('h3', { style: 'margin-top:0' }, ['Role components — the "hats"']));
    rcCard.appendChild(el('p', { class: 'muted' }, ['Decompose what ' + sh.name + ' actually does into occupations. Percentile defaults from experience/licensure (' + describeTier() + '); override per component only with a documented reason.']));
    var tbl = el('table', { class: 'data' });
    tbl.appendChild(el('tr', {}, [
      el('th', {}, ['Role / hat']), el('th', {}, ['SOC occupation']), el('th', { class: 'num' }, ['% time']),
      el('th', {}, ['Percentile']), el('th', {}, ['Override reason']), el('th', {}, ['']),
    ]));
    yr.roleComponents.forEach(function (rc, idx) {
      var tr = el('tr');
      tr.appendChild(el('td', {}, [el('input', { value: rc.roleTitle || '', onchange: function (e) { rc.roleTitle = e.target.value; save(); } })]));
      tr.appendChild(el('td', { style: 'min-width:260px' }, [socPicker(rc)]));
      tr.appendChild(el('td', { class: 'num', style: 'width:80px' }, [el('input', { type: 'number', value: rc.pctTime || '', onchange: function (e) { rc.pctTime = Number(e.target.value); save(); renderTotals(); } })]));
      var pctSel = el('select', { onchange: function (e) { rc.percentileOverride = e.target.value ? Number(e.target.value) : null; save(); } });
      [['', 'default'], ['10', '10th'], ['25', '25th'], ['50', '50th (median)'], ['75', '75th'], ['90', '90th']].forEach(function (o) {
        var op = el('option', { value: o[0] }, [o[1]]);
        if (String(rc.percentileOverride || '') === o[0]) op.selected = true;
        pctSel.appendChild(op);
      });
      tr.appendChild(el('td', { style: 'width:130px' }, [pctSel]));
      tr.appendChild(el('td', {}, [el('input', { value: rc.overrideReason || '', placeholder: 'required if overridden', onchange: function (e) { rc.overrideReason = e.target.value; save(); } })]));
      tr.appendChild(el('td', {}, [el('button', { class: 'ghost small', onclick: function () { yr.roleComponents.splice(idx, 1); save(); render(); } }, ['✕'])]));
      tbl.appendChild(tr);
    });
    rcCard.appendChild(tbl);
    var totRow = el('p', { class: 'muted' });
    rcCard.appendChild(totRow);
    function renderTotals() {
      var t = yr.roleComponents.reduce(function (s, rc) { return s + (Number(rc.pctTime) || 0); }, 0);
      totRow.textContent = 'Time allocated: ' + t + '%' + (Math.round(t) !== 100 ? ' — should total 100%' : '');
    }
    renderTotals();
    rcCard.appendChild(el('div', { class: 'btnrow' }, [
      el('button', { class: 'secondary small', onclick: function () { yr.roleComponents.push({ roleTitle: '', soc: '', pctTime: 0 }); save(); render(); } }, ['+ Add role component']),
    ]));
    root.appendChild(rcCard);

    // ---- financials & comp history ----
    var fin = el('div', { class: 'card' });
    fin.appendChild(el('h3', { style: 'margin-top:0' }, ['Company financials — tax year ' + year]));
    var fg = el('div', { class: 'grid c4' });
    var f = yr.financials;
    fg.appendChild(numField('Net income BEFORE officer comp', f.netIncomeBeforeOfficerComp, function (v) { f.netIncomeBeforeOfficerComp = v; }));
    fg.appendChild(numField('Total distributions to this shareholder', f.totalDistributions, function (v) { f.totalDistributions = v; }));
    fg.appendChild(numField('Officer wages paid (current/planned)', f.totalOfficerWages, function (v) { f.totalOfficerWages = v; }));
    fg.appendChild(numField('Highest non-shareholder employee wage', f.highestNonShareholderWage, function (v) { f.highestNonShareholderWage = v; }));
    fin.appendChild(fg);
    fin.appendChild(el('label', { style: 'margin-top:8px' }, ['Highest-paid non-shareholder role (for the internal-comparable factor)']));
    fin.appendChild(el('input', { value: f.highestNonShareholderRole || '', onchange: function (e) { f.highestNonShareholderRole = e.target.value; save(); } }));
    root.appendChild(fin);

    // ---- source of gross receipts (IRS primary framing for S-corp officer wages) ----
    var src = yr.revenueSources;
    var srcCard = el('div', { class: 'card source-card' });
    srcCard.appendChild(el('div', { class: 'section-heading' }, [
      el('div', {}, [el('div', { class: 'eyebrow' }, ['IRS SOURCE-OF-RECEIPTS TEST']), el('h3', { style: 'margin:2px 0 0' }, ['What generated the corporation\'s gross receipts?'])]),
      el('span', { class: 'total-badge ' + (Math.abs(readiness.revenueTotalPct - 100) < 0.01 ? 'ok' : 'bad') }, [readiness.revenueTotalPct.toFixed(1) + '% allocated']),
    ]));
    srcCard.appendChild(el('p', { class: 'muted' }, ['Allocate receipts among shareholder services, other employee services, and capital/equipment. This cross-check is separate from the wage-market calculation and should tie to financial records.']));
    var srcGrid = el('div', { class: 'grid c3' });
    srcGrid.appendChild(numField('Shareholder personal services %', src.shareholderServicesPct, function (v) { src.shareholderServicesPct = v; }));
    srcGrid.appendChild(numField('Non-shareholder employee services %', src.employeeServicesPct, function (v) { src.employeeServicesPct = v; }));
    srcGrid.appendChild(numField('Capital and equipment %', src.capitalEquipmentPct, function (v) { src.capitalEquipmentPct = v; }));
    srcCard.appendChild(srcGrid);
    srcCard.appendChild(el('label', { style: 'margin-top:10px' }, ['How the allocation was determined and where the support is retained']));
    var srcNotes = el('textarea', { placeholder: 'Tie the allocation to the engagement ledger, employee production reports, contracts, and fixed-asset schedule.', onchange: function (e) { src.notes = e.target.value; save(); render(); } });
    srcNotes.value = src.notes || '';
    srcCard.appendChild(srcNotes);
    root.appendChild(srcCard);

    var ch = el('div', { class: 'card' });
    ch.appendChild(el('h3', { style: 'margin-top:0' }, ['Compensation & distribution history (multi-year — the Watson-pattern detector reads this)']));
    var chTbl = el('table', { class: 'data' });
    chTbl.appendChild(el('tr', {}, [el('th', {}, ['Tax year']), el('th', { class: 'num' }, ['Salary paid']), el('th', { class: 'num' }, ['Distributions paid']), el('th', { class: 'num' }, ['Salary share of payout']), el('th', {}, [''])]));
    (sh.compHistory || []).sort(function (a, b) { return a.taxYear - b.taxYear; }).forEach(function (row, idx) {
      var s = Number(row.salaryPaid) || 0, d = Number(row.distributionsPaid) || 0;
      var tr = el('tr');
      tr.appendChild(el('td', {}, [el('input', { type: 'number', value: row.taxYear || '', onchange: function (e) { row.taxYear = Number(e.target.value); save(); } })]));
      tr.appendChild(el('td', { class: 'num' }, [el('input', { type: 'number', value: row.salaryPaid == null ? '' : row.salaryPaid, onchange: function (e) { row.salaryPaid = Number(e.target.value); save(); render(); } })]));
      tr.appendChild(el('td', { class: 'num' }, [el('input', { type: 'number', value: row.distributionsPaid == null ? '' : row.distributionsPaid, onchange: function (e) { row.distributionsPaid = Number(e.target.value); save(); render(); } })]));
      tr.appendChild(el('td', { class: 'num' }, [(s + d) > 0 ? (s / (s + d) * 100).toFixed(0) + '%' : '—']));
      tr.appendChild(el('td', {}, [el('button', { class: 'ghost small', onclick: function () { sh.compHistory.splice(idx, 1); save(); render(); } }, ['✕'])]));
      chTbl.appendChild(tr);
    });
    ch.appendChild(chTbl);
    ch.appendChild(el('div', { class: 'btnrow' }, [
      el('button', { class: 'secondary small', onclick: function () { (sh.compHistory = sh.compHistory || []).push({ taxYear: Number(year), salaryPaid: null, distributionsPaid: null }); save(); render(); } }, ['+ Add year']),
    ]));
    root.appendChild(ch);

    // ---- evidence retained + professional approval ----
    var evidenceCard = el('div', { class: 'card' });
    evidenceCard.appendChild(el('div', { class: 'section-heading' }, [
      el('div', {}, [el('div', { class: 'eyebrow' }, ['AUDIT FILE']), el('h3', { style: 'margin:2px 0 0' }, ['Evidence retained'])]),
      el('span', { class: 'total-badge ' + (readiness.evidenceCount === readiness.evidenceRequired ? 'ok' : 'warn') }, [readiness.evidenceCount + ' / ' + readiness.evidenceRequired + ' core']),
    ]));
    var evidenceGrid = el('div', { class: 'evidence-grid' });
    Object.keys(CFG.evidenceLabels).forEach(function (key) {
      evidenceGrid.appendChild(checkLine(CFG.evidenceLabels[key], yr.evidence[key], function (v) { yr.evidence[key] = v; save(); render(); }));
    });
    evidenceCard.appendChild(evidenceGrid);
    root.appendChild(evidenceCard);

    var approvalCard = el('div', { class: 'card approval-card' });
    approvalCard.appendChild(el('div', { class: 'eyebrow' }, ['PROFESSIONAL JUDGMENT']));
    approvalCard.appendChild(el('h3', { style: 'margin:2px 0 10px' }, ['Conclusion and approval']));
    var approvalGrid = el('div', { class: 'grid c3' });
    approvalGrid.appendChild(txtField('Approved by', yr.approval.approvedBy, function (v) { yr.approval.approvedBy = v; }, 'CPA / EA reviewer'));
    approvalGrid.appendChild(el('div', {}, [el('label', {}, ['Approval date']), el('input', { type: 'date', value: yr.approval.approvedDate || '', onchange: function (e) { yr.approval.approvedDate = e.target.value; save(); render(); } })]));
    approvalGrid.appendChild(txtField('Conclusion status', yr.approval.status || 'Final', function (v) { yr.approval.status = v; }, 'Final / planning / amended'));
    approvalCard.appendChild(approvalGrid);
    approvalCard.appendChild(el('label', { style: 'margin-top:10px' }, ['Case-specific reconciliation and professional-judgment notes']));
    var conclusionNotes = el('textarea', { placeholder: 'Explain why the reconciled recommendation fits this shareholder, this company, and this tax year.', onchange: function (e) { yr.approval.conclusionNotes = e.target.value; save(); } });
    conclusionNotes.value = yr.approval.conclusionNotes || '';
    approvalCard.appendChild(conclusionNotes);
    root.appendChild(approvalCard);

    // ---- run analysis ----
    root.appendChild(el('div', { class: 'btnrow' }, [
      el('button', { onclick: function () { runAnalysis(c, sh, year); } }, [yr.analysis ? 'Re-run analysis' : 'Run analysis']),
      yr.analysis ? el('button', { class: readiness.finalizable ? 'secondary' : 'ghost', onclick: function () { generateMemo(c, sh, year); } }, [readiness.finalizable ? 'Generate FINAL audit memo' : 'Generate DRAFT memo (' + readiness.blockers.length + ' open)']) : null,
      el('button', { class: 'ghost', onclick: function () { exportClient(c); } }, ['Export client file']),
    ]));

    if (yr.analysis) renderAnalysis(c, sh, year, yr.analysis);

    // helpers
    function selField(lbl, val, opts, set) {
      var s = el('select', { onchange: function (e) { set(e.target.value); save(); } });
      opts.forEach(function (o) { var op = el('option', { value: o }, [o || '(select)']); if (o === val) op.selected = true; s.appendChild(op); });
      return el('div', {}, [el('label', {}, [lbl]), s]);
    }
    function txtField(lbl, val, set, ph) {
      return el('div', {}, [el('label', {}, [lbl]), el('input', { value: val || '', placeholder: ph || '', onchange: function (e) { set(e.target.value); save(); render(); } })]);
    }
    function numField(lbl, val, set) {
      return el('div', {}, [el('label', {}, [lbl]), el('input', { type: 'number', value: val == null || val === '' ? '' : val, onchange: function (e) { set(e.target.value === '' ? null : Number(e.target.value)); save(); render(); } })]);
    }
    function checkLine(lbl, val, set) {
      var cb = el('input', { type: 'checkbox', onchange: function (e) { set(e.target.checked); save(); } });
      cb.checked = !!val;
      return el('div', { class: 'checkline' }, [cb, lbl]);
    }
    function describeTier() {
      var t = ENG.defaultPercentile({ yearsExperience: yr.yearsExperience, licenses: yr.licenses }, CFG);
      return 'currently ' + t.percentile + 'th percentile: ' + t.reason;
    }
    function socPicker(rc) {
      var wrap = el('div', { class: 'autocomplete' });
      var inp = el('input', {
        value: rc.soc ? ENG.socDisplay(rc.soc) + ' ' + occTitle(rc.soc) : '',
        placeholder: 'search occupation…',
      });
      var list = el('div', { class: 'ac-list hidden' });
      inp.addEventListener('input', function () {
        var res = searchOccupations(inp.value);
        list.innerHTML = '';
        if (!res.length) { list.classList.add('hidden'); return; }
        res.forEach(function (o) {
          var item = el('div', { class: 'ac-item', onmousedown: function (ev) {
            ev.preventDefault();
            rc.soc = o[0];
            if (!rc.roleTitle) rc.roleTitle = o[1];
            save(); render();
          } }, [
            el('div', { class: 't' }, [ENG.socDisplay(o[0]) + '  ' + o[1] + (o[2] !== 'detailed' ? '  (' + o[2] + ' group)' : '')]),
            el('div', { class: 'd' }, [o[3] || '']),
          ]);
          list.appendChild(item);
        });
        list.classList.remove('hidden');
      });
      inp.addEventListener('blur', function () { setTimeout(function () { list.classList.add('hidden'); }, 150); });
      wrap.appendChild(inp); wrap.appendChild(list);
      return wrap;
    }
  }

  // ------------------------------------------------------------------ analysis

  function buildEngineInput(c, sh, year) {
    var yr = yearRec(sh, year);
    return {
      client: { name: c.name, areaCode: c.areaCode, stateFips: clientStateFips(c) || undefined },
      shareholder: {
        name: sh.name, taxYear: year,
        education: yr.education, licenses: yr.licenses,
        yearsExperience: yr.yearsExperience, hoursPerWeek: yr.hoursPerWeek,
      },
      roleComponents: yr.roleComponents.filter(function (rc) { return rc.soc; }),
      financials: yr.financials,
      compHistory: sh.compHistory || [],
    };
  }

  function runAnalysis(c, sh, year) {
    var yr = yearRec(sh, year);
    var input = buildEngineInput(c, sh, year);
    if (!input.roleComponents.length) { toast('Add at least one role component with an occupation first.'); return; }
    try {
      var result = ENG.analyze(input, DATA, CFG);
      result.generatedAt = new Date().toISOString();
      result.inputSnapshot = JSON.parse(JSON.stringify(input)); // methodology snapshot: inputs frozen with the result
      result.inputFingerprint = INTEGRITY.fingerprint(result.inputSnapshot);
      result.analysisFingerprint = INTEGRITY.fingerprint({
        methodology: 'RCT-2.0',
        generatedAt: result.generatedAt,
        oewsRelease: result.oewsRelease,
        inputSnapshot: result.inputSnapshot,
        costApproach: result.costApproach,
        marketApproach: result.marketApproach,
        incomeApproach: result.incomeApproach,
        range: result.range,
        reconciliation: result.reconciliation,
        flags: result.flags,
      });
      yr.analysis = result;
      // prune flag responses for flags that no longer exist
      var ids = result.flags.map(function (f) { return f.id; });
      Object.keys(yr.flagResponses || {}).forEach(function (k) { if (ids.indexOf(k) === -1) delete yr.flagResponses[k]; });
      save(); render();
      toast('Analysis complete — ' + fmt.usd(result.range.mid) + ' mid recommendation');
    } catch (e) {
      toast('Analysis failed: ' + e.message);
    }
  }

  function renderAnalysis(c, sh, year, a) {
    var yr = yearRec(sh, year);
    var wrap = el('div', {});
    wrap.appendChild(el('h2', {}, ['Analysis — reconciled range', el('span', { class: 'muted', style: 'font-weight:400;font-size:13px' }, ['  OEWS ' + a.oewsRelease + ' · run ' + new Date(a.generatedAt).toLocaleString()])]));

    var banner = el('div', { class: 'range-banner' });
    [['low', 'Low'], ['mid', 'Recommended'], ['high', 'High']].forEach(function (b) {
      banner.appendChild(el('div', { class: 'range-box ' + b[0] }, [
        el('div', { class: 'lbl' }, [b[1]]),
        el('div', { class: 'amt' }, [fmt.usd(a.range[b[0]])]),
      ]));
    });
    wrap.appendChild(banner);

    // flags first — never buried
    if (a.flags.length) {
      wrap.appendChild(el('h3', {}, ['Red flags (' + a.flags.length + ')']));
      a.flags.forEach(function (f) {
        var box = el('div', { class: 'flag ' + f.severity });
        box.appendChild(el('div', { class: 'ftitle' }, [f.title, el('span', { class: 'pill ' + f.severity }, [f.severity])]));
        box.appendChild(el('div', { class: 'fdetail' }, [f.detail]));
        var ta = el('textarea', { placeholder: 'How was this addressed? (reproduced in the memo)', onchange: function (e) { yr.flagResponses[f.id] = e.target.value; save(); } });
        ta.value = yr.flagResponses[f.id] || '';
        box.appendChild(ta);
        wrap.appendChild(box);
      });
    } else {
      wrap.appendChild(el('p', {}, [el('span', { class: 'pill ok' }, ['no red flags raised'])]));
    }

    // cost approach table
    var costCard = el('div', { class: 'card' });
    costCard.appendChild(el('h3', { style: 'margin-top:0' }, ['1 · Cost / multiple components approach (primary)']));
    var t = el('table', { class: 'data' });
    t.appendChild(el('tr', {}, [el('th', {}, ['Role']), el('th', {}, ['SOC']), el('th', {}, ['Wage data area']), el('th', {}, ['Percentile (why)']), el('th', { class: 'num' }, ['% time']), el('th', { class: 'num' }, ['Low']), el('th', { class: 'num' }, ['Mid']), el('th', { class: 'num' }, ['High'])]));
    a.costApproach.components.forEach(function (cc) {
      t.appendChild(el('tr', {}, [
        el('td', {}, [cc.roleTitle || occTitle(cc.soc)]),
        el('td', {}, [cc.socDisplay + ' ' + occTitle(cc.soc)]),
        el('td', {}, [cc.missing ? 'NO DATA' : cc.areaUsedName + (cc.fellBack ? ' (fallback)' : '')]),
        el('td', {}, [cc.percentile + 'th — ' + cc.percentileReason]),
        el('td', { class: 'num' }, [cc.pctTime + '%']),
        el('td', { class: 'num' }, [fmt.usd(cc.low)]),
        el('td', { class: 'num' }, [fmt.usd(cc.mid)]),
        el('td', { class: 'num' }, [fmt.usd(cc.high)]),
      ]));
    });
    t.appendChild(el('tr', { class: 'total' }, [
      el('td', { colspan: '4' }, ['Blended total (priced at ' + (a.costApproach.pricedHoursPerWeek != null ? a.costApproach.pricedHoursPerWeek : a.costApproach.hoursPerWeek) + ' hrs/week' + (a.costApproach.pricedHoursPerWeek != null && a.costApproach.pricedHoursPerWeek < a.costApproach.hoursPerWeek ? '; actual ' + a.costApproach.hoursPerWeek : '') + ')']),
      el('td', { class: 'num' }, [a.costApproach.totalPctTime + '%']),
      el('td', { class: 'num' }, [fmt.usd(a.costApproach.low)]),
      el('td', { class: 'num' }, [fmt.usd(a.costApproach.mid)]),
      el('td', { class: 'num' }, [fmt.usd(a.costApproach.high)]),
    ]));
    costCard.appendChild(t);
    a.costApproach.notes.forEach(function (n) { costCard.appendChild(el('div', { class: 'note' }, [n])); });
    wrap.appendChild(costCard);

    // market + income
    var cols = el('div', { class: 'approach-cols' });
    var mk = el('div', { class: 'card' });
    mk.appendChild(el('h3', { style: 'margin-top:0' }, ['2 · Market approach']));
    if (a.marketApproach.applicable) {
      mk.appendChild(el('p', {}, [a.marketApproach.socDisplay + ' ' + occTitle(a.marketApproach.soc) + ' (' + a.marketApproach.pctTime + '% of time) priced as the full role at ' + a.marketApproach.areaUsedName + ':']));
      mk.appendChild(el('p', { style: 'font-size:17px;font-weight:700' }, [fmt.usd(a.marketApproach.low) + ' / ' + fmt.usd(a.marketApproach.mid) + ' / ' + fmt.usd(a.marketApproach.high)]));
    } else {
      mk.appendChild(el('p', { class: 'muted' }, [a.marketApproach.reason || 'Not applicable.']));
    }
    cols.appendChild(mk);
    var inc = el('div', { class: 'card' });
    inc.appendChild(el('h3', { style: 'margin-top:0' }, ['3 · Income approach (independent investor)']));
    if (a.incomeApproach.applicable) {
      inc.appendChild(el('p', {}, ['At the proposed salary of ' + fmt.usd(a.incomeApproach.proposedSalary) + ' plus estimated employer payroll cost of ' + fmt.usd(a.incomeApproach.employerPayrollTax) + ', residual return: ', el('strong', {}, [fmt.usd(a.incomeApproach.residual)]), a.incomeApproach.residualShare != null ? ' (' + fmt.pct(a.incomeApproach.residualShare) + ' of pre-comp earnings)' : '']));
      inc.appendChild(el('p', { class: 'muted' }, [a.incomeApproach.narrative]));
      inc.appendChild(el('p', { class: 'muted', style: 'font-size:12px' }, [a.incomeApproach.payrollTaxNote]));
    } else {
      inc.appendChild(el('p', { class: 'muted' }, [a.incomeApproach.reason || 'Not performed.']));
    }
    cols.appendChild(inc);
    var recon = el('div', { class: 'card' });
    recon.appendChild(el('h3', { style: 'margin-top:0' }, ['Reconciliation']));
    a.reconciliation.forEach(function (l) { recon.appendChild(el('p', { style: 'font-size:13.5px' }, [l])); });
    cols.appendChild(recon);
    wrap.appendChild(cols);

    root.appendChild(wrap);
  }

  // ------------------------------------------------------------------ memo model

  function buildMemoModel(c, sh, year) {
    var yr = yearRec(sh, year);
    var readiness = READINESS.evaluate(yr, yr.analysis, DATA, CFG, INTEGRITY.fingerprint(buildEngineInput(c, sh, year)));
    var workpaperRecord = {
      methodology: 'RCT-2.0',
      client: c,
      shareholder: { id: sh.id, name: sh.name, compHistory: sh.compHistory || [] },
      taxYear: year,
      yearRecord: yr,
      oewsRelease: DATA.release,
      oewsGeneratedAt: DATA.generatedAt,
    };
    return {
      preparer: store.preparer, firm: store.firm,
      client: c, shareholder: sh, year: year, yearRec: yr,
      analysis: yr.analysis,
      readiness: readiness,
      workpaperFingerprint: INTEGRITY.fingerprint(workpaperRecord),
      occTitle: occTitle,
      areaName: function (code) { return areaByCode[code] ? areaByCode[code][1] : code; },
      data: DATA, cfg: CFG, fmt: fmt,
    };
  }

  function generateMemo(c, sh, year) {
    var model = buildMemoModel(c, sh, year);
    model.draft = !model.readiness.finalizable;
    if (model.draft) {
      var openItems = model.readiness.blockers.map(function (item) { return '• ' + item.label; }).join('\n');
      if (!confirm('This workpaper is not ready to finalize:\n\n' + openItems + '\n\nGenerate a clearly marked DRAFT memo anyway?')) return;
    }
    window.RCTMemo.open(model);
  }

  // ------------------------------------------------------------------ import/export

  function exportClient(c) {
    c.lastExportedAt = new Date().toISOString();
    save();
    var payload = { format: 'rct-client', version: 2, exported: c.lastExportedAt, methodology: 'RCT-2.0', oewsRelease: DATA.release, client: c };
    payload.exportFingerprint = INTEGRITY.fingerprint(payload);
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (c.name || 'client').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.rct.json';
    a.click();
    toast('Tamper-evident client file exported');
  }

  function importClientFile() {
    var inp = document.createElement('input');
    inp.type = 'file'; inp.accept = '.json,.rct.json';
    inp.onchange = function () {
      var file = inp.files[0]; if (!file) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var obj = JSON.parse(r.result);
          if (obj.exportFingerprint) {
            var claimed = obj.exportFingerprint;
            var verify = {};
            Object.keys(obj).forEach(function (key) { if (key !== 'exportFingerprint') verify[key] = obj[key]; });
            if (INTEGRITY.fingerprint(verify) !== claimed) throw new Error('fingerprint mismatch - the exported record changed after it was created');
          }
          var cl = obj.client || obj;
          if (!cl || !cl.name) throw new Error('not a client file');
          var existing = store.clients.findIndex(function (x) { return x.id === cl.id; });
          if (existing !== -1) {
            if (!confirm('A client with this ID already exists ("' + store.clients[existing].name + '"). Replace it with the imported file?')) return;
            store.clients[existing] = cl;
          } else {
            store.clients.push(cl);
          }
          save(); render(); toast('Imported ' + cl.name);
        } catch (e) { toast('Import failed: ' + e.message); }
      };
      r.readAsText(file);
    };
    inp.click();
  }

  // ------------------------------------------------------------------ boot

  document.getElementById('vintage').textContent = 'BLS OEWS ' + DATA.release + ' release';
  render();
})();
