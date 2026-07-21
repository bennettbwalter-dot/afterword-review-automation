import { Navigate } from "react-router-dom";
import { parseWorkspaceRoute, workspaceRoute } from "../../routing";

export function LegacyRouteRedirect({ pathname, search }: { pathname: string; search: string }) {
  const route = parseWorkspaceRoute(pathname, search);
  if (!route?.legacy) return null;
  return <Navigate to={workspaceRoute(route.view, route, search)} replace />;
}
