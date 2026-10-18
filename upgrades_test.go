package main

import (
	"fmt"
	"path/filepath"
	"testing"

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
