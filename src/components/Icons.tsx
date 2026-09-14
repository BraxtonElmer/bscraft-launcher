// ============================================================
// Icons.tsx — Inline stroke icons (inherit currentColor)
// ============================================================

import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  )
}

/** Pixel art in Minecraft's style: rows of palette keys, '.' for empty */
function PixelIcon({ size = 18, rows, palette, ...rest }: SVGProps<SVGSVGElement> & { size?: number; rows: string[]; palette: Record<string, string> }) {
  const w = rows[0].length, h = rows.length
  return (
    <svg width={size} height={size * h / w} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" aria-hidden {...rest}>
      {rows.flatMap((row, y) => [...row].map((c, x) => palette[c]
        ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={palette[c]} />
        : null))}
    </svg>
  )
}

/** A chest: something new inside (a launcher update) */
export const ChestIcon = ({ size = 24, ...p }: IconProps) => (
  <PixelIcon
    size={size}
    rows={[
      '..KKKKKKKK..',
      '.KhhhhhhhhK.',
      'KwWWWWWWWWwK',
      'KwWWWWWWWWwK',
      'KkkkkLLkkkkK',
      'KwWWWLlWWWwK',
      'KwWWWWWWWWwK',
      'KwWWWWWWWWwK',
      'KwwwwwwwwwwK',
      '.KKKKKKKKKK.',
    ]}
    palette={{ K: '#2e1c0e', h: '#d09446', W: '#b8772e', w: '#8d5520', k: '#4a2c12', L: '#ece6d6', l: '#a8a293' }}
    {...p}
  />
)

/** A diamond: everything at its best (Quality mode) */
export const DiamondIcon = ({ size = 14, ...p }: IconProps) => (
  <PixelIcon
    size={size}
    rows={[
      '..DDD..',
      '.DWCCD.',
      'DWCCCCD',
      'DCCCCcD',
      '.DCCcD.',
      '..DcD..',
      '...D...',
    ]}
    palette={{ D: '#0f6e67', W: '#e6fffb', C: '#4fe3d2', c: '#27b8a9' }}
    {...p}
  />
)

export const DatabaseIcon = (p: IconProps) => (
  <Icon {...p}>
    <ellipse cx="12" cy="5.5" rx="7.5" ry="2.8" />
    <path d="M4.5 5.5v13c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8v-13" />
    <path d="M4.5 12c0 1.5 3.4 2.8 7.5 2.8s7.5-1.3 7.5-2.8" />
  </Icon>
)

export const PlayIcon = (p: IconProps) => (
  <Icon {...p}><path d="M7 4.5v15l12.5-7.5L7 4.5z" /></Icon>
)

export const TerminalIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="3" />
    <path d="M7.5 9.5l3 2.5-3 2.5M12.5 15h4" />
  </Icon>
)

export const UserIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="8" r="4" />
    <path d="M4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
  </Icon>
)

export const KeyIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="M11 12l8.5-8.5M16.5 6.5l2.5 2.5M14 9l2 2" />
  </Icon>
)

export const UploadIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 15.5V4M7.5 8.5L12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 006.5 20h11a1.5 1.5 0 001.5-1.5V15" /></Icon>
)

export const EyeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

export const EyeOffIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 4l16 16M10.6 6.1c.5-.1.9-.1 1.4-.1 6 0 9.5 6 9.5 6a17 17 0 01-2.7 3.4M6.6 7.4C3.9 9.2 2.5 12 2.5 12S6 18.5 12 18.5c1.6 0 3-.4 4.2-1" />
    <path d="M9.9 9.9a3 3 0 004.2 4.2" />
  </Icon>
)

export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 3.7a1.7 1.7 0 0 1 3.4 0l.1.6a1.7 1.7 0 0 0 2.5 1l.5-.3a1.7 1.7 0 0 1 2.4 2.4l-.3.5a1.7 1.7 0 0 0 1 2.5l.6.1a1.7 1.7 0 0 1 0 3.4l-.6.1a1.7 1.7 0 0 0-1 2.5l.3.5a1.7 1.7 0 0 1-2.4 2.4l-.5-.3a1.7 1.7 0 0 0-2.5 1l-.1.6a1.7 1.7 0 0 1-3.4 0l-.1-.6a1.7 1.7 0 0 0-2.5-1l-.5.3a1.7 1.7 0 0 1-2.4-2.4l.3-.5a1.7 1.7 0 0 0-1-2.5l-.6-.1a1.7 1.7 0 0 1 0-3.4l.6-.1a1.7 1.7 0 0 0 1-2.5l-.3-.5a1.7 1.7 0 0 1 2.4-2.4l.5.3a1.7 1.7 0 0 0 2.5-1l.1-.6z" />
    <circle cx="12" cy="12" r="3" />
  </Icon>
)

export const MinimizeIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.4}><path d="M6 12h12" /></Icon>
)

export const CloseIcon = (p: IconProps) => (
  <Icon {...p} strokeWidth={1.4}><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></Icon>
)

export const RefreshIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
    <path d="M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
    <path d="M20 20v-4h-4" />
  </Icon>
)

export const ShieldCheckIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3l7.5 3v5.5c0 4.4-3.1 8.1-7.5 9.5-4.4-1.4-7.5-5.1-7.5-9.5V6L12 3z" />
    <path d="M8.8 12.2l2.2 2.2 4.3-4.6" />
  </Icon>
)

export const WrenchIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14.7 6.3a4 4 0 0 0 5 5L21 12.6a6 6 0 0 1-7.7 1.8L7 20.7a2.1 2.1 0 0 1-3-3l6.3-6.3A6 6 0 0 1 12.1 3.7l1.3 1.3a4 4 0 0 0 1.3 1.3z" />
  </Icon>
)

export const ChipIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2" />
    <path d="M9.5 9.5h5v5h-5zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" />
  </Icon>
)

export const MemoryIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="2.5" y="7" width="19" height="10" rx="2" />
    <path d="M6.5 10.5v3M10 10.5v3M14 10.5v3M17.5 10.5v3M6 17v2.5M18 17v2.5" />
  </Icon>
)

export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Icon>
)

export const GaugeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.2 17.5a9 9 0 1 1 15.6 0" />
    <path d="M12 13.5l4-5" />
    <circle cx="12" cy="14" r="1.6" />
  </Icon>
)

export const SparklesIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10 3.5l1.6 4.4L16 9.5l-4.4 1.6L10 15.5l-1.6-4.4L4 9.5l4.4-1.6L10 3.5z" />
    <path d="M18 14l.8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14z" />
  </Icon>
)

export const AlertIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M10.3 4.1L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.1a2 2 0 0 0-3.4 0z" />
    <path d="M12 9.5v4M12 17h.01" />
  </Icon>
)

export const CheckIcon = (p: IconProps) => (
  <Icon {...p}><path d="M5 12.5l4.5 4.5L19 7.5" /></Icon>
)

export const XCircleIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </Icon>
)

export const InfoIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </Icon>
)

export const CopyIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2.5" />
    <path d="M15.5 8.5V6a2.5 2.5 0 0 0-2.5-2.5H6A2.5 2.5 0 0 0 3.5 6v7A2.5 2.5 0 0 0 6 15.5h2.5" />
  </Icon>
)

export const EraserIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M8.5 20.5h12M4.6 14.6l9.2-9.2a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8l-7.7 7.7a2 2 0 0 1-1.4.6H8.3a2 2 0 0 1-1.4-.6l-2.3-2.3a1.4 1.4 0 0 1 0-2z" />
    <path d="M9 10l5.5 5.5" />
  </Icon>
)

export const StopIcon = (p: IconProps) => (
  <Icon {...p}><rect x="6" y="6" width="12" height="12" rx="2" /></Icon>
)

export const ArrowDownIcon = (p: IconProps) => (
  <Icon {...p}><path d="M12 5v14M6 13l6 6 6-6" /></Icon>
)

export const SearchIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-4.2-4.2" />
  </Icon>
)

export const DownloadIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
  </Icon>
)

export const ChevronRightIcon = (p: IconProps) => (
  <Icon {...p}><path d="M9.5 6l6 6-6 6" /></Icon>
)

export const ImageIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="M20.5 16l-5-5-8.5 8.5" />
  </Icon>
)

export const RotateIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M20 12a8 8 0 1 1-2.35-5.65" />
    <path d="M20 4.5v4.5h-4.5" />
  </Icon>
)

export const TagIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3.5 12.2V4.5a1 1 0 0 1 1-1h7.7l8.3 8.3-8.7 8.7-8.3-8.3z" />
    <circle cx="8.2" cy="8.2" r="1.4" />
  </Icon>
)

export const LayersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 3.5l8.5 4.5-8.5 4.5L3.5 8 12 3.5z" />
    <path d="M3.5 12l8.5 4.5 8.5-4.5M3.5 16l8.5 4.5 8.5-4.5" />
  </Icon>
)

export const TargetIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="7.5" />
    <circle cx="12" cy="12" r="2.2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Icon>
)

export const ShirtIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M9 3.5L3.5 6.5l2 4.5 2-1V20.5h9V10l2 1 2-4.5L15 3.5a3 3 0 0 1-6 0z" />
  </Icon>
)

export const ExternalIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
  </Icon>
)

export const PencilIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15.5 4.5l4 4L8 20H4v-4L15.5 4.5z" />
    <path d="M13 7l4 4" />
  </Icon>
)

export const TrashIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
  </Icon>
)

export const ChevronUpIcon = (p: IconProps) => (
  <Icon {...p}><path d="M6 15l6-6 6 6" /></Icon>
)

export const ServerIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="3.5" y="4" width="17" height="7" rx="2" />
    <rect x="3.5" y="13" width="17" height="7" rx="2" />
    <path d="M7.5 7.5h.01M7.5 16.5h.01M11 7.5h5M11 16.5h5" />
  </Icon>
)

export const HomeIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M4 10.5L12 4l8 6.5V20h-5.5v-6h-5v6H4v-9.5z" />
  </Icon>
)
