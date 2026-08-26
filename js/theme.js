// Zero-Lag Universal Theme Manager
let isInitialized = false;

export function applyTheme(theme) {
  const isDark = theme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.setAttribute('data-theme', theme);
  if (document.body) {
    document.body.classList.toggle('dark', isDark);
  }
  try {
    localStorage.setItem('cww-theme', theme);
  } catch(e) {}

  // Update button icons across DOM
  const btns = document.querySelectorAll('#darkToggle, .theme-toggle-btn');
  btns.forEach(btn => {
    btn.textContent = isDark ? '☀' : '☾';
    btn.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode');
    btn.title = isDark ? 'Switch to light mode' : 'Switch to dark mode';
  });
}

export function toggleTheme() {
  const isDark = document.documentElement.classList.contains('dark') || document.body?.classList.contains('dark');
  applyTheme(isDark ? 'light' : 'dark');
}

// Global window exposure for inline onclick resilience
if (typeof window !== 'undefined') {
  window.__toggleTheme = toggleTheme;
}

export function initTheme() {
  if (isInitialized) return;
  isInitialized = true;

  let saved = 'light';
  try {
    saved = localStorage.getItem('cww-theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  } catch(e) {}

  applyTheme(saved);

  // Single global click listener
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('#darkToggle, .theme-toggle-btn');
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      toggleTheme();
    }
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
