(function (root) {
  const STEP_TYPES = [
    'navigate', 'click', 'dblclick', 'input', 'checkbox', 'radio', 'select', 'submit',
    'wait', 'assertVisible', 'assertText', 'assertUrl', 'assertExists',
  ];
  const SELECTOR_STRATEGIES = ['testid', 'ariaLabel', 'role', 'text', 'id', 'name', 'placeholder', 'css', 'label'];
  const BANNED = ['script', 'code', 'eval', 'javascript', 'functionBody'];

  function assertNoExecutableFields(value, label) {
    if (!value || typeof value !== 'object') return;
    for (const key of BANNED) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        throw new Error(`${label} cannot include executable field "${key}"`);
      }
    }
  }

  function sanitizeSelector(selector) {
    if (!selector || typeof selector !== 'object') return undefined;
    assertNoExecutableFields(selector, 'Selector');
    const strategy = String(selector.strategy || 'css');
    if (!SELECTOR_STRATEGIES.includes(strategy)) throw new Error(`Unsupported selector strategy "${strategy}"`);
    const out = { strategy, value: String(selector.value || '') };
    if (selector.attr) out.attr = String(selector.attr).slice(0, 40);
    if (selector.name) out.name = String(selector.name).slice(0, 200);
    if (selector.tag) out.tag = String(selector.tag).slice(0, 40);
    if (selector.uniqueCss) out.uniqueCss = String(selector.uniqueCss).slice(0, 500);
    if (selector.explicit) out.explicit = true;
    if (selector.exact === false) out.exact = false;
    if (selector.ambiguous) out.ambiguous = true;
    if (selector.fragile) out.fragile = true;
    if (Number.isFinite(selector.matchCount)) out.matchCount = selector.matchCount;
    if (selector.warning) out.warning = String(selector.warning).slice(0, 300);
    return out;
  }

  function sanitizeStep(step, index) {
    if (!step || typeof step !== 'object' || Array.isArray(step)) throw new Error(`Step ${index + 1} is not an object`);
    assertNoExecutableFields(step, `Step ${index + 1}`);
    if (!STEP_TYPES.includes(step.type)) throw new Error(`Step ${index + 1} has unsupported type "${step.type}"`);
    const out = {
      id: String(step.id || `step-${index + 1}`).slice(0, 80),
      type: step.type,
    };
    const selector = sanitizeSelector(step.selector);
    if (selector) out.selector = selector;
    if (typeof step.url === 'string') out.url = step.url.slice(0, 2000);
    if (step.secret) {
      out.secret = true;
      const name = String(step.paramName || 'secret').replace(/[^a-zA-Z0-9_]/g, '').slice(0, 40);
      out.paramName = name || 'secret';
    } else if (typeof step.value === 'string') {
      out.value = step.value.slice(0, 4000);
    }
    if (typeof step.checked === 'boolean') out.checked = step.checked;
    if (typeof step.expected === 'string') out.expected = step.expected.slice(0, 2000);
    if (step.match === 'partial' || step.match === 'exact') out.match = step.match;
    if (typeof step.warning === 'string' && step.warning) out.warning = step.warning.slice(0, 300);
    if (step.proposed) out.proposed = true;
    if (typeof step.textSnapshot === 'string' && step.textSnapshot) out.textSnapshot = step.textSnapshot.slice(0, 200);
    if (Number.isFinite(Number(step.timeoutMs))) out.timeoutMs = Math.max(0, Math.min(120000, Number(step.timeoutMs)));
    return out;
  }

  function sanitizeSteps(steps) {
    if (!Array.isArray(steps)) throw new Error('Steps must be an array');
    if (steps.length > 500) throw new Error('A test can contain at most 500 steps');
    return steps.map(sanitizeStep);
  }

  function listSecretParams(steps) {
    const names = [];
    for (const step of steps || []) {
      if (step && step.secret && step.paramName && !names.includes(step.paramName)) names.push(step.paramName);
    }
    return names;
  }

  function validatePlan(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Plan must be an object');
    assertNoExecutableFields(input, 'Plan');
    if (typeof input.title !== 'string' || !input.title.trim()) throw new Error('Plan title is required');
    if (!Array.isArray(input.cases) || input.cases.length === 0) throw new Error('Plan needs at least one case');
    if (input.cases.length > 8) throw new Error('Plan has too many cases');
    const cases = input.cases.map((testCase, index) => {
      if (!testCase || typeof testCase !== 'object') throw new Error(`Case ${index + 1} is not an object`);
      assertNoExecutableFields(testCase, `Case ${index + 1}`);
      if (typeof testCase.name !== 'string' || !testCase.name.trim()) throw new Error(`Case ${index + 1} needs a name`);
      const steps = sanitizeSteps(testCase.steps).map((step) => ({ ...step, proposed: true }));
      if (!steps.length) throw new Error(`Case ${index + 1} has no steps`);
      return { name: testCase.name.trim().slice(0, 120), steps };
    });
    return {
      title: input.title.trim().slice(0, 140),
      summary: typeof input.summary === 'string' ? input.summary.slice(0, 500) : '',
      source: input.source === 'live' ? 'live' : 'mock',
      proposed: true,
      cases,
    };
  }

  const api = {
    STEP_TYPES,
    sanitizeSelector,
    sanitizeStep,
    sanitizeSteps,
    listSecretParams,
    validatePlan,
  };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
