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

function tryParseJson(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return null;
  }
}

function jsonScalarLiteral(value) {
  if (typeof value === 'string') return `"${escapeStr(value)}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return null;
}

function renderBodyAssertions(responseBody) {
  const parsed = tryParseJson(responseBody);
  if (parsed === null || typeof parsed !== 'object') return [];

  if (Array.isArray(parsed)) {
    return [`.body("size()", equalTo(${parsed.length}))`];
  }

  const assertions = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (Array.isArray(value)) {
      assertions.push(`.body("${escapeStr(key)}.size()", equalTo(${value.length}))`);
      continue;
    }
    const literal = jsonScalarLiteral(value);
    if (literal !== null) {
      assertions.push(`.body("${escapeStr(key)}", equalTo(${literal}))`);
    } else if (value !== null && typeof value === 'object') {
      assertions.push(`.body("${escapeStr(key)}", notNullValue())`);
    }
  }
  return assertions;
}

function renderRestAssured(apiCalls) {
  const blocks = apiCalls.map((call) => {
    const lines = ['given()'];
    if (call.requestBody) {
      lines.push('    .contentType("application/json")');
      lines.push(`    .body("${escapeStr(call.requestBody)}")`);
    }
    lines.push('.when()');
    const method = (call.method || 'GET').toLowerCase();
    lines.push(`    .${method}("${escapeStr(call.url)}")`);
    lines.push('.then()');

    const thenLines = [`    .statusCode(${call.status})`];
    if (call.contentType) {
      thenLines.push(`    .contentType(containsString("${escapeStr(call.contentType.split(';')[0].trim())}"))`);
    }
    for (const assertion of renderBodyAssertions(call.responseBody)) {
      thenLines.push(`    ${assertion}`);
    }
    lines.push(thenLines.join('\n'));

    return lines.join('\n') + ';';
  });
  return blocks.join('\n\n');
}

window.CodeGen = {
  renderSelenium,
  renderCypress,
  renderPlaywright,
  renderRestAssured,
  toCssSelector,
  seleniumBy,
  escapeStr,
};
