
```bash
# Uynis CLI Documentation

## Quick Start

### 1. Start Services

```bash
docker compose -f infra/docker-compose.yml up -d
docker compose -f infra/docker-compose.yml ps
```

### 2. Health Checks

```bash
curl http://localhost:4000/health
curl http://localhost:4001/health
```

### 3. View CLI Help

```bash
pnpm cli --help
```

---

## CLI Setup & Authentication

### Configure CLI Profile

```bash
# Set a new profile with your PAT (generated in UI Settings)
pnpm cli config profile set --name committee --api http://localhost:4000 --token <PASTE_PAT_HERE>

# Use the profile
pnpm cli config profile use --name committee

# Verify authentication
pnpm cli auth whoami

# List all profiles
pnpm cli config profile list
pnpm cli config show
```

---

## Creating & Managing Repositories

### List Workspaces

```bash
pnpm cli workspace list
```

### Create a New Repository

```bash
# Create a private repository
pnpm cli repo create --workspace krishnam --name committee-demo-repo --visibility PRIVATE

# Create a public repository
pnpm cli repo create --workspace krishnam --name my-repo --visibility PUBLIC

# List repositories in workspace
pnpm cli repo list --workspace krishnam
```

---

## Uploading Files & Content

### Upload Files to Repository

```bash
# Upload with inline content
pnpm cli files upload \
  --workspace krishnam \
  --repo committee-demo-repo \
  --path README.md \
  --content "# Committee Demo\nCreated via CLI." \
  --message "Add README from CLI"

# Upload from local file
pnpm cli files upload \
  --workspace krishnam \
  --repo committee-demo-repo \
  --path docs/guide.md \
  --file ./local-guide.md \
  --message "Add documentation"
```

### Multiple File Upload Workflow

```bash
# 1. Create repo
pnpm cli repo create --workspace krishnam --name my-project --visibility PUBLIC

# 2. Upload README
pnpm cli files upload \
  --workspace krishnam \
  --repo my-project \
  --path README.md \
  --content "# My Project\n\nProject description here." \
  --message "Initial commit: Add README"

# 3. Upload additional files
pnpm cli files upload \
  --workspace krishnam \
  --repo my-project \
  --path package.json \
  --file ./package.json \
  --message "Add package.json"

# 4. View in UI at: http://localhost:3000/krishnam/my-project
# All changes reflect immediately in the UI through the same backend state
```

---

## Monitoring Import Progress

The CLI includes a built-in progress monitor for all async import operations using the `--watch` flag.

### Progress Bar Display

When you use `--watch`, the CLI displays real-time progress:

```
📦 Monitoring import job...

⏳ QUEUED                                        # Initially queued
⚙️  RUNNING [██████████░░░░░░░░░░░░░░░░░░░░] 15 branches imported  # Progress updates
✅ COMPLETED                                    # Final status
```

The progress bar shows:
- **Status emoji**: ⏳ QUEUED, ⚙️ RUNNING, ✅ COMPLETED, ❌ FAILED
- **Progress bar**: Visual indicator of import progress (for RUNNING jobs)
- **Count**: Number of branches or files imported so far
- **Final summary**: Total branches, files, default branch, and latest commit

### Using --watch with Async Imports

```bash
# Start an async import and monitor progress
pnpm cli repo import-remote-async \
  --workspace krishnam-murarka \
  --repo my-repo \
  --url https://github.com/torvalds/linux.git \
  --branch master \
  --watch

# The command will:
# 1. Create the import job and display the job details
# 2. Start monitoring progress with real-time updates
# 3. Exit when import completes or fails
```

### Using --watch with Existing Jobs

```bash
# Monitor an existing import job
pnpm cli repo import-job \
  --workspace krishnam-murarka \
  --repo my-repo \
  --job <jobId> \
  --watch

# The command will:
# 1. Fetch current job status
# 2. Start monitoring for updates
# 3. Update as job progresses
# 4. Exit when complete or failed
```

### Without --watch (Manual Checking)

```bash
# Check job status once
pnpm cli repo import-job --workspace krishnam-murarka --repo my-repo --job <jobId>

# List all jobs for a repo
pnpm cli repo import-jobs --workspace krishnam-murarka --repo my-repo
```

---

## Importing Repositories

### Import from GitHub (Remote URL)

> **Note:** repositories created through the CLI are automatically initialized with a
> `README.md`.  Imports only work against an empty repository, so if you plan to import
> content immediately use `--no-init` when running `repo create` (or delete the placeholder
> README afterwards).

```bash
# Create an empty repository (no README)
pnpm cli repo create --workspace krishnam-murarka --name imported-repo --visibility PUBLIC --no-init

# Option 1: Synchronous import (small repos)
# ⚠️ WARNING: this operation blocks and may time out on large repositories.
# Use the `-async` variant if the repo is big or you need progress tracking.
pnpm cli repo import-remote \
  --workspace krishnam-murarka \
  --repo imported-repo \
  --url https://github.com/user/repo.git \
  --branch main

# Option 2: Asynchronous import (large repos, preferred)
pnpm cli repo import-remote-async \
  --workspace krishnam-murarka \
  --repo imported-repo \
  --url https://github.com/torvalds/linux.git \
  --branch master \
  --max-attempts 5

# Option 3: Asynchronous import with progress monitoring
pnpm cli repo import-remote-async \
  --workspace krishnam-murarka \
  --repo imported-repo \
  --url https://github.com/torvalds/linux.git \
  --branch master \
  --max-attempts 5 \
  --watch

# Check import job status (manual)
pnpm cli repo import-jobs --workspace krishnam-murarka --repo imported-repo
pnpm cli repo import-job --workspace krishnam-murarka --repo imported-repo --job <jobId>

# Check import job status with progress bar
pnpm cli repo import-job --workspace krishnam-murarka --repo imported-repo --job <jobId> --watch
```

### Import from ZIP Archive

```bash
# Synchronous import
# ⚠️ WARNING: this uploads and processes the archive immediately.
# Large files (>50 MB) may cause a timeout; prefer `import-zip-async`.
pnpm cli repo import-zip \
  --workspace krishnam-murarka \
  --repo imported-repo \
  --file ./my-archive.zip \
  --branch main \
  --message "Import from archive"

# Asynchronous import
pnpm cli repo import-zip-async \
  --workspace krishnam-murarka \
  --repo imported-repo \
  --file ./large-archive.zip \
  --branch main \
  --message "Import from archive" \
  --max-attempts 5

# Asynchronous import with progress monitoring
pnpm cli repo import-zip-async \
  --workspace krishnam-murarka \
  --repo imported-repo \
  --file ./large-archive.zip \
  --branch main \
  --message "Import from archive" \
  --max-attempts 5 \
  --watch

# Check job status (manual)
pnpm cli repo import-jobs --workspace krishnam-murarka --repo imported-repo
```

### Cancel Import Job

```bash
pnpm cli repo import-cancel --workspace krishnam --repo imported-repo --job <jobId>
```

---

## Git Over HTTP Workflow

### Push Changes via Git

```bash
# Clone the repository (private workspaces require authentication)
# if the repo is private git will respond with a 
# `WWW-Authenticate: Basic` challenge which causes Git
# to prompt you for credentials.  enter your **username** and
# as the password use your personal access token *including the
# `uynis_pat_` prefix*.  you can also embed credentials in the URL:
#
#   git clone http://<username>:<full-token>@localhost:4001/krishnam/committee-demo-repo.git
#
# (the server now sends the challenge header automatically,
# so the plain URL form works without extra config.)

git clone http://localhost:4001/krishnam/committee-demo-repo.git
cd committee-demo-repo

# Make changes
echo "commit from committee demo" >> notes.txt

# Commit and push
git add notes.txt
git commit -m "demo: git over http push"
git push origin main

# View changes in UI at: http://localhost:3000/krishnam/committee-demo-repo
# The commit is immediately visible in the repository history and activity

# inside your workspace
git init
git add .
git commit -m "initial import"

pnpm cli repo create \
  --workspace krishnam-murarka \
  --name ecoss-uynis \
  --visibility PUBLIC

# set the remote and push
git remote add origin http://localhost:4001/krishnam-murarka/ecoss-uynis.git
git push -u origin main
```

---

## Token Management

### Create API Token

```bash
pnpm cli token create --name "My Token" --scopes "repo:read,repo:write" --expires 30

# List tokens
pnpm cli token list

# Revoke a token
pnpm cli token revoke --token-id <token-id>
```

### Alternative Auth Methods

```bash
# Login with email/password
pnpm cli auth login --identifier you@example.com --password "your-password"

# Set token directly
pnpm cli auth token set --token <pat>

# Clear token
pnpm cli auth token clear

# Logout
pnpm cli logout
```

---

## Repository Checks & Webhooks

### Set Check Status

```bash
pnpm cli checks set \
  --workspace krishnam \
  --repo my-repo \
  --sha abc123def456 \
  --context "continuous-integration/my-check" \
  --status SUCCESS \
  --details "All tests passed"
```

### Configure Webhook

```bash
# Get webhook secret
pnpm cli webhook secret --workspace krishnam --repo my-repo
```

---

## Admin Commands

### View System Health

```bash
pnpm cli admin health
```

### Search & Manage Resources

```bash
# Search users
pnpm cli admin users --q "john" --limit 10

# Search workspaces
pnpm cli admin workspaces --q "team" --limit 10

# Search repositories
pnpm cli admin repos --q "api" --limit 10

# List PATs
pnpm cli admin pats --q "token-name" --limit 10
pnpm cli admin revoke-pat --token-id <id>

# Monitor webhooks
pnpm cli admin webhooks --active true --limit 20

# Check import jobs
pnpm cli admin import-jobs --status RUNNING --limit 10
```

### Security Monitoring

```bash
# View security events
pnpm cli admin security events \
  --user-id <userId> \
  --event-type "login_failed" \
  --severity "high" \
  --from "2024-01-01T00:00:00Z" \
  --to "2024-12-31T23:59:59Z" \
  --limit 50

# Detect anomalies
pnpm cli admin security anomalies --limit 20

# Check user security state
pnpm cli admin security state --user-id <userId>
```

---

## System Commands

### Check System Status

```bash
pnpm cli system health
pnpm cli system ready
```

---

## Output Formatting

### Machine-Readable JSON Output

```bash
# Get JSON output for automation
pnpm cli workspace list --json
pnpm cli repo list --workspace krishnam --json
pnpm cli config show --json
```

---

## Complete End-to-End Example

### Scenario: Create a Repository from CLI and Verify in UI

```bash
# 1. Configure CLI profile
pnpm cli config profile set --name demo --api http://localhost:4000 --token <YOUR_PAT>
pnpm cli config profile use --name demo

# 2. Verify authentication
pnpm cli auth whoami

# 3. Create repository
pnpm cli repo create --workspace krishnam --name my-demo-repo --visibility PUBLIC

# 4. Upload initial files
pnpm cli files upload \
  --workspace krishnam \
  --repo my-demo-repo \
  --path README.md \
  --content "# My Demo Repository\n\nCreated via Uynis CLI." \
  --message "Initial commit: Add README"

# 5. Upload more files
pnpm cli files upload \
  --workspace krishnam \
  --repo my-demo-repo \
  --path GETTING_STARTED.md \
  --content "## Getting Started\n\n1. Clone the repo\n2. Read README.md" \
  --message "Add getting started guide"

# 6. Switch to UI
# Navigate to: http://localhost:3000/krishnam/my-demo-repo
# ✓ Repository is visible
# ✓ Files are displayed
# ✓ Commit history shows CLI uploads
# ✓ All backed by the same system state

# 7. Optional: Use Git to push additional commits
git clone http://localhost:4001/krishnam/my-demo-repo.git
cd my-demo-repo
echo "Additional content" >> notes.txt
git add notes.txt
git commit -m "Add notes from git"
git push origin main

# 8. Refresh UI to see git-pushed changes
```

---

## Upload Ecoss-Uynis Repository Example

### Create & Upload Current Repository

```bash
# Setup
cd /Users/km/Dev/Uynis/Ecoss-Uynis
pnpm cli config profile set --name committee --api http://localhost:4000 --token <YOUR_PAT>
pnpm cli config profile use --name committee
pnpm cli auth whoami

# Create repository
pnpm cli repo create --workspace krishnam --name ecoss-uynis --visibility PUBLIC

# Upload main files
pnpm cli files upload \
  --workspace krishnam \
  --repo ecoss-uynis \
  --path README.md \
  --file ./README.md \
  --message "Upload README"

pnpm cli files upload \
  --workspace krishnam \
  --repo ecoss-uynis \
  --path package.json \
  --file ./package.json \
  --message "Upload package.json"

pnpm cli files upload \
  --workspace krishnam \
  --repo ecoss-uynis \
  --path tsconfig.json \
  --file ./tsconfig.json \
  --message "Upload tsconfig.json"

pnpm cli files upload \
  --workspace krishnam \
  --repo ecoss-uynis \
  --path turbo.json \
  --file ./turbo.json \
  --message "Upload turbo.json"

pnpm cli files upload \
  --workspace krishnam \
  --repo ecoss-uynis \
  --path cli.md \
  --file ./cli.md \
  --message "Upload CLI documentation"

# View in UI
# Navigate to: http://localhost:3000/krishnam/ecoss-uynis
# ✓ All files visible and accessible
# ✓ Full repository structure displayed
# ✓ Ready to clone via Git over HTTP

# Optional: Add more files from subdirectories
pnpm cli files upload \
  --workspace krishnam \
  --repo ecoss-uynis \
  --path apps/api/package.json \
  --file ./apps/api/package.json \
  --message "Upload API package configuration"

pnpm cli files upload \
  --workspace krishnam \
  --repo ecoss-uynis \
  --path apps/web/package.json \
  --file ./apps/web/package.json \
  --message "Upload Web package configuration"

pnpm cli files upload \
  --workspace krishnam \
  --repo ecoss-uynis \
  --path docs/architecture-overview.md \
  --file ./docs/architecture-overview.md \
  --message "Upload architecture documentation"

# Clone and push changes via Git
git clone http://localhost:4001/krishnam/ecoss-uynis.git
cd ecoss-uynis
echo "Synced with Uynis CLI" > SYNC_STATUS.md
git add SYNC_STATUS.md
git commit -m "docs: add CLI sync status"
git push origin main
```

### View in UI

After uploading, your repository is visible at:
```
http://localhost:3000/krishnam/ecoss-uynis
```

The repository will display:
- ✓ All uploaded files and structure
- ✓ Complete commit history (all CLI uploads appear as commits)
- ✓ File browser for navigation
- ✓ Raw file viewing
- ✓ Git clone URL: `http://localhost:4001/krishnam/ecoss-uynis.git`

---

## Quick Reference

### Most Common Commands

```bash
# Setup
pnpm cli config profile set --name <name> --api <url> --token <token>
pnpm cli config profile use --name <name>

# Check auth
pnpm cli auth whoami

# Create repo
pnpm cli repo create --workspace <id> --name <repo> --visibility PUBLIC

# Upload file
pnpm cli files upload --workspace <id> --repo <id> --path <path> --content "<text>" --message "<msg>"

# Import from GitHub (with progress bar)
pnpm cli repo import-remote-async --workspace <id> --repo <id> --url <git-url> --watch

# List resources
pnpm cli workspace list
pnpm cli repo list --workspace <id>
pnpm cli token list

# Check import job status
pnpm cli repo import-jobs --workspace <id> --repo <id>
pnpm cli repo import-job --workspace <id> --repo <id> --job <jobId>
```

### Global Options

```bash
--api <url>       # Override API base URL
--token <pat>     # Override authentication token
--profile <name>  # Use specific config profile
--json            # Output machine-readable JSON
--watch           # For async operations: poll and display progress (import commands)
--help            # Show command help
```

---

## Notes

- **CLI and UI share the same backend state** — Changes made via CLI appear immediately in the UI
- **All operations are auditable** — Security events and import jobs can be monitored via admin commands
- **Async imports recommended** — Use `import-*-async` commands for repositories > 100MB
- **Multiple authentication methods** — Use PAT for automation, login for interactive use

