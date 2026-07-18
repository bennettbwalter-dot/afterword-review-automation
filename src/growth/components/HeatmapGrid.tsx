import { rankColor } from '../data/mock'

export default function HeatmapGrid({ grid, water = false }: { grid: (number | null)[][]; water?: boolean }) {
  const cols = grid[0].length
  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200" style={{ background: '#efede4' }}>
      <svg className="absolute inset-0 h-full w-full" preserveAspectRatio="none" viewBox="0 0 400 300">
        {[38, 92, 148, 208, 262, 330].map((x) => (
          <line key={`v${x}`} x1={x} y1={0} x2={x + 22} y2={300} stroke="#ffffff" strokeWidth={5} opacity={0.9} />
        ))}
        {[48, 108, 168, 228, 282].map((y) => (
          <line key={`h${y}`} x1={0} y1={y} x2={400} y2={y - 16} stroke="#ffffff" strokeWidth={4} opacity={0.85} />
        ))}
        <line x1={0} y1={232} x2={400} y2={118} stroke="#f6c99f" strokeWidth={7} opacity={0.8} />
        <rect x={214} y={38} width={62} height={42} fill="#dce7d2" opacity={0.9} />
        <rect x={58} y={182} width={52} height={36} fill="#dce7d2" opacity={0.9} />
        {water && <path d="M 0 300 L 400 300 L 400 258 C 300 248 140 286 0 264 Z" fill="#bfdcf0" />}
      </svg>
      <div className="relative grid gap-1 p-2.5" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {grid.flatMap((row, r) =>
          row.map((v, c) =>
            v === null ? (
              <span key={`${r}-${c}`} className="mx-auto h-6 w-6 rounded-full bg-slate-400/50" />
            ) : (
              <span
                key={`${r}-${c}`}
                className="mx-auto grid h-6 w-6 place-items-center rounded-full text-[9px] font-bold shadow-sm"
                style={{ background: rankColor(v), color: v <= 2 || v >= 16 ? '#fff' : '#17240f' }}
              >
                {v > 20 ? '20+' : v}
              </span>
            ),
          ),
        )}
      </div>
    </div>
  )
}
