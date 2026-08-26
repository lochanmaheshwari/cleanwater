// Instant Theme Synchronization across all pages
export function initTheme() {
  const saved = localStorage.getItem('cww-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  applyTheme(saved);

  // Setup click listeners on all toggle buttons
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#darkToggle, .theme-toggle-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      const isDark = document.documentElement.classList.contains('dark') || document.body?.classList.contains('dark');
      const nextTheme = isDark ? 'light' : 'dark';
      applyTheme(nextTheme);
    }
  });
}

export function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.setAttribute('data-theme', theme);
  if (document.body) {
    document.body.classList.toggle('dark', isDark);
  }
  localStorage.setItem('cww-theme', theme);

  // Update button icons across DOM
  const btns = document.querySelectorAll('#darkToggle, .theme-toggle-btn');
  btns.forEach(btn => {
    btn.textContent = isDark ? '☀' : '☾';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  });
}

// Immediate execution
if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTheme);
  } else {
    initTheme();
  }
}
