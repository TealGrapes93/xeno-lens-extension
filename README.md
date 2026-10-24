# 🛸 Xeno-Lens Universal

> **Epistemic De-Mythologizer for the Web**
>
> Initial public release of Xeno-Lens Universal! Features dual-engine local/live AI translation, smart X/Reddit rate-limiting queues, and stealth UI cards.

Xeno-Lens Universal is a lightweight browser extension that transforms webpage comments, articles, and social feeds (like X and Reddit) into informative alien behavioral telemetry and de-mythologized summaries. 

It uses a dual-engine architecture: a lightning-fast local heuristic engine for zero-cost analysis, with optional live AI interpretation powered by the Gemini API.

---

## ✨ Features

- **Universal Webpage Scanning:** Works seamlessly across X (Twitter), Reddit, news sites, and general web articles.
- **Dual-Engine Architecture:** Instant local heuristic parsing combined with live Gemini AI cognitive lenses.
- **Smart Queue & Rate Limiting:** Built-in background worker request queuing to prevent HTTP 429 rate limits during rapid scrolling or high-density feeds.
- **Stealth Toggle Control Bar:** Clean, non-intrusive floating control widget with live decode counters and quick API key configuration.
- **Original Text Fallback:** Tap any translated card to instantly reveal or hide the original human text underneath.

---

## 🚀 Installation & Setup

Because this extension uses Manifest V3, you can easily load it into Microsoft Edge, Google Chrome, or Brave via Developer Mode:

1. **Clone or Download:** Clone this repository or download the source code as a `.zip` file and extract it to a folder on your computer.
2. **Open Extensions Page:** 
   - In **Edge**, navigate to `edge://extensions/`
   - In **Chrome**, navigate to `chrome://extensions/`
3. **Enable Developer Mode:** Toggle the **Developer mode** switch in the corner of the extensions page.
4. **Load Unpacked:** Click the **Load unpacked** button and select your project directory containing the extension files.
5. **Pin to Toolbar:** Pin Xeno-Lens to your browser toolbar for quick access!

---

## 🔑 Optional: Live AI Setup

Xeno-Lens works instantly out of the box using local analysis. To unlock live AI interpretations:
1. Click the **🔑 SET KEY** button on the floating Xeno control bar at the bottom right of any webpage.
2. Paste your Gemini API Key. *(Your key is stored securely in your browser's local storage).*

---

## 🛠️ Tech Stack

- **Manifest V3** extension architecture
- **Background Service Worker** for robust message routing and request throttling
- **Content Scripts** with DOM & Shadow DOM piercing for deep feed compatibility
- **Gemini API (`gemini-3.8-flash`)** for advanced cognitive text analysis

---

## 📄 License

Distributed under the MIT License. See `LICENSE` for more information.
