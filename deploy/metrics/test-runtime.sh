#!/usr/bin/env bash
# Container runtime verification without a host daemon or production changes (#544).
set -Eeuo pipefail
task_dir="$(mktemp -d)"
test_name="hackos-memory-reader-check-$$"
cleanup() {
  docker rm -f "$test_name" >/dev/null 2>&1 || true
  rm -rf "$task_dir"
}
trap cleanup EXIT
arch="$(docker info --format '{{.Architecture}}')"
case "$arch" in aarch64|arm64) arch=arm64 ;; x86_64|amd64) arch=amd64 ;; *) exit 2 ;; esac
CGO_ENABLED=0 GOOS=linux GOARCH="$arch" go build -o "$task_dir/memory-launch" "$(dirname "$0")/main.go"
for user in 0:0 1000:1000; do
  docker run --rm --name "$test_name" --user "$user" \
    --security-opt no-new-privileges:true --memory 128m --memory-swap 256m \
    --network none --tmpfs /run/memory:rw,mode=1777,nosuid,nodev,noexec \
    -v "$task_dir/memory-launch:/memory-launch:ro" \
    alpine:latest /memory-launch /run/memory/memory.json /bin/sh -c \
    'sleep 2; test -s /run/memory/memory.json; cat /run/memory/memory.json; echo; ps -o pid,user,args' \
    | node -e '
      let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{
        const lines=s.trim().split("\n"),m=JSON.parse(lines[0]);
        if(m.limit!==134217728||m.swap_limit!==134217728||m.memory<=0||!m.timestamp)throw Error("Wrong cgroup measurement");
        const reader=lines.find(l=>l.includes("--collect"));
        if(!reader||(!reader.includes("nobody")&&!reader.includes("1000")))throw Error("Collector not unprivileged");
        console.log("Runtime passed: real RAM/swap ceilings, non-root collector, original command retained");
      });'
done
