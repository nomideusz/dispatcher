package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"
	"time"

	duckdb "github.com/vogo/duckdb/v2"
	"gorm.io/gorm"
)

func TestCLIStateIsSignedAndExpires(t *testing.T) {
	now := time.Date(2026, time.August, 30, 12, 0, 0, 0, time.UTC)
	loginCode := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{6}, 32))
	challenge := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{7}, 32))
	want := cliOAuthState{
		LoginCode: loginCode,
		Challenge: challenge,
		ExpiresAt: now.Add(time.Minute).Unix(),
	}
	encoded, err := encodeCLIState("client-secret", want)
	if err != nil {
		t.Fatal(err)
	}
	got, err := decodeCLIState("client-secret", encoded, now)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("decoded state = %+v, want %+v", got, want)
	}

	parts := strings.Split(encoded, ".")
	parts[1] = "A" + parts[1][1:]
	if _, err := decodeCLIState("client-secret", strings.Join(parts, "."), now); err == nil {
		t.Fatal("tampered state was accepted")
	}
	if _, err := decodeCLIState("client-secret", encoded, now.Add(time.Minute)); err == nil {
		t.Fatal("expired state was accepted")
	}
}

func TestCLIAuthStartReturnsRailwayURLWithSignedState(t *testing.T) {
	db := cliAuthTestDB(t, "cli-start.duckdb")
	t.Setenv("CALLBACK_URL", "https://dispatcher.example/api/auth/callback")
	cliAuthHandoffs = cliAuthHandoffStore{entries: make(map[string]cliAuthHandoff)}
	verifier := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{9}, 32))
	payload, _ := json.Marshal(map[string]string{"challenge": cliLoginChallenge(verifier)})
	req := httptest.NewRequest(http.MethodPost, "/api/auth/cli/start", bytes.NewReader(payload))
	res := httptest.NewRecorder()

	handleCLIAuthStart(db).ServeHTTP(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", res.Code, res.Body.String())
	}
	if res.Header().Get("Cache-Control") != "no-store" {
		t.Fatalf("Cache-Control = %q", res.Header().Get("Cache-Control"))
	}
	var response struct {
		AuthorizationURL string    `json:"authorizationUrl"`
		Code             string    `json:"code"`
		ExpiresAt        time.Time `json:"expiresAt"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if !validCLISecret(response.Code) || !response.ExpiresAt.After(time.Now()) {
		t.Fatalf("invalid start response: %+v", response)
	}
	authorizationURL, err := url.Parse(response.AuthorizationURL)
	if err != nil {
		t.Fatal(err)
	}
	if authorizationURL.Host != "backboard.railway.com" || authorizationURL.Path != "/oauth/auth" {
		t.Fatalf("authorization URL = %s", authorizationURL)
	}
	state, err := decodeCLIState("client-secret", authorizationURL.Query().Get("state"), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if state.LoginCode != response.Code || state.Challenge != cliLoginChallenge(verifier) {
		t.Fatalf("state = %+v", state)
	}
}

func TestCLIAuthExchangePollsThenConsumesCompletedLogin(t *testing.T) {
	cliAuthHandoffs = cliAuthHandoffStore{entries: make(map[string]cliAuthHandoff)}
	verifier := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32))
	code, _, err := cliAuthHandoffs.start(cliLoginChallenge(verifier), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	payload, _ := json.Marshal(map[string]string{"code": code, "verifier": verifier})
	exchange := func() *httptest.ResponseRecorder {
		req := httptest.NewRequest(http.MethodPost, "/api/auth/cli/exchange", bytes.NewReader(payload))
		res := httptest.NewRecorder()
		handleCLIAuthExchange(res, req)
		return res
	}
	if pending := exchange(); pending.Code != http.StatusAccepted || !strings.Contains(pending.Body.String(), "pending") {
		t.Fatalf("pending exchange: status = %d, body = %s", pending.Code, pending.Body.String())
	}
	if !cliAuthHandoffs.complete(code, "railway-session", time.Now().Add(time.Hour), "", time.Now()) {
		t.Fatal("could not complete pending login")
	}
	ready := exchange()
	if ready.Code != http.StatusOK || !strings.Contains(ready.Body.String(), "railway-session") {
		t.Fatalf("ready exchange: status = %d, body = %s", ready.Code, ready.Body.String())
	}
	if second := exchange(); second.Code != http.StatusUnauthorized {
		t.Fatalf("second exchange status = %d, want 401", second.Code)
	}
}

func TestCLIAuthExchangeRejectsWrongVerifier(t *testing.T) {
	store := cliAuthHandoffStore{entries: make(map[string]cliAuthHandoff)}
	verifier := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{3}, 32))
	wrongVerifier := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{8}, 32))
	code, _, err := store.start(cliLoginChallenge(verifier), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if _, status := store.exchange(code, wrongVerifier, time.Now()); status != cliHandoffInvalid {
		t.Fatal("wrong verifier was accepted")
	}
	if _, status := store.exchange(code, verifier, time.Now()); status != cliHandoffPending {
		t.Fatal("correct verifier could not continue polling after a rejected attempt")
	}
}

func TestAuthCallbackCompletesPendingCLIFlowWithoutExposingSession(t *testing.T) {
	db := cliAuthTestDB(t, "cli-callback.duckdb")
	t.Setenv("CALLBACK_URL", "https://dispatcher.example/api/auth/callback")
	t.Setenv("RAILWAY_PROJECT_ID", "project-1")
	oldClient := client
	client = &http.Client{Transport: roundTripFunc(func(req *http.Request) (*http.Response, error) {
		var body string
		switch req.URL.String() {
		case railwayTokenURL:
			body = `{"access_token":"railway-session","refresh_token":"refresh","expires_in":3600}`
		case railwayGraphQLURL:
			body = `{"data":{"project":{"workspaceId":"workspace-1"},"me":{"id":"user-1","workspaces":[{"id":"workspace-1"}]}}}`
		default:
			t.Errorf("unexpected request to %s", req.URL)
			return testHTTPResponse(req, http.StatusNotFound, `{}`), nil
		}
		return testHTTPResponse(req, http.StatusOK, body), nil
	})}
	defer func() { client = oldClient }()
	cliAuthHandoffs = cliAuthHandoffStore{entries: make(map[string]cliAuthHandoff)}

	verifier := base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{4}, 32))
	loginCode, expiresAt, err := cliAuthHandoffs.start(cliLoginChallenge(verifier), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	state, err := encodeCLIState("client-secret", cliOAuthState{
		LoginCode: loginCode,
		Challenge: cliLoginChallenge(verifier),
		ExpiresAt: expiresAt.Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/api/auth/callback?"+url.Values{
		"code":  {"railway-code"},
		"state": {state},
	}.Encode(), nil)
	res := httptest.NewRecorder()

	handleAuthCallback(db).ServeHTTP(res, req)

	if res.Code != http.StatusOK || !strings.Contains(res.Body.String(), "CLI login complete") {
		t.Fatalf("callback: status = %d, body = %s", res.Code, res.Body.String())
	}
	if strings.Contains(res.Body.String(), "railway-session") || strings.Contains(res.Header().Get("Location"), "railway-session") {
		t.Fatal("Railway session was exposed to the browser")
	}
	handoff, status := cliAuthHandoffs.exchange(loginCode, verifier, time.Now())
	if status != cliHandoffReady || handoff.Session != "railway-session" {
		t.Fatalf("handoff = %+v, status = %d", handoff, status)
	}
}

func cliAuthTestDB(t *testing.T, name string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(duckdb.Open(filepath.Join(t.TempDir(), name)), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&RailwayCredentials{}); err != nil {
		t.Fatal(err)
	}
	creds := RailwayCredentials{ClientID: "client-id", ClientSecret: "client-secret"}
	if err := gorm.G[RailwayCredentials](db).Create(t.Context(), &creds); err != nil {
		t.Fatal(err)
	}
	return db
}

func testHTTPResponse(req *http.Request, status int, body string) *http.Response {
	return &http.Response{
		StatusCode: status,
		Status:     http.StatusText(status),
		Header:     make(http.Header),
		Body:       io.NopCloser(strings.NewReader(body)),
		Request:    req,
	}
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
