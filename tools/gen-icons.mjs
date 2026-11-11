// 极简 PNG 图标生成器（纯 Node，无依赖）：4x 超采样抗锯齿
// 用法: node tools/gen-icons.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const BG = [38, 40, 44, 255]      // #26282c
const FG = [232, 233, 235, 255]  // #e8e9eb
const AC = [74, 143, 226, 255]   // #4a8fe2 点缀色

const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    return c >>> 0
})
const crc32 = buf => {
    let c = 0xffffffff
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type), data])
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
    return Buffer.concat([len, body, crc])
}

// 图形描述（单位坐标 u,v ∈ [0,1]）
const inRect = (u, v, x0, y0, x1, y1) => u >= x0 && u <= x1 && v >= y0 && v <= y1
const inRound = (u, v, r) => {
    // 圆角方形（0.5 为中心，边长 1）
    const dx = Math.max(Math.abs(u - 0.5) - (0.5 - r), 0)
    const dy = Math.max(Math.abs(v - 0.5) - (0.5 - r), 0)
    return dx * dx + dy * dy <= r * r
}
// 打开的书：两页 + 底部书脊 + 页面"文字"行
const glyph = (u, v, g) => {
    const page = (inRect(u, v, g.x0, g.y0, g.xm - g.gap, g.y1) || inRect(u, v, g.xm + g.gap, g.y0, g.x1, g.y1))
    const spine = inRect(u, v, g.x0, g.y1 + 0.045, g.x1, g.y1 + 0.085)
    return page || spine
}
const textLines = (u, v, g) =>
    (inRect(u, v, g.x0 + 0.03, g.y0 + 0.06, g.xm - g.gap - 0.03, g.y0 + 0.085)
     || inRect(u, v, g.xm + g.gap + 0.03, g.y0 + 0.06, g.x1 - 0.03, g.y0 + 0.085)
     || inRect(u, v, g.x0 + 0.03, g.y0 + 0.13, g.xm - g.gap - 0.06, g.y0 + 0.155)
     || inRect(u, v, g.xm + g.gap + 0.03, g.y0 + 0.13, g.x1 - 0.06, g.y0 + 0.155))

function render(size, { maskable }) {
    const N = 4 // 超采样
    const g = maskable
        ? { x0: 0.30, x1: 0.70, xm: 0.5, gap: 0.012, y0: 0.34, y1: 0.58 }
        : { x0: 0.26, x1: 0.74, xm: 0.5, gap: 0.015, y0: 0.30, y1: 0.60 }
    const raw = Buffer.alloc(size * (size * 4 + 1))
    for (let y = 0; y < size; y++) {
        raw[y * (size * 4 + 1)] = 0 // filter: none
        for (let x = 0; x < size; x++) {
            let r = 0, gr = 0, b = 0, a = 0
            for (let sy = 0; sy < N; sy++) for (let sx = 0; sx < N; sx++) {
                const u = (x + (sx + 0.5) / N) / size
                const v = (y + (sy + 0.5) / N) / size
                const inside = maskable ? true : inRound(u, v, 0.115)
                let c = [0, 0, 0, 0]
                if (inside) c = glyph(u, v, g)
                    ? (textLines(u, v, g) ? BG : FG)
                    : BG
                // 书脊中间加一条点缀色
                if (inside && inRect(u, v, g.xm - g.gap, g.y0 - 0.05, g.xm + g.gap, g.y1)) c = AC
                r += c[0]; gr += c[1]; b += c[2]; a += c[3]
            }
            const o = y * (size * 4 + 1) + 1 + x * 4
            raw[o] = r / N / N; raw[o + 1] = gr / N / N
            raw[o + 2] = b / N / N; raw[o + 3] = a / N / N
        }
    }
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4)
    ihdr[8] = 8; ihdr[9] = 6 // 8-bit RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ])
}

mkdirSync(new URL('../icons/', import.meta.url), { recursive: true })
const out = (name, buf) => {
    const p = new URL('../icons/' + name, import.meta.url)
    writeFileSync(p, buf)
    console.log('wrote', p.pathname, buf.length, 'bytes')
}
out('icon-192.png', render(192, { maskable: false }))
out('icon-512.png', render(512, { maskable: false }))
out('icon-maskable-512.png', render(512, { maskable: true }))
