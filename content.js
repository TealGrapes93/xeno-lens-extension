// ==UserScript==
// @name         Xeno-Lens Universal v4.0 (Multi-Provider LLM Edition)
// @namespace    https://xeno.cortex.universal
// @version      4.0
// @description  Works on EVERY webpage with any LLM (Gemini, OpenAI, Claude, Grok, OpenRouter, Groq, or Local Ollama).
// ==/UserScript==

(function () {
  'use strict';

  if (window.__XENO_UNIVERSAL_V4__) return;
  window.__XENO_UNIVERSAL_V4__ = true;

  let decodedCount = 0;
  let autoScanEnabled = true;

  const DEFAULT_MODELS = {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o-mini',
    anthropic: 'claude-3-5-haiku-latest',
    xai: 'grok-3-mini',
    openrouter: 'meta-llama/llama-3.3-70b-instruct',
    groq: 'llama-3.3-70b-versatile',
    ollama: 'llama3.2',
    custom: 'gpt-4o-mini'
  };

  let config = {
    provider: localStorage.getItem('xeno_provider') || 'gemini',
    model: localStorage.getItem('xeno_model') || 'gemini-2.5-flash',
    apiKey: localStorage.getItem('xeno_gemini_api_key') || localStorage.getItem('xeno_api_key') || '',
    customEndpoint: localStorage.getItem('xeno_custom_endpoint') || ''
  };

  function hasLiveModelReady() {
    return config.provider === 'ollama' || Boolean(config.apiKey);
  }

  // --- 1. FLOATING CONTROL BAR + MULTI-MODEL MODAL ---
  const bar = document.createElement('div');
  bar.id = 'xeno-universal-bar';
  bar.style.cssText = `
    position: fixed !important;
    bottom: 20px !important;
    right: 14px !important;
    z-index: 2147483647 !important;
    display: flex !important;
    align-items: center !important;
    gap: 6px !important;
    background: #0b1120 !important;
    border: 1.5px solid #38bdf8 !important;
    border-radius: 999px !important;
    padding: 6px 10px !important;
    font-family: -apple-system, BlinkMacSystemFont, monospace !important;
    font-size: 11px !important;
    font-weight: 700 !important;
    color: #f8fafc !important;
    box-shadow: 0 8px 24px rgba(0,0,0,0.75) !important;
    user-select: none !important;
  `;

  const toggleBtn = document.createElement('button');
  toggleBtn.style.cssText = `all: unset !important; cursor: pointer !important; color: #34d399 !important; padding: 2px 6px !important;`;

  const configBtn = document.createElement('button');
  configBtn.style.cssText = `all: unset !important; cursor: pointer !important; background: #1e293b !important; padding: 3px 8px !important; border-radius: 999px !important; font-size: 10px !important;`;

  bar.appendChild(toggleBtn);
  bar.appendChild(configBtn);
  document.documentElement.appendChild(bar);

  // Settings Modal
  const modal = document.createElement('div');
  modal.style.cssText = `
    position: fixed !important;
    bottom: 64px !important;
    right: 14px !important;
    z-index: 2147483647 !important;
    width: 310px !important;
    background: #0b1120 !important;
    border: 1.5px solid #38bdf8 !important;
    border-radius: 14px !important;
    padding: 14px !important;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
    color: #f8fafc !important;
    font-size: 12px !important;
    box-shadow: 0 12px 32px rgba(0,0,0,0.85) !important;
    display: none !important;
  `;

  modal.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px; border-bottom:1px solid #1e293b; padding-bottom:6px;">
      <strong style="color:#38bdf8; font-size:11px; letter-spacing:0.05em; text-transform:uppercase;">🛸 Xeno-Lens Model Router</strong>
      <span id="xeno-close-modal" style="cursor:pointer; color:#94a3b8; font-size:14px;">✕</span>
    </div>

    <label style="display:block; color:#94a3b8; font-size:10px; margin-bottom:3px;">PROVIDER</label>
    <select id="xeno-provider-select" style="width:100%; background:#020617; color:#f8fafc; border:1px solid #334155; border-radius:6px; padding:6px; margin-bottom:8px; font-size:12px;">
      <option value="gemini">Google Gemini</option>
      <option value="openai">OpenAI (GPT-4o / o3)</option>
      <option value="anthropic">Anthropic (Claude)</option>
      <option value="xai">xAI (Grok)</option>
      <option value="openrouter">OpenRouter (Any Model)</option>
      <option value="groq">Groq (Ultra-Fast LPU)</option>
      <option value="ollama">Local Ollama (localhost:11434)</option>
      <option value="custom">Custom OpenAI-Compatible URL</option>
    </select>

    <label style="display:block; color:#94a3b8; font-size:10px; margin-bottom:3px;">MODEL ID</label>
    <input id="xeno-model-input" type="text" placeholder="e.g. gpt-4o-mini, claude-3-5-haiku-latest"
      style="width:100%; box-sizing:border-box; background:#020617; color:#38bdf8; border:1px solid #334155; border-radius:6px; padding:6px; margin-bottom:8px; font-size:12px; font-family:monospace;" />

    <label style="display:block; color:#94a3b8; font-size:10px; margin-bottom:3px;">API KEY (Leave blank for Ollama / Local Mode)</label>
    <input id="xeno-key-input" type="password" placeholder="Paste provider API key..."
      style="width:100%; box-sizing:border-box; background:#020617; color:#34d399; border:1px solid #334155; border-radius:6px; padding:6px; margin-bottom:8px; font-size:12px; font-family:monospace;" />

    <div id="xeno-custom-url-wrap" style="display:none;">
      <label style="display:block; color:#94a3b8; font-size:10px; margin-bottom:3px;">CUSTOM ENDPOINT URL</label>
      <input id="xeno-endpoint-input" type="text" placeholder="https://api.example.com/v1/chat/completions"
        style="width:100%; box-sizing:border-box; background:#020617; color:#f8fafc; border:1px solid #334155; border-radius:6px; padding:6px; margin-bottom:8px; font-size:11px; font-family:monospace;" />
    </div>

    <button id="xeno-save-config" style="width:100%; background:#0ea5e9; color:#020617; font-weight:700; border:none; border-radius:6px; padding:7px; cursor:pointer; font-size:12px; margin-top:4px;">
      Save & Re-Scan Page
    </button>
  `;
  document.documentElement.appendChild(modal);

  function updateBar() {
    toggleBtn.style.color = autoScanEnabled ? '#34d399' : '#94a3b8';
    toggleBtn.textContent = autoScanEnabled ? `🛸 XENO: ON (${decodedCount})` : `🧠 RAW (${decodedCount})`;
    configBtn.style.color = hasLiveModelReady() ? '#38bdf8' : '#94a3b8';
    configBtn.textContent = hasLiveModelReady()
      ? `⚙️ ${config.provider.toUpperCase()}`
      : '⚙️ SET MODEL';
  }

  toggleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    autoScanEnabled = !autoScanEnabled;
    document.querySelectorAll('.xeno-universal-card').forEach(c => {
      c.style.display = autoScanEnabled ? 'block' : 'none';
    });
    document.querySelectorAll('[data-xeno-hidden="1"]').forEach(el => {
      el.style.display = autoScanEnabled ? 'none' : '';
    });
    updateBar();
    if (autoScanEnabled) scanVisiblePage();
  });

  const providerSelect = modal.querySelector('#xeno-provider-select');
  const modelInput = modal.querySelector('#xeno-model-input');
  const keyInput = modal.querySelector('#xeno-key-input');
  const endpointInput = modal.querySelector('#xeno-endpoint-input');
  const customWrap = modal.querySelector('#xeno-custom-url-wrap');

  providerSelect.addEventListener('change', () => {
    const p = providerSelect.value;
    modelInput.value = DEFAULT_MODELS[p] || '';
    customWrap.style.display = (p === 'custom' || p === 'ollama') ? 'block' : 'none';
    if (p === 'ollama' && !endpointInput.value) {
      endpointInput.value = 'http://localhost:11434/v1/chat/completions';
    }
  });

  configBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isHidden = modal.style.display === 'none';
    if (isHidden) {
      providerSelect.value = config.provider;
      modelInput.value = config.model;
      keyInput.value = config.apiKey;
      endpointInput.value = config.customEndpoint;
      customWrap.style.display = (config.provider === 'custom' || config.provider === 'ollama') ? 'block' : 'none';
      modal.style.display = 'block';
    } else {
      modal.style.display = 'none';
    }
  });

  modal.querySelector('#xeno-close-modal').addEventListener('click', () => {
    modal.style.display = 'none';
  });

  modal.querySelector('#xeno-save-config').addEventListener('click', () => {
    config.provider = providerSelect.value;
    config.model = modelInput.value.trim() || DEFAULT_MODELS[config.provider];
    config.apiKey = keyInput.value.trim();
    config.customEndpoint = endpointInput.value.trim();

    localStorage.setItem('xeno_provider', config.provider);
    localStorage.setItem('xeno_model', config.model);
    localStorage.setItem('xeno_api_key', config.apiKey);
    localStorage.setItem('xeno_custom_endpoint', config.customEndpoint);

    modal.style.display = 'none';
    updateBar();

    // Re-trigger live AI calls on existing cards
    document.querySelectorAll('.xeno-universal-card').forEach((card) => {
      if (card.dataset.rawText && hasLiveModelReady()) {
        const badgeEl = card.querySelector('.xeno-card-badge');
        const bodyEl = card.querySelector('.xeno-card-body');
        if (badgeEl && bodyEl) {
          fetchLiveModelInterpretation(card.dataset.rawText, bodyEl, badgeEl);
        }
      }
    });
  });

  updateBar();

  // --- 2. CONTENT-AWARE LOCAL INTERPRETATION ENGINE ---
  function interpretLocally(rawText) {
    const clean = rawText.replace(/\s+/g, ' ').trim();
    const words = clean.split(' ').filter(Boolean);
    if (words.length < 7) return null;

    const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
    const firstSentence = sentences[0] || clean;

    const hasNumbers = /\b(\d+%|\$\d+|\d+\s*(million|billion|years|days|hours|percent|x))\b/i.test(clean);
    const hasOutrage = /\b(disgusting|pathetic|insane|literally|worst|evil|stupid|idiots|clown|garbage|trash|unacceptable|delusional|disaster|catastrophe|terrifying|shocking)\b/i.test(clean);
    const hasAuthority = /\b(study|research|experts|scientists|officials|according to|data|report|evidence|proven|architect|senior|years of experience)\b/i.test(clean);
    const hasPersuasion = /\b(must|should|need to|have to|essential|critical|don't miss|buy|subscribe|join|discover|secret|guaranteed|best)\b/i.test(clean);
    const hasEgo = (clean.match(/\b(i|me|my|mine|i'm|i've|we|our)\b/gi) || []).length >= 3;
    const hasHedge = /\b(maybe|perhaps|possibly|might|could|arguably|seem|seems|appear|suggests|reportedly|allegedly|opinion|feels like)\b/i.test(clean);

    const stripWords = new Set([
      'the','a','an','and','or','but','if','then','of','at','by','for','with','about','to','from','in','on','is','are','was','were','be','been','being','have','has','had','do','does','did','it','its','this','that','these','those','very','really','just','literally','actually','basically','totally','completely','absolutely','honestly','frankly'
    ]);

    const skeletonWords = words.filter(w => {
      const lw = w.toLowerCase().replace(/[^a-z0-9%$]/g, '');
      return lw.length > 2 && !stripWords.has(lw);
    });

    const compressedClaim = skeletonWords.slice(0, 18).join(' ') + (skeletonWords.length > 18 ? '...' : '');
    const compressionPct = Math.max(12, Math.round((1 - (skeletonWords.length / words.length)) * 100));

    let intentLabel = 'INFORMATIONAL BROADCAST';
    let borderColor = '#38bdf8';
    let interpretation = '';

    if (hasOutrage) {
      intentLabel = 'HIGH-AROUSAL EMOTIONAL HOOK';
      borderColor = '#fb7185';
      interpretation = `The writer is wrapping a claim ("${firstSentence.slice(0, 85)}...") in alarmist/tribal vocabulary to hijack your amygdala's threat response and force agreement or clicks.`;
    } else if (hasPersuasion) {
      intentLabel = 'BEHAVIORAL STEERING / PERSUASION';
      borderColor = '#f59e0b';
      interpretation = `This passage uses directive framing ("should/must/need") to nudge your behavior or beliefs toward a target outcome. Stripped of persuasion, the core pitch is: "${compressedClaim}"`;
    } else if (hasAuthority && hasNumbers) {
      intentLabel = 'DATA & AUTHORITY ANCHORING';
      borderColor = '#34d399';
      interpretation = `High-density factual/quantitative signal. The writer cites metrics or institutional authority to establish credibility around: "${compressedClaim}"`;
    } else if (hasEgo) {
      intentLabel = 'FIRST-PERSON NARRATIVE / STATUS SIGNAL';
      borderColor = '#c084fc';
      interpretation = `The author centers their own subjective experience or group identity ("I/we/my") to build relatable social proof while discussing: "${compressedClaim}"`;
    } else if (hasHedge) {
      intentLabel = 'HEDGED SPECULATION';
      borderColor = '#fbbf24';
      interpretation = `Notice the epistemic caution: the writer uses uncertainty qualifiers ("might/could/reportedly") to float a hypothesis without taking full reputational risk: "${compressedClaim}"`;
    } else {
      intentLabel = `DE-MYTHOLOGIZED SUMMARY (-${compressionPct}% FLUFF)`;
      borderColor = '#38bdf8';
      interpretation = `Stripping ${compressionPct}% of human conversational padding leaves the raw informational payload: "${compressedClaim}"`;
    }

    return { intentLabel, borderColor, interpretation, wordCount: words.length };
  }

  // --- 3. UNIVERSAL MULTI-MODEL PROBE (CALLS BACKGROUND.JS ROUTER) ---
  function fetchLiveModelInterpretation(rawText, cardBodyEl, badgeEl) {
    if (!hasLiveModelReady()) return;
    badgeEl.textContent = `🛸 PROBING ${config.provider.toUpperCase()}...`;

    const prompt = `You are a sharp, insightful alien cognitive lens helping a human read the web.
In 1 to 2 crisp, plain-English sentences, explain:
1) What this text is ACTUALLY saying when stripped of fluff/spin, and
2) The hidden psychological, commercial, or rhetorical motive behind how it was written.
Be specific to the exact words provided.

TEXT: "${rawText.slice(0, 700)}"`;

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage(
        {
          type: 'XENO_LLM_PROBE',
          provider: config.provider,
          model: config.model,
          apiKey: config.apiKey,
          customEndpoint: config.customEndpoint,
          prompt
        },
        (res) => {
          if (res && res.ok && res.reply) {
            badgeEl.textContent = `🛸 ${config.provider.toUpperCase()} (${res.modelUsed || config.model})`;
            cardBodyEl.textContent = res.reply.trim();
          } else {
            badgeEl.textContent = `🛸 LOCAL LENS (${res?.error || 'ERR'})`;
          }
        }
      );
    }
  }

  // --- 4. TRANSFORM WEBPAGE ELEMENTS INTO ALIEN CARDS ---
  function transformElement(el, forceLiveApi = false) {
    if (!el || el.dataset.xenoDone === '1') return;
    if (el.closest('.xeno-universal-card') || el.closest('#xeno-universal-bar')) return;
    if (el.closest('nav, header, footer, button, a, pre, code, script, style, form')) return;

    const rawText = (el.innerText || '').trim();
    const localRes = interpretLocally(rawText);
    if (!localRes) return;

    el.dataset.xenoDone = '1';
    el.dataset.xenoHidden = '1';

    const card = document.createElement('div');
    card.className = 'xeno-universal-card';
    card.dataset.rawText = rawText;
    card.style.cssText = `
      display: ${autoScanEnabled ? 'block' : 'none'};
      background: #0b1120 !important;
      border-left: 3.5px solid ${localRes.borderColor} !important;
      border-radius: 10px !important;
      padding: 10px 12px !important;
      margin: 8px 0 !important;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;
      color: #f1f5f9 !important;
      font-size: 14px !important;
      line-height: 1.45 !important;
      box-shadow: 0 4px 14px rgba(0,0,0,0.28) !important;
      cursor: pointer !important;
    `;

    const headerRow = document.createElement('div');
    headerRow.style.cssText = 'display:flex; justify-content:space-between; align-items:center; margin-bottom:5px;';

    const badge = document.createElement('span');
    badge.className = 'xeno-card-badge';
    badge.style.cssText = `font-size:10px; font-weight:800; letter-spacing:0.05em; color:${localRes.borderColor}; text-transform:uppercase;`;
    badge.textContent = `🛸 ${localRes.intentLabel}`;

    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:10px; color:#64748b;';
    hint.textContent = `Tap for original (${localRes.wordCount}w)`;

    headerRow.appendChild(badge);
    headerRow.appendChild(hint);

    const body = document.createElement('div');
    body.className = 'xeno-card-body';
    body.style.cssText = 'color:#f8fafc; font-weight:400;';
    body.textContent = localRes.interpretation;

    card.appendChild(headerRow);
    card.appendChild(body);

    let showingOriginal = false;
    card.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      showingOriginal = !showingOriginal;
      el.style.display = showingOriginal ? '' : 'none';
      hint.textContent = showingOriginal ? 'Showing original below' : `Tap for original (${localRes.wordCount}w)`;
    });

    if (autoScanEnabled) {
      el.style.display = 'none';
    }
    el.parentNode.insertBefore(card, el.nextSibling);

    decodedCount++;
    updateBar();

    if (hasLiveModelReady() && (forceLiveApi || decodedCount <= 15)) {
      fetchLiveModelInterpretation(rawText, body, badge);
    }
  }

  // --- 5. UNIVERSAL WEBPAGE SCANNER ---
  function scanRoot(root) {
    const universalSelectors = [
      'p',
      'blockquote',
      'article li',
      '[data-testid="tweetText"]',
      '[data-testid="comment"]',
      'div[slot="comment"] > div',
      '.comment-content',
      '.commtext',
      '.md > p'
    ];

    const candidates = root.querySelectorAll(universalSelectors.join(','));
    candidates.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 120 && rect.height > 18 && rect.top < window.innerHeight + 600) {
        transformElement(el);
      }
    });

    root.querySelectorAll('*').forEach(node => {
      if (node.shadowRoot) {
        scanRoot(node.shadowRoot);
      }
    });
  }

  function scanVisiblePage() {
    if (!autoScanEnabled) return;
    scanRoot(document);
  }

  document.addEventListener('dblclick', (e) => {
    const target = e.target.closest('p, div, span, li, blockquote');
    if (target) transformElement(target, true);
  });

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'XENO_TOOLBAR_TOGGLE') {
        toggleBtn.click();
        sendResponse({ status: 'toggled', active: autoScanEnabled });
      }
    });
  }

  scanVisiblePage();
  window.addEventListener('scroll', () => {
    window.requestAnimationFrame(scanVisiblePage);
  }, { passive: true });
  setInterval(scanVisiblePage, 1500);
})();
