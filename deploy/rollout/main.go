// A stable ingress for compatible application releases (H12, H13, H22, H29).
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type routes struct {
	API    string `json:"api"`
	Web    string `json:"web"`
	Worker string `json:"worker"`
}
type gateway struct {
	mu        sync.Mutex
	routes    routes
	active    map[string]int
	streams   map[int]stream
	serial    int
	config    string
	assets    string
	transport http.RoundTripper
}
type stream struct {
	target string
	cancel context.CancelFunc
}

func readRoutes(path string) (routes, error) {
	var r routes
	data, err := os.ReadFile(path)
	if err != nil {
		return r, err
	}
	if err = json.Unmarshal(data, &r); err != nil {
		return r, err
	}
	for _, raw := range []string{r.API, r.Web, r.Worker} {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != "http" || u.Hostname() == "" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
			return r, fmt.Errorf("invalid upstream")
		}
	}
	return r, nil
}
func newGateway(config, assets string) (*gateway, error) {
	r, err := readRoutes(config)
	if err != nil {
		return nil, err
	}
	return &gateway{routes: r, active: map[string]int{}, streams: map[int]stream{}, config: config, assets: assets, transport: http.DefaultTransport}, nil
}
func (g *gateway) reload() error {
	r, err := readRoutes(g.config)
	if err != nil {
		return err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	g.routes = r
	// SSE is recoverable; finite requests (including uploads) must finish normally.
	for _, s := range g.streams {
		if s.target != r.API && s.target != r.Web && s.target != r.Worker {
			s.cancel()
		}
	}
	return nil
}
func (g *gateway) handler(kind string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if kind == "web" && strings.HasPrefix(req.URL.Path, "/_next/static/") && g.assets != "" {
			http.StripPrefix("/_next/static/", http.FileServer(http.Dir(g.assets))).ServeHTTP(w, req)
			return
		}
		g.mu.Lock()
		target := g.routes.API
		if kind == "web" {
			target = g.routes.Web
		}
		if kind == "worker" {
			target = g.routes.Worker
		}
		g.active[target]++
		g.serial++
		id := g.serial
		g.mu.Unlock()
		defer func() { g.mu.Lock(); g.active[target]--; delete(g.streams, id); g.mu.Unlock() }()
		ctx, cancel := context.WithCancel(req.Context())
		defer cancel()
		upstream, _ := url.Parse(target)
		proxy := httputil.NewSingleHostReverseProxy(upstream)
		proxy.Transport = g.transport
		proxy.FlushInterval = -1
		proxy.ModifyResponse = func(res *http.Response) error {
			if strings.HasPrefix(res.Header.Get("Content-Type"), "text/event-stream") {
				g.mu.Lock()
				g.streams[id] = stream{target, cancel}
				current := g.routes.API
				if kind == "web" {
					current = g.routes.Web
				}
				if kind == "worker" {
					current = g.routes.Worker
				}
				if current != target {
					cancel()
				}
				g.mu.Unlock()
			}
			return nil
		}
		// Never replay a failed mutation to another upstream: its commit may already exist.
		proxy.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
			log.Printf("upstream failure (%s): %v", kind, err)
			w.Header().Set("Retry-After", "2")
			http.Error(w, "Temporarily unavailable", http.StatusServiceUnavailable)
		}
		proxy.ServeHTTP(w, req.WithContext(ctx))
	})
}
func (g *gateway) admin() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/reload", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			w.WriteHeader(405)
			return
		}
		if err := g.reload(); err != nil {
			http.Error(w, "invalid configuration", 400)
			return
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("/drained", func(w http.ResponseWriter, r *http.Request) {
		target := r.URL.Query().Get("target")
		if target == "" {
			w.WriteHeader(400)
			return
		}
		g.mu.Lock()
		defer g.mu.Unlock()
		if target == g.routes.API || target == g.routes.Web || target == g.routes.Worker || g.active[target] > 0 {
			w.WriteHeader(409)
			return
		}
		w.WriteHeader(204)
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(204) })
	return mux
}

// Keep immutable Next assets available to tabs opened before the cutover.
// Refuse path collisions with different bytes instead of corrupting an open client.
func importAssets(source, dest string) error {
	return filepath.WalkDir(source, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("asset symlinks are forbidden")
		}
		target := filepath.Join(dest, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		previous, err := os.ReadFile(target)
		if err == nil {
			if !bytes.Equal(data, previous) {
				return fmt.Errorf("immutable asset collision: %s", relative)
			}
			return nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		file, err := os.CreateTemp(filepath.Dir(target), ".asset-")
		if err != nil {
			return err
		}
		name := file.Name()
		defer os.Remove(name)
		if _, err = io.Copy(file, bytes.NewReader(data)); err != nil {
			file.Close()
			return err
		}
		if err = file.Chmod(0644); err != nil {
			file.Close()
			return err
		}
		if err = file.Close(); err != nil {
			return err
		}
		return os.Rename(name, target)
	})
}
func main() {
	if len(os.Args) == 4 && os.Args[1] == "assets" {
		if err := importAssets(os.Args[2], os.Args[3]); err != nil {
			log.Fatal(err)
		}
		return
	}
	g, err := newGateway("/rollout/routes.json", "/rollout/assets")
	if err != nil {
		log.Fatal(err)
	}
	for kind, addr := range map[string]string{"api": ":3000", "web": ":3001", "worker": ":9464"} {
		server := &http.Server{Addr: addr, Handler: g.handler(kind), ReadHeaderTimeout: 10 * time.Second}
		go func() { log.Fatal(server.ListenAndServe()) }()
	}
	// Container-loopback only; no deployment control endpoint is publicly routed.
	log.Fatal((&http.Server{Addr: "127.0.0.1:3002", Handler: g.admin(), ReadHeaderTimeout: 5 * time.Second}).ListenAndServe())
}
