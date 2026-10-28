import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/protected.tsx", [
    index("routes/analytics.tsx"),
    route("templates", "routes/templates.tsx"),
    route("upgrades", "routes/upgrades.tsx"),
    route("patterns", "routes/patterns.tsx"),
    route("candidates", "routes/candidates.tsx"),
    route("search", "routes/search.tsx"),
    route("decide", "routes/decide.tsx"),
    route("payouts", "routes/payouts.tsx"),
  ]),
] satisfies RouteConfig;
