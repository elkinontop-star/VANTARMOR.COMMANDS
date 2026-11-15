(() => {
  const main = document.querySelector('main');
  const nav = document.getElementById('nav');
  if (!main) return;

  const sections = [...main.querySelectorAll(':scope > section[id]')];
  if (!sections.length) return;

  // Make each main section its own page-like tab while retaining direct links.
  if (nav && !nav.querySelector('[href="#estado"]') && sections.some((section) => section.id === 'estado')) {
    const link = document.createElement('a');
    link.href = '#estado';
    link.textContent = 'Estado';
    nav.insertBefore(link, nav.querySelector('[href="#funciones"]') || null);
  }

  const activateTab = (id, updateHistory = false) => {
    const active = sections.find((section) => section.id === id) || sections[0];
    sections.forEach((section) => {
      section.hidden = section !== active;
      section.setAttribute('aria-hidden', String(section !== active));
    });
    nav?.querySelectorAll('a[href^="#"]').forEach((link) => {
      const selected = link.hash === `#${active.id}`;
      link.classList.toggle('active', selected);
      if (selected) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
    if (updateHistory && location.hash !== `#${active.id}`) history.pushState(null, '', `#${active.id}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  window.activateTab = activateTab;

  nav?.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link || !sections.some((section) => `#${section.id}` === link.hash)) return;
    event.preventDefault();
    activateTab(link.hash.slice(1), true);
    nav.classList.remove('open');
    document.getElementById('menu-toggle')?.setAttribute('aria-expanded', 'false');
  });
  window.addEventListener('hashchange', () => activateTab(location.hash.slice(1)));
  window.addEventListener('popstate', () => activateTab(location.hash.slice(1)));

  const menuToggle = document.getElementById('menu-toggle');
  menuToggle?.addEventListener('click', () => {
    const open = menuToggle.getAttribute('aria-expanded') !== 'true';
    menuToggle.setAttribute('aria-expanded', String(open));
    nav?.classList.toggle('open', open);
  });
  activateTab(location.hash.slice(1) || 'inicio');

  fetch('/api/me').then((response) => response.ok ? response.json() : null).then((session) => {
    if (!session?.authenticated) return;
    const card = document.getElementById('profile-card');
    if (!card) return;
    const user = session.user || {};
    const avatar = card.querySelector('.avatar');
    const name = card.querySelector('#profile-name, strong');
    if (avatar) {
      if (user.avatar) avatar.innerHTML = `<img src="${user.avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`;
      else avatar.textContent = (user.name || user.username || '?').slice(0, 1).toUpperCase();
    }
    if (name) name.textContent = user.name || user.username || 'Usuario de Discord';
  }).catch(() => {});
})();
