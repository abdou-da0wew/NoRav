import type { ReactNode } from "react";

export function PageHeading({ title, description, icon }: {
  title: string;
  description: string;
  icon: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div className="page-heading-icon">{icon}</div>
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
    </div>
  );
}
