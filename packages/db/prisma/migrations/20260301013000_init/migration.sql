-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "RepoRole" AS ENUM ('READ', 'WRITE', 'ADMIN');

-- CreateEnum
CREATE TYPE "RepoVisibility" AS ENUM ('PUBLIC', 'PRIVATE', 'INTERNAL');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "PullRequestStatus" AS ENUM ('OPEN', 'MERGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "PullRequestReviewState" AS ENUM ('APPROVED', 'CHANGES_REQUESTED', 'COMMENTED');

-- CreateEnum
CREATE TYPE "PullRequestCheckStatus" AS ENUM ('QUEUED', 'IN_PROGRESS', 'SUCCESS', 'FAILURE');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('MENTION', 'REVIEW_REQUESTED', 'REVIEW_SUBMITTED', 'ISSUE_COMMENT', 'PULL_COMMENT', 'PULL_STATUS', 'SYSTEM', 'INVITE');

-- CreateEnum
CREATE TYPE "RepoNotificationMode" AS ENUM ('DEFAULT', 'WATCH', 'MUTE');

-- CreateEnum
CREATE TYPE "RepoImportStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "RepoImportType" AS ENUM ('ZIP', 'REMOTE');

-- CreateEnum
CREATE TYPE "RepoWebhookEventType" AS ENUM ('PUSH', 'ISSUE_CREATED', 'PULL_OPENED', 'COMMENT_ADDED');

-- CreateEnum
CREATE TYPE "RepoWebhookDeliveryStatus" AS ENUM ('QUEUED', 'RUNNING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "UploadPurpose" AS ENUM ('REPO_IMPORT_ARCHIVE', 'AVATAR');

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('LOGIN_SUCCESS', 'LOGIN_FAILURE', 'LOGIN_BLOCKED', 'REQUIRES_VERIFICATION', 'REQUIRES_PASSWORD_RESET', 'OTP_VERIFIED', 'PASSWORD_RESET', 'SUSPICIOUS_ACTIVITY');

-- CreateEnum
CREATE TYPE "SecuritySeverity" AS ENUM ('INFO', 'WARN', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "WorkspaceBasePermission" AS ENUM ('NONE', 'READ', 'WRITE');

-- CreateEnum
CREATE TYPE "WorkspaceAdminRepoAccessMode" AS ENUM ('ALL_REPOS_ADMIN', 'BASE_PERMISSION_ONLY');

-- CreateEnum
CREATE TYPE "WorkspaceInvitePolicy" AS ENUM ('OWNERS_AND_ADMINS', 'ALL_MEMBERS');

-- CreateEnum
CREATE TYPE "WorkspaceInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WorkspaceRepoCreationPolicy" AS ENUM ('OWNERS_AND_ADMINS', 'ALL_MEMBERS');

-- CreateEnum
CREATE TYPE "TeamRole" AS ENUM ('MEMBER', 'MAINTAINER');

-- CreateEnum
CREATE TYPE "DiscussionThreadCategory" AS ENUM ('RFC', 'DESIGN', 'DECISION', 'QUESTION');

-- CreateEnum
CREATE TYPE "DiscussionThreadStatus" AS ENUM ('OPEN', 'ANSWERED', 'CLOSED');

-- CreateEnum
CREATE TYPE "DiscussionChannelVisibility" AS ENUM ('PUBLIC', 'PRIVATE');

-- CreateEnum
CREATE TYPE "DiscussionCallStatus" AS ENUM ('UPCOMING', 'ENDED');

-- CreateEnum
CREATE TYPE "ChatConversationKind" AS ENUM ('DIRECT', 'GROUP');

-- CreateEnum
CREATE TYPE "ChatMemberRole" AS ENUM ('MEMBER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ChatMessageType" AS ENUM ('TEXT', 'TASK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ChatAttachmentKind" AS ENUM ('IMAGE', 'VIDEO', 'FILE', 'AUDIO');

-- CreateEnum
CREATE TYPE "ChatReceiptState" AS ENUM ('SENT', 'DELIVERED', 'SEEN', 'PLAYED');

-- CreateEnum
CREATE TYPE "ChatCallMode" AS ENUM ('AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "ChatCallState" AS ENUM ('RINGING', 'ACTIVE', 'ENDED', 'MISSED');

-- CreateEnum
CREATE TYPE "TaskWorkflowStatus" AS ENUM ('ACTIVE', 'DRAFT', 'PAUSED');

-- CreateEnum
CREATE TYPE "TaskWorkflowTrigger" AS ENUM ('ISSUE_CREATED', 'ISSUE_CLOSED', 'PULL_CREATED', 'PULL_MERGED');

-- CreateEnum
CREATE TYPE "TaskWorkflowRunStatus" AS ENUM ('SUCCESS', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "PrivateAccountStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'MIGRATED_TO_PERSONAL', 'DELETED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "username" TEXT,
    "usernameChangedAt" TIMESTAMP(3),
    "usernamePrevious" TEXT,
    "usernamePreviousChangedAt" TIMESTAMP(3),
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMP(3),
    "passwordResetRequired" BOOLEAN NOT NULL DEFAULT false,
    "name" TEXT,
    "avatarUrl" TEXT,
    "bio" TEXT,
    "location" TEXT,
    "website" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "gender" TEXT,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "verificationExpiresAt" TIMESTAMP(3),
    "emailVerificationExpiresAt" TIMESTAMP(3),
    "phoneVerificationExpiresAt" TIMESTAMP(3),
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "phoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "pendingEmail" TEXT,
    "pendingPhone" TEXT,
    "contactVerificationExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsernameReservation" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastClaimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UsernameReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "ownerUserId" TEXT,
    "baseRepoPermission" "WorkspaceBasePermission" NOT NULL DEFAULT 'READ',
    "publicReadRequiresAuth" BOOLEAN NOT NULL DEFAULT false,
    "allowOutsideCollaborators" BOOLEAN NOT NULL DEFAULT true,
    "adminRepoAccessMode" "WorkspaceAdminRepoAccessMode" NOT NULL DEFAULT 'BASE_PERMISSION_ONLY',
    "description" TEXT,
    "website" TEXT,
    "publicProfileEnabled" BOOLEAN NOT NULL DEFAULT false,
    "publicProfileShowDetails" BOOLEAN NOT NULL DEFAULT true,
    "publicProfileShowDescription" BOOLEAN NOT NULL DEFAULT true,
    "publicProfileShowWebsite" BOOLEAN NOT NULL DEFAULT true,
    "publicProfileShowRepos" BOOLEAN NOT NULL DEFAULT true,
    "repoCreationPolicy" "WorkspaceRepoCreationPolicy" NOT NULL DEFAULT 'ALL_MEMBERS',
    "invitePolicy" "WorkspaceInvitePolicy" NOT NULL DEFAULT 'OWNERS_AND_ADMINS',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "invitedUserId" TEXT,
    "invitedEmail" TEXT,
    "invitedUsername" TEXT,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "status" "WorkspaceInviteStatus" NOT NULL DEFAULT 'PENDING',
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "message" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "respondedAt" TIMESTAMP(3),
    "acceptedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamMember" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "TeamRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Repo" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "RepoVisibility" NOT NULL DEFAULT 'PRIVATE',
    "publicReadRequiresAuth" BOOLEAN NOT NULL DEFAULT false,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "forkedFromRepoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Repo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadToken" (
    "id" TEXT NOT NULL,
    "purpose" "UploadPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "repoId" TEXT,
    "createdById" TEXT,
    "maxBytes" INTEGER NOT NULL,
    "contentType" TEXT,
    "fileName" TEXT,
    "storagePath" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UploadToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoImportJob" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "createdById" TEXT,
    "type" "RepoImportType" NOT NULL,
    "status" "RepoImportStatus" NOT NULL DEFAULT 'QUEUED',
    "branch" TEXT,
    "message" TEXT,
    "importUrl" TEXT,
    "archivePath" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextRunAt" TIMESTAMP(3),
    "importedFiles" INTEGER,
    "importedBranches" INTEGER,
    "defaultBranch" TEXT,
    "commitSha" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoAutomationToken" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoAutomationToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoWebhookSecret" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "secretHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoWebhookSecret_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoWebhook" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "events" "RepoWebhookEventType"[] DEFAULT ARRAY[]::"RepoWebhookEventType"[],
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "timeoutMs" INTEGER NOT NULL DEFAULT 10000,
    "lastDeliveryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoWebhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoWebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "eventType" "RepoWebhookEventType" NOT NULL,
    "status" "RepoWebhookDeliveryStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoWebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoMember" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "RepoRole" NOT NULL DEFAULT 'READ',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BranchRule" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "pattern" TEXT NOT NULL DEFAULT 'main',
    "requirePr" BOOLEAN NOT NULL DEFAULT true,
    "requireCodeOwners" BOOLEAN NOT NULL DEFAULT false,
    "requireApprovals" INTEGER NOT NULL DEFAULT 1,
    "blockDirectPush" BOOLEAN NOT NULL DEFAULT true,
    "requiredChecks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BranchRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamRepoPermission" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "role" "RepoRole" NOT NULL DEFAULT 'READ',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamRepoPermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "status" "IssueStatus" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueComment" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequest" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "status" "PullRequestStatus" NOT NULL DEFAULT 'OPEN',
    "sourceBranch" TEXT NOT NULL,
    "targetBranch" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoLabel" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#5B8CFF',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueAssignee" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueLabel" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestAssignee" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PullRequestAssignee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestLabel" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "labelId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PullRequestLabel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestComment" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PullRequestComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestReview" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "state" "PullRequestReviewState" NOT NULL DEFAULT 'COMMENTED',
    "body" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequestReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestCheck" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "status" "PullRequestCheckStatus" NOT NULL DEFAULT 'QUEUED',
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequestCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommitCheck" (
    "id" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "status" "PullRequestCheckStatus" NOT NULL DEFAULT 'QUEUED',
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommitCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestReviewComment" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "line" INTEGER,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PullRequestReviewComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PullRequestReviewRequest" (
    "id" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "PullRequestReviewRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionThread" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "category" "DiscussionThreadCategory" NOT NULL DEFAULT 'RFC',
    "status" "DiscussionThreadStatus" NOT NULL DEFAULT 'OPEN',
    "replies" INTEGER NOT NULL DEFAULT 0,
    "workspaceName" TEXT NOT NULL,
    "repoName" TEXT NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscussionThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionMessageThread" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "preview" TEXT NOT NULL,
    "members" INTEGER NOT NULL DEFAULT 2,
    "unread" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscussionMessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionChannel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "visibility" "DiscussionChannelVisibility" NOT NULL DEFAULT 'PUBLIC',
    "members" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscussionChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionCall" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "status" "DiscussionCallStatus" NOT NULL DEFAULT 'UPCOMING',
    "attendees" INTEGER NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DiscussionCall_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionCallNote" (
    "id" TEXT NOT NULL,
    "callId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionCallNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionThreadReply" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionThreadReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscussionChannelPost" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscussionChannelPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatConversation" (
    "id" TEXT NOT NULL,
    "kind" "ChatConversationKind" NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "directKey" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "lastMessagePreview" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatConversationMember" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "ChatMemberRole" NOT NULL DEFAULT 'MEMBER',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadMessageId" TEXT,
    "lastReadAt" TIMESTAMP(3),

    CONSTRAINT "ChatConversationMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "type" "ChatMessageType" NOT NULL DEFAULT 'TEXT',
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatAttachment" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "kind" "ChatAttachmentKind" NOT NULL,
    "url" TEXT NOT NULL,
    "fileName" TEXT,
    "mimeType" TEXT,
    "sizeBytes" BIGINT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMessageReceipt" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" "ChatReceiptState" NOT NULL DEFAULT 'SENT',
    "deliveredAt" TIMESTAMP(3),
    "seenAt" TIMESTAMP(3),
    "playedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMessageReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatCallSession" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "startedById" TEXT NOT NULL,
    "mode" "ChatCallMode" NOT NULL,
    "state" "ChatCallState" NOT NULL DEFAULT 'RINGING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatCallSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskWorkflow" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "repoId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TaskWorkflowStatus" NOT NULL DEFAULT 'DRAFT',
    "trigger" "TaskWorkflowTrigger" NOT NULL DEFAULT 'PULL_MERGED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskWorkflow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskWorkflowRun" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "actorId" TEXT,
    "workspaceId" TEXT,
    "repoId" TEXT,
    "issueId" TEXT,
    "pullRequestId" TEXT,
    "trigger" "TaskWorkflowTrigger" NOT NULL,
    "status" "TaskWorkflowRunStatus" NOT NULL DEFAULT 'SUCCESS',
    "message" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskWorkflowRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "actorId" TEXT,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "workspaceId" TEXT,
    "repoId" TEXT,
    "issueId" TEXT,
    "pullRequestId" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "inAppActivityEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mentionsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reviewRequestsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reviewSubmittedEnabled" BOOLEAN NOT NULL DEFAULT true,
    "issueCommentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pullCommentsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pullStatusEnabled" BOOLEAN NOT NULL DEFAULT true,
    "systemEnabled" BOOLEAN NOT NULL DEFAULT true,
    "emailMentionsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "emailReviewsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "productUpdatesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoNotificationPreference" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "mode" "RepoNotificationMode" NOT NULL DEFAULT 'DEFAULT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoNotificationPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoStar" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RepoStar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RepoPin" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "repoId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RepoPin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSecurityState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lastFailedLoginAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "forceReverify" BOOLEAN NOT NULL DEFAULT false,
    "forcePasswordReset" BOOLEAN NOT NULL DEFAULT false,
    "lastLoginIp" TEXT,
    "lastLoginUserAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSecurityState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "eventType" "SecurityEventType" NOT NULL,
    "severity" "SecuritySeverity" NOT NULL DEFAULT 'INFO',
    "identifier" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "reason" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivateAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "recoveryPhrase" TEXT,
    "recoveryPhraseHash" TEXT NOT NULL,
    "isEmailVerified" BOOLEAN NOT NULL DEFAULT false,
    "isPhoneVerified" BOOLEAN NOT NULL DEFAULT false,
    "recoveryEmail" TEXT,
    "recoveryPhone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "status" "PrivateAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "migratedToUserId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "dataExportedAt" TIMESTAMP(3),
    "archivedData" TEXT,

    CONSTRAINT "PrivateAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonalAccessToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "UsernameReservation_username_key" ON "UsernameReservation"("username");

-- CreateIndex
CREATE INDEX "UsernameReservation_userId_createdAt_idx" ON "UsernameReservation"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_ownerUserId_key" ON "Workspace"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_workspaceId_status_createdAt_idx" ON "WorkspaceInvite"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_invitedEmail_status_createdAt_idx" ON "WorkspaceInvite"("invitedEmail", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_invitedUsername_status_createdAt_idx" ON "WorkspaceInvite"("invitedUsername", "status", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_invitedUserId_status_createdAt_idx" ON "WorkspaceInvite"("invitedUserId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Team_workspaceId_slug_key" ON "Team"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "TeamMember_teamId_userId_key" ON "TeamMember"("teamId", "userId");

-- CreateIndex
CREATE INDEX "Repo_forkedFromRepoId_idx" ON "Repo"("forkedFromRepoId");

-- CreateIndex
CREATE UNIQUE INDEX "Repo_workspaceId_slug_key" ON "Repo"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "UploadToken_tokenHash_key" ON "UploadToken"("tokenHash");

-- CreateIndex
CREATE INDEX "UploadToken_purpose_expiresAt_idx" ON "UploadToken"("purpose", "expiresAt");

-- CreateIndex
CREATE INDEX "UploadToken_repoId_createdAt_idx" ON "UploadToken"("repoId", "createdAt");

-- CreateIndex
CREATE INDEX "RepoImportJob_repoId_createdAt_idx" ON "RepoImportJob"("repoId", "createdAt");

-- CreateIndex
CREATE INDEX "RepoImportJob_status_createdAt_idx" ON "RepoImportJob"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepoAutomationToken_tokenHash_key" ON "RepoAutomationToken"("tokenHash");

-- CreateIndex
CREATE INDEX "RepoAutomationToken_repoId_createdAt_idx" ON "RepoAutomationToken"("repoId", "createdAt");

-- CreateIndex
CREATE INDEX "RepoAutomationToken_revokedAt_idx" ON "RepoAutomationToken"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepoWebhookSecret_repoId_key" ON "RepoWebhookSecret"("repoId");

-- CreateIndex
CREATE INDEX "RepoWebhook_repoId_active_idx" ON "RepoWebhook"("repoId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "RepoWebhook_repoId_url_key" ON "RepoWebhook"("repoId", "url");

-- CreateIndex
CREATE INDEX "RepoWebhookDelivery_status_nextAttemptAt_createdAt_idx" ON "RepoWebhookDelivery"("status", "nextAttemptAt", "createdAt");

-- CreateIndex
CREATE INDEX "RepoWebhookDelivery_webhookId_createdAt_idx" ON "RepoWebhookDelivery"("webhookId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepoMember_repoId_userId_key" ON "RepoMember"("repoId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BranchRule_repoId_pattern_key" ON "BranchRule"("repoId", "pattern");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRepoPermission_teamId_repoId_key" ON "TeamRepoPermission"("teamId", "repoId");

-- CreateIndex
CREATE INDEX "Issue_repoId_status_createdAt_idx" ON "Issue"("repoId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PullRequest_repoId_status_createdAt_idx" ON "PullRequest"("repoId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "RepoLabel_repoId_name_idx" ON "RepoLabel"("repoId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "RepoLabel_repoId_nameKey_key" ON "RepoLabel"("repoId", "nameKey");

-- CreateIndex
CREATE INDEX "IssueAssignee_userId_createdAt_idx" ON "IssueAssignee"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssueAssignee_issueId_userId_key" ON "IssueAssignee"("issueId", "userId");

-- CreateIndex
CREATE INDEX "IssueLabel_labelId_createdAt_idx" ON "IssueLabel"("labelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "IssueLabel_issueId_labelId_key" ON "IssueLabel"("issueId", "labelId");

-- CreateIndex
CREATE INDEX "PullRequestAssignee_userId_createdAt_idx" ON "PullRequestAssignee"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequestAssignee_pullRequestId_userId_key" ON "PullRequestAssignee"("pullRequestId", "userId");

-- CreateIndex
CREATE INDEX "PullRequestLabel_labelId_createdAt_idx" ON "PullRequestLabel"("labelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequestLabel_pullRequestId_labelId_key" ON "PullRequestLabel"("pullRequestId", "labelId");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequestReview_pullRequestId_reviewerId_key" ON "PullRequestReview"("pullRequestId", "reviewerId");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequestCheck_pullRequestId_context_key" ON "PullRequestCheck"("pullRequestId", "context");

-- CreateIndex
CREATE INDEX "CommitCheck_repoId_commitSha_idx" ON "CommitCheck"("repoId", "commitSha");

-- CreateIndex
CREATE INDEX "CommitCheck_repoId_context_idx" ON "CommitCheck"("repoId", "context");

-- CreateIndex
CREATE UNIQUE INDEX "CommitCheck_repoId_commitSha_context_key" ON "CommitCheck"("repoId", "commitSha", "context");

-- CreateIndex
CREATE INDEX "PullRequestReviewComment_pullRequestId_path_idx" ON "PullRequestReviewComment"("pullRequestId", "path");

-- CreateIndex
CREATE INDEX "PullRequestReviewRequest_reviewerId_fulfilledAt_idx" ON "PullRequestReviewRequest"("reviewerId", "fulfilledAt");

-- CreateIndex
CREATE UNIQUE INDEX "PullRequestReviewRequest_pullRequestId_reviewerId_key" ON "PullRequestReviewRequest"("pullRequestId", "reviewerId");

-- CreateIndex
CREATE INDEX "DiscussionThread_status_updatedAt_idx" ON "DiscussionThread"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "DiscussionThread_category_updatedAt_idx" ON "DiscussionThread"("category", "updatedAt");

-- CreateIndex
CREATE INDEX "DiscussionThread_workspaceName_repoName_idx" ON "DiscussionThread"("workspaceName", "repoName");

-- CreateIndex
CREATE INDEX "DiscussionMessageThread_updatedAt_idx" ON "DiscussionMessageThread"("updatedAt");

-- CreateIndex
CREATE INDEX "DiscussionChannel_visibility_updatedAt_idx" ON "DiscussionChannel"("visibility", "updatedAt");

-- CreateIndex
CREATE INDEX "DiscussionCall_status_startsAt_idx" ON "DiscussionCall"("status", "startsAt");

-- CreateIndex
CREATE INDEX "DiscussionCallNote_callId_createdAt_idx" ON "DiscussionCallNote"("callId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscussionMessage_threadId_createdAt_idx" ON "DiscussionMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscussionThreadReply_threadId_createdAt_idx" ON "DiscussionThreadReply"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "DiscussionChannelPost_channelId_createdAt_idx" ON "DiscussionChannelPost"("channelId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversation_directKey_key" ON "ChatConversation"("directKey");

-- CreateIndex
CREATE INDEX "ChatConversation_kind_updatedAt_idx" ON "ChatConversation"("kind", "updatedAt");

-- CreateIndex
CREATE INDEX "ChatConversation_lastMessageAt_idx" ON "ChatConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "ChatConversationMember_userId_joinedAt_idx" ON "ChatConversationMember"("userId", "joinedAt");

-- CreateIndex
CREATE INDEX "ChatConversationMember_conversationId_role_idx" ON "ChatConversationMember"("conversationId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "ChatConversationMember_conversationId_userId_key" ON "ChatConversationMember"("conversationId", "userId");

-- CreateIndex
CREATE INDEX "ChatMessage_conversationId_createdAt_idx" ON "ChatMessage"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessage_senderId_createdAt_idx" ON "ChatMessage"("senderId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatAttachment_messageId_createdAt_idx" ON "ChatAttachment"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "ChatMessageReceipt_userId_state_updatedAt_idx" ON "ChatMessageReceipt"("userId", "state", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ChatMessageReceipt_messageId_userId_key" ON "ChatMessageReceipt"("messageId", "userId");

-- CreateIndex
CREATE INDEX "ChatCallSession_conversationId_startedAt_idx" ON "ChatCallSession"("conversationId", "startedAt");

-- CreateIndex
CREATE INDEX "ChatCallSession_startedById_startedAt_idx" ON "ChatCallSession"("startedById", "startedAt");

-- CreateIndex
CREATE INDEX "TaskWorkflow_userId_updatedAt_idx" ON "TaskWorkflow"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "TaskWorkflow_workspaceId_status_idx" ON "TaskWorkflow"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "TaskWorkflow_repoId_status_idx" ON "TaskWorkflow"("repoId", "status");

-- CreateIndex
CREATE INDEX "TaskWorkflowRun_workflowId_createdAt_idx" ON "TaskWorkflowRun"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskWorkflowRun_actorId_createdAt_idx" ON "TaskWorkflowRun"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskWorkflowRun_workspaceId_createdAt_idx" ON "TaskWorkflowRun"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "TaskWorkflowRun_repoId_createdAt_idx" ON "TaskWorkflowRun"("repoId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_createdAt_idx" ON "Notification"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_idx" ON "Notification"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_type_createdAt_idx" ON "Notification"("recipientId", "type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NotificationPreference_userId_key" ON "NotificationPreference"("userId");

-- CreateIndex
CREATE INDEX "RepoNotificationPreference_repoId_mode_idx" ON "RepoNotificationPreference"("repoId", "mode");

-- CreateIndex
CREATE UNIQUE INDEX "RepoNotificationPreference_userId_repoId_key" ON "RepoNotificationPreference"("userId", "repoId");

-- CreateIndex
CREATE INDEX "RepoStar_repoId_createdAt_idx" ON "RepoStar"("repoId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RepoStar_userId_repoId_key" ON "RepoStar"("userId", "repoId");

-- CreateIndex
CREATE INDEX "RepoPin_userId_sortOrder_idx" ON "RepoPin"("userId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "RepoPin_userId_repoId_key" ON "RepoPin"("userId", "repoId");

-- CreateIndex
CREATE UNIQUE INDEX "UserSecurityState_userId_key" ON "UserSecurityState"("userId");

-- CreateIndex
CREATE INDEX "UserSecurityState_lockedUntil_idx" ON "UserSecurityState"("lockedUntil");

-- CreateIndex
CREATE INDEX "UserSecurityState_riskScore_idx" ON "UserSecurityState"("riskScore");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenId_key" ON "UserSession"("tokenId");

-- CreateIndex
CREATE INDEX "UserSession_userId_createdAt_idx" ON "UserSession"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "UserSession_userId_revokedAt_idx" ON "UserSession"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_userId_createdAt_idx" ON "SecurityEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SecurityEvent_eventType_severity_createdAt_idx" ON "SecurityEvent"("eventType", "severity", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateAccount_userId_key" ON "PrivateAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PrivateAccount_username_key" ON "PrivateAccount"("username");

-- CreateIndex
CREATE INDEX "PrivateAccount_username_idx" ON "PrivateAccount"("username");

-- CreateIndex
CREATE INDEX "PrivateAccount_expiresAt_idx" ON "PrivateAccount"("expiresAt");

-- CreateIndex
CREATE INDEX "PrivateAccount_status_idx" ON "PrivateAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "PersonalAccessToken_tokenHash_key" ON "PersonalAccessToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_userId_createdAt_idx" ON "PersonalAccessToken"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_revokedAt_idx" ON "PersonalAccessToken"("revokedAt");

-- CreateIndex
CREATE INDEX "PersonalAccessToken_expiresAt_idx" ON "PersonalAccessToken"("expiresAt");

-- AddForeignKey
ALTER TABLE "UsernameReservation" ADD CONSTRAINT "UsernameReservation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_invitedUserId_fkey" FOREIGN KEY ("invitedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamMember" ADD CONSTRAINT "TeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repo" ADD CONSTRAINT "Repo_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Repo" ADD CONSTRAINT "Repo_forkedFromRepoId_fkey" FOREIGN KEY ("forkedFromRepoId") REFERENCES "Repo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadToken" ADD CONSTRAINT "UploadToken_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadToken" ADD CONSTRAINT "UploadToken_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoImportJob" ADD CONSTRAINT "RepoImportJob_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoImportJob" ADD CONSTRAINT "RepoImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoAutomationToken" ADD CONSTRAINT "RepoAutomationToken_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoWebhookSecret" ADD CONSTRAINT "RepoWebhookSecret_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoWebhook" ADD CONSTRAINT "RepoWebhook_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoWebhookDelivery" ADD CONSTRAINT "RepoWebhookDelivery_webhookId_fkey" FOREIGN KEY ("webhookId") REFERENCES "RepoWebhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoMember" ADD CONSTRAINT "RepoMember_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoMember" ADD CONSTRAINT "RepoMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BranchRule" ADD CONSTRAINT "BranchRule_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRepoPermission" ADD CONSTRAINT "TeamRepoPermission_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRepoPermission" ADD CONSTRAINT "TeamRepoPermission_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Issue" ADD CONSTRAINT "Issue_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequest" ADD CONSTRAINT "PullRequest_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoLabel" ADD CONSTRAINT "RepoLabel_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAssignee" ADD CONSTRAINT "IssueAssignee_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueAssignee" ADD CONSTRAINT "IssueAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLabel" ADD CONSTRAINT "IssueLabel_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueLabel" ADD CONSTRAINT "IssueLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "RepoLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestAssignee" ADD CONSTRAINT "PullRequestAssignee_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestAssignee" ADD CONSTRAINT "PullRequestAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestLabel" ADD CONSTRAINT "PullRequestLabel_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestLabel" ADD CONSTRAINT "PullRequestLabel_labelId_fkey" FOREIGN KEY ("labelId") REFERENCES "RepoLabel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestComment" ADD CONSTRAINT "PullRequestComment_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestComment" ADD CONSTRAINT "PullRequestComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestReview" ADD CONSTRAINT "PullRequestReview_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestReview" ADD CONSTRAINT "PullRequestReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestCheck" ADD CONSTRAINT "PullRequestCheck_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommitCheck" ADD CONSTRAINT "CommitCheck_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestReviewComment" ADD CONSTRAINT "PullRequestReviewComment_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestReviewComment" ADD CONSTRAINT "PullRequestReviewComment_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestReviewRequest" ADD CONSTRAINT "PullRequestReviewRequest_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "PullRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestReviewRequest" ADD CONSTRAINT "PullRequestReviewRequest_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PullRequestReviewRequest" ADD CONSTRAINT "PullRequestReviewRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionThread" ADD CONSTRAINT "DiscussionThread_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionMessageThread" ADD CONSTRAINT "DiscussionMessageThread_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionChannel" ADD CONSTRAINT "DiscussionChannel_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionCall" ADD CONSTRAINT "DiscussionCall_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionCallNote" ADD CONSTRAINT "DiscussionCallNote_callId_fkey" FOREIGN KEY ("callId") REFERENCES "DiscussionCall"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionCallNote" ADD CONSTRAINT "DiscussionCallNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DiscussionMessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionMessage" ADD CONSTRAINT "DiscussionMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionThreadReply" ADD CONSTRAINT "DiscussionThreadReply_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "DiscussionThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionThreadReply" ADD CONSTRAINT "DiscussionThreadReply_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionChannelPost" ADD CONSTRAINT "DiscussionChannelPost_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "DiscussionChannel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscussionChannelPost" ADD CONSTRAINT "DiscussionChannelPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversation" ADD CONSTRAINT "ChatConversation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversationMember" ADD CONSTRAINT "ChatConversationMember_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatConversationMember" ADD CONSTRAINT "ChatConversationMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatAttachment" ADD CONSTRAINT "ChatAttachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageReceipt" ADD CONSTRAINT "ChatMessageReceipt_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "ChatMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMessageReceipt" ADD CONSTRAINT "ChatMessageReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatCallSession" ADD CONSTRAINT "ChatCallSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "ChatConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatCallSession" ADD CONSTRAINT "ChatCallSession_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWorkflow" ADD CONSTRAINT "TaskWorkflow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWorkflow" ADD CONSTRAINT "TaskWorkflow_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWorkflow" ADD CONSTRAINT "TaskWorkflow_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWorkflowRun" ADD CONSTRAINT "TaskWorkflowRun_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "TaskWorkflow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWorkflowRun" ADD CONSTRAINT "TaskWorkflowRun_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWorkflowRun" ADD CONSTRAINT "TaskWorkflowRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskWorkflowRun" ADD CONSTRAINT "TaskWorkflowRun_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoNotificationPreference" ADD CONSTRAINT "RepoNotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoNotificationPreference" ADD CONSTRAINT "RepoNotificationPreference_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoStar" ADD CONSTRAINT "RepoStar_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoStar" ADD CONSTRAINT "RepoStar_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoPin" ADD CONSTRAINT "RepoPin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RepoPin" ADD CONSTRAINT "RepoPin_repoId_fkey" FOREIGN KEY ("repoId") REFERENCES "Repo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSecurityState" ADD CONSTRAINT "UserSecurityState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SecurityEvent" ADD CONSTRAINT "SecurityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivateAccount" ADD CONSTRAINT "PrivateAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonalAccessToken" ADD CONSTRAINT "PersonalAccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

