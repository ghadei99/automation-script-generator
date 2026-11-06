(function (root) {
  function guessed(value) {
    return {
      strategy: 'testid',
      attr: 'data-testid',
      value,
      matchCount: 0,
      ambiguous: true,
      fragile: false,
      warning: 'Guessed selector from the description. It was not verified on the page.',
    };
  }

  function loginCase(base, valid, includeCheckbox) {
    const prefix = valid ? 'valid' : 'invalid';
    const steps = [
      { id: `${prefix}-open`, type: 'navigate', url: base },
      {
        id: `${prefix}-user`,
        type: 'input',
        selector: guessed('username'),
        value: 'demo',
        warning: 'Sample username from the description. It is not a secret.',
      },
      {
        id: `${prefix}-pass`,
        type: 'input',
        selector: guessed('password'),
        secret: true,
        paramName: valid ? 'password' : 'wrongPassword',
      },
    ];
    if (includeCheckbox && valid) {
      steps.push({ id: 'remember', type: 'checkbox', selector: guessed('remember'), checked: true });
    }
    steps.push({ id: `${prefix}-submit`, type: 'click', selector: guessed('submit') });
    if (valid) {
      steps.push({ id: 'assert-nav', type: 'assertUrl', expected: '/app', match: 'partial' });
      steps.push({
        id: 'assert-welcome',
        type: 'assertText',
        selector: guessed('welcome'),
        expected: 'Welcome',
        match: 'partial',
      });
    } else {
      steps.push({
        id: 'assert-error',
        type: 'assertText',
        selector: guessed('error'),
        expected: 'Invalid',
        match: 'partial',
      });
      steps.push({ id: 'assert-stay', type: 'assertUrl', expected: base, match: 'exact' });
    }
    return {
      name: valid ? 'Valid login reaches the app' : 'Invalid login shows an error',
      steps,
    };
  }

  function genericCase(prompt, base, includeCheckbox) {
    const steps = [
      { id: 'open', type: 'navigate', url: base },
      { id: 'wait-main', type: 'wait', selector: guessed('main'), warning: 'Add a selector that exists on this page.' },
    ];
    if (includeCheckbox) steps.push({ id: 'check', type: 'checkbox', selector: guessed('option'), checked: true });
    steps.push({ id: 'assert-url', type: 'assertUrl', expected: base, match: 'partial' });
    return { name: prompt.slice(0, 80) || 'Proposed test', steps };
  }

  function mockPlan(prompt, context) {
    const text = String(prompt || '').trim();
    if (!text) throw new Error('Describe the test first.');
    if (text.length > 2000) throw new Error('Description is too long. Keep it under 2000 characters.');
    const lower = text.toLowerCase();
    const base = (context && context.origin) || 'http://127.0.0.1:4173';
    const login = /log\s*in|sign\s*in|credential/.test(lower);
    const invalid = /invalid|wrong password|error message|incorrect/.test(lower);
    const valid = /valid|success|welcome|dashboard|navigation/.test(lower) || (login && !invalid);
    const checkbox = /checkbox|remember|notification/.test(lower);
    const cases = [];
    if (login && valid) cases.push(loginCase(base, true, checkbox));
    if (login && invalid) cases.push(loginCase(base, false, false));
    if (!cases.length) cases.push(genericCase(text, base, checkbox));
    const validate = root.ASG && root.ASG.validatePlan;
    if (!validate) throw new Error('Plan validator is not loaded.');
    return validate({
      title: text.slice(0, 80),
      summary: 'Local mock plan. Selectors are guesses from the description, not from the live page. Review and edit them before running.',
      source: 'mock',
      cases,
    });
  }

  const api = { mockPlan };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
