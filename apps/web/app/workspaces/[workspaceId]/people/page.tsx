import { redirect } from 'next/navigation';

export default function WorkspacePeopleRedirect({
  params,
}: {
  params: { workspaceId: string };
}) {
  redirect(`/workspaces/${params.workspaceId}/access?tab=people`);
}
