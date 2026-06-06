/**
 * F.4 smart_pw_browser — Playwright Browser Automation
 *
 * Layer 2: Plugin Split — browser operations are separate from crawling.
 *
 * LLM uses this when it needs to interact with a browser:
 *   - Navigate to a page
 *   - Get page text / accessibility tree
 *   - Click elements, fill forms
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
    case 'navigate': {
      const url = args.url || args;
      if (!url) throw new Error('url is required for navigate');
      await _page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      return { ok: true, url: _page.url(), title: await _page.title() };
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
      return {
        ok: true,
        url,
        title,
        text: text.substring(0, 10000),
        links,
      };
    }

    case 'click': {
      const selector = args.selector || args.text || args;
      if (!selector) throw new Error('selector is required for click');
      // Try as text first, then as CSS selector
      try {
        // Try text content match
        const byText = _page.locator(`text=${selector}`).first();
        if (await byText.isVisible({ timeout: 2000 }).catch(() => false)) {
          await byText.click();
          return { ok: true, url: _page.url(), title: await _page.title(), matchedBy: 'text' };
        }
      } catch { /* fall through to CSS selector */ }

      // CSS selector
      const byCss = _page.locator(selector).first();
      await byCss.waitFor({ state: 'visible', timeout: 5000 });
      await byCss.click();
      return { ok: true, url: _page.url(), title: await _page.title(), matchedBy: 'css' };
    }

    case 'fill': {
      const selector = args.selector;
      const value = args.value || '';
      if (!selector) throw new Error('selector is required for fill');
      const element = _page.locator(selector).first();
      await element.waitFor({ state: 'visible', timeout: 5000 });
      await element.fill(value);
      return { ok: true, url: _page.url(), title: await _page.title() };
    }

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

    case 'run_code': {
      const code = args.code || args;
      if (!code) throw new Error('code is required for run_code');
      const result = await _page.evaluate(code);
      return { ok: true, result };
    }

    default:
      throw new Error(
        `Unknown command: ${command}. `
        + 'Supported: navigate, snapshot, click, fill, screenshot, run_code'
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
      error: 'command is required. Supported: navigate, snapshot, click, fill, screenshot, run_code',
    };
  }

  const validCommands = ['navigate', 'snapshot', 'click', 'fill', 'screenshot', 'run_code'];
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
  description: 'Control a web browser — navigate, click, fill forms, screenshot, execute JavaScript.\n\n'
    + 'Commands:\n'
    + '  navigate(url):   Browse to a URL\n'
    + '  snapshot():      Get page text + links\n'
    + '  click(selector): Click element (text or CSS selector)\n'
    + '  fill(selector, value): Fill a form field\n'
    + '  screenshot():    Capture page as PNG (base64)\n'
    + '  run_code(code):  Execute JavaScript in the page\n\n'
    + 'NOT for: reading article content (use smart_exa_crawl with --clean).\n'
    + 'NOT for: searching the web (use smart_exa_search).',
  inputSchema: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        enum: ['navigate', 'snapshot', 'click', 'fill', 'screenshot', 'run_code'],
        description: 'Browser action to perform',
      },
      url: {
        type: 'string',
        description: 'URL to navigate to (required for navigate)',
      },
      selector: {
        type: 'string',
        description: 'CSS selector or text content for click/fill',
      },
      value: {
        type: 'string',
        description: 'Value to fill in form field (required for fill)',
      },
      code: {
        type: 'string',
        description: 'JavaScript code to execute in page context (required for run_code)',
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
