import { Platform } from 'react-native';
import { useSettings, type ThemeName } from '../core/settings';

export interface Theme {
  name: string;
  dark: boolean;
  bg: string; card: string; card2: string; line: string; fg: string; mut: string;
  acc: string; acc2: string; ok: string; warn: string; bad: string;
  glow: boolean;
  mono: boolean;
}

export const THEMES: Record<ThemeName, Theme> = {
  midnight: {name: 'มิดไนท์', dark: true, bg: '#0b0f14', card: '#141a22', card2: '#1b2330', line: '#263040', fg: '#e6edf3', mut: '#8b949e',
    acc: '#2f81f7', acc2: '#58a6ff', ok: '#3fb950', warn: '#d29922', bad: '#f85149', glow: false, mono: false},
  racing: {name: 'เรซซิ่ง', dark: true, bg: '#0a0a0a', card: '#151515', card2: '#1f1f1f', line: '#2c2c2c', fg: '#ffffff', mut: '#9a9a9a',
    acc: '#ff2d2d', acc2: '#ff6b3d', ok: '#2ee66b', warn: '#ffc400', bad: '#ff2d2d', glow: false, mono: false},
  neon: {name: 'นีออน', dark: true, bg: '#04070a', card: '#0a1116', card2: '#0f1a20', line: '#15303a', fg: '#d8fff4', mut: '#5f8f88',
    acc: '#00e5a0', acc2: '#00c3ff', ok: '#00e5a0', warn: '#ffd000', bad: '#ff3d7f', glow: true, mono: false},
  amber: {name: 'เรโทร', dark: true, bg: '#0d0a05', card: '#17120a', card2: '#20190d', line: '#3a2c12', fg: '#ffcf70', mut: '#a07c3a',
    acc: '#ffb000', acc2: '#ff8a00', ok: '#c8e000', warn: '#ffb000', bad: '#ff4d2d', glow: false, mono: true},
  day: {name: 'กลางวัน', dark: false, bg: '#eef0f3', card: '#ffffff', card2: '#f5f6f8', line: '#d0d7de', fg: '#111418', mut: '#5b6470',
    acc: '#0969da', acc2: '#0550ae', ok: '#1a7f37', warn: '#9a6700', bad: '#cf222e', glow: false, mono: false},
};

export function useTheme(): Theme {
  return THEMES[useSettings().theme] ?? THEMES.midnight;
}

/** ฟอนต์ตัวเลข */
export const numFont = (t: Theme) => (t.mono ? Platform.select({ios: 'Courier', default: 'monospace'}) : undefined);

export const GRAPH_COLORS = ['#2f81f7', '#f0883e', '#3fb950', '#db61a2'];
