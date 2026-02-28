import { AppShell } from '../../components/AppShell';

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AppShell title="Settings">
      <div className="settings-shell">
        <section className="settings-content">{children}</section>
      </div>
    </AppShell>
  );
}
