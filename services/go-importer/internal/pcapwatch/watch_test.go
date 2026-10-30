package pcapwatch

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/fsnotify/fsnotify"
)

func newTestWatcher(t *testing.T) (*Watcher, *[]string) {
	t.Helper()
	var captures []string
	watcher, err := New(func(path string) { captures = append(captures, path) })
	if err != nil {
		t.Fatal(err)
	}
	watcher.readyDelay = 0
	t.Cleanup(func() { watcher.Close() })
	return watcher, &captures
}

func writeCapture(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("capture"), 0644); err != nil {
		t.Fatal(err)
	}
}

func hasCapture(captures []string, path string) bool {
	for _, capture := range captures {
		if capture == path {
			return true
		}
	}
	return false
}

// Consume real filesystem events until the expected captures have arrived.
func processUntil(t *testing.T, watcher *Watcher, done func() bool) {
	t.Helper()
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()
	for !done() {
		select {
		case event, ok := <-watcher.Events:
			if !ok {
				t.Fatal("watcher closed before the expected event")
			}
			if err := watcher.Handle(event); err != nil {
				t.Fatal(err)
			}
		case err := <-watcher.Errors:
			t.Fatal(err)
		case <-deadline.C:
			t.Fatal("timed out waiting for filesystem events")
		}
	}
}

func TestExistingCapturesInNestedDirectories(t *testing.T) {
	root := t.TempDir()
	paths := []string{
		filepath.Join(root, "traffic.pcap"),
		filepath.Join(root, "service", "traffic.pcapng"),
		filepath.Join(root, "service", "tick", "traffic.pcap.1"),
		filepath.Join(root, "round.pcap", "nested", "traffic.pcap2"),
	}
	for _, path := range paths {
		writeCapture(t, path)
	}
	writeCapture(t, filepath.Join(root, "service", "eve.json"))
	watcher, captures := newTestWatcher(t)
	if err := watcher.Add(root); err != nil {
		t.Fatal(err)
	}
	if len(*captures) != len(paths) {
		t.Fatalf("imported %v, want only %v", *captures, paths)
	}
	for _, path := range paths {
		if !hasCapture(*captures, path) {
			t.Errorf("missing capture %s", path)
		}
	}
}

func TestMovedInSubtreeAndSubsequentCaptures(t *testing.T) {
	root := t.TempDir()
	watcher, captures := newTestWatcher(t)
	if err := watcher.Add(root); err != nil {
		t.Fatal(err)
	}
	// Populate the subtree before moving it into the watched tree, as rsync
	// and capture rotation can do. Every nested directory needs a watch.
	source := filepath.Join(t.TempDir(), "service")
	writeCapture(t, filepath.Join(source, "round", "initial.pcap"))
	destination := filepath.Join(root, "service")
	if err := os.Rename(source, destination); err != nil {
		t.Fatal(err)
	}
	initial := filepath.Join(destination, "round", "initial.pcap")
	processUntil(t, watcher, func() bool { return hasCapture(*captures, initial) })

	later := filepath.Join(destination, "round", "later.pcap.1")
	writeCapture(t, later)
	processUntil(t, watcher, func() bool { return hasCapture(*captures, later) })

	// Further directory creation must also be discovered after startup.
	deep := filepath.Join(destination, "round", "next", "deeper", "live.pcapng")
	writeCapture(t, deep)
	processUntil(t, watcher, func() bool { return hasCapture(*captures, deep) })
	if err := os.WriteFile(later, []byte("more capture data"), 0644); err != nil {
		t.Fatal(err)
	}
	before := 0
	for _, path := range *captures {
		if path == later {
			before++
		}
	}
	processUntil(t, watcher, func() bool {
		count := 0
		for _, path := range *captures {
			if path == later {
				count++
			}
		}
		return count > before
	})
}

func TestRemovedOrMovedSubtreesCanBeRecreated(t *testing.T) {
	for _, move := range []bool{false, true} {
		name := "removed"
		if move {
			name = "moved"
		}
		t.Run(name, func(t *testing.T) {
			root := t.TempDir()
			directory := filepath.Join(root, "service")
			writeCapture(t, filepath.Join(directory, "round", "old.pcap"))
			watcher, captures := newTestWatcher(t)
			if err := watcher.Add(root); err != nil {
				t.Fatal(err)
			}
			var err error
			if move {
				err = os.Rename(directory, filepath.Join(t.TempDir(), "moved"))
			} else {
				err = os.RemoveAll(directory)
			}
			if err != nil {
				t.Fatal(err)
			}
			processUntil(t, watcher, func() bool { return len(watcher.directories) == 1 })
			newCapture := filepath.Join(directory, "round", "new.pcap")
			writeCapture(t, newCapture)
			processUntil(t, watcher, func() bool { return hasCapture(*captures, newCapture) })
		})
	}
}

func TestDisappearingPathsAndUnrelatedEventsAreIgnored(t *testing.T) {
	root := t.TempDir()
	watcher, captures := newTestWatcher(t)
	for _, op := range []fsnotify.Op{fsnotify.Create, fsnotify.Write, fsnotify.Rename, fsnotify.Remove, fsnotify.Chmod} {
		if err := watcher.Handle(fsnotify.Event{Name: filepath.Join(root, "gone.pcap"), Op: op}); err != nil {
			t.Fatal(err)
		}
	}
	ignored := filepath.Join(root, "eve.json")
	writeCapture(t, ignored)
	if err := watcher.Handle(fsnotify.Event{Name: ignored, Op: fsnotify.Create}); err != nil {
		t.Fatal(err)
	}
	if len(*captures) != 0 {
		t.Fatalf("unexpected imports: %v", *captures)
	}
}

func TestInvalidRootIsRejected(t *testing.T) {
	root := t.TempDir()
	file := filepath.Join(root, "capture.pcap")
	writeCapture(t, file)
	watcher, _ := newTestWatcher(t)
	for _, path := range []string{file, filepath.Join(root, "missing")} {
		if err := watcher.Add(path); err == nil {
			t.Errorf("expected an error for %s", path)
		}
	}
}

func TestDirectorySymlinksAreNotFollowed(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	writeCapture(t, filepath.Join(outside, "outside.pcap"))
	if err := os.Symlink(outside, filepath.Join(root, "link")); err != nil {
		t.Skipf("directory symlinks unavailable: %v", err)
	}
	watcher, captures := newTestWatcher(t)
	if err := watcher.Add(root); err != nil {
		t.Fatal(err)
	}
	if len(*captures) != 0 {
		t.Fatalf("followed a directory symlink: %v", *captures)
	}
}
