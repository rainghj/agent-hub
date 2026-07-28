import type { CSSProperties } from 'react'

/**
 * 统一描边风格的 SVG 图标库。
 * 所有图标都采用 1.5 strokeWidth、圆角、round line cap，与设计稿一致。
 * 颜色通过 currentColor 继承，方便通过 CSS 控制。
 */

type IconProps = {
  size?: number
  className?: string
  style?: CSSProperties
}

const baseProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  xmlns: 'http://www.w3.org/2000/svg',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

/* ── 标题栏 ── */

export function LogoIcon({ size = 18, className, style }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <rect x="3" y="3" width="18" height="18" rx="4" fill="currentColor" fillOpacity="0.15" />
      <path d="M8 12h8M12 8v8" />
    </svg>
  )
}

export function MinimizeIcon({ size = 14, className, style }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function MaximizeIcon({ size = 14, className, style }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <rect x="6" y="6" width="12" height="12" rx="1" />
    </svg>
  )
}

export function CloseIcon({ size = 14, className, style }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  )
}

/* ── Sidebar ── */

export function SearchIcon({ size = 14, className, style }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <circle cx="11" cy="11" r="6" />
      <line x1="15.5" y1="15.5" x2="20" y2="20" />
    </svg>
  )
}

export function FolderIcon({ size = 16, className, style, filled = false }: IconProps & { filled?: boolean }) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <path
        d="M3 7.5C3 6.67 3.67 6 4.5 6h3.67L10 7.5h9.5c.83 0 1.5.67 1.5 1.5v8c0 .83-.67 1.5-1.5 1.5h-15C3.67 19 3 18.33 3 17.5v-10z"
        fill={filled ? 'currentColor' : 'none'}
        fillOpacity={filled ? 0.12 : 0}
      />
    </svg>
  )
}

export function FileIcon({ size = 14, className, style }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <polyline points="14 3 14 9 20 9" />
    </svg>
  )
}

export function ChevronRightIcon({ size = 12, className, style }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <polyline points="9 6 15 12 9 18" />
    </svg>
  )
}

export function ChevronDownIcon({ size = 12, className, style }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function PlusIcon({ size = 14, className, style }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

export function TerminalGlyph({ size = 14, className, style }: IconProps) {
  return (
    <svg {...baseProps(size)} className={className} style={style}>
      <polyline points="4 7 8 11 4 15" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </svg>
  )
}

export function DotIcon({ size = 8, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 8 8" className={className} style={style} fill="currentColor">
      <circle cx="4" cy="4" r="3" />
    </svg>
  )
}