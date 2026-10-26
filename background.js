// Toggle via Edge Toolbar Icon
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id || !tab.url || tab.url.startsWith('edge://') || tab.url.startsWith('chrome://')) {
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

// Provider Endpoint Presets
const PROVIDER_CONFIGS = {
  gemini: {
    type: 'gemini',
    defaultModel: 'gemini-2.5-flash',
    buildUrl: (model, key) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`
  },
  openai: {
    type: 'openai',
    defaultModel: 'gpt-4o-mini',
    url: 'https://api.openai.com/v1/chat/completions'
  },
  anthropic: {
    type: 'anthropic',
    defaultModel: 'claude-3-5-haiku-latest',
    url: 'https://api.anthropic.com/v1/messages'
  },
  xai: {
    type: 'openai',
    defaultModel: 'grok-3-mini',
    url: 'https://api.x.ai/v1/chat/completions'
  },
  openrouter: {
    type: 'openai',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    url: 'https://openrouter.ai/api/v1/chat/completions'
  },
  groq: {
    type: 'openai',
    defaultModel: 'llama-3.3-70b-versatile',
    url: 'https://api.groq.com/openai/v1/chat/completions'
  },
  ollama: {
    type: 'openai',
    defaultModel: 'llama3.2',
    url: 'http://localhost:11434/v1/chat/completions'
  }
};

// Sequential Queue to prevent HTTP 429 burst errors while scrolling
const requestQueue = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const { request, sendResponse } = requestQueue.shift();
    try {
      const result = await routeModelCall(request);
      sendResponse(result);
    } catch (err) {
      sendResponse({ ok: false, error: err.message || 'NETWORK_ERR' });
    }
    await new Promise((r) => setTimeout(r, 320));
  }

  isProcessingQueue = false;
}

async function routeModelCall({ provider = 'gemini', model, apiKey, customEndpoint, prompt }) {
  const cleanKey = (apiKey || '').trim();
  const preset = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.openai;
  const activeModel = (model || preset.defaultModel).trim();

  // 1. GOOGLE GEMINI FORMAT
  if (preset.type === 'gemini' && !customEndpoint) {
    const url = preset.buildUrl(activeModel, cleanKey);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 450,
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: `${data?.error?.code || res.status} ${String(data?.error?.status || 'ERR').slice(0, 18)}` };
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p) => typeof p.text === 'string' && !p.thought) || parts[0];
    const reply = textPart?.text?.trim();
    return reply ? { ok: true, reply, modelUsed: activeModel } : { ok: false, error: 'EMPTY_REPLY' };
  }

  // 2. ANTHROPIC CLAUDE FORMAT
  if (preset.type === 'anthropic' && !customEndpoint) {
    const res = await fetch(preset.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cleanKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: activeModel,
        max_tokens: 220,
        temperature: 0.25,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      return { ok: false, error: `${res.status} ${String(data?.error?.type || 'CLAUDE_ERR').slice(0, 18)}` };
    }
    const reply = data?.content?.[0]?.text?.trim();
    return reply ? { ok: true, reply, modelUsed: activeModel } : { ok: false, error: 'EMPTY_REPLY' };
  }

  // 3. OPENAI-COMPATIBLE FORMAT (OpenAI, xAI Grok, OpenRouter, Groq, Ollama, Custom)
  const targetUrl = (customEndpoint || preset.url).trim();
  const headers = { 'Content-Type': 'application/json' };
  if (cleanKey) {
    headers['Authorization'] = `Bearer ${cleanKey}`;
  }

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: activeModel,
      messages: [
        {
          role: 'system',
          content: 'You are an insightful alien cognitive lens. Be concise, direct, and plain-English.'
        },
        { role: 'user', content: prompt }
      ],
      temperature: 0.25,
      max_tokens: 220
    })
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    const errMsg = data?.error?.message || data?.error?.code || res.status;
    return { ok: false, error: `${res.status} ${String(errMsg).slice(0, 20)}` };
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();
  return reply ? { ok: true, reply, modelUsed: activeModel } : { ok: false, error: 'EMPTY_REPLY' };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'XENO_LLM_PROBE') {
    requestQueue.push({ request, sendResponse });
    processQueue();
    return true;
  }
});
