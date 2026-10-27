(function () {
  'use strict';

  if (globalThis.__XENO_LENS_V7__) return;
  globalThis.__XENO_LENS_V7__ = true;

  const MIN_TOKENS = 8;
  const MIN_SENTENCE_TOKENS = 4;
  const LINK_DENSITY_CEILING = 0.65;
  const MAX_CARDS = 40;
  const SPECIMEN_CHARS = 8000;
  const SKIP_TAGS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'INPUT',
    'TEXTAREA', 'SELECT', 'BUTTON', 'NAV', 'HEADER', 'FOOTER', 'FORM', 'CODE',
    'PRE', 'KBD', 'SAMP', 'OPTION', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'TABLE'
  ]);

  const state = {
    active: false,
    applying: false,
    viewMode: 'annotate',
    probeEnabled: false,
    canProbe: false,
    provider: 'gemini',
    maxProbes: 8,
    enableByDefault: false,
    probesSent: 0,
    cards: 0
  };

  const pageSession = crypto.randomUUID();
  const model = new UnigramModel();
  const processed = new WeakSet();
  const attempts = new WeakMap();
  const priorDisplay = new WeakMap();
  const records = [];
  const probeCache = new Map();
  const segmenterCache = new Map();
  const mountQueue = [];
  let mountScheduled = false;
  let barHost = null;
  let barShadow = null;
  let candidateObserver = null;
  let mutationObserver = null;
  let barObserver = null;
  let sheet = null;

  class UnigramModel {
    constructor(maxTypes = 80000) {
      this.counts = new Map();
      this.total = 0;
      this.maxTypes = maxTypes;
      this.alpha = 1;
    }
    probability(token) {
      const count = this.counts.get(token) || 0;
      return (count + this.alpha) / (this.total + this.alpha * (this.counts.size + 1));
    }
    surprisal(token) {
      return -Math.log2(this.probability(token));
    }
    observe(tokens) {
      for (const token of tokens) {
        if (!this.counts.has(token) && this.counts.size >= this.maxTypes) continue;
        this.counts.set(token, (this.counts.get(token) || 0) + 1);
        this.total += 1;
      }
    }
    get warm() {
      return this.total >= 40;
    }
  }

  function leaveOneOut(tokens) {
    const counts = new Map();
    for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
    const denom = (tokens.length - 1) + (counts.size + 1);
    return tokens.map((token) => ({
      token,
      bits: -Math.log2((counts.get(token) - 1 + 1) / denom)
    }));
  }

  function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  function segmentersFor(lang) {
    const key = lang || 'und';
    const cached = segmenterCache.get(key);
    if (cached) return cached;
    let created;
    try {
      created = {
        word: new Intl.Segmenter(key, { granularity: 'word' }),
        sentence: new Intl.Segmenter(key, { granularity: 'sentence' })
      };
    } catch {
      created = segmenterCache.get('en') || {
        word: new Intl.Segmenter('en', { granularity: 'word' }),
        sentence: new Intl.Segmenter('en', { granularity: 'sentence' })
      };
    }
    segmenterCache.set(key, created);
    return created;
  }

  function tokenize(text, wordSegmenter) {
    const locale = wordSegmenter.resolvedOptions().locale;
    const tokens = [];
    for (const part of wordSegmenter.segment(text)) {
      if (!part.isWordLike) continue;
      const token = part.segment.toLocaleLowerCase(locale);
      if (token) tokens.push(token);
    }
    return tokens;
  }

  function normalize(text) {
    return text.replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim();
  }

  function analyze(text) {
    const lang = document.documentElement.lang || navigator.language || 'en';
    const segmenters = segmentersFor(lang);
    const clean = normalize(text);
    const tokens = tokenize(clean, segmenters.word);
    if (tokens.length < MIN_TOKENS) return null;
    const scored = model.warm
      ? tokens.map((token) => ({ token, bits: model.surprisal(token) }))
      : leaveOneOut(tokens);
    const bits = scored.map((item) => item.bits);
    const mid = median(bits);
    const seen = new Set();
    const salient = [];
    scored.forEach((item, index) => {
      if (item.bits < mid || seen.has(item.token)) return;
      seen.add(item.token);
      salient.push({ token: item.token, bits: item.bits, index });
    });
    salient.sort((a, b) => b.bits - a.bits || a.index - b.index);
    let primary = '';
    let best = -Infinity;
    let bestLength = -1;
    for (const part of segmenters.sentence.segment(clean)) {
      const sentence = part.segment.trim();
      const sentenceTokens = tokenize(sentence, segmenters.word);
      if (sentenceTokens.length < MIN_SENTENCE_TOKENS) continue;
      const mean = sentenceTokens.reduce((sum, token) => {
        return sum + (model.warm ? model.surprisal(token) : leaveOneOut(sentenceTokens).find((item) => item.token === token).bits);
      }, 0) / sentenceTokens.length;
      if (mean > best || (mean === best && sentenceTokens.length > bestLength)) {
        best = mean;
        bestLength = sentenceTokens.length;
        primary = sentence;
      }
    }
    const meanBits = bits.reduce((sum, value) => sum + value, 0) / bits.length;
    return {
      tokens,
      tokenCount: tokens.length,
      typeTokenRatio: new Set(tokens).size / tokens.length,
      meanBits,
      primaryClause: primary || clean,
      salientTerms: salient.slice(0, 8).map((item) => item.token),
      estimator: model.warm ? 'background' : 'leave-one-out',
      segmenters
    };
  }

  function structurallyEligible(el) {
    if (!el || el.nodeType !== Node.ELEMENT_NODE || processed.has(el)) return false;
    if (el.classList?.contains('xeno-lens-host')) return false;
    if (SKIP_TAGS.has(el.tagName)) return false;
    if (el.isContentEditable) return false;
    if (el.closest('nav, header, footer, form, pre, code, button, select, textarea, table, svg, [role="navigation"], [role="banner"], [role="contentinfo"], [role="menu"]')) {
      return false;
    }
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (role === 'navigation' || role === 'banner' || role === 'contentinfo' || role === 'menu' || role === 'search') {
      return false;
    }
    const rough = el.textContent || '';
    if (rough.trim().length < 40 || rough.length > 100000) return false;
    return true;
  }

  function deepest(nodes) {
    const set = new Set(nodes);
    const ancestors = new Set();
    for (const node of nodes) {
      let parent = node.parentElement;
      while (parent) {
        if (set.has(parent)) ancestors.add(parent);
        parent = parent.parentElement;
      }
    }
    return nodes.filter((node) => !ancestors.has(node));
  }

  function linkDensity(el) {
    const text = el.innerText || '';
    if (!text.length) return 1;
    let linked = 0;
    for (const anchor of el.querySelectorAll('a')) linked += (anchor.innerText || '').length;
    return Math.min(1, linked / text.length);
  }

  function insertionAnchor(el) {
    let node = el;
    while (node.parentElement && node.parentElement !== document.body && node.parentElement !== document.documentElement) {
      const display = getComputedStyle(node).display;
      if (display === 'block' || display === 'flex' || display === 'grid' || display === 'list-item') return node;
      node = node.parentElement;
    }
    return el;
  }

  function clipAtSentence(text, segmenter) {
    if (text.length <= SPECIMEN_CHARS) return text;
    let end = 0;
    for (const part of segmenter.segment(text)) {
      if (end + part.segment.length > SPECIMEN_CHARS) break;
      end += part.segment.length;
    }
    return (end >= 240 ? text.slice(0, end) : text.slice(0, SPECIMEN_CHARS)).trim();
  }

  function styles() {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(`
        :host { all: initial; }
        .bar, .card, button { font-family: ui-sans-serif, system-ui, sans-serif; color: #f8fafc; }
        .bar { display: flex; gap: 6px; align-items: center; background: #0b1120; color: #f8fafc; border: 1px solid #38bdf8; border-radius: 999px; padding: 6px 8px; box-shadow: 0 8px 24px #0006; }
        button { all: unset; cursor: pointer; box-sizing: border-box; min-height: 28px; padding: 4px 8px; border-radius: 999px; font: 700 11px/1 ui-monospace, monospace; color: #e2e8f0; }
        button:focus-visible { outline: 2px solid #38bdf8; outline-offset: 2px; }
        .on { color: #34d399; }
        .card { display: block; background: #0b1120; border-left: 3px solid #38bdf8; border-radius: 8px; padding: 10px 12px; box-shadow: 0 4px 14px #00000047; overflow-wrap: anywhere; }
        .row { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
        .badge { font: 800 10px/1.3 ui-monospace, monospace; letter-spacing: .04em; color: #38bdf8; text-transform: uppercase; }
        .meta { font: 10px/1.3 ui-monospace, monospace; color: #64748b; white-space: nowrap; }
        p { margin: 6px 0 0; font-size: 13px; line-height: 1.45; color: #f8fafc; }
        .sub { color: #94a3b8; font-size: 12px; }
        .err { color: #fb7185; }
      `);
    }
    return sheet;
  }

  function lockHost(host, fixed) {
    const style = host.style;
    style.setProperty('all', 'initial', 'important');
    style.setProperty('display', 'block', 'important');
    style.setProperty('margin', fixed ? '0' : '8px 0', 'important');
    style.setProperty('padding', '0', 'important');
    style.setProperty('border', 'none', 'important');
    style.setProperty('float', 'none', 'important');
    style.setProperty('clear', 'none', 'important');
    style.setProperty('width', 'auto', 'important');
    style.setProperty('max-width', '100%', 'important');
    style.setProperty('pointer-events', 'auto', 'important');
    style.setProperty('position', fixed ? 'fixed' : 'static', 'important');
    if (fixed) {
      style.setProperty('right', '16px', 'important');
      style.setProperty('bottom', '16px', 'important');
      style.setProperty('z-index', '2147483647', 'important');
    }
  }

  function stopPageEvents(host) {
    for (const type of ['click', 'mousedown', 'pointerdown', 'keydown', 'keyup']) {
      host.addEventListener(type, (event) => event.stopPropagation(), true);
    }
  }

  function buildBar() {
    barHost = document.createElement('div');
    barHost.className = 'xeno-lens-host';
    lockHost(barHost, true);
    stopPageEvents(barHost);
    barShadow = barHost.attachShadow({ mode: 'closed' });
    barShadow.adoptedStyleSheets = [styles()];
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Xeno-Lens');
    const toggleBtn = document.createElement('button');
    toggleBtn.type = 'button';
    toggleBtn.className = 'on';
    toggleBtn.textContent = 'XENO ON';
    const modeBtn = document.createElement('button');
    modeBtn.type = 'button';
    modeBtn.id = 'mode';
    const count = document.createElement('span');
    count.className = 'meta';
    count.id = 'count';
    toggleBtn.addEventListener('click', () => { toggle(); });
    modeBtn.addEventListener('click', () => {
      chrome.storage.local.set({ viewMode: state.viewMode === 'replace' ? 'annotate' : 'replace' });
    });
    bar.append(toggleBtn, modeBtn, count);
    barShadow.append(bar);
    paintBar();
  }

  function paintBar() {
    if (!barShadow) return;
    const modeBtn = barShadow.getElementById('mode');
    const count = barShadow.getElementById('count');
    if (modeBtn) modeBtn.textContent = state.viewMode === 'replace' ? 'REPLACE' : 'ANNOTATE';
    if (count) count.textContent = `${state.cards} · ${state.provider}`;
  }

  function conceal(el) {
    if (state.viewMode !== 'replace' || !el || el === document.body) return;
    if (!priorDisplay.has(el)) priorDisplay.set(el, el.style.display);
    el.style.setProperty('display', 'none', 'important');
  }

  function reveal(el) {
    if (!el || !priorDisplay.has(el)) return;
    el.style.removeProperty('display');
    const prior = priorDisplay.get(el);
    if (prior) el.style.display = prior;
    priorDisplay.delete(el);
  }

  function applyViewMode(mode) {
    state.viewMode = mode === 'replace' ? 'replace' : 'annotate';
    for (const record of records) {
      if (state.viewMode === 'replace') conceal(record.anchor);
      else reveal(record.anchor);
    }
    paintBar();
  }

  function mount(el) {
    if (!state.active || processed.has(el) || !el.isConnected || state.cards >= MAX_CARDS) return;
    const seen = (attempts.get(el) || 0) + 1;
    attempts.set(el, seen);
    if (!structurallyEligible(el)) return;
    if (!el.getClientRects().length) return;
    const raw = normalize(el.innerText || '');
    if (linkDensity(el) > LINK_DENSITY_CEILING) {
      processed.add(el);
      return;
    }
    const stats = analyze(raw);
    if (!stats) {
      if (seen > 2) processed.add(el);
      return;
    }
    const anchor = insertionAnchor(el);
    if (!anchor.parentNode) return;
    processed.add(el);
    model.observe(stats.tokens);
    state.applying = true;
    try {
      const host = document.createElement('div');
      host.className = 'xeno-lens-host';
      lockHost(host, false);
      const shadow = host.attachShadow({ mode: 'closed' });
      shadow.adoptedStyleSheets = [styles()];
      const card = document.createElement('article');
      card.className = 'card';
      card.setAttribute('role', 'note');
      const row = document.createElement('div');
      row.className = 'row';
      const badge = document.createElement('span');
      badge.className = 'badge';
      badge.textContent = `LOCAL ${stats.estimator}`;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `N=${stats.tokenCount} TTR=${stats.typeTokenRatio.toFixed(2)} H=${stats.meanBits.toFixed(2)}b`;
      const clause = document.createElement('p');
      clause.textContent = clipDisplay(stats.primaryClause, 420);
      const terms = document.createElement('p');
      terms.className = 'sub';
      terms.textContent = stats.salientTerms.length ? `Salient: ${stats.salientTerms.join(' · ')}` : 'Salient: none';
      const claim = document.createElement('p');
      claim.hidden = true;
      const motive = document.createElement('p');
      motive.className = 'sub';
      motive.hidden = true;
      row.append(badge, meta);
      card.append(row, clause, terms, claim, motive);
      shadow.append(card);
      anchor.parentNode.insertBefore(host, anchor.nextSibling);
      const record = { el, anchor, host, badge, claim, motive, raw, segmenters: stats.segmenters, probed: false };
      records.push(record);
      state.cards += 1;
      conceal(anchor);
      paintBar();
      if (candidateObserver) candidateObserver.observe(host);
    } finally {
      state.applying = false;
    }
  }

  function clipDisplay(text, max) {
    return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
  }

  function queueMount(el) {
    mountQueue.push(el);
    if (mountScheduled) return;
    mountScheduled = true;
    requestAnimationFrame(drainMounts);
  }

  function drainMounts() {
    mountScheduled = false;
    let budget = 4;
    while (mountQueue.length && budget > 0) {
      budget -= 1;
      const el = mountQueue.shift();
      try { mount(el); } catch (err) { console.error('[xeno-lens] mount failed'); }
    }
    if (mountQueue.length) {
      mountScheduled = true;
      requestAnimationFrame(drainMounts);
    }
  }

  async function probe(record) {
    if (record.probed || !state.active || !state.probeEnabled) return;
    record.probed = true;
    if (!state.canProbe) {
      record.badge.textContent = 'KEY REQUIRED';
      record.badge.classList.add('err');
      return;
    }
    if (state.probesSent >= state.maxProbes) {
      record.badge.textContent = 'PROBE CAP';
      return;
    }
    state.probesSent += 1;
    const specimen = clipAtSentence(record.raw, record.segmenters.sentence);
    record.badge.textContent = `PROBING ${state.provider}`;
    const cached = probeCache.get(specimen);
    const response = cached || await send({ type: 'XENO_EXECUTE_PROBE', text: specimen, pageSession });
    if (!cached && response?.ok) {
      probeCache.set(specimen, response);
      if (probeCache.size > 100) probeCache.delete(probeCache.keys().next().value);
    }
    if (!record.host.isConnected || !state.active) return;
    if (response?.ok && response.telemetry) {
      const telemetry = response.telemetry;
      record.badge.classList.remove('err');
      record.badge.textContent = `${telemetry.archetype} · ${telemetry.confidence.toFixed(2)} · ${response.modelUsed}`;
      record.claim.hidden = false;
      record.claim.textContent = telemetry.claim;
      record.motive.hidden = false;
      record.motive.textContent = telemetry.motive;
      return;
    }
    record.badge.classList.add('err');
    record.badge.textContent = clipDisplay(response?.error || 'PROBE FAILED', 80);
  }

  function scanRoot(root, depth) {
    if (!root || depth > 3 || state.cards >= MAX_CARDS) return;
    const candidates = [];
    const shadows = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode(node) {
        if (node.classList?.contains('xeno-lens-host')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node = walker.nextNode();
    while (node) {
      if (node.shadowRoot) shadows.push(node.shadowRoot);
      if (structurallyEligible(node)) candidates.push(node);
      node = walker.nextNode();
    }
    for (const leaf of deepest(candidates)) {
      if (candidateObserver && leaf.getClientRects().length) candidateObserver.observe(leaf);
    }
    for (const shadow of shadows) scanRoot(shadow, depth + 1);
  }

  function startObservers() {
    candidateObserver = new IntersectionObserver((entries) => {
      if (!state.active) return;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        candidateObserver.unobserve(entry.target);
        if (entry.target.classList.contains('xeno-lens-host')) {
          const record = records.find((item) => item.host === entry.target);
          if (record) probe(record);
        } else {
          queueMount(entry.target);
        }
      }
    }, { root: null, rootMargin: '500px 0px', threshold: 0 });

    mutationObserver = new MutationObserver((mutations) => {
      if (!state.active || state.applying) return;
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== Node.ELEMENT_NODE) continue;
          if (node.classList?.contains('xeno-lens-host')) continue;
          scanRoot(node, 0);
        }
      }
    });
    if (document.body) mutationObserver.observe(document.body, { childList: true, subtree: true });

    barObserver = new MutationObserver(() => {
      if (state.active && barHost && !barHost.isConnected) document.documentElement.append(barHost);
    });
    barObserver.observe(document.documentElement, { childList: true });
  }

  function stopObservers() {
    candidateObserver?.disconnect();
    mutationObserver?.disconnect();
    barObserver?.disconnect();
    candidateObserver = null;
    mutationObserver = null;
    barObserver = null;
    mountQueue.length = 0;
  }

  async function activate() {
    if (state.active) return;
    state.active = true;
    if (!barHost) buildBar();
    if (!barHost.isConnected) document.documentElement.append(barHost);
    barHost.hidden = false;
    startObservers();
    if (document.body) scanRoot(document.body, 0);
    syncBadge(true);
    paintBar();
  }

  function deactivate() {
    state.active = false;
    stopObservers();
    send({ type: 'XENO_CANCEL' });
    for (const record of records) {
      reveal(record.anchor);
      record.host.hidden = true;
    }
    if (barHost) barHost.hidden = true;
    syncBadge(false);
  }

  let toggleLock = false;
  async function toggle() {
    if (toggleLock) return;
    toggleLock = true;
    try {
      if (state.active) deactivate();
      else await activate();
    } finally {
      toggleLock = false;
    }
  }

  function applyConfig(config) {
    if (!config) return;
    state.provider = config.provider || state.provider;
    state.probeEnabled = Boolean(config.probeEnabled);
    state.canProbe = Boolean(config.canProbe);
    state.maxProbes = clamp(config.maxProbesPerPage, 1, 30, 8);
    state.enableByDefault = Boolean(config.enableByDefault);
    applyViewMode(config.viewMode);
    if (!state.probeEnabled) send({ type: 'XENO_CANCEL' });
  }

  function clamp(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(n)));
  }

  function send(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
        else resolve(response || { ok: false, error: 'EMPTY_RESPONSE' });
      });
    });
  }

  function syncBadge(on) {
    send({ type: 'XENO_BADGE', on: Boolean(on) });
  }

  function purgeLegacyPageStorage() {
    try {
      for (const key of ['xeno_api_key', 'xeno_provider', 'xeno_model', 'xeno_view_mode', 'xeno_gemini_api_key']) {
        localStorage.removeItem(key);
      }
    } catch { /* storage access can throw */ }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'XENO_TOGGLE') {
      toggle().then(() => sendResponse({ ok: true, active: state.active })).catch(() => sendResponse({ ok: false }));
      return true;
    }
    if (msg.type === 'XENO_STATUS') {
      sendResponse({ ok: true, active: state.active, cards: state.cards, probes: state.probesSent });
      return;
    }
    if (msg.type === 'XENO_CONFIG') {
      applyConfig(msg.config);
      sendResponse({ ok: true });
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !changes.viewMode) return;
    applyViewMode(changes.viewMode.newValue);
  });

  purgeLegacyPageStorage();

  send({ type: 'XENO_GET_CONFIG' }).then((response) => {
    if (response?.ok) applyConfig(response.config);
    syncBadge(false);
    if (state.enableByDefault) activate();
  });
})();
