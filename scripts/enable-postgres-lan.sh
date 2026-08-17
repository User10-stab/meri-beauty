#!/usr/bin/env bash
set -euo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Run this script with sudo." >&2
  exit 1
fi

PG_CONF=/etc/postgresql/16/main/postgresql.conf
PG_HBA=/etc/postgresql/16/main/pg_hba.conf
LAN_ADDRESS=192.168.11.130
LAN_CIDR=192.168.11.0/24
DB_NAME=meribeauty
DB_USER=meri
BACKUP_SUFFIX=.before-meri-lan

for config_file in "$PG_CONF" "$PG_HBA"; do
  if [[ ! -f "$config_file" ]]; then
    echo "Missing expected PostgreSQL configuration: $config_file" >&2
    exit 1
  fi
  if [[ ! -f "${config_file}${BACKUP_SUFFIX}" ]]; then
    cp --preserve=all "$config_file" "${config_file}${BACKUP_SUFFIX}"
  fi
done

# Debian's cluster-aware configuration utility safely replaces or adds the
# effective setting without relying on a fragile line-number edit.
pg_conftool 16 main set listen_addresses "localhost,${LAN_ADDRESS}"

HBA_RULE="host    ${DB_NAME}    ${DB_USER}    ${LAN_CIDR}    scram-sha-256"
if ! grep -Fqx "$HBA_RULE" "$PG_HBA"; then
  printf '\n# Meri Beauty: LAN-only DB audit access\n%s\n' "$HBA_RULE" >> "$PG_HBA"
fi

# Refuse to restart with malformed configuration. Debian keeps the cluster's
# config under /etc/postgresql rather than inside PGDATA, so pass it explicitly.
su -s /bin/sh postgres -c "/usr/lib/postgresql/16/bin/postgres -D /var/lib/postgresql/16/main -c config_file=${PG_CONF} -C data_directory" >/dev/null
systemctl restart postgresql@16-main.service

# Do not enable or otherwise change UFW policy. If it is already active, add
# only the project LAN subnet—not a public/all-source rule.
if command -v ufw >/dev/null 2>&1 && ufw status | grep -q '^Status: active'; then
  ufw allow from "$LAN_CIDR" to "$LAN_ADDRESS" port 5432 proto tcp comment 'Meri Beauty PostgreSQL LAN'
fi

echo "PostgreSQL listeners:"
ss -ltn | grep ':5432'
echo
echo "LAN rule: $HBA_RULE"
echo "Backups: ${PG_CONF}${BACKUP_SUFFIX} and ${PG_HBA}${BACKUP_SUFFIX}"
