'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../components/AppShell';
import { PortalPage, PortalToolbar } from '../../components/portal';
import { PortalToast } from '../../components/PortalToast';
import { apiFetch, ApiRequestError } from '../../lib/api';
import { getToken } from '../../lib/auth';
import { resolveMediaUrl } from '../../lib/media';
import { Button, Card, EmptyState, InlineFormRow, Modal } from '../../src/components/ui';

type UserOption = {
  id: string;
  label: string;
  username: string | null;
  email: string | null;
  avatarUrl: string | null;
  subtitle?: string | null;
};

type ConversationItem = {
  id: string;
  kind: 'DIRECT' | 'GROUP';
  title: string;
  description: string | null;
  avatarUrl: string | null;
  memberCount: number;
  unreadCount: number;
  lastMessageAt: string;
  lastMessagePreview: string | null;
  canCall: boolean;
};

type ConversationProfile = {
  id: string;
  kind: 'DIRECT' | 'GROUP';
  title: string;
  description: string | null;
  createdAt: string;
  members: Array<{
    id: string;
    label: string;
    username: string | null;
    email: string | null;
    bio: string | null;
    avatarUrl: string | null;
    role: 'MEMBER' | 'ADMIN';
    joinedAt: string;
  }>;
};

type MessageItem = {
  id: string;
  type: 'TEXT' | 'TASK' | 'SYSTEM';
  body: string;
  metadata: unknown;
  createdAt: string;
  sender: {
    id: string;
    label: string;
    avatarUrl: string | null;
    username: string | null;
  };
  self: boolean;
  state: 'SENT' | 'DELIVERED' | 'SEEN' | 'PLAYED';
  attachments: Array<{
    id: string;
    kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'AUDIO';
    url: string;
    fileName: string | null;
    mimeType: string | null;
    sizeBytes: number | null;
    expiresAt: string | null;
  }>;
};

type AttachmentItem = {
  kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'AUDIO';
  url: string;
  fileName: string;
};

type ChatCall = {
  id: string;
  mode: 'AUDIO' | 'VIDEO';
  state: 'RINGING' | 'ACTIVE' | 'ENDED' | 'MISSED';
  startedAt: string;
  startedById: string;
  conversationId?: string;
};

type ActiveCallEnvelope = {
  call: ChatCall | null;
};

type ConversationMessagesEnvelope = {
  messages: MessageItem[];
  nextCursor: string | null;
};

type ConversationMediaItem = {
  id: string;
  messageId: string;
  kind: 'IMAGE' | 'VIDEO' | 'FILE' | 'AUDIO';
  url: string;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  createdAt: string;
};

type ConversationMediaEnvelope = {
  items: ConversationMediaItem[];
  hasMore: boolean;
  nextOffset: number | null;
};

type CallSignalEvent = {
  seq: number;
  callId: string;
  fromUserId: string;
  toUserId: string | null;
  type: 'ringing' | 'accepted' | 'declined' | 'ended' | 'offer' | 'answer' | 'ice' | 'hold' | 'resume';
  payload: {
    sdp?: string;
    candidate?: RTCIceCandidateInit;
    hold?: boolean;
    reason?: string;
  };
  createdAt: string;
};

type CallEventsEnvelope = {
  cursor: number;
  events: CallSignalEvent[];
};

type CallPanelState = {
  callId: string;
  mode: 'AUDIO' | 'VIDEO';
  status: 'ringing' | 'connecting' | 'active' | 'ended';
  incoming: boolean;
  remoteUserId: string | null;
};

function parseViewerIdFromToken(): string | null {
  const token = getToken();
  if (!token) {
    return null;
  }
  try {
    const payloadPart = token.split('.')[1] ?? '';
    const normalized = payloadPart.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(normalized));
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

function resolveIceServers(): RTCIceServer[] {
  const raw = process.env.NEXT_PUBLIC_RTC_ICE_SERVERS?.trim();
  if (!raw) {
    return [{ urls: 'stun:stun.l.google.com:19302' }];
  }
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length) {
      return parsed as RTCIceServer[];
    }
  } catch {
    return [{ urls: raw }];
  }
  return [{ urls: 'stun:stun.l.google.com:19302' }];
}

function getUserPickerInitial(user: UserOption): string {
  const source = (user.label || user.username || user.email || '?').trim();
  return source.charAt(0).toUpperCase() || '?';
}

function getNameInitial(value: string | null | undefined): string {
  const source = (value ?? '').trim();
  return source.charAt(0).toUpperCase() || '?';
}

function formatRelative(value: string) {
  const deltaMs = Date.now() - new Date(value).getTime();
  const minutes = Math.max(1, Math.floor(deltaMs / (1000 * 60)));
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return `${days}d`;
  }
  return new Date(value).toLocaleDateString();
}

function formatStamp(value: string) {
  return new Date(value).toLocaleString();
}

function formatDayLabel(value: string) {
  const now = new Date();
  const date = new Date(value);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const diffDays = Math.round((today - start) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'long' });
  }
  return date.toLocaleDateString([], { day: '2-digit', month: 'short', year: 'numeric' });
}

function tickForState(state: MessageItem['state']) {
  if (state === 'PLAYED') {
    return '✓✓';
  }
  if (state === 'SEEN') {
    return '✓✓';
  }
  if (state === 'DELIVERED') {
    return '✓✓';
  }
  return '✓';
}


function IconPhone() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M6.6 10.8a15.2 15.2 0 0 0 6.6 6.6l2.2-2.2a1.4 1.4 0 0 1 1.4-.3 10.6 10.6 0 0 0 3.4.5 1.3 1.3 0 0 1 1.3 1.3v3.5a1.3 1.3 0 0 1-1.3 1.3A18.7 18.7 0 0 1 2.5 3.8 1.3 1.3 0 0 1 3.8 2.5h3.5a1.3 1.3 0 0 1 1.3 1.3 10.6 10.6 0 0 0 .5 3.4 1.4 1.4 0 0 1-.3 1.4z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconVideo() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M3 7.5A2.5 2.5 0 0 1 5.5 5h8A2.5 2.5 0 0 1 16 7.5v1.2l3.8-2.4A1.5 1.5 0 0 1 22 7.6v8.8a1.5 1.5 0 0 1-2.2 1.3L16 15.3v1.2a2.5 2.5 0 0 1-2.5 2.5h-8A2.5 2.5 0 0 1 3 16.5z"
        fill="currentColor"
      />
    </svg>
  );
}

function IconMic() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M12 15.5A3.5 3.5 0 0 0 15.5 12V7A3.5 3.5 0 0 0 8.5 7v5a3.5 3.5 0 0 0 3.5 3.5m-6-3A1 1 0 0 1 7 13a5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.9V22h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.1A7 7 0 0 1 5 13a1 1 0 0 1 1-1"
        transform="translate(0 -2)"
        fill="currentColor"
      />
    </svg>
  );
}

function IconMicOff() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path
        d="M12 15.5A3.5 3.5 0 0 0 15.5 12V7A3.5 3.5 0 0 0 8.5 7v5a3.5 3.5 0 0 0 3.5 3.5m-6-3A1 1 0 0 1 7 13a5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.9V22h2a1 1 0 1 1 0 2H9a1 1 0 1 1 0-2h2v-2.1A7 7 0 0 1 5 13a1 1 0 0 1 1-1"
        transform="translate(0 -2)"
        fill="currentColor"
      />
    </svg>
  );
}

function IconPause() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}

function IconPlay() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M8 5.5v13l10-6.5z" fill="currentColor" />
    </svg>
  );
}

function IconEndCall() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M5 16.5l2-3a12 12 0 0 1 10 0l2 3-2 2a2 2 0 0 1-2.2.4l-2.6-1a1 1 0 0 0-.8 0l-2.6 1A2 2 0 0 1 7 18.5z" fill="currentColor" />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M11 5h2v14h-2zM5 11h14v2H5z" fill="currentColor" />
    </svg>
  );
}

function IconSend() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M3 11.5 20.5 4a1 1 0 0 1 1.3 1.3L14.5 22.8a1 1 0 0 1-1.9-.1l-1.7-7-7-1.7A1 1 0 0 1 3 11.5" fill="currentColor" />
    </svg>
  );
}

export default function DiscussionsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedParam = (searchParams.get('conversation') ?? '').trim();

  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [conversationsQuery, setConversationsQuery] = useState('');
  const [selectedId, setSelectedId] = useState(selectedParam);
  const [profile, setProfile] = useState<ConversationProfile | null>(null);
  const [messages, setMessages] = useState<MessageItem[]>([]);
  const [messageDraft, setMessageDraft] = useState('');
  const [attachmentQueue, setAttachmentQueue] = useState<AttachmentItem[]>([]);
  const [usersQuery, setUsersQuery] = useState('');
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [isDirectModalOpen, setIsDirectModalOpen] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isProfilePopupOpen, setIsProfilePopupOpen] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [loadingConversations, setLoadingConversations] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [creatingConversation, setCreatingConversation] = useState(false);
  const [sendingMessage, setSendingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);
  const [incomingCall, setIncomingCall] = useState<ChatCall | null>(null);
  const [callPanel, setCallPanel] = useState<CallPanelState | null>(null);
  const [callMuted, setCallMuted] = useState(false);
  const [callCameraOff, setCallCameraOff] = useState(false);
  const [callOnHold, setCallOnHold] = useState(false);
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedVideoDeviceId, setSelectedVideoDeviceId] = useState('');
  const [messageInfo, setMessageInfo] = useState<MessageItem | null>(null);
  const [profileDraftName, setProfileDraftName] = useState('');
  const [profileDraftDescription, setProfileDraftDescription] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);
  const [memberActionId, setMemberActionId] = useState<string | null>(null);
  const [messagesCursor, setMessagesCursor] = useState<string | null>(null);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [mediaItems, setMediaItems] = useState<ConversationMediaItem[]>([]);
  const [mediaOffset, setMediaOffset] = useState<number | null>(null);
  const [hasMoreMedia, setHasMoreMedia] = useState(false);
  const [loadingMoreMedia, setLoadingMoreMedia] = useState(false);
  const [currentCall, setCurrentCall] = useState<ChatCall | null>(null);
  const selectedIdRef = useRef(selectedId);
  const conversationRequestRef = useRef(0);
  const viewerId = useMemo(() => parseViewerIdFromToken(), []);
  const callCursorRef = useRef(0);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const callTargetRef = useRef<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const canLoadOlderRef = useRef(false);
  const toneTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callRingingSinceRef = useRef<number | null>(null);

  const profilePopupRef = useRef<HTMLDivElement | null>(null);
  const hasToken = Boolean(getToken());
  const hasAnyCall = Boolean(callPanel || incomingCall || currentCall);
  const overlayRoot =
    typeof document !== 'undefined'
      ? (document.getElementById('portal-overlay-root') ?? document.body)
      : null;

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const syncConversationInUrl = useCallback(
    (conversationId: string) => {
      const next = new URLSearchParams(searchParams.toString());
      if (conversationId) {
        next.set('conversation', conversationId);
      } else {
        next.delete('conversation');
      }
      router.replace(`/discussions?${next.toString()}`);
    },
    [router, searchParams],
  );

  const loadConversations = useCallback(async () => {
    if (!hasToken) {
      setAuthRequired(true);
      setLoadingConversations(false);
      setConversations([]);
      setSelectedId('');
      return;
    }

    setLoadingConversations(true);
    setAuthRequired(false);
    try {
      const params = new URLSearchParams();
      if (conversationsQuery.trim()) {
        params.set('q', conversationsQuery.trim());
      }
      const data = await apiFetch<{ conversations: ConversationItem[] }>(
        `/discussions/chat/conversations${params.toString() ? `?${params.toString()}` : ''}`,
        { suppressAuthRedirect: true, cacheTtlMs: false },
      );
      setConversations(data.conversations);
      const pick = selectedIdRef.current && data.conversations.some((item) => item.id === selectedIdRef.current)
          ? selectedIdRef.current
          : data.conversations[0]?.id ?? '';
      setSelectedId(pick);
      syncConversationInUrl(pick);
    } catch (caught) {
      if (caught instanceof ApiRequestError && caught.status === 401) {
        setAuthRequired(true);
      }
      setError(caught instanceof Error ? caught.message : 'Unable to load conversations.');
    } finally {
      setLoadingConversations(false);
    }
  }, [conversationsQuery, hasToken, syncConversationInUrl]);

  const loadUsers = useCallback(async (query: string) => {
    if (!hasToken || query.trim().length < 2) {
      setUserOptions([]);
      return;
    }
    try {
      const params = new URLSearchParams();
      params.set('q', query.trim());
      const data = await apiFetch<{ users: UserOption[] }>(
        `/discussions/chat/users/search?${params.toString()}`,
        { suppressAuthRedirect: true },
      );
      setUserOptions(data.users);
    } catch {
      setUserOptions([]);
    }
  }, [hasToken]);

  const loadConversationData = useCallback(async (conversationId: string, options?: { silent?: boolean }) => {
    if (!conversationId || !hasToken) {
      setMessages([]);
      setProfile(null);
      setMediaItems([]);
      setMediaOffset(null);
      setHasMoreMedia(false);
      return;
    }

    if (!options?.silent) {
      setLoadingMessages(true);
    }
    try {
      const requestId = ++conversationRequestRef.current;
      const [profileData, messagesData, mediaData] = await Promise.all([
        apiFetch<{ profile: ConversationProfile }>(`/discussions/chat/conversations/${conversationId}/profile`, {
          suppressAuthRedirect: true,
          cacheTtlMs: false,
        }),
        apiFetch<ConversationMessagesEnvelope>(`/discussions/chat/conversations/${conversationId}/messages?limit=50`, {
          suppressAuthRedirect: true,
          cacheTtlMs: false,
        }),
        apiFetch<ConversationMediaEnvelope>(`/discussions/chat/conversations/${conversationId}/media?limit=12&offset=0`, {
          suppressAuthRedirect: true,
          cacheTtlMs: false,
        }),
      ]);
      if (requestId !== conversationRequestRef.current || selectedIdRef.current !== conversationId) {
        return;
      }
      setProfile(profileData.profile);
      setMessages(messagesData.messages);
      setMessagesCursor(messagesData.nextCursor);
      setHasMoreMessages(Boolean(messagesData.nextCursor));
      setMediaItems(mediaData.items);
      setMediaOffset(mediaData.nextOffset);
      setHasMoreMedia(mediaData.hasMore);
      canLoadOlderRef.current = false;
      const last = messagesData.messages[messagesData.messages.length - 1];
      if (last) {
        void apiFetch(`/discussions/chat/conversations/${conversationId}/read`, {
          method: 'POST',
          suppressAuthRedirect: true,
          body: JSON.stringify({ messageId: last.id }),
        }).catch(() => null);
      }
    } catch (caught) {
      if (!options?.silent) {
        setError(caught instanceof Error ? caught.message : 'Unable to load messages.');
        setMessages([]);
        setProfile(null);
      }
    } finally {
      if (!options?.silent) {
        setLoadingMessages(false);
      }
      setTimeout(() => {
        const node = threadRef.current;
        if (node) {
          node.scrollTop = node.scrollHeight;
        }
        canLoadOlderRef.current = true;
      }, 0);
    }
  }, [hasToken]);

  const refreshMessagesSilent = useCallback(async (conversationId: string) => {
    if (!conversationId || !hasToken) {
      return;
    }
    try {
      const requestId = ++conversationRequestRef.current;
      const data = await apiFetch<ConversationMessagesEnvelope>(
        `/discussions/chat/conversations/${conversationId}/messages?limit=50`,
        { suppressAuthRedirect: true, cacheTtlMs: false },
      );
      if (requestId !== conversationRequestRef.current || selectedIdRef.current !== conversationId) {
        return;
      }
      let newestId: string | null = null;
      setMessages((current) => {
        const ids = new Set(current.map((item) => item.id));
        const next = [...current];
        for (const message of data.messages) {
          if (!ids.has(message.id)) {
            next.push(message);
            newestId = message.id;
          }
        }
        next.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
        return next;
      });
      if (newestId) {
        void apiFetch(`/discussions/chat/conversations/${conversationId}/read`, {
          method: 'POST',
          suppressAuthRedirect: true,
          body: JSON.stringify({ messageId: newestId }),
        }).catch(() => null);
      }
    } catch {
      // silent polling ignores transient errors
    }
  }, [hasToken]);

  const loadOlderMessages = useCallback(async () => {
    if (!selectedId || !hasMoreMessages || !messagesCursor || loadingOlderMessages) {
      return;
    }
    const previousScrollHeight = threadRef.current?.scrollHeight ?? 0;
    const previousScrollTop = threadRef.current?.scrollTop ?? 0;
    setLoadingOlderMessages(true);
    try {
      const data = await apiFetch<ConversationMessagesEnvelope>(
        `/discussions/chat/conversations/${selectedId}/messages?limit=50&cursor=${encodeURIComponent(messagesCursor)}`,
        { suppressAuthRedirect: true, cacheTtlMs: false },
      );
      setMessages((current) => {
        const ids = new Set(current.map((item) => item.id));
        const merged = [...data.messages.filter((item) => !ids.has(item.id)), ...current];
        merged.sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
        return merged;
      });
      setMessagesCursor(data.nextCursor);
      setHasMoreMessages(Boolean(data.nextCursor));
      requestAnimationFrame(() => {
        const node = threadRef.current;
        if (!node) {
          return;
        }
        const nextScrollHeight = node.scrollHeight;
        node.scrollTop = Math.max(0, nextScrollHeight - previousScrollHeight + previousScrollTop);
      });
    } catch {
      // ignore transient
    } finally {
      setLoadingOlderMessages(false);
    }
  }, [hasMoreMessages, loadingOlderMessages, messagesCursor, selectedId]);

  const loadMoreMedia = useCallback(async () => {
    if (!selectedId || !hasMoreMedia || mediaOffset === null || loadingMoreMedia) {
      return;
    }
    setLoadingMoreMedia(true);
    try {
      const data = await apiFetch<ConversationMediaEnvelope>(
        `/discussions/chat/conversations/${selectedId}/media?limit=12&offset=${mediaOffset}`,
        { suppressAuthRedirect: true, cacheTtlMs: false },
      );
      setMediaItems((current) => {
        const ids = new Set(current.map((item) => item.id));
        return [...current, ...data.items.filter((item) => !ids.has(item.id))];
      });
      setMediaOffset(data.nextOffset);
      setHasMoreMedia(data.hasMore);
    } catch {
      // ignore transient
    } finally {
      setLoadingMoreMedia(false);
    }
  }, [hasMoreMedia, loadingMoreMedia, mediaOffset, selectedId]);

  useEffect(() => {
    if (!selectedId || !hasToken) {
      return;
    }
    const interval = setInterval(() => {
      void refreshMessagesSilent(selectedId);
    }, 2500);
    return () => clearInterval(interval);
  }, [hasToken, refreshMessagesSilent, selectedId]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    void loadConversationData(selectedId);
  }, [loadConversationData, selectedId]);

  useEffect(() => {
    const timeout = setTimeout(() => {
      void loadUsers(usersQuery);
    }, 220);
    return () => clearTimeout(timeout);
  }, [loadUsers, usersQuery]);

  useEffect(() => {
    if (!isProfilePopupOpen || loadingMoreMedia) {
      return;
    }
    if (!mediaItems.length && hasMoreMedia && mediaOffset !== null) {
      void loadMoreMedia();
    }
  }, [hasMoreMedia, isProfilePopupOpen, loadMoreMedia, loadingMoreMedia, mediaItems.length, mediaOffset]);

  useEffect(() => {
    setProfileDraftName(profile?.title ?? '');
    setProfileDraftDescription(profile?.description ?? '');
  }, [profile?.id, profile?.title, profile?.description]);

  const canEditGroup = useMemo(
    () => Boolean(profile && profile.kind === 'GROUP' && profile.members.some((member) => member.id === viewerId && member.role === 'ADMIN')),
    [profile, viewerId],
  );

  const directPeer = useMemo(() => {
    if (!profile || profile.kind !== 'DIRECT') {
      return null;
    }
    return profile.members.find((member) => member.id !== viewerId) ?? profile.members[0] ?? null;
  }, [profile, viewerId]);

  const sharedMedia = useMemo(
    () => mediaItems.filter((item) => item.kind === 'IMAGE' || item.kind === 'VIDEO'),
    [mediaItems],
  );

  const sharedFiles = useMemo(
    () => mediaItems.filter((item) => item.kind === 'FILE' || item.kind === 'AUDIO'),
    [mediaItems],
  );

  const saveGroupProfile = useCallback(async () => {
    if (!selectedId || !canEditGroup || !profile) {
      return;
    }
    setSavingProfile(true);
    try {
      await apiFetch(`/discussions/chat/conversations/${selectedId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: profileDraftName.trim() || undefined,
          description: profileDraftDescription.trim() || undefined,
        }),
      });
      await loadConversationData(selectedId, { silent: true });
      await loadConversations();
      setStatusMessage('Group profile updated.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update group profile.');
    } finally {
      setSavingProfile(false);
    }
  }, [canEditGroup, loadConversationData, loadConversations, profile, profileDraftDescription, profileDraftName, selectedId]);

  const updateMemberRole = useCallback(async (userId: string, role: 'ADMIN' | 'MEMBER') => {
    if (!selectedId || !canEditGroup) {
      return;
    }
    setMemberActionId(userId);
    try {
      await apiFetch(`/discussions/chat/conversations/${selectedId}/members`, {
        method: 'POST',
        body: JSON.stringify({ userId, role }),
      });
      await loadConversationData(selectedId, { silent: true });
      await loadConversations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to update member role.');
    } finally {
      setMemberActionId(null);
    }
  }, [canEditGroup, loadConversationData, loadConversations, selectedId]);

  const removeMemberFromGroup = useCallback(async (userId: string) => {
    if (!selectedId || !canEditGroup) {
      return;
    }
    setMemberActionId(userId);
    try {
      await apiFetch(`/discussions/chat/conversations/${selectedId}/members/${userId}`, {
        method: 'DELETE',
      });
      await loadConversationData(selectedId, { silent: true });
      await loadConversations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to remove member.');
    } finally {
      setMemberActionId(null);
    }
  }, [canEditGroup, loadConversationData, loadConversations, selectedId]);

  const selectConversation = (conversationId: string) => {
    conversationRequestRef.current += 1;
    shouldStickToBottomRef.current = true;
    canLoadOlderRef.current = false;
    setIncomingCall(null);
    setSelectedId(conversationId);
    syncConversationInUrl(conversationId);
  };

  const toggleUser = (userId: string, label: string) => {
    setSelectedUserIds((current) => {
      const exists = current.includes(userId);
      if (exists) {
        setStatusMessage(`${label} removed.`);
        return current.filter((id) => id !== userId);
      }
      setStatusMessage(`${label} added.`);
      return [...current, userId];
    });
  };

  const startDirect = async () => {
    if (!selectedUserIds[0]) {
      return;
    }
    setCreatingConversation(true);
    try {
      const data = await apiFetch<{ conversationId: string }>('/discussions/chat/conversations/direct', {
        method: 'POST',
        body: JSON.stringify({ userId: selectedUserIds[0] }),
      });
      setIsDirectModalOpen(false);
      setSelectedUserIds([]);
      setUsersQuery('');
      await loadConversations();
      selectConversation(data.conversationId);
      setStatusMessage('Direct conversation is ready.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to start direct chat.');
    } finally {
      setCreatingConversation(false);
    }
  };

  const createGroup = async () => {
    if (!groupName.trim()) {
      return;
    }
    setCreatingConversation(true);
    try {
      const data = await apiFetch<{ conversationId: string }>('/discussions/chat/conversations/group', {
        method: 'POST',
        body: JSON.stringify({
          name: groupName.trim(),
          description: groupDescription.trim() || undefined,
          memberIds: selectedUserIds,
        }),
      });
      setIsGroupModalOpen(false);
      setSelectedUserIds([]);
      setGroupName('');
      setGroupDescription('');
      setUsersQuery('');
      await loadConversations();
      selectConversation(data.conversationId);
      setStatusMessage('Group conversation created.');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to create group chat.');
    } finally {
      setCreatingConversation(false);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachmentQueue((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const sendMessage = async () => {
    if (!selectedId || sendingMessage) {
      return;
    }
    const text = messageDraft.trim();
    if (!text && !attachmentQueue.length) {
      return;
    }

    setSendingMessage(true);
    try {
      const mentionHandles = Array.from(
        new Set(
          Array.from(text.matchAll(/(?:^|\s)@([a-z0-9_.-]{2,39})/gi)).map((match) => (match[1] ?? '').toLowerCase()).filter(Boolean),
        ),
      );
      const data = await apiFetch<{ message: MessageItem }>(`/discussions/chat/conversations/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          body: text || undefined,
          mentions: mentionHandles,
          attachments: attachmentQueue.map((attachment) => ({
            kind: attachment.kind,
            url: attachment.url,
            fileName: attachment.fileName || undefined,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          })),
        }),
      });
      setMessages((current) => [...current, data.message]);
      setMessageDraft('');
      setAttachmentQueue([]);
      void loadConversations();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to send message.');
    } finally {
      setSendingMessage(false);
    }
  };

  const uploadAttachment = async (file: File) => {
    if (uploadingAttachment) {
      return;
    }
    setUploadingAttachment(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const uploaded = await apiFetch<{ url: string; name: string }>(
        '/uploads/attachments',
        { method: 'POST', body: form },
      );
      setAttachmentQueue((current) => [
        ...current,
        {
          kind: file.type.startsWith('image/') ? 'IMAGE' : file.type.startsWith('video/') ? 'VIDEO' : file.type.startsWith('audio/') ? 'AUDIO' : 'FILE',
          url: uploaded.url,
          fileName: uploaded.name || file.name,
        },
      ]);
      setStatusMessage(`Attachment uploaded: ${file.name}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to upload attachment.');
    } finally {
      setUploadingAttachment(false);
    }
  };

  const downloadAttachment = async (attachmentId: string, fileName: string | null) => {
    try {
      const token = getToken();
      if (!token) {
        setError('Authentication required.');
        return;
      }
      const response = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000'}/discussions/chat/attachments/${attachmentId}`,
        {
          headers: {
            authorization: `Bearer ${token}`,
          },
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ message: `Request failed: ${response.status}` }));
        throw new Error((payload as { message?: string }).message ?? 'Unable to download attachment.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = fileName || 'attachment';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to download attachment.');
    }
  };

  const timelineItems = useMemo(() => {
    const items: Array<{ kind: 'day'; label: string } | { kind: 'message'; message: MessageItem }> = [];
    let currentDay = '';
    for (const message of messages) {
      const label = formatDayLabel(message.createdAt);
      if (label !== currentDay) {
        items.push({ kind: 'day', label });
        currentDay = label;
      }
      items.push({ kind: 'message', message });
    }
    return items;
  }, [messages]);

  const teardownCallMedia = useCallback(() => {
    if (peerConnectionRef.current) {
      peerConnectionRef.current.onicecandidate = null;
      peerConnectionRef.current.ontrack = null;
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (localStreamRef.current) {
      for (const track of localStreamRef.current.getTracks()) {
        track.stop();
      }
      localStreamRef.current = null;
    }
    if (remoteStreamRef.current) {
      for (const track of remoteStreamRef.current.getTracks()) {
        track.stop();
      }
      remoteStreamRef.current = null;
    }
    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
    }
    callCursorRef.current = 0;
    callTargetRef.current = null;
    setCallMuted(false);
    setCallCameraOff(false);
    setCallOnHold(false);
  }, []);

  const sendCallSignal = useCallback(
    async (
      callId: string,
      body: {
        type: 'offer' | 'answer' | 'ice' | 'hold' | 'resume';
        targetUserId?: string;
        sdp?: string;
        candidate?: RTCIceCandidateInit;
        hold?: boolean;
      },
    ) => {
      await apiFetch(`/discussions/chat/calls/${callId}/signal`, {
        method: 'POST',
        body: JSON.stringify(body),
      });
    },
    [],
  );

  const setupPeerConnection = useCallback(
    async (input: { callId: string; mode: 'AUDIO' | 'VIDEO'; targetUserId: string | null }) => {
      const mode = input.mode;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video:
          mode === 'VIDEO'
            ? (selectedVideoDeviceId
              ? { deviceId: { exact: selectedVideoDeviceId } }
              : true)
            : false,
      });
      localStreamRef.current = stream;
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        void localVideoRef.current.play().catch(() => null);
      }

      const remoteStream = new MediaStream();
      remoteStreamRef.current = remoteStream;
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
        void remoteVideoRef.current.play().catch(() => null);
      }
      if (remoteAudioRef.current) {
        remoteAudioRef.current.srcObject = remoteStream;
        remoteAudioRef.current.muted = false;
      }

      const peer = new RTCPeerConnection({ iceServers: resolveIceServers() });
      peerConnectionRef.current = peer;
      callTargetRef.current = input.targetUserId;

      for (const track of stream.getTracks()) {
        peer.addTrack(track, stream);
      }

      peer.ontrack = (event) => {
        const inboundStream = event.streams[0];
        if (inboundStream) {
          for (const track of inboundStream.getTracks()) {
            remoteStream.addTrack(track);
          }
        } else {
          remoteStream.addTrack(event.track);
        }
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          void remoteVideoRef.current.play().catch(() => null);
        }
        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          void remoteAudioRef.current.play().catch(() => null);
        }
      };

      peer.onicecandidate = (event) => {
        if (!event.candidate) {
          return;
        }
        void sendCallSignal(input.callId, {
          type: 'ice',
          targetUserId: callTargetRef.current ?? undefined,
          candidate: event.candidate.toJSON(),
        }).catch(() => null);
      };

      return peer;
    },
    [selectedVideoDeviceId, sendCallSignal],
  );

  const syncCallMediaState = useCallback(() => {
    const stream = localStreamRef.current;
    const peer = peerConnectionRef.current;
    if (!stream || !peer) {
      return;
    }
    const isVideoCall = callPanel?.mode === 'VIDEO';
    const enableAudio = !callMuted && !callOnHold;
    const enableVideo = isVideoCall && !callOnHold && !callCameraOff;

    for (const track of stream.getAudioTracks()) {
      track.enabled = enableAudio;
    }
    for (const track of stream.getVideoTracks()) {
      track.enabled = enableVideo;
    }

    for (const sender of peer.getSenders()) {
      const track = sender.track;
      if (!track) {
        continue;
      }
      if (track.kind === 'audio') {
        track.enabled = enableAudio;
      } else if (track.kind === 'video') {
        track.enabled = enableVideo;
      }
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.muted = callOnHold;
    }
  }, [callCameraOff, callMuted, callOnHold, callPanel?.mode]);

  const refreshVideoDevices = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videos = devices.filter((device) => device.kind === 'videoinput');
      setVideoDevices(videos);
      if (videos.length && !videos.some((device) => device.deviceId === selectedVideoDeviceId)) {
        setSelectedVideoDeviceId(videos[0]?.deviceId ?? '');
      }
    } catch {
      setVideoDevices([]);
    }
  }, [selectedVideoDeviceId]);

  const switchVideoInput = useCallback(
    async (deviceId: string) => {
      const stream = localStreamRef.current;
      const peer = peerConnectionRef.current;
      if (!stream || !peer || !callPanel || callPanel.mode !== 'VIDEO') {
        return;
      }

      const videoCapture = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: { exact: deviceId } },
      });
      const newTrack = videoCapture.getVideoTracks()[0];
      if (!newTrack) {
        return;
      }

      const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
      for (const track of stream.getVideoTracks()) {
        track.stop();
        stream.removeTrack(track);
      }
      stream.addTrack(newTrack);
      if (sender) {
        await sender.replaceTrack(newTrack);
      } else {
        peer.addTrack(newTrack, stream);
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      setSelectedVideoDeviceId(deviceId);
      setCallCameraOff(false);
    },
    [callPanel],
  );

  const endCall = useCallback(
    async (reason?: string) => {
      const active = callPanel;
      teardownCallMedia();
      callRingingSinceRef.current = null;
      if (active) {
        setCallPanel((current) => (current ? { ...current, status: 'ended' } : null));
        setTimeout(() => {
          setCallPanel((current) => (current?.status === 'ended' ? null : current));
        }, 1200);
        try {
          await apiFetch(`/discussions/chat/calls/${active.callId}/end`, {
            method: 'POST',
            body: JSON.stringify(reason ? { reason } : {}),
          });
        } catch {
          // ignore teardown errors
        }
      }
      setIncomingCall(null);
    },
    [callPanel, teardownCallMedia],
  );

  const startCall = async (mode: 'AUDIO' | 'VIDEO') => {
    if (!selectedId || !profile || !viewerId || hasAnyCall) {
      return;
    }
    let createdCallId: string | null = null;
    try {
      const data = await apiFetch<{ call: { id: string; participantIds: string[] } }>(
        `/discussions/chat/conversations/${selectedId}/calls`,
        {
          method: 'POST',
          body: JSON.stringify({ mode }),
        },
      );
      createdCallId = data.call.id;
      const remoteUserId = data.call.participantIds.find((id) => id !== viewerId) ?? null;
      const peer = await setupPeerConnection({
        callId: data.call.id,
        mode,
        targetUserId: remoteUserId,
      });
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await sendCallSignal(data.call.id, {
        type: 'offer',
        targetUserId: remoteUserId ?? undefined,
        sdp: offer.sdp ?? '',
      });
      setCallPanel({
        callId: data.call.id,
        mode,
        status: 'ringing',
        incoming: false,
        remoteUserId,
      });
      callRingingSinceRef.current = Date.now();
    } catch (caught) {
      teardownCallMedia();
      if (createdCallId) {
        void apiFetch(`/discussions/chat/calls/${createdCallId}/end`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'setup-failed' }),
        }).catch(() => null);
      }
      setError(caught instanceof Error ? caught.message : 'Unable to start call.');
    }
  };

  const acceptIncomingCall = useCallback(
    async (call: ChatCall) => {
      if (!viewerId) {
        return;
      }
      try {
        if (call.conversationId && call.conversationId !== selectedIdRef.current) {
          shouldStickToBottomRef.current = true;
          setSelectedId(call.conversationId);
          syncConversationInUrl(call.conversationId);
          await loadConversationData(call.conversationId, { silent: true });
        }
        const profileData = await apiFetch<{ profile: ConversationProfile }>(
          `/discussions/chat/conversations/${call.conversationId ?? selectedIdRef.current}/profile`,
          { suppressAuthRedirect: true, cacheTtlMs: false },
        ).catch(() => null);
        const remoteUserId = profileData?.profile.members.find((member) => member.id !== viewerId)?.id
          ?? profile?.members.find((member) => member.id !== viewerId)?.id
          ?? null;
        await apiFetch(`/discussions/chat/calls/${call.id}/accept`, { method: 'POST' });
        await setupPeerConnection({
          callId: call.id,
          mode: call.mode,
          targetUserId: remoteUserId,
        });
        setCallPanel({
          callId: call.id,
          mode: call.mode,
          status: 'connecting',
          incoming: true,
          remoteUserId,
        });
        callRingingSinceRef.current = null;
        setIncomingCall(null);
      } catch (caught) {
        teardownCallMedia();
        void apiFetch(`/discussions/chat/calls/${call.id}/end`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'accept-failed' }),
        }).catch(() => null);
        setError(caught instanceof Error ? caught.message : 'Unable to accept call.');
      }
    },
    [loadConversationData, profile, setupPeerConnection, syncConversationInUrl, teardownCallMedia, viewerId],
  );

  const rejectIncomingCall = useCallback(
    async (call: ChatCall) => {
      try {
        await apiFetch(`/discussions/chat/calls/${call.id}/end`, {
          method: 'POST',
          body: JSON.stringify({ reason: 'declined' }),
        });
      } catch {
        // ignore
      }
      setIncomingCall(null);
    },
    [],
  );

  useEffect(() => {
    return () => {
      teardownCallMedia();
    };
  }, [teardownCallMedia]);

  useEffect(() => {
    if (!hasToken || callPanel) {
      return;
    }
    const interval = setInterval(() => {
      void apiFetch<ActiveCallEnvelope>('/discussions/chat/calls/incoming', {
        suppressAuthRedirect: true,
        cacheTtlMs: false,
      })
        .then((data) => {
          if (data.call && data.call.state === 'RINGING') {
            setIncomingCall(data.call);
          } else {
            setIncomingCall(null);
          }
        })
        .catch(() => null);
    }, 1200);
    return () => clearInterval(interval);
  }, [callPanel, hasToken]);

  useEffect(() => {
    if (!hasToken) {
      return;
    }
    const interval = setInterval(() => {
      void apiFetch<ActiveCallEnvelope>('/discussions/chat/calls/current', {
        suppressAuthRedirect: true,
        cacheTtlMs: false,
      })
        .then((data) => {
          setCurrentCall(data.call);
        })
        .catch(() => null);
    }, 1500);
    return () => clearInterval(interval);
  }, [hasToken]);

  useEffect(() => {
    if (!callPanel || callPanel.mode !== 'VIDEO') {
      return;
    }
    void refreshVideoDevices();
  }, [callPanel, refreshVideoDevices]);

  useEffect(() => {
    if (!callPanel) {
      return;
    }
    const localStream = localStreamRef.current;
    const remoteStream = remoteStreamRef.current;
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
      void localVideoRef.current.play().catch(() => null);
    }
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
      void remoteVideoRef.current.play().catch(() => null);
    }
    if (remoteAudioRef.current && remoteStream) {
      remoteAudioRef.current.srcObject = remoteStream;
      remoteAudioRef.current.muted = callOnHold;
      void remoteAudioRef.current.play().catch(() => null);
    }
  }, [callOnHold, callPanel]);

  useEffect(() => {
    syncCallMediaState();
  }, [syncCallMediaState]);

  useEffect(() => {
    if (!callPanel || !['ringing', 'connecting', 'active'].includes(callPanel.status)) {
      return;
    }
    const interval = setInterval(() => {
      void apiFetch(`/discussions/chat/calls/${callPanel.callId}/heartbeat`, {
        method: 'POST',
        suppressAuthRedirect: true,
      }).catch(() => null);
    }, 10_000);
    return () => clearInterval(interval);
  }, [callPanel]);

  useEffect(() => {
    if (!callPanel) {
      return;
    }
    const interval = setInterval(() => {
      void apiFetch<CallEventsEnvelope>(
        `/discussions/chat/calls/${callPanel.callId}/events?cursor=${callCursorRef.current}`,
        {
          suppressAuthRedirect: true,
          cacheTtlMs: false,
        },
      )
        .then(async (data) => {
          callCursorRef.current = data.cursor;
          for (const event of data.events) {
            if (event.type === 'ended' || event.type === 'declined') {
              teardownCallMedia();
              callRingingSinceRef.current = null;
              setCallPanel((current) => (current ? { ...current, status: 'ended' } : null));
              setTimeout(() => {
                setCallPanel((current) => (current?.status === 'ended' ? null : current));
              }, 1200);
              continue;
            }
            if (event.type === 'accepted') {
              callRingingSinceRef.current = null;
              setCallPanel((current) => (current ? { ...current, status: 'active' } : null));
              continue;
            }
            if (event.type === 'offer') {
              const peer = peerConnectionRef.current;
              if (!peer || !event.payload.sdp) {
                continue;
              }
              await peer.setRemoteDescription({ type: 'offer', sdp: event.payload.sdp });
              const answer = await peer.createAnswer();
              await peer.setLocalDescription(answer);
              await sendCallSignal(callPanel.callId, {
                type: 'answer',
                targetUserId: event.fromUserId,
                sdp: answer.sdp ?? '',
              });
              callRingingSinceRef.current = null;
              setCallPanel((current) => (current ? { ...current, status: 'active' } : null));
              continue;
            }
            if (event.type === 'answer') {
              const peer = peerConnectionRef.current;
              if (!peer || !event.payload.sdp) {
                continue;
              }
              await peer.setRemoteDescription({ type: 'answer', sdp: event.payload.sdp });
              callRingingSinceRef.current = null;
              setCallPanel((current) => (current ? { ...current, status: 'active' } : null));
              continue;
            }
            if (event.type === 'ice') {
              const peer = peerConnectionRef.current;
              if (!peer || !event.payload.candidate) {
                continue;
              }
              try {
                await peer.addIceCandidate(event.payload.candidate);
              } catch {
                // best effort
              }
              continue;
            }
            if (event.type === 'hold') {
              setCallOnHold(true);
              continue;
            }
            if (event.type === 'resume') {
              setCallOnHold(false);
            }
          }
        })
        .catch(() => null);
    }, 700);
    return () => clearInterval(interval);
  }, [callPanel, sendCallSignal, teardownCallMedia]);

  useEffect(() => {
    if (!callPanel || callPanel.incoming || callPanel.status !== 'ringing') {
      return;
    }
    if (!callRingingSinceRef.current) {
      callRingingSinceRef.current = Date.now();
    }
    const interval = setInterval(() => {
      const startedAt = callRingingSinceRef.current;
      if (!startedAt) {
        return;
      }
      if (Date.now() - startedAt >= 40_000) {
        void endCall('timeout');
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [callPanel, endCall]);

  useEffect(() => {
    const node = threadRef.current;
    if (!node) {
      return;
    }
    if (shouldStickToBottomRef.current) {
      node.scrollTop = node.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    const shouldRingIncoming = Boolean(incomingCall && !callPanel);
    const shouldRingOutgoing = Boolean(callPanel && (callPanel.status === 'ringing' || callPanel.status === 'connecting'));
    const ringMode = shouldRingIncoming ? 'incoming' : shouldRingOutgoing ? 'outgoing' : null;

    if (!ringMode) {
      if (toneTimerRef.current) {
        clearInterval(toneTimerRef.current);
        toneTimerRef.current = null;
      }
      return;
    }

    if (toneTimerRef.current) {
      clearInterval(toneTimerRef.current);
      toneTimerRef.current = null;
    }

    const playTone = (frequency: number, durationMs: number) => {
      try {
        const context = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)();
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.value = frequency;
        gain.gain.value = 0.02;
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        setTimeout(() => {
          oscillator.stop();
          context.close().catch(() => null);
        }, durationMs);
      } catch {
        // best effort only
      }
    };

    if (ringMode === 'incoming') {
      playTone(660, 260);
      toneTimerRef.current = setInterval(() => playTone(660, 260), 1400);
    } else {
      playTone(520, 180);
      toneTimerRef.current = setInterval(() => playTone(520, 180), 1200);
    }

    return () => {
      if (toneTimerRef.current) {
        clearInterval(toneTimerRef.current);
        toneTimerRef.current = null;
      }
    };
  }, [callPanel, incomingCall]);

  const renderUserPicker = (mode: 'single' | 'multiple') => {
    const trimmedQuery = usersQuery.trim();
    const hasQuery = trimmedQuery.length >= 2;
    const resultLabel = hasQuery
      ? `${userOptions.length} ${userOptions.length === 1 ? 'match' : 'matches'}`
      : mode === 'single'
        ? 'Search to start a direct chat'
        : 'Search to add people';

    return (
      <div className="chat-user-search-panel">
        <label className="field">
          Search people
          <input
            value={usersQuery}
            onChange={(event) => setUsersQuery(event.target.value)}
            placeholder="Type a name, @username, or email"
          />
        </label>
        <div className="chat-user-results-meta">
          <span>{resultLabel}</span>
          {mode === 'multiple' && selectedUserIds.length ? (
            <span>{selectedUserIds.length} selected</span>
          ) : null}
        </div>
        {!hasQuery ? (
          <div className="chat-user-empty">
            <strong>Start typing to search people.</strong>
            <span>Results appear after 2 characters.</span>
          </div>
        ) : !userOptions.length ? (
          <div className="chat-user-empty">
            <strong>No people found.</strong>
            <span>Try a full name, username, or exact email.</span>
          </div>
        ) : (
          <ul className="chat-user-picker">
            {userOptions.map((user) => {
              const isSelected = selectedUserIds.includes(user.id);
              const avatarSrc = resolveMediaUrl(user.avatarUrl);
              const secondaryLine =
                user.username && user.email ? user.email : user.email ?? 'No public email';

              return (
                <li key={user.id}>
                  <label className={`chat-user-card ${isSelected ? 'selected' : ''}`.trim()}>
                    <span className="chat-user-control">
                      <input
                        type={mode === 'single' ? 'radio' : 'checkbox'}
                        name={mode === 'single' ? 'direct-user' : undefined}
                        checked={isSelected}
                        onChange={() =>
                          mode === 'single'
                            ? setSelectedUserIds([user.id])
                            : toggleUser(user.id, user.label)
                        }
                      />
                    </span>
                    <span className="chat-user-avatar" aria-hidden="true">
                      <span>{getUserPickerInitial(user)}</span>
                      {avatarSrc ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={avatarSrc}
                          alt={user.label}
                          onError={(event) => {
                            event.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : null}
                    </span>
                    <span className="chat-user-copy">
                      <strong>{user.label}</strong>
                      <span className="chat-user-handle">
                        {user.username ? `@${user.username}` : 'No username'}
                      </span>
                      <span className="chat-user-secondary">{secondaryLine}</span>
                    </span>
                    <span className="chat-user-status">
                      {isSelected ? 'Selected' : mode === 'single' ? 'Choose' : 'Add'}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  };

  return (
    <AppShell title="Discussions">
      {error ? <PortalToast message={error} tone="error" onClose={() => setError(null)} /> : null}
      {statusMessage ? <PortalToast message={statusMessage} tone="success" onClose={() => setStatusMessage(null)} /> : null}

      <PortalPage className="inbox-shell discussions-shell">
        <PortalToolbar
          title="Chat"
          subtitle="Fast messaging with direct chats, groups, delivery states, and call controls."
          actions={(
            <InlineFormRow align="start">
              <Button type="button" variant="secondary" size="sm" onClick={() => setIsSidebarCollapsed((value) => !value)}>
                {isSidebarCollapsed ? 'Show chats' : 'Hide chats'}
              </Button>
              <Button type="button" variant="secondary" size="sm" onClick={() => setIsDirectModalOpen(true)} disabled={!hasToken}>
                New direct
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={() => setIsGroupModalOpen(true)} disabled={!hasToken}>
                New group
              </Button>
            </InlineFormRow>
          )}
        />

        {authRequired ? (
          <Card className="portal-card stack">
            <p className="muted">Sign in to access chat.</p>
            <InlineFormRow align="start">
              <Button variant="primary" size="sm" href={`/login?from=${encodeURIComponent('/discussions')}`}>
                Sign in
              </Button>
            </InlineFormRow>
          </Card>
        ) : (
          <div className={`portal-split chat-layout ${isSidebarCollapsed ? 'chat-layout--collapsed' : ''}`}>
            {!isSidebarCollapsed ? (
              <Card className="portal-card chat-sidebar">
                <label className="field">
                  Search chats
                  <input
                    value={conversationsQuery}
                    onChange={(event) => setConversationsQuery(event.target.value)}
                    placeholder="Type to filter chats"
                  />
                </label>
                {loadingConversations ? (
                  <p className="muted">Loading chats...</p>
                ) : conversations.length ? (
                  <ul className="list chat-list">
                    {conversations.map((conversation) => (
                      <li key={conversation.id} className={`queue-item chat-list-item ${conversation.id === selectedId ? 'is-active' : ''}`}>
                        <button type="button" className="chat-list-button" onClick={() => selectConversation(conversation.id)}>
                          <span className="chat-list-avatar">
                            <span>{conversation.title.slice(0, 1).toUpperCase()}</span>
                            {resolveMediaUrl(conversation.avatarUrl) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={resolveMediaUrl(conversation.avatarUrl) ?? ''}
                                alt={conversation.title}
                                onError={(event) => {
                                  event.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : null}
                          </span>
                          <div className="chat-list-main">
                            <strong>{conversation.title}</strong>
                            <p className="muted">{conversation.lastMessagePreview || 'No messages yet'}</p>
                          </div>
                          <div className="chat-list-meta">
                            <span className="muted">{formatRelative(conversation.lastMessageAt)}</span>
                            {conversation.unreadCount > 0 ? <span className="chat-unread-pill">{conversation.unreadCount}</span> : null}
                          </div>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="No chats" description="Create a direct chat or group to begin." />
                )}
              </Card>
            ) : null}

            <Card className="portal-card chat-main">
              {selectedConversation ? (
                <>
                  <header className="chat-head">
                    <div className="chat-head-left">
                      <button
                        type="button"
                        className="chat-avatar-button"
                        onClick={() => setIsProfilePopupOpen((open) => !open)}
                        aria-label="Open profile popup"
                      >
                        {resolveMediaUrl(selectedConversation.avatarUrl) ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={resolveMediaUrl(selectedConversation.avatarUrl) ?? ''}
                            alt={selectedConversation.title}
                            onError={(event) => {
                              event.currentTarget.style.display = 'none';
                            }}
                          />
                        ) : (
                          (selectedConversation.title || '?').slice(0, 1).toUpperCase()
                        )}
                      </button>
                      <div>
                        <h3>{selectedConversation.title}</h3>
                        <p className="muted">
                          {profile
                            ? (profile.kind === 'GROUP' ? `${profile.members.length} members` : 'Direct message')
                            : 'Loading chat...'}
                        </p>
                      </div>
                    </div>
                    <div className="chat-head-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void startCall('AUDIO')}
                        disabled={hasAnyCall || !selectedConversation.canCall}
                      >
                        <IconPhone />
                      </Button>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => void startCall('VIDEO')}
                        disabled={hasAnyCall || !selectedConversation.canCall}
                      >
                        <IconVideo />
                      </Button>
                    </div>
                  </header>

                  <div
                    ref={threadRef}
                    className="chat-thread"
                    onScroll={(event) => {
                      const node = event.currentTarget;
                      const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight;
                      shouldStickToBottomRef.current = distanceFromBottom < 120;
                      if (canLoadOlderRef.current && node.scrollTop < 240) {
                        void loadOlderMessages();
                      }
                    }}
                  >
                    {loadingOlderMessages ? <p className="muted">Loading older messages...</p> : null}
                    {loadingMessages ? (
                      <p className="muted">Loading messages...</p>
                    ) : timelineItems.length ? (
                      timelineItems.map((item, index) => {
                        if (item.kind === 'day') {
                          return (
                            <div key={`day-${item.label}-${index}`} className="chat-day-separator">
                              <span>{item.label}</span>
                            </div>
                          );
                        }
                        const message = item.message;
                        return (
                          <article
                            key={message.id}
                            className={`chat-bubble ${message.self ? 'is-self' : ''} ${message.type === 'SYSTEM' ? 'is-system' : ''}`}
                            onClick={() => setMessageInfo(message)}
                          >
                            {message.type !== 'SYSTEM' && profile?.kind === 'GROUP' ? (
                              <div className="chat-bubble-head">
                                <button
                                  type="button"
                                  className="chat-bubble-avatar"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    setIsProfilePopupOpen(true);
                                  }}
                                  aria-label={`Open member profile for ${message.sender.label}`}
                                >
                                  {resolveMediaUrl(message.sender.avatarUrl) ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img src={resolveMediaUrl(message.sender.avatarUrl) ?? ''} alt={message.sender.label} />
                                  ) : (
                                    message.sender.label.slice(0, 1).toUpperCase()
                                  )}
                                </button>
                                <strong>{message.sender.label}</strong>
                              </div>
                            ) : null}
                            {message.body ? <p>{message.body}</p> : null}
                            {message.attachments.length ? (
                              <ul className="chat-attachments">
                                {message.attachments.map((attachment) => {
                                  const mediaUrl = resolveMediaUrl(attachment.url) ?? attachment.url;
                                  if (attachment.kind === 'IMAGE') {
                                    return (
                                      <li key={attachment.id}>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img className="chat-attachment-image" src={mediaUrl} alt={attachment.fileName ?? 'image'} />
                                        <button
                                          type="button"
                                          className="chat-attachment-download"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void downloadAttachment(attachment.id, attachment.fileName);
                                          }}
                                        >
                                          Download
                                        </button>
                                      </li>
                                    );
                                  }
                                  if (attachment.kind === 'VIDEO') {
                                    return (
                                      <li key={attachment.id}>
                                        <video className="chat-attachment-video" controls src={mediaUrl} />
                                        <button
                                          type="button"
                                          className="chat-attachment-download"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void downloadAttachment(attachment.id, attachment.fileName);
                                          }}
                                        >
                                          Download
                                        </button>
                                      </li>
                                    );
                                  }
                                  if (attachment.kind === 'AUDIO') {
                                    return (
                                      <li key={attachment.id}>
                                        <audio controls src={mediaUrl} />
                                        <button
                                          type="button"
                                          className="chat-attachment-download"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void downloadAttachment(attachment.id, attachment.fileName);
                                          }}
                                        >
                                          Download
                                        </button>
                                      </li>
                                    );
                                  }
                                  return (
                                    <li key={attachment.id}>
                                      <button
                                        type="button"
                                        className="chat-attachment-download"
                                        onClick={(event) => {
                                          event.stopPropagation();
                                          void downloadAttachment(attachment.id, attachment.fileName);
                                        }}
                                      >
                                        {attachment.fileName || 'Attachment'} (download)
                                      </button>
                                    </li>
                                  );
                                })}
                              </ul>
                            ) : null}
                            {message.type !== 'SYSTEM' ? (
                              <span className="chat-state">
                                {message.self ? (
                                  <span className={`chat-tick ${message.state === 'SEEN' || message.state === 'PLAYED' ? 'is-seen' : ''}`}>
                                    {tickForState(message.state)}
                                  </span>
                                ) : null}
                              </span>
                            ) : null}
                          </article>
                        );
                      })
                    ) : (
                      <EmptyState title="No messages" description="Send the first message." />
                    )}
                  </div>

                  <div className="chat-composer">
                    <div className="chat-composer-bar">
                      <label className="chat-upload-button">
                        {uploadingAttachment ? '...' : <IconPlus />}
                        <input
                          type="file"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) {
                              void uploadAttachment(file);
                            }
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                      <textarea
                        rows={1}
                        value={messageDraft}
                        onChange={(event) => setMessageDraft(event.target.value)}
                        placeholder="Write a message"
                      />
                      <button
                        type="button"
                        className="chat-send-icon"
                        onClick={() => void sendMessage()}
                        disabled={sendingMessage || (!messageDraft.trim() && !attachmentQueue.length)}
                        aria-label="Send message"
                      >
                        {sendingMessage ? '...' : <IconSend />}
                      </button>
                    </div>
                    {attachmentQueue.length ? (
                      <ul className="chat-attachment-queue">
                        {attachmentQueue.map((attachment, index) => (
                          <li key={`${attachment.url}-${index}`}>
                            <span>{attachment.kind}: {attachment.fileName || attachment.url}</span>
                            <button type="button" onClick={() => removeAttachment(index)}>Remove</button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </>
              ) : (
                <EmptyState title="Select a chat" description="Choose a conversation from the list." />
              )}
            </Card>
          </div>
        )}

        <audio ref={remoteAudioRef} autoPlay />
        {overlayRoot &&
        ((incomingCall && !callPanel) || callPanel || (currentCall && !callPanel && !incomingCall))
          ? createPortal(
            <div className="chat-call-overlay">
            {incomingCall && !callPanel ? (
              <div className="chat-call-popup">
                <h4>{incomingCall.mode === 'VIDEO' ? 'Incoming video call' : 'Incoming audio call'}</h4>
                <p className="muted">Someone is calling you.</p>
                <div className="chat-call-popup-actions">
                  <Button type="button" size="sm" variant="primary" onClick={() => void acceptIncomingCall(incomingCall)}>Accept</Button>
                  <Button type="button" size="sm" variant="danger" onClick={() => void rejectIncomingCall(incomingCall)}>Decline</Button>
                </div>
              </div>
            ) : null}
            {callPanel ? (
              <div className={`chat-call-popup chat-call-popup--active ${callPanel.mode === 'VIDEO' ? 'is-video' : 'is-audio'}`}>
                <div className="chat-call-panel-top">
                  <strong>{callPanel.mode === 'VIDEO' ? 'Video call' : 'Audio call'}</strong>
                  <span className="muted">
                    {callPanel.status === 'ringing'
                      ? 'Ringing...'
                      : callPanel.status === 'connecting'
                        ? 'Connecting...'
                        : callPanel.status === 'active'
                          ? 'Connected'
                          : 'Ended'}
                  </span>
                </div>
                <div className="chat-call-media">
                  <video ref={remoteVideoRef} autoPlay playsInline muted className="chat-call-remote" />
                  {callPanel.mode === 'VIDEO' ? (
                    <video ref={localVideoRef} autoPlay playsInline muted className="chat-call-local" />
                  ) : null}
                </div>
                {callPanel.mode === 'VIDEO' && videoDevices.length > 0 ? (
                  <label className="chat-call-device">
                    Camera
                    <select
                      value={selectedVideoDeviceId}
                      onChange={(event) => {
                        const value = event.target.value;
                        void switchVideoInput(value);
                      }}
                    >
                      {videoDevices.map((device, index) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {device.label || `Camera ${index + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <div className="chat-call-controls">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    title={callMuted ? 'Unmute' : 'Mute'}
                    onClick={() => {
                      setCallMuted((current) => !current);
                    }}
                  >
                    {callMuted ? <IconMicOff /> : <IconMic />}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    title={callOnHold ? 'Resume call' : 'Hold call'}
                    onClick={() => {
                      const next = !callOnHold;
                      setCallOnHold(next);
                      if (callPanel) {
                        void sendCallSignal(callPanel.callId, {
                          type: next ? 'hold' : 'resume',
                          hold: next,
                        }).catch(() => null);
                      }
                    }}
                  >
                    {callOnHold ? <IconPlay /> : <IconPause />}
                  </Button>
                  {callPanel.mode === 'VIDEO' ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      title={callCameraOff ? 'Camera on' : 'Camera off'}
                      onClick={async () => {
                        const stream = localStreamRef.current;
                        const peer = peerConnectionRef.current;
                        if (!stream || !peer) {
                          return;
                        }
                        const sender = peer.getSenders().find((item) => item.track?.kind === 'video');
                        if (!callCameraOff) {
                          for (const track of stream.getVideoTracks()) {
                            track.stop();
                            stream.removeTrack(track);
                          }
                          if (sender) {
                            await sender.replaceTrack(null);
                          }
                          if (localVideoRef.current) {
                            localVideoRef.current.srcObject = stream;
                          }
                          setCallCameraOff(true);
                          return;
                        }
                        const targetDevice = selectedVideoDeviceId
                          ? { deviceId: { exact: selectedVideoDeviceId } }
                          : true;
                        const videoCapture = await navigator.mediaDevices.getUserMedia({
                          video: targetDevice,
                        });
                        const newTrack = videoCapture.getVideoTracks()[0];
                        if (!newTrack) {
                          return;
                        }
                        stream.addTrack(newTrack);
                        if (sender) {
                          await sender.replaceTrack(newTrack);
                        } else {
                          peer.addTrack(newTrack, stream);
                        }
                        if (localVideoRef.current) {
                          localVideoRef.current.srcObject = stream;
                        }
                        setCallCameraOff(false);
                      }}
                    >
                      <IconVideo />
                    </Button>
                  ) : null}
                  <Button type="button" size="sm" variant="danger" onClick={() => void endCall('hangup')}>
                    <IconEndCall />
                  </Button>
                </div>
              </div>
            ) : null}
            {currentCall && !callPanel && !incomingCall ? (
              <div className="chat-call-popup">
                <h4>{currentCall.mode === 'VIDEO' ? 'Active video call' : 'Active audio call'}</h4>
                <p className="muted">You already have one active call.</p>
                <div className="chat-call-popup-actions">
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={() => {
                      if (currentCall.conversationId) {
                        selectConversation(currentCall.conversationId);
                      }
                    }}
                  >
                    Open
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    onClick={() => void apiFetch(`/discussions/chat/calls/${currentCall.id}/end`, {
                      method: 'POST',
                      body: JSON.stringify({ reason: 'manual-end' }),
                    }).catch(() => null)}
                  >
                    End
                  </Button>
                </div>
              </div>
            ) : null}
            </div>,
            overlayRoot,
          )
          : null}

        {overlayRoot && isProfilePopupOpen && profile
          ? createPortal(
            <div className="chat-modal-backdrop" onClick={() => setIsProfilePopupOpen(false)}>
              <div
                ref={profilePopupRef}
                className="chat-profile-popup"
                onClick={(event) => event.stopPropagation()}
              >
                <header className="chat-profile-popup-head">
                  <button
                    type="button"
                    className="chat-profile-close"
                    onClick={() => setIsProfilePopupOpen(false)}
                  >
                    Close
                  </button>
                </header>

                <section className="chat-profile-hero">
                  <span className="chat-profile-hero-avatar">
                    {resolveMediaUrl(profile.kind === 'DIRECT' ? directPeer?.avatarUrl ?? null : selectedConversation?.avatarUrl ?? null) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolveMediaUrl(profile.kind === 'DIRECT' ? directPeer?.avatarUrl ?? null : selectedConversation?.avatarUrl ?? null) ?? ''}
                        alt={profile.title}
                      />
                    ) : (
                      getNameInitial(profile.title)
                    )}
                  </span>
                  <div className="chat-profile-hero-copy">
                    <h3>{profile.title}</h3>
                    <p>
                      {profile.kind === 'GROUP'
                        ? `${profile.members.length} members`
                        : (directPeer?.username ? `@${directPeer.username}` : 'Direct message')}
                    </p>
                    {profile.kind === 'DIRECT' && directPeer?.email ? <span>{directPeer.email}</span> : null}
                  </div>
                </section>

                <div className="chat-profile-actions">
                  <button
                    type="button"
                    className="chat-profile-action"
                    onClick={() => void startCall('AUDIO')}
                    disabled={hasAnyCall || !selectedConversation?.canCall}
                  >
                    <IconPhone />
                    <span>Voice call</span>
                  </button>
                  <button
                    type="button"
                    className="chat-profile-action"
                    onClick={() => void startCall('VIDEO')}
                    disabled={hasAnyCall || !selectedConversation?.canCall}
                  >
                    <IconVideo />
                    <span>Video call</span>
                  </button>
                </div>

                <section className="chat-profile-section">
                  <div className="chat-profile-section-head">
                    <strong>{profile.kind === 'GROUP' ? 'About this group' : 'About'}</strong>
                    {profile.kind === 'GROUP' && !canEditGroup ? <span>Only admins can edit</span> : null}
                  </div>
                  {profile.kind === 'GROUP' && canEditGroup ? (
                    <div className="chat-profile-edit-grid">
                      <label className="chat-profile-field">
                        <span>Group name</span>
                        <input
                          value={profileDraftName}
                          onChange={(event) => setProfileDraftName(event.target.value)}
                          placeholder="Group name"
                        />
                      </label>
                      <label className="chat-profile-field">
                        <span>Description</span>
                        <textarea
                          rows={3}
                          value={profileDraftDescription}
                          onChange={(event) => setProfileDraftDescription(event.target.value)}
                          placeholder="Add a short group description"
                        />
                      </label>
                      <div className="chat-profile-meta-row">
                        <span>Created {formatStamp(profile.createdAt)}</span>
                        <button
                          type="button"
                          className="chat-profile-save"
                          onClick={() => void saveGroupProfile()}
                          disabled={savingProfile}
                        >
                          {savingProfile ? 'Saving...' : 'Save changes'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="chat-profile-summary-card">
                      <p>{profile.kind === 'DIRECT' ? (directPeer?.bio || profile.description || 'No about added yet.') : (profile.description || 'No group description yet.')}</p>
                      <span>Created {formatStamp(profile.createdAt)}</span>
                    </div>
                  )}
                </section>

                <section className="chat-profile-section">
                  <div className="chat-profile-section-head">
                    <strong>Shared media</strong>
                    <span>{sharedMedia.length} items</span>
                  </div>
                  {sharedMedia.length ? (
                    <div className="chat-profile-media-grid">
                      {sharedMedia.map((item) => {
                        const mediaUrl = resolveMediaUrl(item.url) ?? item.url;
                        return (
                          <button
                            key={`${item.messageId}-${item.id}`}
                            type="button"
                            className="chat-profile-media-tile"
                            onClick={() => void downloadAttachment(item.id, item.fileName)}
                            title={item.fileName || `Shared ${item.kind.toLowerCase()}`}
                          >
                            {item.kind === 'IMAGE' ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={mediaUrl} alt={item.fileName || 'shared image'} />
                            ) : (
                              <video src={mediaUrl} muted playsInline preload="metadata" />
                            )}
                            <span>{formatDayLabel(item.createdAt)}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="chat-profile-empty">
                      {hasMoreMedia ? 'Loading older attachments will reveal shared media from earlier messages.' : 'No shared photos or videos in this chat yet.'}
                    </p>
                  )}
                  {hasMoreMedia ? (
                    <button
                      type="button"
                      className="chat-profile-load-more"
                      onClick={() => void loadMoreMedia()}
                      disabled={loadingMoreMedia}
                    >
                      {loadingMoreMedia ? 'Loading older media...' : 'Load older media'}
                    </button>
                  ) : null}
                </section>

                {sharedFiles.length ? (
                  <section className="chat-profile-section">
                    <div className="chat-profile-section-head">
                      <strong>Shared files</strong>
                      <span>{sharedFiles.length} items</span>
                    </div>
                    <ul className="chat-profile-file-list">
                      {sharedFiles.map((item) => (
                        <li key={`${item.messageId}-${item.id}`}>
                          <button
                            type="button"
                            onClick={() => void downloadAttachment(item.id, item.fileName)}
                          >
                            <strong>{item.fileName || item.kind}</strong>
                            <span>{formatDayLabel(item.createdAt)}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}

                {profile.kind === 'GROUP' ? (
                  <section className="chat-profile-section">
                    <div className="chat-profile-section-head">
                      <strong>Participants</strong>
                      <span>{profile.members.filter((member) => member.role === 'ADMIN').length} admins</span>
                    </div>
                    <ul className="chat-members chat-members--profile">
                      {profile.members.map((member) => (
                        <li key={member.id}>
                          <span className="chat-member-avatar">
                            {resolveMediaUrl(member.avatarUrl) ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={resolveMediaUrl(member.avatarUrl) ?? ''} alt={member.label} />
                            ) : (
                              getNameInitial(member.label)
                            )}
                          </span>
                          <span className="chat-member-copy">
                            <strong>{member.id === viewerId ? `${member.label} (You)` : member.label}</strong>
                            <span>
                              {member.username ? `@${member.username}` : (member.email || 'No username')}
                            </span>
                          </span>
                          <span className={`chat-member-role ${member.role === 'ADMIN' ? 'is-admin' : ''}`}>
                            {member.role === 'ADMIN' ? 'Admin' : 'Member'}
                          </span>
                          {canEditGroup && member.id !== viewerId ? (
                            <span className="chat-member-actions">
                              <button
                                type="button"
                                disabled={memberActionId === member.id}
                                onClick={() => void updateMemberRole(member.id, member.role === 'ADMIN' ? 'MEMBER' : 'ADMIN')}
                              >
                                {member.role === 'ADMIN' ? 'Remove admin' : 'Make admin'}
                              </button>
                              <button
                                type="button"
                                disabled={memberActionId === member.id}
                                onClick={() => void removeMemberFromGroup(member.id)}
                              >
                                Remove
                              </button>
                            </span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            </div>,
            overlayRoot,
          )
          : null}

        <Modal
          open={Boolean(messageInfo)}
          onClose={() => setMessageInfo(null)}
          title="Message info"
          subtitle="Delivery and timeline details"
          footer={(
            <InlineFormRow align="end">
              <Button type="button" size="sm" variant="secondary" onClick={() => setMessageInfo(null)}>
                Close
              </Button>
            </InlineFormRow>
          )}
        >
          {messageInfo ? (
            <div className="stack">
              <p><strong>Sender:</strong> {messageInfo.sender.label}</p>
              <p><strong>Sent:</strong> {formatStamp(messageInfo.createdAt)}</p>
              <p><strong>Status:</strong> {messageInfo.state}</p>
              <p><strong>Type:</strong> {messageInfo.type}</p>
            </div>
          ) : null}
        </Modal>

        <Modal
          open={isDirectModalOpen}
          onClose={() => !creatingConversation && setIsDirectModalOpen(false)}
          title="New direct chat"
          subtitle="Search a user by name, username, or email."
          footer={(
            <InlineFormRow align="start">
              <Button type="button" variant="secondary" size="sm" onClick={() => setIsDirectModalOpen(false)} disabled={creatingConversation}>Cancel</Button>
              <Button type="button" variant="primary" size="sm" onClick={() => void startDirect()} disabled={creatingConversation || selectedUserIds.length !== 1}>
                {creatingConversation ? 'Creating...' : 'Start chat'}
              </Button>
            </InlineFormRow>
          )}
        >
          {renderUserPicker('single')}
        </Modal>

        <Modal
          open={isGroupModalOpen}
          onClose={() => !creatingConversation && setIsGroupModalOpen(false)}
          title="New group"
          subtitle="Create a group and add members from search results."
          footer={(
            <InlineFormRow align="start">
              <Button type="button" variant="secondary" size="sm" onClick={() => setIsGroupModalOpen(false)} disabled={creatingConversation}>Cancel</Button>
              <Button type="button" variant="primary" size="sm" onClick={() => void createGroup()} disabled={creatingConversation || !groupName.trim()}>
                {creatingConversation ? 'Creating...' : 'Create group'}
              </Button>
            </InlineFormRow>
          )}
        >
          <label className="field">
            Group name
            <input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="Project launch" />
          </label>
          <label className="field">
            Description
            <textarea value={groupDescription} onChange={(event) => setGroupDescription(event.target.value)} rows={3} placeholder="Purpose and context" />
          </label>
          {renderUserPicker('multiple')}
        </Modal>
      </PortalPage>
    </AppShell>
  );
}




