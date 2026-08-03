chrome.action.onClicked.addListener(() => {
  chrome.windows.create({
    url: chrome.runtime.getURL("popup.html"),
    type: "popup",
    width: 600,
    height: 400,
    focused: true
  });
});

async function recordNavigation(url) {
  if (!/^https?:/.test(url)) return;

  const { recordedActions } = await chrome.storage.local.get('recordedActions');
  const actions = recordedActions || [];
  const last = actions[actions.length - 1];
  if (last && last.type === 'navigate' && last.url === url) return;

  actions.push({ type: 'navigate', url });
  await chrome.storage.local.set({ recordedActions: actions });
}

// Full page loads, reloads, and link-driven navigations.
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  recordNavigation(details.url);
});

// SPA route changes via history.pushState/replaceState, which onCommitted misses.
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;
  recordNavigation(details.url);
});
