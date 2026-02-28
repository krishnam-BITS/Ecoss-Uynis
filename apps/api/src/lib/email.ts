type SendWorkspaceInviteEmailParams = {
  toEmail: string;
  workspaceName: string;
  workspaceSlug: string;
  inviteUrl: string;
  invitedBy: string;
  role: 'OWNER' | 'ADMIN' | 'MEMBER';
  message?: string | null;
};

function buildWorkspaceInviteText({
  workspaceName,
  workspaceSlug,
  inviteUrl,
  invitedBy,
  role,
  message,
}: Omit<SendWorkspaceInviteEmailParams, 'toEmail'>) {
  const lines = [
    `${invitedBy} invited you to join "${workspaceName}" on Uynis.`,
    `Role: ${role}`,
    `Workspace: /workspaces/${workspaceSlug}`,
    '',
    `Accept invite: ${inviteUrl}`,
  ];
  if (message?.trim()) {
    lines.push('', `Message: ${message.trim()}`);
  }
  lines.push(
    '',
    'If you do not have an account yet, create one first and then open the invite link.',
  );
  return lines.join('\n');
}

export async function sendWorkspaceInviteEmail(
  params: SendWorkspaceInviteEmailParams,
): Promise<boolean> {
  const webhookUrl = process.env.EMAIL_WEBHOOK_URL?.trim();
  if (!webhookUrl) {
    return false;
  }

  const subject = `${params.invitedBy} invited you to ${params.workspaceName} on Uynis`;
  const text = buildWorkspaceInviteText(params);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };
  const webhookToken = process.env.EMAIL_WEBHOOK_TOKEN?.trim();
  if (webhookToken) {
    headers.authorization = `Bearer ${webhookToken}`;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      to: params.toEmail,
      subject,
      text,
      metadata: {
        kind: 'workspace_invite',
        workspaceSlug: params.workspaceSlug,
      },
    }),
  });

  if (!response.ok) {
    const payload = await response.text().catch(() => '');
    throw new Error(
      `Invite email webhook failed (${response.status}): ${payload || 'no response body'}`,
    );
  }

  return true;
}