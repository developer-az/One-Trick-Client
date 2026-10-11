import React from 'react';

type IconProps = { size?: number; className?: string };

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const IconHome: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size)} className={className}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V21h14V9.5" />
    <path d="M10 21v-6h4v6" />
  </svg>
);

export const IconDraft: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="7" height="16" rx="2" />
    <rect x="14" y="4" width="7" height="16" rx="2" />
    <path d="M6.5 8h0M6.5 12h0M6.5 16h0M17.5 8h0M17.5 12h0M17.5 16h0" strokeWidth="2.6" />
  </svg>
);

export const IconLoadout: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size)} className={className}>
    <path d="M14.5 4.5 19.5 9.5 9 20H4v-5z" />
    <path d="m12.5 6.5 5 5" />
  </svg>
);

export const IconOverlay: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size)} className={className}>
    <rect x="3" y="4" width="18" height="14" rx="2" />
    <rect x="13" y="7" width="5" height="4" rx="1" />
    <path d="M8 21h8" />
  </svg>
);

export const IconGauge: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size)} className={className}>
    <path d="M4 18a8 8 0 1 1 16 0" />
    <path d="m12 14 4-5" />
    <circle cx="12" cy="14" r="1.2" />
  </svg>
);

export const IconStats: React.FC<IconProps> = ({ size = 18, className }) => (
  <svg {...base(size)} className={className}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

export const IconCheck: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size)} className={className}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const IconAlert: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3 2.5 20h19z" />
    <path d="M12 10v4.5M12 17.5h0" />
  </svg>
);

export const IconInfo: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.5h0" />
  </svg>
);

export const IconArrowRight: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size)} className={className}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const IconUpload: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size)} className={className}>
    <path d="M12 16V4M7 9l5-5 5 5" />
    <path d="M4 16v4h16v-4" />
  </svg>
);

export const IconX: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...base(size)} className={className}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
);

export const IconSearch: React.FC<IconProps> = ({ size = 16, className }) => (
  <svg {...base(size)} className={className}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);

/** Brand mark: a single stylised hook. */
export const IconMark: React.FC<IconProps> = ({ size = 14, className }) => (
  <svg {...base(size)} className={className} strokeWidth={2.2}>
    <path d="M12 3v11a4 4 0 1 1-4-4" />
    <path d="M12 3l3 3" />
  </svg>
);
