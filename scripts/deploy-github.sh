#!/usr/bin/env bash
# Publication sur GitHub Pages + création du dépôt privé de données.
# Usage : OWNER=<pseudo> [BUNDLE=1] scripts/deploy-github.sh
# Prérequis : accès GitHub authentifié (gh/API) ; dist/ construit.
set -euo pipefail
OWNER="${OWNER:?OWNER requis}"
APP_REPO="${APP_REPO:-psycho304}"
DATA_REPO="${DATA_REPO:-psycho304-donnees}"
API=https://api.github.com
H=(-H "Accept: application/vnd.github+json" -H "X-GitHub-Api-Version: 2022-11-28")
[ -n "${GITHUB_TOKEN:-}" ] && H+=(-H "Authorization: Bearer $GITHUB_TOKEN")
root="$(cd "$(dirname "$0")/.." && pwd)"

exists() { curl -s -o /dev/null -w "%{http_code}" "${H[@]}" "$API/repos/$OWNER/$1"; }
create() { curl -sf "${H[@]}" -X POST "$API/user/repos" -d "{\"name\":\"$1\",\"private\":$2,\"auto_init\":true,\"description\":\"$3\"}" >/dev/null; }

[ "$(exists "$DATA_REPO")" = 200 ] || create "$DATA_REPO" true "Psycho 304 — progression et modules (privé)"
[ "$(exists "$APP_REPO")" = 200 ] || create "$APP_REPO" false "Psycho 304 — application de révision (PWA)"

# Modules de cours privés : dépôt de données (contenus/<paquet>.json), sans écraser l'existant
DATA_DIR="${DATA_DIR:-$root/../depot-donnees}"
if [ -d "$DATA_DIR/contenus" ]; then
  for f in "$DATA_DIR"/contenus/*.json; do
    name="contenus/$(basename "$f")"
    code=$(curl -s -o /dev/null -w "%{http_code}" "${H[@]}" "$API/repos/$OWNER/$DATA_REPO/contents/$name")
    if [ "$code" = 404 ]; then
      python3 -c 'import base64,json,sys; print(json.dumps({"message":"Module "+sys.argv[2],"content":base64.b64encode(open(sys.argv[1],"rb").read()).decode()}))' "$f" "$name" \
        | curl -sf "${H[@]}" -X PUT "$API/repos/$OWNER/$DATA_REPO/contents/$name" -d @- >/dev/null && echo "Ajouté : $name"
    fi
  done
fi

# Site : branche gh-pages = contenu de dist/
tmp="$(mktemp -d)"; cp -r "$root/dist/." "$tmp/"; touch "$tmp/.nojekyll"
cd "$tmp"; git init -q -b gh-pages; git add -A
git -c user.name="Psycho 304" -c user.email="psycho304@users.noreply.github.com" commit -qm "Publication $(date -u +%FT%TZ)"
git push -qf "https://github.com/$OWNER/$APP_REPO.git" gh-pages
curl -s "${H[@]}" -X POST "$API/repos/$OWNER/$APP_REPO/pages" -d '{"source":{"branch":"gh-pages","path":"/"}}' >/dev/null || true
echo "Site : https://$OWNER.github.io/$APP_REPO/"
