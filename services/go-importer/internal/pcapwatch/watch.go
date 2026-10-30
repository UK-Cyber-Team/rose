// Package pcapwatch imports captures and watches directories recursively.
package pcapwatch

import (
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/fsnotify/fsnotify"
)

type Watcher struct {
	*fsnotify.Watcher
	directories map[string]struct{}
	handlePcap  func(string)
	readyDelay  time.Duration
}

func New(handlePcap func(string)) (*Watcher, error) {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	return &Watcher{
		Watcher:     watcher,
		directories: make(map[string]struct{}),
		handlePcap:  handlePcap,
		readyDelay:  2 * time.Second,
	}, nil
}

// Add watches every directory in a subtree and imports its existing captures.
// Register each watch before reading its children so new files also emit events.
// Like filepath.WalkDir, it does not follow directory symlinks.
func (watcher *Watcher) Add(directory string) error {
	directory, err := filepath.Abs(directory)
	if err != nil {
		return err
	}
	info, err := os.Stat(directory)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return fmt.Errorf("%s is not a directory", directory)
	}

	return filepath.WalkDir(directory, func(path string, entry fs.DirEntry, walkErr error) error {
		if os.IsNotExist(walkErr) {
			return nil // A capture or directory may disappear during rotation.
		}
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() {
			if _, exists := watcher.directories[path]; !exists {
				if err := watcher.Watcher.Add(path); err != nil {
					if os.IsNotExist(err) {
						return filepath.SkipDir
					}
					return err
				}
				watcher.directories[path] = struct{}{}
				log.Println("Watching PCAP directory:", path)
			}
		} else if strings.Contains(entry.Name(), ".pcap") {
			watcher.handlePcap(path)
		}
		return nil
	})
}

// Handle processes one filesystem event. Call it serially with Add, since the
// packet assembler and directory bookkeeping are shared across captures.
func (watcher *Watcher) Handle(event fsnotify.Event) error {
	if event.Op&(fsnotify.Remove|fsnotify.Rename) != 0 {
		// A moved directory is no longer part of the capture tree. Stop watching
		// its descendants too; the OS may already have removed some watches.
		for directory := range watcher.directories {
			if directory == event.Name || strings.HasPrefix(directory, event.Name+string(os.PathSeparator)) {
				watcher.Watcher.Remove(directory)
				delete(watcher.directories, directory)
			}
		}
		return nil
	}
	if event.Op&(fsnotify.Create|fsnotify.Write) == 0 {
		return nil
	}
	info, err := os.Stat(event.Name)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if info.IsDir() {
		if event.Op&fsnotify.Create != 0 {
			return watcher.Add(event.Name)
		}
		return nil
	}
	// Preserve Rose's support for rotated names such as traffic.pcap.1.
	if strings.Contains(info.Name(), ".pcap") {
		log.Println("Found new file", event.Name, event.Op.String())
		time.Sleep(watcher.readyDelay)
		watcher.handlePcap(event.Name)
	}
	return nil
}
