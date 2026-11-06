import type { CSSProperties, ReactElement } from "react";

type WayglimBackgroundProps = {
  className?: string;
  style?: CSSProperties;
  layout?: "fill" | "block";
  paused?: boolean;
  label?: string;
};

declare function WayglimBackground(props: WayglimBackgroundProps): ReactElement;
export default WayglimBackground;
