import { cookies } from 'next/headers';
import { LandingPage } from '../components/LandingPage';
import { PortalHome } from '../components/PortalHome';

export default function Home() {
  const hasToken = Boolean(cookies().get('uynis_token')?.value);
  return hasToken ? <PortalHome /> : <LandingPage />;
}
