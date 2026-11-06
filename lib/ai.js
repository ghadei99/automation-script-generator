(function (root) {
  function collectPageEvidence() {
    const nodes = document.querySelectorAll('a, button, input, select, textarea, h1, h2, h3, [data-testid], [role]');
    const items = [];
    const seen = new Set();
    for (const el of nodes) {
      if (items.length >= 60) break;
      const tag = el.tagName.toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'hidden' || type === 'file') continue;
      const testid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy') || el.getAttribute('data-qa') || '';
      const id = el.id || '';
      const name = (el.getAttribute('name') || '').slice(0, 80);
      const role = el.getAttribute('role') || '';
      let label = '';
      if (id && globalThis.CSS && CSS.escape) {
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab) label = (lab.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      }
      const text = tag === 'input' || tag === 'textarea' || tag === 'select'
        ? ''
        : (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80);
      const key = [tag, type, testid, id, name, role, label, text].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        tag,
        type,
        testid,
        id,
        name,
        role,
        label,
        text,
        hidden: !!el.hidden,
      });
    }
    return {
      pageUrl: location.href,
      title: (document.title || '').slice(0, 120),
      items,
    };
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
    return false;
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
        steps: (testCase.steps || []).map((step) => groundStep(step, items, inspected)),
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
    if (login && valid) cases.push(loginCase(pageUrl, items || [], true));
    if (login && invalid) cases.push(loginCase(pageUrl, items || [], false));
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

  const api = { collectPageEvidence, evidenceSelector, selectorIsGrounded, groundPlan, mockPlan };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
