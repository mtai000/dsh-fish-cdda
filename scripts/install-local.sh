#!/bin/sh
# 没有 pnpm 时，把本插件 link 进一个 DSH profile。
# 用法：./scripts/install-local.sh [profile]   （默认 web）
set -eu
PROFILE="${1:-web}"
PLUGIN_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PROFILE_DIR="$DSH_HOME/profiles/$PROFILE"
[ -d "$PROFILE_DIR" ] || { echo "找不到 profile：$PROFILE_DIR（先用 dsh $PROFILE 启动一次）" >&2; exit 1; }

mkdir -p "$PROFILE_DIR/node_modules"
ln -sfn "$PLUGIN_DIR" "$PROFILE_DIR/node_modules/dsh-cdda"

node - "$PROFILE_DIR/package.json" "$PLUGIN_DIR" <<'NODE'
const fs = require('node:fs')
const [file, pluginDir] = process.argv.slice(2)
const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
pkg.dependencies = pkg.dependencies || {}
pkg.dependencies['dsh-cdda'] = 'link:' + pluginDir
pkg.dsh = pkg.dsh || {}
pkg.dsh.profile = pkg.dsh.profile || {}
const bundles = pkg.dsh.profile.bundles = pkg.dsh.profile.bundles || []
if (!bundles.includes('dsh-cdda')) bundles.push('dsh-cdda')
fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n')
NODE

echo "已 link 到 $PROFILE_DIR"
echo "现在重启一次 dsh（bundle 层要重启才组装），然后进 设置 → CDDA 陪玩。"
echo "旁观摩：screen -x cdda    screen -x cdda_log"
