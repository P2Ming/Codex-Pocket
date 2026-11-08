(function () {
  const themeKey = 'codex-pocket-theme';

  function shellCall(theme) {
    const shellId = new URLSearchParams(location.search).get('shellId');
    if (shellId) {
      void fetch('/api/shell-state', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shellId, theme }) }).catch(() => {});
      return;
    }
    try {
      const opener = window.plus?.webview?.getLaunchWebview?.();
      opener?.evalJS(`window.setPocketTheme(${JSON.stringify(theme)})`);
    } catch { /* The page can also run in an ordinary browser. */ }
  }

  function setTheme(theme, syncShell = true) {
    if (!['light', 'dark'].includes(theme)) return;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(themeKey, theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'light' ? '#f6f8f7' : '#101319');
    document.querySelectorAll('[data-toggle-theme]').forEach(button => {
      button.textContent = theme === 'light' ? '☾' : '☀';
      button.title = theme === 'light' ? '切换黑夜模式' : '切换白天模式';
      button.setAttribute('aria-label', button.title);
    });
    if (syncShell) shellCall(theme);
  }

  function init() {
    document.documentElement.classList.toggle('embedded-shell', new URLSearchParams(location.search).get('shell') === '1');
    setTheme(new URLSearchParams(location.search).get('theme') || localStorage.getItem(themeKey) || 'dark', false);
    document.querySelectorAll('[data-toggle-theme]').forEach(button => button.addEventListener('click', () => {
      setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');
    }));
  }

  window.PocketPreferences = { setTheme };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
