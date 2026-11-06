(function (root) {
  function createId() {
    return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  const api = { createId };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
