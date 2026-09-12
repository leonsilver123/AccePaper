# T03 — 目录选择器错误处理加固设计稿

> **B-PICK 保持开放**。本加固 ≠ 证明真实崩溃根因；仅补"加载失败 → 稳定类型化错误"的处理缺口。真实根因须真 Windows 复现 + 修复后原错误消失方可关闭 B-PICK。
> 范围止于 `packages/host/directory-picker-native/src/win32-dialog-bindings.ts` + 其测试。不碰 `directory-picker-auto`（2026-08-04 笔记拒绝运行时降级；保留启动时 browse 降级 `resolve.ts:50` 不变）。

## 0. 缺陷定位（已读源码确认）
`win32-dialog-bindings.ts`：
- **L90-94 `loadWin32DialogBindings`**（启动路径，probe2 确认失败点）：
  ```ts
  const koffi = (await import('koffi')).default as unknown as Koffi   // L91
  const ole32 = koffi.load('ole32.dll')                                // L92
  const user32 = koffi.load('user32.dll')                              // L93
  const kernel32 = koffi.load('kernel32.dll')                          // L94
  ```
  无 try/catch、无平台守卫、无降级。`@koromix/koffi-win32-x64`（optionalDeps）缺失 → `koffi.load` 抛错 → worker `post{kind:'error'}` → `win32-dialog.ts:138` reject → `native-picker.ts:69-77` 原样上抛（opaque 异常）。
- **L182-197 `closeThreadWindows`**（abort 路径，L184 `koffi.load('user32.dll')`）：仅在 `loadWin32DialogBindings` 已成功（二进制在）后才可达，故失败概率低；**次要、建议同 pattern 守卫**（防御性一致性）。

处理缺口：加载异常未转为**稳定类型化错误**，上层无法区分"原生二进制缺失"vs"其他系统错误"。

## 1. 修复设计（最小、止于 native）

### 1.1 新增本地类型化错误（非依赖；非根因证明）
```ts
/** 原生绑定加载失败的稳定类型化错误。surfaces as-is（无降级，见 2026-08-04 笔记）。 */
export class Win32BindingsLoadError extends Error {
  readonly code: 'DSH_NATIVE_KOFFI_IMPORT_FAILED' | 'DSH_NATIVE_BINARY_MISSING'
  readonly cause?: unknown
  constructor(code: Win32BindingsLoadError['code'], message: string, cause?: unknown) {
    super(message)
    this.name = 'Win32BindingsLoadError'
    this.code = code
    if (cause !== undefined) this.cause = cause
  }
}
```
> 备选（更轻、贴既有 plain-Error 风格）：`const e = new Error(msg); (e as any).code='...'; throw e`。但用户明确要"类型化错误"，故用子类（本地、非第三方依赖，合规）。

### 1.2 守卫 `loadWin32DialogBindings`（L90-94）
- `import('koffi')` 失败 → `Win32BindingsLoadError('DSH_NATIVE_KOFFI_IMPORT_FAILED', ...)`。
- 各 `koffi.load(dll)` 失败 → `Win32BindingsLoadError('DSH_NATIVE_BINARY_MISSING', "koffi.load('${dll}') failed: ...", cause)`。
- 实现用具名 helper：
  ```ts
  const loadDll = (dll: string): KoffiLibrary => {
    try { return koffi.load(dll) } catch (e) {
      throw new Win32BindingsLoadError('DSH_NATIVE_BINARY_MISSING', `koffi.load('${dll}') failed: ${errMessage(e)}`, e)
    }
  }
  ```
- 成功路径**透明**（无行为变化，不破坏现行测试）。
- 上层（native-picker.ts/win32-dialog.ts）**无需改**：仍 as-is 上抛，但现在抛稳定类型化错误（符合"no fallback、surfaces as-is"）。

### 1.3 守卫 `closeThreadWindows:184`（次要、建议）
同 `loadDll('user32.dll')` pattern，转 `DSH_NATIVE_BINARY_MISSING`。

## 2. DI 失败测试（**错误处理加固覆盖；非根因证明**）

> **定性框定（防止过度声称）**：下列注入式测试证明"守卫将 koffi.load 异常转为稳定 `Win32BindingsLoadError` 且不破坏成功路径"——即**错误处理加固覆盖**。它**不证明**"真实 Windows 崩溃由 koffi.load 缺二进制导致"——后者须真 Windows 复现 + 修复后原错误消失。B-PICK 据此保持开放。

### 2.1 扩展既有 DI 基础设施（复用 installFakeKoffi，非新造）
`tests/win32-dialog-bindings.spec.ts` 的 `ComWorld` 增字段：
```ts
/** 若设置，fake 的 koffi.load 命中即抛此错误（模拟原生二进制缺失/加载失败）。 */
loadThrows?: Error
```
`installFakeKoffi` 的 `load` 分支：
```ts
load: (dll: string) => {
  if (world.loadThrows) throw world.loadThrows
  return { func: (...) => {...} }   // 现有实现不变
}
```
现有测试不设 `loadThrows` → 不受影响。

### 2.2 失败/回归测试矩阵
| # | 场景 | 期望 |
|---|------|------|
| L1 | `comWorld({ loadThrows: new Error('Could not load native module') })` → `loadWin32DialogBindings()` | reject `Win32BindingsLoadError`，`code='DSH_NATIVE_BINARY_MISSING'` |
| L2 | L1 的错误 `.cause` | 含原注入 Error（诊断保留） |
| L3 | L1 错误 message | 含 'ole32.dll'（可定位首个失败 dll） |
| L4 | `import('koffi')` 失败（vi.doMock factory 抛）→ loadWin32DialogBindings | reject `Win32BindingsLoadError`，`code='DSH_NATIVE_KOFFI_IMPORT_FAILED'` |
| L5 | 成功路径（现 `installFakeKoffi(comWorld())` 不变）→ loadWin32DialogBindings | 正常返回 bindings（守卫透明、无回归） |
| L6（次要） | `closeThreadWindows` + `loadThrows` | reject `Win32BindingsLoadError('DSH_NATIVE_BINARY_MISSING')` |

## 3. 不触约束
- 仅 `directory-picker-native`（src + tests）；不碰 `directory-picker-auto`。
- 不新增运行时降级（保留启动时 browse 降级 `resolve.ts:50`）。
- `Win32BindingsLoadError` 为本地类，非第三方依赖。
- DI 注入测试明确标注"错误处理加固覆盖"，**非**"真实崩溃根因证明"。
- B-PICK 不关闭。
- 实施前置：#15 基线 + #16 重命名后（T03 与 research-core 重命名无关，但保持批次顺序）。
- 验证：tsc/vitest 直跑 node 二进制（不经 pnpm，不改锁文件）。

## 4. 与 B-PICK 的关系（明确）
- 本加固**消除处理缺口**（加载失败现可稳定识别/诊断），但**不证根因**。
- 关闭 B-PICK 的唯一路径：真 Windows 环境（缺 `@koromix/koffi-win32-x64` 或同构条件）复现原错误 → 加守卫后该错误转为 `Win32BindingsLoadError` 且上层正常 surface（非崩溃/非 opaque）→ 方可关闭。
- 在那之前：B-PICK 维持 open，T03 交付=错误处理加固（hardening），非根因裁决。
