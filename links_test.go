package main

import (
	"errors"
	"net"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"slices"
	"testing"
	"time"

	duckdb "github.com/vogo/duckdb/v2"
	"gorm.io/gorm"
)

func TestReadmeLinksSkipsCodeAndKeepsNestedLinks(t *testing.T) {
	md := "# App\n\n" +
		"[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/app?referralCode=x)\n\n" +
		"- [Docs](https://docs.example.org/a_(b)) and https://plain.dev/page.\n" +
		"- [Local](./docs/setup.md) [Anchor](#setup) [Mail](mailto:a@b.c)\n" +
		"<a href=\"https://html.dev/x\">x</a>\n\n" +
		"[ref]: https://ref.dev/y\n\n" +
		"```sh\ncurl https://in-code.dev/z\n```\n" +
		"Run `curl https://inline.dev` first.\n"
	got := readmeLinks(md)
	want := []string{
		"https://railway.com/button.svg",
		"https://railway.com/deploy/app?referralCode=x",
		"https://docs.example.org/a_(b",
		"./docs/setup.md",
		"https://html.dev/x",
		"https://ref.dev/y",
		"https://plain.dev/page",
	}
	// The markdown pattern stops at the first ")": a URL holding parentheses
	// is read up to it, like most renderers that do not balance them.
	if !slices.Equal(got, want) {
		t.Fatalf("links =\n%q\nwant\n%q", got, want)
	}
}

func TestPlaceholderHost(t *testing.T) {
	for host, want := range map[string]bool{
		"my-app.up.railway.app": true, "localhost": true, "postgres.railway.internal": true,
		"docs.example.com": true, "your-domain.com": true, "uvicorn.dev": false, "github.com": false,
	} {
		if placeholderHost(host) != want {
			t.Errorf("placeholderHost(%q) = %v", host, !want)
		}
	}
}

func TestJudge(t *testing.T) {
	cases := []struct {
		status  int
		err     error
		problem string
	}{
		{200, nil, ""},
		{301, nil, ""},
		{404, nil, linkNotFound},
		{410, nil, linkNotFound},
		{403, nil, linkUnverified},
		{0, &net.DNSError{Err: "no such host", Name: "gone.dev", IsNotFound: true}, linkGone},
		{0, errors.New("dial tcp: i/o timeout"), linkUnverified},
	}
	for _, c := range cases {
		if p, _ := judge(c.status, c.err); p != c.problem {
			t.Errorf("judge(%d, %v) = %q, want %q", c.status, c.err, p, c.problem)
		}
	}
}

func TestProbeFallsBackToGetWhenHeadIsRefused(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/missing":
			http.NotFound(w, r)
		case r.Method == http.MethodHead:
			w.WriteHeader(http.StatusMethodNotAllowed)
		}
	}))
	defer srv.Close()
	if status, err := probe(t.Context(), srv.URL+"/page"); status != 200 || err != nil {
		t.Fatalf("page: %d %v", status, err)
	}
	if status, _ := probe(t.Context(), srv.URL+"/missing"); status != 404 {
		t.Fatalf("missing: %d", status)
	}
}

func TestLinkReportPutsBrokenFirst(t *testing.T) {
	db, err := gorm.Open(duckdb.Open(filepath.Join(t.TempDir(), "links.duckdb")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&ReadmeLink{}); err != nil {
		t.Fatal(err)
	}
	at := time.Date(2026, time.November, 17, 6, 38, 0, 0, time.UTC)
	rows := []ReadmeLink{
		{CheckedAt: at, TemplateID: "a", TemplateName: "Alpha", URL: "https://a.dev/ok"},
		{CheckedAt: at, TemplateID: "a", TemplateName: "Alpha", URL: "https://a.dev/wall", Status: 403, Problem: linkUnverified},
		{CheckedAt: at, TemplateID: "b", TemplateName: "Beta", URL: "https://b.dev/gone", Status: 404, Problem: linkNotFound},
	}
	if err := db.Create(&rows).Error; err != nil {
		t.Fatal(err)
	}
	rep, err := linkReport(t.Context(), db)
	if err != nil {
		t.Fatal(err)
	}
	if rep.Readmes != 2 || rep.Links != 3 || len(rep.Problems) != 2 || rep.CheckedAt == nil || !rep.CheckedAt.Equal(at) {
		t.Fatalf("report = %+v", rep)
	}
	if rep.Problems[0].Problem != linkNotFound || rep.Problems[1].Problem != linkUnverified {
		t.Fatalf("order = %q, %q", rep.Problems[0].Problem, rep.Problems[1].Problem)
	}
}
