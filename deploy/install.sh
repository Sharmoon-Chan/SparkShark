#!/usr/bin/env bash
set -euo pipefail

deploy_root="${MYRESUME_ROOT:-/data/workspace/myresume}"
deploy_port="${MYRESUME_PORT:-8787}"
nginx_image="${MYRESUME_IMAGE:-nginx:stable-alpine}"
release_id="${1:?Pass the release ID from deployment.json}"
source_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

[[ "$deploy_root" =~ ^/[a-zA-Z0-9_./-]+$ && "$deploy_root" != / && "$deploy_root" != *..* ]] || { echo 'Invalid deployment root' >&2; exit 2; }
[[ "$release_id" =~ ^[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid release ID' >&2; exit 2; }
[[ "$deploy_port" =~ ^[0-9]+$ && "$deploy_port" -ge 1024 && "$deploy_port" -le 65535 ]] || { echo 'Invalid port' >&2; exit 2; }
[[ "$nginx_image" =~ ^[a-zA-Z0-9_./:@-]+$ ]] || { echo 'Invalid image' >&2; exit 2; }
for executable in docker curl; do
    command -v "$executable" >/dev/null || { echo "Missing prerequisite: $executable" >&2; exit 2; }
done
docker compose version >/dev/null
[[ -f "$source_dir/dist/index.html" && -f "$source_dir/dist/fonts/manifest.json" && -d "$source_dir/dist/pdf-assets/wasm" ]] || { echo 'Incomplete build' >&2; exit 2; }
if [[ -e "$deploy_root" && ! -f "$deploy_root/.myresume-deployment" ]]; then
    echo "Refusing to replace an unmanaged directory: $deploy_root" >&2
    exit 2
fi
if docker inspect myresume-web >/dev/null 2>&1; then
    project="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' myresume-web)"
    [[ "$project" == myresume ]] || { echo 'myresume-web belongs to another deployment.' >&2; exit 2; }
fi
if [[ -e "$deploy_root/current" && ! -L "$deploy_root/current" ]]; then
    echo 'current must be a managed release symlink.' >&2
    exit 2
fi

if ! docker image inspect "$nginx_image" >/dev/null 2>&1; then docker pull "$nginx_image"; fi
mkdir -p "$deploy_root/releases"
touch "$deploy_root/.myresume-deployment"
release_dir="$deploy_root/releases/$release_id"
if [[ -e "$release_dir" ]]; then
    echo "Release already exists: $release_dir" >&2
    exit 2
fi
mkdir "$release_dir"
cp -a "$source_dir/dist" "$release_dir/public"
cp -a "$source_dir/deploy" "$release_dir/deploy"
if [[ -d "$deploy_root/current/assets" ]]; then
    # Hashed assets are immutable; retain old chunks for pages opened before this update.
    cp -a "$deploy_root/current/assets/." "$release_dir/public/assets/"
fi
find "$release_dir/public" -type d -exec chmod 755 {} +
find "$release_dir/public" -type f -exec chmod 644 {} +
chmod 755 "$deploy_root" "$deploy_root/releases" "$release_dir"

sed -e "s|__DEPLOY_ROOT__|$deploy_root|g" -e "s|__PORT__|$deploy_port|g" "$source_dir/deploy/nginx.conf.template" > "$deploy_root/nginx-$release_id.conf"
sed -e "s|__DEPLOY_ROOT__|$deploy_root|g" -e "s|__PORT__|$deploy_port|g" -e "s|__IMAGE__|$nginx_image|g" "$source_dir/deploy/compose.yaml.template" > "$deploy_root/compose-$release_id.yaml"
docker compose -f "$deploy_root/compose-$release_id.yaml" config --quiet
docker run --rm --network none --read-only --tmpfs /tmp --tmpfs /var/cache/nginx --tmpfs /var/run \
    -v "$deploy_root:$deploy_root:ro" -v "$deploy_root/nginx-$release_id.conf:/etc/nginx/myresume.conf:ro" \
    --entrypoint nginx "$nginx_image" -t -c /etc/nginx/myresume.conf
previous_release="$(readlink "$deploy_root/current" 2>/dev/null || true)"
if [[ -n "$previous_release" ]]; then printf '%s\n' "$previous_release" > "$deploy_root/previous-release"; fi
for file in nginx.conf compose.yaml; do if [[ -f "$deploy_root/$file" ]]; then cp -a "$deploy_root/$file" "$deploy_root/$file.previous"; fi; done
mv "$deploy_root/nginx-$release_id.conf" "$deploy_root/nginx.conf"
mv "$deploy_root/compose-$release_id.yaml" "$deploy_root/compose.yaml"
ln -s "$release_dir/public" "$deploy_root/.current-$release_id"
mv -Tf "$deploy_root/.current-$release_id" "$deploy_root/current"

docker compose -f "$deploy_root/compose.yaml" up -d --force-recreate
curl --fail --silent --show-error --retry 5 --retry-delay 1 --retry-connrefused "http://127.0.0.1:$deploy_port/healthz"
printf '\nRelease: %s\nRoot: %s\nOrigin: http://127.0.0.1:%s\n' "$release_id" "$deploy_root" "$deploy_port"
