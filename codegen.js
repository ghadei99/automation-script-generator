function escapeJava(value) {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}

function escapeStr(value) {
  return escapeJava(value);
}

function jsString(value) {
  return JSON.stringify(String(value));
}

function escapeAttr(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function fragileComment(selector) {
  if (!selector) return '';
  if (selector.warning) return ` // ${String(selector.warning).replace(/\s+/g, ' ')}`;
  if (selector.ambiguous) return ' // AMBIGUOUS SELECTOR: matched more than one element at record time - verify manually';
  if (selector.fragile) {
    return ' // FRAGILE SELECTOR: no data-testid/aria-label/role/text/id/name found, falling back to a structural CSS path - verify manually';
  }
  return '';
}

function toCssSelector(selector) {
  if (!selector) return '*';
  switch (selector.strategy) {
    case 'testid':
      return `[${selector.attr || 'data-testid'}="${escapeAttr(selector.value)}"]`;
    case 'ariaLabel':
    case 'label':
      return `[aria-label="${escapeAttr(selector.value)}"]`;
    case 'placeholder':
      return `[placeholder="${escapeAttr(selector.value)}"]`;
    case 'role':
      return `[role="${escapeAttr(selector.value)}"]`;
    case 'id':
      return `#${String(selector.value).replace(/[^a-zA-Z0-9_-]/g, '')}`;
    case 'name':
      return `[name="${escapeAttr(selector.value)}"]`;
    case 'text':
      return selector.uniqueCss || selector.tag || '*';
    default:
      return selector.uniqueCss || selector.value || '*';
  }
}

function seleniumBy(selector) {
  if (!selector) return 'By.cssSelector("*")';
  switch (selector.strategy) {
    case 'testid':
      return `By.cssSelector("[${selector.attr || 'data-testid'}=\\"${escapeJava(selector.value)}\\"]")`;
    case 'ariaLabel':
    case 'label':
      return `By.cssSelector("[aria-label=\\"${escapeJava(selector.value)}\\"]")`;
    case 'placeholder':
      return `By.cssSelector("[placeholder=\\"${escapeJava(selector.value)}\\"]")`;
    case 'role':
      if (selector.name && !selector.explicit) {
        return `By.xpath("//${selector.tag || '*'}[contains(normalize-space(.), \\"${escapeJava(selector.name)}\\")]")`;
      }
      if (selector.name) {
        return `By.xpath("//${selector.tag || '*'}[@role=\\"${escapeJava(selector.value)}\\" and contains(normalize-space(.), \\"${escapeJava(selector.name)}\\")]")`;
      }
      return `By.cssSelector("[role=\\"${escapeJava(selector.value)}\\"]")`;
    case 'text':
      return `By.xpath("//${selector.tag || '*'}[contains(normalize-space(.), \\"${escapeJava(selector.value)}\\")]")`;
    case 'id':
      return `By.id("${escapeJava(selector.value)}")`;
    case 'name':
      return `By.name("${escapeJava(selector.value)}")`;
    default:
      return `By.cssSelector("${escapeJava(selector.uniqueCss || selector.value || '*')}")`;
  }
}

function cypressLocator(selector) {
  if (!selector) return 'cy.get("*")';
  if (selector.strategy === 'text') return `cy.contains(${jsString(selector.tag || '*')}, ${jsString(selector.value)})`;
  return `cy.get(${jsString(toCssSelector(selector))}, { timeout: 10000 })`;
}

function playwrightLocator(selector, pageRef) {
  if (!selector) return `${pageRef}.locator('*')`;
  switch (selector.strategy) {
    case 'testid':
      if (!selector.attr || selector.attr === 'data-testid') return `${pageRef}.getByTestId(${jsString(selector.value)})`;
      return `${pageRef}.locator(${jsString(toCssSelector(selector))})`;
    case 'ariaLabel':
    case 'label':
      return `${pageRef}.getByLabel(${jsString(selector.value)})`;
    case 'placeholder':
      return `${pageRef}.getByPlaceholder(${jsString(selector.value)})`;
    case 'role':
      return selector.name
        ? `${pageRef}.getByRole(${jsString(selector.value)}, { name: ${jsString(selector.name)}, exact: true })`
        : `${pageRef}.locator(${jsString(toCssSelector(selector))})`;
    case 'text':
      return `${pageRef}.getByText(${jsString(selector.value)}, { exact: true })`;
    case 'id':
    case 'name':
    default:
      return `${pageRef}.locator(${jsString(toCssSelector(selector))})`;
  }
}

function toIdentifier(text) {
  const words = String(text || '')
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return 'Element';
  let name = words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('');
  if (/^[0-9]/.test(name)) name = `El${name}`;
  return name.slice(0, 32);
}

function envName(param) {
  const cleaned = String(param || 'SECRET').toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return `TEST_${cleaned || 'SECRET'}`.slice(0, 60);
}

function paramIdent(name) {
  const cleaned = String(name || 'secret').replace(/[^a-zA-Z0-9_]/g, '');
  if (!cleaned || /^[0-9]/.test(cleaned)) return `param_${cleaned || 'secret'}`;
  return cleaned;
}

const METHOD_PREFIXES = {
  click: 'click',
  radio: 'select',
  checkbox: 'set',
  input: 'enter',
  select: 'choose',
  submit: 'submit',
  dblclick: 'doubleClick',
  wait: 'waitFor',
  assertVisible: 'assertVisible',
  assertText: 'assertText',
  assertExists: 'assertExists',
  assertUrl: 'assertUrl',
};

function selectorKey(selector) {
  if (!selector) return '';
  return [selector.strategy, selector.attr || '', selector.value || '', selector.name || ''].join('|');
}

function plainUrl(value, allowPartial) {
  const text = String(value ?? '').trim();
  if (!text || /[\u0000-\u001f]/.test(text)) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(text)) {
    try {
      const url = new URL(text);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
      return url.href;
    } catch (error) {
      return '';
    }
  }
  return allowPartial ? text : '';
}

function confirmedUnique(selector) {
  if (!selector || selector.ambiguous || selector.fragile || selector.strategy === 'css') return false;
  if (Number.isFinite(selector.matchCount) && selector.matchCount !== 1) return false;
  return true;
}

function exportSelector(selector) {
  if (!selector || confirmedUnique(selector) || selector.strategy === 'css') return selector;
  if (!selector.uniqueCss) return selector;
  return {
    ...selector,
    strategy: 'css',
    value: selector.uniqueCss,
    fragile: true,
    warning: selector.warning || 'Selector was not unique. Using a structural CSS path. Verify it before relying on this step.',
  };
}

function methodLabel(selector) {
  if (!selector) return 'Element';
  if (selector.strategy === 'role' && selector.name) return selector.name;
  if (['testid', 'id', 'name', 'text', 'ariaLabel', 'label', 'placeholder'].includes(selector.strategy)) {
    return selector.value || 'Element';
  }
  const css = String(selector.uniqueCss || selector.value || '');
  if (selector.strategy === 'css' && css && css.length <= 24 && !css.includes('>') && !css.includes(':nth')) return css;
  return 'Element';
}

function prepareActions(actions) {
  const prepared = [];
  for (const action of actions || []) {
    if (!action || !action.type) continue;
    if (action.type === 'navigate') {
      const url = plainUrl(action.url, false);
      if (!url) continue;
      const previous = prepared[prepared.length - 1];
      if (previous && previous.type === 'navigate' && previous.url === url) continue;
      prepared.push({ ...action, url });
      continue;
    }
    if (action.type === 'assertUrl') {
      const raw = action.expected || action.url || '';
      prepared.push({ ...action, expected: plainUrl(raw, true) });
      continue;
    }
    const previous = prepared[prepared.length - 1];
    const sameRecorderEvent = previous
      && (action.type === 'click' || action.type === 'dblclick')
      && previous.type === action.type
      && selectorKey(previous.selector) === selectorKey(action.selector)
      && Number.isFinite(previous.recordedAt)
      && previous.recordedAt === action.recordedAt;
    if (sameRecorderEvent) continue;
    prepared.push(action);
  }
  return prepared;
}

function buildPageModel(actions) {
  const methods = [];
  const methodKeyToName = new Map();
  const usedNames = new Set();
  const calls = [];
  actions = prepareActions(actions);

  function uniqueName(base) {
    let name = base || 'step';
    let index = 2;
    while (usedNames.has(name)) {
      name = `${base}${index}`;
      index += 1;
    }
    usedNames.add(name);
    return name;
  }

  for (const action of actions || []) {
    if (!action || !action.type) continue;
    if (action.type === 'navigate') {
      if (!methodKeyToName.has('navigate')) {
        const name = uniqueName('navigateTo');
        methodKeyToName.set('navigate', name);
        methods.push({ name, type: 'navigate' });
      }
      calls.push({ name: methodKeyToName.get('navigate'), args: [action.url || ''] });
      continue;
    }

    if (action.type === 'assertUrl') {
      if (!methodKeyToName.has('assertUrl')) {
        const name = uniqueName('assertUrl');
        methodKeyToName.set('assertUrl', name);
        methods.push({ name, type: 'assertUrl' });
      }
      calls.push({
        name: methodKeyToName.get('assertUrl'),
        args: [action.expected || action.url || '', { match: action.match || 'exact' }],
      });
      continue;
    }

    if (!METHOD_PREFIXES[action.type]) continue;
    const sel = exportSelector(action.selector);
    const key = sel
      ? `${action.type}:${sel.strategy}:${sel.attr || ''}:${sel.value}:${sel.name || ''}`
      : action.type;
    let name = methodKeyToName.get(key);
    if (!name) {
      name = uniqueName(`${METHOD_PREFIXES[action.type]}${toIdentifier(methodLabel(sel))}`);
      methodKeyToName.set(key, name);
      methods.push({ name, type: action.type, selector: sel });
    }
    const args = [];
    if (action.secret && (action.type === 'input' || action.type === 'select')) {
      args.push({ secret: true, paramName: action.paramName || 'secret' });
    } else if (action.type === 'input' || action.type === 'select') {
      args.push(action.value == null ? '' : String(action.value));
    }
    if (action.type === 'checkbox') args.push(!!action.checked);
    if (action.type === 'assertText') args.push(action.expected || '', { match: action.match || 'exact' });
    calls.push({ name, args });
  }

  return { methods, calls };
}

function renderArg(arg, lang) {
  if (arg && typeof arg === 'object' && arg.secret) return paramIdent(arg.paramName);
  if (arg && typeof arg === 'object' && arg.match) return lang === 'java' ? (arg.match === 'partial' ? 'true' : 'false') : jsString(arg.match);
  if (typeof arg === 'boolean') return String(arg);
  if (typeof arg === 'number') return String(arg);
  if (lang === 'java') return `"${escapeJava(arg)}"`;
  return jsString(arg);
}

function secretPrelude(calls, lang) {
  const seen = new Set();
  const lines = [];
  for (const call of calls) {
    for (const arg of call.args) {
      if (!arg || !arg.secret || seen.has(arg.paramName)) continue;
      seen.add(arg.paramName);
      const ident = paramIdent(arg.paramName);
      const env = envName(arg.paramName);
      if (lang === 'java') {
        lines.push(`        String ${ident} = System.getenv("${env}");`);
        lines.push(`        if (${ident} == null || ${ident}.isEmpty()) throw new IllegalStateException("Missing environment variable ${env}");`);
      } else if (lang === 'js') {
        lines.push(`    const ${ident} = Cypress.env(${jsString(env)});`);
        lines.push(`    if (!${ident}) throw new Error(${jsString(`Missing Cypress env ${env}`)});`);
      } else {
        lines.push(`  const ${ident} = process.env[${jsString(env)}];`);
        lines.push(`  if (!${ident}) throw new Error(${jsString(`Missing environment variable ${env}`)});`);
      }
    }
  }
  return lines;
}

function renderSeleniumMethod(method) {
  const by = method.selector ? seleniumBy(method.selector) : null;
  const flag = fragileComment(method.selector);
  const wait = by
    ? `WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));\n        WebElement element = wait.until(ExpectedConditions.elementToBeClickable(${by}));`
    : '';
  switch (method.type) {
    case 'navigate':
      return '    public void navigateTo(String url) {\n        driver.get(url);\n    }';
    case 'click':
    case 'radio':
      return `    public void ${method.name}() {\n        ${wait}${flag}\n        element.click();\n    }`;
    case 'checkbox':
      return `    public void ${method.name}(boolean checked) {\n        ${wait}${flag}\n        if (element.isSelected() != checked) {\n            element.click();\n        }\n    }`;
    case 'input':
      return `    public void ${method.name}(String value) {\n        ${wait}${flag}\n        element.clear();\n        element.sendKeys(value);\n    }`;
    case 'select':
      return `    public void ${method.name}(String value) {\n        ${wait}${flag}\n        new Select(element).selectByValue(value);\n    }`;
    case 'submit':
      return `    public void ${method.name}() {\n        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));\n        WebElement element = wait.until(ExpectedConditions.presenceOfElementLocated(${by}));${flag}\n        element.submit();\n    }`;
    case 'dblclick':
      return `    public void ${method.name}() {\n        ${wait}${flag}\n        new Actions(driver).doubleClick(element).perform();\n    }`;
    case 'wait':
    case 'assertExists':
      return `    public void ${method.name}() {\n        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));\n        wait.until(ExpectedConditions.presenceOfElementLocated(${by}));${flag}\n    }`;
    case 'assertVisible':
      return `    public void ${method.name}() {\n        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));\n        wait.until(ExpectedConditions.visibilityOfElementLocated(${by}));${flag}\n    }`;
    case 'assertText':
      return `    public void ${method.name}(String expected, boolean partial) {\n        WebDriverWait wait = new WebDriverWait(driver, Duration.ofSeconds(10));\n        WebElement element = wait.until(ExpectedConditions.visibilityOfElementLocated(${by}));${flag}\n        String actual = element.getText().trim().replaceAll("\\\\s+", " ");\n        boolean ok = partial ? actual.contains(expected) : actual.equals(expected);\n        if (!ok) throw new AssertionError("expected " + (partial ? "text to contain " : "text ") + expected + " but was " + actual);\n    }`;
    case 'assertUrl':
      return '    public void assertUrl(String expected, boolean partial) {\n        String actual = driver.getCurrentUrl();\n        boolean ok = partial ? actual.contains(expected) : actual.equals(expected);\n        if (!ok) throw new AssertionError("expected URL " + (partial ? "to contain " : "") + expected + " but was " + actual);\n    }';
    default:
      return '';
  }
}

function renderSelenium(actions) {
  const { methods, calls } = buildPageModel(actions);
  const pageClass = [
    'import org.openqa.selenium.By;',
    'import org.openqa.selenium.WebDriver;',
    'import org.openqa.selenium.WebElement;',
    'import org.openqa.selenium.chrome.ChromeDriver;',
    'import org.openqa.selenium.interactions.Actions;',
    'import org.openqa.selenium.support.ui.ExpectedConditions;',
    'import org.openqa.selenium.support.ui.Select;',
    'import org.openqa.selenium.support.ui.WebDriverWait;',
    'import java.time.Duration;',
    '',
    'public class RecordedPage {',
    '    private final WebDriver driver;',
    '',
    '    public RecordedPage(WebDriver driver) {',
    '        this.driver = driver;',
    '    }',
    '',
    methods.map(renderSeleniumMethod).filter(Boolean).join('\n\n'),
    '}',
  ].join('\n');
  const callLines = calls.map((call) => `        page.${call.name}(${call.args.map((arg) => renderArg(arg, 'java')).join(', ')});`);
  const testClass = [
    'public class RecordedTest {',
    '    public static void main(String[] args) {',
    '        WebDriver driver = new ChromeDriver();',
    '        RecordedPage page = new RecordedPage(driver);',
    ...secretPrelude(calls, 'java'),
    '',
    ...callLines,
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
      return `  ${method.name}(checked) {\n    if (checked) ${locator}.check();${flag}\n    else ${locator}.uncheck();\n    return this;\n  }`;
    case 'input':
      return `  ${method.name}(value) {\n    ${locator}.clear().type(value);${flag}\n    return this;\n  }`;
    case 'select':
      return `  ${method.name}(value) {\n    ${locator}.select(value);${flag}\n    return this;\n  }`;
    case 'submit':
      return `  ${method.name}() {\n    ${locator}.submit();${flag}\n    return this;\n  }`;
    case 'dblclick':
      return `  ${method.name}() {\n    ${locator}.dblclick();${flag}\n    return this;\n  }`;
    case 'wait':
    case 'assertExists':
      return `  ${method.name}() {\n    ${locator}.should('exist');${flag}\n    return this;\n  }`;
    case 'assertVisible':
      return `  ${method.name}() {\n    ${locator}.should('be.visible');${flag}\n    return this;\n  }`;
    case 'assertText':
      return `  ${method.name}(expected, match = 'exact') {\n    if (match === 'partial') ${locator}.should('contain', expected);${flag}\n    else ${locator}.should('have.text', expected);\n    return this;\n  }`;
    case 'assertUrl':
      return '  assertUrl(expected, match = \'exact\') {\n    if (match === \'partial\') cy.url().should(\'include\', expected);\n    else cy.url().should(\'eq\', expected);\n    return this;\n  }';
    default:
      return '';
  }
}

function renderCypress(actions) {
  const { methods, calls } = buildPageModel(actions);
  const pageClass = ['class RecordedPage {', methods.map(renderCypressMethod).filter(Boolean).join('\n\n'), '}', '', 'export default RecordedPage;'].join('\n');
  const callLines = calls.map((call) => `    page.${call.name}(${call.args.map((arg) => renderArg(arg, 'js')).join(', ')});`);
  const testFile = [
    "import RecordedPage from './RecordedPage';",
    '',
    "describe('Recorded session', () => {",
    "  it('replays the recorded actions', () => {",
    '    const page = new RecordedPage();',
    ...secretPrelude(calls, 'js'),
    ...callLines,
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
      return '  async navigateTo(url: string) {\n    await this.page.goto(url, { waitUntil: \'domcontentloaded\', timeout: STEP_TIMEOUT });\n  }';
    case 'click':
      return `  async ${method.name}() {\n    await ${locator}.click({ timeout: STEP_TIMEOUT });${flag}\n  }`;
    case 'radio':
      return `  async ${method.name}() {\n    await ${locator}.check({ timeout: STEP_TIMEOUT });${flag}\n  }`;
    case 'checkbox':
      return `  async ${method.name}(checked: boolean) {\n    if (checked) await ${locator}.check({ timeout: STEP_TIMEOUT });${flag}\n    else await ${locator}.uncheck({ timeout: STEP_TIMEOUT });\n  }`;
    case 'input':
      return `  async ${method.name}(value: string) {\n    await ${locator}.fill(value, { timeout: STEP_TIMEOUT });${flag}\n  }`;
    case 'select':
      return `  async ${method.name}(value: string) {\n    await ${locator}.selectOption(value, { timeout: STEP_TIMEOUT });${flag}\n  }`;
    case 'submit':
      return `  async ${method.name}() {\n    await ${locator}.evaluate((form: HTMLFormElement) => form.requestSubmit());${flag}\n  }`;
    case 'dblclick':
      return `  async ${method.name}() {\n    await ${locator}.dblclick({ timeout: STEP_TIMEOUT });${flag}\n  }`;
    case 'wait':
    case 'assertExists':
      return `  async ${method.name}() {\n    await expect(${locator}).toHaveCount(1, { timeout: STEP_TIMEOUT });${flag}\n  }`;
    case 'assertVisible':
      return `  async ${method.name}() {\n    await expect(${locator}).toBeVisible({ timeout: STEP_TIMEOUT });${flag}\n  }`;
    case 'assertText':
      return `  async ${method.name}(expected: string, match: 'exact' | 'partial' = 'exact') {\n    const locator = ${locator};\n    if (match === 'partial') await expect(locator).toContainText(expected, { timeout: STEP_TIMEOUT });\n    else await expect(locator).toHaveText(expected, { timeout: STEP_TIMEOUT });${flag}\n  }`;
    case 'assertUrl':
      return '  async assertUrl(expected: string, match: \'exact\' | \'partial\' = \'exact\') {\n    if (match === \'partial\') await expect(this.page).toHaveURL(new RegExp(expected.replace(/[.*+?^${}()|[\\]\\\\]/g, \'\\\\$&\')));\n    else await expect(this.page).toHaveURL(expected);\n  }';
    default:
      return '';
  }
}

function renderPlaywright(actions) {
  const { methods, calls } = buildPageModel(actions);
  const pageClass = [
    "import { expect, Page } from '@playwright/test';",
    '',
    'const STEP_TIMEOUT = 10000;',
    '',
    'export class RecordedPage {',
    '  constructor(private page: Page) {}',
    '',
    methods.map(renderPlaywrightMethod).filter(Boolean).join('\n\n'),
    '}',
  ].join('\n');
  const callLines = calls.map((call) => `  await page.${call.name}(${call.args.map((arg) => renderArg(arg, 'ts')).join(', ')});`);
  const testFile = [
    "import { test } from '@playwright/test';",
    "import { RecordedPage } from './RecordedPage';",
    '',
    "test('replays the recorded actions', async ({ page: pwPage }) => {",
    '  const page = new RecordedPage(pwPage);',
    ...secretPrelude(calls, 'ts'),
    ...callLines,
    '});',
  ].join('\n');
  return `// ==== RecordedPage.ts ====\n${pageClass}\n\n// ==== recorded.spec.ts ====\n${testFile}`;
}

function tryParseJson(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function jsonScalarLiteral(value) {
  if (typeof value === 'string') return `"${escapeJava(value)}"`;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null) return 'null';
  return null;
}

function renderBodyAssertions(responseBody) {
  const parsed = tryParseJson(responseBody);
  if (parsed === null || typeof parsed !== 'object') return [];
  if (Array.isArray(parsed)) return [`.body("size()", equalTo(${parsed.length}))`];
  const assertions = [];
  for (const [key, value] of Object.entries(parsed)) {
    if (value === 'REDACTED') {
      assertions.push(`// ${key} was redacted and is not asserted`);
      continue;
    }
    if (Array.isArray(value)) {
      assertions.push(`.body("${escapeJava(key)}.size()", equalTo(${value.length}))`);
      continue;
    }
    const literal = jsonScalarLiteral(value);
    if (literal !== null) assertions.push(`.body("${escapeJava(key)}", equalTo(${literal}))`);
    else if (value !== null && typeof value === 'object') assertions.push(`.body("${escapeJava(key)}", notNullValue())`);
  }
  return assertions;
}

function renderRestAssured(apiCalls) {
  const allowed = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  const blocks = (apiCalls || []).map((raw) => {
    const call = (typeof ASG !== 'undefined' && ASG.redactApiCall) ? ASG.redactApiCall(raw) : raw;
    const method = String(call.method || 'GET').toLowerCase();
    if (!allowed.has(method)) return `// Skipped unsupported HTTP method ${escapeJava(method)} ${escapeJava(call.url || '')}`;
    const lines = ['given()'];
    if (call.requestBody) {
      lines.push('    .contentType("application/json")');
      lines.push(`    .body("${escapeJava(call.requestBody)}")`);
    }
    lines.push('.when()');
    lines.push(`    .${method}("${escapeJava(call.url || '')}")`);
    lines.push('.then()');
    const thenLines = [`    .statusCode(${Number(call.status) || 0})`];
    if (call.contentType) thenLines.push(`    .contentType(containsString("${escapeJava(String(call.contentType).split(';')[0].trim())}"))`);
    for (const assertion of renderBodyAssertions(call.responseBody)) thenLines.push(`    ${assertion}`);
    lines.push(thenLines.join('\n'));
    return `${lines.join('\n')};`;
  });
  const header = [
    '// import static io.restassured.RestAssured.given;',
    '// import static org.hamcrest.Matchers.containsString;',
    '// import static org.hamcrest.Matchers.equalTo;',
    '// import static org.hamcrest.Matchers.notNullValue;',
    '',
  ].join('\n');
  return header + (blocks.length ? blocks.join('\n\n') : '// No API calls captured.');
}

const codeGenApi = {
  renderSelenium,
  renderCypress,
  renderPlaywright,
  renderRestAssured,
  toCssSelector,
  seleniumBy,
  escapeStr,
  escapeJava,
  jsString,
  buildPageModel,
};

if (typeof window !== 'undefined') window.CodeGen = codeGenApi;
if (typeof globalThis !== 'undefined') globalThis.CodeGen = codeGenApi;
if (typeof module !== 'undefined' && module.exports) module.exports = codeGenApi;
