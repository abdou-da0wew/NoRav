type FigureProps = { className?: string };

export function RouteHairline({ className = "" }: FigureProps) {
  return (
    <div className={`custom-hairline custom-route ${className}`} tabIndex={0} role="img" aria-label="A request moving through a private routing gateway to its destination">
      <svg viewBox="0 0 400 230" aria-hidden="true">
        <path className="figure-edge figure-edge-soft" d="M56 152 122 114 190 152 258 113 328 153" />
        <path className="figure-edge figure-edge-soft" d="M122 114V76l68-39 68 39v37" />
        <path className="figure-edge" d="M56 152v28l68 39 68-39 66 39 70-39v-27" />
        <path className="figure-edge" d="M122 114v28l68 39 68-39v-29" />
        <path className="figure-edge figure-edge-bright" d="m56 152 66-38 68 38 68-39 70 40" />
        <path className="figure-edge figure-edge-soft" d="M190 37v29l68 39" />
        <path className="figure-edge" d="M87 134v-24l35-20 35 20v24" />
        <path className="figure-edge" d="M224 135v-24l34-20 35 20v24" />
        <path className="figure-edge" d="M173 139v-27l17-10 17 10v27" />
        <circle className="figure-node" cx="56" cy="152" r="5" />
        <circle className="figure-node" cx="190" cy="152" r="5" />
        <circle className="figure-node" cx="328" cy="153" r="5" />
        <circle className="figure-highlight" cx="190" cy="152" r="7" />
        <path className="figure-edge figure-edge-accent" d="m178 112 12-7 12 7" />
      </svg>
      <span className="figure-caption">ROUTE · INSPECT · DELIVER</span>
    </div>
  );
}

export function SessionHairline({ className = "" }: FigureProps) {
  return (
    <div className={`custom-hairline custom-session ${className}`} tabIndex={0} role="img" aria-label="An isolated browsing session represented by a sealed layered document">
      <svg viewBox="0 0 400 230" aria-hidden="true">
        <path className="figure-edge figure-edge-soft" d="m68 72 90-52 91 52-90 53z" />
        <path className="figure-edge" d="M68 72v86l91 52 90-52V72" />
        <path className="figure-edge" d="M159 125v85M68 158l91 52 90-52" />
        <path className="figure-edge figure-edge-soft" d="m93 88 65-38 65 38-65 38z" />
        <path className="figure-edge" d="m250 83 42-24 41 24v49l-41 24-42-24z" />
        <path className="figure-edge figure-edge-accent" d="M275 83V68c0-13 7-20 17-20s17 7 17 20v15" />
        <path className="figure-edge" d="M267 84h51v39l-25 15-26-15z" />
        <circle className="figure-highlight" cx="293" cy="104" r="5" />
        <path className="figure-edge figure-edge-soft" d="m283 115 10 7 10-7" />
        <path className="figure-edge figure-edge-soft" d="M115 96v54m22-66v66" />
      </svg>
      <span className="figure-caption">ONE SESSION · SERVER-SIDE STATE</span>
    </div>
  );
}
