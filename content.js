/**
 * Xeno-Lens Epistemic Telemetry Engine — Content Script v7.2
 * Excludes right-rail sidebars (<aside>), headings, and short UI fragments.
 */

(function () {
  'use strict';

  if (document.getElementById('xeno-telemetry-hud-host')) return;

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
        .split(/(?<=[.!?])\s+/g)
        .map((s) => s.trim())
        .filter(Boolean);
    }

    tokenSurprisal(token, localTF = 0, localN = 1) {
      const alpha = 0.5;
      const vocabSize = Math.max(100, this.termFreq.size);
      const globalCount = this.termFreq.get(token) || 0;
      const prob = (globalCount + localTF + alpha) / (this.totalTerms + localN + alpha * vocabSize);
      return -Math.log2(prob);
    }

    tokenIDF(token) {
      const df = this.docFreq.get(token) || 0;
      const D = Math.max(1, this.docCount);
      return Math.log(1 + (D - df + 0.5) / (df + 0.5));
    }

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

    analyze(rawText) {
      const clean = rawText.replace(/\s+/g, ' ').trim();
      const tokens = this.tokenize(clean);
      const N = tokens.length;
      // Require at least 10 substantive tokens to avoid tagging short labels or fragments
      if (N < 10) return null;

      const localTF = new Map();
      for (const t of tokens) {
        localTF.set(t, (localTF.get(t) || 0) + 1);
      }

      let shannonEntropy = 0;
      for (const count of localTF.values()) {
        const p = count / N;
        shannonEntropy -= p * Math.log2(p);
      }

      const tokenWeights = new Map();
      const surprisalValues = [];
      for (const [term, count] of localTF.entries()) {
        const surprisal = this.tokenSurprisal(term, count, N);
        const idf = this.tokenIDF(term);
        const tfSublinear = 1 + Math.log(count);
        const weight = tfSublinear * surprisal * (0.5 + idf);
        tokenWeights.set(term, { surprisal, weight, count });
        surprisalValues.push(surprisal);
      }

      this.ingestTokens(tokens);

      surprisalValues.sort((a, b) => a - b);
      const q55 = surprisalValues[Math.floor(surprisalValues.length * 0.55)] || 0;

      const rankedSalient = [];
      for (const [term, stats] of tokenWeights.entries()) {
        if (stats.surprisal >= q55 && term.length > 2) {
          rankedSalient.push({ term, score: stats.weight });
        }
      }
      rankedSalient.sort((a, b) => b.score - a.score);
      const salientTerms = rankedSalient.slice(0, 6).map((x) => x.term);

      const sentences = this.segmentSentences(clean);
      let primaryClause = sentences[0] || clean;

      if (sentences.length > 1) {
        const sentNodes = sentences.map((text, idx) => {
          const sTokens = this.tokenize(text);
          const vec = new Map();
          let normSq = 0;
          let infoSum = 0;
          for (const t of sTokens) {
            const w = tokenWeights.get(t)?.weight || 1;
            vec.set(t, (vec.get(t) || 0) + w);
            infoSum += w;
          }
          for (const val of vec.values()) normSq += val * val;
          return {
            text,
            idx,
            tokens: sTokens,
            vec,
            norm: Math.sqrt(normSq) || 1,
            priorScore: sTokens.length >= 4 ? infoSum / Math.pow(sTokens.length, 0.75) : 0
          };
        });

        const K = sentNodes.length;
        const centrality = new Float64Array(K).fill(1 / K);
        const adj = Array.from({ length: K }, () => new Float64Array(K));

        for (let i = 0; i < K; i++) {
          for (let j = i + 1; j < K; j++) {
            let dot = 0;
            for (const [term, w1] of sentNodes[i].vec.entries()) {
              const w2 = sentNodes[j].vec.get(term);
              if (w2) dot += w1 * w2;
            }
            const sim = dot / (sentNodes[i].norm * sentNodes[j].norm);
            adj[i][j] = sim;
            adj[j][i] = sim;
          }
        }

        const damping = 0.85;
        for (let iter = 0; iter < 10; iter++) {
          const next = new Float64Array(K);
          for (let i = 0; i < K; i++) {
            let incoming = 0;
            for (let j = 0; j < K; j++) {
              if (i === j || adj[j][i] === 0) continue;
              let outSum = 0;
              for (let k = 0; k < K; k++) outSum += adj[j][k];
              if (outSum > 0) incoming += (adj[j][i] / outSum) * centrality[j];
            }
            next[i] = (1 - damping) * sentNodes[i].priorScore + damping * incoming;
          }
          centrality.set(next);
        }

        let bestIdx = 0;
        let bestVal = -Infinity;
        for (let i = 0; i < K; i++) {
          if (sentNodes[i].tokens.length >= 4 && centrality[i] > bestVal) {
            bestVal = centrality[i];
            bestIdx = i;
          }
        }
        primaryClause = sentNodes[bestIdx].text;
      }

      const lexicalDensity = Math.round((localTF.size / N) * 100);
      const yulesK = this.computeYulesK(localTF, N);

      return {
        tokenCount: N,
        entropyBits: shannonEntropy.toFixed(2),
        lexicalDensity,
        yulesK,
        primaryClause,
        salientTerms
      };
    }
  }

  // ============================================================================
  // 2. DOM PROSE DISCOVERY ENGINE (EXCLUDES SIDEBARS & ACCORDION HEADERS)
  // ============================================================================
  const NON_PROSE_ANCESTORS = new Set([
    'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'CANVAS', 'MATH',
    'CODE', 'PRE', 'KBD', 'SAMP', 'VAR', 'INPUT', 'TEXTAREA', 'SELECT',
    'BUTTON', 'LABEL', 'OPTION', 'OPTGROUP', 'DATALIST', 'OUTPUT',
    'AUDIO', 'VIDEO', 'IFRAME', 'OBJECT', 'EMBED', 'HEAD', 'TITLE', 'META',
    'NAV', 'FOOTER', 'HEADER', 'ASIDE', 'DIALOG', 'MENU', 'THEAD', 'TFOOT',
    'SUMMARY', 'FIGCAPTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6'
  ]);

  const INLINE_CONTAINERS = new Set([
    'SPAN', 'A', 'EM', 'STRONG', 'B', 'I', 'U', 'S', 'SMALL', 'SUB', 'SUP',
    'MARK', 'ABBR', 'CITE', 'DFN', 'TIME', 'FONT', 'BDI', 'BDO', 'Q', 'RUBY', 'WBR'
  ]);

  const processedBlocks = new WeakSet();
  const blockToCardMap = new WeakMap();
  const activeCards = new Set();

  function findNearestProseBlock(textNode) {
    let curr = textNode.parentElement;
    while (curr && curr !== document.body && curr !== document.documentElement) {
      if (curr.hasAttribute('data-xeno-host') || curr.isContentEditable) return null;
      if (NON_PROSE_ANCESTORS.has(curr.tagName)) return null;
      const role = curr.getAttribute('role');
      if (role && /^(navigation|banner|complementary|menubar|menu|toolbar|tablist|dialog|alertdialog|search|heading)$/i.test(role)) {
        return null;
      }
      if (!INLINE_CONTAINERS.has(curr.tagName)) {
        return curr;
      }
      curr = curr.parentElement;
    }
    return null;
  }

  function evaluateBlockMetrics(el) {
    if (!el || processedBlocks.has(el)) return null;
    if (NON_PROSE_ANCESTORS.has(el.tagName)) return null;
    if (el.hasAttribute('data-xeno-host') || el.closest('[data-xeno-host]')) return null;

    let parent = el.parentElement;
    while (parent && parent !== document.body) {
      if (processedBlocks.has(parent) || NON_PROSE_ANCESTORS.has(parent.tagName)) return null;
      const role = parent.getAttribute('role');
      if (role && /^(navigation|complementary|banner|menu|toolbar|dialog)$/i.test(role)) return null;
      parent = parent.parentElement;
    }

    if (el.tagName !== 'P' && el.tagName !== 'BLOCKQUOTE' && el.tagName !== 'LI') {
      if (el.querySelector('p, blockquote, article, section, ul, ol, table')) {
        return null;
      }
    }

    const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    if (text.length < 55) return null;

    const anchors = el.getElementsByTagName('a');
    let anchorChars = 0;
    for (let i = 0; i < anchors.length; i++) {
      anchorChars += (anchors[i].textContent || '').replace(/\s+/g, ' ').trim().length;
    }
    if (anchorChars / text.length > 0.5) return null;

    return text;
  }

  function discoverProseBlocks(root) {
    if (!root) return [];
    const candidateSet = new Set();

    if (typeof root.querySelectorAll === 'function') {
      const semanticNodes = root.querySelectorAll('p, blockquote, article li, dd');
      for (let i = 0; i < semanticNodes.length; i++) {
        const el = semanticNodes[i];
        if (!processedBlocks.has(el) && !NON_PROSE_ANCESTORS.has(el.tagName)) {
          candidateSet.add(el);
        }
      }
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || node.nodeValue.trim().length < 35) {
          return NodeFilter.FILTER_SKIP;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    let textNode;
    while ((textNode = walker.nextNode())) {
      const block = findNearestProseBlock(textNode);
      if (block && !processedBlocks.has(block)) {
        candidateSet.add(block);
      }
    }

    const verified = [];
    for (const block of candidateSet) {
      const validText = evaluateBlockMetrics(block);
      if (!validText) continue;

      const rect = block.getBoundingClientRect();
      // Require minimum 200px width to ignore narrow sidebar columns
      if (rect.width >= 200 && rect.height >= 18) {
        verified.push({ element: block, text: validText });
      }
    }

    return verified;
  }

  // ============================================================================
  // 3. SHADOW DOM TELEMETRY CARD & HUD RENDERER
  // ============================================================================
  const CARD_STYLES = `
    .card {
      background: #0b1120;
      border: 1px solid #1e293b;
      border-left: 3.5px solid #38bdf8;
      border-radius: 8px;
      padding: 10px 13px;
      margin: 8px 0 14px 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Inter, sans-serif;
      line-height: 1.45;
      color: #f1f5f9;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.32);
      transition: border-color 0.2s ease;
      box-sizing: border-box;
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

  function safeSendMessage(payload, callback) {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage(payload, (res) => {
          if (chrome.runtime.lastError) {
            if (callback) callback(null);
            return;
          }
          if (callback) callback(res);
        });
      } else if (callback) {
        callback(null);
      }
    } catch {
      if (callback) callback(null);
    }
  }

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

    safeSendMessage(
      {
        type: 'XENO_EXECUTE_PROBE',
        provider: state.provider,
        model: state.model,
        text: meta.rawText
      },
      (res) => {
        if (!res) {
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
      hostEl.style.setProperty('display', 'none', 'important');
      sourceEl.style.display = '';
      sourceEl.style.opacity = '';
      return;
    }
    hostEl.style.setProperty('display', 'block', 'important');
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

    const hostEl = document.createElement('div');
    hostEl.setAttribute('data-xeno-host', '1');
    hostEl.style.cssText = 'display: block !important; width: 100% !important; margin: 6px 0 !important; padding: 0 !important; border: none !important; background: transparent !important;';
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
  // 4. SCAN SCHEDULER
  // ============================================================================
  const pendingRoots = new Set();
  let scanScheduled = false;

  function scheduleIdleScan(root = document.body) {
    if (!state.lensActive || !root) return;
    pendingRoots.add(root);
    if (scanScheduled) return;
    scanScheduled = true;

    const executePass = () => {
      scanScheduled = false;
      const roots = Array.from(pendingRoots);
      pendingRoots.clear();

      for (const r of roots) {
        if (r && r.isConnected) {
          const candidates = discoverProseBlocks(r);
          for (let i = 0; i < candidates.length; i++) {
            renderTelemetryCard(candidates[i]);
          }
        }
      }
    };

    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(executePass, { timeout: 300 });
    } else {
      setTimeout(executePass, 25);
    }
  }

  // ============================================================================
  // 5. SHADOW DOM CONTROL HUD
  // ============================================================================
  const HUD_STYLES = `
    .hud-wrapper {
      position: relative;
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
      padding: 6px 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 11px;
      font-weight: 700;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.85);
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
      bottom: 46px;
      right: 0;
      width: 320px;
      background: #0b1120;
      border: 1.5px solid #38bdf8;
      border-radius: 12px;
      padding: 14px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.9);
      display: none;
      font-size: 12px;
      box-sizing: border-box;
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
    if (document.getElementById('xeno-telemetry-hud-host')) return;

    const hudHost = document.createElement('div');
    hudHost.id = 'xeno-telemetry-hud-host';
    hudHost.setAttribute('data-xeno-host', '1');
    hudHost.style.cssText = `
      position: fixed !important;
      bottom: 18px !important;
      right: 16px !important;
      z-index: 2147483647 !important;
      display: block !important;
      width: auto !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      border: none !important;
      background: transparent !important;
      pointer-events: auto !important;
    `;
    const shadow = hudHost.attachShadow({ mode: 'closed' });

    const styleEl = document.createElement('style');
    styleEl.textContent = HUD_STYLES;

    const wrapper = document.createElement('div');
    wrapper.className = 'hud-wrapper';

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
    wrapper.append(modal, bar);
    shadow.append(styleEl, wrapper);
    (document.body || document.documentElement).appendChild(hudHost);

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
      safeSendMessage(
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
      safeSendMessage(
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
      safeSendMessage({
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
    safeSendMessage({
      type: 'XENO_SAVE_CONFIG',
      config: { lensActive: state.lensActive }
    });
    refreshAllCardViews();
    updateHudCounters();
    if (state.lensActive) {
      scheduleIdleScan(document.body);
    }
  }

  try {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.type === 'XENO_TOGGLE_LENS') {
          toggleLensState();
        }
      });
    }
  } catch {}

  mountHud();
  scheduleIdleScan(document.body);

  safeSendMessage({ type: 'XENO_GET_CONFIG' }, (res) => {
    if (res?.ok && res.config) {
      state = { ...state, ...res.config, decodedCount: state.decodedCount };
      refreshAllCardViews();
      updateHudCounters();
      if (state.lensActive && (state.apiKey || state.provider === 'ollama')) {
        for (const hostEl of activeCards) {
          viewportObserver.observe(hostEl);
        }
      }
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
