#!/usr/bin/env bash
set -Eeuo pipefail

export PATH="/home/peipei/.local/node-v24.21.0-linux-x64/bin:$PATH"

release_id="${1:?missing release id}"
home_dir="/home/peipei"
app_dir="$home_dir/ideact"
stage_dir="$home_dir/releases/$release_id"
backup_dir="$home_dir/backups/ideact-$release_id"
failed_dir="$home_dir/releases/failed-$release_id"
archive="/tmp/ideact-release-$release_id.tar.gz"
incoming_env="/tmp/ideact.env.$release_id"
nginx_config="/etc/nginx/sites-available/ideact"
nginx_backup="/tmp/ideact.nginx.$release_id.bak"
service_config="/etc/systemd/system/ideact.service"
service_backup="/tmp/ideact.service.$release_id.bak"
switched=0

rollback() {
  status=$?
  if [[ "$switched" == "1" && -d "$backup_dir" ]]; then
    echo "ROLLBACK_START"
    sudo systemctl stop ideact.service || true
    [[ -e "$failed_dir" ]] && failed_dir="$failed_dir-$(date +%s)"
    [[ -d "$app_dir" ]] && mv "$app_dir" "$failed_dir"
    mv "$backup_dir" "$app_dir"
    sudo cp "$nginx_backup" "$nginx_config"
    sudo cp "$service_backup" "$service_config"
    sudo systemctl daemon-reload
    sudo nginx -t
    sudo systemctl restart ideact.service
    sudo systemctl reload nginx
    echo "ROLLBACK_OK"
  fi
  exit "$status"
}
trap rollback ERR

test -f "$archive"
test -f "$incoming_env"
test -d "$app_dir"
test ! -e "$stage_dir"
test ! -e "$backup_dir"

mkdir -p "$home_dir/releases" "$home_dir/backups" "$stage_dir"
tar -xzf "$archive" -C "$stage_dir"
cd "$stage_dir"
npm ci --omit=dev --no-audit --no-fund

cp "$incoming_env" .env
chmod 600 .env
if grep -q '^MVP_COOKIE_SECURE=' .env; then
  sed -i 's/^MVP_COOKIE_SECURE=.*/MVP_COOKIE_SECURE=true/' .env
else
  printf '\nMVP_COOKIE_SECURE=true\n' >> .env
fi

if [[ -d "$app_dir/data" ]]; then
  cp -a "$app_dir/data" "$stage_dir/data"
else
  mkdir -p "$stage_dir/data"
fi
if [[ -d "$app_dir/public/generated-images" ]]; then
  mkdir -p "$stage_dir/public"
  cp -a "$app_dir/public/generated-images" "$stage_dir/public/generated-images"
fi

sudo cp "$nginx_config" "$nginx_backup"
sudo cp "$service_config" "$service_backup"

sudo systemctl stop ideact.service
mv "$app_dir" "$backup_dir"
mv "$stage_dir" "$app_dir"
switched=1

sudo install -m 644 "$app_dir/deploy/ideact.service" "$service_config"
sudo install -m 644 "$app_dir/deploy/ideact.nginx.conf" "$nginx_config"
sudo systemctl daemon-reload
sudo nginx -t
sudo systemctl restart ideact.service

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8080/api/auth/status >/dev/null; then
    break
  fi
  sleep 1
done
curl -fsS http://127.0.0.1:8080/api/auth/status >/dev/null
sudo systemctl reload nginx
public_status=""
for _ in $(seq 1 30); do
  public_status="$(curl -ksS -o /dev/null -w '%{http_code}' https://121.41.88.142/ || true)"
  if [[ "$public_status" == "200" ]]; then
    break
  fi
  sleep 1
done
test "$public_status" = "200"

trap - ERR
echo "DEPLOY_OK release=$release_id backup=$backup_dir"
