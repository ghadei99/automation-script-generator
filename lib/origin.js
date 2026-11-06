(function (root) {
  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch (error) {
      return '';
    }
  }

  function originPattern(url) {
    const origin = originOf(url);
    return origin ? `${origin}/*` : '';
  }

  function unsupportedReason(url) {
    if (!url) return 'This page has no URL. Open an http or https page.';
    let parsed;
    try {
      parsed = new URL(url);
    } catch (error) {
      return 'This URL is not valid.';
    }
    if (parsed.protocol === 'about:' || parsed.protocol === 'chrome-error:' || parsed.protocol === 'data:') {
      return 'ignore';
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `This page cannot be scripted (${parsed.protocol}// pages are blocked). Open an http or https page.`;
    }
    const host = parsed.hostname;
    if (host === 'chrome.google.com' || host === 'chromewebstore.google.com') {
      return 'Chrome blocks extensions on the Chrome Web Store. Open a different http or https page.';
    }
    return '';
  }

  function sameOrigin(url, origin) {
    return !!origin && originOf(url) === origin;
  }

  const api = { originOf, originPattern, unsupportedReason, sameOrigin };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
