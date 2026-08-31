package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"
)

func TestStoredSessionRoundTripAndExpiry(t *testing.T) {
	path := t.TempDir() + "/dispatcher/credentials.json"
	now := time.Date(2026, time.August, 30, 12, 0, 0, 0, time.UTC)
	want := storedSession{Session: "oauth-session", ExpiresAt: now.Add(time.Hour)}
	if err := saveStoredSession(path, "https://one.example", want); err != nil {
		t.Fatal(err)
	}
	got, ok, err := loadStoredSession(path, "https://one.example", now)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || got != want {
		t.Fatalf("session = %+v, %v; want %+v, true", got, ok, want)
	}
	instance, ok, err := loadStoredURL(path)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || instance != "https://one.example" {
		t.Fatalf("stored URL = %q, %v", instance, ok)
	}
	if _, ok, err := loadStoredSession(path, "https://one.example", now.Add(time.Hour)); err != nil || ok {
		t.Fatalf("expired session: ok = %v, err = %v", ok, err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("credentials mode = %o, want 600", info.Mode().Perm())
	}
}

func TestStoredURLMigratesSingleInstanceCredentials(t *testing.T) {
	path := t.TempDir() + "/credentials.json"
	if err := writeCredentials(path, credentialsFile{Sessions: map[string]storedSession{
		"https://legacy.example": {Session: "session", ExpiresAt: time.Now().Add(time.Hour)},
	}}); err != nil {
		t.Fatal(err)
	}

	instance, ok, err := loadStoredURL(path)
	if err != nil {
		t.Fatal(err)
	}
	if !ok || instance != "https://legacy.example" {
		t.Fatalf("stored URL = %q, %v", instance, ok)
	}
}

func TestLoginPollsDispatcherAndSavesSession(t *testing.T) {
	expiresAt := time.Now().Add(time.Hour).UTC().Truncate(time.Second)
	loginCode := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
	var openedChallenge string
	dispatcher := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/auth/cli/start":
			var request map[string]string
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode start: %v", err)
			}
			openedChallenge = request["challenge"]
			_ = json.NewEncoder(w).Encode(map[string]any{
				"authorizationUrl": "https://backboard.railway.com/oauth/auth?client_id=test&state=signed",
				"code":             loginCode,
				"expiresAt":        time.Now().Add(time.Minute),
			})
		case "/api/auth/cli/exchange":
			var request map[string]string
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil {
				t.Errorf("decode exchange: %v", err)
			}
			if request["code"] != loginCode {
				t.Errorf("code = %q", request["code"])
			}
			if request["verifier"] == "" || loginChallenge(request["verifier"]) != openedChallenge {
				t.Error("verifier does not match the login challenge")
			}
			_ = json.NewEncoder(w).Encode(storedSession{Session: "railway-oauth-session", ExpiresAt: expiresAt})
		default:
			t.Errorf("request = %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer dispatcher.Close()

	client, err := newAPIClient(dispatcher.URL, "", time.Second)
	if err != nil {
		t.Fatal(err)
	}
	credentialsPath := t.TempDir() + "/credentials.json"
	var output bytes.Buffer
	opener := func(target string) error {
		authURL, err := url.Parse(target)
		if err != nil {
			return err
		}
		if authURL.Host != "backboard.railway.com" || authURL.Path != "/oauth/auth" {
			return errors.New("unexpected auth path")
		}
		return nil
	}

	if err := login(t.Context(), client, credentialsPath, &output, opener); err != nil {
		t.Fatal(err)
	}
	session, ok, err := loadStoredSession(credentialsPath, dispatcher.URL, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !ok || session.Session != "railway-oauth-session" || !session.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("saved session = %+v, %v", session, ok)
	}
	if !strings.Contains(output.String(), "Logged in") {
		t.Fatalf("output = %q", output.String())
	}
}

func TestSecureLoginURL(t *testing.T) {
	for _, instance := range []string{"https://dispatcher.example", "http://127.0.0.1:8090", "http://localhost:8090"} {
		if err := requireSecureLoginURL(instance); err != nil {
			t.Errorf("%s: %v", instance, err)
		}
	}
	if err := requireSecureLoginURL("http://dispatcher.example"); err == nil {
		t.Fatal("insecure remote instance was accepted")
	}
}
