# Reader — 极简多标签电子书阅读器（PWA）

基于 [foliate-js](https://github.com/johnfactotum/foliate-js) 的本地电子书阅读器：**多本书同时打开（多标签）、拖拽即读、正文自由划选复制、全文搜索跳转选中、断网可用**。零框架、零构建、零后端，克隆即可运行。

**在线试用**：<https://rui3394.github.io/reader/>（图书文件只在浏览器本地解析，不会上传到任何服务器）

## 功能

- **多标签**：同时打开多本书，切换不销毁实例——阅读进度、滚动位置、已划选文字全部保留
- **拖拽即读**：把 `.epub / .azw3 / .mobi / .fb2` 拖到窗口任意位置（含正文上）即可开新书
- **划选复制**：正文强制可选中（`user-select: text`），`Ctrl+C` 直接复制；可一键切换连续滚动模式跨页选长段落
- **全文搜索**：输入 Kindle 上看到的几个字，回车即跳到匹配处**并自动选中**，再按回车跳下一处，`Ctrl+C` 直接带走
- **进度记忆**：以 `文件名+文件大小` 为 key 记录 CFI，重新拖入同一本书自动回到上次位置；底部滑块可按百分比对齐 Kindle 进度
- **PWA 秒开离线**：Service Worker 采用 Stale-While-Revalidate，预缓存全部核心模块（含动态 `import()` 的各格式解析器），首开后断网完全可用，可安装为独立窗口
- **目录跳转**：多级目录递归拍平为下拉框（缩进显示层级）
- 键盘翻页（`← → / PgUp PgDn`，焦点在正文 iframe 内同样有效；不拦截 `Ctrl/Cmd` 组合键与 `Shift+方向键` 扩选）

## 快速开始

需要通过 HTTP 访问（ES Module / Service Worker 限制），任意静态服务器均可：

```bash
git clone https://github.com/rui3394/reader.git
cd reader
npx serve .          # 或 python -m http.server 8080
```

浏览器打开 `http://127.0.0.1:3000`（或对应端口），拖书进去即可。

> 也可以直接为本仓库开启 GitHub Pages（根目录即站点根，无需构建），或部署到任意静态托管。

## 支持格式与限制

| 格式 | 说明 |
|---|---|
| `.epub` | 完整支持 |
| `.azw3` (KF8) / `.mobi` | 支持，大文件解析需数秒；**DRM 加密文件无法打开** |
| `.fb2`（含 `.fb2.zip`） | 支持 |
| `.cbz` | 顺带支持 |

## 技术要点

- `view.js` 的 `<foliate-view>` Web Component 渲染；正文在 sandboxed `blob:` iframe 中，CSP 与 foliate-js 官方 demo 一致（`script-src 'self'`，电子书内嵌脚本全部拦截）
- 多标签用 `visibility` 而非 `display:none` 切换：保留盒模型尺寸，避免 ResizeObserver 重排，Chromium 下滚动位置与划选高亮不丢
- iframe 事件吞噬问题：在 `window` 与每个章节 `doc` 上双份绑定键盘翻页与 `dragover/drop` 转发（`WeakSet` 去重）
- 图书文件经 zip.js 对 `File` 对象**随机访问**，内存占用与书的大小解耦；不做 base64 类整读

目录结构：

```
index.html      UI 与样式（工具栏/标签栏/阅读区/拖拽遮罩）
app.js          全部逻辑（标签管理/进度记忆/搜索/滑块/事件绑定）
sw.js           Service Worker（SWR + 预缓存清单）
manifest.json   PWA 清单（standalone）
icons/          图标（tools/gen-icons.mjs 纯 Node 生成）
foliate-js/     渲染引擎，vendored 自上游 MIT 项目
```

## 致谢与许可

- [foliate-js](https://github.com/johnfactotum/foliate-js)（MIT）— 渲染引擎，vendored 于上游 commit `78914ae`
- 本仓库自有代码以 [MIT](LICENSE) 发布
