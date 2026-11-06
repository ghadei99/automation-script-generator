(function (root) {
  const MANAGED_IDS = ['asg-recorder', 'asg-network'];

  function listEquals(left, right) {
    const a = left || [];
    const b = right || [];
    return a.length === b.length && a.every((item, index) => item === b[index]);
  }

  function worldOf(script) {
    return (script && script.world) || 'ISOLATED';
  }

  function configMatches(existing, desired) {
    if (!existing || !desired) return false;
    return listEquals(existing.matches, desired.matches)
      && listEquals(existing.js, desired.js)
      && (existing.runAt || 'document_idle') === (desired.runAt || 'document_idle')
      && worldOf(existing) === worldOf(desired)
      && !!existing.persistAcrossSessions === !!desired.persistAcrossSessions;
  }

  function desiredScripts(origin, networkCapture, files, networkFile) {
    const pattern = `${origin}/*`;
    const scripts = [{
      id: 'asg-recorder',
      js: files.slice(),
      matches: [pattern],
      runAt: 'document_start',
      persistAcrossSessions: false,
    }];
    if (networkCapture) {
      scripts.push({
        id: 'asg-network',
        js: [networkFile],
        matches: [pattern],
        runAt: 'document_start',
        world: 'MAIN',
        persistAcrossSessions: false,
      });
    }
    return scripts;
  }

  function planRegistration(registered, desired) {
    const known = new Set(MANAGED_IDS);
    const wanted = new Set((desired || []).map((script) => script.id));
    const ours = (registered || []).filter((script) => script && known.has(script.id));
    const remove = ours.filter((script) => !wanted.has(script.id)).map((script) => script.id);
    const update = [];
    const insert = [];
    (desired || []).forEach((script) => {
      const existing = ours.find((item) => item.id === script.id);
      if (!existing) insert.push(script);
      else if (!configMatches(existing, script)) update.push(script);
    });
    return { remove, update, insert };
  }

  const api = { MANAGED_IDS, configMatches, desiredScripts, planRegistration };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
