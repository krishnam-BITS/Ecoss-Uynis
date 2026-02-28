export type PublicTopNavKey = 'product' | 'help' | 'terms';

export type PublicSearchItem = {
  id: string;
  label: string;
  href: string;
  description?: string;
  keywords?: string[];
  navKey?: PublicTopNavKey;
};

export const PUBLIC_TOP_NAV_LINKS: Array<{
  key: PublicTopNavKey;
  label: string;
  href: string;
}> = [
  { key: 'product', label: 'Product', href: '/home' },
  { key: 'help', label: 'Help', href: '/help' },
  { key: 'terms', label: 'Terms', href: '/terms' },
];

export const LANDING_SEARCH_ITEMS: PublicSearchItem[] = [
  {
    id: 'product-overview',
    label: 'Product overview',
    href: '/home#product',
    description: 'Understand the full platform flow.',
    keywords: ['product', 'overview', 'platform', 'features'],
    navKey: 'product',
  },
  {
    id: 'product-repositories',
    label: 'Repository management',
    href: '/home#product-repositories',
    description: 'Create, import, and manage repositories.',
    keywords: ['repo', 'repositories', 'import', 'visibility'],
    navKey: 'product',
  },
  {
    id: 'product-collaboration',
    label: 'Review and collaboration',
    href: '/home#product-collaboration',
    description: 'Issues, pull requests, notifications, and discussions.',
    keywords: ['issues', 'pull requests', 'discussion', 'review', 'notifications'],
    navKey: 'product',
  },
  {
    id: 'product-workspaces',
    label: 'Workspace controls',
    href: '/home#product-workspaces',
    description: 'Control access, members, teams, and permissions.',
    keywords: ['workspace', 'people', 'teams', 'access', 'roles'],
    navKey: 'product',
  },
  {
    id: 'help',
    label: 'Help center',
    href: '/help',
    description: 'Troubleshooting and onboarding guidance.',
    keywords: ['help', 'support', 'guide'],
    navKey: 'help',
  },
  {
    id: 'help-login',
    label: 'Login help',
    href: '/help#help-login',
    description: 'Signin issues, verification, and recovery tips.',
    keywords: ['login', 'signin', 'verification'],
    navKey: 'help',
  },
  {
    id: 'help-signup',
    label: 'Signup help',
    href: '/help#help-signup',
    description: 'Account creation and onboarding help.',
    keywords: ['signup', 'register', 'create account'],
    navKey: 'help',
  },
  {
    id: 'help-password',
    label: 'Password and account recovery',
    href: '/help#help-password',
    description: 'Reset password and recover account access.',
    keywords: ['password', 'forgot', 'recovery'],
    navKey: 'help',
  },
  {
    id: 'help-private',
    label: 'Private mode help',
    href: '/help#help-private',
    description: 'Private account setup and recovery.',
    keywords: ['private', 'anonymous', 'recover'],
    navKey: 'help',
  },
  {
    id: 'help-faq',
    label: 'FAQ',
    href: '/help#help-faq',
    description: 'Common questions and quick answers.',
    keywords: ['faq', 'questions', 'answers'],
    navKey: 'help',
  },
  {
    id: 'terms',
    label: 'Terms and policy',
    href: '/terms',
    description: 'Usage, policy, and account responsibility summary.',
    keywords: ['terms', 'policy', 'legal', 'usage'],
    navKey: 'terms',
  },
];

const normalize = (value: string) => value.trim().toLowerCase();

export function matchPublicSearchItems(
  items: PublicSearchItem[],
  query: string,
): PublicSearchItem[] {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) {
    return items;
  }

  const scored = items
    .map((item) => {
      let score = 0;
      const label = normalize(item.label);
      const description = normalize(item.description ?? '');
      const keywords = item.keywords?.map(normalize) ?? [];

      if (label.startsWith(normalizedQuery)) {
        score += 4;
      } else if (label.includes(normalizedQuery)) {
        score += 3;
      }

      if (description.includes(normalizedQuery)) {
        score += 2;
      }

      if (keywords.some((keyword) => keyword.startsWith(normalizedQuery))) {
        score += 2;
      } else if (keywords.some((keyword) => keyword.includes(normalizedQuery))) {
        score += 1;
      }

      return { item, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.item.label.localeCompare(b.item.label))
    .map((entry) => entry.item);

  return scored.length ? scored : items;
}
