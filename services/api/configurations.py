#!/usr/bin/env python
# -*- coding: utf-8 -*-

# This file is part of Flower.
#
# Copyright ©2018 Nicolò Mazzucato
# Copyright ©2018 Antonio Groza
# Copyright ©2018 Brunello Simone
# Copyright ©2018 Alessio Marotta
# DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
#
# Flower is free software: you can redistribute it and/or modify
# it under the terms of the GNU General Public License as published by
# the Free Software Foundation, either version 3 of the License, or
# (at your option) any later version.
#
# Flower is distributed in the hope that it will be useful,
# but WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
# GNU General Public License for more details.
#
# You should have received a copy of the GNU General Public License
# along with Flower.  If not, see <https://www.gnu.org/licenses/>.

import os
import json
from pathlib import Path

traffic_dir = Path(os.getenv("TULIP_TRAFFIC_DIR", "/traffic"))
dump_pcaps_dir = Path(os.getenv("DUMP_PCAPS", "/traffic"))
tick_length = os.getenv("TICK_LENGTH", 2*60*1000)
flag_lifetime = os.getenv("FLAG_LIFETIME", 5)
start_date = os.getenv("TICK_START", "2018-06-27T13:00:00+02:00")
flag_regex = os.getenv("FLAG_REGEX", "[A-Z0-9]{31}=")
vm_ip = os.getenv("VM_IP", "10.10.3.1")
visualizer_url = os.getenv("VISUALIZER_URL", "http://127.0.0.1:1337")
auth_password = os.getenv("AUTH_PASSWORD", "")

# Service configuration file path
services_config_file = Path("/data/services_config.json")

# Decoder configuration file path (for Go assembler)
decoder_config_file = Path("/data/decoder_config.json")

# Available decoders
AVAILABLE_DECODERS = [
    "b64decode",
    "hexdecode",
    "dns",
    "grpc",
    "http2",
    "http_gzip",
    "protobuf",
    "pwntools",
    "pythonrequests",
    "quic",
    "tls",
    "websockets"
]

# Default services (fallback if config file doesn't exist)
vm_ip_1 = "10.60.2.1"
helper = '''
10.61.5.1:1237 CyberUni 4
10.61.5.1:1236 CyberUni 3
10.61.5.1:1235 CyberUni 1
10.61.5.1:1234 CyberUni 2
10.60.5.1:3003 ClosedSea 1
10.60.5.1:3004 ClosedSea 2
10.62.5.1:5000 Trademark
10.63.5.1:1337 RPN
'''

default_services = [{"ip": x.split(" ")[0].split(":")[0], "port": int(x.split(" ")[0].split(":")[1]), "name": " ".join(x.split(" ")[1:])} for x in helper.strip().split("\n")]
default_services += [{"ip": vm_ip_1, "port": -1, "name": "other"}]

def load_services():
    """Load services from config file, or use defaults if file doesn't exist."""
    try:
        if services_config_file.exists():
            with open(services_config_file, 'r') as f:
                services_data = json.load(f)
                # Ensure backward compatibility - add empty decoders if not present
                for service in services_data:
                    if 'decoders' not in service:
                        service['decoders'] = [[]]
                return services_data
    except Exception as e:
        print(f"Error loading services config: {e}")
    
    # Add decoders to default services
    for service in default_services:
        service['decoders'] = [[]]
    return default_services

def save_services(services_list):
    """Save services to config file and generate decoder config for Go assembler."""
    try:
        services_config_file.parent.mkdir(parents=True, exist_ok=True)
        
        # Save services config
        with open(services_config_file, 'w') as f:
            json.dump(services_list, f, indent=2)
        
        # Generate decoder config for Go assembler
        save_decoder_config(services_list)
        
        return True
    except Exception as e:
        print(f"Error saving services config: {e}")
        return False

def save_decoder_config(services_list):
    """Generate decoder_config.json for Go assembler from services list."""
    try:
        decoder_config = {}
        
        for service in services_list:
            port = service.get('port')
            decoders = service.get('decoders', [[]])
            
            # Only add to decoder config if port is valid and decoders are specified
            if port and port > 0 and decoders and any(stage for stage in decoders if stage):
                # Filter out empty stages
                non_empty_stages = [stage for stage in decoders if stage]
                if non_empty_stages:
                    decoder_config[str(port)] = non_empty_stages
        
        # Write decoder config
        decoder_config_file.parent.mkdir(parents=True, exist_ok=True)
        with open(decoder_config_file, 'w') as f:
            json.dump(decoder_config, f, indent=2)
        
        print(f"Saved decoder config: {decoder_config}")
        return True
    except Exception as e:
        print(f"Error saving decoder config: {e}")
        return False

services = load_services()
