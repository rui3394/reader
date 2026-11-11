import './foliate-js/view.js'

/* ───────────────────────── 基础引用与状态 ───────────────────────── */

const $ = s => document.querySelector(s)
const viewsEl = $('#views'), tabsEl = $('#tabs'), tocSel = $('#tocSelect')
const flowBtn = $('#flowBtn'), statusEl = $('#status')
const slider = $('#progressSlider'), searchBox = $('#searchBox'), searchInfo = $('#searchInfo')
const overlay = $('#dropOverlay'), fileInput = $('#fileInput')

// 阅读进度记忆：文件名+大小 为 key，存 relocate 给出的 CFI
const posKey = file => 'reader:pos:' + file.name + ':' + file.size

const state = {
    seq: 0,          // 标签自增 id
    tabs: new Map(), // id -> tab
    active: null,    // 当前激活标签 id
    flow: 'paginated',
}

const activeTab = () => state.tabs.get(state.active)

const SUPPORTED = name => {
    name = name.toLowerCase()
    return /\.(epub|azw3|azw|mobi|prc|fb2|fbz|cbz)$/.test(name) || name.endsWith('.fb2.zip')
}

// foliate metadata 的 title 可能是字符串或 { lang: string }
const bookTitle = (meta, fallback) => {
    const t = meta?.title
    return (typeof t === 'string' ? t : t ? Object.values(t)[0] : '') || fallback
}

/* ───────────────────────── 键盘翻页（window + iframe doc 双绑定） ───────────────────────── */

const onKey = e => {
    // 复制（Ctrl/Cmd+C）、扩展选区（Shift+方向键）、浏览器快捷键一律不拦截
    if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return
    const t = e.target
    if (t && /^(SELECT|INPUT|TEXTAREA|BUTTON)$/.test(t.tagName)) return
    const tab = activeTab()
    if (!tab || !tab.ready) return
    switch (e.key) {
        case 'ArrowLeft': case 'PageUp':
            e.preventDefault(); tab.view.goLeft(); break
        case 'ArrowRight': case 'PageDown':
            e.preventDefault(); tab.view.goRight(); break
    }
}
window.addEventListener('keydown', onKey)

/* ───────────────────────── 全局拖拽（含 iframe 内转发） ───────────────────────── */

let overlayTimer = 0
const isFileDrag = e => e.dataTransfer
    && Array.prototype.includes.call(e.dataTransfer.types || [], 'Files')

const showOverlay = () => {
    clearTimeout(overlayTimer)
    overlay.hidden = false
    // 拖拽事件一旦停止（离开窗口/松手），150ms 后自动隐藏，避免计数器错乱
    overlayTimer = setTimeout(() => { overlay.hidden = true }, 150)
}
const handleDrop = e => {
    if (!isFileDrag(e)) return
    e.preventDefault()
    clearTimeout(overlayTimer)
    overlay.hidden = true
    openFiles(e.dataTransfer.files)
}
window.addEventListener('dragenter', e => { if (isFileDrag(e)) { e.preventDefault(); showOverlay() } })
window.addEventListener('dragover', e => { if (isFileDrag(e)) { e.preventDefault(); showOverlay() } })
window.addEventListener('dragleave', e => { if (isFileDrag(e)) showOverlay() })
window.addEventListener('drop', handleDrop)

/* ───────────────────────── 打开图书 ───────────────────────── */

function openFiles(fileList) {
    const files = Array.from(fileList).filter(f => SUPPORTED(f.name))
    if (!files.length) return
    for (const f of files) openBook(f).catch(console.error)
}

async function openBook(file) {
    const id = ++state.seq
    const fallbackName = file.name.replace(/\.[^.]+$/, '')
    const wrap = document.createElement('div')
    wrap.className = 'book'
    wrap.dataset.id = id
    wrap.innerHTML = '<div class="msg">正在解析《' + fallbackName + '》…</div>'

    const tab = { id, name: fallbackName, wrap, ready: false, toc: [] }
    state.tabs.set(id, tab)
    viewsEl.append(wrap)
    document.body.classList.add('has-books')
    renderTabs()
    activateTab(id)

    try {
        const view = document.createElement('foliate-view')
        tab.view = view
        wrap.replaceChildren(view)

        await view.open(file)
        tab.name = bookTitle(view.book.metadata, fallbackName)
        tab.toc = flattenTOC(view.book.toc)

        view.addEventListener('relocate', ({ detail }) => {
            tab.fraction = detail.fraction
            tab.loc = detail.location?.current
            tab.lastCfi = detail.cfi
            // 节流写回阅读进度（relocate 在翻页/滚动时高频触发）
            clearTimeout(tab.saveTimer)
            tab.saveTimer = setTimeout(() => {
                try { localStorage.setItem(posKey(file), tab.lastCfi) } catch {}
            }, 800)
            if (tab.id === state.active) {
                updateStatus(tab)
                syncTocSelect(detail.tocItem?.href)
                if (!scrubbing && detail.fraction != null) slider.value = detail.fraction
            }
        })
        // 章节内容渲染在内部 iframe 中：键盘翻页、拖拽开书都要在 doc 上再绑一份
        view.addEventListener('load', ({ detail: { doc } }) => attachDoc(doc))

        view.renderer.setAttribute('flow', state.flow)
        let saved = null
        try { saved = localStorage.getItem(posKey(file)) } catch {}
        await view.init(saved ? { lastLocation: saved } : { showTextStart: true })

        tab.ready = true
        renderTabs()
        if (tab.id === state.active) fillTocSelect(tab)
    } catch (err) {
        console.error(err)
        wrap.innerHTML = '<div class="msg error">无法打开《' + fallbackName + '》<br><small>'
            + (err?.message || err) + '</small><br><small>DRM 加密的 Kindle 文件无法解析</small></div>'
    }
}
window.__openFiles = openFiles // 调试/自动化入口

// 同一 doc 防重复绑定
const boundDocs = new WeakSet()
function attachDoc(doc) {
    // 确保正文始终可划选复制（个别书籍自带 user-select:none）
    const style = doc.createElement('style')
    style.textContent = '*{user-select:text!important;-webkit-user-select:text!important}'
    doc.head.append(style)

    if (boundDocs.has(doc)) return
    boundDocs.add(doc)
    doc.addEventListener('keydown', onKey)
    // iframe 会吞掉拖拽事件：转发到全局逻辑，拖到正文上也能开新书
    doc.addEventListener('dragenter', e => { if (isFileDrag(e)) { e.preventDefault(); showOverlay() } })
    doc.addEventListener('dragover', e => { if (isFileDrag(e)) { e.preventDefault(); showOverlay() } })
    doc.addEventListener('drop', handleDrop)
}

/* ───────────────────────── 目录 ───────────────────────── */

function flattenTOC(toc, depth = 0, out = []) {
    for (const item of toc || []) {
        out.push({ label: '　'.repeat(depth) + (item.label ?? ''), href: item.href })
        if (item.subitems?.length) flattenTOC(item.subitems, depth + 1, out)
    }
    return out
}

function fillTocSelect(tab) {
    tocSel.replaceChildren(new Option('目录…', ''))
    for (const { label, href } of tab.toc) tocSel.add(new Option(label, href))
}
function syncTocSelect(href) {
    if (href && [...tocSel.options].some(o => o.value === href)) tocSel.value = href
}
tocSel.addEventListener('change', () => {
    const tab = activeTab()
    if (tab?.ready && tocSel.value) tab.view.goTo(tocSel.value).catch(console.error)
    tocSel.blur() // 交还键盘翻页焦点
})

/* ───────────────────────── 标签栏 ───────────────────────── */

function renderTabs() {
    tabsEl.replaceChildren()
    for (const tab of state.tabs.values()) {
        const b = document.createElement('button')
        b.className = 'tab' + (tab.id === state.active ? ' active' : '')
        b.title = tab.name
        b.innerHTML = '<span class="name"></span><span class="close" title="关闭">×</span>'
        b.querySelector('.name').textContent = tab.name
        b.addEventListener('click', e => {
            if (e.target.classList.contains('close')) closeTab(tab.id)
            else activateTab(tab.id)
        })
        tabsEl.append(b)
    }
}

function activateTab(id) {
    if (!state.tabs.has(id)) return
    state.active = id
    for (const tab of state.tabs.values())
        tab.wrap.classList.toggle('active', tab.id === id)
    const tab = activeTab()
    document.title = tab.name + ' · Reader'
    renderTabs()
    if (tab.ready) {
        fillTocSelect(tab)
        syncFlow(tab)
        updateStatus(tab)
        slider.value = tab.fraction ?? 0
        slider.dir = tab.view?.book?.dir === 'rtl' ? 'rtl' : 'ltr'
        searchBox.value = tab.search?.query ?? ''
        searchInfo.textContent = tab.search?.info ?? ''
    } else {
        tocSel.replaceChildren(new Option('目录…', ''))
        statusEl.textContent = ''
        slider.value = 0
        searchInfo.textContent = ''
    }
}

function closeTab(id) {
    const tab = state.tabs.get(id)
    if (!tab) return
    clearTimeout(tab.saveTimer)
    tab.view?.close()   // 释放渲染器与 book 实例（含 blob 资源）
    tab.wrap.remove()
    state.tabs.delete(id)
    if (!state.tabs.size) {
        document.body.classList.remove('has-books')
        document.title = 'Reader'
        tocSel.replaceChildren(new Option('目录…', ''))
        statusEl.textContent = ''
    } else if (state.active === id) {
        const ids = [...state.tabs.keys()]
        activateTab(ids[Math.min(ids.indexOf(id), ids.length - 1)] ?? ids[ids.length - 1])
    } else renderTabs()
}

/* ───────────────────────── 翻页 / 阅读模式 ───────────────────────── */

function updateStatus(tab) {
    const pct = tab.fraction != null ? Math.round(tab.fraction * 100) + '%' : ''
    const loc = tab.loc ? ' · Loc ' + tab.loc : ''
    statusEl.textContent = pct ? pct + loc : ''
}

$('#prevBtn').addEventListener('click', () => activeTab()?.view?.goLeft())
$('#nextBtn').addEventListener('click', () => activeTab()?.view?.goRight())

/* ── 进度滑块：双向同步 ── */
let scrubbing = false
slider.addEventListener('pointerdown', () => { scrubbing = true })
for (const ev of ['pointerup', 'pointercancel'])
    slider.addEventListener(ev, () => { scrubbing = false })
slider.addEventListener('input', () => {
    const tab = activeTab()
    if (tab?.ready) tab.view.goToFraction(parseFloat(slider.value)).catch(console.error)
})

/* ── 文内搜索：回车=全书搜索，再按=跳下一处并自动选中（Ctrl+C 即取） ── */
let searchToken = 0
async function runSearch(tab, q) {
    const token = ++searchToken
    tab.search = { query: q, results: [], i: 0, info: '…' }
    searchInfo.textContent = '…'
    try {
        for await (const r of tab.view.search({ query: q })) {
            if (token !== searchToken) return           // 已发起新搜索，丢弃旧结果
            if (r === 'done') break
            if (r?.subitems?.length) tab.search.results.push(...r.subitems)
            else if (r?.progress != null) searchInfo.textContent = Math.round(r.progress * 100) + '%…'
        }
        if (token !== searchToken) return
        tab.search.info = tab.search.results.length
            ? `${Math.min(1, tab.search.results.length)}/${tab.search.results.length} 处`
            : '无结果'
        searchInfo.textContent = tab.search.info
        if (tab.search.results.length) jumpNext(tab)
    } catch (err) {
        console.error(err)
        tab.search.info = searchInfo.textContent = '搜索失败'
    }
}
function jumpNext(tab) {
    const s = tab.search
    if (!s?.results.length) return
    const item = s.results[s.i % s.results.length]
    s.i++
    s.info = `${s.i}/${s.results.length} 处`
    searchInfo.textContent = s.info
    // view.select：跳转到匹配处并自动选中该段文字，直接 Ctrl+C 即可复制
    tab.view.select(item.cfi).catch(console.error)
}
searchBox.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
        searchBox.value = ''
        searchInfo.textContent = ''
        activeTab()?.view?.clearSearch?.()
        return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    const tab = activeTab()
    if (!tab?.ready) return
    const q = searchBox.value.trim()
    if (!q) { searchInfo.textContent = ''; return }
    if (tab.search?.query === q && tab.search.results.length) jumpNext(tab)
    else runSearch(tab, q)
})

function setFlow(flow) {
    state.flow = flow
    flowBtn.textContent = flow === 'paginated' ? '📄 分页' : '📜 滚动'
    const tab = activeTab()
    if (tab?.ready) syncFlow(tab)
}
// 只对当前可见视图生效；其他标签在激活时同步（隐藏时改属性会以 0 尺寸重排）
function syncFlow(tab) {
    if (tab.view?.renderer?.getAttribute('flow') !== state.flow)
        tab.view.renderer.setAttribute('flow', state.flow)
}
flowBtn.addEventListener('click', () => setFlow(state.flow === 'paginated' ? 'scrolled' : 'paginated'))

/* ───────────────────────── 文件选择 / SW 注册 ───────────────────────── */

$('#openBtn').addEventListener('click', () => fileInput.click())
fileInput.addEventListener('change', () => { openFiles(fileInput.files); fileInput.value = '' })

if ('serviceWorker' in navigator)
    navigator.serviceWorker.register('./sw.js').catch(console.error)
