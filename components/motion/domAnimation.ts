import { domAnimation } from 'framer-motion'

/**
 * Анимации и жесты motion (animate, exit, whileHover/Tap/InView) — без
 * layout и drag. Отдельный модуль, чтобы LazyMotion грузил его чанком после
 * гидрации, а не в первой загрузке каждой страницы (components/MotionProvider).
 */
export default domAnimation
