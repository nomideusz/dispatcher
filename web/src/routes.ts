import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

export default [
  layout("routes/protected.tsx", [
    index("routes/analytics.tsx"),
    route("decide", "routes/decide.tsx"),
    route("payouts", "routes/payouts.tsx"),
  ]),
] satisfies RouteConfig;
