function getSelector(element) {
  if (element.id) return `By.id("${element.id}")`;
  if (element.name) return `By.name("${element.name}")`;
  if (element.className) return `By.className("${element.className.split(' ')[0]}")`;
  return `By.cssSelector("${element.tagName.toLowerCase()}")`;
}

async function appendCode(code) {
  const { seleniumCode } = await chrome.storage.local.get('seleniumCode');
  const codeLines = seleniumCode && seleniumCode.length
    ? seleniumCode
    : ['WebDriver driver = new ChromeDriver();'];
  codeLines.push(code);
  await chrome.storage.local.set({ seleniumCode: codeLines });
}

document.addEventListener('click', function (e) {
  const el = e.target;
  const selector = getSelector(el);
  appendCode(`driver.findElement(${selector}).click();`);
});

document.addEventListener('input', function (e) {
  const el = e.target;
  const selector = getSelector(el);
  const value = el.value;
  appendCode(`driver.findElement(${selector}).sendKeys("${value}");`);
});

document.addEventListener('change', function (e) {
  const el = e.target;
  if (el.type === 'radio') {
    const selector = getSelector(el);
    appendCode(`driver.findElement(${selector}).click();`);
  }
});

document.addEventListener('change', function (e) {
  const el = e.target;
  if (el.type === 'checkbox') {
    const selector = getSelector(el);
    appendCode(`if (${el.checked}) { driver.findElement(${selector}).click(); }`);
  }
});

document.addEventListener('submit', function (e) {
  const el = e.target;
  const selector = getSelector(el);
  appendCode(`driver.findElement(${selector}).submit();`);
});

document.addEventListener('dblclick', function (e) {
  const el = e.target;
  const selector = getSelector(el);
  appendCode(`((JavascriptExecutor) driver).executeScript("var evt = document.createEvent('MouseEvents'); evt.initEvent('dblclick', true, true); arguments[0].dispatchEvent(evt);", driver.findElement(${selector}));`);
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


