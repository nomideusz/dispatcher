package main

import (
	"path/filepath"
	"testing"
	"time"

	duckdb "github.com/vogo/duckdb/v2"
	"gorm.io/gorm"
)

func TestCatalogListsTheLatestSamplesPublishedTemplates(t *testing.T) {
	db, err := gorm.Open(duckdb.Open(filepath.Join(t.TempDir(), "catalog.duckdb")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(&TemplateSnapshot{}, &TemplateKind{}); err != nil {
		t.Fatal(err)
	}
	old := time.Date(2026, time.November, 1, 10, 0, 0, 0, time.UTC)
	now := old.Add(time.Hour)
	pub := old.AddDate(0, 0, -3)
	rows := []TemplateSnapshot{
		{SampledAt: old, TemplateID: "gone", Code: "gone", Status: "PUBLISHED"}, // deleted since
		{SampledAt: now, TemplateID: "a", Code: "alpha", Name: "Alpha | Cloud", Status: "PUBLISHED", Projects: 9, ActiveProjects: 4, PublishedAt: &pub},
		{SampledAt: now, TemplateID: "b", Code: "beta", Name: "Beta", Status: "PUBLISHED"},
		{SampledAt: now, TemplateID: "c", Code: "draft", Name: "Draft", Status: "UNPUBLISHED"},
	}
	if err := gorm.G[TemplateSnapshot](db).CreateInBatches(t.Context(), &rows, 100); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&TemplateKind{TemplateID: "a", Kind: "business"}).Error; err != nil {
		t.Fatal(err)
	}

	got, err := publishedCatalog(t.Context(), db)
	if err != nil {
		t.Fatal(err)
	}
	if got.SampledAt == nil || !got.SampledAt.Equal(now) || len(got.Templates) != 2 {
		t.Fatalf("catalog = %+v", got)
	}
	a, b := got.Templates[0], got.Templates[1]
	if a.Code != "alpha" || a.Kind != "business" || a.Projects != 9 || a.ActiveProjects != 4 || a.PublishedAt == nil {
		t.Fatalf("alpha = %+v", a)
	}
	if b.Code != "beta" || b.Kind != "" || b.PublishedAt != nil {
		t.Fatalf("beta = %+v", b)
	}
}
