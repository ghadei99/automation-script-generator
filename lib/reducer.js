(function (root) {
  function depsOf(deps) {
    const asg = root.ASG || {};
    let counter = 0;
    return {
      id: (deps && deps.id) || asg.createId || function fallbackId() {
        counter += 1;
        return `id${counter}`;
      },
      now: (deps && deps.now) || function now() { return Date.now(); },
    };
  }

  function selectorKey(selector) {
    if (!selector) return '';
    return [selector.strategy, selector.attr || '', selector.value || '', selector.name || '', selector.uniqueCss || ''].join('|');
  }

  function blankValue(step) {
    const copy = { ...step };
    delete copy.value;
    return copy;
  }

  function createSession(input, deps) {
    const tools = depsOf(deps);
    const now = tools.now();
    return {
      id: tools.id(),
      status: 'recording',
      tabId: input.tabId,
      origin: input.origin,
      networkCapture: !!input.networkCapture,
      startedAt: now,
      updatedAt: now,
      warnings: [],
      steps: [{
        id: tools.id(),
        type: 'navigate',
        url: input.url,
        createdAt: now,
      }],
      apiCalls: [],
    };
  }

  function withWarning(session, message, now) {
    if (!message || session.warnings.includes(message)) return session;
    return { ...session, warnings: [...session.warnings, message].slice(-20), updatedAt: now };
  }

  function reduceEvent(session, event, deps) {
    if (!session || !event) return session;
    const tools = depsOf(deps);
    const now = tools.now();
    const asg = root.ASG || {};

    if (event.kind === 'status') {
      if (!['recording', 'paused', 'stopped'].includes(event.status)) return session;
      return { ...session, status: event.status, updatedAt: now };
    }

    if (session.status !== 'recording') return session;

    if (event.kind === 'navigate') {
      if (event.tabId != null && session.tabId != null && event.tabId !== session.tabId) return session;
      const reason = asg.unsupportedReason ? asg.unsupportedReason(event.url) : '';
      if (reason === 'ignore') return session;
      if (reason) return withWarning(session, reason, now);
      if (asg.originOf && asg.originOf(event.url) !== session.origin) {
        return withWarning(session, `Ignored navigation outside ${session.origin}.`, now);
      }
      const last = session.steps[session.steps.length - 1];
      if (last && last.type === 'navigate' && last.url === event.url) return session;
      return {
        ...session,
        updatedAt: now,
        steps: [...session.steps, { id: tools.id(), type: 'navigate', url: event.url, createdAt: now }],
      };
    }

    if (event.kind === 'ui') {
      const raw = { ...(event.step || {}) };
      if (raw.secret) delete raw.value;
      let step = asg.sanitizeStep ? asg.sanitizeStep({ ...raw, id: raw.id || tools.id() }, session.steps.length) : { ...raw, id: tools.id() };
      if (raw.secret || step.secret) step = blankValue({ ...step, secret: true, paramName: step.paramName || raw.paramName || 'secret' });
      if ((step.type === 'input' || step.type === 'select') && session.steps.length) {
        const last = session.steps[session.steps.length - 1];
        const same = last && last.type === step.type && selectorKey(last.selector) === selectorKey(step.selector);
        if (same && step.secret && last.secret) return session;
        if (same && !step.secret) {
          const steps = session.steps.slice();
          steps[steps.length - 1] = { ...last, value: step.value, warning: step.warning || last.warning, updatedAt: now };
          return { ...session, steps, updatedAt: now };
        }
      }
      return { ...session, steps: [...session.steps, step], updatedAt: now };
    }

    if (event.kind === 'api') {
      if (!session.networkCapture) return session;
      const call = asg.redactApiCall ? asg.redactApiCall(event.call || {}) : (event.call || {});
      let absolute = call.url;
      try {
        absolute = new URL(call.url, session.origin).href;
      } catch (error) {
        return session;
      }
      if (asg.originOf && asg.originOf(absolute) !== session.origin) return session;
      if (session.apiCalls.length >= 100) return withWarning(session, 'API capture stopped after 100 calls.', now);
      return {
        ...session,
        updatedAt: now,
        apiCalls: [...session.apiCalls, { ...call, url: asg.redactUrl ? asg.redactUrl(absolute) : absolute, id: tools.id(), createdAt: now }],
      };
    }

    return session;
  }

  const api = { createSession, reduceEvent, selectorKey };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
