/**
 * Пересобирает app/favicon.ico из app/icon.svg.
 *
 *   npx tsx scripts/favicon.ts
 *
 * Знак один, и нарисован он в app/icon.svg; favicon.ico — только его растр для
 * тех, кто просит /favicon.ico сам, без <link rel=icon>: браузеры, читалки,
 * боты. Внутри два PNG-кадра, 32 и 48 пикселей — PNG внутри ICO понимают все
 * браузеры, которые вообще живы. Сменился знак — перезапусти скрипт;
 * устройство файла проверяет lib/pwa.test.ts.
 *
 * sharp приезжает вместе с next (им оптимизируются картинки), отдельной
 * зависимостью его не заводим.
 */

import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'

const APP = path.join(process.cwd(), 'app')
const SIZES = [32, 48]
/** Сетка исходного знака — как в app/icon.svg */
const GRID = 64

async function main() {
  const svg = fs.readFileSync(path.join(APP, 'icon.svg'))
  // Плотность с запасом: растеризуем крупнее и ужимаем, иначе края мылятся
  const frames = await Promise.all(
    SIZES.map((s) =>
      sharp(svg, { density: 72 * (s / GRID) * 4 })
        .resize(s, s)
        .png({ compressionLevel: 9 })
        .toBuffer(),
    ),
  )

  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // зарезервировано
  header.writeUInt16LE(1, 2) // тип: иконка
  header.writeUInt16LE(SIZES.length, 4)

  const dir = Buffer.alloc(16 * SIZES.length)
  let offset = header.length + dir.length
  SIZES.forEach((s, i) => {
    const e = i * 16
    dir.writeUInt8(s, e) // ширина
    dir.writeUInt8(s, e + 1) // высота
    dir.writeUInt16LE(1, e + 4) // плоскости
    dir.writeUInt16LE(32, e + 6) // бит на пиксель
    dir.writeUInt32LE(frames[i].length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += frames[i].length
  })

  const ico = Buffer.concat([header, dir, ...frames])
  fs.writeFileSync(path.join(APP, 'favicon.ico'), ico)
  console.log(`app/favicon.ico: ${SIZES.join(' и ')} px, ${ico.length} байт`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
