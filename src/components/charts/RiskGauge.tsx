import type { RiskScoreResult } from '../../services/riskScore';

/**
 * Hong Kong Airspace Risk Score — dial gauge (STAGE 4 / PRD §11.2.2).
 *
 * Pure SVG semicircular gauge, 0–100. The needle rotates to the score,
 * and the arc fills to the same position with a colour matching the
 * risk label. Theme-aware via CSS custom properties.
 */

interface RiskGaugeProps {
  risk: RiskScoreResult;
}

const CX = 100;
const CY = 95;
const R = 78;
const START_DEG = -90; // left
const END_DEG = 90;    // right
const SWEEP = END_DEG - START_DEG;

function polarToCart(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  const start = polarToCart(cx, cy, r, fromDeg);
  const end = polarToCart(cx, cy, r, toDeg);
  const largeArc = toDeg - fromDeg > 180 ? 1 : 0;
  return `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

export function RiskGauge({ risk }: RiskGaugeProps): JSX.Element {
  const scoreDeg = START_DEG + (risk.score / 100) * SWEEP;
  const needleEnd = polarToCart(CX, CY, R - 8, scoreDeg);

  // Tick marks at 0, 25, 50, 75, 100.
  const ticks = [0, 25, 50, 75, 100].map((val) => {
    const deg = START_DEG + (val / 100) * SWEEP;
    const outer = polarToCart(CX, CY, R + 2, deg);
    const inner = polarToCart(CX, CY, R - 6, deg);
    return { val, x1: outer.x, y1: outer.y, x2: inner.x, y2: inner.y };
  });

  return (
    <svg
      className="risk-gauge"
      viewBox="0 0 200 130"
      preserveAspectRatio="xMidYMid meet"
      role="group"
      aria-label={`Hong Kong Airspace Risk Score: ${risk.score} — ${risk.label}`}
    >
      {/* Background arc */}
      <path
        d={arcPath(CX, CY, R, START_DEG, END_DEG)}
        fill="none"
        className="risk-gauge__track"
        strokeWidth="10"
        strokeLinecap="round"
      />

      {/* Filled arc to score */}
      <path
        d={arcPath(CX, CY, R, START_DEG, scoreDeg)}
        fill="none"
        stroke={risk.color}
        strokeWidth="10"
        strokeLinecap="round"
        className="risk-gauge__fill"
      />

      {/* Tick marks */}
      {ticks.map((t) => (
        <line
          key={t.val}
          x1={t.x1}
          y1={t.y1}
          x2={t.x2}
          y2={t.y2}
          className="risk-gauge__tick"
        />
      ))}

      {/* Tick labels */}
      {ticks.map((t) => {
        const labelPos = polarToCart(CX, CY, R + 12, START_DEG + (t.val / 100) * SWEEP);
        return (
          <text
            key={t.val}
            x={labelPos.x}
            y={labelPos.y + 4}
            textAnchor="middle"
            className="risk-gauge__tick-label"
          >
            {t.val}
          </text>
        );
      })}

      {/* Needle */}
      <line
        x1={CX}
        y1={CY}
        x2={needleEnd.x}
        y2={needleEnd.y}
        className="risk-gauge__needle"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <circle cx={CX} cy={CY} r="5" className="risk-gauge__hub" />

      {/* Center score text */}
      <text
        x={CX}
        y={CY + 26}
        textAnchor="middle"
        className="risk-gauge__score-value"
        style={{ fill: risk.color }}
      >
        {risk.score}
      </text>
      <text
        x={CX}
        y={CY + 40}
        textAnchor="middle"
        className="risk-gauge__score-label"
      >
        {risk.label} Risk
      </text>
    </svg>
  );
}
