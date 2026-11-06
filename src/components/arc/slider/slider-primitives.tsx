"use client";

import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform, type MotionStyle, type MotionValue, type Variants } from "motion/react";
import { motionTokens } from "../lib/motion-tokens";
import styles from "./slider.module.css";

type Part = { key: string; digit: number } | { key: string; text: string };
export const { spring, duration, blur } = motionTokens;
const enterEase = [...motionTokens.ease.enter] as [number, number, number, number];
const exitEase = [...motionTokens.ease.standard] as [number, number, number, number];
const DIGITS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
/** Motion drops velocity on time-defined springs, so anything a gesture hands off to runs the same spring written as stiffness and damping.
 *  Positions are percentages of the track, so the rest thresholds are set far below a pixel. */
const physical = ({ visualDuration, bounce }: { visualDuration: number; bounce: number }) => { const root = (2 * Math.PI) / (visualDuration * 1.2); return { type: "spring" as const, stiffness: root * root, damping: 2 * (1 - bounce) * root, restDelta: .002, restSpeed: .02 }; };
export const thumbSpring = physical(spring.snappy);
export const kickSpring = physical(spring.morph);
/** Pixels of rubber-band travel past a limit, the velocity of a key press at a limit, and the pixel size of a step that release momentum may choose. */
export const STRETCH = 9, BUMP_PX = 150, SNAP_PX = 12;
/** iOS style resistance: travel past a limit gives less and less, and never more than `limit` pixels. */
export const rubber = (distance: number, limit = STRETCH) => Math.sign(distance) * (1 - 1 / (Math.abs(distance) * .55 / limit + 1)) * limit;
/** Where a release is heading, from a scroll-like deceleration (rate .99), in the same units as the velocity. */
export const project = (velocity: number) => velocity * .099;
export const decimalsOf = (value: number) => (String(value).split(".")[1] ?? "").length;
export const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const isDigit = (char: string) => char >= "0" && char <= "9";

/** Digits are keyed by place value and the text around them by side, so $950 → $1,000 opens a column and a comma while the rest roll. */
function partsOf(text: string): Part[] {
  const chars = [...text];
  const first = chars.findIndex(isDigit);
  const last = chars.length - 1 - [...chars].reverse().findIndex(isDigit);
  let place = chars.filter(isDigit).length;
  return chars.map((char, index): Part => {
    if (first < 0 || index < first) return { key: `p${index}${char}`, text: char };
    if (index > last) return { key: `s${chars.length - index}${char}`, text: char };
    if (isDigit(char)) return { key: `d${--place}`, digit: Number(char) };
    return { key: `g${place}${char}`, text: char };
  });
}

/* A new column opens its width while it rises in the direction of change; a leaving one closes on a spring that never passes zero. */
const slot: Variants = {
  enter: (direction: number) => ({ width: 0, scale: .6, opacity: 0, y: `${direction * .3}em`, filter: `blur(${blur.soft}px)` }),
  center: { width: "auto", scale: 1, opacity: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" }, transition: { width: spring.morph, scale: spring.morph, opacity: spring.morph, y: spring.snappy, filter: { duration: duration.standard, ease: enterEase } } },
  exit: (direction: number) => ({ width: 0, scale: .6, opacity: 0, y: `${direction * -.3}em`, filter: `blur(${blur.subtle}px)`, transition: { width: spring.smooth, scale: spring.smooth, y: { duration: duration.fast, ease: exitEase }, opacity: { duration: duration.instant }, filter: { duration: duration.instant } } }),
};
/* Reduced motion keeps a short fade and no travel. Its resting state matches `slot`, so either branch hydrates the same markup. */
const still: Variants = { enter: { width: "auto", scale: 1, opacity: 0, y: 0, filter: "none" }, center: { width: "auto", scale: 1, opacity: 1, y: 0, filter: "none", transition: { duration: duration.instant } }, exit: { width: 0, opacity: 0, transition: { duration: 0 } } };

/** One digit on the wheel. Its distance from the wheel position sets where it sits, how clear it is, and whether it shows. */
function Glyph({ position, digit }: { position: MotionValue<number>; digit: number }) {
  const offset = (current: number) => ((((digit - current) % 10) + 15) % 10) - 5;
  const y = useTransform(position, current => `${offset(current) * 1.05}em`);
  const opacity = useTransform(position, current => Math.max(0, 1 - Math.abs(offset(current)) ** 1.5 * 1.1));
  const visibility = useTransform(position, current => Math.abs(offset(current)) >= 1 ? "hidden" : "visible");
  const filter = useTransform(position, current => { const distance = Math.abs(offset(current)); return distance < .02 || distance >= 1 ? "none" : `blur(${(distance * blur.soft * .75).toFixed(2)}px)`; });
  return <motion.span className={styles.glyph} style={{ y, opacity, filter, visibility }}>{digit}</motion.span>;
}

/** An odometer wheel. It turns the way the value moved, wraps 9 → 0, and retargets mid spin while a drag keeps it busy. */
function Wheel({ digit, direction }: { digit: number; direction: number }) {
  const reduced = useReducedMotion();
  const position = useMotionValue(digit);
  const wheel = useRef({ digit, target: digit });
  useLayoutEffect(() => {
    const state = wheel.current;
    if (state.digit === digit) return;
    state.target += direction > 0 ? (digit - state.digit + 10) % 10 : -((state.digit - digit + 10) % 10);
    state.digit = digit;
    if (reduced) position.jump(state.target);
    else animate(position, state.target, thumbSpring);
  }, [digit, direction, position, reduced]);
  return <><span className={styles.sizer}>0</span>{DIGITS.map(item => <Glyph key={item} position={position} digit={item} />)}</>;
}

/** A formatted value whose digits roll in the direction it moved and whose width follows new columns on a spring. */
export function RollingNumber({ value, text }: { value: number; text: string }) {
  const reduced = useReducedMotion();
  const [trail, setTrail] = useState({ value, direction: 1 });
  if (trail.value !== value) setTrail({ value, direction: value > trail.value ? 1 : -1 });
  const direction = trail.value === value ? trail.direction : value > trail.value ? 1 : -1;
  return <span className={styles.number}><AnimatePresence initial={false} custom={direction}>{partsOf(text).map(part => <motion.span key={part.key} className={"digit" in part ? styles.column : styles.symbol} custom={direction} variants={reduced ? still : slot} initial="enter" animate="center" exit="exit">
    {"digit" in part ? <Wheel digit={part.digit} direction={direction} /> : part.text}
  </motion.span>)}</AnimatePresence></span>;
}

const bubbleIn = { opacity: 0, scale: .6, y: 6, filter: `blur(${blur.subtle}px)` };
const bubbleRest = { opacity: 1, scale: 1, y: 0, filter: "blur(0px)", transitionEnd: { filter: "none" } };
const bubbleOut = { opacity: 0, scale: .8, y: 4, filter: `blur(${blur.subtle}px)`, transition: { duration: duration.instant, ease: exitEase } };
const bubbleEnter = { ...spring.snappy, opacity: { duration: duration.fast, ease: enterEase }, filter: { duration: duration.fast, ease: enterEase } };

interface ThumbProps { quiet: boolean; index: number; shown: MotionValue<number>; value: number; text: string; low: number; high: number; ariaLabel?: string; labelledBy?: string; active: boolean; lifted: boolean; bubble: boolean; disabled?: boolean; onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void; onFocus: (event: FocusEvent<HTMLDivElement>) => void; onBlur: () => void; }

/** The thumb rides a layer as wide as the track, so a percentage transform places it with no measuring, on the server too. */
export function Thumb({ quiet, index, shown, value, text, low, high, ariaLabel, labelledBy, active, lifted, bubble, disabled, onKeyDown, onFocus, onBlur }: ThumbProps) {
  const reduced = useReducedMotion();
  const x = useTransform(shown, current => `${current - 100}%`);
  return <motion.div className={styles.thumbLayer} style={{ x, zIndex: active ? 2 : 1 }}>
    <motion.div role="slider" data-thumb="" data-index={index} data-active={lifted || undefined} data-quiet={quiet || undefined} className={styles.thumb} tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : labelledBy} aria-valuemin={low} aria-valuemax={high} aria-valuenow={value} aria-valuetext={text} aria-orientation="horizontal" aria-disabled={disabled || undefined}
      initial={false} animate={{ scale: lifted ? 1.16 : 1 }} transition={reduced ? { duration: 0 } : spring.snappy} onKeyDown={onKeyDown} onFocus={onFocus} onBlur={onBlur} />
    <motion.span className={styles.bubbleAnchor} style={{ "--at": shown } as MotionStyle}>
      <AnimatePresence>{bubble && <motion.span key="bubble" className={styles.bubble} aria-hidden="true" initial={reduced ? { opacity: 0 } : bubbleIn} animate={bubbleRest} exit={reduced ? { opacity: 0, transition: { duration: duration.instant } } : bubbleOut} transition={reduced ? { duration: duration.instant } : bubbleEnter}>
        <RollingNumber value={value} text={text} />
      </motion.span>}</AnimatePresence>
    </motion.span>
  </motion.div>;
}

