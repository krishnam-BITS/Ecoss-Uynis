# Database Schema Overview

This document summarizes the current application data model defined in `packages/db/prisma/schema.prisma`.

## Current Totals

- Tables (`model` definitions): 57
- Enums: 37
- Total Prisma fields: 704
- Physical database columns (scalar + enum fields): 514
- Relation fields (Prisma-only join/navigation fields): 190

## What Counts As A Table

In this codebase, each Prisma `model` maps to a database table.

- Scalar fields such as `String`, `Int`, `Boolean`, `DateTime`, `Json`, and `BigInt` become database columns.
- Enum fields also become database columns.
- Relation fields connect tables in Prisma, but they are not separate physical columns unless paired with an ID field such as `userId`, `repoId`, or `workspaceId`.

## Table Inventory By Area

### Identity And Access

- `User`
- `UsernameReservation`
- `UserSecurityState`
- `UserSession`
- `SecurityEvent`
- `PrivateAccount`
- `PersonalAccessToken`

### Workspaces And Teams

- `Workspace`
- `WorkspaceMember`
- `WorkspaceInvite`
- `Team`
- `TeamMember`

### Repositories And Governance

- `Repo`
- `RepoMember`
- `BranchRule`
- `TeamRepoPermission`
- `RepoAutomationToken`
- `RepoWebhookSecret`
- `RepoWebhook`
- `RepoWebhookDelivery`
- `RepoImportJob`
- `UploadToken`
- `RepoStar`
- `RepoPin`
- `RepoNotificationPreference`

### Issues And Pull Requests

- `Issue`
- `IssueComment`
- `RepoLabel`
- `IssueAssignee`
- `IssueLabel`
- `PullRequest`
- `PullRequestAssignee`
- `PullRequestLabel`
- `PullRequestComment`
- `PullRequestReview`
- `PullRequestCheck`
- `CommitCheck`
- `PullRequestReviewComment`
- `PullRequestReviewRequest`

### Discussions And Chat

- `DiscussionThread`
- `DiscussionMessageThread`
- `DiscussionChannel`
- `DiscussionCall`
- `DiscussionCallNote`
- `DiscussionMessage`
- `DiscussionThreadReply`
- `DiscussionChannelPost`
- `ChatConversation`
- `ChatConversationMember`
- `ChatMessage`
- `ChatAttachment`
- `ChatMessageReceipt`
- `ChatCallSession`

### Workflows And Notifications

- `TaskWorkflow`
- `TaskWorkflowRun`
- `Notification`
- `NotificationPreference`

## Largest Tables By Physical Column Count

- `User`: 30 columns
- `Workspace`: 20 columns
- `PrivateAccount`: 19 columns
- `RepoImportJob`: 19 columns
- `WorkspaceInvite`: 16 columns
- `NotificationPreference`: 15 columns

## Notes On Repo And Relation-Heavy Models

Some models look small at the database level but expose many Prisma relation fields.

- `Repo` has 11 physical columns, but 31 total Prisma fields because it connects to many other records.
- `User` has 30 physical columns and 76 total Prisma fields because it is referenced across most product areas.

This is expected and reflects how Prisma represents relationships in the schema.

## Where To Inspect Exact Fields

For the exact current field list, use these sources:

- Schema source: `packages/db/prisma/schema.prisma`
- Migration history: `packages/db/prisma/migrations/`

If you need a field-by-field breakdown, open the model in `schema.prisma` and read the scalar/enum fields first. Those are the actual table columns.
