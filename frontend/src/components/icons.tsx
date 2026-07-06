import type { CSSProperties } from 'react'

type P = { size?: number; style?: CSSProperties; color?: string }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

export const RecipesIcon = ({ size = 21, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v15.5H5.5A1.5 1.5 0 0 1 4 18z" />
    <path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v15.5h5.5A1.5 1.5 0 0 0 20 18z" />
  </svg>
)

export const PantryIcon = ({ size = 21, style }: P) => (
  <svg {...base(size)} style={style}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="2" />
    <path d="M4.5 9.5h15" />
    <path d="M10 6h4" />
    <path d="M10 13.5h4" />
  </svg>
)

export const PlanIcon = ({ size = 21, style }: P) => (
  <svg {...base(size)} style={style}>
    <rect x="4" y="5" width="16" height="15" rx="2" />
    <path d="M4 9.5h16" />
    <path d="M8.5 3v3.5M15.5 3v3.5" />
    <path d="M8 13.5h3M13.5 13.5h2.5M8 16.5h3" />
  </svg>
)

export const ShopIcon = ({ size = 21, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M4 7h16l-1.4 10.2a2 2 0 0 1-2 1.8H7.4a2 2 0 0 1-2-1.8z" />
    <path d="M8.5 7a3.5 3.5 0 0 1 7 0" />
  </svg>
)

export const ProfileIcon = ({ size = 21, style }: P) => (
  <svg {...base(size)} style={style}>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5.5 20a6.5 6.5 0 0 1 13 0" />
  </svg>
)

export const ChatIcon = ({ size = 21, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M4 5.5h16v11H9l-4 3.5v-3.5H4z" />
  </svg>
)

export const SearchIcon = ({ size = 16, style, color = 'var(--text-3)' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" style={style}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.2-3.2" />
  </svg>
)

export const ClockIcon = ({ size = 13, style, color = 'currentColor' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} style={style}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const ServingsIcon = ({ size = 13, style, color = 'currentColor' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} style={style}>
    <circle cx="9" cy="8" r="3" />
    <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
    <path d="M16 6.5a3 3 0 0 1 0 5.8" />
    <path d="M19.5 19a5.5 5.5 0 0 0-3-4.9" />
  </svg>
)

export const BackIcon = ({ size = 17, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="m14 6-6 6 6 6" />
  </svg>
)

export const ChevronRight = ({ size = 14, style, color = 'currentColor' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const PlusIcon = ({ size = 16, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={style}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const CloseIcon = ({ size = 18, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" style={style}>
    <path d="m6 6 12 12M18 6 6 18" />
  </svg>
)

export const ExpandIcon = ({ size = 17, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M9 4H5a1 1 0 0 0-1 1v4M15 4h4a1 1 0 0 1 1 1v4M9 20H5a1 1 0 0 1-1-1v-4M15 20h4a1 1 0 0 0 1-1v-4" />
  </svg>
)

export const SendIcon = ({ size = 17, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
)

export const SparkleIcon = ({ size = 17, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="#fff" style={style}>
    <path d="M12 2.5l1.6 5.1 5.1 1.6-5.1 1.6L12 16l-1.6-5.2L5.3 9.2l5.1-1.6z" />
    <path d="M18.5 14.5l.7 2.2 2.2.7-2.2.7-.7 2.2-.7-2.2-2.2-.7 2.2-.7z" />
  </svg>
)

export const CheckIcon = ({ size = 13, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="m5 12 5 5 9-11" />
  </svg>
)

export const DiceIcon = ({ size = 21, style, color = 'currentColor' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <rect x="4" y="4" width="16" height="16" rx="4" />
    {[[9, 9], [15, 9], [12, 12], [9, 15], [15, 15]].map(([cx, cy]) => (
      <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={1.15} fill={color} stroke="none" />
    ))}
  </svg>
)

export const HistoryIcon = ({ size = 21, style }: P) => (
  <svg {...base(size)} style={style}>
    <path d="M3.2 12a8.8 8.8 0 1 0 2.6-6.2L3.2 8.4" />
    <path d="M3.2 3.4v5h5" />
    <path d="M12 7.5V12l3.2 2" />
  </svg>
)

export const FilterIcon = ({ size = 15, style, color = 'var(--text-3)' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" style={style}>
    <path d="M4 6h16M7 12h10M10 18h4" />
  </svg>
)

export const SortIcon = ({ size = 13, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M8 5v14M8 5 5 8m3-3 3 3M16 19V5m0 14-3-3m3 3 3-3" />
  </svg>
)

export const ChevronDown = ({ size = 13, style }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const CheckMark = ({ size = 14, style, color = 'var(--accent)' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="m5 12 5 5 9-11" />
  </svg>
)

export const CameraIcon = ({ size = 15, style, color = 'currentColor' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M4 8.5a2 2 0 0 1 2-2h1.6l1.2-2h6.4l1.2 2H18a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
    <circle cx="12" cy="12.5" r="3.4" />
  </svg>
)

export const TrashIcon = ({ size = 15, style, color = 'currentColor' }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" style={style}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </svg>
)
