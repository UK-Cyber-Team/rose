# Setup notes for Tulip made by Nick.

## Vulnbox side
```
mkdir -p /tmp/tcpdump
tcpdump -i game -nn -C 100 -W 10 -w /tmp/tcpdump/traffic.pcap
```

Remember that we can edit the tcpdump command to only take traffic from ports we care about to reduce noise

## Tulip host
Create `.env` with `cp .env.example .env`
### Edit .env:
```
TRAFFIC_DIR_HOST="/tmp/tcpdump"
VISUALIZER_URL="http://[IP ADDRESS OF VPS]"
TICK_START to network open
TICK_LENGTH to tick length in milliseconds
FLAG_REGEX
VM_IP
TEAM_ID
FLAGID_SCRAPE=1
```

### Edit services/api/configurations.py
Set:
vm_ip_1 to the vulnbox IP address e.g.:
vm_ip_1 = "10.100.2.1"
Use helper to structure service IPs and ports on the vulnbox, in a `IP:PORT SERVICE_NAME` format e.g.: 
helper = '''
10.100.2.1:2018 redundant
10.100.2.1:9991 potatorecipe
10.100.2.1:5000 exchange
'''

### Run rsync
`rsync -avz --delete root@[VULNBOX IP ADDRESS]:/tmp/tcpdump/ /tmp/tcpdump/`        

## Start 
`sudo docker compose up -d`