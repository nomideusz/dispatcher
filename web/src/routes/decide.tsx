import { redirect } from "react-router";
import type { Route } from "./+types/decide";

// Decide split into Patterns and Candidates; old links land on the first.
export function clientLoader({ request }: Route.ClientLoaderArgs) {
  return redirect(`/patterns${new URL(request.url).search}`);
}

export default function Decide() {
  return null;
}
