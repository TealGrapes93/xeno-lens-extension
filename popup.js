'use strict';

const providerEl = document.querySelector('#provider');
const endpointEl = document.querySelector('#endpoint');
const endpointLabel = document.querySelector('#endpoint-label');
const keyEl = document.querySelector('#key');
const persistEl = document.querySelector('#persist');
const clearEl = document.querySelector('#clear');
const modelEl = document.querySelector('#model');
const modelsEl = document.querySelector('#models');
const viewEl = document.querySelector('#view');
const capEl = document.querySelector('#cap');
const probesEl = document.querySelector('#probes');
const autoEl = document.querySelector('#auto');
const statusEl = document.querySelector('#status');
const keyState = document.querySelector('#key-state');

function setStatus(text, bad) {
  statusEl.textContent = text || '';
  statusEl.classList.toggle('bad', Boolean(bad));
}

function send(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(response || { ok: false, error: 'EMPTY_RESPONSE' });
    });
  });
}

function syncEndpoint() {
  const custom = providerEl.value === 'custom';
  endpointLabel.hidden = !custom;
  endpointEl.required = custom;
}

function originPattern(raw) {
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error('Custom endpoints must be https. Local HTTP belongs on the Ollama provider.');
  return `${url.origin}/*`;
}

function apply(config) {
  providerEl.value = config.provider || 'gemini';
  endpointEl.value = config.customEndpoint || '';
  modelEl.value = config.model || '';
  viewEl.value = config.viewMode === 'replace' ? 'replace' : 'annotate';
  capEl.value = String(config.maxProbesPerPage || 8);
  probesEl.checked = Boolean(config.probeEnabled);
  autoEl.checked = Boolean(config.enableByDefault);
  persistEl.checked = Boolean(config.keyPersisted);
  keyState.textContent = config.hasKey ? (config.keyPersisted ? 'Key stored on device' : 'Key stored for this browser session') : 'No key stored';
  syncEndpoint();
}

async function load() {
  const response = await send({ type: 'XENO_GET_CONFIG' });
  if (!response.ok) {
    setStatus(response.error || 'Config unavailable', true);
    return;
  }
  apply(response.config);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const status = await chrome.tabs.sendMessage(tab.id, { type: 'XENO_STATUS' }).catch(() => null);
  document.querySelector('#toggle').textContent = status?.active ? 'Disable on this tab' : 'Enable on this tab';
}

providerEl.addEventListener('change', syncEndpoint);

document.querySelector('#fetch').addEventListener('click', async () => {
  setStatus('Fetching models…');
  const response = await send({
    type: 'XENO_FETCH_MODELS',
    provider: providerEl.value,
    apiKey: keyEl.value,
    customEndpoint: endpointEl.value.trim()
  });
  modelsEl.replaceChildren();
  if (!response.ok) {
    setStatus(response.error || 'Model list failed', true);
    return;
  }
  for (const id of response.models || []) {
    const option = document.createElement('option');
    option.value = id;
    modelsEl.append(option);
  }
  if (!modelEl.value && response.models?.[0]) modelEl.value = response.models[0];
  setStatus(`${response.models?.length || 0} models`);
});

document.querySelector('#save').addEventListener('click', async () => {
  try {
    let grant = null;
    if (providerEl.value === 'custom') grant = chrome.permissions.request({ origins: [originPattern(endpointEl.value.trim())] });
    if (grant && !(await grant)) {
      setStatus('Host permission denied', true);
      return;
    }
    const response = await send({
      type: 'XENO_SET_CONFIG',
      provider: providerEl.value,
      model: modelEl.value.trim(),
      customEndpoint: endpointEl.value.trim(),
      apiKey: keyEl.value,
      clearKey: clearEl.checked,
      persistKey: persistEl.checked,
      viewMode: viewEl.value,
      maxProbesPerPage: Number(capEl.value),
      probeEnabled: probesEl.checked,
      enableByDefault: autoEl.checked
    });
    if (!response.ok) {
      setStatus(response.error || 'Save failed', true);
      return;
    }
    keyEl.value = '';
    clearEl.checked = false;
    apply(response.config);
    setStatus('Saved');
  } catch (err) {
    setStatus(err.message || 'Save failed', true);
  }
});

document.querySelector('#toggle').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !/^https?:/i.test(tab.url || '')) {
    setStatus('This page cannot be instrumented', true);
    return;
  }
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'XENO_TOGGLE' });
  } catch {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
    await chrome.tabs.sendMessage(tab.id, { type: 'XENO_TOGGLE' });
  }
  await load();
});

load();
