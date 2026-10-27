/**
 * Xeno-Lens Telemetry Engine — Service Worker v7.1
 * Includes automatic injection into existing open tabs on install/reload.
 */

'use strict';

// Automatically inject content.js into all currently open tabs upon install or extension reload
async function injectIntoOpenTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
    for (const tab of tabs) {
      if (!tab.id || !tab.url || /^(chrome|edge|about|view-source|https?:\/\/chromewebstore\.google\.com)/i.test(tab.url)) {
        continue;
      }
      chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      }).catch(() => {});
    }
  } catch {
    // Ignore tabs query errors during startup
  }
}

chrome.runtime.onInstalled.addListener(() => {
  injectIntoOpenTabs();
});

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab.url || /^(edge|chrome|about|file|view-source):/i.test(tab.url)) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'XENO_TOGGLE_LENS' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  }
});

const TELEMETRY_JSON_SCHEMA = {
  type: 'object',
  properties: {
    archetype: {
      type: 'string',
      description: 'Concise 2-to-4 word epistemic or game-theoretic classification of the text.'
    },
    claim: {
      type: 'string',
      description: 'The irreducible factual or propositional core stripped of rhetorical framing, in one crisp sentence.'
    },
    motive: {
      type: 'string',
      description: 'The underlying incentive structure, persuasion vector, or status-signaling utility driving the author.'
    },
    confidence: {
      type: 'number',
      description: 'Epistemic signal-to-noise ratio in [0.0, 1.0], where 1.0 is pure verifiable empirical data.'
    }
  },
  required: ['archetype', 'claim', 'motive', 'confidence'],
  additionalProperties: false
};

const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    archetype: { type: 'STRING', description: TELEMETRY_JSON_SCHEMA.properties.archetype.description },
    claim: { type: 'STRING', description: TELEMETRY_JSON_SCHEMA.properties.claim.description },
    motive: { type: 'STRING', description: TELEMETRY_JSON_SCHEMA.properties.motive.description },
    confidence: { type: 'NUMBER', description: TELEMETRY_JSON_SCHEMA.properties.confidence.description }
  },
  required: ['archetype', 'claim', 'motive', 'confidence']
};

const SYSTEM_INSTRUCTION = [
  'You are an objective epistemic telemetry instrument and game-theoretic discourse analyzer.',
  'Deconstruct the provided text passage into:',
  '1. archetype: A rigorous 2-4 word classification of the discourse mechanic.',
  '2. claim: The irreducible informational proposition stripped of emotional valence, hedging, and spin.',
  '3. motive: The underlying incentive structure, coordination game, or persuasive objective of the writer.',
  '4. confidence: A calibrated float in [0.0, 1.0] measuring factual density versus rhetorical noise.'
].join('\n');

const ENDPOINT_MAP = Object.freeze({
  openai: 'https://api.openai.com/v1',
  xai: 'https://api.x.ai/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
  ollama: 'http://localhost:11434/v1'
});

function fnv1a64(str) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

function validateTelemetryPayload(rawObj) {
  if (!rawObj || typeof rawObj !== 'object') {
    throw new Error('INVALID_TELEMETRY_PAYLOAD');
  }
  const archetype = String(rawObj.archetype || '').trim();
  const claim = String(rawObj.claim || '').trim();
  const motive = String(rawObj.motive || '').trim();
  const rawConf = Number(rawObj.confidence);
  const confidence = Number.isFinite(rawConf) ? Math.max(0, Math.min(1, rawConf)) : 0.5;

  if (!archetype || !claim || !motive) {
    throw new Error('INCOMPLETE_TELEMETRY_FIELDS');
  }
  return { archetype, claim, motive, confidence };
}

function parseStructuredJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new Error('EMPTY_MODEL_RESPONSE');
  }
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (match) {
      return JSON.parse(match[0]);
    }
    throw new Error('MALFORMED_JSON_OUTPUT');
  }
}

const PROTOCOLS = {
  gemini: {
    listModels: async (apiKey) => {
      if (!apiKey) throw new Error('MISSING_API_KEY');
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`
      );
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      return (data.models || [])
        .filter((m) => Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        .filter((id) => id && !/(embedding|imagen|veo|aqa|audio|tts|vision)/i.test(id))
        .sort((a, b) => b.localeCompare(a));
    },

    invoke: async ({ model, apiKey, prompt, signal }) => {
      const cleanModel = (model || 'gemini-2.5-flash').replace(/^models\//i, '').trim();
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cleanModel)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const body = {
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 600,
          responseMimeType: 'application/json',
          responseSchema: GEMINI_RESPONSE_SCHEMA
        }
      };

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify(body)
      });
      const data = await res.json().catch(() => ({}));
      return { res, data, modelUsed: cleanModel };
    },

    extract: (data) => {
      const parts = data?.candidates?.[0]?.content?.parts || [];
      const text = parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('')
        .trim();
      return validateTelemetryPayload(parseStructuredJson(text));
    }
  },

  openai_compatible: {
    listModels: async (apiKey, baseUrl) => {
      const headers = { Accept: 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/models`, { headers });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      const rawList = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
      return rawList
        .map((m) => m.id || m.name)
        .filter((id) => typeof id === 'string' && !/(embed|whisper|tts|dall-e|moderation|audio)/i.test(id))
        .sort();
    },

    invoke: async ({ model, apiKey, baseUrl, prompt, signal }) => {
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const cleanBase = baseUrl.replace(/\/+$/, '');
      const targetModel = (model || '').trim();
      if (!targetModel) throw new Error('NO_MODEL_SELECTED');

      const res = await fetch(`${cleanBase}/chat/completions`, {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: targetModel,
          temperature: 0.1,
          max_tokens: 500,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: `${SYSTEM_INSTRUCTION}\nRespond strictly with a valid JSON object matching this schema: ${JSON.stringify(TELEMETRY_JSON_SCHEMA)}`
            },
            { role: 'user', content: prompt }
          ]
        })
      });
      const data = await res.json().catch(() => ({}));
      return { res, data, modelUsed: targetModel };
    },

    extract: (data) => {
      const content = data?.choices?.[0]?.message?.content || '';
      return validateTelemetryPayload(parseStructuredJson(content));
    }
  },

  anthropic: {
    listModels: async (apiKey) => {
      if (!apiKey) throw new Error('MISSING_API_KEY');
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        }
      });
      if (!res.ok) throw new Error(`HTTP_${res.status}`);
      const data = await res.json();
      return (data.data || []).map((m) => m.id).filter(Boolean);
    },

    invoke: async ({ model, apiKey, prompt, signal }) => {
      const targetModel = (model || 'claude-3-5-haiku-latest').trim();
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        signal,
        body: JSON.stringify({
          model: targetModel,
          max_tokens: 500,
          temperature: 0.1,
          system: SYSTEM_INSTRUCTION,
          tools: [
            {
              name: 'emit_epistemic_telemetry',
              description: 'Emit structured epistemic telemetry for the analyzed passage.',
              input_schema: TELEMETRY_JSON_SCHEMA
            }
          ],
          tool_choice: { type: 'tool', name: 'emit_epistemic_telemetry' },
          messages: [{ role: 'user', content: prompt }]
        })
      });
      const data = await res.json().catch(() => ({}));
      return { res, data, modelUsed: targetModel };
    },

    extract: (data) => {
      const blocks = Array.isArray(data?.content) ? data.content : [];
      const toolBlock = blocks.find((b) => b.type === 'tool_use' && b.name === 'emit_epistemic_telemetry');
      if (toolBlock && toolBlock.input) {
        return validateTelemetryPayload(toolBlock.input);
      }
      const textBlock = blocks.find((b) => b.type === 'text');
      return validateTelemetryPayload(parseStructuredJson(textBlock?.text || ''));
    }
  }
};

class AIMDTelemetryScheduler {
  constructor() {
    this.queue = [];
    this.inFlight = 0;
    this.concurrency = 3;
    this.maxConcurrency = 6;
    this.minDelayMs = 80;
    this.currentDelayMs = 80;
    this.circuitOpenUntil = 0;
    this.inFlightDedupe = new Map();
  }

  schedule(key, taskFn) {
    if (this.inFlightDedupe.has(key)) {
      return this.inFlightDedupe.get(key);
    }
    const promise = new Promise((resolve) => {
      this.queue.push({ key, taskFn, resolve });
      this.pump();
    }).finally(() => {
      this.inFlightDedupe.delete(key);
    });
    this.inFlightDedupe.set(key, promise);
    return promise;
  }

  async pump() {
    if (this.inFlight >= this.concurrency || this.queue.length === 0) return;

    const now = Date.now();
    if (now < this.circuitOpenUntil) {
      setTimeout(() => this.pump(), this.circuitOpenUntil - now + 50);
      return;
    }

    const item = this.queue.shift();
    if (!item) return;
    this.inFlight++;

    try {
      const result = await item.taskFn();
      if (result.rateLimited) {
        this.concurrency = 1;
        const retryMs = result.retryAfterMs || Math.min(15000, this.currentDelayMs * 3);
        const jitter = Math.floor(Math.random() * 400);
        this.currentDelayMs = Math.min(8000, this.currentDelayMs * 2);
        this.circuitOpenUntil = Date.now() + retryMs + jitter;
      } else if (result.ok) {
        this.currentDelayMs = Math.max(this.minDelayMs, Math.floor(this.currentDelayMs * 0.85));
        if (this.currentDelayMs <= 120 && this.concurrency < this.maxConcurrency) {
          this.concurrency++;
        }
      }
      item.resolve(result);
    } catch (err) {
      item.resolve({ ok: false, error: err?.message || 'SCHEDULER_FAULT' });
    } finally {
      setTimeout(() => {
        this.inFlight--;
        this.pump();
      }, this.currentDelayMs);
    }
  }
}

const scheduler = new AIMDTelemetryScheduler();
const memoryModelCache = new Map();

async function getSessionCachedTelemetry(cacheKey) {
  try {
    if (chrome.storage?.session) {
      const data = await chrome.storage.session.get(cacheKey);
      return data?.[cacheKey] || null;
    }
  } catch {
    return null;
  }
  return null;
}

async function setSessionCachedTelemetry(cacheKey, payload) {
  try {
    if (chrome.storage?.session) {
      await chrome.storage.session.set({ [cacheKey]: payload });
    }
  } catch {}
}

async function getStoredConfig() {
  const defaults = {
    provider: 'gemini',
    model: '',
    apiKey: '',
    customEndpoint: '',
    viewMode: 'split',
    lensActive: true
  };
  try {
    const stored = await chrome.storage.local.get(Object.keys(defaults));
    return { ...defaults, ...stored };
  } catch {
    return defaults;
  }
}

async function executeProbeRequest({ provider, model, apiKey, customEndpoint, text }) {
  const stored = await getStoredConfig();
  const activeProvider = provider || stored.provider || 'gemini';
  const cleanKey = (apiKey !== undefined ? apiKey : stored.apiKey || '').trim();
  const baseUrl = (customEndpoint || stored.customEndpoint || ENDPOINT_MAP[activeProvider] || ENDPOINT_MAP.openai).trim();

  if (activeProvider !== 'ollama' && !cleanKey) {
    return { ok: false, error: 'NO_API_KEY' };
  }

  const protocol =
    activeProvider === 'gemini'
      ? PROTOCOLS.gemini
      : activeProvider === 'anthropic'
      ? PROTOCOLS.anthropic
      : PROTOCOLS.openai_compatible;

  let targetModel = (model || stored.model || '').trim();
  if (!targetModel) {
    const cacheId = `${activeProvider}:${fnv1a64(cleanKey || baseUrl)}`;
    if (memoryModelCache.has(cacheId)) {
      targetModel = memoryModelCache.get(cacheId)[0];
    } else {
      const models = await protocol.listModels(cleanKey, baseUrl);
      if (!models.length) return { ok: false, error: 'NO_MODELS_AVAILABLE' };
      memoryModelCache.set(cacheId, models);
      targetModel = models[0];
    }
  }

  const normalizedSpecimen = String(text || '').trim().slice(0, 1600);
  const cacheKey = `xeno_cache_${fnv1a64(`${activeProvider}:${targetModel}:${normalizedSpecimen}`)}`;

  const cached = await getSessionCachedTelemetry(cacheKey);
  if (cached) {
    return { ok: true, cached: true, modelUsed: targetModel, telemetry: cached };
  }

  return scheduler.schedule(cacheKey, async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 22000);

    try {
      const { res, data, modelUsed } = await protocol.invoke({
        model: targetModel,
        apiKey: cleanKey,
        baseUrl,
        prompt: normalizedSpecimen,
        signal: controller.signal
      });

      clearTimeout(timer);

      if (res.status === 429) {
        const retryHeader = Number(res.headers?.get('retry-after'));
        const retryAfterMs = Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader * 1000 : 4000;
        return { ok: false, rateLimited: true, retryAfterMs, error: 'RATE_LIMITED_429' };
      }

      if (!res.ok || data?.error) {
        const errMsg = data?.error?.message || `HTTP_${res.status}`;
        return { ok: false, error: errMsg.slice(0, 60) };
      }

      const telemetry = protocol.extract(data);
      await setSessionCachedTelemetry(cacheKey, telemetry);
      return { ok: true, modelUsed, telemetry };
    } catch (err) {
      clearTimeout(timer);
      return {
        ok: false,
        error: err.name === 'AbortError' ? 'DEADLINE_EXCEEDED' : (err.message || 'NETWORK_FAILURE').slice(0, 60)
      };
    }
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;

  if (msg.type === 'XENO_GET_CONFIG') {
    getStoredConfig().then((config) => sendResponse({ ok: true, config }));
    return true;
  }

  if (msg.type === 'XENO_SAVE_CONFIG') {
    const allowed = ['provider', 'model', 'apiKey', 'customEndpoint', 'viewMode', 'lensActive'];
    const update = {};
    for (const k of allowed) {
      if (msg.config && msg.config[k] !== undefined) {
        update[k] = msg.config[k];
      }
    }
    chrome.storage.local.set(update).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (msg.type === 'XENO_FETCH_MODELS') {
    (async () => {
      try {
        const stored = await getStoredConfig();
        const provider = msg.provider || stored.provider || 'gemini';
        const apiKey = (msg.apiKey !== undefined ? msg.apiKey : stored.apiKey || '').trim();
        const baseUrl = (msg.customEndpoint || stored.customEndpoint || ENDPOINT_MAP[provider] || ENDPOINT_MAP.openai).trim();
        const proto =
          provider === 'gemini'
            ? PROTOCOLS.gemini
            : provider === 'anthropic'
            ? PROTOCOLS.anthropic
            : PROTOCOLS.openai_compatible;
        const models = await proto.listModels(apiKey, baseUrl);
        memoryModelCache.set(`${provider}:${fnv1a64(apiKey || baseUrl)}`, models);
        sendResponse({ ok: true, models });
      } catch (err) {
        sendResponse({ ok: false, error: err.message || 'DISCOVERY_FAILED' });
      }
    })();
    return true;
  }

  if (msg.type === 'XENO_EXECUTE_PROBE') {
    executeProbeRequest(msg).then(sendResponse);
    return true;
  }

  return false;
});
