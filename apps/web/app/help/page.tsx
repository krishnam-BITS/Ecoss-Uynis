'use client';

import { PublicShell } from '../../components/PublicShell';
import { LANDING_SEARCH_ITEMS } from '../../lib/public-navigation';

export default function HelpPage() {
  return (
    <PublicShell
      mode="landing"
      activeTopNav="help"
      searchModel={{
        items: LANDING_SEARCH_ITEMS,
        placeholder: 'Search help topics and FAQs',
      }}
    >
      <section id="help" className="landing-section landing-anchor-target">
        <header className="landing-section-head">
          <h2>Help Center</h2>
          <p>Guidance for login, signup, verification, recovery, private mode, and FAQ.</p>
        </header>
        <div className="landing-help-grid">
          <article id="help-login" className="landing-help-card landing-anchor-target">
            <h3>Login help</h3>
            <p>
              Use your email, phone, or username. If verification is required,
              verify OTP, select account (for phone), then enter password.
            </p>
            <ul>
              <li>Wrong identifier errors appear before password step.</li>
              <li>Forgot ID and Forgot Password flows are available on login.</li>
            </ul>
          </article>
          <article id="help-signup" className="landing-help-card landing-anchor-target">
            <h3>Signup help</h3>
            <p>
              Create your account with username checks, profile setup, strong password, and OTP verification.
            </p>
            <ul>
              <li>Username suggestions are shown if your choice is already taken.</li>
              <li>OTP verification is required to activate login access.</li>
            </ul>
          </article>
          <article id="help-password" className="landing-help-card landing-anchor-target">
            <h3>Password recovery</h3>
            <p>
              Reset forgotten credentials through recovery flow and verify account access.
            </p>
            <ul>
              <li>Use Forgot Password for reset links.</li>
              <li>Use Forgot ID to recover usernames linked to your contact.</li>
            </ul>
          </article>
          <article id="help-private" className="landing-help-card landing-anchor-target">
            <h3>Private mode</h3>
            <p>
              Create and recover private accounts with dedicated private-mode controls.
            </p>
            <ul>
              <li>Private mode has isolated sign-in and recovery journeys.</li>
              <li>Recovery phrase flow supports restoring access securely.</li>
            </ul>
          </article>
          <article id="help-faq" className="landing-help-card landing-anchor-target">
            <h3>FAQ</h3>
            <ul>
              <li>Can I use personal and team workspaces in one account? Yes.</li>
              <li>Can I import existing codebases? Yes, via remote URL or zip upload.</li>
              <li>Can I share routes publicly? Yes, based on visibility and access rules.</li>
              <li>Why does login ask for OTP on phone? To verify ownership before account selection.</li>
            </ul>
          </article>
          <article className="landing-help-card">
            <h3>Need quick actions?</h3>
            <ul>
              <li>Login: `/help#help-login`</li>
              <li>Signup: `/help#help-signup`</li>
              <li>Password: `/help#help-password`</li>
              <li>Private: `/help#help-private`</li>
            </ul>
          </article>
        </div>
      </section>
    </PublicShell>
  );
}
