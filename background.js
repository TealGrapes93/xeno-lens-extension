// Listen for clicks on the Extension Toolbar Icon
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || tab.url.startsWith('edge://') || tab.url.startsWith('chrome://') || tab.url.startsWith('about:')) {
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'XENO_TOOLBAR_TOGGLE' });
  } catch (err) {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  }
});

// Sequential Queue so fast scrolling on X/Reddit doesn't trigger 429 Rate Limits
const requestQueue = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const { request, sendResponse } = requestQueue.shift();
    try {
      const result = await callGeminiApi(request.apiKey, request.prompt);
      sendResponse(result);
    } catch (err) {
      sendResponse({ ok: false, error: err.message || 'NETWORK_ERR' });
    }
    // Pacing: 500ms between live AI calls to stay well within free/paid tier RPM limits
    await new Promise((r) => setTimeout(r, 500));
  }

  isProcessingQueue = false;
}

async function callGeminiApi(apiKey, prompt) {
  const cleanKey = (apiKey || '').trim().replace(/['"\s]/g, '');
  if (!cleanKey) return { ok: false, error: 'NO_KEY_SET' };

  // Updated to Gemini 3.8 Flash endpoint
  const modelName = 'gemini-3.8-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(cleanKey)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 300
        }
      })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
      const code = data?.error?.code || res.status;
      const message = data?.error?.message || res.statusText || 'Unknown Error';
      console.error(`[Xeno-Lens] API Error (${code}):`, message);
      return { ok: false, error: `${code}: ${String(message).slice(0, 30)}` };
    }

    const parts = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p) => typeof p.text === 'string' && !p.thought) || parts[0];
    const reply = textPart?.text?.trim();

    if (!reply) {
      const reason = data?.candidates?.[0]?.finishReason || 'EMPTY';
      return { ok: false, error: `NO_TEXT (${reason})` };
    }

    return { ok: true, reply };
  } catch (netErr) {
    console.error('[Xeno-Lens] Network Fetch Exception:', netErr);
    return { ok: false, error: 'NETWORK_EXCEPT' };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'XENO_GEMINI_PROBE') {
    requestQueue.push({ request, sendResponse });
    processQueue();
    return true; // Keep message channel open for async queue response
  }
});