/* 极简 Service Worker
 * 策略：同源 GET 一律 Stale-While-Revalidate
 *   - 命中缓存：立即返回（≈0ms 秒开），后台静默更新
 *   - 未命中：网络响应，成功后写回缓存
 * 覆盖 index.html / app.js / manifest / 图标 / foliate-js 全部模块
 * （含动态 import() 的 epub.js、mobi.js、vendor/zip.js、vendor/fflate.js 等）
 * 首次访问后断网完全可用。
 */
const CACHE = 'reader-v4'

// 核心预缓存：保证装完 SW 即离线可用（含各格式解析器与 vendor 依赖）
const CORE = [
    './',
    './index.html',
    './app.js',
    './manifest.json',
    './icons/icon-192.png',
    './icons/icon-512.png',
    './foliate-js/view.js',
    './foliate-js/epubcfi.js',
    './foliate-js/progress.js',
    './foliate-js/overlayer.js',
    './foliate-js/text-walker.js',
    './foliate-js/paginator.js',
    './foliate-js/fixed-layout.js',
    './foliate-js/epub.js',
    './foliate-js/mobi.js',
    './foliate-js/fb2.js',
    './foliate-js/search.js',
    './foliate-js/vendor/zip.js',
    './foliate-js/vendor/fflate.js',
]

self.addEventListener('install', e => {
    e.waitUntil((async () => {
        const cache = await caches.open(CACHE)
        // 逐个缓存，单文件失败不阻塞安装（运行期 SWR 兜底）
        await Promise.allSettled(CORE.map(url => cache.add(url)))
        await self.skipWaiting()
    })())
})

self.addEventListener('activate', e => {
    e.waitUntil((async () => {
        for (const key of await caches.keys())
            if (key !== CACHE) await caches.delete(key)
        await self.clients.claim()
    })())
})

self.addEventListener('fetch', e => {
    const { request } = e
    const url = new URL(request.url)
    if (request.method !== 'GET' || url.origin !== self.location.origin) return

    e.respondWith((async () => {
        const cache = await caches.open(CACHE)
        const cached = await cache.match(request, { ignoreSearch: true })

        // 后台更新（含导航请求），失败静默（离线时不动旧缓存）
        const refresh = fetch(request).then(res => {
            if (res && res.ok) cache.put(request, res.clone())
            return res
        }).catch(() => null)

        if (cached) return cached
        const res = await refresh
        // 离线时导航请求兜底到缓存的首页
        if (!res && request.mode === 'navigate') {
            const shell = await cache.match('./index.html')
            if (shell) return shell
        }
        return res || Response.error()
    })())
})
