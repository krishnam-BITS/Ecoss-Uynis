'use client';

import Image from 'next/image';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type WheelEvent,
} from 'react';
import Cropper, { type Area } from 'react-easy-crop';
import { PortalToast } from '../../../components/PortalToast';
import { apiFetch } from '../../../lib/api';
import { resolveMediaUrl } from '../../../lib/media';
import { Button, Card, InlineFormRow, Modal, SectionHeader } from '../../../src/components/ui';

type PrivateAccount = {
  id: string;
  status: string;
  expiresAt: string;
};

type User = {
  id: string;
  email?: string | null;
  phone?: string | null;
  name?: string | null;
  username?: string | null;
  avatarUrl?: string | null;
  bio?: string | null;
  location?: string | null;
  website?: string | null;
  pendingEmail?: string | null;
  pendingPhone?: string | null;
  createdAt: string;
  privateAccount?: PrivateAccount | null;
};

const initialsFromName = (value: string) => {
  const compact = value.trim();
  if (!compact) {
    return 'U';
  }
  const parts = compact.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || 'U';
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const AVATAR_CROP_MIN_ZOOM = 0.01;
const AVATAR_CROP_MAX_ZOOM = 4;
const AVATAR_CROP_DEFAULT_ZOOM = 0.4;

export default function ProfileSettingsPage() {
  const [user, setUser] = useState<User | null>(null);
  const [name, setName] = useState('');
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [website, setWebsite] = useState('');
  const [toast, setToast] = useState<{
    message: string;
    tone: 'success' | 'error' | 'warning' | 'info';
  } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [isRemovingAvatar, setIsRemovingAvatar] = useState(false);
  const [avatarBroken, setAvatarBroken] = useState(false);
  const [avatarVersion, setAvatarVersion] = useState(0);
  const [isAvatarCropOpen, setIsAvatarCropOpen] = useState(false);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const [avatarCropUrl, setAvatarCropUrl] = useState<string | null>(null);
  const [avatarCrop, setAvatarCrop] = useState({ x: 0, y: 0 });
  const [avatarCropZoom, setAvatarCropZoom] = useState(AVATAR_CROP_DEFAULT_ZOOM);
  const [avatarCropPixels, setAvatarCropPixels] = useState<Area | null>(null);
  const [showContacts, setShowContacts] = useState(false);
  const [emailInput, setEmailInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [contactOtp, setContactOtp] = useState('');
  const [pendingType, setPendingType] = useState<'email' | 'phone' | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);

  const hydrateUser = (next: User) => {
    setUser(next);
    setName(next.name ?? '');
    setBio(next.bio ?? '');
    setLocation(next.location ?? '');
    setWebsite(next.website ?? '');
    setEmailInput(next.pendingEmail ?? '');
    setPhoneInput(next.pendingPhone ?? '');
    if (next.pendingEmail) {
      setPendingType('email');
    } else if (next.pendingPhone) {
      setPendingType('phone');
    } else {
      setPendingType(null);
    }
  };

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiFetch<{ user: User }>('/me');
        hydrateUser(data.user);
      } catch (err) {
        setToast({
          message: err instanceof Error ? err.message : 'Unable to load profile.',
          tone: 'error',
        });
      }
    };
    void load();
  }, []);

  useEffect(() => {
    setAvatarBroken(false);
  }, [user?.avatarUrl]);

  useEffect(
    () => () => {
      if (avatarCropUrl) {
        URL.revokeObjectURL(avatarCropUrl);
      }
    },
    [avatarCropUrl],
  );

  const reloadUser = async () => {
    const data = await apiFetch<{ user: User }>('/me');
    hydrateUser(data.user);
  };

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setIsSaving(true);

    try {
      const payload = {
        name: name || undefined,
        bio: bio || undefined,
        location: location || undefined,
        website: website || undefined,
      };
      const data = await apiFetch<{ user: User }>('/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      hydrateUser(data.user);
      setToast({ message: 'Profile updated.', tone: 'success' });
      setIsEditing(false);
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Unable to update profile.',
        tone: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const closeAvatarCropModal = () => {
    setIsAvatarCropOpen(false);
    setAvatarCropFile(null);
    setAvatarCrop({ x: 0, y: 0 });
    setAvatarCropZoom(AVATAR_CROP_DEFAULT_ZOOM);
    setAvatarCropPixels(null);
    setAvatarCropUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return null;
    });
  };

  const resetAvatarCrop = () => {
    setAvatarCrop({ x: 0, y: 0 });
    setAvatarCropZoom(AVATAR_CROP_DEFAULT_ZOOM);
  };

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      return;
    }
    if (!file.type.startsWith('image/')) {
      setToast({ message: 'Avatar must be an image file.', tone: 'error' });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setToast({ message: 'Avatar must be smaller than 5MB.', tone: 'error' });
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    setAvatarCropUrl((current) => {
      if (current) {
        URL.revokeObjectURL(current);
      }
      return objectUrl;
    });
    setAvatarCropFile(file);
    setAvatarCrop({ x: 0, y: 0 });
    setAvatarCropZoom(AVATAR_CROP_DEFAULT_ZOOM);
    setAvatarCropPixels(null);
    setIsAvatarCropOpen(true);
  };

  const handleCropComplete = useCallback((_area: Area, croppedAreaPixels: Area) => {
    setAvatarCropPixels(croppedAreaPixels);
  }, []);

  const handleAvatarCropWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    setAvatarCropZoom((current) => {
      const step = event.deltaY < 0 ? 0.12 : -0.12;
      return clamp(current + step, AVATAR_CROP_MIN_ZOOM, AVATAR_CROP_MAX_ZOOM);
    });
  }, []);

  const handleAvatarCropSave = async () => {
    if (!avatarCropFile || !avatarCropUrl) {
      return;
    }

    setIsUploadingAvatar(true);

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const nextImage = new window.Image();
        nextImage.onload = () => resolve(nextImage);
        nextImage.onerror = () => reject(new Error('Unable to load selected image.'));
        nextImage.src = avatarCropUrl;
      });

      const canvas = document.createElement('canvas');
      const targetSize = 512;
      canvas.width = targetSize;
      canvas.height = targetSize;
      const context = canvas.getContext('2d');
      if (!context) {
        throw new Error('Unable to initialize image processing.');
      }

      const cropPixels = avatarCropPixels;
      if (!cropPixels) {
        throw new Error('Select the crop area first.');
      }

      const cropX = Math.max(0, Math.floor(cropPixels.x));
      const cropY = Math.max(0, Math.floor(cropPixels.y));
      const cropWidth = Math.min(image.width - cropX, Math.floor(cropPixels.width));
      const cropHeight = Math.min(image.height - cropY, Math.floor(cropPixels.height));
      if (cropWidth <= 0 || cropHeight <= 0) {
        throw new Error('Unable to crop the selected area.');
      }

      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.clearRect(0, 0, targetSize, targetSize);
      context.drawImage(
        image,
        cropX,
        cropY,
        cropWidth,
        cropHeight,
        0,
        0,
        targetSize,
        targetSize,
      );

      const outputType = avatarCropFile.type === 'image/png' ? 'image/png' : 'image/jpeg';
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, outputType, 0.92);
      });

      if (!blob) {
        throw new Error('Unable to prepare cropped image.');
      }

      const extension = outputType === 'image/png' ? 'png' : 'jpg';
      const croppedFile = new File([blob], `avatar.${extension}`, { type: outputType });
      const body = new FormData();
      body.append('avatar', croppedFile);

      const data = await apiFetch<{ user: User }>('/me/avatar', {
        method: 'POST',
        body,
      });

      hydrateUser(data.user);
      setAvatarBroken(false);
      setAvatarVersion((value) => value + 1);
      setToast({ message: 'Profile photo updated.', tone: 'success' });
      closeAvatarCropModal();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Unable to upload avatar.',
        tone: 'error',
      });
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  const handleAvatarRemove = async () => {
    if (!user?.avatarUrl || isRemovingAvatar) {
      return;
    }
    setIsRemovingAvatar(true);
    try {
      const data = await apiFetch<{ user: User }>('/me/avatar', {
        method: 'DELETE',
      });
      hydrateUser(data.user);
      setAvatarVersion((value) => value + 1);
      setToast({ message: 'Profile photo removed.', tone: 'success' });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Unable to remove avatar.',
        tone: 'error',
      });
    } finally {
      setIsRemovingAvatar(false);
    }
  };

  const handleContactRequest = async (type: 'email' | 'phone') => {
    const payload = type === 'email' ? { email: emailInput.trim() } : { phone: phoneInput.trim() };

    if (type === 'email' && !payload.email) {
      setToast({ message: 'Please enter an email to add.', tone: 'error' });
      return;
    }
    if (type === 'phone' && !payload.phone) {
      setToast({ message: 'Please enter a phone number to add.', tone: 'error' });
      return;
    }
    if (type === 'phone' && !/^\+[0-9]{10,15}$/.test(payload.phone ?? '')) {
      setToast({
        message: 'Include country code (for example +15551234567).',
        tone: 'error',
      });
      return;
    }

    try {
      await apiFetch('/me/contact/request', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setPendingType(type);
      setContactOtp('');
      setToast({ message: 'Verification code sent.', tone: 'success' });
      await reloadUser();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Unable to send OTP.',
        tone: 'error',
      });
    }
  };

  const handleContactConfirm = async () => {
    if (!contactOtp.trim()) {
      setToast({ message: 'Please enter the OTP.', tone: 'error' });
      return;
    }
    try {
      await apiFetch('/me/contact/confirm', {
        method: 'POST',
        body: JSON.stringify({ otp: contactOtp.trim() }),
      });
      setToast({ message: 'Contact verified and added.', tone: 'success' });
      setContactOtp('');
      await reloadUser();
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Unable to verify OTP.',
        tone: 'error',
      });
    }
  };

  const profileName = user?.name || user?.username || user?.email || 'Your profile';
  const previewInitials = useMemo(() => initialsFromName(profileName), [profileName]);
  const avatarSrc = useMemo(() => {
    const resolved = resolveMediaUrl(user?.avatarUrl);
    if (!resolved) {
      return null;
    }
    if (!avatarVersion) {
      return resolved;
    }
    return `${resolved}${resolved.includes('?') ? '&' : '?'}v=${avatarVersion}`;
  }, [avatarVersion, user?.avatarUrl]);

  const memberSince = user
    ? new Date(user.createdAt).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      })
    : '';

  return (
    <div className="portal-container portal-stack settings-profile-shell">
      {toast ? (
        <PortalToast message={toast.message} tone={toast.tone} onClose={() => setToast(null)} />
      ) : null}

      <Card className="portal-card settings-profile-card">
        <SectionHeader
          title="Profile"
          subtitle="Manage your identity and public account details."
          actions={(
            <Button type="button" variant="ghost" onClick={() => setIsEditing((value) => !value)}>
              {isEditing ? 'Cancel edit' : 'Edit profile'}
            </Button>
          )}
        />

        <div className="settings-profile-head">
          {avatarSrc && !avatarBroken ? (
            <Image
              className="settings-profile-photo"
              src={avatarSrc}
              alt={profileName}
              width={96}
              height={96}
              unoptimized
              onError={() => setAvatarBroken(true)}
            />
          ) : (
            <div className="settings-profile-photo settings-profile-photo-fallback">
              {previewInitials}
            </div>
          )}

          <div className="settings-profile-intro">
            <strong>{profileName}</strong>
            <p className="muted">@{user?.username ?? 'username'}</p>
            <p className="muted">Member since {memberSince || '...'}</p>
            {user?.privateAccount ? <span className="portal-pill portal-pill--member">Private account</span> : null}
          </div>

          <div className="settings-profile-avatar-actions">
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="settings-profile-avatar-input"
              onChange={handleAvatarUpload}
              aria-label="Upload profile photo"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => avatarInputRef.current?.click()}
              disabled={isUploadingAvatar}
            >
              {isUploadingAvatar ? 'Uploading...' : 'Upload photo'}
            </Button>
            {avatarSrc ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handleAvatarRemove()}
                disabled={isRemovingAvatar}
              >
                {isRemovingAvatar ? 'Removing...' : 'Remove'}
              </Button>
            ) : null}
          </div>
        </div>

        {isEditing ? (
          <form className="stack" onSubmit={handleSave}>
            <label className="field">
              <span>Display name</span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Your name"
              />
            </label>

            <label className="field">
              <span>Bio</span>
              <textarea
                rows={4}
                value={bio}
                onChange={(event) => setBio(event.target.value)}
                placeholder="Tell people what you are building"
              />
            </label>

            <div className="grid profile-grid">
              <label className="field">
                <span>Location</span>
                <input
                  type="text"
                  value={location}
                  onChange={(event) => setLocation(event.target.value)}
                  placeholder="City, Country"
                />
              </label>
              <label className="field">
                <span>Website</span>
                <input
                  type="url"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder="https://your-site.dev"
                />
              </label>
            </div>

            <InlineFormRow align="start">
              <Button type="submit" variant="primary" disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save profile'}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setIsEditing(false)}>
                Cancel
              </Button>
            </InlineFormRow>
          </form>
        ) : (
          <dl className="settings-profile-meta-grid">
            <div className="settings-profile-meta-item">
              <dt>Display name</dt>
              <dd>{user?.name ?? 'Not added'}</dd>
            </div>
            <div className="settings-profile-meta-item">
              <dt>Bio</dt>
              <dd>{user?.bio ?? 'Not added'}</dd>
            </div>
            <div className="settings-profile-meta-item">
              <dt>Location</dt>
              <dd>{user?.location ?? 'Not added'}</dd>
            </div>
            <div className="settings-profile-meta-item">
              <dt>Website</dt>
              <dd>{user?.website ?? 'Not added'}</dd>
            </div>
            <div className="settings-profile-meta-item">
              <dt>Email</dt>
              <dd>{user?.email ?? 'Not added'}</dd>
            </div>
            <div className="settings-profile-meta-item">
              <dt>Phone</dt>
              <dd>{user?.phone ?? 'Not added'}</dd>
            </div>
          </dl>
        )}
      </Card>

      <Modal
        open={isAvatarCropOpen}
        onClose={closeAvatarCropModal}
        title="Adjust profile photo"
        subtitle="Zoom and position your photo inside the frame before upload."
        closeLabel="Close photo crop dialog"
        bodyClassName="settings-avatar-modal-body"
      >
        {avatarCropUrl ? (
          <div className="stack settings-avatar-crop-shell">
            <div
              className="settings-avatar-crop-frame"
              onWheel={handleAvatarCropWheel}
            >
              <Cropper
                image={avatarCropUrl}
                crop={avatarCrop}
                zoom={avatarCropZoom}
                aspect={1}
                cropShape="round"
                showGrid={false}
                minZoom={AVATAR_CROP_MIN_ZOOM}
                maxZoom={AVATAR_CROP_MAX_ZOOM}
                zoomSpeed={0.2}
                objectFit="contain"
                restrictPosition={false}
                onCropChange={setAvatarCrop}
                onZoomChange={setAvatarCropZoom}
                onCropComplete={handleCropComplete}
              />
            </div>

            <div className="settings-avatar-crop-controls">
              <label className="field">
                <div className="settings-avatar-crop-control-head">
                  <span>Zoom</span>
                  <span className="muted">{Math.round(avatarCropZoom * 100)}%</span>
                </div>
                <div className="settings-avatar-crop-slider-row">
                  <span aria-hidden="true">-</span>
                  <input
                    type="range"
                    min={AVATAR_CROP_MIN_ZOOM}
                    max={AVATAR_CROP_MAX_ZOOM}
                    step={0.01}
                    value={avatarCropZoom}
                    onChange={(event) => setAvatarCropZoom(Number(event.target.value))}
                    aria-label="Crop zoom"
                  />
                  <span aria-hidden="true">+</span>
                </div>
              </label>
              <p className="muted settings-avatar-crop-hint">
                Drag to reposition. Use mouse wheel or pinch gesture to zoom.
              </p>

              <InlineFormRow className="settings-avatar-crop-actions">
                <Button type="button" variant="ghost" onClick={resetAvatarCrop} disabled={isUploadingAvatar}>
                  Reset
                </Button>
                <Button type="button" variant="ghost" onClick={closeAvatarCropModal} disabled={isUploadingAvatar}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => void handleAvatarCropSave()}
                  disabled={isUploadingAvatar}
                >
                  {isUploadingAvatar ? 'Saving...' : 'Save photo'}
                </Button>
              </InlineFormRow>
            </div>
          </div>
        ) : null}
      </Modal>

      <Card className="portal-card stack">
        <SectionHeader
          title="Contact methods"
          subtitle="Add email or phone only when you need recovery/login fallback."
          actions={(
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowContacts((value) => !value)}>
              {showContacts ? 'Hide' : 'Manage'}
            </Button>
          )}
        />

        {showContacts ? (
          <div className="stack">
            <label className="field">
              <span>Add email</span>
              <input
                type="email"
                value={emailInput}
                onChange={(event) => setEmailInput(event.target.value)}
                placeholder="you@example.com"
                disabled={Boolean(user?.email)}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleContactRequest('email')}
              disabled={Boolean(user?.email)}
            >
              Send email OTP
            </Button>

            <label className="field">
              <span>Add phone</span>
              <input
                type="tel"
                value={phoneInput}
                onChange={(event) => setPhoneInput(event.target.value)}
                placeholder="+15551234567"
                disabled={Boolean(user?.phone)}
              />
            </label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => void handleContactRequest('phone')}
              disabled={Boolean(user?.phone)}
            >
              Send phone OTP
            </Button>

            {pendingType ? (
              <>
                <label className="field">
                  <span>Enter OTP</span>
                  <input
                    type="text"
                    value={contactOtp}
                    onChange={(event) => setContactOtp(event.target.value)}
                    placeholder="Enter verification code"
                  />
                </label>
                <Button type="button" variant="primary" size="sm" onClick={() => void handleContactConfirm()}>
                  Verify OTP
                </Button>
              </>
            ) : null}
          </div>
        ) : null}
      </Card>
    </div>
  );
}
