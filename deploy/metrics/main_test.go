package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSample(t *testing.T) {
	root := t.TempDir()
	for name, value := range map[string]string{
		"memory.current": "1024", "memory.max": "max", "memory.swap.current": "128", "memory.swap.max": "2048",
		"memory.stat": "anon 512\ninactive_file 256\n", "memory.events": "max 3\noom 2\noom_kill 1\n",
	} {
		if err := os.WriteFile(filepath.Join(root, name), []byte(value), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s, err := sample(root)
	if err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]int64{"memory": 1024, "limit": -1, "swap": 128, "swap_limit": 2048, "reclaimable_cache": 256, "limit_events": 3, "oom_events": 2, "oom_kills": 1} {
		if s[key] != want {
			t.Fatalf("%s = %d, want %d", key, s[key], want)
		}
	}
	if _, err := sample(t.TempDir()); err == nil {
		t.Fatal("missing files must not report zero usage")
	}
}
