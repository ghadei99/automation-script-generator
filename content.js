function getSelectorDescriptor(element) {
  const testId = element.getAttribute('data-testid');
  if (testId) return { strategy: 'testid', value: testId, fragile: false };

  const ariaLabel = element.getAttribute('aria-label');
  if (ariaLabel) return { strategy: 'ariaLabel', value: ariaLabel, fragile: false };

  const role = element.getAttribute('role');
  if (role) return { strategy: 'role', value: role, fragile: false };

  const text = (element.textContent || '').trim();
  if (text && text.length <= 60) {
    return { strategy: 'text', value: text, tag: element.tagName.toLowerCase(), fragile: false };
  }

  if (element.id) return { strategy: 'id', value: element.id, fragile: false };
  if (element.name) return { strategy: 'name', value: element.name, fragile: false };

  return { strategy: 'css', value: element.tagName.toLowerCase(), fragile: true };
}

async function recordAction(action) {
  const { recordedActions } = await chrome.storage.local.get('recordedActions');
  const actions = recordedActions || [];
  actions.push(action);
  await chrome.storage.local.set({ recordedActions: actions });
}

document.addEventListener('click', function (e) {
  recordAction({ type: 'click', selector: getSelectorDescriptor(e.target) });
});

document.addEventListener('input', function (e) {
  recordAction({ type: 'input', selector: getSelectorDescriptor(e.target), value: e.target.value });
});

document.addEventListener('change', function (e) {
  const el = e.target;
  if (el.type === 'radio') {
    recordAction({ type: 'radio', selector: getSelectorDescriptor(el) });
  }
});

document.addEventListener('change', function (e) {
  const el = e.target;
  if (el.type === 'checkbox') {
    recordAction({ type: 'checkbox', selector: getSelectorDescriptor(el), checked: el.checked });
  }
});

document.addEventListener('submit', function (e) {
  recordAction({ type: 'submit', selector: getSelectorDescriptor(e.target) });
});

document.addEventListener('dblclick', function (e) {
  recordAction({ type: 'dblclick', selector: getSelectorDescriptor(e.target) });
});

async function recordApiCall(record) {
  const { recordedApiCalls } = await chrome.storage.local.get('recordedApiCalls');
  const calls = recordedApiCalls || [];
  calls.push(record);
  await chrome.storage.local.set({ recordedApiCalls: calls });
}

window.addEventListener('__selRecorderApiCall', function (e) {
  try {
    recordApiCall(JSON.parse(e.detail));
  } catch (err) {
    // Malformed capture payload -- drop it rather than corrupt the recording.
  }
});

