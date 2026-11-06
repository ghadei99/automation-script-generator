(function (root) {
  function cssEscapeAttr(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function cssEscapeIdent(value) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(String(value));
    return String(value).replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
  }

  function elementText(el) {
    if (!el) return '';
    const raw = typeof el.innerText === 'string' && el.innerText ? el.innerText : (el.textContent || '');
    return String(raw).replace(/\s+/g, ' ').trim();
  }

  function implicitRole(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'button') return 'button';
    if (tag === 'a' && el.hasAttribute('href')) return 'link';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'select') return 'combobox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (type === 'checkbox') return 'checkbox';
      if (type === 'radio') return 'radio';
      if (type === 'submit' || type === 'button') return 'button';
      if (['email', 'text', 'password', 'search', 'tel', 'url', 'number'].includes(type)) return 'textbox';
      return '';
    }
    return '';
  }

  function accessibleName(el) {
    const labelled = el.getAttribute('aria-label');
    if (labelled && labelled.trim()) return labelled.trim();
    const labelledBy = el.getAttribute('aria-labelledby');
    const doc = el.ownerDocument;
    if (labelledBy && doc) {
      const text = labelledBy.split(/\s+/).map((id) => doc.getElementById(id)).filter(Boolean).map(elementText).join(' ').trim();
      if (text) return text;
    }
    if (el.id && doc) {
      const label = doc.querySelector(`label[for="${cssEscapeAttr(el.id)}"]`);
      if (label) {
        const text = elementText(label);
        if (text) return text;
      }
    }
    if (typeof el.closest === 'function') {
      const wrap = el.closest('label');
      if (wrap) {
        const text = elementText(wrap);
        if (text) return text;
      }
    }
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'summary', 'label'].includes(tag)) return elementText(el);
    return '';
  }

  function roleSelector(role) {
    switch (role) {
      case 'button': return 'button, [role="button"], input[type="button"], input[type="submit"]';
      case 'link': return 'a[href], [role="link"]';
      case 'textbox': return 'input, textarea, [role="textbox"]';
      case 'checkbox': return 'input[type="checkbox"], [role="checkbox"]';
      case 'radio': return 'input[type="radio"], [role="radio"]';
      case 'combobox': return 'select, [role="combobox"]';
      default: return `[role="${cssEscapeAttr(role)}"]`;
    }
  }

  function queryAll(doc, selector) {
    if (!doc || !selector) return [];
    switch (selector.strategy) {
      case 'testid': {
        const attr = selector.attr || 'data-testid';
        return Array.from(doc.querySelectorAll(`[${attr}="${cssEscapeAttr(selector.value)}"]`));
      }
      case 'id': {
        const found = doc.getElementById(selector.value);
        return found ? [found] : [];
      }
      case 'name':
        return typeof doc.getElementsByName === 'function'
          ? Array.from(doc.getElementsByName(selector.value))
          : Array.from(doc.querySelectorAll(`[name="${cssEscapeAttr(selector.value)}"]`));
      case 'ariaLabel':
      case 'label':
        return Array.from(doc.querySelectorAll(`[aria-label="${cssEscapeAttr(selector.value)}"]`));
      case 'placeholder':
        return Array.from(doc.querySelectorAll(`[placeholder="${cssEscapeAttr(selector.value)}"]`));
      case 'text': {
        const tag = selector.tag || '*';
        return Array.from(doc.querySelectorAll(tag)).filter((el) => {
          if (elementText(el) !== selector.value) return false;
          return !Array.from(el.children).some((child) => elementText(child) === selector.value);
        });
      }
      case 'role':
        return Array.from(doc.querySelectorAll(roleSelector(selector.value))).filter((el) => {
          const role = el.getAttribute('role') || implicitRole(el);
          if (role !== selector.value) return false;
          if (selector.name && accessibleName(el) !== selector.name) return false;
          return true;
        });
      case 'css':
        try {
          return Array.from(doc.querySelectorAll(selector.uniqueCss || selector.value));
        } catch (error) {
          return [];
        }
      default:
        return [];
    }
  }

  function uniqueCssPath(element, doc) {
    const parts = [];
    let node = element;
    while (node && node.nodeType === 1 && node !== doc.body && node !== doc.documentElement) {
      const tag = node.tagName.toLowerCase();
      const parent = node.parentElement;
      let part = tag;
      if (parent) {
        const same = Array.from(parent.children).filter((child) => child.tagName === node.tagName);
        part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      if (node.id) {
        const idSel = `#${cssEscapeIdent(node.id)}`;
        try {
          if (doc.querySelectorAll(idSel).length === 1) {
            parts.unshift(idSel);
            break;
          }
        } catch (error) {
          // Invalid id for CSS. Keep the structural path.
        }
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(' > ') || (element.tagName ? element.tagName.toLowerCase() : '*');
  }

  function describeElement(element, doc) {
    const owner = doc || (element && element.ownerDocument);
    if (!element || element.nodeType !== 1 || !owner) {
      return {
        strategy: 'css',
        value: '*',
        uniqueCss: '*',
        matchCount: 0,
        ambiguous: true,
        fragile: true,
        warning: 'Event target is not an element.',
      };
    }

    const uniqueCss = uniqueCssPath(element, owner);
    const candidates = [];
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
      const value = element.getAttribute(attr);
      if (value) candidates.push({ strategy: 'testid', attr, value, fragile: false });
    }
    if (element.id) candidates.push({ strategy: 'id', value: element.id, fragile: false });

    const inputType = (element.getAttribute('type') || '').toLowerCase();
    const inputValue = element.getAttribute('value');
    if (element.getAttribute('name') && inputValue && (inputType === 'radio' || inputType === 'checkbox')) {
      const tag = element.tagName.toLowerCase();
      candidates.push({
        strategy: 'css',
        value: `${tag}[name="${cssEscapeAttr(element.getAttribute('name'))}"][value="${cssEscapeAttr(inputValue)}"]`,
        fragile: false,
      });
    } else if (element.getAttribute('name')) {
      candidates.push({ strategy: 'name', value: element.getAttribute('name'), fragile: false });
    }

    const aria = element.getAttribute('aria-label');
    if (aria) candidates.push({ strategy: 'ariaLabel', value: aria, fragile: false });
    const placeholder = element.getAttribute('placeholder');
    if (placeholder) candidates.push({ strategy: 'placeholder', value: placeholder, fragile: false });

    const explicit = element.getAttribute('role');
    const role = explicit || implicitRole(element);
    const name = accessibleName(element);
    if (role && name && name.length <= 80) {
      candidates.push({
        strategy: 'role',
        value: role,
        name,
        tag: element.tagName.toLowerCase(),
        explicit: !!explicit,
        fragile: false,
      });
    }

    const text = elementText(element);
    const tag = element.tagName.toLowerCase();
    if (text && text.length <= 60 && ['button', 'a', 'label', 'summary', 'h1', 'h2', 'h3', 'h4'].includes(tag)) {
      candidates.push({ strategy: 'text', value: text, tag, exact: true, fragile: false });
    }
    candidates.push({ strategy: 'css', value: uniqueCss, fragile: true });

    for (const candidate of candidates) {
      const described = { ...candidate, uniqueCss };
      const found = queryAll(owner, described);
      if (!found.includes(element)) continue;
      described.matchCount = found.length;
      described.ambiguous = found.length !== 1;
      if (found.length === 1 && candidate.strategy !== 'css') {
        described.warning = '';
        return described;
      }
      if (found.length === 1 && candidate.strategy === 'css') {
        described.warning = candidate.fragile
          ? 'No stable selector was unique. Using a structural CSS path. Verify it before relying on this step.'
          : '';
        described.fragile = candidate.fragile;
        return described;
      }
    }

    const fallbackCount = queryAll(owner, { strategy: 'css', value: uniqueCss, uniqueCss }).length;
    return {
      strategy: 'css',
      value: uniqueCss,
      uniqueCss,
      matchCount: fallbackCount,
      ambiguous: fallbackCount !== 1,
      fragile: true,
      warning: fallbackCount === 1
        ? 'No stable selector was unique. Using a structural CSS path. Verify it before relying on this step.'
        : `Selector matched ${fallbackCount} elements. Refine it before running this step.`,
    };
  }

  const api = {
    cssEscapeAttr,
    cssEscapeIdent,
    elementText,
    implicitRole,
    accessibleName,
    queryAll,
    uniqueCssPath,
    describeElement,
  };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
