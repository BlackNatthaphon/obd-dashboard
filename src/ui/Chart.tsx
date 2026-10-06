// กราฟเส้นจากประวัติค่า (ใช้ทั้งวิดเจ็ตเล็กและหน้ากราฟ)
import { Platform } from 'react-native';
import Svg, { Line, Path, Text as SvgText } from 'react-native-svg';
import { now } from '../obd/elm';
import { fmtVal, SRC } from '../obd/catalog';
import { V } from '../core/values';
import { useTheme } from './theme';

const FONT = Platform.select({web: 'system-ui, -apple-system, Segoe UI, sans-serif', default: undefined});

function series(id: string, t0: number, t1: number) {
  const o = V[id];
  if (!o) return null;
  const pts = o.hist.filter(h => h[0] >= t0 && h[0] <= t1);
  if (pts.length < 2) return null;
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { if (p[1] < lo) lo = p[1]; if (p[1] > hi) hi = p[1]; }
  return {pts, lo, hi};
}

function path(pts: [number, number][], t0: number, win: number, lo: number, hi: number, W: number, H: number, pad: number) {
  const span = hi - lo || 1;
  return pts.map((p, i) => {
    const x = ((p[0] - t0) / win) * W, y = H - pad - ((p[1] - lo) / span) * (H - pad * 2);
    return (i ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
  }).join('');
}

export function Spark({id, width, height = 70, win = 60000}: { id: string; width: number; height?: number; win?: number }) {
  const t = useTheme();
  const t1 = now(), t0 = t1 - win;
  const s = width > 0 ? series(id, t0, t1) : null;
  let d = '', area = '';
  if (s) {
    const hi = s.hi - s.lo < 1e-6 ? s.hi + 1 : s.hi, lo = s.hi - s.lo < 1e-6 ? s.lo - 1 : s.lo;
    d = path(s.pts, t0, win, lo, hi, width, height, 3);
    const xa = ((s.pts[0][0] - t0) / win) * width, xb = ((s.pts[s.pts.length - 1][0] - t0) / win) * width;
    area = `${d}L${xb.toFixed(1)} ${height}L${xa.toFixed(1)} ${height}Z`;
  }
  return (
    <Svg width={width} height={height}>
      {s && <Path d={area} fill={t.acc} fillOpacity={0.15} />}
      {s && <Path d={d} stroke={t.acc} strokeWidth={2} fill="none" strokeLinejoin="round" />}
    </Svg>
  );
}

export function MultiChart({ids, colors, width, height, winSec, frozenAt}: {
  ids: string[]; colors: string[]; width: number; height: number; winSec: number; frozenAt?: number | null;
}) {
  const t = useTheme();
  const win = winSec * 1000, t1 = frozenAt ?? now(), t0 = t1 - win;
  const grid = [];
  for (let i = 1; i < 4; i++) grid.push(<Line key={'h' + i} x1={0} x2={width} y1={(height * i) / 4} y2={(height * i) / 4} stroke={t.line} />);
  for (let i = 0; i <= 5; i++) {
    const x = (width * i) / 5;
    grid.push(<Line key={'v' + i} x1={x} x2={x} y1={0} y2={height} stroke={t.line} />);
    if (i < 5) grid.push(<SvgText key={'x' + i} x={x + 4} y={height - 6} fill={t.mut} fontSize={11} fontFamily={FONT}>{'-' + Math.round(winSec * (1 - i / 5)) + 's'}</SvgText>);
  }
  return (
    <Svg width={width} height={height}>
      {grid}
      {ids.map((id, i) => {
        const s = series(id, t0, t1);
        if (!s) return null;
        const pad = (s.hi - s.lo) * 0.1 || 1;
        return [
          <Path key={'p' + id} d={path(s.pts, t0, win, s.lo - pad, s.hi + pad, width, height, 0)} stroke={colors[i]} strokeWidth={2.2} fill="none" strokeLinejoin="round" />,
          <SvgText key={'m' + id} x={6} y={16 + i * 15} fill={colors[i]} fontSize={11} fontFamily={FONT}>{fmtVal(SRC[id], s.hi) + ' ' + SRC[id].unit}</SvgText>,
        ];
      })}
    </Svg>
  );
}
