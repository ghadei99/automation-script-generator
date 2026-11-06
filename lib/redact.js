(function (root) {
  const SENSITIVE_KEY = /(^|[^a-z])(pass(word|wd)?|passwd|secret|token|api[_-]?key|authorization|cookie|set-cookie|ssn|cvv|cvc|pin|otp|cardnumber)([^a-z]|$)/i;
  const QUERY_NAMES = /^(token|access_token|refresh_token|id_token|api_key|apikey|api-key|password|passwd|secret|auth|session|jwt|code|key)$/i;
  const JWT = /^eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./;

  function isSensitiveField(el) {
    if (!el || typeof el.getAttribute !== 'function') return false;
    const type = String(el.type || el.getAttribute('type') || '').toLowerCase();
    if (type === 'password') return true;
    const auto = String(el.getAttribute('autocomplete') || '').toLowerCase();
    if (/password|cc-number|cc-csc|cc-exp|one-time-code/.test(auto)) return true;
    const hint = `${el.name || ''} ${el.id || ''} ${el.getAttribute('aria-label') || ''}`;
    return SENSITIVE_KEY.test(hint);
  }

  function paramNameFor(el) {
    const raw = (el && (el.getAttribute && (el.getAttribute('name') || el.getAttribute('id') || el.getAttribute('autocomplete')))) || 'secret';
    const cleaned = String(raw).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return (cleaned || 'secret').slice(0, 40);
  }

  function redactUrl(url) {
    const raw = String(url || '');
    try {
      const parsed = new URL(raw);
      if (parsed.username) parsed.username = 'REDACTED';
      if (parsed.password) parsed.password = 'REDACTED';
      for (const key of [...parsed.searchParams.keys()]) {
        if (QUERY_NAMES.test(key) || SENSITIVE_KEY.test(key)) parsed.searchParams.set(key, 'REDACTED');
      }
      return parsed.toString();
    } catch (error) {
      return raw.replace(/([?&])([^&=]*(?:token|password|secret|api[_-]?key|session|jwt)[^&=]*)=([^&]*)/gi, '$1$2=REDACTED');
    }
  }

  function redactJson(value, depth) {
    if (depth > 6) return '[truncated]';
    if (Array.isArray(value)) return value.slice(0, 30).map((item) => redactJson(item, depth + 1));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [key, child] of Object.entries(value)) {
        out[key] = SENSITIVE_KEY.test(key) ? 'REDACTED' : redactJson(child, depth + 1);
      }
      return out;
    }
    if (typeof value === 'string') {
      if (JWT.test(value)) return 'REDACTED';
      if (value.length > 4000) return `${value.slice(0, 4000)}…`;
    }
    return value;
  }

  function redactBody(body) {
    if (body == null || body === '') return null;
    const text = String(body);
    try {
      return JSON.stringify(redactJson(JSON.parse(text), 0));
    } catch (error) {
      const trimmed = text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
      if (JWT.test(trimmed)) return 'REDACTED';
      return trimmed;
    }
  }

  function redactApiCall(call) {
    const source = call || {};
    return {
      method: String(source.method || 'GET').toUpperCase(),
      url: redactUrl(source.url || ''),
      requestBody: redactBody(source.requestBody),
      status: Number.isFinite(source.status) ? source.status : source.status || 0,
      statusText: String(source.statusText || ''),
      contentType: String(source.contentType || '').slice(0, 200),
      responseBody: redactBody(source.responseBody),
    };
  }

  const api = {
    isSensitiveField,
    paramNameFor,
    redactUrl,
    redactBody,
    redactApiCall,
  };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
