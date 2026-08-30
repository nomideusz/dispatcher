package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultDispatcherURL = "http://localhost:8090"

var version = "dev"

type command struct {
	method       string
	path         string
	requiresAuth bool
}

func main() {
	os.Exit(run(os.Args[1:], os.Getenv, os.Stdout, os.Stderr))
}

func run(args []string, getenv func(string) string, stdout, stderr io.Writer) int {
	return runWithBrowser(args, getenv, stdout, stderr, openBrowser)
}

func runWithBrowser(args []string, getenv func(string) string, stdout, stderr io.Writer, openURL func(string) error) int {
	flags := flag.NewFlagSet("dispatcherctl", flag.ContinueOnError)
	flags.SetOutput(stderr)
	baseURL := flags.String("url", envOr(getenv, "DISPATCHER_URL", defaultDispatcherURL), "Dispatcher instance URL")
	configPath := flags.String("config", getenv("DISPATCHER_CONFIG"), "credentials file path")
	compact := flags.Bool("compact", false, "emit compact JSON")
	timeout := flags.Duration("timeout", 90*time.Second, "HTTP request timeout")
	flags.Usage = func() { printUsage(stderr) }
	if err := flags.Parse(args); err != nil {
		return 2
	}

	rest := flags.Args()
	if len(rest) == 0 {
		printUsage(stderr)
		return 2
	}
	if rest[0] == "help" {
		printUsage(stdout)
		return 0
	}
	if rest[0] == "version" {
		fmt.Fprintln(stdout, version)
		return 0
	}
	if *timeout <= 0 {
		fmt.Fprintln(stderr, "error: timeout must be greater than zero")
		return 2
	}

	client, err := newAPIClient(*baseURL, "", *timeout)
	if err != nil {
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 2
	}
	if rest[0] == "login" {
		if len(rest) != 1 {
			fmt.Fprintln(stderr, "error: login takes no arguments")
			return 2
		}
		credentialsPath, err := resolveCredentialsPath(*configPath)
		if err != nil {
			fmt.Fprintf(stderr, "error: %v\n", err)
			return 2
		}
		ctx, cancel := context.WithTimeout(context.Background(), loginTimeout)
		defer cancel()
		if err := login(ctx, client, credentialsPath, stdout, openURL); err != nil {
			fmt.Fprintf(stderr, "error: %v\n", err)
			return 1
		}
		return 0
	}
	if rest[0] == "logout" {
		if len(rest) != 1 {
			fmt.Fprintln(stderr, "error: logout takes no arguments")
			return 2
		}
		credentialsPath, err := resolveCredentialsPath(*configPath)
		if err != nil {
			fmt.Fprintf(stderr, "error: %v\n", err)
			return 2
		}
		if err := removeStoredSession(credentialsPath, client.baseURL); err != nil {
			fmt.Fprintf(stderr, "error: %v\n", err)
			return 1
		}
		fmt.Fprintf(stdout, "Logged out of %s.\n", client.baseURL)
		return 0
	}

	cmd, err := parseCommand(rest, stderr)
	if err != nil {
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 2
	}
	if cmd.requiresAuth {
		credentialsPath, err := resolveCredentialsPath(*configPath)
		if err != nil {
			fmt.Fprintf(stderr, "error: %v\n", err)
			return 2
		}
		session, ok, err := loadStoredSession(credentialsPath, client.baseURL, time.Now())
		if err != nil {
			fmt.Fprintf(stderr, "error: %v\n", err)
			return 1
		}
		if !ok {
			fmt.Fprintf(stderr, "error: not logged in to %s (run dispatcherctl --url %s login)\n", client.baseURL, client.baseURL)
			return 1
		}
		client.session = session.Session
	}
	body, err := client.request(context.Background(), cmd.method, cmd.path)
	if err != nil {
		fmt.Fprintf(stderr, "error: %v\n", err)
		return 1
	}
	if err := writeOutput(stdout, body, *compact); err != nil {
		fmt.Fprintf(stderr, "error: write output: %v\n", err)
		return 1
	}
	return 0
}

func parseCommand(args []string, stderr io.Writer) (command, error) {
	simple := map[string]command{
		"health":            {method: http.MethodGet, path: "/api/health"},
		"whoami":            {method: http.MethodGet, path: "/api/auth/me", requiresAuth: true},
		"summary":           {method: http.MethodGet, path: "/api/analytics/summary", requiresAuth: true},
		"templates":         {method: http.MethodGet, path: "/api/analytics/templates", requiresAuth: true},
		"notifications":     {method: http.MethodGet, path: "/api/notify/targets", requiresAuth: true},
		"withdraw-settings": {method: http.MethodGet, path: "/api/withdraw/settings", requiresAuth: true},
		"withdraw-accounts": {method: http.MethodGet, path: "/api/withdraw/accounts", requiresAuth: true},
		"refresh":           {method: http.MethodPost, path: "/api/analytics/refresh", requiresAuth: true},
	}
	if cmd, ok := simple[args[0]]; ok {
		if len(args) != 1 {
			return command{}, fmt.Errorf("%s takes no arguments", args[0])
		}
		return cmd, nil
	}

	switch args[0] {
	case "payouts":
		payoutFlags := flag.NewFlagSet("payouts", flag.ContinueOnError)
		payoutFlags.SetOutput(stderr)
		days := payoutFlags.Int("days", 30, "history window in days (1-365)")
		if err := payoutFlags.Parse(args[1:]); err != nil {
			return command{}, err
		}
		if payoutFlags.NArg() != 0 {
			return command{}, fmt.Errorf("payouts takes no positional arguments")
		}
		if *days < 1 || *days > 365 {
			return command{}, fmt.Errorf("days must be between 1 and 365")
		}
		return command{
			method:       http.MethodGet,
			path:         "/api/analytics/payout?days=" + strconv.Itoa(*days),
			requiresAuth: true,
		}, nil
	case "get":
		if len(args) != 2 {
			return command{}, fmt.Errorf("get requires exactly one API path")
		}
		path := args[1]
		if strings.ContainsAny(path, "\r\n") || strings.Contains(path, "://") {
			return command{}, fmt.Errorf("get expects a path, not a URL")
		}
		if !strings.HasPrefix(path, "/") {
			path = "/api/" + path
		}
		return command{method: http.MethodGet, path: path, requiresAuth: true}, nil
	default:
		return command{}, fmt.Errorf("unknown command %q (run dispatcherctl help)", args[0])
	}
}

func envOr(getenv func(string) string, key, fallback string) string {
	if value := getenv(key); value != "" {
		return value
	}
	return fallback
}

func resolveCredentialsPath(configured string) (string, error) {
	if strings.TrimSpace(configured) != "" {
		return configured, nil
	}
	return defaultCredentialsPath()
}

func printUsage(w io.Writer) {
	fmt.Fprint(w, `Usage:
  dispatcherctl [flags] <command>

Flags:
  --url URL          Dispatcher instance (env: DISPATCHER_URL)
  --config PATH      Credentials file (env: DISPATCHER_CONFIG)
  --compact          Emit compact JSON
  --timeout DURATION HTTP timeout (default: 1m30s)

Query commands:
  health                   Check whether the instance and database are up
  whoami                   Show the authenticated Railway user
  summary                  Show the latest analytics totals
  templates                List current template analytics
  payouts [--days N]       Show payout history (default: 30 days)
  notifications            List notification targets
  withdraw-settings        Show auto-withdraw settings
  withdraw-accounts        List payout destinations and balance
  get PATH                 GET any authenticated API path

Other commands:
  login                    Authenticate through Dispatcher and Railway OAuth
  logout                   Remove the saved session for this instance
  refresh                  Collect a fresh analytics snapshot
  version                  Print the CLI version
  help                     Show this help
`)
}
