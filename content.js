// ==UserScript==
// @name         Xeno-Lens Universal v3.3 (Edge Extension Content Script)
// @namespace    https://xeno.cortex.universal
// @version      3.3
// @description  Works on EVERY webpage. Rewrites comments, paragraphs, and articles into informative alien interpretations.
// ==/UserScript==

(function () {
  'use strict';

  if (window.__XENO_UNIVERSAL_V3__) return;
  window.__XENO_UNIVERSAL_V3__ = true;

  let decodedCount = 0;
  let autoScanEnabled = true;
  let liveApiTriggerCount = 0;
  const MAX_LIVE_AI_CALLS_PER_PAGE = 5; // Prevent accidental API key quota drain on infinite feeds
  let apiKey = localStorage.getItem('xeno_gemini_api_key') || '';

  // --- 1. FLOATING UNIVERSAL CONTROL BAR ---
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
  toggleBtn.textContent = `🛸 XENO: ON (0)`;

  const keyBtn = document.createElement('button');
  keyBtn.style.cssText = `all: unset !important; cursor: pointer !important; background: #1e293b !important; color: ${apiKey ? '#38bdf8' : '#94a3b8'} !important; padding: 3px 8px !important; border-radius: 999px !important; font-size: 10px !important;`;
  keyBtn.textContent = apiKey ? '🧠 LIVE AI' : '🔑 SET KEY';

  bar.appendChild(toggleBtn);
  bar.appendChild(keyBtn);
  document.documentElement.appendChild(bar);

  function updateBar() {
    toggleBtn.style.color = autoScanEnabled ? '#34d399' : '#94a3b8';
    toggleBtn.textContent = autoScanEnabled ? `🛸 XENO: ON (${decodedCount})` : `🧠 RAW (${decodedCount})`;
    keyBtn.style.color = apiKey ? '#38bdf8' : '#94a3b8';
    keyBtn.textContent = apiKey ? '🧠 LIVE AI' : '🔑 SET KEY';
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

  keyBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const entered = prompt(
      'Paste your Gemini API Key for live AI interpretation (leave blank for fast local analysis):',
      apiKey
    );
    if (entered !== null) {
      apiKey = entered.trim();
      localStorage.setItem('xeno_gemini_api_key', apiKey);
      updateBar();
    }
  });

  // --- 2. LOCAL HEURISTIC INTERPRETATION ENGINE ---
  function interpretLocally(rawText) {
    const clean = rawText.replace(/\s+/g, ' ').trim();
    const words = clean.split(' ').filter(Boolean);
    if (words.length < 7) return null;

    const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
    const firstSentence = sentences[0] || clean;

    const hasNumbers = /\b(\d+%|\$\d+|\d+\s*(million|billion|years|days|hours|percent|x))\b/i.test(clean);
    const hasOutrage = /\b(disgusting|pathetic|insane|literally|worst|evil|stupid|idiots|clown|garbage|trash|unacceptable|delusional|disaster|catastrophe|terrifying|shocking)\b/i.test(clean);
    const hasAuthority = /\b(study|research|experts|scientists|officials|according to|data|report|evidence|proven|architect|senior)\b/i.test(clean);
    const hasPersuasion = /\b(must|should|need to|have to|essential|critical|don't miss|buy|subscribe|join|discover|secret)\b/i.test(clean);
    const hasEgo = (clean.match(/\b(i|me|my|mine|i'm|i've|we|our)\b/gi) || []).length >= 3;
    const hasHedge = /\b(maybe|perhaps|possibly|might|could|arguably|seem|seems|appear|suggests|reportedly)\b/i.test(clean);

    const stripWords = new Set([
      'the','a','an','and','or','but','if','then','of','at','by','for','with','about','to','from','in','on','is','are','was','were','be','been','being','have','has','had','do','does','did','it','its','this','that','these','those','very','really','just','literally','actually'
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
      interpretation = `The writer wraps this claim ("${firstSentence.slice(0, 75)}...") in emotional triggers to hijack amygdala response and drive engagement.`;
    } else if (hasPersuasion) {
      intentLabel = 'BEHAVIORAL STEERING / PITCH';
      borderColor = '#f59e0b';
      interpretation = `Directive framing ("should/must/need"). Core payload stripped of persuasion: "${compressedClaim}"`;
    } else if (hasAuthority && hasNumbers) {
      intentLabel = 'DATA & AUTHORITY ANCHOR';
      borderColor = '#34d399';
      interpretation = `Quantitative/institutional anchor establishing credibility around: "${compressedClaim}"`;
    } else if (hasEgo) {
      intentLabel = 'STATUS / NARRATIVE SIGNAL';
      borderColor = '#c084fc';
      interpretation = `First-person perspective ("I/we/my") building relatable social proof regarding: "${compressedClaim}"`;
    } else if (hasHedge) {
      intentLabel = 'HEDGED SPECULATION';
      borderColor = '#fbbf24';
      interpretation = `Uncertainty qualifiers ("might/could/reportedly") floating a hypothesis with reduced reputational risk: "${compressedClaim}"`;
    } else {
      intentLabel = `DE-MYTHOLOGIZED (-${compressionPct}% FLUFF)`;
      borderColor = '#38bdf8';
      interpretation = `Stripping human conversational padding leaves the raw payload: "${compressedClaim}"`;
    }

    return { intentLabel, borderColor, interpretation, wordCount: words.length };
  }

  // --- 3. BACKGROUND-ROUTED LIVE GEMINI API PROBE ---
  function fetchLiveGeminiInterpretation(rawText, cardBodyEl, badgeEl) {
    if (!apiKey || liveApiTriggerCount >= MAX_LIVE_AI_CALLS_PER_PAGE) return;
    liveApiTriggerCount++;
    badgeEl.textContent = '🛸 PROBING LIVE AI...';

    const prompt = `You are an insightful alien cognitive lens. In 1 to 2 crisp sentences, explain:
1) What this text ACTUALLY says when stripped of spin, and
2) The hidden rhetorical motive behind it.

TEXT: "${rawText.slice(0, 600)}"`;

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'XENO_GEMINI_PROBE', apiKey, prompt }, (res) => {
        if (chrome.runtime.lastError) {
          badgeEl.textContent = '🛸 LOCAL LENS (EXT ERR)';
          return;
        }
        if (res && res.ok && res.reply) {
          badgeEl.textContent = '🛸 LIVE AI INTERPRETATION';
          cardBodyEl.textContent = res.reply.trim();
        } else {
          badgeEl.textContent = `🛸 LOCAL LENS (${res?.error || 'API ERR'})`;
        }
      });
    }
  }

  // --- 4. TRANSFORM ELEMENTS ---
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
    badge.style.cssText = `font-size:10px; font-weight:800; letter-spacing:0.05em; color:${localRes.borderColor}; text-transform:uppercase;`;
    badge.textContent = `🛸 ${localRes.intentLabel}`;

    const hint = document.createElement('span');
    hint.style.cssText = 'font-size:10px; color:#64748b;';
    hint.textContent = `Tap for original (${localRes.wordCount}w)`;

    headerRow.appendChild(badge);
    headerRow.appendChild(hint);

    const body = document.createElement('div');
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

    if (apiKey && (forceLiveApi || liveApiTriggerCount < 2)) {
      fetchLiveGeminiInterpretation(rawText, body, badge);
    }
  }

  // --- 5. ROBUST DOM SCANNER FOR X, REDDIT, & GENERAL WEBSITES ---
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
      '.md > p',
      'shreddit-comment [id="comment-content"]'
    ];

    const candidates = root.querySelectorAll(universalSelectors.join(','));
    candidates.forEach(el => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 100 && rect.height > 16 && rect.top < window.innerHeight + 500) {
        transformElement(el);
      }
    });

    root.querySelectorAll('*').forEach(node => {
      if (node.shadowRoot) {
        scanRoot(node.shadowRoot);
      }
    });
  }

  let scanTimeout = null;
  function scanVisiblePage() {
    if (!autoScanEnabled) return;
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => {
      scanRoot(document);
    }, 150);
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
  window.addEventListener('scroll', scanVisiblePage, { passive: true });
  setInterval(scanVisiblePage, 2000);
})();