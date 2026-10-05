export function DroneMark({ className = "h-56 w-56" }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 240" className={className} aria-hidden>
      <defs>
        <radialGradient id="rotor" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#e2e8f0" stopOpacity="0.2" />
          <stop offset="70%" stopColor="#22d3ee" stopOpacity="0.08" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="body" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="45%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#1e293b" />
        </linearGradient>
      </defs>
      <ellipse cx="120" cy="188" rx="46" ry="8" fill="#3b82f6" opacity="0.18" />
      {[
        [58, 58],
        [182, 58],
        [58, 168],
        [182, 168],
      ].map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <line x1="120" y1="112" x2={x} y2={y} stroke="#cbd5e1" strokeWidth="4" strokeLinecap="round" />
          <circle cx={x} cy={y} r="28" fill="url(#rotor)" />
          <circle cx={x} cy={y} r="7" fill="#e2e8f0" />
        </g>
      ))}
      <rect x="92" y="86" width="56" height="42" rx="14" fill="url(#body)" />
      <rect x="104" y="124" width="32" height="14" rx="6" fill="#0f172a" />
      <circle cx="120" cy="132" r="4" fill="#22d3ee" />
      <circle cx="120" cy="98" r="3" fill="#3b82f6" />
    </svg>
  );
}
