import { redirect } from 'next/navigation';

export default function SecuritySettingsRedirectPage() {
  redirect('/settings/account');
}
