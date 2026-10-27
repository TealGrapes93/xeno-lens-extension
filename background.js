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

// Active 2026 Provider Endpoint Presets & Fallback Chains
const PROVIDER_CONFIGS = {
  gemini: {
    type: 'gemini',
    defaultModel: 'gemini-3.8-flash',
    fallbacks: ['gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.7-flash', 'gemini-3.1-pro-preview'],
    buildUrl: (model, key) => {
      const cleanModel = model.replace(/^models\//i, '').trim();
      return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(key)}`;
    }
  },
  openai: {
    type: 'openai',
    defaultModel: 'gpt-4o-mini',
    fallbacks: ['gpt-4o-mini', 'gpt-4o'],
    url: 'https://api.openai.com/v1/chat/completions'
  },
  anthropic: {
    type: 'anthropic',
    defaultModel: 'claude-3-5-haiku-latest',
    fallbacks: ['claude-3-5-haiku-latest', 'claude-3-7-sonnet-latest'],
    url: 'https://api.anthropic.com/v1/messages'
  },
  xai: {
    type: 'openai',
    defaultModel: 'grok-3-mini',
    fallbacks: ['grok-3-mini', 'grok-3'],
    url: 'https://api.x.ai/v1/chat/completions'
  },
  openrouter: {
    type: 'openai',
    defaultModel: 'google/gemini-3.8-flash',
    fallbacks: ['google/gemini-3.8-flash', 'meta-llama/llama-3.3-70b-instruct'],
    url: 'https://openrouter.ai/api/v1/chat/completions'
  },
  groq: {
    type: 'openai',
    defaultModel: 'llama-3.3-70b-versatile',
    fallbacks: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    url: 'https://api.groq.com/openai/v1/chat/completions'
  },
  ollama: {
    type: 'openai',
    defaultModel: 'llama3.2',
    fallbacks: ['llama3.2', 'llama3.1'],
    url: 'http://localhost:11434/v1/chat/completions'
  }
};

// Dynamic Self-Healing: Queries Google's live model registry if all static fallbacks 404
let discoveredGeminiModel = null;

async function discoverLiveGeminiModel(apiKey) {
  if (discoveredGeminiModel) return discoveredGeminiModel;
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) return null;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(cleanKey)}`
    );
    const data = await res.json();
    const validModels = (data.models || [])
      .filter(
        (m) =>
          (m.supportedGenerationMethods || []).includes('generateContent') &&
          !m.name.includes('embedding') &&
          !m.name.includes('vision') &&
          !m.name.includes('imagen') &&
          !m.name.includes('aqa')
      )
      .map((m) => m.name.replace(/^models\//, ''));

    // Prefer the newest 'flash' model, otherwise take the first valid text generation model
    const flashModels = validModels.filter((n) => n.includes('flash')).sort().reverse();
    discoveredGeminiModel = flashModels[0] || validModels[0] || null;
    return discoveredGeminiModel;
  } catch (e) {
    return null;
  }
}

// Automatically upgrade retired 1.5 / 2.0 / 2.5 Gemini model strings stored in localStorage to gemini-3.8-flash
function sanitizeModelForProvider(provider, rawModel) {
  const preset = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.gemini;
  let m = (rawModel || '').replace(/^models\//i, '').trim();
  if (!m) return preset.defaultModel;

  if (provider === 'gemini') {
    if (!m.startsWith('gemini') || /^gemini-(1\.|2\.)/i.test(m)) {
      return discoveredGeminiModel || 'gemini-3.8-flash';
    }
  }
  if (provider === 'openai' && (m.startsWith('gemini') || m.startsWith('claude') || m.startsWith('grok'))) return preset.defaultModel;
  if (provider === 'anthropic' && !m.startsWith('claude')) return preset.defaultModel;
  if (provider === 'xai' && !m.startsWith('grok')) return preset.defaultModel;

  return m;
}

function normalizeOpenAiUrl(rawUrl, fallbackUrl) {
  let u = (rawUrl || '').trim();
  if (!u) return fallbackUrl;
  u = u.replace(/\/+$/, '');
  if (!u.endsWith('/chat/completions') && !u.endsWith('/messages')) {
    if (u.endsWith('/v1')) return `${u}/chat/completions`;
    return `${u}/v1/chat/completions`;
  }
  return u;
}

const requestQueue = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue || requestQueue.length === 0) return;
  isProcessingQueue = true;

  while (requestQueue.length > 0) {
    const { request, sendResponse } = requestQueue.shift();
    try {
      const result = await routeWithFallback(request);
      sendResponse(result);
    } catch (err) {
      sendResponse({ ok: false, error: err.message || 'NETWORK_ERR' });
    }
    await new Promise((r) => setTimeout(r, 320));
  }

  isProcessingQueue = false;
}

async function routeWithFallback(request) {
  const provider = request.provider || 'gemini';
  const preset = PROVIDER_CONFIGS[provider] || PROVIDER_CONFIGS.gemini;
  const primaryModel = sanitizeModelForProvider(provider, request.model);

  const candidates = [primaryModel, ...(preset.fallbacks || []).filter((m) => m !== primaryModel)];

  let lastResult = { ok: false, error: '404_NO_MODEL' };
  for (const candidateModel of candidates) {
    lastResult = await executeSingleCall({
      ...request,
      provider,
      model: candidateModel,
      preset
    });
    if (lastResult.ok || !String(lastResult.error).startsWith('404')) {
      return lastResult;
    }
  }

  // Final Self-Healing Step: If all known Gemini slugs returned 404, query the API's live model list
  if (provider === 'gemini' && String(lastResult.error).startsWith('404')) {
    const liveModel = await discoverLiveGeminiModel(request.apiKey);
    if (liveModel && !candidates.includes(liveModel)) {
      return await executeSingleCall({ ...request, provider, model: liveModel, preset });
    }
  }

  return lastResult;
}

async function executeSingleCall({ provider, model, apiKey, customEndpoint, prompt, preset }) {
  const cleanKey = (apiKey || '').trim();

  // 1. GOOGLE GEMINI (gemini-3.8-flash default + live discovery fallback)
  if (preset.type === 'gemini' && provider !== 'custom') {
    const url = preset.buildUrl(model, cleanKey);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.25,
          maxOutputTokens: 500
        }
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      return { ok: false, error: `${res.status} (${model})` };
    }
    const parts = data?.candidates?.[0]?.content?.parts || [];
    const textPart = parts.find((p) => typeof p.text === 'string' && !p.thought) || parts[0];
    const reply = textPart?.text?.trim();
    return reply ? { ok: true, reply, modelUsed: model } : { ok: false, error: `EMPTY (${model})` };
  }

  // 2. ANTHROPIC CLAUDE
  if (preset.type === 'anthropic' && provider !== 'custom') {
    const res = await fetch(preset.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cleanKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model,
        max_tokens: 220,
        temperature: 0.25,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) {
      return { ok: false, error: `${res.status} (${model})` };
    }
    const reply = data?.content?.[0]?.text?.trim();
    return reply ? { ok: true, reply, modelUsed: model } : { ok: false, error: `EMPTY (${model})` };
  }

  // 3. OPENAI-COMPATIBLE (OpenAI, xAI Grok, OpenRouter, Groq, Ollama, Custom)
  const useCustomUrl = (provider === 'custom' || provider === 'ollama') && customEndpoint;
  const targetUrl = useCustomUrl ? normalizeOpenAiUrl(customEndpoint, preset.url) : preset.url;

  const headers = { 'Content-Type': 'application/json' };
  if (cleanKey) {
    headers['Authorization'] = `Bearer ${cleanKey}`;
  }

  const res = await fetch(targetUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model,
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

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    return { ok: false, error: `${res.status} (${model})` };
  }

  const reply = data?.choices?.[0]?.message?.content?.trim();
  return reply ? { ok: true, reply, modelUsed: model } : { ok: false, error: `EMPTY (${model})` };
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'XENO_LLM_PROBE') {
    requestQueue.push({ request, sendResponse });
    processQueue();
    return true;
  }
});
