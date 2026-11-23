import { useId, type ReactNode } from "react";
import Owl, { type OwlMood } from "../app/Owl";

interface WallNoticeProps {
  mood: OwlMood;
  /** Where the owl looks sideways, from -1 to 1. */
  look?: number;
  /** Changing it draws the owl afresh, which restarts its animation, such as the drowsy lids on each retry. */
  owlKey?: number;
  title: string;
  /** Covers the wall, which keeps connecting underneath. */
  overlay?: boolean;
  children?: ReactNode;
}

/** The owl in the middle of the wall, with what the wall is doing. */
export default function WallNotice({ mood, look, owlKey, title, overlay = false, children }: WallNoticeProps) {
  const titleId = useId();
  return (
    <section className={`wall-notice${overlay ? " is-overlay" : ""}`} role="status" aria-labelledby={titleId}>
      <Owl key={owlKey} mood={mood} look={look} className="wall-notice-owl on-wall" />
      <h2 id={titleId}>{title}</h2>
      {children}
    </section>
  );
}
