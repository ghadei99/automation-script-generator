function getSelectorDescriptor(element) {
  if (element.id) return { strategy: 'id', value: element.id };
  if (element.name) return { strategy: 'name', value: element.name };
  if (element.className) return { strategy: 'className', value: element.className.split(' ')[0] };
  return { strategy: 'css', value: element.tagName.toLowerCase() };
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

// document.addEventListener('mouseover', function (e) {
//   const el = e.target;
//   const selector = getSelector(el);
//   const code = `Actions actions = new Actions(driver); actions.moveToElement(driver.findElement(${selector})).perform();`;
//   codeLines.push(code);
//   updateStorage();
// });

// document.addEventListener('change', function (e) {
//   const el = e.target;
//   const selector = getSelector(el);
//   const value = el.value;
//   const code = `driver.findElement(${selector}).sendKeys("${value}");`;
//   // console.log('the code is :-' + code);   
// });

// document.addEventListener('scroll', function (e) {
//   const code = `((JavascriptExecutor) driver).executeScript("window.scrollBy(0, arguments[0]);", ${window.scrollY});`;
//   codeLines.push(code);
//   updateStorage();
// });


