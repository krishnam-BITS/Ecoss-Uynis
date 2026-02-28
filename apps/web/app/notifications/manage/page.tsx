import { AppShell } from '../../../components/AppShell';
import { NotificationPreferences } from '../../../components/NotificationPreferences';
import { PortalPage, PortalToolbar } from '../../../components/portal';

export default function NotificationsManagePage() {
  return (
    <AppShell title="Notifications - Manage">
      <PortalPage className="notifications-shell">
        <PortalToolbar
          title="Manage notifications"
          subtitle="Tune global and repository-specific notification behavior without leaving notifications flow."
        />
        <NotificationPreferences />
      </PortalPage>
    </AppShell>
  );
}
