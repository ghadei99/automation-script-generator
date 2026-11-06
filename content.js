(function () {
  const firstLoad = !globalThis.__asgContentLoaded;
  globalThis.__asgContentLoaded = true;
  if (!globalThis.__asgContentState) {
    globalThis.__asgContentState = { recording: false, network: false, origin: '' };
  }
  const state = globalThis.__asgContentState;
  if (!globalThis.__asgInputBuffer) globalThis.__asgInputBuffer = { pending: null, timer: null };
  const buffer = globalThis.__asgInputBuffer;

  function applyState(next) {
    state.recording = !!(next && next.recording);
    state.network = !!(next && next.network);
    state.origin = (next && next.origin) || '';
    if (document.documentElement) {
      document.documentElement.setAttribute('data-asg-capture', state.recording && state.network ? '1' : '0');
    }
  }

  function refresh() {
    try {
      chrome.runtime.sendMessage({ type: 'recorder:hello' }, (response) => {
        if (chrome.runtime.lastError) return;
        applyState(response);
      });
    } catch (error) {
      state.recording = false;
    }
  }

  function emit(step) {
    if (!state.recording || !step) return;
    chrome.runtime.sendMessage({ type: 'recorder:event', step });
  }

  function flushInput() {
    if (!buffer.pending) return;
    const step = buffer.pending;
    buffer.pending = null;
    clearTimeout(buffer.timer);
    emit(step);
  }

  function queueInput(step) {
    buffer.pending = step;
    clearTimeout(buffer.timer);
    buffer.timer = setTimeout(() => {
      const latest = buffer.pending;
      buffer.pending = null;
      emit(latest);
    }, 200);
  }

  function targetElement(event, kind) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [event.target];
    const elements = path.filter((node) => node && node.nodeType === 1);
    if (kind === 'input') return elements[0] || null;
    for (const candidate of elements) {
      if (candidate.hasAttribute && (candidate.hasAttribute('data-testid') || candidate.hasAttribute('data-test') || candidate.hasAttribute('data-cy') || candidate.hasAttribute('data-qa'))) {
        return candidate;
      }
    }
    const raw = elements[0];
    if (raw && typeof raw.closest === 'function') {
      const interactive = raw.closest('button, a, summary, [role="button"], [role="link"]');
      if (interactive) return interactive;
    }
    return raw || null;
  }

  function buildStep(el, type) {
    if (!el || !el.tagName || !globalThis.ASG) return null;
    const tag = el.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') return null;
    const inputType = (el.getAttribute('type') || '').toLowerCase();
    if (tag === 'input' && (inputType === 'hidden' || inputType === 'file')) return null;
    const selector = ASG.describeElement(el, document);
    const step = { type, selector };
    if (selector.warning) step.warning = selector.warning;
    if ((type === 'click' || type === 'dblclick') && !ASG.isSensitiveField(el)) {
      const text = ASG.elementText(el);
      if (text && text.length <= 80) step.textSnapshot = text;
    }
    if (type === 'input' || type === 'select') {
      if (ASG.isSensitiveField(el)) {
        step.secret = true;
        step.paramName = ASG.paramNameFor(el);
      } else {
        step.value = el.value == null ? '' : String(el.value);
      }
    }
    if (type === 'checkbox') step.checked = !!el.checked;
    return step;
  }

  function onClick(event) {
    if (!event.isTrusted || !state.recording) return;
    flushInput();
    const el = targetElement(event, 'click');
    if (!el || !el.matches) return;
    if (el.matches('input[type="checkbox"], input[type="radio"]')) return;
    emit(buildStep(el, 'click'));
  }

  function onDblClick(event) {
    if (!event.isTrusted || !state.recording) return;
    emit(buildStep(targetElement(event, 'dblclick'), 'dblclick'));
  }

  function onInput(event) {
    if (!event.isTrusted || !state.recording) return;
    const el = event.target;
    if (!el || !el.tagName) return;
    const tag = el.tagName.toLowerCase();
    if (tag !== 'input' && tag !== 'textarea') return;
    const inputType = (el.getAttribute('type') || 'text').toLowerCase();
    if (['checkbox', 'radio', 'button', 'submit', 'file', 'hidden'].includes(inputType)) return;
    queueInput(buildStep(el, 'input'));
  }

  function onChange(event) {
    if (!event.isTrusted || !state.recording) return;
    const el = event.target;
    if (!el || !el.tagName) return;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') {
      flushInput();
      emit(buildStep(el, 'select'));
      return;
    }
    if (tag !== 'input') return;
    const inputType = (el.getAttribute('type') || '').toLowerCase();
    if (inputType === 'checkbox') emit(buildStep(el, 'checkbox'));
    if (inputType === 'radio') emit(buildStep(el, 'radio'));
  }

  function onSubmit(event) {
    if (!event.isTrusted || !state.recording) return;
    flushInput();
    const submitter = event.submitter;
    if (submitter) return;
    emit(buildStep(event.target, 'submit'));
  }

  function onApi(event) {
    if (!state.recording || !state.network) return;
    let call;
    try {
      call = JSON.parse(event.detail);
    } catch (error) {
      return;
    }
    const safe = ASG.redactApiCall ? ASG.redactApiCall(call) : call;
    chrome.runtime.sendMessage({ type: 'recorder:api', call: safe });
  }

  function selectorLabel(selector) {
    if (!selector) return 'selector';
    return selector.uniqueCss || selector.value || selector.strategy;
  }

  function resolveElements(selector) {
    if (!selector) return [];
    if (selector.ambiguous && selector.uniqueCss) {
      return ASG.queryAll(document, { strategy: 'css', value: selector.uniqueCss, uniqueCss: selector.uniqueCss });
    }
    const primary = ASG.queryAll(document, selector);
    if (primary.length === 1) return primary;
    if (primary.length > 1) return primary;
    if (selector.uniqueCss && selector.strategy !== 'css') {
      return ASG.queryAll(document, { strategy: 'css', value: selector.uniqueCss, uniqueCss: selector.uniqueCss });
    }
    return primary;
  }

  function waitForOne(selector, timeoutMs) {
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const tick = () => {
        if (globalThis.__asgStop) {
          reject(Object.assign(new Error('Execution stopped'), { actual: 'stopped' }));
          return;
        }
        let matches = [];
        try {
          matches = resolveElements(selector);
        } catch (error) {
          reject(Object.assign(new Error('Selector is invalid'), { expected: selectorLabel(selector), actual: error.message }));
          return;
        }
        if (matches.length > 1) {
          reject(Object.assign(new Error(`Selector matched ${matches.length} elements`), {
            expected: '1 element',
            actual: `${matches.length} elements`,
          }));
          return;
        }
        if (matches.length === 1) {
          resolve(matches[0]);
          return;
        }
        if (Date.now() - start >= timeoutMs) {
          reject(Object.assign(new Error('Element not found before timeout'), {
            expected: selectorLabel(selector),
            actual: 'not found',
          }));
          return;
        }
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function isVisible(el) {
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function setNativeValue(el, value) {
    const proto = el instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
    el.focus();
    if (descriptor && descriptor.set) descriptor.set.call(el, value);
    else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function valueFor(step, params) {
    if (step.secret) {
      const name = step.paramName || 'secret';
      const value = params ? params[name] : undefined;
      if (value == null || value === '') {
        throw Object.assign(new Error(`Missing runtime value for secret "${name}". Enter it in Run Tests. It is not stored.`), {
          expected: `{{${name}}}`,
          actual: 'missing',
        });
      }
      return String(value);
    }
    return step.value == null ? '' : String(step.value);
  }

  async function executeStep(message) {
    const step = message.step || {};
    const timeoutMs = message.timeoutMs || 10000;
    const params = message.params || {};
    if (step.type === 'click' || step.type === 'dblclick') {
      const el = await waitForOne(step.selector, timeoutMs);
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      if (step.type === 'dblclick') el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      else el.click();
      return { ok: true, actual: step.type === 'dblclick' ? 'double-clicked' : 'clicked' };
    }
    if (step.type === 'input' || step.type === 'select') {
      const el = await waitForOne(step.selector, timeoutMs);
      const value = valueFor(step, params);
      setNativeValue(el, value);
      const actual = step.secret ? `filled {{${step.paramName || 'secret'}}}` : 'filled';
      if (!step.secret && el.value !== value && el.tagName !== 'SELECT') {
        return { ok: false, message: 'Field did not accept the value', expected: value, actual: el.value };
      }
      return { ok: true, actual };
    }
    if (step.type === 'checkbox') {
      const el = await waitForOne(step.selector, timeoutMs);
      const want = !!step.checked;
      if (!!el.checked !== want) el.click();
      if (!!el.checked !== want) {
        return { ok: false, message: 'Checkbox did not reach the requested state', expected: String(want), actual: String(!!el.checked) };
      }
      return { ok: true, actual: String(!!el.checked) };
    }
    if (step.type === 'radio') {
      const el = await waitForOne(step.selector, timeoutMs);
      el.click();
      if (!el.checked) return { ok: false, message: 'Radio did not become selected', expected: 'checked', actual: 'unchecked' };
      return { ok: true, actual: 'checked' };
    }
    if (step.type === 'submit') {
      const el = await waitForOne(step.selector, timeoutMs);
      if (typeof el.requestSubmit === 'function') el.requestSubmit();
      else el.submit();
      return { ok: true, actual: 'submitted' };
    }
    if (step.type === 'wait' || step.type === 'assertExists') {
      await waitForOne(step.selector, timeoutMs);
      return { ok: true, actual: 'exists' };
    }
    if (step.type === 'assertVisible') {
      const el = await waitForOne(step.selector, timeoutMs);
      if (!isVisible(el)) return { ok: false, message: 'Element is not visible', expected: 'visible', actual: 'hidden' };
      return { ok: true, actual: 'visible' };
    }
    if (step.type === 'assertText') {
      const el = await waitForOne(step.selector, timeoutMs);
      const actual = ASG.elementText(el);
      const expected = step.expected || '';
      const ok = step.match === 'partial' ? actual.includes(expected) : actual === expected;
      if (!ok) return { ok: false, message: 'Text did not match', expected, actual };
      return { ok: true, actual };
    }
    return { ok: false, message: `Unsupported step type "${step.type || ''}"`, actual: step.type || 'missing' };
  }

  if (firstLoad) {
    chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!message || !message.type) return false;
      if (message.type === 'ping') {
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === 'recording-state') {
        applyState(message.state);
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === 'cancel-execution') {
        globalThis.__asgStop = true;
        sendResponse({ ok: true });
        return false;
      }
      if (message.type === 'execute-step') {
        globalThis.__asgStop = false;
        executeStep(message).then(sendResponse).catch((error) => {
          sendResponse({
            ok: false,
            message: error.message || 'Step failed',
            expected: error.expected,
            actual: error.actual,
          });
        });
        return true;
      }
      return false;
    });
    document.addEventListener('click', onClick, true);
    document.addEventListener('dblclick', onDblClick, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('change', onChange, true);
    document.addEventListener('submit', onSubmit, true);
    window.addEventListener('pagehide', flushInput);
    window.addEventListener('__asgApiCall', onApi);
  }

  refresh();
})();
