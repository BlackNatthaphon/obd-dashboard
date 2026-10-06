import { Tabs } from 'expo-router';
import { TabIcon, TopBar } from '../../ui/TopBar';
import { useTheme } from '../../ui/theme';

const TABS: [string, string, string][] = [
  ['index', 'แดช', 'แดชบอร์ด'],
  ['race', 'จับเวลา', 'จับเวลา'],
  ['live', 'ค่าทั้งหมด', 'ค่าทั้งหมด'],
  ['graph', 'กราฟ', 'กราฟ'],
  ['diag', 'ตรวจเช็ค', 'ตรวจเช็ค'],
];

export default function TabsLayout() {
  const t = useTheme();
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: t.acc,
      tabBarInactiveTintColor: t.mut,
      tabBarStyle: {backgroundColor: t.card, borderTopColor: t.line},
      sceneStyle: {backgroundColor: t.bg},
      tabBarLabelStyle: {fontSize: 11, lineHeight: 16},
    }}>
      {TABS.map(([name, label, title]) => (
        <Tabs.Screen key={name} name={name} options={{
          title: label,
          header: () => <TopBar title={title} />,
          tabBarIcon: ({color}) => <TabIcon name={name} color={String(color)} />,
        }} />
      ))}
    </Tabs>
  );
}
