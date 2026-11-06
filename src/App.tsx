import { createRootRoute, createRoute, createRouter, lazyRouteComponent, RouterProvider } from "@tanstack/react-router";
import { RootLayout } from "@/app/layout";

const rootRoute = createRootRoute({ component: RootLayout });
const browserPage = lazyRouteComponent(() => import("@/features/browser/browser-page"), "BrowserPage");
const browserRoute = createRoute({ getParentRoute: () => rootRoute, path: "/", component: browserPage });
const unlockRoute = createRoute({ getParentRoute: () => rootRoute, path: "/unlock", component: browserPage });
const settingsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/settings", component: lazyRouteComponent(() => import("@/features/settings/settings-page"), "SettingsPage") });
const analyticsRoute = createRoute({ getParentRoute: () => rootRoute, path: "/analytics", component: lazyRouteComponent(() => import("@/features/analytics/analytics-page"), "AnalyticsPage") });
const routeTree = rootRoute.addChildren([browserRoute, unlockRoute, settingsRoute, analyticsRoute]);
const router = createRouter({ routeTree, defaultPreload: "intent" });

export default function App() {
  return <RouterProvider router={router} />;
}
