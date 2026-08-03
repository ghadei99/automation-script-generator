(function () {
  function dispatchCapture(record) {
    window.dispatchEvent(new CustomEvent('__selRecorderApiCall', { detail: JSON.stringify(record) }));
  }

  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const request = args[0] instanceof Request ? args[0] : null;
    const url = request ? request.url : String(args[0]);
    const init = args[1] || {};
    const method = (request ? request.method : init.method) || 'GET';
    const requestBody = typeof init.body === 'string' ? init.body : null;

    const response = await originalFetch.apply(this, args);

    try {
      const responseBody = await response.clone().text();
      dispatchCapture({
        method,
        url,
        requestBody,
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type') || '',
        responseBody: responseBody.slice(0, 10000),
      });
    } catch (e) {
      // Opaque/no-cors response or unreadable body -- skip capture, don't break the page's fetch.
    }

    return response;
  };

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__capturedMethod = method;
    this.__capturedUrl = url;
    return originalOpen.call(this, method, url, ...rest);
  };

  XMLHttpRequest.prototype.send = function (body) {
    this.addEventListener('loadend', () => {
      try {
        dispatchCapture({
          method: this.__capturedMethod || 'GET',
          url: this.__capturedUrl || '',
          requestBody: typeof body === 'string' ? body : null,
          status: this.status,
          statusText: this.statusText,
          contentType: this.getResponseHeader('content-type') || '',
          responseBody: (this.responseText || '').slice(0, 10000),
        });
      } catch (e) {
        // Response not accessible (e.g. cross-origin restrictions) -- skip capture.
      }
    });
    return originalSend.call(this, body);
  };
})();
