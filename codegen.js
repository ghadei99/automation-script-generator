function escapeStr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function fragileComment(selector) {
  return selector && selector.fragile
    ? ' // FRAGILE SELECTOR: no data-testid/aria-label/role/text/id/name found, falling back to tag name - verify manually'
    : '';
}

function seleniumBy(selector) {
  switch (selector.strategy) {
    case 'testid': return `By.cssSelector("[data-testid=\\"${escapeStr(selector.value)}\\"]")`;
    case 'ariaLabel': return `By.cssSelector("[aria-label=\\"${escapeStr(selector.value)}\\"]")`;
    case 'role': return `By.cssSelector("[role=\\"${escapeStr(selector.value)}\\"]")`;
    case 'text': return `By.xpath("//${selector.tag || '*'}[contains(normalize-space(.), \\"${escapeStr(selector.value)}\\")]")`;
    case 'id': return `By.id("${escapeStr(selector.value)}")`;
    case 'name': return `By.name("${escapeStr(selector.value)}")`;
    default: return `By.cssSelector("${escapeStr(selector.value)}")`;
  }
}

function toCssSelector(selector) {
  switch (selector.strategy) {
    case 'testid': return `[data-testid="${selector.value}"]`;
    case 'ariaLabel': return `[aria-label="${selector.value}"]`;
    case 'role': return `[role="${selector.value}"]`;
    case 'id': return `#${selector.value}`;
    case 'name': return `[name="${selector.value}"]`;
    default: return selector.value;
  }
}

function cypressLocator(selector) {
  if (selector.strategy === 'text') {
    return `cy.contains('${selector.tag || '*'}', "${escapeStr(selector.value)}")`;
  }
  return `cy.get('${toCssSelector(selector)}')`;
}

function playwrightLocator(selector) {
  if (selector.strategy === 'text') {
    return `page.getByText("${escapeStr(selector.value)}")`;
  }
  return `page.locator('${toCssSelector(selector)}')`;
}

function renderSelenium(actions) {
  const lines = ['WebDriver driver = new ChromeDriver();'];
  for (const action of actions) {
    const by = action.selector ? seleniumBy(action.selector) : null;
    const flag = fragileComment(action.selector);
    switch (action.type) {
      case 'navigate':
        lines.push(`driver.get("${escapeStr(action.url)}");`);
        break;
      case 'click':
      case 'radio':
      case 'checkbox':
        lines.push(`driver.findElement(${by}).click();${flag}`);
        break;
      case 'input':
        lines.push(`driver.findElement(${by}).sendKeys("${escapeStr(action.value)}");${flag}`);
        break;
      case 'submit':
        lines.push(`driver.findElement(${by}).submit();${flag}`);
        break;
      case 'dblclick':
        lines.push(`((JavascriptExecutor) driver).executeScript("var evt = document.createEvent('MouseEvents'); evt.initEvent('dblclick', true, true); arguments[0].dispatchEvent(evt);", driver.findElement(${by}));${flag}`);
        break;
    }
  }
  return lines.join('\n');
}

function renderCypress(actions) {
  const lines = [];
  for (const action of actions) {
    const locator = action.selector ? cypressLocator(action.selector) : null;
    const flag = fragileComment(action.selector);
    switch (action.type) {
      case 'navigate':
        lines.push(`cy.visit("${escapeStr(action.url)}");`);
        break;
      case 'click':
        lines.push(`${locator}.click();${flag}`);
        break;
      case 'radio':
        lines.push(`${locator}.check();${flag}`);
        break;
      case 'checkbox':
        lines.push(`${locator}.${action.checked ? 'check' : 'uncheck'}();${flag}`);
        break;
      case 'input':
        lines.push(`${locator}.clear().type("${escapeStr(action.value)}");${flag}`);
        break;
      case 'submit':
        lines.push(`${locator}.submit();${flag}`);
        break;
      case 'dblclick':
        lines.push(`${locator}.dblclick();${flag}`);
        break;
    }
  }
  return lines.join('\n');
}

function renderPlaywright(actions) {
  const lines = [];
  for (const action of actions) {
    const locator = action.selector ? playwrightLocator(action.selector) : null;
    const flag = fragileComment(action.selector);
    switch (action.type) {
      case 'navigate':
        lines.push(`await page.goto("${escapeStr(action.url)}");`);
        break;
      case 'click':
        lines.push(`await ${locator}.click();${flag}`);
        break;
      case 'radio':
        lines.push(`await ${locator}.check();${flag}`);
        break;
      case 'checkbox':
        lines.push(`await ${locator}.${action.checked ? 'check' : 'uncheck'}();${flag}`);
        break;
      case 'input':
        lines.push(`await ${locator}.fill("${escapeStr(action.value)}");${flag}`);
        break;
      case 'submit':
        lines.push(`await ${locator}.evaluate((form) => form.submit());${flag}`);
        break;
      case 'dblclick':
        lines.push(`await ${locator}.dblclick();${flag}`);
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
