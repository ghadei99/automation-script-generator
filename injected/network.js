(function () {
  if (globalThis.__asgNetworkInstalled) return;
  globalThis.__asgNetworkInstalled = true;

  const SENSITIVE_KEY = /(^|[^a-z])(pass(word|wd)?|passwd|secret|token|api[_-]?key|authorization|cookie|set-cookie|ssn|cvv|cvc|pin|otp|cardnumber)([^a-z]|$)/i;
  const QUERY_NAMES = /^(token|access_token|refresh_token|id_token|api_key|apikey|api-key|password|passwd|secret|auth|session|jwt|code|key)$/i;

  function enabled() {
    const root = document.documentElement;
    if (!root) return true;
    return root.getAttribute('data-asg-capture') !== '0';
  }

  function redactUrl(url) {
    try {
      const parsed = new URL(String(url), location.href);
      if (parsed.username) parsed.username = 'REDACTED';
      if (parsed.password) parsed.password = 'REDACTED';
      for (const key of [...parsed.searchParams.keys()]) {
        if (QUERY_NAMES.test(key) || SENSITIVE_KEY.test(key)) parsed.searchParams.set(key, 'REDACTED');
      }
      return parsed.toString();
    } catch (error) {
      return String(url || '');
    }
  }

  function redactJson(value, depth) {
    if (depth > 6) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => redactJson(item, depth + 1));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) out[key] = SENSITIVE_KEY.test(key) ? 'REDACTED' : redactJson(child, depth + 1);
      return out;
    }
    if (typeof value === 'string' && /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./.test(value)) return 'REDACTED';
    if (typeof value === 'string' && value.length > 4000) return `${value.slice(0, 4000)}…`;
    return value;
  }

  function redactBody(body) {
    if (body == null || body === '') return null;
    const text = String(body).slice(0, 8000);
    try {
      return JSON.stringify(redactJson(JSON.parse(text), 0));
    } catch (error) {
      return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
    }
  }

  function dispatch(record) {
    if (!enabled()) return;
    try {
      const safe = {
        method: String(record.method || 'GET').toUpperCase(),
        url: redactUrl(record.url || ''),
        requestBody: redactBody(record.requestBody),
        status: record.status,
        statusText: record.statusText || '',
        contentType: record.contentType || '',
        responseBody: redactBody(record.responseBody),
      };
      window.dispatchEvent(new CustomEvent('__asgApiCall', { detail: JSON.stringify(safe) }));
    } catch (error) {
      // A failed capture must not break the page.
    }
  }

  const originalFetch = window.fetch;
  window.fetch = async function asgFetch(...args) {
    const request = args[0] instanceof Request ? args[0] : null;
    const init = args[1] || {};
    const method = ((request && request.method) || init.method || 'GET').toUpperCase();
    const url = request ? request.url : String(args[0]);
    let requestBody = null;
    if (enabled()) {
      try {
        if (request) requestBody = await request.clone().text();
        else if (typeof init.body === 'string') requestBody = init.body;
      } catch (error) {
        requestBody = null;
      }
    }
    const response = await originalFetch.apply(this, args);
    if (enabled() && !String(url).startsWith('chrome-extension://')) {
      try {
        dispatch({
          method,
          url,
          requestBody,
          status: response.status,
          statusText: response.statusText,
          contentType: response.headers.get('content-type') || '',
          responseBody: (await response.clone().text()).slice(0, 8000),
        });
      } catch (error) {
        // Opaque responses are skipped.
      }
    }
    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function asgOpen(method, url, ...rest) {
    this.__asgMethod = method;
    this.__asgUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function asgSend(body) {
    this.addEventListener('loadend', () => {
      try {
        dispatch({
          method: this.__asgMethod || 'GET',
          url: this.__asgUrl || '',
          requestBody: typeof body === 'string' ? body : null,
          status: this.status,
          statusText: this.statusText,
          contentType: this.getResponseHeader('content-type') || '',
          responseBody: (this.responseText || '').slice(0, 8000),
        });
      } catch (error) {
        // Cross-origin responses that cannot be read are skipped.
      }
    });
    return originalSend.call(this, body);
  };
})();
