#!/bin/sh
# Runs from the nginx image's entrypoint (/docker-entrypoint.d/) before nginx
# starts. Puts this release's hashed assets next to those of the releases before
# it, in the volume nginx serves /assets/ from. A tab or an installed app still
# running an older release lazy-loads that release's chunks long after a
# deploy; with only the newest build's files present, the import fails and the
# app reloads mid-task, losing what was typed. The assets of the last
# KEEP_RELEASES releases stay; older ones are deleted.
set -eu

DIST=/opt/jasmin/dist
STORE=/srv/jasmin-frontend
KEEP_RELEASES=3
export LC_ALL=C

mkdir -p "$STORE/assets" "$STORE/releases"

# The list of assets this release needs, named after its index.html: each
# build has its own, and a restart of the same build rewrites its list instead
# of counting as another release.
release=$(sha1sum "$DIST/index.html" | cut -c1-16)
(cd "$DIST/assets" && find . -type f) > "$STORE/releases/$release"

# Asset names carry their content hash, so a file of that name is already the
# right one and stays as it is. File by file: busybox's ``cp -Rn`` skips a
# directory that exists, contents and all.
while read -r asset; do
  if [ ! -e "$STORE/assets/$asset" ]; then
    mkdir -p "$(dirname "$STORE/assets/$asset")"
    cp "$DIST/assets/$asset" "$STORE/assets/$asset"
  fi
done < "$STORE/releases/$release"

# Keep the newest lists, then every asset one of them names.
ls -1t "$STORE/releases" | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
  rm -f "$STORE/releases/$old"
done
sort -u "$STORE"/releases/* > /tmp/assets-kept
(cd "$STORE/assets" && find . -type f) | sort | comm -23 - /tmp/assets-kept |
  while read -r stale; do
    rm -f "$STORE/assets/$stale"
  done
rm -f /tmp/assets-kept
