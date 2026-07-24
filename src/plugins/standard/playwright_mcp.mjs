/**
 * F.4 smart_pw_browser — Playwright Browser Automation
 *
 * Layer 2: Plugin Split — browser operations are separate from crawling.
 *
 * LLM uses this when it needs to interact with a browser:
 *   - Navigate to a page
 *   - Get page text / accessibility tree
 *   - Click elements, fill forms, select dropdowns, hover, drag
 *   - Keyboard operations (press keys, type text)
 *   - Scroll page
 *   - Wait for elements
 *   - Manage multiple tabs
 *   - Upload files
 *   - Take screenshots
 *   - Execute JavaScript
 *
 * NOT for: reading/crawling article content (use smart_exa_crawl with --clean).
 * NOT for: searching the web (use smart_exa_search).
 *
 * Uses playwright directly (optional dependency, dynamic import).
 */

let _browser = null;
let _context = null;
let _page = null;

/**
 * Ensure Playwright browser is launched (lazy init).
 */
async function launchBrowser() {
  if (_page) return;

  let pw;
  try {
    pw = await import('playwright');
  } catch {
    throw new Error(
      'Package playwright is not installed.\n'
      + 'Install it with: npm install playwright\n'
      + 'Then: npx playwright install chromium'
    );
  }

  try {
    _browser = await pw.chromium.launch({ headless: true });
    _context = await _browser.newContext({
      viewport: { width: 1280, height: 720 },
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Smart-MCP/1.0',
    });
    _page = await _context.newPage();
  } catch (err) {
    throw new Error(
      'Failed to launch Playwright browser.\n'
      + 'Make sure Chromium is installed: npx playwright install chromium\n'
      + `Error: ${err.message}`
    );
  }
}

/**
 * Execute a browser command.
 */
async function doCommand(command, args = {}) {
  await launchBrowser();
  if (!_page) throw new Error('Browser not initialized');

  switch (command) {
    // ── 基本導航 ──────────────────────────────────────────────
    case 'navigate': {
      const url = args.url || args;
      if (!url) throw new Error('url is required for navigate');
      await _page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { ok: true, output: `Navigated to ${_page.url()} — title: ${await _page.title()}` };
    }

    case 'snapshot': {
      const title = await _page.title();
      const url = _page.url();
      const text = await _page.evaluate(() => document.body?.innerText || '');
      const links = await _page.evaluate(() =>
        Array.from(document.querySelectorAll('a[href]')).slice(0, 50).map(a => ({
          text: a.textContent?.trim()?.substring(0, 100),
          href: a.getAttribute('href'),
        }))
      );
      const output = `[${title}](${url})\n\n${text.substring(0, 10000)}\n\nLinks:\n${links.map(l => `  ${l.text} → ${l.href}`).join('\n')}`;
      return { ok: true, output };
    }

    // ── 元素互動 ──────────────────────────────────────────────
    case 'click': {
      const selector = args.selector || args.text || args;
      if (!selector) throw new Error('selector is required for click');
      // Try as text first, then as CSS selector
      try {
        const byText = _page.locator(`text=${selector}`).first();
        if (await byText.isVisible({ timeout: 2000 }).catch(() => false)) {
          await byText.click();
          return { ok: true, output: `Clicked '${selector}' (by text) → ${_page.url()}` };
        }
      } catch { /* fall through to CSS selector */ }

      // CSS selector
      const byCss = _page.locator(selector).first();
      await byCss.waitFor({ state: 'visible', timeout: 5000 });
      await byCss.click();
      return { ok: true, output: `Clicked '${selector}' (by CSS) → ${_page.url()}` };
    }

    case 'fill': {
      const selector = args.selector;
      const value = args.value || '';
      if (!selector) throw new Error('selector is required for fill');
      const element = _page.locator(selector).first();
      await element.waitFor({ state: 'visible', timeout: 5000 });
      await element.fill(value);
      return { ok: true, output: `Filled '${selector}' → ${_page.url()}` };
    }

    case 'select': {
      const selector = args.selector;
      if (!selector) throw new Error('selector is required for select');
      const el = _page.locator(selector).first();
      await el.waitFor({ state: 'visible', timeout: 5000 });
      if (args.value != null) {
        await el.selectOption({ value: String(args.value) });
      } else if (args.label != null) {
        await el.selectOption({ label: String(args.label) });
      } else if (args.index != null) {
        await el.selectOption({ index: Number(args.index) });
      } else {
        throw new Error('select requires value, label, or index');
      }
      const selected = await el.evaluate(sel => {
        const opt = sel.options[sel.selectedIndex];
        return opt ? { value: opt.value, label: opt.text, index: sel.selectedIndex } : null;
      });
      return { ok: true, output: `Selected '${selector}' → ${JSON.stringify(selected)}` };
    }

    case 'hover': {
      const selector = args.selector || args.text || args;
      if (!selector) throw new Error('selector is required for hover');
      const hoverEl = _page.locator(selector).first();
      await hoverEl.waitFor({ state: 'visible', timeout: 5000 });
      await hoverEl.hover();
      return { ok: true, output: `Hovered '${selector}' → ${_page.url()}` };
    }

    case 'drag': {
      const from = args.from;
      const to = args.to;
      if (!from || !to) throw new Error('from and to selectors are required for drag');
      const source = _page.locator(from).first();
      const target = _page.locator(to).first();
      await source.waitFor({ state: 'visible', timeout: 5000 });
      await target.waitFor({ state: 'visible', timeout: 5000 });
      await source.dragTo(target);
      return { ok: true, output: `Dragged '${from}' → '${to}' → ${_page.url()}` };
    }

    // ── 鍵盤操作 ──────────────────────────────────────────────
    case 'keyboard': {
      const action = args.action || 'press';
      if (action === 'type') {
        const text = args.text;
        if (text == null) throw new Error('text is required for keyboard type');
        await _page.keyboard.type(text, { delay: args.delay || 0 });
        return { ok: true, action: 'type', text };
      }
      const key = args.key;
      if (!key) throw new Error('key is required for keyboard press');
      await _page.keyboard.press(key);
      return { ok: true, action: 'press', key };
    }

    // ── 滾動 ──────────────────────────────────────────────────
    case 'scroll': {
      const direction = args.direction || 'down';
      const pixels = args.pixels || 500;
      const selector = args.selector;
      if (selector) {
        const scrollEl = _page.locator(selector).first();
        await scrollEl.scrollIntoViewIfNeeded();
        return { ok: true, action: 'scrollTo', selector };
      }
      if (direction === 'top') {
        await _page.evaluate(() => window.scrollTo(0, 0));
      } else if (direction === 'bottom') {
        await _page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      } else if (direction === 'left' || direction === 'right') {
        const delta = direction === 'right' ? pixels : -pixels;
        await _page.evaluate((d) => window.scrollBy(d, 0), delta);
      } else {
        const delta = direction === 'up' ? -pixels : pixels;
        await _page.evaluate((d) => window.scrollBy(0, d), delta);
      }
      const pos = await _page.evaluate(() => ({ x: window.scrollX, y: window.scrollY, max: document.body.scrollHeight }));
      return { ok: true, action: `scroll_${direction}`, position: pos };
    }

    // ── 等待 ──────────────────────────────────────────────────
    case 'wait_for': {
      const selector = args.selector;
      const timeout = args.timeout || 10000;
      const state = args.state || 'visible';
      if (!selector) throw new Error('selector is required for wait_for');
      const waitEl = _page.locator(selector).first();
      await waitEl.waitFor({ state, timeout });
      return { ok: true, selector, state };
    }

    // ── 分頁管理 ──────────────────────────────────────────────
    case 'tabs': {
      const action = args.action || 'list';
      if (action === 'list') {
        const pages = _context.pages().map((p, i) => ({
          index: i,
          url: p.url(),
          title: p.title(),
          active: p === _page,
        }));
        return { ok: true, tabs: pages };
      }
      if (action === 'new') {
        const newPage = await _context.newPage();
        if (args.url) {
          await newPage.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        }
        _page = newPage;
        return { ok: true, action: 'new', url: newPage.url(), title: await newPage.title() };
      }
      if (action === 'close') {
        const pages = _context.pages();
        const idx = args.index ?? (pages.length - 1);
        if (idx < 0 || idx >= pages.length) throw new Error(`Invalid tab index: ${idx}`);
        if (pages.length <= 1) throw new Error('Cannot close the last tab');
        const closing = pages[idx];
        await closing.close();
        if (closing === _page) {
          _page = _context.pages()[Math.min(idx, _context.pages().length - 1)];
        }
        return { ok: true, action: 'closed', index: idx };
      }
      if (action === 'switch') {
        const idx = args.index;
        if (idx == null) throw new Error('index is required for tab switch');
        const pages = _context.pages();
        if (idx < 0 || idx >= pages.length) throw new Error(`Invalid tab index: ${idx}`);
        _page = pages[idx];
        return { ok: true, action: 'switch', index: idx, url: _page.url(), title: await _page.title() };
      }
      throw new Error(`Unknown tab action: ${action}. Use: list, new, close, switch`);
    }

    // ── 檔案上傳 ──────────────────────────────────────────────
    case 'upload': {
      const selector = args.selector;
      const filePath = args.filePath || args.path;
      if (!selector) throw new Error('selector is required for upload');
      if (!filePath) throw new Error('filePath is required for upload');
      const uploadEl = _page.locator(selector).first();
      await uploadEl.setInputFiles(filePath);
      return { ok: true, selector, filePath };
    }

    // ── 截圖 ──────────────────────────────────────────────────
    case 'screenshot': {
      const fullPage = args.fullPage !== false;
      const screenshot = await _page.screenshot({ fullPage, type: 'png' });
      return {
        ok: true,
        mimeType: 'image/png',
        size: screenshot.length,
        base64: screenshot.toString('base64'),
      };
    }

    // ── JavaScript 執行 ───────────────────────────────────────
    case 'run_code': {
      const code = args.code || args;
      if (!code) throw new Error('code is required for run_code');
      const result = await _page.evaluate(code);
      return { ok: true, result };
    }

    default:
      throw new Error(
        `Unknown command: ${command}. `
        + 'Supported: navigate, snapshot, click, fill, select, hover, drag, keyboard, scroll, wait_for, tabs, upload, screenshot, run_code'
      );
  }
}

/**
 * Cleanup browser resources.
 */
export async function cleanupBrowser() {
  if (_page) { try { await _page.close(); } catch {} _page = null; }
  if (_context) { try { await _context.close(); } catch {} _context = null; }
  if (_browser) { try { await _browser.close(); } catch {} _browser = null; }
}

// ---------------------------------------------------------------------------
// Handler (called by loader via default.handler)
// ---------------------------------------------------------------------------

async function handler(args = {}) {
  const command = (args.command || '').toLowerCase();
  if (!command) {
    return {
      ok: false,
      error: 'command is required. Supported: navigate, snapshot, click, fill, select, hover, drag, keyboard, scroll, wait_for, tabs, upload, screenshot, run_code',
    };
  }

  const validCommands = ['navigate', 'snapshot', 'click', 'fill', 'select', 'hover', 'drag', 'keyboard', 'scroll', 'wait_for', 'tabs', 'upload', 'screenshot', 'run_code'];
  if (!validCommands.includes(command)) {
    return {
      ok: false,
      error: `Unknown command: ${command}. Supported: ${validCommands.join(', ')}`,
    };
  }

  try {
    return await doCommand(command, args);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// Plugin definition
// ---------------------------------------------------------------------------

export default {
  name: 'smart_pw_browser',
  category: 'standard',
  description: 'Control a web browser with full Playwright automation — navigate, interact, form-fill, screenshots, tabs, keyboard, drag, file upload, and JavaScript execution.\n\n'
    + 'Commands:\n'
    + '  navigate(url):                 Browse to a URL\n'
    + '  snapshot():                    Get page text + links\n'
    + '  click(selector):               Click element (text or CSS selector)\n'
    + '  fill(selector, value):         Fill a form field\n'
    + '  select(selector, value/label): Select dropdown option\n'
    + '  hover(selector):               Hover over element\n'
    + '  drag(from, to):                Drag element from one selector to another\n'
    + '  keyboard(action, key/text):    Press key (Control+a, Enter) or type text\n'
    + '  scroll(direction, pixels):     Scroll up/down/left/right/top/bottom or to selector\n'
    + '  wait_for(selector, state):     Wait for element (visible/hidden/attached/detached)\n'
    + '  tabs(action):                  Manage tabs (list/new/close/switch)\n'
    + '  upload(selector, filePath):    Upload file to input element\n'
    + '  screenshot():                  Capture page as PNG (base64)\n'
    + '  run_code(code):                Execute JavaScript in the page\n\n'
    + 'NOT for: reading article content (use smart_exa_crawl with --clean).\n'
    + 'NOT for: searching the web (use smart_exa_search).',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['navigate', 'snapshot', 'click', 'fill', 'select', 'hover', 'drag', 'keyboard', 'scroll', 'wait_for', 'tabs', 'upload', 'screenshot', 'run_code'],
        description: 'Browser action to perform',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (navigate, tabs new)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector or text content for element interaction',
      },
      value: {
        type: 'string',
        description: 'Value for fill/select',
      },
      label: {
        type: 'string',
        description: 'Label for select dropdown option',
      },
      index: {
        type: 'number',
        description: 'Index for select or tab operations',
      },
      text: {
        type: 'string',
        description: 'Text for click-by-text or keyboard type',
      },
      from: {
        type: 'string',
        description: 'Source selector for drag',
      },
      to: {
        type: 'string',
        description: 'Target selector for drag',
      },
      key: {
        type: 'string',
        description: 'Key for keyboard press (e.g. Enter, Tab, Control+a, Escape)',
      },
      action: {
        type: 'string',
        description: 'Sub-action: keyboard (press/type), scroll direction, tabs (list/new/close/switch), wait_for state',
      },
      direction: {
        type: 'string',
        enum: ['up', 'down', 'left', 'right', 'top', 'bottom'],
        description: 'Scroll direction (default: down)',
      },
      pixels: {
        type: 'number',
        description: 'Pixels to scroll (default: 500)',
      },
      state: {
        type: 'string',
        enum: ['visible', 'hidden', 'attached', 'detached'],
        description: 'Element state to wait for (default: visible)',
      },
      timeout: {
        type: 'number',
        description: 'Timeout in ms for wait_for (default: 10000)',
      },
      filePath: {
        type: 'string',
        description: 'File path for upload',
      },
      code: {
        type: 'string',
        description: 'JavaScript code to execute in page context (run_code)',
      },
      fullPage: {
        type: 'boolean',
        description: 'Capture full page screenshot (default: true, screenshot only)',
      },
    },
    required: ['command'],
  },
  handler,
};
