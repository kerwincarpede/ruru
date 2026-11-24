import { useId, type CSSProperties } from "react";
import "./owl.css";

/**
 * What the owl is doing, one per screen:
 * - `awake`: open eyes that blink now and then, with a rare double-blink or wink (the welcome screen).
 * - `scanning`: pupils sweep side to side and now and then stare straight out (looking for cameras).
 * - `counting`: pupils glance towards the camera that last connected; see `look`.
 * - `drowsy`: heavy lids that droop until the owl is remounted, such as on each retry.
 * - `puzzled`: a glance left, a glance right and a little shrug of the brows (no cameras).
 * - `closed`: shut eyes, with one eye peeking open now and then (every camera hidden).
 * - `asleep`: shut eyes, breathing brows and a drifting "z" (streams off).
 * - `dim`: small and quiet, with a slow sleepy blink (a tile with no picture).
 * - `searching`: pupils dart side to side while the eyes' glow pulses (reconnecting).
 */
export type OwlMood = "awake" | "scanning" | "counting" | "drowsy" | "puzzled" | "closed" | "asleep" | "dim" | "searching";

interface OwlProps {
  mood: OwlMood;
  /** Where the pupils look sideways, from -1 (left) to 1 (right). Used by `counting`. */
  look?: number;
  className?: string;
}

const EYES = [
  { side: "l", cx: 66 },
  { side: "r", cx: 154 },
] as const;
const CY = 86;
const R = 40;
/** The farthest the pupils move sideways inside the iris. */
const LOOK_RANGE = 13;

/** Ruru's owl: two glowing eyes under a pale brow, drawn in the theme's colours. */
export default function Owl({ mood, look = 0, className }: OwlProps) {
  const id = useId();
  const style = { "--owl-look": `${Math.max(-1, Math.min(1, look)) * LOOK_RANGE}px` } as CSSProperties;
  return (
    <svg className={["owl", `is-${mood}`, className].filter(Boolean).join(" ")} viewBox="-10 -6 240 160" style={style} aria-hidden="true">
      <defs>
        <radialGradient id={`${id}iris`} cx=".5" cy=".42" r=".58">
          <stop offset="0" stopColor="#fff0a0" />
          <stop offset=".55" stopColor="#ffc933" />
          <stop offset="1" stopColor="#e08a06" />
        </radialGradient>
        <radialGradient id={`${id}glow`}>
          <stop offset="0" stopColor="#f5b52e" />
          <stop offset="1" stopColor="#f5b52e" stopOpacity="0" />
        </radialGradient>
        {EYES.map(({ side, cx }) => (
          <clipPath key={side} id={`${id}clip-${side}`}>
            <circle cx={cx} cy={CY} r={R + 1} />
          </clipPath>
        ))}
      </defs>
      {EYES.map(({ side, cx }) => (
        <circle key={side} className="owl-glow" cx={cx} cy={CY} r="74" fill={`url(#${id}glow)`} />
      ))}
      {EYES.map(({ side, cx }) => (
        <g key={side} className={`owl-side owl-${side}`}>
          <g className="owl-eye">
            <circle cx={cx} cy={CY} r={R} fill={`url(#${id}iris)`} />
            <g className="owl-pupil">
              <circle cx={cx} cy={CY + 2} r="24" fill="#0b0b0c" />
              <circle cx={cx + 9} cy={CY - 9} r="7" fill="#fff" />
            </g>
            <g clipPath={`url(#${id}clip-${side})`}>
              <path className="owl-lid" d={`M${cx - R - 2} ${CY - R - 4} H${cx + R + 2} V${CY - 6} Q${cx} ${CY + 8} ${cx - R - 2} ${CY - 6} Z`} />
            </g>
          </g>
          <path className="owl-lash" d={`M${cx - 30} ${CY + 2} Q${cx} ${CY + 20} ${cx + 30} ${CY + 2}`} />
        </g>
      ))}
      <g className="owl-brows">
        <path className="owl-brow" d="M14 44 Q66 14 104 64" />
        <path className="owl-brow" d="M206 44 Q154 14 116 64" />
      </g>
      <path className="owl-beak" d="M103 116 L117 116 L110 136 Z" />
      <text className="owl-z" x="200" y="40">
        z
      </text>
    </svg>
  );
}
