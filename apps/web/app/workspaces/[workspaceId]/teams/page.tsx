import { redirect } from 'next/navigation';

export default function WorkspaceTeamsRedirect({
  params,
}: {
  params: { workspaceId: string };
}) {
  redirect(`/workspaces/${params.workspaceId}/access?tab=teams`);
}
