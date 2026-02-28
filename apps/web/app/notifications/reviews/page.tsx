import { redirect } from 'next/navigation';

export default function NotificationsReviewsRedirectPage() {
  redirect('/pulls?review=needed');
}
