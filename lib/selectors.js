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
      case 'label':
        return controlsForLabel(doc, selector.value);
      case 'css':
        try {
          return Array.from(doc.querySelectorAll(selector.value || selector.uniqueCss));
        } catch (error) {
          return [];
        }
      default:
        return [];
    }
  }

  function labelText(label) {
    const clone = label.cloneNode(true);
    clone.querySelectorAll('input, textarea, select, button').forEach((node) => node.remove());
    return elementText(clone);
  }

  function controlsForLabel(doc, text) {
    const controls = [];
    Array.from(doc.querySelectorAll('label')).forEach((label) => {
      if (labelText(label) !== text) return;
      if (label.htmlFor) {
        const control = doc.getElementById(label.htmlFor);
        if (control) controls.push(control);
        return;
      }
      const nested = label.querySelector('input, textarea, select, button');
      if (nested) controls.push(nested);
    });
    return controls;
  }

  function associatedLabel(element) {
    const doc = element.ownerDocument;
    if (!doc) return '';
    if (element.id) {
      const label = doc.querySelector(`label[for="${cssEscapeAttr(element.id)}"]`);
      if (label) return labelText(label);
    }
    if (typeof element.closest === 'function') {
      const wrap = element.closest('label');
      if (wrap) return labelText(wrap);
    }
    return '';
  }

  function isDynamicId(value) {
    const id = String(value || '');
    if (!id || id.length > 48) return true;
    if (/^[0-9a-f]{8}-[0-9a-f-]{13,}$/i.test(id)) return true;
    if (/^(ember|react|mui|rc|radix|headless|css|auto|uid|field|input)[-_]?\d+/i.test(id)) return true;
    if (/^:r[0-9a-z]+:$/i.test(id)) return true;
    if (/\d{4,}/.test(id)) return true;
    return false;
  }

  function looksSensitive(value) {
    const text = String(value || '');
    if (/bearer\s+\S+/i.test(text)) return true;
    if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(text)) return true;
    return false;
  }

  function isTextField(element) {
    const tag = element.tagName.toLowerCase();
    return tag === 'textarea' || tag === 'input';
  }

  function stableAnchor(element, doc) {
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
      const value = element.getAttribute(attr);
      if (!value) continue;
      const css = `[${attr}="${cssEscapeAttr(value)}"]`;
      if (doc.querySelectorAll(css).length === 1) return css;
    }
    if (element.id && !isDynamicId(element.id)) {
      const css = `#${cssEscapeIdent(element.id)}`;
      try {
        if (doc.querySelectorAll(css).length === 1) return css;
      } catch (error) {
        return '';
      }
    }
    return '';
  }

  function selfPart(element) {
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
      const value = element.getAttribute(attr);
      if (value) return `[${attr}="${cssEscapeAttr(value)}"]`;
    }
    const aria = element.getAttribute('aria-label');
    if (aria) return `[aria-label="${cssEscapeAttr(aria)}"]`;
    const name = element.getAttribute('name');
    if (name) return `[name="${cssEscapeAttr(name)}"]`;
    const placeholder = element.getAttribute('placeholder');
    if (placeholder && isTextField(element)) return `[placeholder="${cssEscapeAttr(placeholder)}"]`;
    return element.tagName.toLowerCase();
  }

  function scopedCss(element, doc) {
    let node = element.parentElement;
    while (node && node !== doc.documentElement) {
      const anchor = stableAnchor(node, doc);
      if (anchor) {
        const css = `${anchor} ${selfPart(element)}`;
        try {
          const found = Array.from(doc.querySelectorAll(css));
          if (found.length === 1 && found[0] === element) return css;
        } catch (error) {
          // The scoped selector is invalid. Keep looking.
        }
      }
      node = node.parentElement;
    }
    return '';
  }

  function containerContext(element, doc) {
    let node = element.parentElement;
    while (node && node !== doc.documentElement) {
      const anchor = stableAnchor(node, doc);
      if (anchor) return anchor.slice(0, 120);
      node = node.parentElement;
    }
    return '';
  }

  function fingerprintOf(element, doc) {
    const owner = doc || element.ownerDocument;
    const tag = element.tagName.toLowerCase();
    const role = element.getAttribute('role') || implicitRole(element);
    const name = accessibleName(element).slice(0, 80);
    const attrs = {};
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
      const value = element.getAttribute(attr);
      if (value && value.length <= 80 && !looksSensitive(value)) {
        attrs.testid = value;
        break;
      }
    }
    if (element.id && !isDynamicId(element.id) && !looksSensitive(element.id)) attrs.id = element.id.slice(0, 80);
    const fieldName = element.getAttribute('name');
    if (fieldName && fieldName.length <= 80 && !looksSensitive(fieldName)) attrs.name = fieldName;
    const placeholder = element.getAttribute('placeholder');
    if (placeholder && isTextField(element) && placeholder.length <= 80 && !looksSensitive(placeholder)) attrs.placeholder = placeholder;
    const label = associatedLabel(element);
    if (label && !looksSensitive(label)) attrs.label = label.slice(0, 80);
    const fingerprint = { tag };
    if (role) fingerprint.role = role;
    if (name && !looksSensitive(name)) fingerprint.name = name;
    if (Object.keys(attrs).length) fingerprint.attrs = attrs;
    const context = owner ? containerContext(element, owner) : '';
    if (context) fingerprint.context = context;
    return fingerprint;
  }

  function explanationFor(candidate) {
    if (!candidate.unique) {
      return `Matched ${candidate.matchCount} elements, so this locator is not used as the primary.`;
    }
    if (candidate.tier === 'verified-contract' && candidate.strategy === 'role') {
      return 'Verified unique by role and accessible name in the page. This is not a Playwright getByRole check.';
    }
    if (candidate.tier === 'verified-contract' && candidate.strategy === 'label') {
      return 'Verified unique by the associated label text.';
    }
    if (candidate.tier === 'verified-contract') {
      return `Verified unique ${candidate.attr || 'data-testid'} on one element.`;
    }
    if (candidate.tier === 'verified-attribute') {
      return `Verified unique ${candidate.strategy} on one element.`;
    }
    if (candidate.tier === 'verified-scoped') {
      return 'Verified unique inside a stable parent. It depends on that container staying in place.';
    }
    return 'No stable selector was unique. This structural path depends on DOM order.';
  }

  function decorateCandidate(raw, element, doc, uniqueCss) {
    const probe = { strategy: raw.strategy, value: raw.value };
    if (raw.attr) probe.attr = raw.attr;
    if (raw.name) probe.name = raw.name;
    if (raw.tag) probe.tag = raw.tag;
    if (raw.strategy !== 'css') probe.uniqueCss = uniqueCss;
    const found = queryAll(doc, probe);
    if (!found.includes(element)) return null;
    const record = {
      strategy: raw.strategy,
      value: raw.value,
      matchCount: found.length,
      unique: found.length === 1,
      verified: raw.verified || 'dom',
      tier: raw.tier,
      rank: raw.rank,
    };
    if (raw.attr) record.attr = raw.attr;
    if (raw.name) record.name = raw.name;
    if (raw.tag) record.tag = raw.tag;
    record.explanation = explanationFor(record);
    return record;
  }

  function sameLocator(left, right) {
    if (!left || !right) return false;
    return left.strategy === right.strategy
      && String(left.value || '') === String(right.value || '')
      && String(left.name || '') === String(right.name || '')
      && String(left.attr || '') === String(right.attr || '');
  }

  function fingerprintCompatible(stored, live) {
    if (!stored) return { ok: true, reason: 'No fingerprint was stored.' };
    if (stored.tag && live.tag && stored.tag !== live.tag) {
      return { ok: false, reason: `Tag changed from ${stored.tag} to ${live.tag}.` };
    }
    if (stored.role && live.role && stored.role !== live.role) {
      return { ok: false, reason: `Role changed from ${stored.role} to ${live.role}.` };
    }
    if (stored.name && live.name && stored.name !== live.name) {
      return { ok: false, reason: 'Accessible name does not match the recorded element.' };
    }
    return { ok: true, reason: 'Tag, role, and accessible name still match.' };
  }

  function suggestRepairs(selector, doc) {
    const primary = queryAll(doc, selector);
    const suggestions = [];
    const list = Array.isArray(selector && selector.candidates) ? selector.candidates : [];
    list.filter((candidate) => !sameLocator(candidate, selector)).forEach((candidate) => {
      if (suggestions.length >= 6) return;
      let found = [];
      try {
        found = queryAll(doc, candidate);
      } catch (error) {
        found = [];
      }
      const compact = {
        strategy: candidate.strategy,
        value: candidate.value,
        tier: candidate.tier,
        rank: candidate.rank,
        verified: candidate.verified,
      };
      if (candidate.attr) compact.attr = candidate.attr;
      if (candidate.name) compact.name = candidate.name;
      if (candidate.tag) compact.tag = candidate.tag;
      if (found.length !== 1) {
        suggestions.push({
          ...compact,
          unique: false,
          matchCount: found.length,
          status: 'unsafe',
          reason: found.length === 0
            ? 'This backup matches nothing on the page.'
            : `This backup matches ${found.length} elements. It will not be clicked.`,
        });
        return;
      }
      const check = fingerprintCompatible(selector.fingerprint, fingerprintOf(found[0], doc));
      suggestions.push({
        ...compact,
        unique: true,
        matchCount: 1,
        status: check.ok ? 'safe' : 'unsafe',
        reason: check.ok
          ? `Unique match. ${check.reason} Approve it to replace the primary locator. The failed result stays failed until you rerun.`
          : check.reason,
      });
    });
    return { primaryCount: primary.length, suggestions };
  }

  function applyCandidate(selector, candidate) {
    if (!selector || !candidate || candidate.unique === false || candidate.status === 'unsafe') return selector;
    const next = {
      ...selector,
      strategy: candidate.strategy,
      value: candidate.value,
      ambiguous: false,
      fragile: candidate.tier === 'structural',
      verified: candidate.verified || 'dom',
      tier: candidate.tier,
      rank: candidate.rank,
      explanation: candidate.explanation || candidate.reason || '',
      selected: true,
    };
    if (candidate.attr) next.attr = candidate.attr;
    else delete next.attr;
    if (candidate.name) next.name = candidate.name;
    else delete next.name;
    if (candidate.tag) next.tag = candidate.tag;
    if (Number.isFinite(candidate.matchCount)) next.matchCount = candidate.matchCount;
    next.warning = candidate.tier === 'structural'
      ? 'No stable selector was unique. Using a structural CSS path. Verify it before relying on this step.'
      : '';
    if (!next.warning) delete next.warning;
    return next;
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
    const tag = element.tagName.toLowerCase();
    const raw = [];
    for (const attr of ['data-testid', 'data-test', 'data-cy', 'data-qa']) {
      const value = element.getAttribute(attr);
      if (value) raw.push({ strategy: 'testid', attr, value, tier: 'verified-contract', rank: 1, verified: 'dom' });
    }
    const explicit = element.getAttribute('role');
    const role = explicit || implicitRole(element);
    const accessible = accessibleName(element);
    if (role && accessible && accessible.length <= 80 && !looksSensitive(accessible)) {
      raw.push({
        strategy: 'role',
        value: role,
        name: accessible,
        tag,
        explicit: !!explicit,
        tier: 'verified-contract',
        rank: 1,
        verified: 'accessibility',
      });
    }
    const label = associatedLabel(element);
    if (label && label.length <= 80 && !looksSensitive(label)) {
      raw.push({ strategy: 'label', value: label, tier: 'verified-contract', rank: 1, verified: 'dom' });
    }
    if (element.id && !isDynamicId(element.id)) {
      raw.push({ strategy: 'id', value: element.id, tier: 'verified-attribute', rank: 2, verified: 'dom' });
    }
    const inputType = (element.getAttribute('type') || '').toLowerCase();
    const inputValue = element.getAttribute('value');
    if (element.getAttribute('name') && inputValue && (inputType === 'radio' || inputType === 'checkbox') && !looksSensitive(inputValue)) {
      raw.push({
        strategy: 'css',
        value: `${tag}[name="${cssEscapeAttr(element.getAttribute('name'))}"][value="${cssEscapeAttr(inputValue)}"]`,
        tier: 'verified-attribute',
        rank: 2,
        verified: 'dom',
      });
    } else if (element.getAttribute('name')) {
      raw.push({ strategy: 'name', value: element.getAttribute('name'), tier: 'verified-attribute', rank: 2, verified: 'dom' });
    }
    const aria = element.getAttribute('aria-label');
    if (aria && !looksSensitive(aria)) {
      raw.push({ strategy: 'ariaLabel', value: aria, tier: 'verified-attribute', rank: 2, verified: 'dom' });
    }
    const placeholder = element.getAttribute('placeholder');
    if (placeholder && isTextField(element) && placeholder.length <= 80 && !looksSensitive(placeholder)) {
      raw.push({ strategy: 'placeholder', value: placeholder, tier: 'verified-attribute', rank: 2, verified: 'dom' });
    }
    const scoped = scopedCss(element, owner);
    if (scoped) {
      raw.push({ strategy: 'css', value: scoped, tier: 'verified-scoped', rank: 3, verified: 'dom' });
    }
    const text = elementText(element);
    if (text && text.length <= 60 && !looksSensitive(text) && ['button', 'a', 'label', 'summary', 'h1', 'h2', 'h3', 'h4'].includes(tag)) {
      raw.push({ strategy: 'text', value: text, tag, exact: true, tier: 'verified-attribute', rank: 2, verified: 'dom' });
    }
    raw.push({ strategy: 'css', value: uniqueCss, tier: 'structural', rank: 4, verified: 'dom' });

    const verified = raw.map((candidate) => decorateCandidate(candidate, element, owner, uniqueCss)).filter(Boolean);
    const ranked = verified
      .map((candidate, index) => ({ candidate, index }))
      .sort((left, right) => left.candidate.rank - right.candidate.rank || left.index - right.index)
      .map((item) => item.candidate);
    const chosen = ranked.find((candidate) => candidate.unique) || ranked[ranked.length - 1] || {
      strategy: 'css',
      value: uniqueCss,
      matchCount: 0,
      unique: false,
      verified: 'dom',
      tier: 'structural',
      rank: 4,
      explanation: 'No stable selector was unique. This structural path depends on DOM order.',
    };
    const structural = verified.find((candidate) => candidate.tier === 'structural') || chosen;
    const kept = [];
    [...ranked.filter((candidate) => candidate.unique), ...ranked.filter((candidate) => !candidate.unique)].forEach((candidate) => {
      if (kept.length >= 8) return;
      kept.push(candidate);
    });
    const fallbackCount = structural ? structural.matchCount : 0;
    const described = {
      strategy: chosen.strategy,
      value: chosen.value,
      uniqueCss,
      matchCount: chosen.matchCount,
      ambiguous: !chosen.unique,
      fragile: chosen.tier === 'structural',
      verified: chosen.verified,
      tier: chosen.tier,
      rank: chosen.rank,
      explanation: chosen.explanation,
      fingerprint: fingerprintOf(element, owner),
      candidates: kept,
    };
    if (chosen.attr) described.attr = chosen.attr;
    if (chosen.name) described.name = chosen.name;
    if (chosen.tag) described.tag = chosen.tag;
    if (chosen.explicit) described.explicit = true;
    if (chosen.exact === false) described.exact = false;
    if (!chosen.unique) {
      described.warning = fallbackCount === 1
        ? 'No stable selector was unique. Using a structural CSS path. Verify it before relying on this step.'
        : `Selector matched ${fallbackCount} elements. Refine it before running this step.`;
    } else if (chosen.tier === 'structural') {
      described.warning = 'No stable selector was unique. Using a structural CSS path. Verify it before relying on this step.';
    } else {
      described.warning = '';
    }
    return described;
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
    fingerprintOf,
    suggestRepairs,
    applyCandidate,
    isDynamicId,
  };
  root.ASG = root.ASG || {};
  Object.assign(root.ASG, api);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
