import {
  Activity,
  Archive,
  BarChart3,
  BookOpen,
  Boxes,
  Bug,
  CalendarDays,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Cloud,
  Code2,
  Compass,
  Cpu,
  Database,
  FileCode2,
  FileText,
  Flag,
  Folder,
  GitBranch,
  Globe2,
  GraduationCap,
  Hammer,
  Heart,
  HelpCircle,
  Home,
  Image,
  KeyRound,
  Laptop,
  Layers,
  Lightbulb,
  Link2,
  ListChecks,
  LockKeyhole,
  Map,
  MessageSquareText,
  Network,
  Package,
  Palette,
  PenLine,
  Rocket,
  Search,
  Server,
  Settings2,
  ShieldCheck,
  Sparkles,
  Star,
  Target,
  TestTube2,
  Users,
  Wrench,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export const ENTITY_ICON_OPTIONS = [
  { value: 'file-text', label: 'Страница', Icon: FileText },
  { value: 'book-open', label: 'Документация', Icon: BookOpen },
  { value: 'folder', label: 'Проект', Icon: Folder },
  { value: 'layers', label: 'Продукт', Icon: Layers },
  { value: 'compass', label: 'Руководство', Icon: Compass },
  { value: 'map', label: 'Карта', Icon: Map },
  { value: 'home', label: 'Главная', Icon: Home },
  { value: 'star', label: 'Избранное', Icon: Star },
  { value: 'flag', label: 'Цель', Icon: Flag },
  { value: 'target', label: 'Фокус', Icon: Target },
  { value: 'activity', label: 'Активность', Icon: Activity },
  { value: 'bar-chart', label: 'Аналитика', Icon: BarChart3 },
  { value: 'database', label: 'Данные', Icon: Database },
  { value: 'server', label: 'Инфраструктура', Icon: Server },
  { value: 'network', label: 'Архитектура', Icon: Network },
  { value: 'cloud', label: 'Облако', Icon: Cloud },
  { value: 'code', label: 'Разработка', Icon: Code2 },
  { value: 'file-code', label: 'Исходный код', Icon: FileCode2 },
  { value: 'git-branch', label: 'Git', Icon: GitBranch },
  { value: 'bug', label: 'Ошибки', Icon: Bug },
  { value: 'test-tube', label: 'Тестирование', Icon: TestTube2 },
  { value: 'cpu', label: 'Вычисления', Icon: Cpu },
  { value: 'laptop', label: 'Рабочее место', Icon: Laptop },
  { value: 'package', label: 'Пакет', Icon: Package },
  { value: 'boxes', label: 'Модули', Icon: Boxes },
  { value: 'archive', label: 'Архив', Icon: Archive },
  { value: 'rocket', label: 'Запуск', Icon: Rocket },
  { value: 'zap', label: 'Автоматизация', Icon: Zap },
  { value: 'hammer', label: 'Сборка', Icon: Hammer },
  { value: 'wrench', label: 'Инструменты', Icon: Wrench },
  { value: 'settings', label: 'Настройки', Icon: Settings2 },
  { value: 'shield', label: 'Безопасность', Icon: ShieldCheck },
  { value: 'lock', label: 'Доступ', Icon: LockKeyhole },
  { value: 'key', label: 'Ключи', Icon: KeyRound },
  { value: 'users', label: 'Команда', Icon: Users },
  { value: 'message', label: 'Обсуждение', Icon: MessageSquareText },
  { value: 'clipboard', label: 'План', Icon: ClipboardCheck },
  { value: 'list-checks', label: 'Задачи', Icon: ListChecks },
  { value: 'check-circle', label: 'Готово', Icon: CheckCircle2 },
  { value: 'calendar', label: 'Календарь', Icon: CalendarDays },
  { value: 'clock', label: 'История', Icon: Clock3 },
  { value: 'lightbulb', label: 'Идея', Icon: Lightbulb },
  { value: 'sparkles', label: 'AI и новое', Icon: Sparkles },
  { value: 'pen-line', label: 'Заметки', Icon: PenLine },
  { value: 'palette', label: 'Дизайн', Icon: Palette },
  { value: 'image', label: 'Медиа', Icon: Image },
  { value: 'link', label: 'Ссылки', Icon: Link2 },
  { value: 'graduation-cap', label: 'Обучение', Icon: GraduationCap },
  { value: 'heart', label: 'Команда и культура', Icon: Heart },
  { value: 'help', label: 'Справка', Icon: HelpCircle },
  { value: 'search', label: 'Поиск', Icon: Search },
  { value: 'globe', label: 'Web', Icon: Globe2 },
] as const;

export type EntityIconKey = (typeof ENTITY_ICON_OPTIONS)[number]['value'];
export type ProjectIconKey = EntityIconKey;
export const PROJECT_ICON_OPTIONS = ENTITY_ICON_OPTIONS;

const ENTITY_ICONS = Object.fromEntries(
  ENTITY_ICON_OPTIONS.map(({ value, Icon }) => [value, Icon]),
) as Record<EntityIconKey, LucideIcon>;

const LEGACY_ENTITY_ICONS: Record<string, EntityIconKey> = {
  '📘': 'book-open',
  '📁': 'folder',
  '🚀': 'rocket',
  '💻': 'code',
  '🗄️': 'database',
  '🔒': 'shield',
  '🌐': 'globe',
  '🧭': 'compass',
  '📄': 'file-text',
};

export function normalizeProjectIcon(icon: string | null): EntityIconKey {
  if (icon && icon in ENTITY_ICONS) return icon as EntityIconKey;
  return (icon && LEGACY_ENTITY_ICONS[icon]) || 'folder';
}

export function normalizeDocumentIcon(icon: string | null): EntityIconKey {
  if (icon && icon in ENTITY_ICONS) return icon as EntityIconKey;
  return (icon && LEGACY_ENTITY_ICONS[icon]) || 'file-text';
}

export function getEntityIconLabel(icon: string | null): string {
  const key = normalizeDocumentIcon(icon);
  return ENTITY_ICON_OPTIONS.find((option) => option.value === key)?.label ?? 'Страница';
}

interface EntityIconProps {
  icon?: string | null;
  className?: string;
}

export function ProjectIcon({ icon, className = 'h-4 w-4' }: EntityIconProps) {
  const Icon = ENTITY_ICONS[normalizeProjectIcon(icon ?? null)];
  return <Icon aria-hidden="true" className={className} strokeWidth={1.75} />;
}

export function DocumentIcon({ icon, className = 'h-4 w-4' }: EntityIconProps) {
  const Icon = ENTITY_ICONS[normalizeDocumentIcon(icon ?? null)];
  return <Icon aria-hidden="true" className={className} strokeWidth={1.75} />;
}
