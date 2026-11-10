(function (root) {
  function clip(value, limit) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, limit);
  }

  function looksSensitive(value) {
    const text = String(value || '');
    if (/bearer\s+\S+/i.test(text)) return true;
    if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(text)) return true;
    return false;
  }

  function safeText(value, limit) {
    const text = clip(value, limit);
    return text && !looksSensitive(text) ? text : '';
  }

  function collectPageEvidence() {
    const describe = root.ASG && root.ASG.describeElement;
    const dynamicId = root.ASG && root.ASG.isDynamicId;
    const headingNode = document.querySelector('h1');
    const heading = headingNode ? safeText(headingNode.innerText || headingNode.textContent, 80) : '';
    const title = safeText(document.title, 120);
    const purpose = heading || title ? `Visible heading: ${heading || title}`.slice(0, 140) : '';
    const nodes = document.querySelectorAll('input, select, textarea, button, a[href], [role], [data-testid]');
    const items = [];
    const seen = new Set();
    for (const el of nodes) {
      if (items.length >= 24) break;
      if (!el || !el.tagName) continue;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden' || type === 'file') continue;
      const described = describe ? describe(el, document) : null;
      const testid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || el.getAttribute('data-qa') || '';
      const id = el.id && !(dynamicId && dynamicId(el.id)) ? el.id : '';
      const name = safeText(el.getAttribute('name'), 80);
      const role = safeText((described && described.fingerprint && described.fingerprint.role) || el.getAttribute('role') || '', 40);
      let label = '';
      if (el.id && globalThis.CSS && CSS.escape) {
        const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (lab) label = safeText(lab.textContent, 80);
      }
      if (!label && described && described.fingerprint && described.fingerprint.attrs && described.fingerprint.attrs.label) {
        label = safeText(described.fingerprint.attrs.label, 80);
      }
      const accessible = safeText(described && described.fingerprint && described.fingerprint.name, 80);
      const text = tag === 'input' || tag === 'textarea' || tag === 'select' ? '' : safeText(el.innerText || el.textContent, 80);
      const locators = [];
      ((described && described.candidates) || []).forEach((candidate) => {
        if (locators.length >= 3 || !candidate || !candidate.unique || candidate.tier === 'structural') return;
        const value = safeText(candidate.value, 120);
        if (!value) return;
        locators.push({
          strategy: candidate.strategy,
          value,
          name: safeText(candidate.name, 80),
          rank: candidate.rank,
        });
      });
      const form = el.form;
      const formId = form
        ? safeText(form.getAttribute('data-testid') || form.id || form.getAttribute('name'), 80)
        : '';
      const key = [tag, type, testid, id, name, role, label, text, formId].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        tag,
        type,
        testid: safeText(testid, 80),
        id: safeText(id, 80),
        name,
        role,
        label,
        text: accessible || text,
        hidden: !!el.hidden,
        form: formId,
        locators,
      });
    }
    const messages = [];
    document.querySelectorAll('[role="alert"], [data-testid*="error" i], [id*="error" i]').forEach((el) => {
      if (messages.length >= 4 || !el || el.hidden) return;
      const text = safeText(el.innerText || el.textContent, 80);
      if (!text) return;
      messages.push({
        text,
        testid: safeText(el.getAttribute('data-testid'), 80),
        role: safeText(el.getAttribute('role'), 40),
      });
    });
    return {
      pageUrl: location.href,
      title,
      purpose,
      items,
      messages,
    };
  }

  function compactSummary(evidence) {
    if (!evidence || typeof evidence !== 'object') return null;
    const items = Array.isArray(evidence.items) ? evidence.items.slice(0, 24).map((item) => {
      if (!item || typeof item !== 'object') return null;
      const locators = Array.isArray(item.locators) ? item.locators.slice(0, 3).map((locator) => ({
        strategy: safeText(locator && locator.strategy, 20),
        value: safeText(locator && locator.value, 120),
        name: safeText(locator && locator.name, 80),
        rank: Number.isFinite(Number(locator && locator.rank)) ? Number(locator.rank) : undefined,
      })).filter((locator) => locator.strategy && locator.value) : [];
      return {
        ref: safeText(item.ref, 40),
        tag: safeText(item.tag, 40),
        type: safeText(item.type, 40),
        testid: safeText(item.testid, 80),
        id: safeText(item.id, 80),
        name: safeText(item.name, 80),
        role: safeText(item.role, 40),
        label: safeText(item.label, 80),
        text: safeText(item.text, 80),
        hidden: !!item.hidden,
        form: safeText(item.form, 80),
        locators,
      };
    }).filter(Boolean) : [];
    const messages = Array.isArray(evidence.messages) ? evidence.messages.slice(0, 4).map((message) => ({
      text: safeText(message && message.text, 80),
      testid: safeText(message && message.testid, 80),
      role: safeText(message && message.role, 40),
    })).filter((message) => message.text) : [];
    return {
      pageUrl: safeText(evidence.pageUrl, 200),
      title: safeText(evidence.title, 120),
      purpose: safeText(evidence.purpose, 140),
      items: assignRefs(items),
      messages,
    };
  }

  function slug(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 24);
  }

  function kindOf(item) {
    if (item.tag === 'button' || item.type === 'submit' || item.role === 'button') return 'button';
    if (item.tag === 'a' || item.role === 'link') return 'link';
    return item.tag === 'input' || item.tag === 'textarea' || item.tag === 'select' ? 'field' : 'element';
  }

  function assignRefs(items) {
    const used = new Set();
    return (items || []).map((item) => {
      if (!item || typeof item !== 'object') return item;
      if (typeof item.ref === 'string' && /^[a-z][a-z0-9_]{0,40}$/.test(item.ref) && !used.has(item.ref)) {
        used.add(item.ref);
        return item;
      }
      const token = slug(item.testid || item.label || item.name || item.text || item.role || kindOf(item)) || 'target';
      let ref = `${kindOf(item)}_${token}`;
      let count = 2;
      while (used.has(ref)) {
        ref = `${kindOf(item)}_${token}_${count}`;
        count += 1;
      }
      used.add(ref);
      return { ...item, ref };
    });
  }

  function providerSummary(evidence) {
    const summary = compactSummary(evidence) || { purpose: '', items: [], messages: [] };
    return {
      purpose: summary.purpose || '',
      items: (summary.items || []).map((item) => ({
        ref: item.ref,
        tag: item.tag,
        type: item.type,
        role: item.role,
        label: item.label,
        name: item.text,
        form: item.form,
      })).filter((item) => item.ref),
      messages: summary.messages || [],
    };
  }

  function planCacheKey(prompt, evidence) {
    const summary = compactSummary(evidence) || { items: [], messages: [] };
    const raw = [
      clip(prompt, 2000),
      summary.pageUrl,
      summary.items.map((item) => [item.tag, item.testid, item.id, item.name, item.label, item.role].join('|')).join('\n'),
      summary.messages.map((message) => message.text).join('\n'),
    ].join('\n');
    let hash = 5381;
    for (let index = 0; index < raw.length; index += 1) hash = ((hash * 33) ^ raw.charCodeAt(index)) >>> 0;
    return `plan-${hash.toString(16)}`;
  }

  function unique(items) {
    return items.length === 1 ? items[0] : null;
  }

  function blob(item) {
    return `${item.testid} ${item.id} ${item.name} ${item.label} ${item.text} ${item.role}`.toLowerCase();
  }

  function findControl(items, kind) {
    const list = items || [];
    if (kind === 'password') {
      return unique(list.filter((item) => item.tag === 'input' && (item.type === 'password' || /password/.test(blob(item)))));
    }
    if (kind === 'username') {
      return unique(list.filter((item) => item.tag === 'input' && item.type !== 'password' && item.type !== 'checkbox' && item.type !== 'radio' && /user|email|login/.test(blob(item))));
    }
    if (kind === 'submit') {
      return unique(list.filter((item) => (item.tag === 'button' || item.type === 'submit') && /sign in|log in|login|submit/.test(blob(item))));
    }
    if (kind === 'error') {
      return unique(list.filter((item) => /error|alert/.test(blob(item))));
    }
    return null;
  }

  function evidenceSelector(item) {
    if (!item) return null;
    if (item.testid) return { strategy: 'testid', attr: 'data-testid', value: item.testid, matchCount: 1, ambiguous: false, fragile: false };
    if (item.id) return { strategy: 'id', value: item.id, matchCount: 1, ambiguous: false, fragile: false };
    if (item.name) return { strategy: 'name', value: item.name, matchCount: 1, ambiguous: false, fragile: false };
    return null;
  }

  function selectorIsGrounded(selector, items) {
    if (!selector || !items || !items.length) return false;
    if (selector.strategy === 'testid') return items.some((item) => item.testid && item.testid === selector.value);
    if (selector.strategy === 'id') return items.some((item) => item.id && item.id === selector.value);
    if (selector.strategy === 'name') return items.some((item) => item.name && item.name === selector.value);
    return items.some((item) => Array.isArray(item.locators) && item.locators.some((locator) => (
      locator.strategy === selector.strategy
      && locator.value === selector.value
      && String(locator.name || '') === String(selector.name || '')
    )));
  }

  function scrubStep(step) {
    const next = { ...step };
    const hint = `${next.paramName || ''} ${next.id || ''} ${(next.selector && next.selector.value) || ''} ${(next.selector && next.selector.name) || ''}`;
    if (next.type === 'input' && /password|token|secret|cookie/i.test(hint)) {
      next.secret = true;
      next.paramName = next.paramName || 'password';
      delete next.value;
    }
    if (next.secret) delete next.value;
    if (next.type === 'navigate' && next.url && !/^https?:\/\//i.test(String(next.url))) {
      delete next.url;
      next.warning = next.warning || 'Only http and https URLs are kept.';
    }
    return next;
  }

  function scrubPlan(plan) {
    if (!plan || typeof plan !== 'object') return plan;
    return {
      ...plan,
      cases: (plan.cases || []).map((testCase) => ({
        ...testCase,
        steps: (testCase.steps || []).map(scrubStep),
      })),
    };
  }

  function unbound(step, warning) {
    const next = { ...step, warning };
    delete next.selector;
    return next;
  }

  function groundStep(step, items, inspected) {
    if (!step.selector) return step;
    if (!inspected || !selectorIsGrounded(step.selector, items)) {
      return unbound(step, inspected
        ? 'This selector was not found on the open page, so it was removed. Choose one before running.'
        : 'No page was inspected, so this selector was removed.');
    }
    return step;
  }

  function groundPlan(plan, evidence) {
    const items = evidence && Array.isArray(evidence.items) ? evidence.items : [];
    const inspected = !!(evidence && Array.isArray(evidence.items));
    return {
      ...plan,
      cases: (plan.cases || []).map((testCase) => ({
        ...testCase,
        steps: (testCase.steps || []).map((step) => scrubStep(groundStep(step, items, inspected))),
      })),
    };
  }

  function needsTarget(step) {
    return !['navigate', 'assertUrl'].includes(step.type);
  }

  function expectationMissing(step) {
    return (step.type === 'assertText' || step.type === 'assertUrl') && !String(step.expected || '').trim();
  }

  function sameLocator(left, right) {
    return !!left && !!right
      && left.strategy === right.strategy
      && String(left.value || '') === String(right.value || '')
      && String(left.name || '') === String(right.name || '');
  }

  function candidatesOf(item) {
    const listed = Array.isArray(item.locators) ? item.locators.filter((locator) => locator && locator.strategy && locator.value && locator.unique !== false && locator.tier !== 'structural') : [];
    if (listed.length) {
      return listed.slice(0, 4).map((locator) => {
        const rank = Number(locator.rank) || 2;
        return {
          strategy: locator.strategy,
          value: locator.value,
          name: locator.name || '',
          attr: locator.attr || (locator.strategy === 'testid' ? 'data-testid' : undefined),
          unique: true,
          verified: locator.verified || 'dom',
          tier: locator.tier || (rank <= 1 ? 'verified-contract' : rank === 2 ? 'verified-attribute' : 'verified-scoped'),
          rank,
          ref: item.ref,
        };
      });
    }
    const synthesized = [];
    if (item.testid) synthesized.push({ strategy: 'testid', attr: 'data-testid', value: item.testid, unique: true, verified: 'dom', tier: 'verified-contract', rank: 1, ref: item.ref });
    else if (item.id) synthesized.push({ strategy: 'id', value: item.id, unique: true, verified: 'dom', tier: 'verified-attribute', rank: 2, ref: item.ref });
    else if (item.name && item.type !== 'radio') synthesized.push({ strategy: 'name', value: item.name, unique: true, verified: 'dom', tier: 'verified-attribute', rank: 2, ref: item.ref });
    return synthesized;
  }

  function selectorFromCandidate(candidate, siblings) {
    if (!candidate || candidate.unique === false || candidate.tier === 'structural' || !candidate.strategy || !candidate.value) return null;
    const list = (siblings && siblings.length ? siblings : [candidate]).filter((item) => item && item.unique !== false && item.tier !== 'structural').slice(0, 4);
    const selector = {
      strategy: candidate.strategy,
      value: candidate.value,
      matchCount: candidate.matchCount || 1,
      ambiguous: false,
      fragile: false,
      verified: candidate.verified || 'dom',
      tier: candidate.tier || 'verified-contract',
      rank: candidate.rank || 1,
      explanation: candidate.explanation || 'Verified on the open page.',
      candidates: list.length ? list : [candidate],
    };
    if (candidate.attr) selector.attr = candidate.attr;
    if (candidate.name) selector.name = candidate.name;
    if (candidate.tag) selector.tag = candidate.tag;
    return selector;
  }

  function primarySelector(item) {
    const candidates = candidatesOf(item);
    return candidates.length ? selectorFromCandidate(candidates[0], candidates) : null;
  }

  function chooseSelector(item, requested) {
    const candidates = candidatesOf(item);
    if (!candidates.length) return null;
    const match = requested && candidates.find((candidate) => sameLocator(candidate, requested));
    return selectorFromCandidate(match || candidates[0], candidates);
  }

  function ownsSelector(item, selector) {
    if (!selector) return false;
    if (candidatesOf(item).some((candidate) => sameLocator(candidate, selector))) return true;
    if (selector.strategy === 'testid' && item.testid && item.testid === selector.value) return true;
    if (selector.strategy === 'id' && item.id && item.id === selector.value) return true;
    if (selector.strategy === 'name' && item.name && item.name === selector.value) return true;
    return false;
  }

  function hintOf(step) {
    return `${step.elementRef || ''} ${step.paramName || ''} ${step.id || ''} ${step.value || ''} ${step.expected || ''} ${step.type || ''}`.toLowerCase();
  }

  function textOf(item) {
    return `${item.ref || ''} ${item.testid || ''} ${item.id || ''} ${item.name || ''} ${item.label || ''} ${item.text || ''} ${item.role || ''} ${item.type || ''}`.toLowerCase();
  }

  function describeTarget(item) {
    return [item.role || item.type || item.tag, item.label || item.text || item.name || item.testid || item.ref].filter(Boolean).join(' ');
  }

  function semanticPool(step, items) {
    const hint = hintOf(step);
    if (step.type === 'input' || step.type === 'select') {
      let pool = items.filter((item) => ['input', 'textarea', 'select'].includes(item.tag));
      if (step.secret || /password|secret|token|passwd/.test(hint)) {
        return pool.filter((item) => item.type === 'password' || /password|secret|token/.test(textOf(item)));
      }
      pool = pool.filter((item) => item.type !== 'password' && item.type !== 'checkbox' && item.type !== 'radio' && item.type !== 'hidden' && item.type !== 'submit');
      if (/user|email|login/.test(hint)) {
        const named = pool.filter((item) => /user|email|login/.test(textOf(item)));
        if (named.length) return named;
      }
      return pool;
    }
    if (step.type === 'checkbox' || step.type === 'radio') {
      return items.filter((item) => item.type === step.type || item.role === step.type);
    }
    if (step.type === 'click' || step.type === 'submit' || step.type === 'dblclick') {
      const buttons = items.filter((item) => item.tag === 'button' || item.type === 'submit' || item.role === 'button');
      if (step.type === 'submit' || /submit|sign in|log in|login/.test(hint)) {
        const named = buttons.filter((item) => /submit|sign in|log in|login/.test(textOf(item)));
        if (named.length) return named;
      }
      return buttons;
    }
    if (step.type === 'assertText' || step.type === 'assertVisible' || step.type === 'assertExists') {
      const expected = String(step.expected || '').trim().toLowerCase();
      if (expected) {
        const exact = items.filter((item) => [item.text, item.label, item.name]
          .some((value) => String(value || '').trim().toLowerCase() === expected));
        if (exact.length) return exact;
        const named = items.filter((item) => textOf(item).includes(expected));
        if (named.length) return named;
      }
      if (step.type === 'assertText' || /error|invalid|alert|message/.test(hint)) {
        return items.filter((item) => /error|alert/.test(textOf(item)) || item.role === 'alert');
      }
    }
    return [];
  }

  function settle(step, item, selector, matches, reason) {
    const next = { ...step };
    if (item && item.ref) next.elementRef = item.ref;
    if (selector) next.selector = selector;
    else delete next.selector;
    const missingExpected = expectationMissing(next);
    const missingTarget = needsTarget(next) && !next.selector;
    next.unresolved = missingTarget || missingExpected;
    if (next.unresolved) {
      if (missingExpected && !missingTarget && next.warning && /expected|message|url|destination|enter/i.test(next.warning)) {
        next.warning = next.warning;
      } else if (missingExpected && !missingTarget) {
        next.warning = 'Enter the expected result before running. It was not available from the page.';
      } else {
        next.warning = reason || next.warning || 'This step has no verified locator.';
      }
    } else if (next.warning && /removed|not found on the open page|no page was inspected|no verified locator|more than one|not on the open page/i.test(next.warning)) {
      delete next.warning;
    }
    const candidates = item ? candidatesOf(item) : (matches || []).flatMap((match) => candidatesOf(match).slice(0, 2));
    next.review = {
      status: next.unresolved ? 'unresolved' : 'resolved',
      reason: next.warning || '',
      target: item ? describeTarget(item) : '',
      matches: (item ? [item] : (matches || [])).slice(0, 6).map((match) => ({
        ref: match.ref,
        label: describeTarget(match),
      })),
      candidates: candidates.slice(0, 8),
    };
    return next;
  }

  function sameOrigin(left, right) {
    try {
      return !!left && !!right && new URL(left).origin === new URL(right).origin;
    } catch (error) {
      return false;
    }
  }

  function resolveStep(step, items, pageUrl) {
    const current = scrubStep(step);
    if (current.type === 'navigate') {
      const next = { ...current };
      if (pageUrl && !sameOrigin(next.url || pageUrl, pageUrl)) {
        next.url = pageUrl;
        next.warning = 'Navigation was set to the open page.';
      } else if (pageUrl && !next.url) next.url = pageUrl;
      return settle(next, null, null, [], '');
    }
    if (current.type === 'assertUrl') {
      const next = { ...current };
      if (next.expected && pageUrl && !sameOrigin(next.expected, pageUrl)) {
        next.expected = '';
        next.warning = 'The expected URL was not on the open site. Enter the URL you expect before running.';
      }
      return settle(next, null, null, [], next.warning || '');
    }
    if (current.elementRef) {
      const item = items.find((entry) => entry.ref === current.elementRef) || null;
      if (!item) return settle(current, null, null, [], 'This element reference is not on the open page.');
      const selector = chooseSelector(item, current.selector);
      if (!selector) return settle(current, item, null, [item], 'This element has no unique verified locator.');
      return settle(current, item, selector, [item], '');
    }
    if (current.selector) {
      const matches = items.filter((item) => ownsSelector(item, current.selector));
      if (matches.length === 1) {
        const selector = chooseSelector(matches[0], current.selector);
        if (selector) return settle(current, matches[0], selector, matches, '');
      }
      if (matches.length > 1) {
        const next = { ...current };
        delete next.selector;
        return settle(next, null, null, matches, 'More than one element matches this locator. Choose one.');
      }
    }
    const pool = semanticPool(current, items).filter((item) => candidatesOf(item).length);
    if (pool.length === 1) return settle(current, pool[0], primarySelector(pool[0]), pool, '');
    const next = { ...current };
    delete next.selector;
    if (!pool.length) return settle(next, null, null, [], 'No element on the open page matches this action.');
    return settle(next, null, null, pool, 'More than one element matches this action. Choose one.');
  }

  function bindPlan(plan, evidence) {
    if (!plan || typeof plan !== 'object') return plan;
    const items = assignRefs(evidence && Array.isArray(evidence.items) ? evidence.items : []);
    const pageUrl = (evidence && evidence.pageUrl) || '';
    return {
      ...plan,
      cases: (plan.cases || []).map((testCase) => ({
        ...testCase,
        steps: (testCase.steps || []).map((step) => resolveStep(step, items, pageUrl)),
      })),
    };
  }

  function refreshStep(step) {
    if (!step || typeof step !== 'object') return step;
    const missingExpected = expectationMissing(step);
    const missingTarget = needsTarget(step) && !(step.selector && step.selector.value);
    step.unresolved = missingTarget || missingExpected;
    if (step.review) step.review.status = step.unresolved ? 'unresolved' : 'resolved';
    if (!step.unresolved && step.warning && /enter the expected|no verified locator|no element on the open page|more than one element|element reference is not|no unique verified/i.test(step.warning)) {
      delete step.warning;
    }
    if (step.unresolved && missingExpected && !missingTarget && !step.warning) {
      step.warning = 'Enter the expected result before running. It was not available from the page.';
    }
    return step;
  }

  function blockingSteps(steps) {
    return (steps || []).filter((step) => step && step.unresolved);
  }

  function approvalBlock(steps, action) {
    const blocked = blockingSteps(steps);
    if (!blocked.length) return '';
    const names = blocked.map((step) => `${step.type}${step.elementRef ? ` ${step.elementRef}` : ''}`);
    return `Resolve ${blocked.length} step(s) before ${action || 'running'}: ${names.join(', ')}`;
  }

  function withSelector(step, item, missingWarning) {
    const selector = evidenceSelector(item);
    if (!selector) return { ...step, warning: missingWarning };
    return { ...step, selector };
  }

  function loginCase(pageUrl, items, valid) {
    const prefix = valid ? 'valid' : 'invalid';
    const username = findControl(items, 'username');
    const password = findControl(items, 'password');
    const submit = findControl(items, 'submit');
    const error = findControl(items, 'error');
    const steps = [{ id: `${prefix}-open`, type: 'navigate', url: pageUrl }];
    steps.push(withSelector({
      id: `${prefix}-user`,
      type: 'input',
      value: valid ? 'demo-user' : 'invalid-user',
      warning: 'Sample username for review. It was not read from the page and it is not a secret.',
    }, username, 'No unique username field was on the open page. Add a selector before running.'));
    steps.push(withSelector({
      id: `${prefix}-pass`,
      type: 'input',
      secret: true,
      paramName: valid ? 'password' : 'wrongPassword',
    }, password, 'No unique password field was on the open page. Add a selector before running.'));
    steps.push(withSelector({
      id: `${prefix}-submit`,
      type: 'click',
    }, submit, 'No unique submit button was on the open page. Add a selector before running.'));
    if (valid) {
      steps.push({
        id: 'assert-nav',
        type: 'assertUrl',
        expected: '',
        match: 'exact',
        warning: 'No destination page was observed. Enter the URL you expect after login before running.',
      });
    } else {
      if (error) {
        steps.push(withSelector({
          id: 'assert-error',
          type: 'assertText',
          expected: '',
          match: 'exact',
          warning: 'An error element was on the page, but it had no message yet. Enter the expected error text before running.',
        }, error, 'No unique error element was on the open page.'));
      } else {
        steps.push({
          id: 'assert-error',
          type: 'assertText',
          expected: '',
          match: 'exact',
          warning: 'No unique error element was on the open page. Choose the element and the expected message before running.',
        });
      }
      steps.push({
        id: 'assert-stay',
        type: 'assertUrl',
        expected: pageUrl,
        match: 'exact',
        warning: 'Checks that the tab stays on the page that was open when this plan was created.',
      });
    }
    return {
      name: valid ? 'Valid login reaches the next page' : 'Invalid login shows an error and stays here',
      steps,
    };
  }

  function mockPlan(prompt, context) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('Describe the test first.');
    if (text.length > 2000) throw new Error('Description is too long. Keep it under 2000 characters.');
    const lower = text.toLowerCase();
    const evidence = context && context.evidence;
    const items = evidence && Array.isArray(evidence.items) ? evidence.items : null;
    const pageUrl = (evidence && evidence.pageUrl) || (context && context.pageUrl) || (context && context.origin) || '';
    const login = /log\s*in|sign\s*in|credential/.test(lower);
    const invalid = /\binvalid\b|wrong password|error message|incorrect/.test(lower);
    const valid = /\bvalid\b|successful login|\bwelcome\b|\bdashboard\b/.test(lower) || (login && !invalid);
    const cases = [];
    if (login && invalid) cases.push(loginCase(pageUrl, items || [], false));
    if (login && valid) cases.push(loginCase(pageUrl, items || [], true));
    if (!cases.length) {
      cases.push({
        name: text.slice(0, 80) || 'Proposed test',
        steps: [{
          id: 'open',
          type: 'navigate',
          url: pageUrl,
          warning: items ? 'Only the open page URL came from the browser. Add the actions you want.' : 'Open the page you want to test, then generate again so selectors can be taken from that page.',
        }],
      });
    }
    const inspected = Array.isArray(items);
    const summary = inspected
      ? `Inspected ${items.length} elements on the open page. Selectors are attached only when one of those elements matched. Review every step before running.`
      : 'No page was inspected, so this plan has no element selectors. Open the page and generate again, or add selectors yourself.';
    const validate = root.ASG && root.ASG.validatePlan;
    if (!validate) throw new Error('Plan validator is not loaded.');
    return bindPlan(groundPlan(validate({
      title: text.slice(0, 80),
      summary,
      source: 'mock',
      cases,
    }), evidence), evidence);
  }

  function quoted(text) {
    const match = String(text || '').match(/"([^"]*)"/);
    return match ? match[1] : null;
  }

  function applyStepEdit(step, summary) {
    const text = String(summary || '');
    if (!step || typeof step !== 'object') return step;
    if (step.type === 'navigate') {
      const url = text.replace(/^Navigate\s+/, '').trim();
      if (url) step.url = url;
      return refreshStep(step);
    }
    if (step.type === 'assertUrl') {
      const value = quoted(text);
      step.expected = value == null ? text.trim() : value;
      return refreshStep(step);
    }
    if (step.type === 'assertText') {
      const value = quoted(text);
      if (value != null) step.expected = value;
      return refreshStep(step);
    }
    if ((step.type === 'input' || step.type === 'select') && !step.secret) {
      const value = quoted(text);
      if (value != null) step.value = value;
    }
    return refreshStep(step);
  }

  const api = {
    collectPageEvidence,
    compactSummary,
    providerSummary,
    planCacheKey,
    evidenceSelector,
    selectorIsGrounded,
    selectorFromCandidate,
    scrubPlan,
    groundPlan,
    bindPlan,
    refreshStep,
    blockingSteps,
    approvalBlock,
    mockPlan,
    applyStepEdit,
  };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
