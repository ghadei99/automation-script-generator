function escapeStr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function seleniumBy(selector) {
  switch (selector.strategy) {
    case 'id': return `By.id("${escapeStr(selector.value)}")`;
    case 'name': return `By.name("${escapeStr(selector.value)}")`;
    case 'className': return `By.className("${escapeStr(selector.value)}")`;
    default: return `By.cssSelector("${escapeStr(selector.value)}")`;
  }
}

function toCssSelector(selector) {
  switch (selector.strategy) {
    case 'id': return `#${selector.value}`;
    case 'name': return `[name="${selector.value}"]`;
    case 'className': return `.${selector.value}`;
    default: return selector.value;
  }
}

function renderSelenium(actions) {
  const lines = ['WebDriver driver = new ChromeDriver();'];
  for (const action of actions) {
    const by = action.selector ? seleniumBy(action.selector) : null;
    switch (action.type) {
      case 'navigate':
        lines.push(`driver.get("${escapeStr(action.url)}");`);
        break;
      case 'click':
      case 'radio':
      case 'checkbox':
        lines.push(`driver.findElement(${by}).click();`);
        break;
      case 'input':
        lines.push(`driver.findElement(${by}).sendKeys("${escapeStr(action.value)}");`);
        break;
      case 'submit':
        lines.push(`driver.findElement(${by}).submit();`);
        break;
      case 'dblclick':
        lines.push(`((JavascriptExecutor) driver).executeScript("var evt = document.createEvent('MouseEvents'); evt.initEvent('dblclick', true, true); arguments[0].dispatchEvent(evt);", driver.findElement(${by}));`);
        break;
    }
  }
  return lines.join('\n');
}

function renderCypress(actions) {
  const lines = [];
  for (const action of actions) {
    const sel = action.selector ? toCssSelector(action.selector) : null;
    switch (action.type) {
      case 'navigate':
        lines.push(`cy.visit("${escapeStr(action.url)}");`);
        break;
      case 'click':
        lines.push(`cy.get('${sel}').click();`);
        break;
      case 'radio':
        lines.push(`cy.get('${sel}').check();`);
        break;
      case 'checkbox':
        lines.push(action.checked ? `cy.get('${sel}').check();` : `cy.get('${sel}').uncheck();`);
        break;
      case 'input':
        lines.push(`cy.get('${sel}').clear().type("${escapeStr(action.value)}");`);
        break;
      case 'submit':
        lines.push(`cy.get('${sel}').submit();`);
        break;
      case 'dblclick':
        lines.push(`cy.get('${sel}').dblclick();`);
        break;
    }
  }
  return lines.join('\n');
}

function renderPlaywright(actions) {
  const lines = [];
  for (const action of actions) {
    const sel = action.selector ? toCssSelector(action.selector) : null;
    switch (action.type) {
      case 'navigate':
        lines.push(`await page.goto("${escapeStr(action.url)}");`);
        break;
      case 'click':
        lines.push(`await page.locator('${sel}').click();`);
        break;
      case 'radio':
        lines.push(`await page.locator('${sel}').check();`);
        break;
      case 'checkbox':
        lines.push(action.checked ? `await page.locator('${sel}').check();` : `await page.locator('${sel}').uncheck();`);
        break;
      case 'input':
        lines.push(`await page.locator('${sel}').fill("${escapeStr(action.value)}");`);
        break;
      case 'submit':
        lines.push(`await page.locator('${sel}').evaluate((form) => form.submit());`);
        break;
      case 'dblclick':
        lines.push(`await page.locator('${sel}').dblclick();`);
        break;
    }
  }
  return lines.join('\n');
}

window.CodeGen = { renderSelenium, renderCypress, renderPlaywright, toCssSelector, seleniumBy, escapeStr };
