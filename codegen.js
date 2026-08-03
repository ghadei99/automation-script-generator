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

function playwrightLocator(selector, pageRef) {
  if (selector.strategy === 'text') {
    return `${pageRef}.getByText("${escapeStr(selector.value)}")`;
  }
  return `${pageRef}.locator('${toCssSelector(selector)}')`;
}

function toIdentifier(text) {
  const words = String(text)
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'Element';
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
}

const METHOD_PREFIXES = {
  click: 'click',
  radio: 'select',
  checkbox: 'set',
  input: 'enter',
  submit: 'submit',
  dblclick: 'doubleClick',
};

// Groups actions into one reusable page-object method per distinct (type, selector)
// pair, and a separate ordered call sequence -- so an element interacted with twice
// gets one method definition invoked twice, rather than two duplicate methods.
function buildPageModel(actions) {
  const methods = [];
  const methodKeyToName = new Map();
  const usedNames = new Set();
  const calls = [];

  function uniqueName(base) {
    let name = base;
    let i = 2;
    while (usedNames.has(name)) {
      name = `${base}${i}`;
      i += 1;
    }
    usedNames.add(name);
    return name;
  }

  for (const action of actions) {
    if (action.type === 'navigate') {
      if (!methodKeyToName.has('navigate')) {
        const name = uniqueName('navigateTo');
        methodKeyToName.set('navigate', name);
        methods.push({ name, type: 'navigate' });
      }
      calls.push({ name: methodKeyToName.get('navigate'), args: [action.url] });
      continue;
    }

    const sel = action.selector;
    const key = `${action.type}:${sel.strategy}:${sel.value}`;
    let name = methodKeyToName.get(key);
    if (!name) {
      name = uniqueName(`${METHOD_PREFIXES[action.type]}${toIdentifier(sel.value)}`);
      methodKeyToName.set(key, name);
      methods.push({ name, type: action.type, selector: sel });
    }

    const args = [];
    if (action.type === 'input') args.push(action.value);
    if (action.type === 'checkbox') args.push(action.checked);
    calls.push({ name, args });
  }

  return { methods, calls };
}

function renderCallArgs(args) {
  return args.map((a) => (typeof a === 'boolean' ? String(a) : `"${escapeStr(a)}"`)).join(', ');
}

function renderSeleniumMethod(method) {
  const by = method.selector ? seleniumBy(method.selector) : null;
  const flag = fragileComment(method.selector);
  switch (method.type) {
    case 'navigate':
      return '    public void navigateTo(String url) {\n        driver.get(url);\n    }';
    case 'click':
    case 'radio':
      return `    public void ${method.name}() {\n        driver.findElement(${by}).click();${flag}\n    }`;
    case 'checkbox':
      return `    public void ${method.name}(boolean checked) {\n        WebElement element = driver.findElement(${by});${flag}\n        if (element.isSelected() != checked) {\n            element.click();\n        }\n    }`;
    case 'input':
      return `    public void ${method.name}(String value) {\n        driver.findElement(${by}).sendKeys(value);${flag}\n    }`;
    case 'submit':
      return `    public void ${method.name}() {\n        driver.findElement(${by}).submit();${flag}\n    }`;
    case 'dblclick':
      return `    public void ${method.name}() {\n        ((JavascriptExecutor) driver).executeScript("var evt = document.createEvent('MouseEvents'); evt.initEvent('dblclick', true, true); arguments[0].dispatchEvent(evt);", driver.findElement(${by}));${flag}\n    }`;
    default:
      return '';
  }
}

function renderSelenium(actions) {
  const { methods, calls } = buildPageModel(actions);
  const methodBlocks = methods.map(renderSeleniumMethod).join('\n\n');

  const pageClass = [
    'public class RecordedPage {',
    '    private final WebDriver driver;',
    '',
    '    public RecordedPage(WebDriver driver) {',
    '        this.driver = driver;',
    '    }',
    '',
    methodBlocks,
    '}',
  ].join('\n');

  const callLines = calls.map((c) => `        page.${c.name}(${renderCallArgs(c.args)});`).join('\n');
  const testClass = [
    'public class RecordedTest {',
    '    public static void main(String[] args) {',
    '        WebDriver driver = new ChromeDriver();',
    '        RecordedPage page = new RecordedPage(driver);',
    '',
    callLines,
    '    }',
    '}',
  ].join('\n');

  return `// ==== RecordedPage.java ====\n${pageClass}\n\n// ==== RecordedTest.java ====\n${testClass}`;
}

function renderCypressMethod(method) {
  const locator = method.selector ? cypressLocator(method.selector) : null;
  const flag = fragileComment(method.selector);
  switch (method.type) {
    case 'navigate':
      return '  navigateTo(url) {\n    cy.visit(url);\n    return this;\n  }';
    case 'click':
      return `  ${method.name}() {\n    ${locator}.click();${flag}\n    return this;\n  }`;
    case 'radio':
      return `  ${method.name}() {\n    ${locator}.check();${flag}\n    return this;\n  }`;
    case 'checkbox':
      return `  ${method.name}(checked) {\n    if (checked) {\n      ${locator}.check();${flag}\n    } else {\n      ${locator}.uncheck();${flag}\n    }\n    return this;\n  }`;
    case 'input':
      return `  ${method.name}(value) {\n    ${locator}.clear().type(value);${flag}\n    return this;\n  }`;
    case 'submit':
      return `  ${method.name}() {\n    ${locator}.submit();${flag}\n    return this;\n  }`;
    case 'dblclick':
      return `  ${method.name}() {\n    ${locator}.dblclick();${flag}\n    return this;\n  }`;
    default:
      return '';
  }
}

function renderCypress(actions) {
  const { methods, calls } = buildPageModel(actions);
  const methodBlocks = methods.map(renderCypressMethod).join('\n\n');

  const pageClass = ['class RecordedPage {', methodBlocks, '}', '', 'export default RecordedPage;'].join('\n');

  const callLines = calls.map((c) => `    page.${c.name}(${renderCallArgs(c.args)});`).join('\n');
  const testFile = [
    "import RecordedPage from './RecordedPage';",
    '',
    "describe('Recorded session', () => {",
    "  it('replays the recorded actions', () => {",
    '    const page = new RecordedPage();',
    callLines,
    '  });',
    '});',
  ].join('\n');

  return `// ==== RecordedPage.js ====\n${pageClass}\n\n// ==== recorded.cy.js ====\n${testFile}`;
}

function renderPlaywrightMethod(method) {
  const locator = method.selector ? playwrightLocator(method.selector, 'this.page') : null;
  const flag = fragileComment(method.selector);
  switch (method.type) {
    case 'navigate':
      return '  async navigateTo(url: string) {\n    await this.page.goto(url);\n  }';
    case 'click':
      return `  async ${method.name}() {\n    await ${locator}.click();${flag}\n  }`;
    case 'radio':
      return `  async ${method.name}() {\n    await ${locator}.check();${flag}\n  }`;
    case 'checkbox':
      return `  async ${method.name}(checked: boolean) {\n    if (checked) {\n      await ${locator}.check();${flag}\n    } else {\n      await ${locator}.uncheck();${flag}\n    }\n  }`;
    case 'input':
      return `  async ${method.name}(value: string) {\n    await ${locator}.fill(value);${flag}\n  }`;
    case 'submit':
      return `  async ${method.name}() {\n    await ${locator}.evaluate((form) => (form as HTMLFormElement).submit());${flag}\n  }`;
    case 'dblclick':
      return `  async ${method.name}() {\n    await ${locator}.dblclick();${flag}\n  }`;
    default:
      return '';
  }
}

function renderPlaywright(actions) {
  const { methods, calls } = buildPageModel(actions);
  const methodBlocks = methods.map(renderPlaywrightMethod).join('\n\n');

  const pageClass = [
    "import { Page } from '@playwright/test';",
    '',
    'export class RecordedPage {',
    '  constructor(private page: Page) {}',
    '',
    methodBlocks,
    '}',
  ].join('\n');

  const callLines = calls.map((c) => `  await page.${c.name}(${renderCallArgs(c.args)});`).join('\n');
  const testFile = [
    "import { test } from '@playwright/test';",
    "import { RecordedPage } from './RecordedPage';",
    '',
    "test('replays the recorded actions', async ({ page: pwPage }) => {",
    '  const page = new RecordedPage(pwPage);',
    callLines,
    '});',
  ].join('\n');

  return `// ==== RecordedPage.ts ====\n${pageClass}\n\n// ==== recorded.spec.ts ====\n${testFile}`;
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
