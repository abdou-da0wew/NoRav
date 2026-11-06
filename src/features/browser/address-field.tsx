"use client";

import { forwardRef, useId, useRef } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "@phosphor-icons/react/X";
import { motionTokens } from "@/components/arc/lib/motion-tokens";
import styles from "./address-field.module.css";

export interface AddressFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  leadingIcon?: ReactNode;
  variant?: "toolbar" | "hero";
}

export const AddressField = forwardRef<HTMLInputElement, AddressFieldProps>(
  function AddressField(
    {
      label,
      value,
      onValueChange,
      leadingIcon,
      variant = "hero",
      id,
      className,
      ...props
    },
    ref,
  ) {
    const generatedId = useId();
    const controlId = id ?? generatedId;
    const reduced = useReducedMotion();
    const inputRef = useRef<HTMLInputElement | null>(null);

    const setRefs = (node: HTMLInputElement | null) => {
      inputRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    };

    function clear() {
      onValueChange("");
      inputRef.current?.focus();
    }

    return (
      <div
        className={[styles.field, className].filter(Boolean).join(" ")}
        data-variant={variant}
        data-filled={value ? "true" : undefined}
      >
        <label className={styles.label} htmlFor={controlId}>
          {label}
        </label>
        <div className={styles.control}>
          {leadingIcon ? (
            <span className={styles.leadingIcon} aria-hidden="true">
              {leadingIcon}
            </span>
          ) : null}
          <input
            {...props}
            ref={setRefs}
            id={controlId}
            type="search"
            value={value}
            onChange={(event) => onValueChange(event.target.value)}
            className={styles.input}
          />
          <span className={styles.clearSlot}>
            <AnimatePresence initial={false}>
              {value ? (
                <motion.button
                  key="clear"
                  className={styles.clearButton}
                  type="button"
                  tabIndex={0}
                  onClick={clear}
                  aria-label="Clear website address"
                  initial={
                    reduced
                      ? { opacity: 0 }
                      : {
                          opacity: 0,
                          scale: 0.8,
                          filter: `blur(${motionTokens.blur.subtle}px)`,
                        }
                  }
                  animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
                  exit={
                    reduced
                      ? { opacity: 0, transition: { duration: 0 } }
                      : {
                          opacity: 0,
                          scale: 0.8,
                          filter: `blur(${motionTokens.blur.subtle}px)`,
                          transition: {
                            duration: motionTokens.duration.instant,
                            ease: [...motionTokens.ease.standard],
                          },
                        }
                  }
                  whileTap={
                    reduced
                      ? undefined
                      : {
                          scale: 0.96,
                          transition: {
                            duration: motionTokens.duration.instant,
                            ease: [...motionTokens.ease.standard],
                          },
                        }
                  }
                  transition={
                    reduced
                      ? { duration: motionTokens.duration.instant }
                      : {
                          ...motionTokens.spring.snappy,
                          opacity: { duration: motionTokens.duration.fast },
                          filter: { duration: motionTokens.duration.fast },
                        }
                  }
                >
                  <X size={15} aria-hidden="true" />
                </motion.button>
              ) : null}
            </AnimatePresence>
          </span>
        </div>
      </div>
    );
  },
);

AddressField.displayName = "AddressField";
