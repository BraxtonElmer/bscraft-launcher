#!/bin/sh
# Copies SimpleLogin's accounts file from the game server so the skin service can check
# passwords. The key used can only print that one file (see server/README.md).
set -eu
DIR=/home/ubuntu/bscraft-skins/data
TMP=$(mktemp "$DIR/.sl_entries.XXXXXX")
trap 'rm -f "$TMP"' EXIT
ssh -n -T -i /home/ubuntu/.ssh/bsc_sl_pull -p 25293 -o BatchMode=yes -o ConnectTimeout=8 -o IdentitiesOnly=yes \
  -o UserKnownHostsFile=/home/ubuntu/bscraft-skins/akariyu_known_hosts -o StrictHostKeyChecking=yes \
  elmer@129.159.19.58 > "$TMP"
# Only replace the copy with a complete, valid list
python3 -c 'import json, sys; d = json.load(open(sys.argv[1])); assert isinstance(d, list)' "$TMP"
chmod 600 "$TMP"
mv "$TMP" "$DIR/sl_entries.dat"
trap - EXIT
