package main

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"

	duckdb "github.com/vogo/duckdb/v2"
	"gorm.io/gorm"
)

func TestSplitImageTag(t *testing.T) {
	cases := []struct{ ref, image, tag string }{
		{"postgres:17", "postgres", "17"},
		{"ghcr.io/simstudioai/simstudio:v0.9.26", "ghcr.io/simstudioai/simstudio", "v0.9.26"},
		{"localhost:5000/app", "localhost:5000/app", "latest"},
		{"redis@sha256:abc", "redis", "@sha256:abc"},
	}
	for _, c := range cases {
		if image, tag := splitImageTag(c.ref); image != c.image || tag != c.tag {
			t.Errorf("splitImageTag(%q) = %q, %q", c.ref, image, tag)
		}
	}
}

func TestRegistryRepo(t *testing.T) {
	cases := []struct{ image, host, repo string }{
		{"postgres", "registry-1.docker.io", "library/postgres"},
		{"openproject/openproject", "registry-1.docker.io", "openproject/openproject"},
		{"ghcr.io/railwayapp-templates/postgres-ssl", "ghcr.io", "railwayapp-templates/postgres-ssl"},
		{"quay.io/minio/minio", "quay.io", "minio/minio"},
	}
	for _, c := range cases {
		if host, repo := registryRepo(c.image); host != c.host || repo != c.repo {
			t.Errorf("registryRepo(%q) = %q, %q", c.image, host, repo)
		}
	}
}

func TestNewestTags(t *testing.T) {
	tags := []string{"17.9.2-slim", "17.9.3-slim", "17.10.0-slim", "18.0.0-rc1-slim", "18.1.0-slim", "17.10.0", "latest",
		"v0.9.26", "v0.9.30", "v1.0.0-beta.1", "8-alpine3.20", "8-alpine3.21", "9-alpine3.21", "16", "17", "18",
		"0.8.6-pg17", "0.8.7-pg17", "0.8.7-pg18"}
	cases := []struct{ pinned, latest, behind, major string }{
		{"17.9.2-slim", "17.10.0-slim", "minor", "18.1.0-slim"},
		{"17.10.0-slim", "17.10.0-slim", "", "18.1.0-slim"},
		{"v0.9.26", "v0.9.30", "patch", ""},
		{"8-alpine3.20", "8-alpine3.21", "patch", "9-alpine3.21"},
		{"17", "17", "", "18"},
		{"0.8.6-pg17", "0.8.7-pg17", "patch", ""},
		{"latest", "", "floating", ""},
		{"@sha256:abc", "", "floating", ""},
	}
	for _, c := range cases {
		latest, behind, major := newestTags(c.pinned, tags)
		if latest != c.latest || behind != c.behind || major != c.major {
			t.Errorf("newestTags(%q) = %q, %q, %q; want %q, %q, %q", c.pinned, latest, behind, major, c.latest, c.behind, c.major)
		}
	}
}

func TestNextPageURL(t *testing.T) {
	got := nextPageURL("https://ghcr.io/v2/o/r/tags/list?n=1000", `</v2/o/r/tags/list?last=v1&n=1000>; rel="next"`)
	if got != "https://ghcr.io/v2/o/r/tags/list?last=v1&n=1000" {
		t.Errorf("nextPageURL = %q", got)
	}
	if nextPageURL("https://x/v2/a/tags/list", "") != "" {
		t.Error("nextPageURL without Link should be empty")
	}
}

// More rows than one batch: GORM would wrap the batches in a SAVEPOINT,
// which DuckDB rejects.
func TestReplaceServiceImages(t *testing.T) {
	db, err := gorm.Open(duckdb.Open(filepath.Join(t.TempDir(), "upgrades.duckdb")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&ServiceImage{}); err != nil {
		t.Fatal(err)
	}
	for _, n := range []int{250, 3} {
		rows := make([]ServiceImage, n)
		for i := range rows {
			rows[i] = ServiceImage{TemplateID: "t", Service: fmt.Sprint(i), Image: "postgres", Tag: "17"}
		}
		if err := replaceServiceImages(db, rows); err != nil {
			t.Fatal(err)
		}
		var count int64
		db.Model(&ServiceImage{}).Count(&count)
		if count != int64(n) {
			t.Fatalf("count = %d, want %d", count, n)
		}
	}
}

func TestDockerfilePins(t *testing.T) {
	dockerfile := `ARG NEKO_IMAGE=ghcr.io/m1k1o/neko/firefox:3.1.6
FROM --platform=linux/amd64 ${NEKO_IMAGE} AS base
# Bump here.
# upgrade: github pingdotgg/t3code
ARG T3_VERSION=0.1.0
ARG T3_SHA256=f770
# upgrade: npm @anthropic-ai/claude-code

ARG CLAUDE_CODE_VERSION=2.1.302
RUN echo \
  # upgrade: npm not-an-arg
  && true
FROM base
FROM caddy:2.10.2 AS caddy
FROM ubuntu:24.04
FROM ubuntu:24.04
# Held back on purpose.
# upgrade: skip
FROM python:3.12-slim
FROM node:22-slim
`
	got := fmt.Sprint(dockerfilePins("svc", dockerfile))
	want := fmt.Sprint([]serviceImageRef{
		{Service: "svc", Image: "ghcr.io/m1k1o/neko/firefox", Tag: "3.1.6"},
		{Service: "svc", Image: "github:pingdotgg/t3code", Tag: "0.1.0"},
		{Service: "svc", Image: "caddy", Tag: "2.10.2"},
		{Service: "svc", Image: "ubuntu", Tag: "24.04"},
		{Service: "svc", Image: "node", Tag: "22-slim"},
	})
	if got != want {
		t.Errorf("dockerfilePins =\n%s\nwant\n%s", got, want)
	}
	// A release tagged v0.1.2 is offered as 0.1.2 too (see listTags).
	if latest, behind, _ := newestTags("0.1.0", []string{"v0.1.2", "0.1.2"}); latest != "0.1.2" || behind != "patch" {
		t.Errorf("newestTags(0.1.0) = %q, %q", latest, behind)
	}
}

// Every template of the latest snapshot run is listed, the ones with
// nothing checked as a single "unchecked" row; a template gone from the
// catalog is not.
func TestUpgradeRows(t *testing.T) {
	db, err := gorm.Open(duckdb.Open(filepath.Join(t.TempDir(), "rows.duckdb")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&ServiceImage{}, &TemplateSnapshot{}); err != nil {
		t.Fatal(err)
	}
	old, now := time.Now().Add(-time.Hour), time.Now()
	db.Create(&[]TemplateSnapshot{
		{SampledAt: old, TemplateID: "gone", Name: "Gone"},
		{SampledAt: now, TemplateID: "pinned", Name: "Pinned"},
		{SampledAt: now, TemplateID: "bare", Name: "Bare"},
	})
	db.Create(&[]ServiceImage{
		{CheckedAt: now, TemplateID: "pinned", Service: "app", Image: "ubuntu", Tag: "24.04", Behind: "patch", Latest: "24.04.1"},
		{CheckedAt: now, TemplateID: "pinned", Service: "db", Image: "postgres", Tag: "17"},
	})
	rows, err := upgradeRows(db)
	if err != nil {
		t.Fatal(err)
	}
	got := []string{}
	for _, r := range rows {
		got = append(got, r.TemplateID+"/"+r.Service+"/"+r.Behind+"/"+r.Name)
	}
	want := "[pinned/app/patch/Pinned bare//unchecked/Bare pinned/db//Pinned]"
	if fmt.Sprint(got) != want {
		t.Errorf("upgradeRows = %v, want %v", got, want)
	}
}
