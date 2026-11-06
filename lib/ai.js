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
      items,
      messages,
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
    return groundPlan(validate({
      title: text.slice(0, 80),
      summary,
      source: 'mock',
      cases,
    }), evidence);
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
      return step;
    }
    if (step.type === 'assertUrl') {
      const value = quoted(text);
      step.expected = value == null ? text.trim() : value;
      return step;
    }
    if (step.type === 'assertText') {
      const value = quoted(text);
      if (value != null) step.expected = value;
      return step;
    }
    if ((step.type === 'input' || step.type === 'select') && !step.secret) {
      const value = quoted(text);
      if (value != null) step.value = value;
    }
    return step;
  }

  const api = {
    collectPageEvidence,
    compactSummary,
    planCacheKey,
    evidenceSelector,
    selectorIsGrounded,
    scrubPlan,
    groundPlan,
    mockPlan,
    applyStepEdit,
  };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
