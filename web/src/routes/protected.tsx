import { ChevronDown, LogOut, RefreshCw } from "lucide-react";
import { Link, Outlet, useRevalidator } from "react-router";
import { AutoWithdraw } from "~/components/auto-withdraw-dialog";
import { Wordmark } from "~/components/brand";
import { NotificationsDialog } from "~/components/notifications-dialog";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "~/components/ui/dropdown-menu";
import { api } from "~/lib/api";
import { useRefreshAnalytics } from "~/queries/analytics";
import { getApiHealth, getMe, type User } from "~/queries/me";
import type { Route } from "./+types/protected";

export async function clientLoader() {
  const [user, apiUp] = await Promise.all([getMe(), getApiHealth()]);
  return { user, apiUp };
}

export default function Protected({ loaderData }: Route.ComponentProps) {
  if (!loaderData.user) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="w-full max-w-sm">
          <CardHeader>
            <CardTitle>
              <Wordmark />
            </CardTitle>
            <CardDescription>
              Kickback, health, and withdrawals for the templates you publish
              on Railway.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {loaderData.apiUp ? (
              <Button
                className="w-full"
                nativeButton={false}
                render={<a href="/api/auth/redirect" />}
              >
                Sign in with Railway
              </Button>
            ) : (
              <>
                <p className="text-sm text-destructive">
                  The API isn&apos;t running, so sign-in can&apos;t start.
                </p>
                <p className="text-sm text-muted-foreground">
                  In a second terminal from the repo root, run{" "}
                  <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
                    make dev-api
                  </code>{" "}
                  then refresh this page.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }
  return (
    <>
      <Header user={loaderData.user} />
      <Outlet context={loaderData.user} />
    </>
  );
}

// RefreshButton collects a fresh template snapshot on demand — mainly for a
// first sign-in, when the hourly collector hasn't produced any data yet.
function RefreshButton() {
  const refresh = useRefreshAnalytics();
  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label="Refresh data"
      title="Refresh data"
      onClick={() => refresh.mutate()}
      disabled={refresh.isPending}
    >
      <RefreshCw className={refresh.isPending ? "animate-spin" : undefined} />
    </Button>
  );
}

function Header({ user }: { user: User }) {
  const revalidator = useRevalidator();

  const signOut = async () => {
    await api.post("auth/logout", { throwHttpErrors: false });
    revalidator.revalidate();
  };

  return (
    <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur-sm">
      <div className="shell flex items-center justify-between py-3">
        <Link to="/" className="text-foreground">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-3">
          <RefreshButton />
          <NotificationsDialog />
          <AutoWithdraw />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" />}>
              {user.avatar && (
                <img src={user.avatar} alt="" className="size-5 rounded-full" />
              )}
              {user.name}
              <ChevronDown className="text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <span className="block text-sm font-medium text-foreground">
                    {user.name}
                  </span>
                  <span className="block font-normal">{user.email}</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={signOut}>
                  <LogOut />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
