import type { FormEvent } from 'react';
import { Button } from '../../src/components/ui';

export function CommentComposer({
  label = 'Add a comment',
  value,
  onChange,
  onSubmit,
  placeholder = 'Write your comment...',
  submitLabel = 'Comment',
  isSubmitting = false,
  isEnabled = true,
  disabledReason,
  loginHref,
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void> | void;
  placeholder?: string;
  submitLabel?: string;
  isSubmitting?: boolean;
  isEnabled?: boolean;
  disabledReason?: string;
  loginHref?: string;
}) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isEnabled || isSubmitting) {
      return;
    }
    void onSubmit();
  };

  return (
    <form className="repo-detail-composer" onSubmit={handleSubmit}>
      <label>
        <span>{label}</span>
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={!isEnabled || isSubmitting}
          rows={6}
        />
      </label>
      <div className="repo-detail-composer-actions">
        {disabledReason ? <span className="muted">{disabledReason}</span> : null}
        {loginHref ? (
          <Button variant="ghost" size="sm" href={loginHref}>
            Login to contribute
          </Button>
        ) : (
          <Button
            variant="primary"
            size="sm"
            type="submit"
            disabled={!isEnabled || isSubmitting || !value.trim()}
          >
            {isSubmitting ? 'Saving...' : submitLabel}
          </Button>
        )}
      </div>
    </form>
  );
}
