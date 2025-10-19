package converters

import (
	"encoding/json"
	"fmt"
	"os"
	"sync/atomic"
)

// Load service config from JSON file or use hardcoded defaults
// Waterfall-like effect, each stage's outputs keep falling towards next group, e.g.
// using 2 converters will cause the next group to get the output of those two passed to it.
// Additionally, the original entry is always sent to all of the groups.
var serviceConfig = loadServiceConfig()

func loadServiceConfig() map[int][][]string {
	// Try to load from JSON config file
	configPath := "/data/decoder_config.json"
	if data, err := os.ReadFile(configPath); err == nil {
		var jsonConfig map[string][][]string
		if err := json.Unmarshal(data, &jsonConfig); err == nil {
			// Convert string keys to int keys
			config := make(map[int][][]string)
			for portStr, decoders := range jsonConfig {
				var port int
				if _, err := fmt.Sscanf(portStr, "%d", &port); err == nil {
					config[port] = decoders
				}
			}
			fmt.Printf("Loaded decoder config from %s: %d services configured\n", configPath, len(config))
			return config
		} else {
			fmt.Printf("Error parsing decoder config: %v, using defaults\n", err)
		}
	} else {
		fmt.Printf("Decoder config file not found at %s, using defaults\n", configPath)
	}

	// Fallback to hardcoded defaults
	return map[int][][]string{
		// CyberUniAuth
		1234: {
			{"b64decode", "hexdecode"},
		},
		// ExamNotes
		1235: {
			{"b64decode", "hexdecode"},
		},
		// EncryptedNotes
		1236: {
			{"b64decode", "hexdecode"},
		},
		1237: {
			{"b64decode", "hexdecode"},
		},
		// RPN
		1337: {
			{"b64decode", "hexdecode"},
		},
		// closedsea
		3003: {
			// Protocol
			{"websockets"},
			// Various encodings one could use (should always be last)
			{"b64decode", "hexdecode"},
		},
		// closedseaMinter
		3004: {
			{"b64decode", "hexdecode"},
		},
		// Trademark
		5000: {
			{"b64decode", "hexdecode"},
		},
	}
}

var workerPool = map[string][]*Process{}
var workerAccessCounter = map[string]*uint64{}

// GetWorker
// This is a naive implementation of round-robin, ideally the pool load balancing would give the first free one,
// but this is a lot easier to implement on a shorter timeline (and significantly more reliable against deadlocks!)
func GetWorker(converter string) (*Process, error) {
	workers, ok := workerPool[converter]
	if !ok {
		return nil, fmt.Errorf("no worker for converter %s exists", converter)
	}

	counter := atomic.AddUint64(workerAccessCounter[converter], 1)
	return workers[counter%uint64(len(workers))], nil
}

func StartWorkers(workerCountPerConverter int) {
	var converters = map[string]bool{}
	for _, service := range serviceConfig {
		for _, stages := range service {
			for _, converter := range stages {
				converters[converter] = true
			}
		}
	}

	for converter := range converters {
		var zero uint64 = 0
		workerAccessCounter[converter] = &zero

		// TODO: we could have smarter logic here, e.g. if each service uses b64 converter we want that to have more workers than a static amount
		for i := 0; i < workerCountPerConverter; i++ {
			process, err := NewProcess(converter)
			if err != nil {
				panic(fmt.Errorf("starting converter worker failed: %w", err))
			}

			workerPool[converter] = append(workerPool[converter], process)
		}
	}
}
