# Setup notes for Tulip made by Nick and Isaiah.

## Vulnbox side
```
mkdir -p /var/tmp/tcpdump/
tcpdump -i vulnbox -nn -C 100 -W 100 ! port 22 -w /var/tmp/tcpdump/traffic.pcap
```



Remember that we can edit the tcpdump command to only take traffic from ports we care about to reduce noise

## Tulip host
Create `.env` with `cp .env.example .env`
There's also cwte.env, which is the tulip configuration used during CWTE.
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

### Save the below script on the infra box:
```bash
#!/bin/bash
REMOTE="root@159.89.28.46:/var/tmp/tcpdump/"
LOCAL="/home/tooling/tulip/traffic/tcpdump/"
KEY="/home/thisisjammy25/.ssh/id_ed25519"

mkdir -p "$LOCAL"

rsync -rltDv --delete \
  --no-owner --no-group --no-perms --omit-dir-times \
  -e "ssh -i $KEY -o StrictHostKeyChecking=no" \
  "$REMOTE" "$LOCAL"
```

Remember to make it executable with `chmod +x [script]`

Add the script to crontab with `crontab -e` copying the below line:
```
* * * * * [path to script] >> [path to logs] 2>&1
```

## Start 
`sudo docker compose up --build -d`

## Clear all data
`sudo docker compose down -v --remove-orphans`
