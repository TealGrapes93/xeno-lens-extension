/**
 * Xeno-Lens Epistemic Telemetry Engine — Content Script v7.0
 *
 * Mathematical & Systems Foundations:
 * 1. Tokenization & Segmentation: Native Unicode `Intl.Segmenter` (granularity: 'word' & 'sentence').
 * 2. Surprisal & Entropy: Laplace-smoothed self-information I(w) = -log2((c(w) + α) / (N + α|V|)),
 *    Shannon Entropy H(X) in bits/token, and Yule's K lexical characteristic.
 * 3. Extractive Proposition Synthesis: Graph-based Submodular Sentence Centrality (TextRank + BM25-weighted
 *    Information Gain with redundancy penalization).
 * 4. DOM Block Discovery: Bottom-up text-node density clustering with Text-to-Tag Ratio (TTR) and
 *    Link-Character Density filtering—zero brittle site selectors or layout thrashing.
 * 5. UI Isolation: Closed Shadow DOM encapsulation for all telemetry cards and HUD controls.
 */

(function () {
  'use strict';

  if (window.__XENO_ENGINE_V7__) return;
  window.__XENO_ENGINE_V7__ = true;

  // ============================================================================
  // 1. INFORMATION-THEORETIC STATISTICAL NLP ENGINE
  // ============================================================================
  class InformationTheoreticCorpus {
    constructor() {
      this.docCount = 0;
      this.totalTerms = 0;
      this.termFreq = new Map();
      this.docFreq = new Map();

      const lang = document.documentElement.lang || navigator.language || 'en';
      this.wordSegmenter =
        typeof Intl !== 'undefined' && Intl.Segmenter
          ? new Intl.Segmenter(lang, { granularity: 'word' })
          : null;
      this.sentenceSegmenter =
        typeof Intl !== 'undefined' && Intl.Segmenter
          ? new Intl.Segmenter(lang, { granularity: 'sentence' })
          : null;
    }

    /**
     * Unicode-aware word tokenization via Intl.Segmenter
     */
    tokenize(text) {
      if (!text) return [];
      if (this.wordSegmenter) {
        const tokens = [];
        for (const seg of this.wordSegmenter.segment(text)) {
          if (seg.isWordLike) {
            const norm = seg.segment.toLowerCase();
            if (norm.length > 1 || /\p{N}/u.test(norm)) {
              tokens.push(norm);
            }
          }
        }
        return tokens;
      }
      return text.toLowerCase().match(/[\p{L}\p{N}_'-]{2,}|\p{N}+/gu) || [];
    }

    /**
     * Unicode-aware sentence segmentation via Intl.Segmenter
     */
    segmentSentences(text) {
      if (!text) return [];
      if (this.sentenceSegmenter) {
        const out = [];
        for (const seg of this.sentenceSegmenter.segment(text)) {
          const s = seg.segment.trim();
          if (s.length > 0) out.push(s);
        }
        return out;
      }
      return text
        .split(/(?<=[.!?])\s+(?=[A-Z0-9"\u201C])/g)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    /**
     * Laplace-smoothed Shannon Self-Information:
     * I(w) = -log2( (count(w) + α) / (N + α * |V|) )
     */
    tokenSurprisal(token, localTF = 0, localN = 1) {
      const alpha = 0.5;
      const vocabSize = Math.max(100, this.termFreq.size);
      const globalCount = this.termFreq.get(token) || 0;
      const prob = (globalCount + localTF + alpha) / (this.totalTerms + localN + alpha * vocabSize);
      return -Math.log2(prob);
    }

    /**
     * Smoothed Inverse Document Frequency (BM25 formulation):
     * IDF(w) = ln( 1 + (D - df(w) + 0.5) / (df(w) + 0.5) )
     */
    tokenIDF(token) {
      const df = this.docFreq.get(token) || 0;
      const D = Math.max(1, this.docCount);
      return Math.log(1 + (D - df + 0.5) / (df + 0.5));
    }

    /**
     * Updates global corpus distributions AFTER scoring a passage to prevent self-masking
     */
    ingestTokens(tokens) {
      this.docCount++;
      const uniqueInDoc = new Set();
      for (const t of tokens) {
        this.termFreq.set(t, (this.termFreq.get(t) || 0) + 1);
        this.totalTerms++;
        uniqueInDoc.add(t);
      }
      for (const t of uniqueInDoc) {
        this.docFreq.set(t, (this.docFreq.get(t) || 0) + 1);
      }
    }

    /**
     * Computes Yule's K Characteristic (length-invariant vocabulary richness metric)
     * K = 10^4 * (sum(i^2 * V_i) - N) / N^2
     */
    computeYulesK(tfMap, N) {
      if (N <= 5) return 0;
      const spectrum = new Map();
      for (const freq of tfMap.values()) {
        spectrum.set(freq, (spectrum.get(freq) || 0) + 1);
      }
      let sum = 0;
      for (const [freq, countOfFreq] of spectrum.entries()) {
        sum += freq * freq * countOfFreq;
      }
      return Math.max(0, Math.round((10000 * (sum - N)) / (N * N)));
    }

    /**
     * Full passage analysis:
     * - Computes passage Shannon Entropy H(X)
     * - Extracts salient terms via TF-Surprisal-IDF product
     * - Solves Sentence Centrality Graph (TextRank) weighted by Information Density
     */
    function analyze(text) {
  const lang = document.documentElement.lang || navigator.language || 'en';
  const segmenters = segmentersFor(lang);
  const clean = normalize(text);
  const tokens = tokenize(clean, segmenters.word);
  if (tokens.length < MIN_TOKENS) return null;

  const scored = model.warm
    ? tokens.map((token) => ({ token, bits: model.surprisal(token) }))
    : leaveOneOut(tokens);
  const bitsOf = new Map();
  for (const item of scored) {
    const prev = bitsOf.get(item.token);
    if (prev === undefined || item.bits > prev) bitsOf.set(item.token, item.bits);
  }
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

  const sentenceBits = (sentence) => {
    const sentenceTokens = tokenize(sentence, segmenters.word);
    if (sentenceTokens.length < MIN_SENTENCE_TOKENS) return null;
    const local = model.warm ? null : leaveOneOut(sentenceTokens);
    const localBits = new Map();
    if (local) for (const item of local) localBits.set(item.token, item.bits);
    let sum = 0;
    for (const token of sentenceTokens) {
      sum += model.warm ? model.surprisal(token) : localBits.get(token);
    }
    return { mean: sum / sentenceTokens.length, length: sentenceTokens.length };
  };

  let primary = '';
  let best = -Infinity;
  let bestLength = -1;
  for (const part of segmenters.sentence.segment(clean)) {
    const sentence = part.segment.trim();
    const score = sentenceBits(sentence);
    if (!score) continue;
    if (score.mean > best || (score.mean === best && score.length > bestLength)) {
      best = score.mean;
      bestLength = score.length;
      primary = sentence;
    }
  }

  return {
    tokens,
    tokenCount: tokens.length,
    typeTokenRatio: new Set(tokens).size / tokens.length,
    meanBits: bits.reduce((sum, value) => sum + value, 0) / bits.length,
    primaryClause: primary || clean,
    salientTerms: salient.slice(0, 8).map((item) => item.token),
    estimator: model.warm ? 'background' : 'leave-one-out',
    segmenters
  };
}

  // ============================================================================
  // 2. BOTTOM-UP DOM DENSITY ANALYZER (ZERO BRITTLE SELECTORS)
  // ============================================================================
  const NON_PROSE_ANCESTORS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'MATH',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'INPUT', 'TEXTAREA', 'SELECT',
    'BUTTON', 'LABEL', 'OPTION', 'OPTGROUP', 'DATALIST', 'OUTPUT',
    'AUDIO', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED', 'HEAD', 'TITLE', 'META',
    'NAV', 'FOOTER', 'HEADER', 'DIALOG', 'MENU', 'THEAD', 'TFOOT'
  ]);

  const INLINE_CONTAINERS = new Set([
    'SPAN', 'A', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'SMALL', 'SUB', 'SUP',
    'MARK', 'ABBR', 'CITE', 'DFN', 'TIME', 'FONT', 'BDI', 'BDO', 'Q', 'RUBY'
  ]);

  const processedBlocks = new WeakSet();
  const blockToCardMap = new WeakMap();
  const activeCards = new Set();

  /**
   * Finds the nearest semantic block container for a text node
   */
  function findNearestProseBlock(textNode) {
    let curr = textNode.parentElement;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.hasAttribute('data-xeno-host') || curr.isContentEditable) return null;
      if (NON_PROSE_ANCESTORS.has(curr.tagName)) return null;
      const role = curr.getAttribute('role');
      if (role && /^(navigation|banner|menubar|menu|toolbar|tablist|dialog|alertdialog|search)$/i.test(role)) {
        return null;
      }
      if (!INLINE_CONTAINERS.has(curr.tagName)) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  /**
   * Evaluates structural prose integrity using Text-to-Tag Ratio and Link-Character Density
   * without triggering layout reflows until final candidate verification.
   */
  function evaluateBlockMetrics(el) {
    if (!el || processedBlocks.has(el)) return null;

    // Ensure no ancestor or descendant is already processed
    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (processedBlocks.has(parent)) return null;
      parent = parent.parentElement;
    }

    // Reject blocks that contain other distinct structural prose blocks (prefer leaf prose blocks)
    const childBlocks = el.querySelectorAll('p, article, section, blockquote, li, dd, td');
    if (childBlocks.length > 0) return null;

    const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 65) return null;

    // Compute Link-Character Density (ρ_link): ratio of anchor text to total text
    const anchors = el.getElementsByTagName('a');
    let anchorChars = 0;
    for (let i = 0; i < anchors.length; i++) {
      anchorChars += (anchors[i].textContent || '').replace(/\s+/g, ' ').trim().length;
    }
    if (anchorChars / text.length > 0.42) return null;

    // Compute Text-to-Tag Density: prose blocks have high characters-per-child-element
    const descendantTagCount = el.getElementsByTagName('*').length;
    if (descendantTagCount > 0 && text.length / descendantTagCount < 14) {
      return null;
    }

    return text;
  }

  /**
   * Collects candidate leaf prose blocks inside a root using bottom-up TextNode aggregation
   */
  function discoverProseBlocks(root) {
    if (!root) return [];
    const candidateMap = new Map();

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.trim().length < 20) {
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let textNode;
    while ((textNode = walker.nextNode())) {
      const block = findNearestProseBlock(textNode);
      if (block && !processedBlocks.has(block)) {
        candidateMap.set(block, (candidateMap.get(block) || 0) + textNode.nodeValue.trim().length);
      }
    }

    // Batch read geometry in a single layout pass to eliminate layout thrashing
    const verified = [];
    for (const [block, charSum] of candidateMap.entries()) {
      if (charSum < 65) continue;
      const validText = evaluateBlockMetrics(block);
      if (!validText) continue;

      const rect = block.getBoundingClientRect();
      if (rect.width >= 140 && rect.height >= 20) {
        verified.push({ element: block, text: validText });
      }
    }

    return verified;
  }

  // ============================================================================
  // 3. SHADOW DOM TELEMETRY CARD & HUD RENDERER (XSS-PROOF & CSS-ISOLATED)
  // ============================================================================
  const CARD_STYLES = `
    :host {
      all: initial;
      display: block;
      margin: 8px 0 14px 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      line-height: 1.45;
      color: #f1f5f9;
    }
    .card {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-left: 3.5px solid #38bdf8;
      border-radius: 8px;
      padding: 10px 13px;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);
      transition: border-color 0.2s ease;
    }
    .card[data-tier="high"] { border-left-color: #34d399; }
    .card[data-tier="mid"]  { border-left-color: #38bdf8; }
    .card[data-tier="low"]  { border-left-color: #fb7185; }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
      margin-bottom: 6px;
      flex-wrap: wrap;
    }
    .badge {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 10.5px;
      font-weight: 700;
      letter-spacing: 0.04em;
      color: #38bdf8;
      text-transform: uppercase;
    }
    .card[data-tier="high"] .badge { color: #34d399; }
    .card[data-tier="low"] .badge  { color: #fb7185; }
    .metrics {
      display: flex;
      align-items: center;
      gap: 8px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 10px;
      color: #64748b;
    }
    .toggle-orig {
      all: unset;
      cursor: pointer;
      color: #94a3b8;
      background: #1e293b;
      padding: 1px 6px;
      border-radius: 4px;
      font-size: 9.5px;
    }
    .toggle-orig:hover { color: #f8fafc; background: #334155; }
    .claim {
      color: #f8fafc;
      font-size: 13px;
      font-weight: 500;
      margin-bottom: 5px;
    }
    .motive {
      color: #94a3b8;
      font-size: 11.5px;
    }
  `;

  const corpus = new InformationTheoreticCorpus();

  let state = {
    lensActive: true,
    viewMode: 'split',
    provider: 'gemini',
    model: '',
    apiKey: '',
    customEndpoint: '',
    decodedCount: 0
  };

  const viewportObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const hostEl = entry.target;
        viewportObserver.unobserve(hostEl);

        if (state.lensActive && (state.apiKey || state.provider === 'ollama')) {
          dispatchLiveProbe(hostEl);
        }
      }
    },
    { rootMargin: '240px 0px' }
  );

  function dispatchLiveProbe(hostEl) {
    const meta = blockToCardMap.get(hostEl);
    if (!meta || meta.probed) return;
    meta.probed = true;

    meta.badgeEl.textContent = `🛸 PROBING ${state.provider.toUpperCase()}...`;

    chrome.runtime.sendMessage(
      {
        type: 'XENO_EXECUTE_PROBE',
        provider: state.provider,
        model: state.model,
        text: meta.rawText
      },
      (res) => {
        if (chrome.runtime.lastError || !res) {
          meta.badgeEl.textContent = '🛸 INFORMATION-THEORETIC PROPOSITION (LOCAL)';
          return;
        }
        if (res.ok && res.telemetry) {
          const t = res.telemetry;
          const snrPct = Math.round(t.confidence * 100);
          meta.cardEl.dataset.tier = t.confidence >= 0.7 ? 'high' : t.confidence >= 0.4 ? 'mid' : 'low';
          meta.badgeEl.textContent = `🛸 ${t.archetype} · SNR ${snrPct}% [${res.modelUsed}]`;
          meta.claimEl.textContent = `Proposition: ${t.claim}`;
          meta.motiveEl.textContent = `Incentive Vector: ${t.motive}`;
        } else {
          meta.badgeEl.textContent = `🛸 STATISTICAL PROPOSITION (${res.error || 'LOCAL'})`;
        }
      }
    );
  }

  function applyElementViewState(sourceEl, hostEl) {
    if (!state.lensActive) {
      hostEl.style.display = 'none';
      sourceEl.style.display = '';
      sourceEl.style.opacity = '';
      return;
    }
    hostEl.style.display = 'block';
    if (state.viewMode === 'replace') {
      sourceEl.style.display = 'none';
      sourceEl.style.opacity = '';
    } else {
      sourceEl.style.display = '';
      sourceEl.style.opacity = '0.78';
    }
  }

  function renderTelemetryCard({ element, text }) {
    if (processedBlocks.has(element)) return;
    const stats = corpus.analyze(text);
    if (!stats) return;

    processedBlocks.add(element);

    const hostEl = document.createElement('xeno-telemetry-card');
    hostEl.setAttribute('data-xeno-host', '1');
    const shadow = hostEl.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = CARD_STYLES;

    const cardEl = document.createElement('div');
    cardEl.className = 'card';
    cardEl.dataset.tier = 'mid';

    const headerEl = document.createElement('div');
    headerEl.className = 'header';

    const badgeEl = document.createElement('span');
    badgeEl.className = 'badge';
    badgeEl.textContent = '🛸 INFORMATION-THEORETIC PROPOSITION';

    const metricsEl = document.createElement('div');
    metricsEl.className = 'metrics';

    const statSpan = document.createElement('span');
    statSpan.textContent = `N=${stats.tokenCount} · H=${stats.entropyBits}b · K=${stats.yulesK} · L=${stats.lexicalDensity}%`;

    const toggleOrigBtn = document.createElement('button');
    toggleOrigBtn.className = 'toggle-orig';
    toggleOrigBtn.textContent = 'Toggle Source';
    toggleOrigBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const isHidden = element.style.display === 'none';
      element.style.display = isHidden ? '' : 'none';
      element.style.opacity = '1';
    });

    metricsEl.append(statSpan, toggleOrigBtn);
    headerEl.append(badgeEl, metricsEl);

    const claimEl = document.createElement('div');
    claimEl.className = 'claim';
    claimEl.textContent = `Central Clause: "${stats.primaryClause}"`;

    const motiveEl = document.createElement('div');
    motiveEl.className = 'motive';
    motiveEl.textContent =
      stats.salientTerms.length > 0
        ? `High-Information Terms: ${stats.salientTerms.join(' · ')}`
        : 'Uniform lexical distribution';

    cardEl.append(headerEl, claimEl, motiveEl);
    shadow.append(styleEl, cardEl);

    blockToCardMap.set(hostEl, {
      sourceEl: element,
      hostEl,
      cardEl,
      badgeEl,
      claimEl,
      motiveEl,
      rawText: text,
      probed: false
    });
    activeCards.add(hostEl);

    applyElementViewState(element, hostEl);
    element.parentNode?.insertBefore(hostEl, element.nextSibling);
    viewportObserver.observe(hostEl);

    state.decodedCount++;
    updateHudCounters();
  }

  // ============================================================================
  // 4. TIME-SLICED COOPERATIVE SCHEDULER & MUTATION PIPELINE
  // ============================================================================
  const pendingRoots = new Set();
  let scanScheduled = false;

  function scheduleIdleScan(root = document.body) {
    if (!state.lensActive || !root) return;
    pendingRoots.add(root);
    if (scanScheduled) return;
    scanScheduled = true;

    const runner = (deadline) => {
      scanScheduled = false;
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();

      const candidates = [];
      for (const r of roots) {
        if (r.isConnected) {
          candidates.push(...discoverProseBlocks(r));
        }
      }

      let idx = 0;
      const processChunk = (dl) => {
        while (idx < candidates.length && (dl.timeRemaining() > 4 || dl.didTimeout)) {
          renderTelemetryCard(candidates[idx++]);
        }
        if (idx < candidates.length) {
          requestIdleCallback(processChunk, { timeout: 500 });
        }
      };

      if (typeof requestIdleCallback === 'function') {
        requestIdleCallback(processChunk, { timeout: 500 });
      } else {
        candidates.forEach(renderTelemetryCard);
      }
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(runner, { timeout: 400 });
    } else {
      setTimeout(() => runner({ timeRemaining: () => 10, didTimeout: true }), 32);
    }
  }

  // ============================================================================
  // 5. SHADOW DOM CONTROL HUD & SECURE CREDENTIAL CONFIGURATION
  // ============================================================================
  const HUD_STYLES = `
    :host {
      all: initial;
      position: fixed;
      bottom: 18px;
      right: 16px;
      z-index: 2147483647;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      color: #f8fafc;
    }
    .bar {
      display: flex;
      align-items: center;
      gap: 6px;
      background: #0b1120;
      border: 1.5px solid #38bdf8;
      border-radius: 999px;
      padding: 6px 11px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 700;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.8);
      user-select: none;
    }
    button.pill {
      all: unset;
      cursor: pointer;
      padding: 3px 8px;
      border-radius: 999px;
      transition: background 0.15s;
    }
    button.toggle-on { color: #34d399; }
    button.toggle-off { color: #94a3b8; }
    button.mode-btn, button.cfg-btn {
      background: #1e293b;
      color: #38bdf8;
      font-size: 10px;
    }
    button.pill:hover { background: #334155; }
    .modal {
      position: absolute;
      bottom: 44px;
      right: 0;
      width: 320px;
      background: #0b1120;
      border: 1.5px solid #38bdf8;
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.85);
      display: none;
      font-size: 12px;
    }
    .modal.open { display: block; }
    .modal-hdr {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 6px;
      border-bottom: 1px solid #1e293b;
      font-family: ui-monospace, monospace;
      font-size: 11px;
      color: #38bdf8;
      font-weight: 700;
    }
    .close-btn { all: unset; cursor: pointer; color: #94a3b8; padding: 2px 5px; }
    label {
      display: block;
      color: #94a3b8;
      font-size: 10px;
      font-weight: 600;
      margin: 8px 0 3px 0;
      text-transform: uppercase;
    }
    select, input {
      box-sizing: border-box;
      width: 100%;
      background: #020617;
      color: #f8fafc;
      border: 1px solid #334155;
      border-radius: 6px;
      padding: 6px 8px;
      font-size: 11.5px;
      font-family: ui-monospace, monospace;
    }
    .row { display: flex; gap: 6px; }
    .fetch-btn {
      all: unset;
      cursor: pointer;
      background: #1e293b;
      color: #38bdf8;
      border: 1px solid #38bdf8;
      border-radius: 6px;
      padding: 0 10px;
      font-size: 10.5px;
      font-weight: 600;
      white-space: nowrap;
    }
    .save-btn {
      all: unset;
      box-sizing: border-box;
      width: 100%;
      text-align: center;
      margin-top: 12px;
      background: #0ea5e9;
      color: #020617;
      font-weight: 700;
      border-radius: 6px;
      padding: 7px;
      cursor: pointer;
    }
  `;

  let hudRefs = null;

  function mountHud() {
    const hudHost = document.createElement('xeno-telemetry-hud');
    hudHost.setAttribute('data-xeno-host', '1');
    const shadow = hudHost.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = HUD_STYLES;

    const modal = document.createElement('div');
    modal.className = 'modal';

    const modalHdr = document.createElement('div');
    modalHdr.className = 'modal-hdr';
    const titleSpan = document.createElement('span');
    titleSpan.textContent = '🛸 MODEL REGISTRY & VAULT';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'close-btn';
    closeBtn.textContent = '✕';
    modalHdr.append(titleSpan, closeBtn);

    const provLabel = document.createElement('label');
    provLabel.textContent = 'Provider';
    const provSelect = document.createElement('select');
    for (const [val, label] of [
      ['gemini', 'Google Gemini'],
      ['openai', 'OpenAI'],
      ['anthropic', 'Anthropic Claude'],
      ['xai', 'xAI Grok'],
      ['openrouter', 'OpenRouter'],
      ['groq', 'Groq LPU'],
      ['ollama', 'Local Ollama']
    ]) {
      const opt = document.createElement('option');
      opt.value = val;
      opt.textContent = label;
      provSelect.appendChild(opt);
    }

    const keyLabel = document.createElement('label');
    keyLabel.textContent = 'API Key (Stored in Extension Vault)';
    const keyRow = document.createElement('div');
    keyRow.className = 'row';
    const keyInput = document.createElement('input');
    keyInput.type = 'password';
    keyInput.placeholder = 'sk-... / AIza...';
    const fetchBtn = document.createElement('button');
    fetchBtn.className = 'fetch-btn';
    fetchBtn.textContent = 'Query Models';
    keyRow.append(keyInput, fetchBtn);

    const modelLabel = document.createElement('label');
    modelLabel.textContent = 'Target Model';
    const modelSelect = document.createElement('select');

    const saveBtn = document.createElement('button');
    saveBtn.className = 'save-btn';
    saveBtn.textContent = 'Save to Secure Vault';

    modal.append(modalHdr, provLabel, provSelect, keyLabel, keyRow, modelLabel, modelSelect, saveBtn);

    const bar = document.createElement('div');
    bar.className = 'bar';

    const toggleBtn = document.createElement('button');
    toggleBtn.className = 'pill toggle-on';

    const modeBtn = document.createElement('button');
    modeBtn.className = 'pill mode-btn';

    const cfgBtn = document.createElement('button');
    cfgBtn.className = 'pill cfg-btn';

    bar.append(toggleBtn, modeBtn, cfgBtn);
    shadow.append(styleEl, modal, bar);
    document.documentElement.appendChild(hudHost);

    hudRefs = {
      modal,
      toggleBtn,
      modeBtn,
      cfgBtn,
      provSelect,
      keyInput,
      fetchBtn,
      modelSelect
    };

    function queryModels() {
      fetchBtn.textContent = 'Loading...';
      chrome.runtime.sendMessage(
        {
          type: 'XENO_FETCH_MODELS',
          provider: provSelect.value,
          apiKey: keyInput.value.trim()
        },
        (res) => {
          modelSelect.replaceChildren();
          if (res?.ok && Array.isArray(res.models) && res.models.length > 0) {
            fetchBtn.textContent = `✓ ${res.models.length}`;
            for (const m of res.models) {
              const opt = document.createElement('option');
              opt.value = m;
              opt.textContent = m;
              modelSelect.appendChild(opt);
            }
            if (state.model && res.models.includes(state.model)) {
              modelSelect.value = state.model;
            }
          } else {
            fetchBtn.textContent = 'Failed';
          }
        }
      );
    }

    fetchBtn.addEventListener('click', queryModels);
    provSelect.addEventListener('change', queryModels);
    closeBtn.addEventListener('click', () => modal.classList.remove('open'));

    cfgBtn.addEventListener('click', () => {
      const isOpen = modal.classList.toggle('open');
      if (isOpen) {
        provSelect.value = state.provider;
        keyInput.value = state.apiKey;
        if (state.apiKey || state.provider === 'ollama') queryModels();
      }
    });

    saveBtn.addEventListener('click', () => {
      state.provider = provSelect.value;
      state.apiKey = keyInput.value.trim();
      state.model = modelSelect.value || '';
      chrome.runtime.sendMessage(
        {
          type: 'XENO_SAVE_CONFIG',
          config: {
            provider: state.provider,
            apiKey: state.apiKey,
            model: state.model
          }
        },
        () => {
          modal.classList.remove('open');
          updateHudCounters();
          // Trigger live probes on already-rendered cards if key was just added
          if (state.apiKey || state.provider === 'ollama') {
            for (const hostEl of activeCards) {
              viewportObserver.observe(hostEl);
            }
          }
        }
      );
    });

    toggleBtn.addEventListener('click', toggleLensState);

    modeBtn.addEventListener('click', () => {
      state.viewMode = state.viewMode === 'split' ? 'replace' : 'split';
      chrome.runtime.sendMessage({
        type: 'XENO_SAVE_CONFIG',
        config: { viewMode: state.viewMode }
      });
      refreshAllCardViews();
      updateHudCounters();
    });

    updateHudCounters();
  }

  function updateHudCounters() {
    if (!hudRefs) return;
    hudRefs.toggleBtn.className = `pill ${state.lensActive ? 'toggle-on' : 'toggle-off'}`;
    hudRefs.toggleBtn.textContent = state.lensActive
      ? `🛸 XENO: ON (${state.decodedCount})`
      : `🧠 RAW (${state.decodedCount})`;
    hudRefs.modeBtn.textContent = state.viewMode === 'replace' ? 'MODE: REPLACE' : 'MODE: SPLIT';
    hudRefs.cfgBtn.textContent = `⚙️ ${state.provider.toUpperCase()}`;
  }

  function refreshAllCardViews() {
    for (const hostEl of activeCards) {
      const meta = blockToCardMap.get(hostEl);
      if (meta) {
        applyElementViewState(meta.sourceEl, hostEl);
      }
    }
  }

  function toggleLensState() {
    state.lensActive = !state.lensActive;
    chrome.runtime.sendMessage({
      type: 'XENO_SAVE_CONFIG',
      config: { lensActive: state.lensActive }
    });
    refreshAllCardViews();
    updateHudCounters();
    if (state.lensActive) {
      scheduleIdleScan(document.body);
    }
  }

  // Listen for toolbar icon toggle
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'XENO_TOGGLE_LENS') {
      toggleLensState();
    }
  });

  // ============================================================================
  // 6. INITIALIZATION & MUTATION OBSERVER
  // ============================================================================
  chrome.runtime.sendMessage({ type: 'XENO_GET_CONFIG' }, (res) => {
    if (res?.ok && res.config) {
      state = { ...state, ...res.config };
    }
    mountHud();
    if (state.lensActive) {
      scheduleIdleScan(document.body);
    }
  });

  const domObserver = new MutationObserver((mutations) => {
    if (!state.lensActive) return;
    for (const m of mutations) {
      for (const added of m.addedNodes) {
        if (added.nodeType === Node.ELEMENT_NODE && !added.hasAttribute('data-xeno-host')) {
          scheduleIdleScan(added);
        }
      }
    }
  });

  if (document.body) {
    domObserver.observe(document.body, { childList: true, subtree: true });
  }
})();
