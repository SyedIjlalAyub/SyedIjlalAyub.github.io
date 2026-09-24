(() => {
  const root = document.documentElement;
  const themeToggle = document.querySelector('.theme-toggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const menuToggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav-links');
  const savedTheme = localStorage.getItem('portfolio-theme');
  const preferredLight = window.matchMedia('(prefers-color-scheme: light)').matches;

  const setTheme = (theme) => {
    root.dataset.theme = theme;
    localStorage.setItem('portfolio-theme', theme);
    if (themeToggle) {
      themeToggle.setAttribute('aria-label', theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme');
    }
    themeMeta?.setAttribute('content', theme === 'dark' ? '#0a0c0f' : '#f6f7f4');
  };

  setTheme(savedTheme || (preferredLight ? 'light' : 'dark'));

  themeToggle?.addEventListener('click', () => {
    setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  const closeMenu = () => {
    nav?.classList.remove('is-open');
    menuToggle?.setAttribute('aria-expanded', 'false');
    menuToggle?.setAttribute('aria-label', 'Open navigation');
  };

  menuToggle?.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') === 'true';
    menuToggle.setAttribute('aria-expanded', String(!open));
    menuToggle.setAttribute('aria-label', open ? 'Open navigation' : 'Close navigation');
    nav?.classList.toggle('is-open', !open);
  });

  nav?.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMenu();
  });

  const year = document.getElementById('year');
  if (year) year.textContent = new Date().getFullYear();

  const revealItems = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -24px' });
    revealItems.forEach((item) => revealObserver.observe(item));
  } else {
    revealItems.forEach((item) => item.classList.add('is-visible'));
  }

  const navLinks = [...document.querySelectorAll('.nav-links a')];
  const sections = navLinks
    .map((link) => document.querySelector(link.getAttribute('href')))
    .filter(Boolean);

  if ('IntersectionObserver' in window && sections.length) {
    const sectionObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      navLinks.forEach((link) => {
        link.classList.toggle('is-active', link.getAttribute('href') === `#${visible.target.id}`);
      });
    }, { rootMargin: '-28% 0px -60% 0px', threshold: [0, 0.1, 0.25] });
    sections.forEach((section) => sectionObserver.observe(section));
  }

  const progress = document.querySelector('.scroll-progress span');
  const updateProgress = () => {
    if (!progress) return;
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const value = maxScroll > 0 ? Math.min(1, window.scrollY / maxScroll) : 0;
    progress.style.width = `${value * 100}%`;
  };
  updateProgress();
  window.addEventListener('scroll', updateProgress, { passive: true });
  window.addEventListener('resize', updateProgress);

  const copyButton = document.querySelector('.copy-link');
  const toast = document.querySelector('.toast');
  let toastTimer;

  copyButton?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(copyButton.dataset.copy || window.location.href);
      toast?.classList.add('is-visible');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toast?.classList.remove('is-visible'), 1800);
    } catch {
      copyButton.textContent = 'syedijlalayub.github.io';
    }
  });
})();
