// ==UserScript==
// @name         Xeno-Lens Universal v3.0 (All Websites + Live AI Interpretation)
// @namespace    https://xeno.cortex.universal
// @version      3.0
// @description  Works on EVERY webpage. Rewrites comments, paragraphs, and articles into informative alien interpretations as you scroll or tap.
// @match        *://*/*
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (window.__XENO_UNIVERSAL_V3__) return;
  window.__XENO_UNIVERSAL_V3__ = true;

  let decodedCount = 0;
  let autoScanEnabled = true;
  let apiKey = localStorage.getItem('xeno_gemini_api_key') || '';

  // --- 1. FLOATING UNIVERSAL CONTROL BAR (SHOWS ON EVERY WEBPAGE) ---
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
    -webkit-tap-highlight-color: transparent !important;
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
      'Optional: Paste a Gemini API Key for live AI interpretation of every sentence on the page (leave blank to use fast local analysis):',
      apiKey
    );
    if (entered !== null) {
      apiKey = entered.trim();
      localStorage.setItem('xeno_gemini_api_key', apiKey);
      updateBar();
    }
  });

  // --- 2. CONTENT-AWARE LOCAL INTERPRETATION ENGINE ---
  // Extracts the actual claims, actors, and rhetorical spin from ANY text block
  function interpretLocally(rawText) {
    const clean = rawText.replace(/\s+/g, ' ').trim();
    const words = clean.split(' ').filter(Boolean);
    if (words.length < 7) return null;

    // Split into sentences to analyze structure
    const sentences = clean.split(/(?<=[.!?])\s+/).filter(Boolean);
    const firstSentence = sentences[0] || clean;

    // Detect specific rhetorical mechanics in the text
    const hasNumbers = /\b(\d+%|\$\d+|\d+\s*(million|billion|years|days|hours|percent|x))\b/i.test(clean);
    const hasOutrage = /\b(disgusting|pathetic|insane|literally|worst|evil|stupid|idiots|clown|garbage|trash|unacceptable|delusional|disaster|catastrophe|terrifying|shocking)\b/i.test(clean);
    const hasAuthority = /\b(study|research|experts|scientists|officials|according to|data|report|evidence|proven|architect|senior|years of experience)\b/i.test(clean);
    const hasPersuasion = /\b(must|should|need to|have to|essential|critical|don't miss|buy|subscribe|join|discover|secret|guaranteed|best)\b/i.test(clean);
    const hasEgo = (clean.match(/\b(i|me|my|mine|i'm|i've|we|our)\b/gi) || []).length >= 3;
    const hasHedge = /\b(maybe|perhaps|possibly|might|could|arguably|seem|seems|appear|suggests|reportedly|allegedly|opinion|feels like)\b/i.test(clean);

    // Strip stopwords & emotional adjectives to isolate the hard informational skeleton
    const stripWords = new Set([
      'the','a','an','and','or','but','if','then','of','at','by','for','with','about','to','from','in','on','is','are','was','were','be','been','being','have','has','had','do','does','did','it','its','this','that','these','those','very','really','just','literally','actually','basically','totally','completely','absolutely','honestly','frankly'
    ]);

    const skeletonWords = words.filter(w => {
      const lw = w.toLowerCase().replace(/[^a-z0-9%$]/g, '');
      return lw.length > 2 && !stripWords.has(lw);
    });

    const compressedClaim = skeletonWords.slice(0, 18).join(' ') + (skeletonWords.length > 18 ? '...' : '');
    const compressionPct = Math.max(12, Math.round((1 - (skeletonWords.length / words.length)) * 100));

    // Synthesize specific interpretation based on what is actually written
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

    return {
      intentLabel,
      borderColor,
      interpretation,
      wordCount: words.length
    };
  }

  // --- 3. LIVE GEMINI API INTERPRETATION (WHEN API KEY IS SET) ---
  async function fetchLiveGeminiInterpretation(rawText, cardBodyEl, badgeEl) {
    if (!apiKey) return;
    badgeEl.textContent = '🛸 PROBING LIVE AI...';
    try {
      const prompt = `You are a sharp, insightful alien cognitive lens helping a human read the web.
In 1 to 2 crisp, plain-English sentences, explain:
1) What this text is ACTUALLY saying when stripped of fluff/spin, and
2) The hidden psychological, commercial, or rhetorical motive behind how it was written.
Be specific to the exact words provided.

TEXT: "${rawText.slice(0, 700)}"`;

      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.2, maxOutputTokens: 140 }
        })
      });
      const data = await res.json();
      const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (reply) {
        badgeEl.textContent = '🛸 LIVE AI INTERPRETATION';
        cardBodyEl.textContent = reply.trim();
      }
    } catch (err) {
      badgeEl.textContent = '🛸 LOCAL LENS (API ERR)';
    }
  }

  // --- 4. TRANSFORM ANY WEBPAGE ELEMENT INTO AN ALIEN CARD ---
  function transformElement(el, forceLiveApi = false) {
    if (!el || el.dataset.xenoDone === '1') return;
    if (el.closest('.xeno-universal-card') || el.closest('#xeno-universal-bar')) return;

    // Skip navigation menus, footers, buttons, and code blocks
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

    // Tap card to toggle original human text underneath
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

    // If user entered a Gemini API key, upgrade the card with live LLM interpretation when it enters viewport
    if (apiKey && (forceLiveApi || decodedCount <= 15)) {
      fetchLiveGeminiInterpretation(rawText, body, badge);
    }
  }

  // --- 5. UNIVERSAL WEBPAGE SCANNER (WORKS ON ALL SITES + SHADOW DOM) ---
  function scanRoot(root) {
    // Target paragraphs, social comments, blockquotes, and article text blocks across any site
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
      // Only transform visible elements near or inside the viewport so scrolling stays fast
      const rect = el.getBoundingClientRect();
      if (rect.width > 120 && rect.height > 18 && rect.top < window.innerHeight + 600) {
        transformElement(el);
      }
    });

    // Also pierce Shadow DOMs (Reddit mobile, modern web components)
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

  // Also allow double-tapping ANY text block on any page to force-interpret it immediately
  document.addEventListener('dblclick', (e) => {
    const target = e.target.closest('p, div, span, li, blockquote');
    if (target) transformElement(target, true);
  });

  // Initial scan + scroll listener
  scanVisiblePage();
  window.addEventListener('scroll', () => {
    window.requestAnimationFrame(scanVisiblePage);
  }, { passive: true });
  setInterval(scanVisiblePage, 1500);
})();
