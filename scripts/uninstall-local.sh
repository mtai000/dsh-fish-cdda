#!/bin/sh
# 从 profile 里摘掉 dsh-cdda（不动 $DSH_HOME/cdda-duty 里的存档/配置）。
set -eu
PROFILE="${1:-web}"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
[ -f "$PROFILE_DIR/package.json" ] || { echo "找不到 $PROFILE_DIR/package.json" >&2; exit 1; }

node - "$PROFILE_DIR/package.json" <<'NODE'
const fs = require('node:fs')
const file = process.argv[2]
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
if (pkg.dependencies) delete pkg.dependencies['dsh-cdda']
const b = pkg.dsh?.profile?.bundles
if (Array.isArray(b)) pkg.dsh.profile.bundles = b.filter((x) => x !== 'dsh-cdda')
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
NODE
rm -f "$PROFILE_DIR/node_modules/dsh-cdda"
echo "已从 $PROFILE 摘掉 dsh-cdda。存档/配置还在 $DSH_HOME/cdda-duty/。重启 dsh 生效。"
