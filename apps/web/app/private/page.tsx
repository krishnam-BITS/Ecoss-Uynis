'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { PublicShell } from '../../components/PublicShell';
import { AuthSplitLayout } from '../../components/AuthSplitLayout';
import { apiFetch } from '../../lib/api';
import { setToken } from '../../lib/auth';
import { BIP39_WORDS } from '../../lib/bip39';

type CreateStep = 'welcome' | 'credentials' | 'phrase' | 'success';
type CopiedField = 'username' | 'password' | 'phrase' | null;
type IntroSection = 'benefits' | 'limitations' | 'protection' | null;

type PrivateCreateResponse = {
  token: string;
  privateAccount: {
    username: string;
    password: string;
    recoveryPhrase: string;
    expiresAt: string;
  };
};

function secureRandomInt(max: number): number {
  const cryptoObj = typeof window !== 'undefined' ? window.crypto : null;
  if (!cryptoObj) return Math.floor(Math.random() * max);
  const range = 0xffffffff;
  const limit = range - (range % max);
  const buffer = new Uint32Array(1);
  let value = 0;
  do {
    cryptoObj.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return value % max;
}

function generatePrivateUsernameLocal(): string {
  const adjectives = ['swift', 'bright', 'bold', 'quick', 'keen', 'wise', 'calm', 'strong'];
  const nouns = ['fox', 'eagle', 'wolf', 'lion', 'tiger', 'bear', 'phoenix', 'raven'];
  const randomNum = secureRandomInt(10000);
  const adj = adjectives[secureRandomInt(adjectives.length)];
  const noun = nouns[secureRandomInt(nouns.length)];
  return `${adj}${noun}${randomNum.toString().padStart(4, '0')}`;
}

function generatePrivatePasswordLocal(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*';
  let password = '';
  for (let i = 0; i < 16; i += 1) {
    password += chars[secureRandomInt(chars.length)];
  }
  return password;
}

function generateRecoveryPhraseLocal(): string {
  const words = BIP39_WORDS;
  const picked = new Set<number>();
  while (picked.size < 12) picked.add(secureRandomInt(words.length));
  return Array.from(picked.values()).map((index) => words[index]).join(' ');
}

export default function PrivateModePage() {
  const [createStep, setCreateStep] = useState<CreateStep>('welcome');
  const [expandedSection, setExpandedSection] = useState<IntroSection>('benefits');
  const [generated, setGenerated] = useState<PrivateCreateResponse['privateAccount'] | null>(null);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [confirmPhrase, setConfirmPhrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<CopiedField>(null);
  const [isLoading, setIsLoading] = useState(false);
  const phraseRef = useRef<HTMLTextAreaElement | null>(null);
  const confirmPhraseRef = useRef<HTMLTextAreaElement | null>(null);

  const resizeTextarea = (element: HTMLTextAreaElement | null) => {
    if (!element) return;
    element.style.height = '0px';
    element.style.height = `${element.scrollHeight}px`;
  };

  useEffect(() => {
    if (createStep !== 'phrase') return;
    resizeTextarea(phraseRef.current);
    resizeTextarea(confirmPhraseRef.current);
  }, [createStep, generated?.recoveryPhrase]);

  const handleCreateAccount = async () => {
    setError(null);
    setGenerated({
      username: generatePrivateUsernameLocal(),
      password: generatePrivatePasswordLocal(),
      recoveryPhrase: generateRecoveryPhraseLocal(),
      expiresAt: '',
    });
    setPendingToken(null);
    setConfirmPhrase('');
    setCopiedField(null);
    setCreateStep('credentials');
  };

  const moveToStep = (nextStep: CreateStep) => {
    setError(null);
    setCopiedField(null);
    setCreateStep(nextStep);
  };

  const handleConfirmPhrase = async () => {
    setError(null);
    if (!generated) {
      setError('Private account details are not available. Please create account again.');
      setCreateStep('welcome');
      return;
    }

    const normalizedExpected = generated.recoveryPhrase.trim().replace(/\s+/g, ' ').toLowerCase();
    const normalizedInput = confirmPhrase.trim().replace(/\s+/g, ' ').toLowerCase();
    if (!normalizedInput) {
      setError('Please re-enter your recovery phrase.');
      return;
    }
    if (normalizedInput !== normalizedExpected) {
      setError('Recovery phrase does not match.');
      return;
    }

    setIsLoading(true);
    try {
      const data = await apiFetch<PrivateCreateResponse>('/auth/private/create', {
        method: 'POST',
        body: JSON.stringify({
          username: generated.username,
          password: generated.password,
          recoveryPhrase: generated.recoveryPhrase,
        }),
      });
      setPendingToken(data.token);
      setCreateStep('success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create private account.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleEnterPrivateDashboard = () => {
    setError(null);
    if (!pendingToken) {
      setError('Private account session expired. Please create a new private account.');
      return;
    }
    setToken(pendingToken);
    window.location.assign('/private/dashboard');
  };

  const copyText = async (value: string, field: Exclude<CopiedField, null>) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      setTimeout(() => {
        setCopiedField((current) => (current === field ? null : current));
      }, 1200);
    } catch {
      setError('Clipboard permission denied. Please copy manually.');
    }
  };

  useEffect(() => {
    if (createStep !== 'success') return;
    const handlePopState = () => {
      window.location.replace('/login');
    };
    window.history.pushState({ privateSuccess: true }, '', window.location.href);
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [createStep]);

  const intro = (() => {
    if (createStep === 'credentials') {
      return (
        <>
          <strong>Save your credentials before continuing.</strong>
        </>
      );
    }
    if (createStep === 'phrase') {
      return (
        <>
          <strong>Save your recovery phrase and re-enter it once to verify.</strong>
        </>
      );
    }
    if (createStep === 'success') {
      return (
        <>
          <strong>Your private account is ready to use.</strong>
        </>
      );
    }
    return (
      <>
        <strong>Create a private account and review the details below.</strong>
      </>
    );
  })();

  return (
    <PublicShell hideHeader className="login-shell">
      <AuthSplitLayout intro={intro} frameClassName="login-frame-grow">
        <form className="login-form-inner" onSubmit={(event) => event.preventDefault()} noValidate>
          {createStep === 'welcome' ? (
            <div className="login-field-group private-info-group">
              <div className="private-info-scroll">
                <section className={`private-info-block private-info-accordion ${expandedSection === 'benefits' ? 'open' : ''}`.trim()}>
                  <button
                    className="private-info-toggle"
                    type="button"
                    onClick={() => setExpandedSection((current) => (current === 'benefits' ? null : 'benefits'))}
                    aria-expanded={expandedSection === 'benefits'}
                  >
                    <span>What you get</span>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {expandedSection === 'benefits' ? (
                    <ul className="private-info-points">
                      <li>Auto-generated username and strong password</li>
                      <li>12-word recovery phrase for restoration</li>
                      <li>No email or phone required for setup</li>
                    </ul>
                  ) : null}
                </section>
                <section className={`private-info-block private-info-accordion ${expandedSection === 'limitations' ? 'open' : ''}`.trim()}>
                  <button
                    className="private-info-toggle"
                    type="button"
                    onClick={() => setExpandedSection((current) => (current === 'limitations' ? null : 'limitations'))}
                    aria-expanded={expandedSection === 'limitations'}
                  >
                    <span>Important limitations</span>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {expandedSection === 'limitations' ? (
                    <ul className="private-info-points">
                      <li>Account can expire after inactivity</li>
                      <li>Without recovery phrase, account cannot be restored</li>
                    </ul>
                  ) : null}
                </section>
                <section className={`private-info-block private-info-accordion ${expandedSection === 'protection' ? 'open' : ''}`.trim()}>
                  <button
                    className="private-info-toggle"
                    type="button"
                    onClick={() => setExpandedSection((current) => (current === 'protection' ? null : 'protection'))}
                    aria-expanded={expandedSection === 'protection'}
                  >
                    <span>Protect your access</span>
                    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                      <path d="M7 10l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {expandedSection === 'protection' ? (
                    <ul className="private-info-points">
                      <li>Store username, password, and phrase securely</li>
                    </ul>
                  ) : null}
                </section>
              </div>
            </div>
          ) : null}

          {createStep === 'credentials' && generated ? (
            <div className="login-field-group">
              <div className="private-credential-stack">
                <div className="private-field has-copy">
                  <span className="private-field-label">Username</span>
                  <button
                    className="private-copy-btn"
                    type="button"
                    onClick={() => void copyText(generated.username, 'username')}
                    aria-label="Copy username"
                  >
                    {copiedField === 'username' ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M5 12.5 9.2 17 19 7.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
                        <rect x="4" y="4" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
                      </svg>
                    )}
                  </button>
                  <input className="login-input private-copy-input" type="text" value={generated.username} readOnly />
                </div>
                <div className="private-field has-copy">
                  <span className="private-field-label">Password</span>
                  <button
                    className="private-copy-btn"
                    type="button"
                    onClick={() => void copyText(generated.password, 'password')}
                    aria-label="Copy password"
                  >
                    {copiedField === 'password' ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M5 12.5 9.2 17 19 7.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
                        <rect x="4" y="4" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
                      </svg>
                    )}
                  </button>
                  <input className="login-input private-copy-input" type="text" value={generated.password} readOnly />
                </div>
              </div>
            </div>
          ) : null}

          {createStep === 'phrase' && generated ? (
            <div className="login-field-group">
              <div className="private-credential-stack">
                <div className="private-field private-field-textarea has-copy">
                  <span className="private-field-label">Recovery phrase</span>
                  <button
                    className="private-copy-btn"
                    type="button"
                    onClick={() => void copyText(generated.recoveryPhrase, 'phrase')}
                    aria-label="Copy recovery phrase"
                  >
                    {copiedField === 'phrase' ? (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <path d="M5 12.5 9.2 17 19 7.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                        <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
                        <rect x="4" y="4" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.7" />
                      </svg>
                    )}
                  </button>
                  <textarea
                    ref={phraseRef}
                    className="login-input private-copy-input private-copy-input-textarea"
                    value={generated.recoveryPhrase}
                    readOnly
                    rows={1}
                  />
                </div>
                <div className="private-field private-field-textarea">
                  <span className="private-field-label">Re-enter recovery phrase</span>
                  <textarea
                    id="private-confirm-phrase"
                    ref={confirmPhraseRef}
                    className="login-input private-copy-input private-copy-input-textarea private-copy-input-plain"
                    rows={1}
                    value={confirmPhrase}
                    onChange={(event) => {
                      setConfirmPhrase(event.target.value);
                      resizeTextarea(event.target);
                    }}
                    placeholder="Re-enter your recovery phrase"
                  />
                </div>
              </div>
            </div>
          ) : null}

          {createStep === 'success' && generated ? (
            <div className="login-field-group">
              <div className="private-success-card">
                <div className="private-success-copy">
                  <p className="private-success-title">Congratulations</p>
                  <p className="private-success-subtitle">
                    Account <strong>{generated.username}</strong> created successfully.
                  </p>
                </div>
                <div className="private-success-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M5 12.5 9.2 17 19 7.5" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="login-inline-alert" role="status">
              <span>{error}</span>
              <button className="login-inline-close" type="button" onClick={() => setError(null)} aria-label="Dismiss">
                <span aria-hidden="true">x</span>
              </button>
            </div>
          ) : null}

          <div className="login-actions">
            {createStep === 'success' ? (
              <Link
                className="login-link emphasis"
                href={
                  generated
                    ? `/login?identifier=${encodeURIComponent(generated.username)}&step=password`
                    : '/login'
                }
              >
                Login
              </Link>
            ) : createStep === 'welcome' ? (
              <Link className="login-link emphasis" href="/login">
                Back
              </Link>
            ) : (
              <button
                className="login-link emphasis"
                type="button"
                onClick={() => {
                  if (createStep === 'credentials') {
                    moveToStep('welcome');
                    return;
                  }
                  if (createStep === 'phrase') {
                    moveToStep('credentials');
                    return;
                  }
                  moveToStep('phrase');
                }}
              >
                Back
              </button>
            )}

            {createStep === 'welcome' ? (
              <button className="login-button" type="button" onClick={handleCreateAccount} disabled={isLoading}>
                {isLoading ? 'Creating...' : 'Create account'}
              </button>
            ) : createStep === 'credentials' ? (
              <button className="login-button" type="button" onClick={() => moveToStep('phrase')}>
                Next
              </button>
            ) : createStep === 'phrase' ? (
              <button className="login-button" type="button" onClick={() => void handleConfirmPhrase()} disabled={isLoading}>
                {isLoading ? 'Creating...' : 'Confirm and continue'}
              </button>
            ) : (
              <button className="login-button" type="button" onClick={handleEnterPrivateDashboard}>
                Enter private mode
              </button>
            )}
          </div>
        </form>
      </AuthSplitLayout>
    </PublicShell>
  );
}
