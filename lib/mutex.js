(function (root) {
  function createMutex() {
    let chain = Promise.resolve();
    return function withLock(task) {
      const run = chain.then(task, task);
      chain = run.then(() => {}, () => {});
      return run;
    };
  }

  const api = { createMutex };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
