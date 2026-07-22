import { Navigate } from "react-router-dom";
import { legacyRedirectDecision } from "../../routing";

export function LegacyRouteRedirect({ pathname, search }: { pathname: string; search: string }) {
  const decision = legacyRedirectDecision(pathname, search);
  if (!decision) return null;
  return <Navigate {...decision} />;
}
