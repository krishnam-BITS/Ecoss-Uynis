const state = {
  channel: 'email',
  messages: {
    email: [],
    phone: [],
  },
  selected: {
    email: null,
    phone: null,
  },
  error: null,
};

const tabs = Array.from(document.querySelectorAll('.tab'));

async function loadMessages(channel) {
  try {
    const response = await fetch(`/api/messages?channel=${channel}`, {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error('Delivery emulator is offline or unavailable.');
    }
    const data = await response.json();
    state.error = null;
    state.messages[channel] = Array.isArray(data.messages) ? data.messages : [];
    if (!state.selected[channel] && state.messages[channel].length) {
      state.selected[channel] = state.messages[channel][0].id;
    }
  } catch {
    state.error = 'Delivery emulator is offline. Start it to view delivered messages.';
    state.messages[channel] = [];
    state.selected[channel] = null;
  }
}

function formatTime(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function renderList(channel, elementId) {
  const container = document.getElementById(elementId);
  const messages = state.messages[channel];

  if (state.error && !messages.length) {
    container.innerHTML = `<div class="empty-state">${state.error}</div>`;
    return;
  }

  if (!messages.length) {
    container.innerHTML = '<div class="empty-state">No deliveries yet.</div>';
    return;
  }

  container.innerHTML = messages
    .map((message) => {
      const title = channel === 'email'
        ? (message.subject || 'Untitled mail')
        : (message.recipient || 'Incoming message');
      const preview = channel === 'email'
        ? (message.text || '').slice(0, 88)
        : (message.text || '').slice(0, 72);
      const selectedClass = state.selected[channel] === message.id ? ' is-selected' : '';
      return `
        <button class="message-card${selectedClass}" data-channel="${channel}" data-id="${message.id}">
          <div class="message-meta">
            <span>${message.sender || 'Uynis'}</span>
            <span>${formatTime(message.createdAt)}</span>
          </div>
          <p class="message-title">${title}</p>
          <p class="message-sub">${preview || 'No preview.'}</p>
        </button>
      `;
    })
    .join('');

  Array.from(container.querySelectorAll('.message-card')).forEach((button) => {
    button.addEventListener('click', () => {
      state.selected[channel] = button.dataset.id;
      render();
    });
  });
}

function renderMailReader() {
  const target = document.getElementById('mail-reader');
  const selected = state.messages.email.find((message) => message.id === state.selected.email);
  if (state.error && !selected) {
    target.innerHTML = `<div class="empty-state">${state.error}</div>`;
    return;
  }
  if (!selected) {
    target.innerHTML = '<div class="empty-state">No mail delivered yet.</div>';
    return;
  }

  target.innerHTML = `
    <header class="mail-header">
      <div>
        <h2 class="mail-heading">${selected.subject || 'Untitled mail'}</h2>
        <p class="mail-label">To: ${selected.recipient}</p>
        <p class="mail-label">From: ${selected.sender}</p>
      </div>
      <p class="mail-label">${formatTime(selected.createdAt)}</p>
    </header>
    <div class="mail-body">
      ${selected.otpCode ? `<div class="otp-chip">${selected.otpCode}</div>` : ''}
      <section class="mail-block">
        <strong>Plain text</strong>
        <p class="message-sub">${selected.text || 'No text body.'}</p>
      </section>
      ${selected.html ? `<section class="mail-block mail-html">${selected.html}</section>` : ''}
    </div>
  `;
}

function renderPhoneReader() {
  const target = document.getElementById('phone-reader');
  const selected = state.messages.phone.find((message) => message.id === state.selected.phone);
  if (state.error && !selected) {
    target.innerHTML = `<div class="empty-state">${state.error}</div>`;
    return;
  }
  if (!selected) {
    target.innerHTML = '<div class="empty-state">No phone messages delivered yet.</div>';
    return;
  }

  target.innerHTML = `
    <div class="phone-meta">To ${selected.recipient}</div>
    <div class="bubble">${selected.text || 'No message body.'}</div>
    ${selected.otpCode ? `<div class="otp-chip">${selected.otpCode}</div>` : ''}
    <div class="phone-meta">${formatTime(selected.createdAt)}</div>
  `;
}

function render() {
  tabs.forEach((tab) => {
    const active = tab.dataset.channel === state.channel;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', active ? 'true' : 'false');
  });

  document.querySelectorAll('[data-panel]').forEach((panel) => {
    panel.classList.toggle('is-active', panel.dataset.panel === state.channel);
  });

  renderList('email', 'mail-list');
  renderList('phone', 'phone-list');
  renderMailReader();
  renderPhoneReader();
}

async function boot() {
  await Promise.all([loadMessages('email'), loadMessages('phone')]);
  render();
  setInterval(async () => {
    await Promise.all([loadMessages('email'), loadMessages('phone')]);
    render();
  }, 5000);
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    state.channel = tab.dataset.channel;
    render();
  });
});

void boot();
