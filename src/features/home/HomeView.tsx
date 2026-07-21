import type { ReactNode } from "react";

export function HomeView({ children }: { children: ReactNode }) {
  return <div className="product-feature product-feature--home">{children}</div>;
}
