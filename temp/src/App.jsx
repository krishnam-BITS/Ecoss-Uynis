import { useEffect, useMemo, useState } from 'react';

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

function formatPurpose(value) {
  return (
    value?.replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase()) ||
    'Incoming message'
  );
}

function previewText(value, length) {
  if (!value) {
    return 'No preview available.';
  }
  const trimmed = value.replace(/\s+/g, ' ').trim();
  return trimmed.length > length ? `${trimmed.slice(0, length).trimEnd()}...` : trimmed;
}

function EmptyState({ children }) {
  return <div className="empty-state">{children}</div>;
}

function ChannelTabs({ channel, onChange }) {
  return (
    <div className="tabs" role="tablist" aria-label="Delivery channels">
      <button
        className={`tab${channel === 'email' ? ' is-active' : ''}`}
        type="button"
        onClick={() => onChange('email')}
      >
        Mail
      </button>
      <button
        className={`tab${channel === 'phone' ? ' is-active' : ''}`}
        type="button"
        onClick={() => onChange('phone')}
      >
        Phone
      </button>
    </div>
  );
}

function MessageListItem({ message, channel, selected, onSelect }) {
  return (
    <button
      className={`message-card${selected ? ' is-selected' : ''}`}
      type="button"
      onClick={() => onSelect(message.id)}
    >
      <div className="message-topline">
        <span className="message-sender">{message.sender || 'Uynis'}</span>
        <span className="message-time">{formatTime(message.createdAt)}</span>
      </div>
      <div className="message-title">
        {channel === 'email' ? message.subject || 'Untitled mail' : formatPurpose(message.purpose)}
      </div>
      <div className="message-preview">
        {channel === 'email'
          ? previewText(message.text, 96)
          : `${message.recipient || 'Unknown recipient'} • ${previewText(message.text, 74)}`}
      </div>
    </button>
  );
}

function MailView({ messages, selectedId, onSelect }) {
  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedId) ?? messages[0] ?? null,
    [messages, selectedId],
  );

  return (
    <section className="viewer viewer-mail">
      <aside className="card inbox-column">
        <div className="section-head">
          <div className="section-label">Inbox</div>
          <div className="section-count">{messages.length}</div>
        </div>
        <div className="scroller list-scroller">
          {messages.length ? (
            messages.map((message) => (
              <MessageListItem
                key={message.id}
                message={message}
                channel="email"
                selected={selectedMessage?.id === message.id}
                onSelect={onSelect}
              />
            ))
          ) : (
            <EmptyState>No mail delivered yet.</EmptyState>
          )}
        </div>
      </aside>

      <section className="card reader-column">
        {selectedMessage ? (
          <>
            <header className="reader-head">
              <div className="reader-intro">
                <div className="purpose-badge">{formatPurpose(selectedMessage.purpose)}</div>
                <h2>{selectedMessage.subject || 'Untitled mail'}</h2>
                <div className="meta-line">To: {selectedMessage.recipient}</div>
                <div className="meta-line">From: {selectedMessage.sender || 'Uynis'}</div>
              </div>
              <div className="reader-date">{formatTime(selectedMessage.createdAt)}</div>
            </header>
            <div className="scroller reader-scroller">
              <div className="mail-surface">
                {selectedMessage.html ? (
                  <div
                    className="mail-render"
                    dangerouslySetInnerHTML={{ __html: selectedMessage.html }}
                  />
                ) : (
                  <div className="fallback-mail">{selectedMessage.text || 'No message body.'}</div>
                )}
              </div>
            </div>
          </>
        ) : (
          <EmptyState>No mail delivered yet.</EmptyState>
        )}
      </section>
    </section>
  );
}

function PhoneView({ messages, selectedId, onSelect, detailOpen, onOpenDetail, onCloseDetail }) {
  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedId) ?? messages[0] ?? null,
    [messages, selectedId],
  );

  return (
    <section className="viewer viewer-phone">
      <div className="phone-shell">
        {!detailOpen ? (
          <>
            <div className="section-head">
              <div className="section-label">Messages</div>
              <div className="section-count">{messages.length}</div>
            </div>
            <div className="scroller phone-list">
              {messages.length ? (
                messages.map((message) => (
                  <MessageListItem
                    key={message.id}
                    message={message}
                    channel="phone"
                    selected={selectedMessage?.id === message.id}
                    onSelect={(id) => {
                      onSelect(id);
                      onOpenDetail();
                    }}
                  />
                ))
              ) : (
                <EmptyState>No phone messages delivered yet.</EmptyState>
              )}
            </div>
          </>
        ) : selectedMessage ? (
          <>
            <div className="phone-detail-head">
              <button className="back-button" type="button" onClick={onCloseDetail}>
                Back
              </button>
              <div className="phone-contact">
                <div className="phone-contact-name">{selectedMessage.sender || 'Uynis'}</div>
                <div className="phone-contact-sub">To {selectedMessage.recipient}</div>
                <div className="phone-contact-time">{formatTime(selectedMessage.createdAt)}</div>
              </div>
            </div>
            <div className="phone-purpose">{formatPurpose(selectedMessage.purpose)}</div>
            <div className="scroller phone-detail-body">
              <div className="sms-thread">
                <div className="sms-bubble">{selectedMessage.text || 'No message body.'}</div>
              </div>
            </div>
          </>
        ) : (
          <EmptyState>No phone messages delivered yet.</EmptyState>
        )}
      </div>
    </section>
  );
}

export default function App() {
  const [channel, setChannel] = useState('email');
  const [messages, setMessages] = useState({ email: [], phone: [] });
  const [selected, setSelected] = useState({ email: null, phone: null });
  const [phoneDetailOpen, setPhoneDetailOpen] = useState(false);
  const [loadError, setLoadError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const response = await fetch(`/api/messages?channel=${channel}`, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Delivery emulator is offline or unavailable.');
        }
        const data = await response.json();
        if (cancelled) {
          return;
        }

        const nextMessages = Array.isArray(data.messages) ? data.messages : [];
        setLoadError(null);
        setMessages((current) => ({
          ...current,
          [channel]: nextMessages,
        }));
        setSelected((current) => ({
          ...current,
          [channel]:
            current[channel] && nextMessages.some((message) => message.id === current[channel])
              ? current[channel]
              : nextMessages[0]?.id ?? null,
        }));
      } catch {
        if (cancelled) {
          return;
        }
        setLoadError('Delivery emulator is offline. Start it to view delivered messages.');
        setMessages((current) => ({
          ...current,
          [channel]: [],
        }));
        setSelected((current) => ({
          ...current,
          [channel]: null,
        }));
      }
    };

    void load();
    const interval = window.setInterval(() => {
      void load();
    }, 5000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [channel]);

  useEffect(() => {
    if (channel !== 'phone') {
      setPhoneDetailOpen(false);
    }
  }, [channel]);

  return (
    <main className="shell">
      <section className="workspace">
        <ChannelTabs channel={channel} onChange={setChannel} />
        {loadError ? <EmptyState>{loadError}</EmptyState> : null}
        {channel === 'email' ? (
          <MailView
            messages={messages.email}
            selectedId={selected.email}
            onSelect={(id) => setSelected((current) => ({ ...current, email: id }))}
          />
        ) : (
          <PhoneView
            messages={messages.phone}
            selectedId={selected.phone}
            onSelect={(id) => setSelected((current) => ({ ...current, phone: id }))}
            detailOpen={phoneDetailOpen}
            onOpenDetail={() => setPhoneDetailOpen(true)}
            onCloseDetail={() => setPhoneDetailOpen(false)}
          />
        )}
      </section>
    </main>
  );
}
