'use client';

import { PublicShell } from '../../components/PublicShell';
import { LANDING_SEARCH_ITEMS } from '../../lib/public-navigation';

export default function TermsPage() {
  return (
    <PublicShell
      mode="landing"
      activeTopNav="terms"
      searchModel={{
        items: LANDING_SEARCH_ITEMS,
        placeholder: 'Search terms, policies, and usage rules',
      }}
    >
      <section id="terms" className="landing-section landing-anchor-target">
        <header className="landing-section-head">
          <h2>Terms and policy summary</h2>
          <p>Current usage and account responsibility overview for platform behavior.</p>
        </header>
        <ul className="landing-terms-list">
          <li>Respect repository ownership and workspace-level access boundaries.</li>
          <li>Keep credentials private and rotate compromised access promptly.</li>
          <li>Public content may be indexable; private content requires authorization.</li>
          <li>Workspace owners/admins are responsible for membership governance.</li>
          <li>Keep imported code and uploaded files compliant with your legal obligations.</li>
        </ul>
      </section>
    </PublicShell>
  );
}
