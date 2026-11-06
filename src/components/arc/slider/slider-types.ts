import type { ReactNode } from "react";

export type SliderValue = number | [number, number];
export interface SliderMark { value: number; label?: string; }

export interface SliderProps<T extends SliderValue = number> {
  /** Visible label. Range thumbs are named from it unless `thumbLabels` says otherwise. */
  label: string;
  /** A number for one thumb, a pair for a range. */
  value?: T;
  defaultValue?: T;
  onValueChange?: (value: T) => void;
  /** Runs once a drag is released or a key changes the value, for work too heavy for every step. */
  onValueCommit?: (value: T) => void;
  min?: number;
  max?: number;
  step?: number;
  /** PageUp, PageDown, and Shift with an arrow move this far. Defaults to a tenth of the range. */
  largeStep?: number;
  /** Ticks on the track. A number draws a tick; a mark with a label also prints it under the track, and clicking it moves there. */
  marks?: (number | SliderMark)[];
  /** The closest two range thumbs may sit, in steps. */
  minStepsBetweenThumbs?: number;
  /** Formats the readout, the bubble, and the spoken value. */
  format?: (value: number) => string;
  /** Show the value beside the label. The bubble over the thumb still appears while dragging or focused. */
  showValue?: boolean;
  /** Accessible names for the two range thumbs. */
  thumbLabels?: [string, string];
  /** Content beside the track, such as an icon or a mute button. */
  start?: ReactNode;
  end?: ReactNode;
  /** Submits the value with a form, one hidden input per thumb. */
  name?: string;
  disabled?: boolean;
  className?: string;
}

