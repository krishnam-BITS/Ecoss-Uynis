'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '../../components/AppShell';
import { RepoListRow, type RepoLanguage } from '../../components/RepoListRow';
import { apiFetch } from '../../lib/api';
import { getToken } from '../../lib/auth';
import {
  normalizeDisplayName,
  normalizeSlugInput,
  REPO_NAME_MAX,
  ROUTE_SLUG_MAX,
  validateRepoName,
  validateRouteSlugInput,
} from '../../lib/resource-validation';
import { getSelectedWorkspaceId, setSelectedWorkspaceId } from '../../lib/workspace';
import {
  PortalEmptyState,
  PortalList,
  PortalModal,
  PortalPage,
} from '../../components/portal';
import { PortalToast } from '../../components/PortalToast';
import { Button, Card, EmptyState, InlineFormRow } from '../../src/components/ui';

type Workspace = {
  id: string;
  name: string;
  slug: string;
  isPersonal?: boolean;
};

type Repo = {
  id: string;
  name: string;
  slug: string;
  visibility: 'PUBLIC' | 'PRIVATE' | 'INTERNAL';
  defaultBranch?: string;
  languageBytes?: number;
  languages?: RepoLanguage[];
};

export default function RepositoriesPage() {
  const signedImportThreshold = 20 * 1024 * 1024;
  const searchParams = useSearchParams();
  const query = (searchParams.get('q') ?? '').trim().toLowerCase();
  const workspaceQuery = (searchParams.get('workspace') ?? '').trim();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeWorkspace, setActiveWorkspace] = useState<Workspace | null>(null);
  const [repos, setRepos] = useState<Repo[]>([]);
  const [hasToken, setHasToken] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [visibility, setVisibility] = useState<'PUBLIC' | 'PRIVATE' | 'INTERNAL'>('PRIVATE');
  const [importName, setImportName] = useState('');
  const [importSlug, setImportSlug] = useState('');
  const [importVisibility, setImportVisibility] =
    useState<'PUBLIC' | 'PRIVATE' | 'INTERNAL'>('PRIVATE');
  const [importMode, setImportMode] = useState<'zip' | 'remote'>('zip');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importUrl, setImportUrl] = useState('');
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isDropActive, setIsDropActive] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createNameError, setCreateNameError] = useState<string | null>(null);
  const [createSlugError, setCreateSlugError] = useState<string | null>(null);
  const [importNameError, setImportNameError] = useState<string | null>(null);
  const [importSlugError, setImportSlugError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const closeCreateModal = () => {
    setIsCreateOpen(false);
    setCreateNameError(null);
    setCreateSlugError(null);
  };

  const closeImportModal = () => {
    setIsImportOpen(false);
    setImportNameError(null);
    setImportSlugError(null);
    setImportError(null);
    setIsDropActive(false);
  };

  useEffect(() => {
    setHasToken(Boolean(getToken()));
  }, []);

  useEffect(() => {
    if (!hasToken) {
      return;
    }
    const load = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const workspaceData = await apiFetch<{ workspaces?: Workspace[] }>('/workspaces');
        const workspaceList = workspaceData.workspaces ?? [];
        const selectedWorkspaceId = getSelectedWorkspaceId();
        const queryWorkspaceMatch = workspaceQuery
          ? workspaceList.find(
              (workspace) =>
                workspace.id === workspaceQuery || workspace.slug === workspaceQuery,
            )
          : null;
        const nextActiveWorkspace =
          queryWorkspaceMatch ??
          (selectedWorkspaceId
            ? workspaceList.find(
                (workspace) =>
                  workspace.id === selectedWorkspaceId ||
                  workspace.slug === selectedWorkspaceId,
              )
            : null) ??
          workspaceList.find((workspace) => workspace.isPersonal) ??
          workspaceList[0] ??
          null;
        if (nextActiveWorkspace) {
          setSelectedWorkspaceId(nextActiveWorkspace.id);
        }
        setActiveWorkspace(nextActiveWorkspace);

        if (!nextActiveWorkspace) {
          setRepos([]);
          return;
        }

        const repoData = await apiFetch<{ repos: Repo[] }>(
          `/workspaces/${nextActiveWorkspace.id}/repos`,
        );
        setRepos(repoData.repos);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unable to load repositories.');
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, [hasToken, workspaceQuery]);

  useEffect(() => {
    if (activeWorkspace?.isPersonal && visibility === 'INTERNAL') {
      setVisibility('PRIVATE');
    }
    if (activeWorkspace?.isPersonal && importVisibility === 'INTERNAL') {
      setImportVisibility('PRIVATE');
    }
  }, [activeWorkspace, visibility, importVisibility]);

  const filteredRepos = useMemo(() => {
    if (!query) {
      return repos;
    }
    return repos.filter((repo) =>
      `${repo.name} ${repo.slug}`.toLowerCase().includes(query),
    );
  }, [query, repos]);

  const visibilityCounts = useMemo(
    () =>
      repos.reduce(
        (acc, repo) => {
          acc.total += 1;
          if (repo.visibility === 'PUBLIC') {
            acc.public += 1;
          } else if (repo.visibility === 'PRIVATE') {
            acc.private += 1;
          } else {
            acc.internal += 1;
          }
          return acc;
        },
        { total: 0, public: 0, private: 0, internal: 0 },
      ),
    [repos],
  );

  const resetImportForm = () => {
    setImportName('');
    setImportSlug('');
    setImportVisibility('PRIVATE');
    setImportMode('zip');
    setImportFile(null);
    setImportUrl('');
    setImportNameError(null);
    setImportSlugError(null);
    setImportError(null);
    setIsDropActive(false);
  };

  const openCreateModal = () => {
    setImportStatus(null);
    setError(null);
    closeImportModal();
    setName('');
    setSlug('');
    setVisibility('PRIVATE');
    setCreateNameError(null);
    setCreateSlugError(null);
    setIsCreateOpen(true);
  };

  const openImportModal = () => {
    setImportStatus(null);
    setError(null);
    closeCreateModal();
    resetImportForm();
    setIsImportOpen(true);
  };

  const handleImportFileChange = (file: File | null) => {
    setImportError(null);
    setImportFile(file);
    if (file) {
      setImportMode('zip');
      setImportUrl('');
    }
  };

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setImportStatus(null);
    setCreateNameError(null);
    setCreateSlugError(null);

    if (!activeWorkspace) {
      setError('Select a workspace first.');
      return;
    }

    const normalizedName = normalizeDisplayName(name);
    const normalizedSlug = normalizeSlugInput(slug);
    const nameError = validateRepoName(normalizedName);
    const slugError = validateRouteSlugInput(normalizedSlug);

    if (nameError) {
      setCreateNameError(nameError);
      return;
    }

    if (slugError) {
      setCreateSlugError(slugError);
      return;
    }

    setIsCreating(true);

    try {
      const data = await apiFetch<{ repo: Repo }>(`/workspaces/${activeWorkspace.id}/repos`, {
        method: 'POST',
        body: JSON.stringify({
          name: normalizedName,
          slug: normalizedSlug || undefined,
          visibility,
        }),
      });
      setRepos((prev) => [data.repo, ...prev]);
      setImportStatus(`Repository "${data.repo.name}" created.`);
      setName('');
      setSlug('');
      setVisibility('PRIVATE');
      closeCreateModal();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to create repo.');
    } finally {
      setIsCreating(false);
    }
  };

  const handleImport = async (event: FormEvent) => {
    event.preventDefault();
    setImportError(null);
    setImportStatus(null);
    setImportNameError(null);
    setImportSlugError(null);

    if (!activeWorkspace) {
      setImportError('Select a workspace first.');
      return;
    }

    if (!importName.trim()) {
      setImportError('Repository name is required.');
      return;
    }

    const normalizedImportName = normalizeDisplayName(importName);
    const normalizedImportSlug = normalizeSlugInput(importSlug);
    const importNameError = validateRepoName(normalizedImportName);
    const importSlugError = validateRouteSlugInput(normalizedImportSlug);

    if (importNameError) {
      setImportNameError(importNameError);
      return;
    }

    if (importSlugError) {
      setImportSlugError(importSlugError);
      return;
    }

    if (importMode === 'zip' && !importFile) {
      setImportError('Choose a zip archive to import.');
      return;
    }

    if (importMode === 'remote' && !importUrl.trim()) {
      setImportError('Enter a remote Git URL to import.');
      return;
    }

    setIsImporting(true);

    let createdRepo: Repo;
    try {
      const created = await apiFetch<{ repo: Repo }>(
        `/workspaces/${activeWorkspace.id}/repos`,
        {
          method: 'POST',
          body: JSON.stringify({
            name: normalizedImportName,
            slug: normalizedImportSlug || undefined,
            visibility: importVisibility,
          }),
        },
      );
      createdRepo = created.repo;
      setRepos((prev) => [created.repo, ...prev]);
    } catch (err) {
      setImportError(
        err instanceof Error ? err.message : 'Unable to create repository for import.',
      );
      setIsImporting(false);
      return;
    }

    try {
      if (importMode === 'zip' && importFile) {
        const shouldUseSigned = importFile.size > signedImportThreshold;
        if (shouldUseSigned) {
          const upload = await apiFetch<{ uploadId: string; uploadUrl: string }>(
            `/workspaces/${activeWorkspace.id}/repos/${createdRepo.id}/import/uploads`,
            {
              method: 'POST',
              body: JSON.stringify({
                fileName: importFile.name,
                contentType: importFile.type || 'application/zip',
                size: importFile.size,
              }),
            },
          );
          await fetch(upload.uploadUrl, {
            method: 'PUT',
            headers: {
              'content-type': importFile.type || 'application/zip',
            },
            body: importFile,
          });
          await apiFetch(
            `/workspaces/${activeWorkspace.id}/repos/${createdRepo.id}/import/jobs/zip/from-upload`,
            {
              method: 'POST',
              body: JSON.stringify({
                uploadId: upload.uploadId,
                branch: createdRepo.defaultBranch ?? 'main',
                message: 'Import repository content',
                maxAttempts: 3,
              }),
            },
          );
        } else {
          const formData = new FormData();
          formData.append('archive', importFile);
          const params = new URLSearchParams({
            branch: createdRepo.defaultBranch ?? 'main',
            message: 'Import repository content',
            maxAttempts: '3',
          });
          await apiFetch<{ job: { id: string } }>(
            `/workspaces/${activeWorkspace.id}/repos/${createdRepo.id}/import/jobs/zip?${params.toString()}`,
            {
              method: 'POST',
              body: formData,
            },
          );
        }
      } else {
        await apiFetch<{ job: { id: string } }>(
          `/workspaces/${activeWorkspace.id}/repos/${createdRepo.id}/import/jobs/remote`,
          {
            method: 'POST',
            body: JSON.stringify({ url: importUrl.trim(), maxAttempts: 3 }),
          },
        );
      }

      setImportStatus(`Repository "${createdRepo.name}" created. Import queued.`);
      closeImportModal();
      resetImportForm();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Unable to queue repository import.';
      setImportError(
        `Repository "${createdRepo.name}" was created, but import failed: ${message}`,
      );
    } finally {
      setIsImporting(false);
    }
  };

  const handleDropZoneDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setIsDropActive(true);
  };

  const handleDropZoneDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDropActive(false);
  };

  const handleDropZoneDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDropActive(false);
    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) {
      return;
    }
    if (!file.name.toLowerCase().endsWith('.zip')) {
      setImportError('Upload a .zip archive.');
      return;
    }
    handleImportFileChange(file);
  };

  const handleDropZoneKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      fileInputRef.current?.click();
    }
  };

  return (
    <AppShell title="Repositories">
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      {importStatus ? (
        <PortalToast message={importStatus} tone="success" onClose={() => setImportStatus(null)} />
      ) : null}
      {importError ? (
        <PortalToast message={importError} tone="error" onClose={() => setImportError(null)} />
      ) : null}
      <PortalPage className="repo-index-shell">
        {hasToken ? (
          <>
            <section className="card canvas-card repo-index-summary">
              <div className="stack">
                <div className="repo-summary-head">
                  <div className="repo-summary-title">
                    <h3 className="canvas-title">Repositories</h3>
                    <p className="canvas-subtitle">
                      {activeWorkspace
                        ? `Active workspace: ${activeWorkspace.name}`
                        : 'Select a workspace to create or import repositories.'}
                    </p>
                  </div>
                  <div className="repo-summary-actions">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={openImportModal}
                      disabled={!activeWorkspace}
                    >
                      Import repository
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={openCreateModal}
                      disabled={!activeWorkspace}
                    >
                      Create repository
                    </Button>
                  </div>
                </div>
                <div className="repo-index-summary-grid">
                  <div className="repo-index-summary-item">
                    <span>Total</span>
                    <strong>{visibilityCounts.total}</strong>
                  </div>
                  <div className="repo-index-summary-item">
                    <span>Public</span>
                    <strong>{visibilityCounts.public}</strong>
                  </div>
                  <div className="repo-index-summary-item">
                    <span>Private</span>
                    <strong>{visibilityCounts.private}</strong>
                  </div>
                  <div className="repo-index-summary-item">
                    <span>Internal</span>
                    <strong>{visibilityCounts.internal}</strong>
                  </div>
                </div>
              </div>
            </section>

            <PortalList>
              {query ? (
                <p className="muted repo-filter-hint">
                  Search active: &quot;{query}&quot;
                </p>
              ) : null}
              {isLoading ? (
                <p className="muted inbox-state">Loading repositories...</p>
              ) : filteredRepos.length ? (
                <ul className="list">
                  {filteredRepos.map((repo) => (
                    <RepoListRow
                      key={repo.id}
                      name={repo.name}
                      defaultBranch={repo.defaultBranch}
                      visibility={repo.visibility}
                      languages={repo.languages}
                      href={`/workspaces/${activeWorkspace?.slug ?? activeWorkspace?.id}/repos/${repo.slug}`}
                    />
                  ))}
                </ul>
              ) : (
                <PortalEmptyState
                  message={
                    activeWorkspace
                      ? repos.length
                        ? 'No repositories match this search.'
                        : 'No repositories in this workspace.'
                      : 'Select a workspace from the sidebar.'
                  }
                />
              )}
            </PortalList>

            <PortalModal
              open={isCreateOpen}
              onClose={closeCreateModal}
              title="Create repository"
              panelClassName="workspace-create-modal"
            >
              <form className="stack" onSubmit={handleCreate}>
                <label className="field">
                  <span>Repository name</span>
                  <input
                    type="text"
                    value={name}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setName(nextValue);
                      if (createNameError) {
                        setCreateNameError(
                          validateRepoName(normalizeDisplayName(nextValue)),
                        );
                      }
                    }}
                    onBlur={() =>
                      setCreateNameError(
                        validateRepoName(normalizeDisplayName(name)),
                      )
                    }
                    placeholder="landing-service"
                    maxLength={REPO_NAME_MAX}
                    aria-invalid={Boolean(createNameError)}
                    required
                    autoFocus
                  />
                </label>
                {createNameError ? (
                  <p className="error workspace-field-error">{createNameError}</p>
                ) : null}
                <label className="field">
                  <span>Repository slug (optional)</span>
                  <input
                    type="text"
                    value={slug}
                    onChange={(event) => {
                      const nextSlug = normalizeSlugInput(event.target.value);
                      setSlug(nextSlug);
                      if (createSlugError) {
                        setCreateSlugError(validateRouteSlugInput(nextSlug));
                      }
                    }}
                    onBlur={() =>
                      setCreateSlugError(
                        validateRouteSlugInput(normalizeSlugInput(slug)),
                      )
                    }
                    placeholder="landing-service"
                    maxLength={ROUTE_SLUG_MAX}
                    aria-invalid={Boolean(createSlugError)}
                  />
                </label>
                {createSlugError ? (
                  <p className="error workspace-field-error">{createSlugError}</p>
                ) : null}
                <label className="field">
                  <span>Visibility</span>
                  <select
                    value={visibility}
                    onChange={(event) =>
                      setVisibility(
                        event.target.value as 'PUBLIC' | 'PRIVATE' | 'INTERNAL',
                      )
                    }
                  >
                    <option value="PRIVATE">Private</option>
                    {!activeWorkspace?.isPersonal ? (
                      <option value="INTERNAL">Internal</option>
                    ) : null}
                    <option value="PUBLIC">Public</option>
                  </select>
                </label>
                <InlineFormRow className="workspace-modal-actions" align="start">
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={isCreating || !activeWorkspace}
                  >
                    {isCreating ? 'Creating...' : 'Create repository'}
                  </Button>
                </InlineFormRow>
              </form>
            </PortalModal>

            <PortalModal
              open={isImportOpen}
              onClose={closeImportModal}
              title="Import repository"
              panelClassName="workspace-create-modal repo-import-modal"
            >
              <form className="stack" onSubmit={handleImport}>
                <label className="field">
                  <span>Repository name</span>
                  <input
                    type="text"
                    value={importName}
                    onChange={(event) => {
                      const nextValue = event.target.value;
                      setImportName(nextValue);
                      if (importNameError) {
                        setImportNameError(
                          validateRepoName(normalizeDisplayName(nextValue)),
                        );
                      }
                    }}
                    onBlur={() =>
                      setImportNameError(
                        validateRepoName(normalizeDisplayName(importName)),
                      )
                    }
                    placeholder="platform-api"
                    maxLength={REPO_NAME_MAX}
                    aria-invalid={Boolean(importNameError)}
                    required
                    autoFocus
                  />
                </label>
                {importNameError ? (
                  <p className="error workspace-field-error">{importNameError}</p>
                ) : null}
                <label className="field">
                  <span>Repository slug (optional)</span>
                  <input
                    type="text"
                    value={importSlug}
                    onChange={(event) => {
                      const nextSlug = normalizeSlugInput(event.target.value);
                      setImportSlug(nextSlug);
                      if (importSlugError) {
                        setImportSlugError(validateRouteSlugInput(nextSlug));
                      }
                    }}
                    onBlur={() =>
                      setImportSlugError(
                        validateRouteSlugInput(normalizeSlugInput(importSlug)),
                      )
                    }
                    placeholder="platform-api"
                    maxLength={ROUTE_SLUG_MAX}
                    aria-invalid={Boolean(importSlugError)}
                  />
                </label>
                {importSlugError ? (
                  <p className="error workspace-field-error">{importSlugError}</p>
                ) : null}
                <label className="field">
                  <span>Visibility</span>
                  <select
                    value={importVisibility}
                    onChange={(event) =>
                      setImportVisibility(
                        event.target.value as 'PUBLIC' | 'PRIVATE' | 'INTERNAL',
                      )
                    }
                  >
                    <option value="PRIVATE">Private</option>
                    {!activeWorkspace?.isPersonal ? (
                      <option value="INTERNAL">Internal</option>
                    ) : null}
                    <option value="PUBLIC">Public</option>
                  </select>
                </label>

                <div className="repo-import-mode-switch" role="tablist" aria-label="Import source">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={importMode === 'zip'}
                    className={`repo-import-mode-btn ${importMode === 'zip' ? 'active' : ''}`}
                    onClick={() => {
                      setImportMode('zip');
                      setImportUrl('');
                      setImportError(null);
                    }}
                  >
                    Zip upload
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={importMode === 'remote'}
                    className={`repo-import-mode-btn ${importMode === 'remote' ? 'active' : ''}`}
                    onClick={() => {
                      setImportMode('remote');
                      setImportFile(null);
                      setImportError(null);
                    }}
                  >
                    Remote URL
                  </button>
                </div>

                {importMode === 'zip' ? (
                  <div className="stack">
                    <input
                      ref={fileInputRef}
                      className="repo-import-file-input"
                      type="file"
                      accept=".zip"
                      onChange={(event) =>
                        handleImportFileChange(event.target.files?.[0] ?? null)
                      }
                    />
                    <div
                      className={`repo-import-dropzone ${isDropActive ? 'is-dragover' : ''} ${importFile ? 'has-file' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={handleDropZoneKeyDown}
                      onDragOver={handleDropZoneDragOver}
                      onDragLeave={handleDropZoneDragLeave}
                      onDrop={handleDropZoneDrop}
                    >
                      <strong>Drag and drop zip here</strong>
                      <span className="muted">or click to choose from your device</span>
                    </div>
                    {importFile ? (
                      <div className="repo-import-file-row">
                        <div>
                          <strong>{importFile.name}</strong>
                          <span className="muted">
                            {(importFile.size / (1024 * 1024)).toFixed(2)} MB
                          </span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleImportFileChange(null)}
                        >
                          Remove
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <label className="field">
                    <span>Remote Git URL</span>
                    <input
                      type="url"
                      value={importUrl}
                      onChange={(event) => setImportUrl(event.target.value)}
                      placeholder="https://github.com/workspace/repo.git"
                      required
                    />
                  </label>
                )}

                {importMode === 'zip' && importFile && importFile.size > signedImportThreshold ? (
                  <p className="muted">
                    Large archive detected. We will use direct upload before queueing the import.
                  </p>
                ) : null}
                <InlineFormRow className="workspace-modal-actions" align="start">
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={isImporting || !activeWorkspace}
                  >
                    {isImporting ? 'Importing...' : 'Create and import'}
                  </Button>
                </InlineFormRow>
              </form>
            </PortalModal>
          </>
        ) : (
          <PortalList>
            <PortalEmptyState message="Sign in to view repositories and workspace context." />
            <div className="row portal-empty-actions">
              <Button variant="ghost" href="/login">
                Sign in
              </Button>
            </div>
          </PortalList>
        )}
      </PortalPage>
    </AppShell>
  );
}


