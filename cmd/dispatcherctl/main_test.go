package main

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestRunPayoutsSendsSessionCookieAndQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			t.Errorf("method = %s, want GET", r.Method)
		}
		if r.URL.Path != "/api/analytics/payout" || r.URL.Query().Get("days") != "7" {
			t.Errorf("URL = %s, want /api/analytics/payout?days=7", r.URL.String())
		}
		cookie, err := r.Cookie("railway_token")
		if err != nil || cookie.Value != "test-session" {
			t.Errorf("session cookie = %v, %v", cookie, err)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"series":[],"points":[]}`))
	}))
	defer server.Close()
	credentialsPath := t.TempDir() + "/credentials.json"
	if err := saveStoredSession(credentialsPath, server.URL, storedSession{
		Session: "test-session", ExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"--url", server.URL, "--config", credentialsPath, "payouts", "--days", "7"},
		func(string) string { return "" },
		&stdout,
		&stderr,
	)

	if code != 0 {
		t.Fatalf("exit code = %d, stderr = %s", code, stderr.String())
	}
	if got := stdout.String(); got != "{\n  \"series\": [],\n  \"points\": []\n}\n" {
		t.Fatalf("stdout = %q", got)
	}
}

func TestRunUsesEnvironmentAndCompactOutput(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/analytics/templates" {
			t.Errorf("path = %s", r.URL.Path)
		}
		cookie, err := r.Cookie("railway_token")
		if err != nil || cookie.Value != "from-env" {
			t.Errorf("session cookie = %v, %v", cookie, err)
		}
		_, _ = w.Write([]byte(`{ "templates": [ ] }`))
	}))
	defer server.Close()

	env := map[string]string{
		"DISPATCHER_URL": server.URL,
	}
	credentialsPath := t.TempDir() + "/credentials.json"
	env["DISPATCHER_CONFIG"] = credentialsPath
	if err := saveStoredSession(credentialsPath, server.URL, storedSession{
		Session: "from-env", ExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}
	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"--compact", "templates"},
		func(key string) string { return env[key] },
		&stdout,
		&stderr,
	)

	if code != 0 {
		t.Fatalf("exit code = %d, stderr = %s", code, stderr.String())
	}
	if got := stdout.String(); got != "{\"templates\":[]}\n" {
		t.Fatalf("stdout = %q", got)
	}
}

func TestRunHealthDoesNotRequireLogin(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "" {
			t.Errorf("unexpected Authorization header %q", got)
		}
		_, _ = w.Write([]byte(`{"status":"ok"}`))
	}))
	defer server.Close()

	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"--url", server.URL, "health"},
		func(string) string { return "" },
		&stdout,
		&stderr,
	)

	if code != 0 {
		t.Fatalf("exit code = %d, stderr = %s", code, stderr.String())
	}
}

func TestRunRequiresLoginBeforeProtectedRequest(t *testing.T) {
	var stdout, stderr bytes.Buffer
	credentialsPath := t.TempDir() + "/credentials.json"
	code := run(
		[]string{"--url", "https://dispatcher.example", "--config", credentialsPath, "summary"},
		func(string) string { return "" },
		&stdout,
		&stderr,
	)

	if code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "not logged in") {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func TestRunSurfacesDispatcherError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"error":"not authenticated"}`))
	}))
	defer server.Close()
	credentialsPath := t.TempDir() + "/credentials.json"
	if err := saveStoredSession(credentialsPath, server.URL, storedSession{
		Session: "expired-server-side", ExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatal(err)
	}

	var stdout, stderr bytes.Buffer
	code := run(
		[]string{"--url", server.URL, "--config", credentialsPath, "summary"},
		func(string) string { return "" },
		&stdout,
		&stderr,
	)

	if code != 1 {
		t.Fatalf("exit code = %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "401 Unauthorized: not authenticated") {
		t.Fatalf("stderr = %q", stderr.String())
	}
}

func TestParseCommandRejectsInvalidPayoutWindow(t *testing.T) {
	_, err := parseCommand([]string{"payouts", "--days", "0"}, &bytes.Buffer{})
	if err == nil || !strings.Contains(err.Error(), "between 1 and 365") {
		t.Fatalf("error = %v", err)
	}
}
