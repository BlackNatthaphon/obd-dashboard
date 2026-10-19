// เกจเข็มวงกลม 270°
import { Platform } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { fmtVal, type Source } from '../obd/catalog';
import { useTheme } from './theme';

const CX = 100, CY = 100, R = 80, START = 135, SWEEP = 270;
const FONT = Platform.select({web: 'system-ui, -apple-system, Segoe UI, sans-serif', default: undefined});
const pt = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};
function arc(p0: number, p1: number) {
  const a0 = START + SWEEP * p0, a1 = START + SWEEP * p1;
  const [x0, y0] = pt(a0, R), [x1, y1] = pt(a1, R);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${R} ${R} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export function Gauge({src, v, width, labels, red, mark, alarm}: {
  src: Source; v: number | null; width: number; labels: boolean; red?: number | null; mark?: number | null; alarm?: boolean;
}) {
  const t = useTheme();
  const p = v == null ? 0 : Math.max(0, Math.min(1, (v - src.min) / (src.max - src.min)));
  const rp = red != null ? Math.max(0, Math.min(1, (red - src.min) / (src.max - src.min))) : null;
  const col = alarm ? t.bad : t.acc;
  const ticks = [];
  for (let i = 0; i <= 10; i++) {
    const a = START + i * 27, major = i % 2 === 0;
    const [x1, y1] = pt(a, major ? 68 : 72), [x2, y2] = pt(a, 78);
    ticks.push(<Line key={'t' + i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={t.mut} strokeWidth={major ? 2 : 1} />);
    if (labels && major && i > 0 && i < 10) {
      let lv = src.min + ((src.max - src.min) * i) / 10;
      lv = src.max >= 1000 ? +(lv / 1000).toFixed(1) : Math.round(lv * 10) / 10;
      const [lx, ly] = pt(a, 58);
      ticks.push(<SvgText key={'l' + i} x={lx} y={ly + 3} fill={t.mut} fontSize={9} fontFamily={FONT} textAnchor="middle">{String(lv)}</SvgText>);
    }
  }
  const [nx, ny] = pt(START + SWEEP * p, 52);
  // ขีดสีเหลืองตรงรอบที่ควรเปลี่ยนเกียร์
  const mp = mark != null ? Math.max(0, Math.min(1, (mark - src.min) / (src.max - src.min))) : null;
  const [mx1, my1] = mp != null ? pt(START + SWEEP * mp, 66) : [0, 0], [mx2, my2] = mp != null ? pt(START + SWEEP * mp, 90) : [0, 0];
  return (
    <Svg width={width} height={width * 0.86} viewBox="0 0 200 172">
      <Path d={arc(0, 1)} stroke={t.card2} strokeWidth={12} strokeLinecap="round" fill="none" />
      {rp != null && rp < 1 && <Path d={arc(rp, 1)} stroke={t.bad} strokeOpacity={0.55} strokeWidth={12} fill="none" />}
      {p > 0.004 && <Path d={arc(0, p)} stroke={col} strokeWidth={12} strokeLinecap="round" fill="none" />}
      {ticks}
      {mp != null && <Line x1={mx1} y1={my1} x2={mx2} y2={my2} stroke={t.warn} strokeWidth={4} strokeLinecap="round" />}
      <Line x1={CX} y1={CY} x2={nx} y2={ny} stroke={t.fg} strokeWidth={3} strokeLinecap="round" />
      <Circle cx={CX} cy={CY} r={6} fill={t.fg} />
      <SvgText x={CX} y={146} fill={alarm ? t.bad : t.fg} fontSize={30} fontWeight="700" fontFamily={FONT} textAnchor="middle">{fmtVal(src, v)}</SvgText>
      <SvgText x={CX} y={164} fill={t.mut} fontSize={11} fontFamily={FONT} textAnchor="middle">{src.unit}</SvgText>
    </Svg>
  );
}
