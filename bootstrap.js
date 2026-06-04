(() => {
    const params = new URLSearchParams(location.search);
    if (params.has('screenshot') || params.get('mode') === 'screenshot') {
      document.documentElement.classList.add('screenshot-mode');
    }
    const themes = new Set(['default', 'grayscale', 'blueprint']);
    let storedTheme = 'default';
    try { storedTheme = localStorage.getItem('graphTheme') || 'default'; } catch (_) {}
    const theme = themes.has(params.get('theme')) ? params.get('theme') : storedTheme;
    if (theme && theme !== 'default' && themes.has(theme)) {
      document.documentElement.dataset.theme = theme;
    }
  })();
