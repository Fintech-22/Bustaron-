import type { OccupancyPoint } from '../../services/skyOccupancy';

/**
 * 24-hour Sky Occupancy line chart (STAGE 4 / PRD §11.2.2).
 *
 * Pure SVG — no chart library dependency. Renders a responsive 24-point
 * line chart with hour labels, a filled area under the curve, and a
 * peak marker. Theme-aware via CSS custom properties.
 */

interface SkyOccupancyChartProps {
  data: OccupancyPoint[];
}

const VIEW_W = 480;
const VIEW_H = 180;
const PAD_L = 36;
const PAD_R = 12;
const PAD_T = 16;
const PAD_B = 28;
const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;

function hourLabel(hour: number): string {
  if (hour === 0) return '00';
  if (hour === 6) return '06';
  if (hour === 12) return '12';
  if (hour === 18) return '18';
  if (hour === 23) return '23';
  return '';
}

export function SkyOccupancyChart({ data }: SkyOccupancyChartProps): JSX.Element {
  const yScale = (val: number): number => PAD_T + PLOT_H - (val / 100) * PLOT_H;
  const xScale = (i: number): number => PAD_L + (i / 23) * PLOT_W;

  // Build the polyline points.
  const linePoints = data
    .map((d, i) => `${xScale(i).toFixed(1)},${yScale(d.occupancy).toFixed(1)}`)
    .join(' ');

  // Build the area fill path (line + baseline).
  const areaPath = `M ${xScale(0).toFixed(1)},${yScale(0).toFixed(1)} L ${linePoints} L ${xScale(23).toFixed(1)},${yScale(0).toFixed(1)} Z`;

  // Peak point.
  const peakIdx = data.reduce((best, d, i) => (d.occupancy > data[best].occupancy ? i : best), 0);
  const peakX = xScale(peakIdx);
  const peakY = yScale(data[peakIdx].occupancy);

  // Grid lines at 25/50/75/100.
  const gridLines = [25, 50, 75, 100];

  return (
    <svg
      className="sky-occupancy-chart"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label="24-hour sky occupancy chart"
    >
      {/* Grid */}
      {gridLines.map((val) => (
        <g key={val}>
          <line
            x1={PAD_L}
            y1={yScale(val)}
            x2={VIEW_W - PAD_R}
            y2={yScale(val)}
            className="sky-chart__grid-line"
          />
          <text
            x={PAD_L - 6}
            y={yScale(val) + 4}
            textAnchor="end"
            className="sky-chart__axis-label"
          >
            {val}
          </text>
        </g>
      ))}

      {/* Area fill */}
      <path d={areaPath} className="sky-chart__area" />

      {/* Line */}
      <polyline
        points={linePoints}
        fill="none"
        className="sky-chart__line"
      />

      {/* Peak marker */}
      <circle
        cx={peakX}
        cy={peakY}
        r="3"
        className="sky-chart__peak-dot"
      />
      <text
        x={peakX}
        y={peakY - 8}
        textAnchor="middle"
        className="sky-chart__peak-label"
      >
        Peak {data[peakIdx].occupancy}%
      </text>

      {/* X-axis labels */}
      {[0, 6, 12, 18, 23].map((h) => (
        <text
          key={h}
          x={xScale(h)}
          y={VIEW_H - 8}
          textAnchor="middle"
          className="sky-chart__axis-label"
        >
          {hourLabel(h)}
        </text>
      ))}

      {/* Axis titles */}
      <text
        x={PAD_L + PLOT_W / 2}
        y={VIEW_H - 1}
        textAnchor="middle"
        className="sky-chart__axis-title"
      >
        Hour (HKT)
      </text>
      <text
        x={10}
        y={PAD_T + PLOT_H / 2}
        textAnchor="middle"
        transform={`rotate(-90 10 ${PAD_T + PLOT_H / 2})`}
        className="sky-chart__axis-title"
      >
        Occupancy %
      </text>
    </svg>
  );
}
