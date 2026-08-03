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

  const { seleniumCode } = await chrome.storage.local.get('seleniumCode');
  const codeLines = seleniumCode && seleniumCode.length
    ? seleniumCode
    : ['WebDriver driver = new ChromeDriver();'];

  const code = `driver.get("${url}");`;
  if (codeLines[codeLines.length - 1] === code) return;

  codeLines.push(code);
  await chrome.storage.local.set({ seleniumCode: codeLines });
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
