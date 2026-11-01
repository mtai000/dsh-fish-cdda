/**
 * client-render.test.mjs —— 设置页 / 「cdda录制」会话视图必须能渲染
 *
 * 用极小的 React 假实现把组件跑一遍：少变量、写错名字会立刻炸。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

function loadClient() {
  const src = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
  const React = {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useState: (v) => [typeof v === 'function' ? v() : v, () => {}],
    useEffect: () => {},
    useCallback: (f) => f,
  }
  let mod = null
  const style = { setAttribute() {}, remove() {}, textContent: '' }
  const document = { createElement: () => style, head: { appendChild() {} } }
  const window = { __ModuleLoader__: { load: (m) => { mod = m } } }
  const ctx = {
    window, document,
    require: () => React,
    fetch: async () => ({ ok: false, status: 500, json: async () => ({ ok: false }) }),
    navigator: { clipboard: { writeText: async () => {} } },
    console, setInterval: () => 0, clearInterval: () => {}, setTimeout: () => 0,
  }
  vm.createContext(ctx)
  vm.runInContext(src, ctx)
  assert.ok(mod, '模块没有被注册到 __ModuleLoader__')
  return { exports: mod.factory(() => React), React }
}

function walkCount(t) {
  if (t == null || typeof t !== 'object') return 0
  return 1 + (t.children ?? []).reduce((n, c) => n + walkCount(c), 0)
}

test('「cdda录制」会话视图能渲染', () => {
  const { exports } = loadClient()
  const registered = []
  const slots = {
    inject: (_name, fn) => { try { fn() } catch { /* ignore */ } },
    register: (spec, comp) => { registered.push({ spec, comp }); return () => {} },
  }
  exports.apply({ get: (k) => (k === 'slots' ? slots : null), effect: (fn) => fn() })
  const rec = registered.find((x) => x.spec.id === 'cdda-recordings')
  assert.ok(rec, '没有注册 cdda-recordings 视图')
  assert.equal(rec.spec.name, 'conversation.view')
  const tree = rec.comp()
  assert.ok(tree, '会话视图返回空')
  assert.ok(walkCount(tree) > 3, '会话视图节点太少')
})

test('设置页能渲染', () => {
  const { exports } = loadClient()
  const registered = []
  const slots = {
    inject: (_name, fn) => { try { fn() } catch { /* ignore */ } },
    register: (spec, comp) => { registered.push({ spec, comp }); return () => {} },
  }
  exports.apply({ get: (k) => (k === 'slots' ? slots : null), effect: (fn) => fn() })
  const page = registered.find((x) => x.spec.id === 'cdda-duty')
  assert.ok(page, '没有注册设置页')
  const tree = page.comp()
  assert.ok(tree, '设置页返回空')
})
