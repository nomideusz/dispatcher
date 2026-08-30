package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const maxResponseBytes = 16 << 20

type apiClient struct {
	baseURL string
	session string
	http    *http.Client
}

func newAPIClient(baseURL, session string, timeout time.Duration) (*apiClient, error) {
	baseURL = strings.TrimRight(strings.TrimSpace(baseURL), "/")
	u, err := url.Parse(baseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("invalid Dispatcher URL %q", baseURL)
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return nil, fmt.Errorf("Dispatcher URL must not contain a query or fragment")
	}
	if u.User != nil {
		return nil, fmt.Errorf("Dispatcher URL must not contain credentials")
	}
	return &apiClient{
		baseURL: baseURL,
		session: session,
		http: &http.Client{
			Timeout: timeout,
			// Do not risk forwarding an OAuth session through a redirect. Callers
			// should configure the final HTTPS instance URL directly.
			CheckRedirect: func(*http.Request, []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}, nil
}

func (c *apiClient) request(ctx context.Context, method, path string) ([]byte, error) {
	return c.requestBody(ctx, method, path, nil, "")
}

func (c *apiClient) requestBody(ctx context.Context, method, path string, payload io.Reader, contentType string) ([]byte, error) {
	if !strings.HasPrefix(path, "/") {
		path = "/api/" + path
	}
	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, payload)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	if c.session != "" {
		req.AddCookie(&http.Cookie{Name: "railway_token", Value: c.session})
	}

	res, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request Dispatcher: %w", err)
	}
	defer res.Body.Close()

	body, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if err != nil {
		return nil, fmt.Errorf("read Dispatcher response: %w", err)
	}
	if len(body) > maxResponseBytes {
		return nil, fmt.Errorf("Dispatcher response exceeds %d bytes", maxResponseBytes)
	}
	if res.StatusCode < 200 || res.StatusCode >= 300 {
		return nil, responseError(res.Status, body)
	}
	return body, nil
}

func responseError(status string, body []byte) error {
	var payload struct {
		Error string `json:"error"`
	}
	if json.Unmarshal(body, &payload) == nil && payload.Error != "" {
		return fmt.Errorf("Dispatcher returned %s: %s", status, payload.Error)
	}
	detail := strings.TrimSpace(string(body))
	if detail == "" {
		return fmt.Errorf("Dispatcher returned %s", status)
	}
	return fmt.Errorf("Dispatcher returned %s: %s", status, detail)
}

func writeOutput(w io.Writer, body []byte, compact bool) error {
	body = bytes.TrimSpace(body)
	if len(body) == 0 {
		return nil
	}
	var formatted bytes.Buffer
	var err error
	if compact {
		err = json.Compact(&formatted, body)
	} else {
		err = json.Indent(&formatted, body, "", "  ")
	}
	if err != nil {
		_, writeErr := fmt.Fprintf(w, "%s\n", body)
		return writeErr
	}
	formatted.WriteByte('\n')
	_, err = formatted.WriteTo(w)
	return err
}
