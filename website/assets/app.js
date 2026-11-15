(() => {
  const main = document.querySelector('main');
  const nav = document.getElementById('nav');
  const toast = document.getElementById('toast');
  let csrfToken = '';
  let isAuthenticated = false;

  const showMessage = (element, text, isError = false) => {
    if (!element) return;
    element.textContent = text;
    element.classList.toggle('error', isError);
    element.classList.toggle('success', !isError);
  };
  const notify = (text) => {
    if (!toast) return;
    toast.textContent = text;
    toast.classList.add('show');
    window.setTimeout(() => toast.classList.remove('show'), 3500);
  };

  if (main) {
    const sections = [...main.querySelectorAll(':scope > section[id]')];
    const activateTab = (id, updateHistory = false) => {
      const active = sections.find((section) => section.id === id) || sections[0];
      if (!active) return;
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
    document.getElementById('menu-toggle')?.addEventListener('click', (event) => {
      const button = event.currentTarget;
      const open = button.getAttribute('aria-expanded') !== 'true';
      button.setAttribute('aria-expanded', String(open));
      nav?.classList.toggle('open', open);
    });
    activateTab(location.hash.slice(1) || 'inicio');
  }

  const login = async () => {
    try {
      const response = await fetch('/api/me', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) return;
      const session = await response.json();
      if (!session.authenticated) return;
      isAuthenticated = true;
      csrfToken = session.csrf || '';
      const user = session.user || {};
      const name = user.name || user.username || 'Usuario de Discord';
      const card = document.getElementById('profile-card');
      const avatar = card?.querySelector('.avatar');
      if (avatar) {
        if (user.avatar) {
          const image = document.createElement('img');
          image.src = user.avatar;
          image.alt = '';
          avatar.replaceChildren(image);
        } else avatar.textContent = name.slice(0, 1).toUpperCase();
      }
      const profileName = document.getElementById('profile-name');
      if (profileName) profileName.textContent = name;
      const profilePlan = document.getElementById('profile-plan');
      if (profilePlan) profilePlan.textContent = session.is_premium ? 'Premium activo' : 'Cuenta conectada · puedes canjear una key Premium';
      for (const id of ['login-link', 'account-login']) {
        const link = document.getElementById(id);
        if (link) { link.href = '/auth/logout'; link.textContent = 'Cerrar sesión'; }
      }
      const redeemStatus = document.getElementById('redeem-status');
      showMessage(redeemStatus, 'Cuenta conectada. Introduce tu key Premium para canjearla.');
      loadGuilds();
    } catch (_) {
      // The public site remains usable if session lookup is unavailable.
    }
  };

  const loadGuilds = async () => {
    const select = document.getElementById('guild-select');
    const inviteButton = document.getElementById('invite-button');
    if (!select || !isAuthenticated) return;
    try {
      const response = await fetch('/api/guilds', { cache: 'no-store' });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'No se pudieron cargar tus servidores.');
      select.replaceChildren(new Option('Elige un servidor', ''), ...result.guilds.map((guild) => new Option(guild.name, guild.id)));
      const config = await fetch('/config.json', { cache: 'no-store' }).then((res) => res.json());
      const clientId = config.bot_client_id;
      const updateInvite = () => {
        const permissions = '8';
        const url = new URL('https://discord.com/oauth2/authorize');
        url.search = new URLSearchParams({ client_id: clientId, permissions, scope: 'bot applications.commands', ...(select.value ? { guild_id: select.value, disable_guild_select: 'true' } : {}) }).toString();
        inviteButton.href = url.toString();
        inviteButton.target = '_blank';
        inviteButton.rel = 'noopener';
      };
      select.addEventListener('change', updateInvite);
      if (inviteButton && clientId) updateInvite();
      if (inviteButton) inviteButton.textContent = 'Invitar bot';
    } catch (_) {
      select.replaceChildren(new Option('No se pudieron cargar los servidores', ''));
    }
  };

  document.getElementById('premium-key-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('premium-key');
    const status = document.getElementById('redeem-status');
    const button = document.getElementById('redeem-button');
    if (!isAuthenticated || !csrfToken) {
      showMessage(status, 'Primero inicia sesión con Discord.', true);
      return;
    }
    button.disabled = true;
    showMessage(status, 'Validando la key…');
    try {
      const response = await fetch('/api/redeem', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ key: input.value.trim() }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || result.error || 'No se pudo canjear la key.');
      input.value = '';
      showMessage(status, result.message || '¡Premium activado en tu cuenta!');
      const profilePlan = document.getElementById('profile-plan');
      if (profilePlan) profilePlan.textContent = 'Premium activo';
      notify('¡Premium activado correctamente!');
    } catch (error) {
      showMessage(status, error.message || 'Error al canjear la key.', true);
    } finally {
      button.disabled = false;
    }
  });

  const refreshStats = async () => {
    try {
      const response = await fetch('/api/stats', { cache: 'no-store' });
      if (!response.ok) return;
      const stats = await response.json();
      const status = document.getElementById('bot-status');
      if (status) {
        status.textContent = stats.bot_online ? '● Operativo' : '● Sin conexión';
        status.classList.toggle('online', !!stats.bot_online);
        status.classList.toggle('offline', !stats.bot_online);
      }
      const servers = document.getElementById('server-count');
      const commands = document.getElementById('command-count');
      const users = document.getElementById('user-count');
      if (servers) servers.textContent = String(stats.servers ?? 0);
      if (commands) commands.textContent = String(stats.slash_commands ?? 0);
      if (users) users.textContent = String(stats.website_users ?? 0);
    } catch (_) {}
  };

  login();
  refreshStats();
  window.setInterval(refreshStats, 60000);
})();
