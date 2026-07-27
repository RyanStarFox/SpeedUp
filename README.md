# SpeedUp

油猴脚本：为 **Bilibili** 与 **YouTube** 提供更丰富的播放倍速（预设 + 自定义），记忆倍率，并支持长按 O / P 临时变速。

当前版本：**1.6.0**。每次影响用户行为的发布都会更新油猴元数据中的 `@version`。

## 安装

1. Safari 可使用 [Userscripts](https://github.com/quoid/userscripts) 或 [Tampermonkey](https://www.tampermonkey.net/)；Chrome/Edge/Firefox 可使用 Tampermonkey
2. **Chrome / Edge 138+**：扩展详情里打开 **允许运行用户脚本 / Allow User Scripts**（或开启开发者模式），否则脚本不会执行
3. 打开管理面板 →「添加新脚本」
4. 将仓库根目录的 [`speedup.user.js`](./speedup.user.js) 全文粘贴保存（已装过的请整份覆盖升级到 **v1.4.1+**）
5. 打开 B 站视频页或 YouTube 视频页，**硬刷新**（Cmd/Ctrl+Shift+R）
6. 打开控制台应看到：`[SpeedUp] v1.4.1 active on ...`；播放器控制栏应出现倍速按钮（如 `1.0x`）

## 功能

| 能力 | 说明 |
|---|---|
| 预设 | `0.5 / 1 / 1.5 / 2 / 2.5 / 3` |
| 自定义 | 输入 `0.1`–`10.0`，回车或失焦生效 |
| 记忆 | 默认按站点分别记忆（B 站 / YouTube） |
| 长按 **P** | 按下 ≥0.5s 后，在当前设定倍速上 ×1.5（十分位四舍五入） |
| 长按 **O** | 按下 ≥0.5s 后，在当前设定倍速上 ×0.5 |
| 松手 | 恢复为已设定的基础倍速 |
| **;** / **'** | 视频播放中且不在文本输入时，永久减速 / 加速 `0.5`；长按 ≥0.5s 后每 0.2s 重复 |
| **,** / **.** | 视频播放中且不在文本输入时，永久减速 / 加速 `0.1`；长按 ≥0.5s 后每 0.1s 重复 |
| **O** / **P** | 视频播放中且不在文本输入时，临时 `×0.5 / ×1.5` |

实际播放速度通过底层 `video.playbackRate` 设置（可突破站点官方菜单约 2× 的上限）。控制栏上的倍速文字会同步显示**当前有效速度**（含长按期间）。

## 站点差异

- **Bilibili**：隐藏原生「倍速」控件，在原位置插入脚本自己的倍速按钮/菜单；只会写入可访问 `<video>` 的 `playbackRate`，不会修改 Shadow DOM 或浏览器全局媒体原型。
- **YouTube**：官方设置里的倍速 API 常卡在约 2×，因此在控制栏右侧注入 `ytp-button` 风格的倍速按钮 + 菜单；长按 O/P 时该按钮文字会更新。

覆盖范围：YouTube 普通观看；B 站普通视频、多 P、番剧。不覆盖 Shorts、直播。

## 若完全没反应

1. 确认 Tampermonkey 图标里本脚本为启用，且当前页匹配
2. 确认已允许用户脚本（见上方安装第 2 步）
3. 控制台有无 `[SpeedUp] v1.4.1 active`；没有 = 脚本未注入
4. 输入框聚焦时 O/P 会被忽略；需按住 **≥0.5 秒** 才会临时变速

## 修改记忆方式

编辑脚本顶部 `CONFIG`：

```js
memoryMode: 'per-site', // 默认：分站点记忆
// memoryMode: 'global', // 仅同一站点下使用同一个本地键
```

Safari 兼容性要求脚本以页面上下文运行（`@grant none`），因此使用站点原生 `localStorage` 保存倍率。浏览器安全策略不允许在 YouTube 与 B 站两个不同域名之间直接共享本地存储；默认的「分站点记忆」不受影响。

## 已知限制

- 浏览器对 `playbackRate` 大约允许到 16×；本脚本限制在 **0.1–10.0**。
- Chrome 等常在 **&lt;0.5× 或 &gt;4×** 时静音，画面仍可能继续播。
- 站点改版可能导致菜单选择器失效；此时快捷键与 `playbackRate` 仍可能可用。
- 不保证与其它倍速扩展共存。
- 在输入框打字时 O/P 会被忽略；且需按住 0.5s 才触发，减少误触。

## 开发

```bash
node tests/rate-math.test.js
```

速率计算逻辑在 `lib/rate-math.js`，并内联于 `speedup.user.js`。

## 致谢

Bilibili 倍速菜单等待与替换的简化思路参考了
[lgldlk/bilibiliRateChange](https://github.com/lgldlk/bilibiliRateChange)。
