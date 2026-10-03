// Container-local, unprivileged memory collection (#544).
package main

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"
)

func number(root, name string) (int64, error) {
	b, err := os.ReadFile(filepath.Join(root, name))
	if err != nil {
		return 0, err
	}
	if strings.TrimSpace(string(b)) == "max" {
		return -1, nil
	}
	return strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
}

func sample(root string) (map[string]int64, error) {
	result := map[string]int64{"timestamp": time.Now().Unix()}
	for key, file := range map[string]string{"memory": "memory.current", "limit": "memory.max", "swap": "memory.swap.current", "swap_limit": "memory.swap.max"} {
		value, err := number(root, file)
		if err != nil {
			return nil, err
		}
		result[key] = value
	}
	for file, keys := range map[string]map[string]string{
		"memory.stat":   {"inactive_file": "reclaimable_cache"},
		"memory.events": {"max": "limit_events", "oom": "oom_events", "oom_kill": "oom_kills"},
	} {
		b, err := os.ReadFile(filepath.Join(root, file))
		if err != nil {
			return nil, err
		}
		for _, line := range strings.Split(string(b), "\n") {
			parts := strings.Fields(line)
			if len(parts) != 2 {
				continue
			}
			if key, ok := keys[parts[0]]; ok {
				value, err := strconv.ParseInt(parts[1], 10, 64)
				if err != nil {
					return nil, err
				}
				result[key] = value
			}
		}
	}
	return result, nil
}

func collect(output string) {
	for {
		values, err := sample("/sys/fs/cgroup")
		if err == nil {
			var b []byte
			b, err = json.Marshal(values)
			if err == nil {
				var f *os.File
				f, err = os.CreateTemp(filepath.Dir(output), ".memory-*")
				if err == nil {
					_, err = f.Write(b)
					if err == nil {
						err = f.Chmod(0644)
					}
					closeErr := f.Close()
					if err == nil {
						err = closeErr
					}
					if err == nil {
						err = os.Rename(f.Name(), output)
					}
					if err != nil {
						os.Remove(f.Name())
					}
				}
			}
		}
		if err != nil {
			fmt.Fprintln(os.Stderr, "hackOS memory collection failed:", err)
		}
		time.Sleep(15 * time.Second)
	}
}

func main() {
	if len(os.Args) == 3 && os.Args[1] == "--collect" {
		collect(os.Args[2])
		return
	}
	if len(os.Args) < 3 {
		fmt.Fprintln(os.Stderr, "usage: memory-launch OUTPUT COMMAND [ARGS...]")
		os.Exit(2)
	}
	self, err := os.Executable()
	if err != nil {
		panic(err)
	}
	collector := exec.Command(self, "--collect", os.Args[1])
	collector.Env = []string{"PATH=/usr/bin:/bin"}
	collector.Stdout, collector.Stderr = os.Stdout, os.Stderr
	// The upstream entrypoint retains its original user/init behavior. Only the
	// reader drops to nobody, before it can open any files; no Docker socket.
	if os.Geteuid() == 0 {
		collector.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: 65534, Gid: 65534, Groups: []uint32{}}}
	}
	if err := collector.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "hackOS memory collector start failed:", err)
	}
	command, err := exec.LookPath(os.Args[2])
	if err != nil {
		panic(err)
	}
	if err := syscall.Exec(command, os.Args[2:], os.Environ()); err != nil {
		panic(err)
	}
}
