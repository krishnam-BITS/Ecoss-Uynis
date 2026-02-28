import type { KeyboardEvent } from 'react';

export type TabItem<T extends string> = {
  key: T;
  label: string;
  disabled?: boolean;
};

export function Tabs<T extends string>({
  items,
  activeKey,
  onChange,
  ariaLabel,
  className,
  orientation = 'horizontal',
}: {
  items: TabItem<T>[];
  activeKey: T;
  onChange: (key: T) => void;
  ariaLabel: string;
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}) {
  const enabled = items.filter((item) => !item.disabled);
  const activeIndex = enabled.findIndex((item) => item.key === activeKey);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enabled.length) {
      return;
    }

    const backwardKey = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
    const forwardKey = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';

    if (event.key !== backwardKey && event.key !== forwardKey) {
      return;
    }

    event.preventDefault();
    const delta = event.key === forwardKey ? 1 : -1;
    const nextIndex = activeIndex === -1 ? 0 : (activeIndex + delta + enabled.length) % enabled.length;
    onChange(enabled[nextIndex].key);
  };

  return (
    <div
      className={['ui-tabs', `ui-tabs--${orientation}`, className ?? ''].join(' ').trim()}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation={orientation}
      onKeyDown={handleKeyDown}
    >
      {items.map((item) => {
        const isActive = item.key === activeKey;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-disabled={item.disabled}
            tabIndex={isActive ? 0 : -1}
            className={['ui-tab', isActive ? 'is-active' : '', item.disabled ? 'is-disabled' : ''].join(' ').trim()}
            onClick={() => {
              if (!item.disabled) {
                onChange(item.key);
              }
            }}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

