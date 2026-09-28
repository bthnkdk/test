import type { ReactNode } from 'react';
import { NEUTRAL_TONE } from '../types.ts';
import type { Tone } from '../types.ts';

interface BadgeProps {
  label: ReactNode;
  tone?: Tone;
  size?: 'sm' | 'md';
}

export const Badge = ({ label, tone = NEUTRAL_TONE, size = 'sm' }: BadgeProps) => (
  <span
    style={{
      display: 'inline-block',
      padding: size === 'md' ? '2px 10px' : '1px 7px',
      borderRadius: 4,
      fontSize: size === 'md' ? 12 : 11,
      fontWeight: 500,
      lineHeight: '18px',
      whiteSpace: 'nowrap',
      backgroundColor: tone.bg,
      color: tone.color,
    }}
  >
    {label}
  </span>
);
