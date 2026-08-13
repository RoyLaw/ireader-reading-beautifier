// ==UserScript==
// @name         掌阅在线阅读器排版美化
// @namespace    https://pc.ireader.com/
// @version      1.7.0
// @description  改善掌阅网页版的字体、字号、行距、段距、颜色、版心与夜间阅读体验。
// @author       RoyLaw
// @homepageURL  https://github.com/RoyLaw/ireader-reading-beautifier
// @supportURL   https://github.com/RoyLaw/ireader-reading-beautifier/issues
// @downloadURL  https://raw.githubusercontent.com/RoyLaw/ireader-reading-beautifier/main/ireader-reading-beautifier.user.js
// @updateURL    https://raw.githubusercontent.com/RoyLaw/ireader-reading-beautifier/main/ireader-reading-beautifier.user.js
// @match        https://pc.ireader.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const STORAGE_KEY = 'ireader-reading-beautifier:v1';
  const FRAME_STYLE_ID = 'ireader-reading-beautifier-frame-style';
  const FRAME_BRIDGE_ID = 'ireader-reading-beautifier-height-bridge';
  const FRAME_HEIGHT_MESSAGE = 'ireader-reading-beautifier:frame-height';
  const OUTER_STYLE_ID = 'ireader-reading-beautifier-outer-style';
  const UI_HOST_ID = 'ireader-reading-beautifier-ui';

  const FONT_OPTIONS = {
    serif: '"Source Han Serif SC", "Noto Serif CJK SC", "Noto Serif SC", "Songti SC", SimSun, serif',
    wenkai: '"LXGW WenKai Screen", "LXGW WenKai", KaiTi, STKaiti, serif',
    sans: '"Noto Sans SC", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif',
    system: 'system-ui, -apple-system, "Segoe UI", "Microsoft YaHei UI", sans-serif',
  };

  const THEMES = {
    paper: {
      label: '纸张',
      textColor: '#2b2926',
      pageColor: '#f7f3e8',
      surroundColor: '#e8e4dc',
      mutedColor: '#766d62',
      accentColor: '#7a5c3e',
    },
    sepia: {
      label: '暖黄',
      textColor: '#3b2f24',
      pageColor: '#f4ead2',
      surroundColor: '#ded0b2',
      mutedColor: '#806d58',
      accentColor: '#895f36',
    },
    night: {
      label: '夜间',
      textColor: '#d8d3c8',
      pageColor: '#242424',
      surroundColor: '#171717',
      mutedColor: '#a7a198',
      accentColor: '#d0a66f',
    },
  };

  const OBFUSCATED_CHAR_MAP = new Map([
    ['\u{F0000}', '的'], ['\u{F0001}', '一'], ['\u{F0002}', '是'], ['\u{F0003}', '了'],
    ['\u{F0004}', '在'], ['\u{F0005}', '有'], ['\u{F0006}', '他'], ['\u{F0007}', '我'],
    ['\u{F0008}', '这'], ['\u{F0009}', '们'], ['\u{F0010}', '来'], ['\u{F0011}', '去'],
    ['\u{F0012}', '说'], ['\u{F0013}', '就'], ['\u{F0014}', '事'], ['\u{F0015}', '你'],
    ['\u{F0016}', '对'], ['\u{F0017}', '也'], ['\u{F0018}', '还'], ['\u{F0019}', '但'],
  ]);
  const OBFUSCATED_CHAR_PATTERN = /[\u{F0000}-\u{F0009}\u{F0010}-\u{F0019}]/gu;

  const DEFAULTS = {
    enabled: true,
    decodeObfuscated: true,
    fontPreset: 'serif',
    customFont: '',
    customFonts: [],
    fontSize: 19,
    lineHeight: 1.9,
    letterSpacing: 0.035,
    paragraphSpacing: 0.85,
    pageWidth: 860,
    pagePadding: 72,
    theme: 'paper',
    panelOpen: false,
    ...THEMES.paper,
  };

  let state = loadState();
  let applyTimer = 0;
  let observer = null;
  let readerActive = false;
  let routeCheckTimer = 0;
  const decodedTextNodes = new Map();
  const frameHeightTargets = new WeakMap();

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      const merged = { ...DEFAULTS, ...saved };
      if (!Array.isArray(saved.customFonts) && saved.customFont) merged.customFonts = [saved.customFont];
      return sanitizeState(merged);
    } catch (_) {
      return { ...DEFAULTS };
    }
  }

  function sanitizeState(value) {
    const clamp = (number, min, max, fallback) => {
      number = Number(number);
      return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
    };

    return {
      ...DEFAULTS,
      ...value,
      enabled: value.enabled !== false,
      decodeObfuscated: value.decodeObfuscated !== false,
      fontPreset: Object.hasOwn(FONT_OPTIONS, value.fontPreset) ? value.fontPreset : DEFAULTS.fontPreset,
      customFont: String(value.customFont || '').slice(0, 160),
      customFonts: [...new Set((Array.isArray(value.customFonts) ? value.customFonts : [])
        .map((name) => String(name || '').replace(/[;{}]/g, '').replace(/["\\]/g, '').trim().slice(0, 160))
        .filter(Boolean))].slice(0, 30),
      fontSize: clamp(value.fontSize, 14, 30, DEFAULTS.fontSize),
      lineHeight: clamp(value.lineHeight, 1.35, 2.6, DEFAULTS.lineHeight),
      letterSpacing: clamp(value.letterSpacing, 0, 0.15, DEFAULTS.letterSpacing),
      paragraphSpacing: clamp(value.paragraphSpacing, 0, 2.4, DEFAULTS.paragraphSpacing),
      pageWidth: clamp(value.pageWidth, 640, 1120, DEFAULTS.pageWidth),
      pagePadding: clamp(value.pagePadding, 24, 140, DEFAULTS.pagePadding),
      panelOpen: Boolean(value.panelOpen),
    };
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function fontFamily() {
    const custom = state.customFont.trim();
    if (custom) {
      const safe = custom.replace(/[;{}]/g, '').replace(/["\\]/g, '').trim();
      if (safe) return `"${safe}", ${FONT_OPTIONS[state.fontPreset]}`;
    }
    return FONT_OPTIONS[state.fontPreset];
  }

  function domFontFamily() {
    const custom = state.customFont.trim();
    if (custom) {
      const safe = custom.replace(/[;{}]/g, '').replace(/["\\]/g, '').trim();
      if (safe) return `"${safe}", FZYouH, ${FONT_OPTIONS[state.fontPreset]}`;
    }
    const preset = FONT_OPTIONS[state.fontPreset];
    const genericIndex = preset.search(/(?:system-ui|-apple-system|serif|sans-serif)/);
    if (genericIndex === 0) {
      const firstComma = preset.indexOf(',');
      return firstComma > 0
        ? `${preset.slice(0, firstComma + 1)} FZYouH, ${preset.slice(firstComma + 1)}`
        : `${preset}, FZYouH`;
    }
    return genericIndex > 0
      ? `${preset.slice(0, genericIndex)}FZYouH, ${preset.slice(genericIndex)}`
      : `FZYouH, ${preset}`;
  }

  function detectDocumentKind(source) {
    const bodySource = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || source;
    const plainText = bodySource
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&(?:nbsp|ensp|emsp);/gi, ' ')
      .replace(/&#?\w+;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const hasMedia = /<(?:img|svg|video)\b/i.test(bodySource);
    if (hasMedia && plainText.length < 100) return 'media';

    const heading = (bodySource.match(/<h[1-3]\b[^>]*>([\s\S]*?)<\/h[1-3]>/i)?.[1] || '')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (/^目录(?:\s|$)/.test(heading)) return 'toc';
    const paragraphCount = (bodySource.match(/<p\b/gi) || []).length;
    const proseHeading = /(?:序章|楔子|引子|尾声|终章|后记|番外|第[〇零一二三四五六七八九十百千万两0-9]+[章节回卷部])/;
    if (proseHeading.test(heading) || (paragraphCount >= 4 && plainText.length >= 500)) return 'prose';
    return 'frontmatter';
  }

  function frameCss(kind = 'prose') {
    if (!state.enabled) return '';
    const isNight = state.theme === 'night';
    const profileCss = kind === 'media'
      ? `
        body {
          padding: 0 !important;
          overflow: hidden !important;
          display: grid !important;
          place-items: center !important;
        }
        body p {
          margin: 0 !important;
          padding: 0 !important;
          text-indent: 0 !important;
          line-height: 0 !important;
        }
        body :where(img, svg, video) {
          display: block !important;
          width: auto !important;
          height: auto !important;
          max-width: 100% !important;
          max-height: 100vh !important;
          margin: auto !important;
          object-fit: contain !important;
        }
      `
      : kind === 'toc'
        ? `
          body { padding-bottom: 3em !important; }
          body h1 { margin: 2em 0 1.2em !important; }
          .ir-toc-list { display: grid !important; gap: 0.5em !important; }
          .ir-toc-entry {
            display: grid !important;
            grid-template-columns: max-content minmax(2em, 1fr) max-content !important;
            align-items: baseline !important;
            gap: 0.65em !important;
            margin: 0 !important;
            padding: 0.2em 0 !important;
            font: inherit !important;
            color: inherit !important;
          }
          .ir-toc-title { min-width: 0 !important; }
          .ir-toc-leader {
            min-width: 2em !important;
            border-bottom: 1px dotted color-mix(in srgb, var(--ir-text) 38%, transparent) !important;
            transform: translateY(-0.28em) !important;
          }
          .ir-toc-page {
            min-width: 3ch !important;
            text-align: right !important;
            font-variant-numeric: tabular-nums !important;
            color: var(--ir-muted) !important;
          }
        `
        : kind === 'frontmatter'
        ? `
          body p {
            margin: 0.7em 0 !important;
            text-indent: 0 !important;
            overflow-wrap: break-word !important;
          }
          body p:empty { display: none !important; }
          body h1 { margin: 2em 0 1.1em !important; }
        `
        : `
          body p {
            margin: 0 0 var(--ir-space) !important;
            text-indent: 2em !important;
            text-align: justify !important;
            text-justify: inter-ideograph !important;
            overflow-wrap: break-word !important;
            hanging-punctuation: first last !important;
          }
          body p:empty { display: none !important; }
          body p:first-of-type { margin-top: 0 !important; }
        `;
    return `
      :root {
        color-scheme: ${isNight ? 'dark' : 'light'};
        --ir-font: ${fontFamily()};
        --ir-size: ${state.fontSize}px;
        --ir-line: ${state.lineHeight};
        --ir-letter: ${state.letterSpacing}em;
        --ir-space: ${state.paragraphSpacing}em;
        --ir-text: ${state.textColor};
        --ir-page: ${state.pageColor};
        --ir-muted: ${state.mutedColor};
        --ir-accent: ${state.accentColor};
        --ir-padding: ${state.pagePadding}px;
      }

      html, body {
        min-height: 100% !important;
        width: 100% !important;
        box-sizing: border-box !important;
        background: var(--ir-page) !important;
        color: var(--ir-text) !important;
        font-family: var(--ir-font) !important;
        font-size: var(--ir-size) !important;
        line-height: var(--ir-line) !important;
        letter-spacing: var(--ir-letter) !important;
        text-rendering: optimizeLegibility !important;
        -webkit-font-smoothing: antialiased !important;
        font-kerning: normal !important;
      }

      body {
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 var(--ir-padding) 3em !important;
        /*
         * EPUB.js 以 body.scrollHeight 设置 iframe 高度。若首个标题的上边距
         * 与 body 发生 margin collapse，这段距离不会计入 scrollHeight，
         * 字号/行距调整后就可能把章节末段压到 iframe 的裁切边界之外。
         */
        display: flow-root !important;
      }

      body :where(p, li, blockquote, dd, dt, div) {
        font-family: inherit !important;
        font-size: inherit !important;
        line-height: inherit !important;
        letter-spacing: inherit !important;
        color: inherit !important;
      }

      body :where(h1, h2, h3, h4, h5, h6) {
        color: var(--ir-text) !important;
        font-family: var(--ir-font) !important;
        line-height: 1.35 !important;
        letter-spacing: 0.03em !important;
        text-wrap: balance !important;
      }

      body h1 {
        margin: 2.2em 0 1.25em !important;
        font-size: 1.72em !important;
        font-weight: 650 !important;
      }

      body :where(h2, h3) {
        margin: 1.8em 0 1em !important;
        font-size: 1.3em !important;
      }

      body blockquote {
        margin: 1.2em 0 !important;
        padding: 0.2em 1.15em !important;
        border-left: 3px solid var(--ir-accent) !important;
        color: var(--ir-muted) !important;
      }

      body :where(a, a:visited) { color: var(--ir-accent) !important; }
      body :where(img, svg) { max-width: 100% !important; height: auto !important; }
      body :where(hr) { border: 0 !important; border-top: 1px solid color-mix(in srgb, var(--ir-text) 20%, transparent) !important; }
      ::selection { background: color-mix(in srgb, var(--ir-accent) 35%, transparent) !important; }
      ${profileCss}
    `;
  }

  function outerCss() {
    if (!state.enabled) return '';
    return `
      html { color-scheme: ${state.theme === 'night' ? 'dark' : 'light'}; }
      body { background: ${state.surroundColor} !important; }
      .reader-width {
        width: ${state.pageWidth}px !important;
        max-width: calc(100vw - 32px) !important;
      }
      .epub-reader {
        width: 100% !important;
        max-width: 100% !important;
        background: ${state.pageColor} !important;
        color: ${state.textColor} !important;
        box-shadow: 0 12px 38px rgb(0 0 0 / ${state.theme === 'night' ? '0.34' : '0.08'}) !important;
      }
      .epub-reader #reader-content,
      .epub-reader .epub-container,
      .epub-reader .epub-view,
      .epub-reader iframe {
        width: 100% !important;
        max-width: 100% !important;
      }
      .epub-reader button { color: ${state.mutedColor} !important; }

      /* 部分掌阅图书直接把正文渲染在主页面，不使用 EPUB iframe。 */
      .bookstore-reader {
        background: ${state.pageColor} !important;
        color: ${state.textColor} !important;
      }
      .bookstore-reader .book-content {
        color: ${state.textColor} !important;
        font-family: ${domFontFamily()} !important;
        letter-spacing: ${state.letterSpacing}em !important;
        text-rendering: optimizeLegibility !important;
        -webkit-font-smoothing: antialiased !important;
      }
      .bookstore-reader .book-content p {
        color: ${state.textColor} !important;
        font-family: ${domFontFamily()} !important;
        letter-spacing: ${state.letterSpacing}em !important;
      }
      .bookstore-reader .book-content p.bodytext {
        margin: 0 0 ${state.paragraphSpacing}em !important;
        font-size: ${state.fontSize}px !important;
        line-height: ${state.lineHeight} !important;
        text-indent: 2em !important;
        text-align: justify !important;
        text-justify: inter-ideograph !important;
        overflow-wrap: break-word !important;
      }
      .bookstore-reader .book-content p[class^="preface-text"] {
        font-size: ${state.fontSize}px !important;
        line-height: ${state.lineHeight} !important;
      }
      .bookstore-reader .book-content p[class*="bodytext-"] {
        font-size: ${Math.max(14, state.fontSize * 0.92)}px !important;
        line-height: ${Math.max(1.5, state.lineHeight * 0.92)} !important;
      }
      .bookstore-reader .book-content :where(h1, h2, h3, h4, h5, h6) {
        color: ${state.textColor} !important;
        font-family: ${domFontFamily()} !important;
        line-height: 1.35 !important;
        letter-spacing: 0.03em !important;
        text-wrap: balance !important;
      }
      .bookstore-reader .book-content h1 {
        font-size: ${state.fontSize * 1.72}px !important;
        margin-bottom: 1.2em !important;
      }
      .bookstore-reader .book-content .copyright-text {
        font-size: ${Math.max(14, state.fontSize * 0.9)}px !important;
        line-height: 1.7 !important;
      }
      .bookstore-reader .book-content .copyright-text1 {
        font-size: ${Math.max(13, state.fontSize * 0.82)}px !important;
        line-height: 1.65 !important;
      }
    `;
  }

  function ensureOuterStyle() {
    if (!document.head) return;
    let style = document.getElementById(OUTER_STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = OUTER_STYLE_ID;
      document.head.append(style);
    }
    style.textContent = outerCss();
  }

  function escapeStyleEnd(css) {
    return css.replace(/<\/style/gi, '<\\/style');
  }

  function frameStylePattern() {
    return new RegExp(`<style\\s+id=["']${FRAME_STYLE_ID}["'][^>]*>[\\s\\S]*?<\\/style>`, 'i');
  }

  function frameBridgePattern() {
    return new RegExp(`<script\\s+id=["']${FRAME_BRIDGE_ID}["'][^>]*>[\\s\\S]*?<\\/script>`, 'i');
  }

  function frameHeightBridge() {
    return `<script id="${FRAME_BRIDGE_ID}">
      (() => {
        let queued = false;
        const report = () => {
          queued = false;
          const body = document.body;
          if (!body) return;
          const height = Math.ceil(body.scrollHeight) + 2;
          parent.postMessage({ type: '${FRAME_HEIGHT_MESSAGE}', height }, '*');
        };
        const schedule = () => {
          if (queued) return;
          queued = true;
          requestAnimationFrame(report);
        };
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', schedule, { once: true });
        } else {
          schedule();
        }
        addEventListener('load', schedule, { once: true });
        document.fonts?.ready.then(schedule).catch(() => {});
        if ('ResizeObserver' in window) {
          const resizeObserver = new ResizeObserver(schedule);
          const observeBody = () => {
            if (document.body) resizeObserver.observe(document.body);
            if (document.documentElement) resizeObserver.observe(document.documentElement);
          };
          if (document.body) observeBody();
          else document.addEventListener('DOMContentLoaded', observeBody, { once: true });
        }
        setTimeout(schedule, 120);
        setTimeout(schedule, 600);
        setTimeout(schedule, 1600);
      })();
    <\/script>`;
  }

  function syncFrameHeight(frame, height) {
    const pixelHeight = `${height}px`;
    frameHeightTargets.set(frame, height);
    if (frame.style.height !== pixelHeight) frame.style.height = pixelHeight;
    const view = frame.closest('.epub-view');
    if (view && view.style.height !== pixelHeight) view.style.height = pixelHeight;
  }

  function enforceFrameHeights() {
    document.querySelectorAll('iframe[srcdoc]').forEach((frame) => {
      const height = frameHeightTargets.get(frame);
      if (height) syncFrameHeight(frame, height);
    });
  }

  function handleFrameHeightMessage(event) {
    const data = event.data;
    if (!data || data.type !== FRAME_HEIGHT_MESSAGE) return;
    const height = Math.ceil(Number(data.height));
    if (!Number.isFinite(height) || height < 100 || height > 5000000) return;

    const frame = [...document.querySelectorAll('iframe[srcdoc]')]
      .find((candidate) => candidate.contentWindow === event.source);
    if (!frame || !frame.getAttribute('srcdoc')?.includes(FRAME_BRIDGE_ID)) return;

    syncFrameHeight(frame, height);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function normalizeTocSource(source) {
    let normalized = source.replace(/<parsererror\b[^>]*>[\s\S]*?<\/parsererror>/gi, '');
    const bodyMatch = normalized.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i);
    if (!bodyMatch) return normalized;

    const paragraphTexts = [...bodyMatch[1].matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].map((match) => match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim());
    const entries = [];
    const entryPattern = /((?:序章|楔子|引子|尾声|终章|后记|番外|第[〇零一二三四五六七八九十百千万两0-9]+章)[^/]*?)\/\s*(\d+)/g;
    for (const text of paragraphTexts) {
      for (const match of text.matchAll(entryPattern)) {
        entries.push({ title: match[1].trim(), page: match[2] });
      }
    }
    if (entries.length < 2) return normalized;

    const rows = entries.map(({ title, page }) => `
      <div class="ir-toc-entry">
        <span class="ir-toc-title">${escapeHtml(title)}</span>
        <span class="ir-toc-leader" aria-hidden="true"></span>
        <span class="ir-toc-page">${escapeHtml(page)}</span>
      </div>`).join('');
    const body = `<body><h1>目录</h1><nav class="ir-toc-list" aria-label="目录">${rows}</nav></body>`;
    return normalized.replace(/<body\b[^>]*>[\s\S]*?<\/body>/i, body);
  }

  function patchSource(source) {
    let cleanSource = String(source || '')
      .replace(frameStylePattern(), '')
      .replace(frameBridgePattern(), '');
    if (!cleanSource) return cleanSource;
    let kind = detectDocumentKind(cleanSource);
    // 掌阅的封面资源是短命 blob: URL。任何 srcdoc 改写都会触发 iframe 重载，
    // 令图片失效，所以媒体页必须原样返回，连空样式标签也不能加入。
    if (kind === 'media') return cleanSource;
    // 部分 EPUB 自带错误闭合标签，浏览器会把粉色 parsererror 框序列化进 srcdoc。
    // 保留浏览器已经恢复出的正文，仅移除诊断框，再按实际内容重新分类。
    cleanSource = cleanSource.replace(/<parsererror\b[^>]*>[\s\S]*?<\/parsererror>/gi, '');
    kind = detectDocumentKind(cleanSource);
    if (kind === 'toc') {
      cleanSource = normalizeTocSource(cleanSource);
      kind = 'toc';
    }
    const style = `<style id="${FRAME_STYLE_ID}" data-kind="${kind}">${escapeStyleEnd(frameCss(kind))}</style>`;
    const bridge = frameHeightBridge();
    return /<\/head\s*>/i.test(cleanSource)
      ? cleanSource.replace(/<\/head\s*>/i, `${style}${bridge}</head>`)
      : style + bridge + cleanSource;
  }

  function patchFrame(frame) {
    const source = frame.getAttribute('srcdoc');
    if (!source) return false;

    const cleanSource = source
      .replace(frameStylePattern(), '')
      .replace(frameBridgePattern(), '');
    const kind = detectDocumentKind(cleanSource);
    // 媒体页只能在 iframe 首次加载前注入；事后重载会令掌阅生成的 blob: 封面地址失效。
    if (kind === 'media') {
      frameHeightTargets.delete(frame);
      return false;
    }
    const nextSource = patchSource(cleanSource);

    if (nextSource === source) return false;
    frameHeightTargets.delete(frame);
    frame.setAttribute('srcdoc', nextSource);
    return true;
  }

  function translateObfuscatedText(text) {
    return String(text || '').replace(OBFUSCATED_CHAR_PATTERN, (character) => OBFUSCATED_CHAR_MAP.get(character) || character);
  }

  function restoreDecodedText() {
    for (const [node, original] of decodedTextNodes) {
      if (!node.isConnected) {
        decodedTextNodes.delete(node);
        continue;
      }
      if (node.nodeValue === translateObfuscatedText(original)) node.nodeValue = original;
      decodedTextNodes.delete(node);
    }
  }

  function decodeObfuscatedText() {
    if (!state.enabled || !state.decodeObfuscated) {
      restoreDecodedText();
      return 0;
    }

    let replacements = 0;
    document.querySelectorAll('.bookstore-reader .book-content').forEach((root) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const parentTag = node.parentElement?.tagName;
        if (!node.nodeValue || /^(?:SCRIPT|STYLE|NOSCRIPT|TEXTAREA)$/.test(parentTag || '')) continue;
        const translated = translateObfuscatedText(node.nodeValue);
        if (translated === node.nodeValue) continue;
        decodedTextNodes.set(node, node.nodeValue);
        replacements += [...node.nodeValue.matchAll(OBFUSCATED_CHAR_PATTERN)].length;
        node.nodeValue = translated;
      }
    });
    for (const node of decodedTextNodes.keys()) {
      if (!node.isConnected) decodedTextNodes.delete(node);
    }
    return replacements;
  }

  function applyAll() {
    window.clearTimeout(applyTimer);
    if (!readerActive || !isReaderPage()) return;
    ensureOuterStyle();
    createUi();
    decodeObfuscatedText();
    document.querySelectorAll('iframe[srcdoc]').forEach(patchFrame);
    enforceFrameHeights();
    syncUi();
  }

  function scheduleApply() {
    if (!readerActive) return;
    window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(applyAll, 60);
  }

  function setState(patch) {
    state = sanitizeState({ ...state, ...patch });
    saveState();
    if (readerActive) applyAll();
  }

  function applyTheme(name) {
    if (!THEMES[name]) return;
    setState({ theme: name, ...THEMES[name] });
  }

  function createUi() {
    if (!document.body || document.getElementById(UI_HOST_ID)) return;
    const host = document.createElement('div');
    host.id = UI_HOST_ID;
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        *, *::before, *::after { box-sizing: border-box; }
        button, input, select { font: inherit; }
        #toggle {
          position: fixed; z-index: 2147483646; right: 22px; bottom: 24px;
          width: 48px; height: 48px; border: 0; border-radius: 50%;
          color: #fff; background: #6e5137; box-shadow: 0 8px 24px rgb(0 0 0 / .22);
          font: 700 16px/1 system-ui, sans-serif; cursor: pointer;
        }
        #toggle:hover { transform: translateY(-1px); }
        #panel {
          position: fixed; z-index: 2147483645; right: 22px; bottom: 82px;
          width: min(330px, calc(100vw - 32px)); max-height: min(720px, calc(100vh - 110px));
          overflow: auto; padding: 18px; border: 1px solid rgb(95 74 55 / .18); border-radius: 16px;
          color: #302a25; background: rgb(252 249 242 / .97); box-shadow: 0 18px 48px rgb(0 0 0 / .18);
          backdrop-filter: blur(14px); font: 14px/1.45 system-ui, "Microsoft YaHei UI", sans-serif;
          transform-origin: right bottom;
        }
        #panel[hidden] { display: none; }
        header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
        h2 { margin: 0; font-size: 16px; }
        .enabled { display: flex; gap: 7px; align-items: center; color: #655b52; }
        .themes { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-bottom: 14px; }
        .theme, #reset, .font-action {
          border: 1px solid #d7cec2; border-radius: 9px; padding: 7px 8px; color: #4b4037; background: #fffdf8; cursor: pointer;
        }
        .font-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin: -3px 0 11px 88px; }
        .font-action:disabled { opacity: .48; cursor: not-allowed; }
        .theme[aria-pressed="true"] { border-color: #7a5c3e; color: #fff; background: #7a5c3e; }
        label.control { display: grid; grid-template-columns: 88px 1fr 48px; gap: 8px; align-items: center; margin: 11px 0; }
        label.control.wide { grid-template-columns: 88px 1fr; }
        output { color: #786d64; text-align: right; font-variant-numeric: tabular-nums; }
        input[type="range"] { width: 100%; accent-color: #7a5c3e; }
        input[type="text"], select {
          min-width: 0; width: 100%; border: 1px solid #d7cec2; border-radius: 8px; padding: 7px 8px; color: #3e3731; background: #fff;
        }
        input[type="color"] { width: 42px; height: 30px; padding: 2px; border: 1px solid #d7cec2; border-radius: 7px; background: #fff; }
        .colors { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
        .color { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: #655b52; }
        .decode-option { display: flex; align-items: center; gap: 8px; margin: 12px 0 4px; color: #51483f; }
        .decode-note { display: block; margin-left: 24px; color: #8a8178; }
        footer { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid #e5ddd3; }
        small { color: #8a8178; }
      </style>
      <button id="toggle" type="button" title="阅读排版设置（Alt+R）">Aa</button>
      <section id="panel" aria-label="阅读排版设置" hidden>
        <header>
          <h2>阅读排版</h2>
          <label class="enabled"><input id="enabled" type="checkbox">启用</label>
        </header>
        <div class="themes">
          ${Object.entries(THEMES).map(([key, theme]) => `<button class="theme" type="button" data-theme="${key}">${theme.label}</button>`).join('')}
        </div>
        <label class="control wide"><span>字体</span><select id="fontPreset">
          <option value="serif">中文宋体</option><option value="wenkai">霞鹜文楷</option>
          <option value="sans">中文黑体</option><option value="system">系统界面</option>
        </select></label>
        <label class="control wide"><span>自定义字体</span><input id="customFont" type="text" placeholder="例如：方正屏显雅宋"></label>
        <label class="control wide"><span>已保存字体</span><select id="savedFonts" aria-label="已保存字体"></select></label>
        <div class="font-actions">
          <button id="saveFont" class="font-action" type="button">保存当前</button>
          <button id="deleteFont" class="font-action" type="button">删除所选</button>
        </div>
        <label class="decode-option"><input id="decodeObfuscated" type="checkbox">解码混淆字形</label>
        <small class="decode-note">将掌阅私用区字形还原为正常汉字</small>
        ${rangeControl('fontSize', '字号', 14, 30, 0.5)}
        ${rangeControl('lineHeight', '行距', 1.35, 2.6, 0.05)}
        ${rangeControl('letterSpacing', '字距', 0, 0.15, 0.005)}
        ${rangeControl('paragraphSpacing', '段距', 0, 2.4, 0.05)}
        ${rangeControl('pageWidth', '版心宽度', 640, 1120, 10)}
        ${rangeControl('pagePadding', '页边距', 24, 140, 2)}
        <div class="colors">
          ${colorControl('textColor', '文字')}${colorControl('pageColor', '纸张')}
          ${colorControl('surroundColor', '页面外')}${colorControl('accentColor', '强调色')}
        </div>
        <footer><small>Alt+R 显示/隐藏</small><button id="reset" type="button">恢复默认</button></footer>
      </section>
    `;

    root.getElementById('toggle').addEventListener('click', () => setState({ panelOpen: !state.panelOpen }));
    root.getElementById('enabled').addEventListener('change', (event) => setState({ enabled: event.target.checked }));
    root.getElementById('decodeObfuscated').addEventListener('change', (event) => setState({ decodeObfuscated: event.target.checked }));
    root.querySelectorAll('[data-theme]').forEach((button) => button.addEventListener('click', () => applyTheme(button.dataset.theme)));

    ['fontPreset', 'textColor', 'pageColor', 'surroundColor', 'accentColor'].forEach((id) => {
      const input = root.getElementById(id);
      input.addEventListener('input', (event) => setState({ [id]: event.target.value }));
    });

    const customFontInput = root.getElementById('customFont');
    // 页面内容持续变化时，MutationObserver 会调用 syncUi。输入过程中先把草稿写入
    // state，避免同步旧值覆盖正在键入的文字；失焦后再重排 EPUB，防止每次按键重载。
    customFontInput.addEventListener('input', (event) => {
      state = sanitizeState({ ...state, customFont: event.target.value });
      saveState();
    });
    customFontInput.addEventListener('change', applyAll);
    customFontInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        saveCurrentFont();
      }
    });

    const savedFontsSelect = root.getElementById('savedFonts');
    savedFontsSelect.addEventListener('change', (event) => {
      if (event.target.value) setState({ customFont: event.target.value });
    });
    root.getElementById('saveFont').addEventListener('click', saveCurrentFont);
    root.getElementById('deleteFont').addEventListener('click', () => {
      const selected = savedFontsSelect.value;
      if (!selected) return;
      const customFonts = state.customFonts.filter((name) => name !== selected);
      setState({ customFonts, customFont: state.customFont === selected ? '' : state.customFont });
    });

    function saveCurrentFont() {
      const name = customFontInput.value.replace(/[;{}]/g, '').replace(/["\\]/g, '').trim().slice(0, 160);
      if (!name) return;
      setState({ customFont: name, customFonts: [...state.customFonts, name] });
      customFontInput.blur();
    }

    ['fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'pageWidth', 'pagePadding'].forEach((id) => {
      root.getElementById(id).addEventListener('input', (event) => setState({ [id]: Number(event.target.value) }));
    });

    root.getElementById('reset').addEventListener('click', () => {
      state = { ...DEFAULTS, customFonts: state.customFonts, panelOpen: true };
      saveState();
      applyAll();
    });
    syncUi();
  }

  function rangeControl(id, label, min, max, step) {
    return `<label class="control"><span>${label}</span><input id="${id}" type="range" min="${min}" max="${max}" step="${step}"><output data-for="${id}"></output></label>`;
  }

  function colorControl(id, label) {
    return `<label class="color"><span>${label}</span><input id="${id}" type="color"></label>`;
  }

  function syncSavedFonts(root) {
    const select = root.getElementById('savedFonts');
    const selected = state.customFonts.includes(state.customFont) ? state.customFont : '';
    const options = `<option value="">选择已保存字体</option>${state.customFonts
      .map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
    if (select.innerHTML !== options) select.innerHTML = options;
    select.value = selected;
    root.getElementById('deleteFont').disabled = !selected;
  }

  function syncUi() {
    const root = document.getElementById(UI_HOST_ID)?.shadowRoot;
    if (!root) return;
    root.getElementById('panel').hidden = !state.panelOpen;
    root.getElementById('enabled').checked = state.enabled;
    root.getElementById('decodeObfuscated').checked = state.decodeObfuscated;
    root.getElementById('fontPreset').value = state.fontPreset;
    const customFontInput = root.getElementById('customFont');
    if (root.activeElement !== customFontInput) customFontInput.value = state.customFont;
    syncSavedFonts(root);
    ['textColor', 'pageColor', 'surroundColor', 'accentColor'].forEach((id) => { root.getElementById(id).value = state[id]; });
    ['fontSize', 'lineHeight', 'letterSpacing', 'paragraphSpacing', 'pageWidth', 'pagePadding'].forEach((id) => {
      root.getElementById(id).value = state[id];
      const suffix = id === 'fontSize' || id === 'pageWidth' || id === 'pagePadding' ? 'px' : id === 'letterSpacing' || id === 'paragraphSpacing' ? 'em' : '';
      root.querySelector(`[data-for="${id}"]`).textContent = `${state[id]}${suffix}`;
    });
    root.querySelectorAll('[data-theme]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.theme === state.theme)));
  }

  function isReaderPage() {
    return /^\/reader(?:\/|$)/.test(location.pathname);
  }

  function activateReader() {
    if (!document.documentElement) return;
    if (!readerActive) {
      readerActive = true;
      observer ||= new MutationObserver(scheduleApply);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['srcdoc', 'style'],
      });
    }
    scheduleApply();
  }

  function deactivateReader() {
    if (!readerActive) return;
    readerActive = false;
    window.clearTimeout(applyTimer);
    observer?.disconnect();
    restoreDecodedText();
    document.getElementById(OUTER_STYLE_ID)?.remove();
    document.getElementById(UI_HOST_ID)?.remove();
  }

  function syncRoute() {
    if (isReaderPage()) activateReader();
    else deactivateReader();
  }

  function installRouteWatch() {
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method];
      history[method] = function (...args) {
        const result = original.apply(this, args);
        queueMicrotask(syncRoute);
        return result;
      };
    }
    window.addEventListener('popstate', syncRoute);
    window.addEventListener('hashchange', syncRoute);
    routeCheckTimer = window.setInterval(syncRoute, 500);
  }

  function start() {
    window.addEventListener('message', handleFrameHeightMessage);
    syncRoute();
  }

  document.addEventListener('keydown', (event) => {
    if (readerActive && event.altKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      setState({ panelOpen: !state.panelOpen });
    }
  });

  installRouteWatch();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();

