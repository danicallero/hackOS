package main

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func configure(t *testing.T, g *gateway, r routes) {
	t.Helper()
	data, _ := json.Marshal(r)
	if err := os.WriteFile(g.config, data, 0600); err != nil {
		t.Fatal(err)
	}
	if err := g.reload(); err != nil {
		t.Fatal(err)
	}
}
func TestCutoverDrainsMutationWithoutReplay(t *testing.T) {
	entered, release := make(chan struct{}), make(chan struct{})
	old := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		close(entered)
		<-release
		data, _ := io.ReadAll(r.Body)
		w.Write(data)
	}))
	defer old.Close()
	next := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write([]byte("new")) }))
	defer next.Close()
	path := filepath.Join(t.TempDir(), "routes.json")
	data, _ := json.Marshal(routes{old.URL, old.URL, old.URL})
	os.WriteFile(path, data, 0600)
	g, err := newGateway(path, "")
	if err != nil {
		t.Fatal(err)
	}
	edge := httptest.NewServer(g.handler("api"))
	defer edge.Close()
	result := make(chan string, 1)
	go func() {
		res, err := http.Post(edge.URL, "application/octet-stream", strings.NewReader("committed upload"))
		if err != nil {
			result <- err.Error()
			return
		}
		defer res.Body.Close()
		body, _ := io.ReadAll(res.Body)
		result <- string(body)
	}()
	<-entered
	configure(t, g, routes{next.URL, next.URL, next.URL})
	res, err := http.Get(edge.URL)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if string(body) != "new" {
		t.Fatal(string(body))
	}
	check := httptest.NewRecorder()
	g.admin().ServeHTTP(check, httptest.NewRequest("GET", "/drained?target="+old.URL, nil))
	if check.Code != 409 {
		t.Fatal(check.Code)
	}
	close(release)
	select {
	case value := <-result:
		if value != "committed upload" {
			t.Fatal(value)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("request did not drain")
	}
	check = httptest.NewRecorder()
	g.admin().ServeHTTP(check, httptest.NewRequest("GET", "/drained?target="+old.URL, nil))
	if check.Code != 204 {
		t.Fatal(check.Code)
	}
}
func TestSSECutoverAllowsReconnect(t *testing.T) {
	old := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.Write([]byte(": ready\n\n"))
		w.(http.Flusher).Flush()
		<-r.Context().Done()
	}))
	defer old.Close()
	path := filepath.Join(t.TempDir(), "routes.json")
	data, _ := json.Marshal(routes{old.URL, old.URL, old.URL})
	os.WriteFile(path, data, 0600)
	g, _ := newGateway(path, "")
	edge := httptest.NewServer(g.handler("api"))
	defer edge.Close()
	res, err := http.Get(edge.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	configure(t, g, routes{"http://new:3000", "http://new:3001", "http://new:9464"})
	done := make(chan bool)
	go func() { io.ReadAll(res.Body); done <- true }()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("old SSE pinned drain forever")
	}
}
func TestInvalidConfigKeepsServingPrevious(t *testing.T) {
	path := filepath.Join(t.TempDir(), "routes.json")
	data, _ := json.Marshal(routes{"http://old:3000", "http://old:3001", "http://old:9464"})
	os.WriteFile(path, data, 0600)
	g, _ := newGateway(path, "")
	os.WriteFile(path, []byte(`{"api":"invalid"}`), 0600)
	if g.reload() == nil {
		t.Fatal("accepted invalid config")
	}
	if g.routes.API != "http://old:3000" {
		t.Fatal("lost working routes")
	}
}
func TestAssetRetentionAndCollision(t *testing.T) {
	source, dest := t.TempDir(), t.TempDir()
	os.WriteFile(filepath.Join(source, "old-hash.js"), []byte("old"), 0600)
	if err := importAssets(source, dest); err != nil {
		t.Fatal(err)
	}
	os.Remove(filepath.Join(source, "old-hash.js"))
	os.WriteFile(filepath.Join(source, "new-hash.js"), []byte("new"), 0600)
	if err := importAssets(source, dest); err != nil {
		t.Fatal(err)
	}
	if data, _ := os.ReadFile(filepath.Join(dest, "old-hash.js")); string(data) != "old" {
		t.Fatal("old assets deleted")
	}
	os.WriteFile(filepath.Join(source, "new-hash.js"), []byte("changed"), 0600)
	if importAssets(source, dest) == nil {
		t.Fatal("accepted asset collision")
	}
}
