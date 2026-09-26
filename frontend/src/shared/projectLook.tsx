import { inkOn, PROJECT_ICONS, type ProjectIcon } from "@amplifie/contract";
import {
  Airplane,
  Anchor,
  Bank,
  Barbell,
  BatteryFull,
  Bell,
  Blueprint,
  Boat,
  BookOpen,
  Briefcase,
  Buildings,
  Calculator,
  CalendarBlank,
  Camera,
  Car,
  ChartBar,
  ChartLine,
  Clock,
  Cloud,
  Coffee,
  Compass,
  Cpu,
  Crane,
  Cube,
  CurrencyDollar,
  Envelope,
  FileText,
  Fire,
  Flag,
  Flask,
  Flower,
  FolderSimple,
  Gear,
  Gift,
  Globe,
  GraduationCap,
  Hammer,
  Handshake,
  HardHat,
  HeartStraight,
  House,
  Key,
  Ladder,
  Leaf,
  Lightbulb,
  Lightning,
  Lock,
  MapPin,
  Medal,
  Megaphone,
  Mountains,
  MusicNotes,
  Newspaper,
  Nut,
  Package,
  PaintRoller,
  Palette,
  PawPrint,
  PencilSimple,
  Phone,
  Pipe,
  Plug,
  Presentation,
  Printer,
  Receipt,
  Rocket,
  Ruler,
  Scales,
  Scissors,
  Screwdriver,
  ShieldCheck,
  ShoppingCart,
  Sparkle,
  Star,
  Stethoscope,
  Sun,
  Tag,
  Target,
  Terminal,
  Toolbox,
  Train,
  Tree,
  Trophy,
  Truck,
  UserCircle,
  Users,
  Van,
  Wall,
  WifiHigh,
  Wrench,
} from "@phosphor-icons/react";

/**
 * Как папка выглядит: значок и цвет (task-038).
 *
 * ⚠️ ИМЕНА ЖИВУТ В ОБЩЕМ ПАКЕТЕ, А КАРТИНКИ — ЗДЕСЬ. Бек обязан знать,
 * какие имена законны (он их проверяет), но ничего не должен знать
 * о наборе иконок: узлы React в общем пакете сделали бы его зависимым
 * от React, и бек потащил бы его за собой.
 *
 * ⚠️ ЗАЧЕМ ВООБЩЕ ЦВЕТ И ЗНАЧОК. В списке из семи папок глаз ищет
 * по буквам, если все они одинаково серые. У Codex каждая папка своя
 * с первого взгляда — это и попросил владелец, показав снимки.
 *
 * ⚠️ НАБОР НАШ, А НЕ ЧУЖОЙ (владелец, 10.09: «сделать иконки не как
 * в gpt, а наши разные»). Первой идёт стройка — каска, кран, кирпичная
 * стена, чертёж, труба, — потому что это его дело; у Codex на этом
 * месте скрипичный ключ и лапка.
 */

/** Значок по имени. Порядок задаёт список в общем пакете, а не этот. */
const ICONS: Record<ProjectIcon, React.ComponentType<{ className?: string }>> = {
  folder: FolderSimple,
  house: House,
  buildings: Buildings,
  crane: Crane,
  helmet: HardHat,
  hammer: Hammer,
  wrench: Wrench,
  screwdriver: Screwdriver,
  toolbox: Toolbox,
  ladder: Ladder,
  roller: PaintRoller,
  ruler: Ruler,
  blueprint: Blueprint,
  wall: Wall,
  pipe: Pipe,
  cube: Cube,
  plug: Plug,
  power: Lightning,
  battery: BatteryFull,
  gear: Gear,
  nut: Nut,
  cpu: Cpu,
  cloud: Cloud,
  wifi: WifiHigh,
  truck: Truck,
  van: Van,
  car: Car,
  train: Train,
  boat: Boat,
  plane: Airplane,
  package: Package,
  money: CurrencyDollar,
  bank: Bank,
  receipt: Receipt,
  calculator: Calculator,
  chart: ChartBar,
  graph: ChartLine,
  presentation: Presentation,
  briefcase: Briefcase,
  handshake: Handshake,
  scales: Scales,
  doc: FileText,
  news: Newspaper,
  mail: Envelope,
  phone: Phone,
  megaphone: Megaphone,
  calendar: CalendarBlank,
  clock: Clock,
  printer: Printer,
  users: Users,
  person: UserCircle,
  key: Key,
  lock: Lock,
  shield: ShieldCheck,
  star: Star,
  flag: Flag,
  target: Target,
  fire: Fire,
  leaf: Leaf,
  tree: Tree,
  mountains: Mountains,
  sun: Sun,
  coffee: Coffee,
  cart: ShoppingCart,
  tag: Tag,
  bell: Bell,
  rocket: Rocket,
  camera: Camera,
  globe: Globe,
  idea: Lightbulb,
  heart: HeartStraight,
  trophy: Trophy,
  medal: Medal,
  compass: Compass,
  place: MapPin,
  anchor: Anchor,
  sparkle: Sparkle,
  book: BookOpen,
  cap: GraduationCap,
  pencil: PencilSimple,
  code: Terminal,
  music: MusicNotes,
  gift: Gift,
  scissors: Scissors,
  palette: Palette,
  health: Stethoscope,
  flower: Flower,
  sport: Barbell,
  pet: PawPrint,
  science: Flask,
};

export { PROJECT_ICONS };

/**
 * Цвет заливки. Пусто — заливки нет вовсе, значок берёт приглушённый цвет темы.
 *
 * ⚠️ ЗНАЧЕНИЕ, А НЕ ТОКЕН (task-104, отмена Р-041). Цвет выбирается пипеткой
 * и приезжает из базы как `#rrggbb`; токен темы подставить сюда нельзя —
 * он меняется вместе с темой, а цвет проекта у всех один.
 */
function labelColor(color: string | null | undefined): string | undefined {
  return color ?? undefined;
}

/**
 * Значок папки — белым на заливке выбранного цвета либо как раньше.
 *
 * ⚠️ ОДНА ФУНКЦИЯ НА ВСЕ МЕСТА, ГДЕ ПАПКА ПОКАЗЫВАЕТСЯ: строка панели,
 * выбор в окне, будущая карточка. Три копии разъехались бы на первой же
 * правке — у одной появился бы новый значок, у другой нет.
 *
 * ⚠️ ЗАЛИВКА, А НЕ ЦВЕТНОЙ ЗНАЧОК (task-103, владелец 17.09). Тонкая
 * цветная линия на панели почти не различалась; квадрат цвета узнаётся
 * с первого взгляда, как списки в Apple Reminders. Без цвета — прежний
 * приглушённый значок, с тем же отступом: строки с цветом и без стоят ровно.
 *
 * ⚠️ ЦВЕТ ЗНАЧКА СЧИТАЕТСЯ, А НЕ ЗАДАН (task-104). Заливку называет человек
 * пипеткой, и белый на светло-жёлтом не прочтёт никто: `inkOn` берёт из белого
 * и чёрного тот, что читается, — правило проверено перебором куба RGB.
 */
export function ProjectGlyph({
  icon,
  color,
  className,
}: {
  icon: string | null | undefined;
  color: string | null | undefined;
  className?: string;
}) {
  const Glyph = icon && icon in ICONS ? ICONS[icon as ProjectIcon] : FolderSimple;
  const tint = labelColor(color);
  return (
    <span
      className="grid shrink-0 place-items-center rounded-sm p-0.5"
      style={tint ? { backgroundColor: tint, color: inkOn(tint) } : undefined}
    >
      <Glyph className={className ?? "size-4"} />
    </span>
  );
}

/**
 * Значок без цвета — там, где цвет задаёт сама кнопка выбора.
 *
 * ⚠️ НЕИЗВЕСТНОЕ ИМЯ ОТДАЁТ ПАПКУ, А НЕ `undefined`. Прежде отдавало —
 * и одно расхождение списков роняло ВСЁ приложение белым экраном:
 * React на неизвестном типе элемента падает целиком, а не рисует пустоту.
 * Картинки может не быть по десятку причин (старый выбор, чужая версия
 * пакета, опечатка в миграции); ни одна из них не стоит белого экрана.
 */
export function iconByName(icon: string) {
  return icon in ICONS ? ICONS[icon as ProjectIcon] : FolderSimple;
}
