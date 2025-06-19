let codeLines = [
  'WebDriver driver = new ChromeDriver();',
];

function getSelector(element) {
  if (element.id) return `By.id("${element.id}")`;
  if (element.name) return `By.name("${element.name}")`;
  if (element.className) return `By.className("${element.className.split(' ')[0]}")`;
  return `By.cssSelector("${element.tagName.toLowerCase()}")`;
}

let lastBaseUrl = '';

document.addEventListener('navigate', function (e) {
  const url = new URL(e.detail.url); // Assuming the event provides the URL in its detail
  const baseUrl = `${url.protocol}//${url.host}`;
  
  if (baseUrl !== lastBaseUrl) {
    lastBaseUrl = baseUrl;
    const code = `driver.get("${baseUrl}");`;
    codeLines.push(code);
    updateStorage();
  }
});

document.addEventListener('click', function (e) {
  const el = e.target;
  const selector = getSelector(el);
  const code = `driver.findElement(${selector}).click();`;
  codeLines.push(code);
  updateStorage();
});

document.addEventListener('input', function (e) {
  const el = e.target;
  const selector = getSelector(el);
  const value = el.value;
  const code = `driver.findElement(${selector}).sendKeys("${value}");`;
  codeLines.push(code);
  updateStorage();
});

document.addEventListener('change', function (e) {
  const el = e.target;
  if (el.type === 'radio') {
    const selector = getSelector(el);
    const code = `driver.findElement(${selector}).click();`;
    codeLines.push(code);
    updateStorage();
  }
});

document.addEventListener('change', function (e) {
  const el = e.target;
  if (el.type === 'checkbox') {
    const selector = getSelector(el);
    const code = `if (${el.checked}) { driver.findElement(${selector}).click(); }`;
    codeLines.push(code);
    updateStorage();
  }
});

document.addEventListener('submit', function (e) {
  const el = e.target;
  const selector = getSelector(el);
  const code = `driver.findElement(${selector}).submit();`;
  codeLines.push(code);
  updateStorage();
});

document.addEventListener('dblclick', function (e) {
  const el = e.target;
  const selector = getSelector(el);
  const code = `((JavascriptExecutor) driver).executeScript("var evt = document.createEvent('MouseEvents'); evt.initEvent('dblclick', true, true); arguments[0].dispatchEvent(evt);", driver.findElement(${selector}));`;
  codeLines.push(code);
  updateStorage();
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



document.getElementById('copyButton').addEventListener('click', function () {
  const codeBox = document.getElementById('codeBox');
  const textToCopy = codeBox.value || codeBox.innerText;
  navigator.clipboard.writeText(textToCopy).then(() => {
    alert('Copied to clipboard!');
  }).catch(err => {
    console.error('Failed to copy text: ', err);
  });
});

document.getElementById('clearButton').addEventListener('click', function () {
  const codeBox = document.getElementById('codeBox');
  codeBox.value = '';
  updateStorage();
});


function updateStorage() {
  chrome.storage.local.set({ seleniumCode: codeLines });
  chrome.storage.local.get("seleniumCode", console.log);
}

